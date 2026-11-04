// Pixel algebra and durable controls. No network, credential access,
// body-colour heuristics, telemetry or model installation.
import { projectMask } from '../mask-projection';
import { maskGeometry } from './mask-geometry';
import type { GarmentMask } from '../masks';
import type { Store } from './hosted';
import { pngPixels } from './png-pixels';
import { encodeRgbaPng } from './encode-png';
import { imageHash } from './routes';

export const twoStageProtocol = 'foreground-visible-human-v1';
export const twoStageSteps = ['foreground', 'skin', 'hair', 'discover', 'accessory'] as const;
export type TwoStageStep = typeof twoStageSteps[number];
export const twoStageLimits = Object.freeze({ sam: 4, muse: 1, openai: 0, retries: 0, windowMs: 20 * 60_000 });
export const foregroundDiagnosticLimits = Object.freeze({ sam: 1, muse: 0, openai: 0, retries: 0, windowMs: 20 * 60_000 });
export const remainingTwoStageLimits = Object.freeze({ sam: 3, muse: 1, openai: 0, retries: 0, windowMs: 20 * 60_000 });
export type TwoStagePlan='foreground-only-v1'|'reuse-foreground-v1';
export const limitsForTwoStage = (plan?:TwoStagePlan) => plan === 'foreground-only-v1' ? foregroundDiagnosticLimits : plan==='reuse-foreground-v1'?remainingTwoStageLimits:twoStageLimits;
export const twoStageConcepts = Object.freeze({ foreground: 'person', skin: 'exposed human skin', hair: 'hair' });
const accessoryConcepts = new Set(['bag', 'ring', 'bracelet', 'sunglasses', 'goggles', 'watch', 'necklace', 'earrings', 'belt']);
export const isTwoStageAccessory = (kind: string) => accessoryConcepts.has(kind);
const hashPattern = /^[a-f0-9]{64}$/;
function assert(value: unknown, code: string): asserts value { if (!value) throw Error(code); }
export interface Raster { width: number; height: number; data: Uint8Array }
function validRaster(r: Raster, width: number, height: number) {
  assert(r.width === width && r.height === height && r.data instanceof Uint8Array && r.data.length === width * height, 'mask_dimensions');
  assert(r.data.every(v => v === 0 || v === 1), 'mask_not_binary');
}
export async function rasterHash(r: Raster) {
  return imageHash(new TextEncoder().encode(`${r.width}:${r.height}:` + await imageHash(r.data)));
}
// Union actual provider masks in source coordinates. Empty results remain empty.
export function sourceRaster(masks: GarmentMask[], width: number, height: number): Raster {
  assert([width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1600), 'image_dimensions');
  assert(masks.length <= 20, 'mask_limit');
  let nativePixels=0,projectedPixels=0;
  for(const m of masks)assert(!maskGeometry(0,width,height,m.bounds,m.mask,nativePixels+=m.mask.width*m.mask.height,projectedPixels+=(m.bounds.right-m.bounds.left)*(m.bounds.bottom-m.bounds.top)).issues.length,'mask_bounds');
  const data = new Uint8Array(width * height);
  for (const m of masks) {
    let projected:ReturnType<typeof projectMask>;try{projected=projectMask(m,width,height);}catch{throw Error('mask_bounds');}
    projected.forEach((x,y)=>{data[y*width+x]=1;});
  }
  return { width, height, data };
}
export function composeForegroundPixels(source:{width:number;height:number;rgba:Uint8ClampedArray},masks:GarmentMask[]){
  assert(source.rgba.length===source.width*source.height*4,'source_pixels');
  const raster=sourceRaster(masks,source.width,source.height),rgba=new Uint8ClampedArray(source.rgba.length);
  for(let i=0;i<raster.data.length;i++)if(raster.data[i])rgba.set(source.rgba.subarray(i*4,i*4+4),i*4);
  return{raster,pixels:{width:source.width,height:source.height,rgba}};
}
export interface ResidualBinding {
  protocol: typeof twoStageProtocol; sourceSha256: string; residualSha256: string;
  maskHashes: { foreground: string; skin: string; hair: string };
  width: number; height: number; foregroundPixels: number; removedPixels: number;
  remainingPixels: number; targetConflictPixels: number;
}
// No filling, enlargement, repainting or blanket skin-colour deletion. RGB values
// of kept pixels remain exact. Removed pixels are transparent, never reconstructed.
export async function prepareResidual(source: Uint8Array, approvedHash: string, masks: { foreground: Raster; skin: Raster; hair: Raster }, knownTarget?: Raster) {
  assert(hashPattern.test(approvedHash) && await imageHash(source) === approvedHash, 'source_mismatch');
  const pixels = await pngPixels(source), { width, height } = pixels;
  assert(width <= 1600 && height <= 1600, 'image_dimensions');
  for (const r of Object.values(masks)) validRaster(r, width, height);
  if (knownTarget) validRaster(knownTarget, width, height);
  const rgba = new Uint8ClampedArray(pixels.rgba.length);
  let foregroundPixels = 0, removedPixels = 0, remainingPixels = 0, targetConflictPixels = 0;
  for (let i = 0; i < width * height; i++) {
    const human = !!(masks.skin.data[i] || masks.hair.data[i]);
    if (knownTarget?.data[i] && (!masks.foreground.data[i] || human)) targetConflictPixels++;
    if (!masks.foreground.data[i]) continue;
    foregroundPixels++;
    if (human) { removedPixels++; continue; }
    remainingPixels++; rgba.set(pixels.rgba.subarray(i * 4, i * 4 + 4), i * 4);
  }
  const image = await encodeRgbaPng({ width, height, rgba });
  const binding: ResidualBinding = { protocol: twoStageProtocol, sourceSha256: approvedHash, residualSha256: await imageHash(image), maskHashes: { foreground: await rasterHash(masks.foreground), skin: await rasterHash(masks.skin), hair: await rasterHash(masks.hair) }, width, height, foregroundPixels, removedPixels, remainingPixels, targetConflictPixels };
  // A candidate is NOT semantic approval. Existing target masks can be wrong, so
  // conflicts halt instead of silently restoring their pixels or discarding tissue.
  return { image, binding, stop: foregroundPixels === 0 ? 'empty_foreground' : remainingPixels === 0 ? 'empty_residual' : targetConflictPixels ? 'target_overlap_uncertain' : removedPixels === 0 ? 'no_human_material_removed' : 'visual_check_required' };
}
export interface TwoStageScope { id: string; sourceSha256: string; approvedAt: number; expiresAt: number; plan?:TwoStagePlan;foregroundMaskDigest?:string;foregroundImageSha256?:string }
interface Attempt { state: 'reserved' | 'completed' | 'empty' | 'failed' | 'unknown'; outputSha256?: string;reused?:true }
interface Ledger { scope: string; attempts: Partial<Record<TwoStageStep, Attempt>>; halted: boolean; residualSha256?: string; selectedConcept?: string }
export interface ResidualReview { itemPixelsPreserved: boolean; humanPixelsRemoved: boolean; noUnexpectedClothingLoss: boolean }
// Durable reservation contract, tested with an atomic Store. Scope activation is
// controlled by the separately gated Worker bridge, never by request input.
export class TwoStageLedger {
  private key: string;
  constructor(private store: Store, private scope: TwoStageScope, private now = () => Date.now()) {
    assert((scope.plan===undefined||scope.plan==='foreground-only-v1'||scope.plan==='reuse-foreground-v1')&&/^two-stage-[a-z0-9-]{8,60}$/.test(scope.id) && hashPattern.test(scope.sourceSha256) && Number.isSafeInteger(scope.approvedAt) && Number.isSafeInteger(scope.expiresAt) && scope.expiresAt > scope.approvedAt && scope.expiresAt - scope.approvedAt <= twoStageLimits.windowMs, 'invalid_scope');
    assert(scope.plan!=='reuse-foreground-v1'||hashPattern.test(scope.foregroundMaskDigest??'')&&hashPattern.test(scope.foregroundImageSha256??''),'invalid_reuse_scope');
    this.key = scope.id;
  }
  private async state(tx: Store): Promise<Ledger> {
    const scope = JSON.stringify({ protocol: twoStageProtocol, ...this.scope, limits: limitsForTwoStage(this.scope.plan) });
    const old = await tx.get<Ledger>(this.key);
    assert(!old || old.scope === scope, 'scope_changed');
    return old ?? { scope, attempts: {}, halted: false };
  }
  private active() { assert(this.now() >= this.scope.approvedAt && this.now() < this.scope.expiresAt, 'expired'); }
  async audit() {
    const j = await this.state(this.store);
    return { attempts: j.attempts, halted: j.halted, residualSha256: j.residualSha256, selectedConcept: j.selectedConcept,reusedForeground:j.attempts.foreground?.reused===true, samAttempts: ['foreground', 'skin', 'hair', 'accessory'].filter(s => j.attempts[s as TwoStageStep]&&!j.attempts[s as TwoStageStep]?.reused).length, museAttempts: j.attempts.discover ? 1 : 0 };
  }
  async importForeground(rasterSha256:string,maskDigest:string,imageSha256:string){
    this.active();assert(this.scope.plan==='reuse-foreground-v1'&&hashPattern.test(rasterSha256)&&maskDigest===this.scope.foregroundMaskDigest&&imageSha256===this.scope.foregroundImageSha256,'foreground_not_approved');
    await this.store.transaction(async tx=>{this.active();const j=await this.state(tx);assert(!j.halted&&!Object.keys(j.attempts).length,'foreground_already_imported_or_started');j.attempts.foreground={state:'completed',outputSha256:rasterSha256,reused:true};await tx.put(this.key,j);});
  }
  async assertSelection(pieceHash: string, concept: string) {
    const j = await this.state(this.store);
    assert(j.attempts.discover?.state === 'completed' && j.attempts.discover.outputSha256 === pieceHash && j.selectedConcept === concept, 'discovery_not_bound');
  }
  async reserve(stage: TwoStageStep, input: Uint8Array) {
    this.active(); assert(twoStageSteps.includes(stage), 'invalid_stage');
    assert(this.scope.plan!=='foreground-only-v1'||stage==='foreground','stage_not_approved');
    assert(this.scope.plan!=='reuse-foreground-v1'||stage!=='foreground','foreground_reuse_only');
    const inputHash = await imageHash(input);
    return this.store.transaction(async tx => {
      this.active(); const j = await this.state(tx);
      assert(!j.halted, 'halted');
      assert(!Object.values(j.attempts).some(a => a.state === 'reserved' || a.state === 'unknown'), 'outcome_uncertain');
      assert(!j.attempts[stage], 'already_attempted');
      const index = twoStageSteps.indexOf(stage);
      assert(twoStageSteps.slice(0, index).every(s => j.attempts[s]?.state === 'completed' || j.attempts[s]?.state === 'empty'), 'stage_order');
      const expected=index<3?(this.scope.plan==='reuse-foreground-v1'?this.scope.foregroundImageSha256:this.scope.sourceSha256):j.residualSha256;
      assert(inputHash === expected, 'input_not_bound');
      if (stage === 'accessory') assert(j.selectedConcept, 'automatic_target_missing');
      j.attempts[stage] = { state: 'reserved' }; await tx.put(this.key, j);
    });
  }
  async complete(stage: TwoStageStep, state: Exclude<Attempt['state'], 'reserved'>, outputSha256?: string, discoveredConcept?: string) {
    assert(['completed', 'empty', 'failed', 'unknown'].includes(state), 'invalid_outcome');
    if (state === 'completed') assert(outputSha256 && hashPattern.test(outputSha256), 'output_digest_required');
    if (stage === 'discover' && state === 'completed') assert(typeof discoveredConcept === 'string' && accessoryConcepts.has(discoveredConcept), 'automatic_target_missing');
    await this.store.transaction(async tx => {
      const j = await this.state(tx); assert(j.attempts[stage]?.state === 'reserved', 'not_reserved');
      j.attempts[stage] = { state, ...(outputSha256 ? { outputSha256 } : {}) };
      if (state === 'failed' || state === 'unknown' || state === 'empty' && (stage === 'foreground' || stage === 'discover')) j.halted = true;
      if (stage === 'discover' && state === 'completed') j.selectedConcept = discoveredConcept;
      await tx.put(this.key, j);
    });
  }
  async bindResidual(source: Uint8Array, masks: { foreground: Raster; skin: Raster; hair: Raster }, review: ResidualReview, knownTarget?: Raster) {
    this.active();
    // Recompute from exact approved bytes and actual masks; never trust a caller's
    // claimed residual hash, pixel totals or derivation metadata.
    const result = await prepareResidual(source, this.scope.sourceSha256, masks, knownTarget), { binding } = result;
    const pass = await this.store.transaction(async tx => {
      this.active();
      const j = await this.state(tx); assert(!j.halted && !j.residualSha256, 'residual_already_bound_or_halted');
      for (const s of ['foreground', 'skin', 'hair'] as const) assert(j.attempts[s]?.state === 'completed' && j.attempts[s]?.outputSha256 === binding.maskHashes[s], 'mask_not_bound');
      // No semantic inference is made from numeric mask area or model acceptance.
      const accepted = binding.foregroundPixels > 0 && binding.removedPixels > 0 && binding.remainingPixels > 0 && binding.targetConflictPixels === 0 && review.itemPixelsPreserved === true && review.humanPixelsRemoved === true && review.noUnexpectedClothingLoss === true;
      if (accepted) j.residualSha256 = binding.residualSha256; else j.halted = true;
      await tx.put(this.key, j); return accepted;
    });
    assert(pass, 'residual_quality_stop'); return result;
  }
}
