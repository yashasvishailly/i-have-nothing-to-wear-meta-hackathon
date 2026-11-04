// Operator-only bounded experiment bridge. Default OFF; reuses MODEL_API_KEY only
// after approved scope, same-origin consent, source checks and durable reservation.
import { TwoStageLedger, twoStageProtocol, twoStageConcepts, twoStageLimits, limitsForTwoStage, sourceRaster, rasterHash, prepareResidual, composeForegroundPixels, isTwoStageAccessory, type TwoStageScope, type TwoStageStep } from './two-stage-experiment';
import { MetaAdapters, ProviderError, type Transport } from './meta';
import { discoverPieces } from './discovery';
import { imageHash } from './routes';
import { validatePng } from './png';
import { pngPixels } from './png-pixels';
import { digest, selectDiscoveredPieces, validateManifest } from '../discovery';
import type { Store } from './hosted';
import { decodeBoundedBase64 } from './automatic';
export interface TwoStageEnv {
  APP_ORIGIN?: string; MODEL_API_KEY?: string;
  WARDROBE_TWO_STAGE_MODE?: string; WARDROBE_TWO_STAGE_ID?: string;
  WARDROBE_TWO_STAGE_DIAGNOSTICS?: string;
  WARDROBE_TWO_STAGE_PLAN?: string;
  WARDROBE_TWO_STAGE_FOREGROUND_MASK_SHA256?:string;WARDROBE_TWO_STAGE_FOREGROUND_IMAGE_SHA256?:string;
  WARDROBE_TWO_STAGE_SOURCE_SHA256?: string; WARDROBE_TWO_STAGE_APPROVED_AT?: string; WARDROBE_TWO_STAGE_EXPIRES_AT?: string;
}
export function twoStageScope(env: TwoStageEnv, now = Date.now()): TwoStageScope | undefined {
  if (env.WARDROBE_TWO_STAGE_MODE !== 'approved') return;
  const id = env.WARDROBE_TWO_STAGE_ID ?? '', sourceSha256 = env.WARDROBE_TWO_STAGE_SOURCE_SHA256 ?? '', approvedAt = Date.parse(env.WARDROBE_TWO_STAGE_APPROVED_AT ?? ''), expiresAt = Date.parse(env.WARDROBE_TWO_STAGE_EXPIRES_AT ?? '');
  if (!/^two-stage-[a-z0-9-]{8,60}$/.test(id) || !/^[a-f0-9]{64}$/.test(sourceSha256) || !Number.isSafeInteger(approvedAt) || !Number.isSafeInteger(expiresAt) || now < approvedAt || now >= expiresAt || expiresAt - approvedAt > twoStageLimits.windowMs) return;
  if(env.WARDROBE_TWO_STAGE_PLAN!==undefined&&!['full-v1','foreground-only-v1','reuse-foreground-v1'].includes(env.WARDROBE_TWO_STAGE_PLAN))return;
  if(env.WARDROBE_TWO_STAGE_PLAN==='reuse-foreground-v1'){
    const foregroundMaskDigest=env.WARDROBE_TWO_STAGE_FOREGROUND_MASK_SHA256??'',foregroundImageSha256=env.WARDROBE_TWO_STAGE_FOREGROUND_IMAGE_SHA256??'';
    if(![foregroundMaskDigest,foregroundImageSha256].every(x=>/^[a-f0-9]{64}$/.test(x)))return;
    return{id,sourceSha256,approvedAt,expiresAt,plan:'reuse-foreground-v1',foregroundMaskDigest,foregroundImageSha256};
  }
  return { id, sourceSha256, approvedAt, expiresAt, ...(env.WARDROBE_TWO_STAGE_PLAN==='foreground-only-v1'?{plan:'foreground-only-v1' as const}:{}) };
}
const reply = (v: unknown, status = 200) => Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
class Invalid extends Error { constructor(public code: string) { super(code); } }
async function body(request: Request) {
  const reader = request.body?.getReader(); if (!reader) throw new Invalid('input');
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > 12 * 1024 * 1024) throw new Invalid('input_too_large'); chunks.push(r.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; } return bytes;
}
function decode(value: unknown) {
  // Reuse the existing linear/canonical decoder. A repeated-group regex here
  // overflowed the JS regexp stack on the real multi-megabyte source photo.
  try{return decodeBoundedBase64(value,6*1024*1024);}catch{throw new Invalid('input');}
}
export async function twoStageApi(request: Request, env: TwoStageEnv, store: Store, options: { now?: () => number; transport?: Transport; timeoutMs?: number } = {}) {
  const now = options.now ?? (() => Date.now()), scope = twoStageScope(env, now()), url = new URL(request.url), stage = url.pathname.slice('/api/two-stage/'.length);
  if (!scope) return reply({ enabled: false, error: 'disabled' }, request.method === 'GET' && stage === 'status' ? 200 : 503);
  if (env.APP_ORIGIN !== url.origin) return reply({ error: 'origin_not_allowed' }, 403);
  const ledger = new TwoStageLedger(store, scope, now);
  const captureConfigured = env.WARDROBE_TWO_STAGE_DIAGNOSTICS === 'operator-response-v1';
  if (request.method === 'GET' && stage === 'status') {
    const audit = await ledger.audit(), pending = Object.values(audit.attempts).some(a => a.state === 'reserved' || a.state === 'unknown');
    const limits=limitsForTwoStage(scope.plan);
    return reply({ enabled: captureConfigured && !audit.halted && !pending && audit.samAttempts + audit.museAttempts < limits.sam+limits.muse, diagnosticCaptureEnabled: captureConfigured, protocol: twoStageProtocol, plan:scope.plan??'full-v1', expiresAt: scope.expiresAt, limits, ...audit });
  }
  if (request.method !== 'POST' || !['foreground', 'skin', 'hair', 'residual', 'discover', 'accessory','reuse-foreground'].includes(stage)) return reply({ error: 'not_found' }, 404);
  if(scope.plan==='foreground-only-v1'&&stage!=='foreground')return reply({error:'stage_not_approved'},403);
  if(scope.plan==='reuse-foreground-v1'&&stage==='foreground'||scope.plan!=='reuse-foreground-v1'&&stage==='reuse-foreground')return reply({error:'stage_not_approved'},403);
  if (request.headers.get('Origin') !== url.origin || request.headers.get('X-Wardrobe-Consent') !== 'two-stage-v1') return reply({ error: 'consent_required' }, 403);
  if (!captureConfigured || request.headers.get('X-Wardrobe-Diagnostic') !== 'operator-response-v1') return reply({ error: 'diagnostic_capture_required' }, 403);
  let reserved = false, completedProvider = false;
  let rejectedMasks: unknown;
  let adapter: MetaAdapters | undefined;
  let diagnosticInputHash: string | undefined;
  // Explicitly gated, request-local envelope sent straight to the operator.
  // Never logged, placed in Durable Object storage or returned by normal APIs.
  const evidence = () => adapter?.capturedSegmentationResponse ? { diagnosticEvidence: { protocol: 'operator-response-v1', inputSha256: diagnosticInputHash, response: adapter.capturedSegmentationResponse, unvalidatedMasks: adapter.capturedSegmentationResponse.credentialRedacted ? [] : adapter.unvalidatedSegmentationMasks ?? [], unsafeForWardrobe: true } } : {};
  try {
    const raw = await body(request); let source: Uint8Array, data: any;
    const originalStage = ['foreground', 'skin', 'hair'].includes(stage);
    if (originalStage) { if (request.headers.get('content-type') !== 'image/png') throw new Invalid('input'); source = raw; }
    else { if (request.headers.get('content-type') !== 'application/json') throw new Invalid('input'); try { data = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new Invalid('input'); } source = decode(data.source); }
    const expectedInput=scope.plan==='reuse-foreground-v1'&&['skin','hair'].includes(stage)?scope.foregroundImageSha256:scope.sourceSha256;
    const size = await validatePng(source); if (source.length > 6 * 1024 * 1024 || Math.max(size.width, size.height) > 1600 || await imageHash(source) !== expectedInput) throw new Invalid('source_not_approved');
    if(stage==='reuse-foreground'){
      if(!Array.isArray(data.foregroundMasks)||await digest(data.foregroundMasks)!==scope.foregroundMaskDigest)throw new Invalid('foreground_not_approved');
      const foreground=decode(data.foregroundImage);if(await imageHash(foreground)!==scope.foregroundImageSha256)throw new Invalid('foreground_not_approved');
      const original=await pngPixels(source),provided=await pngPixels(foreground),expected=composeForegroundPixels(original,data.foregroundMasks);
      if(provided.width!==original.width||provided.height!==original.height||!provided.rgba.every((v,i)=>v===expected.pixels.rgba[i]))throw new Invalid('foreground_not_from_source');
      await ledger.importForeground(await rasterHash(expected.raster),scope.foregroundMaskDigest!,scope.foregroundImageSha256!);
      return reply({reusedForeground:true,sourceSha256:scope.sourceSha256,foregroundImageSha256:scope.foregroundImageSha256,foregroundMaskDigest:scope.foregroundMaskDigest,providerCalls:0});
    }
    let residual: Awaited<ReturnType<typeof prepareResidual>> | undefined;
    if (!originalStage) {
      if (!data.masks || Object.keys(data.masks).sort().join(',') !== 'foreground,hair,skin') throw new Invalid('mask_input');
      const masks = Object.fromEntries(['foreground', 'skin', 'hair'].map(s => { if (!Array.isArray(data.masks[s])) throw new Invalid('mask_input'); return [s, sourceRaster(data.masks[s], size.width, size.height)]; })) as any;
      const known = data.knownTargetMasks === undefined ? undefined : sourceRaster(data.knownTargetMasks, size.width, size.height);
      if (stage === 'residual') {
        if (!data.review || Object.keys(data.review).sort().join(',') !== 'humanPixelsRemoved,itemPixelsPreserved,noUnexpectedClothingLoss') throw new Invalid('review_required');
        const result = await ledger.bindResidual(source, masks, data.review, known);
        return reply({ binding: result.binding, approved: true, note: 'Operator pixel review, not automated semantic proof.' });
      }
      residual = await prepareResidual(source, scope.sourceSha256, masks, known);
    }
    // Do not even inspect the key for disabled/invalid source or residual checks.
    const key = env.MODEL_API_KEY; if (!key) return reply({ error: 'key_not_configured' }, 503);
    const input = originalStage ? source : residual!.image;
    let selected: Awaited<ReturnType<typeof validateManifest>>[number] | undefined;
    if (stage === 'accessory') {
      const items = await validateManifest(data.items, residual!.binding.residualSha256); if (items.length !== 1 || !isTwoStageAccessory(items[0].kind)) throw new Invalid('automatic_target_required');
      selected = items[0]; await ledger.assertSelection(await digest(selected), selected.kind);
    }
    await ledger.reserve(stage as TwoStageStep, input); reserved = true;
    if (stage === 'discover') {
      const result = await discoverPieces(input, residual!.binding.residualSha256, key, request.signal, options.transport, options.timeoutMs);
      const chosen = selectDiscoveredPieces(result.items.filter(p => isTwoStageAccessory(p.kind)), 1)[0];
      await ledger.complete('discover', chosen ? 'completed' : 'empty', chosen ? await digest(chosen) : undefined, chosen?.kind);
      return reply({ items: chosen ? [chosen] : [], usage: result.usage, model: result.model, sourceSha256: scope.sourceSha256, residualSha256: residual!.binding.residualSha256 });
    }
    diagnosticInputHash = await imageHash(input);
    adapter = new MetaAdapters({ approvedLiveMode: true, apiKey: key, bodyMaterialExperiment: twoStageProtocol, operatorCapture: 'operator-response-v1' }, options.transport, options.timeoutMs);
    const concept = originalStage ? twoStageConcepts[stage as keyof typeof twoStageConcepts] : selected!.prompts[0];
    // Text concept only. No hand-provided labels/points; final concept comes from
    // bound automatic discovery. Empty result is not retried with another phrase.
    const masks = await adapter.segment(input, concept, request.signal), raster = sourceRaster(masks, size.width, size.height);
    completedProvider = true;
    if (stage === 'accessory') {
      const pixels = await pngPixels(input);
      if (raster.data.some((v, i) => v === 1 && pixels.rgba[i * 4 + 3] === 0)) { rejectedMasks = masks; throw new Invalid('residual_target_outside_foreground'); }
    }
    await ledger.complete(stage as TwoStageStep, stage === 'foreground' && !masks.length ? 'empty' : 'completed', await rasterHash(raster));
    return reply({ masks, diagnostics: adapter.segmentationDiagnostics, ...evidence(), sourceSha256: scope.sourceSha256, ...(residual ? { residualSha256: residual.binding.residualSha256 } : {}), model: 'sam-3.1', usageEstimatedMicroUsd: 2500, quality: 'unreviewed' });
  } catch (error) {
    if (reserved) await ledger.complete(stage as TwoStageStep, completedProvider || error instanceof ProviderError && error.providerStatus ? 'failed' : 'unknown').catch(() => {});
    const known = error instanceof Error ? error.message : '';
    if (error instanceof Invalid) return reply({ error: error.code, ...evidence(), ...(rejectedMasks ? { rejectedMasks, usageEstimatedMicroUsd: 2500, quality: 'rejected' } : {}) }, 400);
    if (error instanceof ProviderError) return reply({ error: error.code, ...evidence(), ...(error.providerStatus ? { providerStatus: error.providerStatus } : {}), ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }, 502);
    const finite = ['expired', 'halted', 'outcome_uncertain', 'already_attempted', 'stage_order', 'input_not_bound', 'mask_not_bound', 'residual_quality_stop', 'residual_already_bound_or_halted', 'source_mismatch', 'mask_bounds', 'mask_dimensions', 'mask_not_binary', 'mask_limit', 'scope_changed', 'discovery_not_bound','foreground_already_imported_or_started','foreground_not_approved'];
    return reply({ error: finite.includes(known) ? known : 'invalid_input' }, 409);
  }
}
