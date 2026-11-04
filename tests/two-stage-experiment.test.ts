import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareResidual, rasterHash, sourceRaster, TwoStageLedger, twoStageLimits, type Raster } from '../src/server/two-stage-experiment';
import { syntheticPng } from './fixtures/synthetic-png';
import { imageHash } from '../src/server/routes';
import { pngPixels } from '../src/server/png-pixels';
import { parseMasks } from '../src/masks';
import type { Store } from '../src/server/hosted';

// Synthetic pixel fixtures are only algebra/control tests, not body segmentation.
class Memory implements Store {
  data = new Map<string, unknown>(); tail = Promise.resolve();
  async get<T>(k: string) { return structuredClone(this.data.get(k)) as T | undefined; }
  async put<T>(k: string, v: T) { this.data.set(k, structuredClone(v)); }
  async transaction<T>(fn: (s: Store) => Promise<T>) {
    const old = this.tail; let done!: () => void;
    this.tail = new Promise(r => done = r); await old;
    const snapshot = structuredClone(this.data);
    try { return await fn(this); } catch (e) { this.data = snapshot; throw e; } finally { done(); }
  }
}
const source = syntheticPng(16, 16), start = 1_800_000_000_000;
const review = { itemPixelsPreserved: true, humanPixelsRemoved: true, noUnexpectedClothingLoss: true };
const raster = (fn: (i: number) => boolean): Raster => ({ width: 16, height: 16, data: Uint8Array.from({ length: 256 }, (_, i) => +fn(i)) });
const masks = () => ({ foreground: raster(() => true), skin: raster(i => i % 16 === 0), hair: raster(i => i < 16) });
async function setup(store = new Memory()) {
  const scope = { id: 'two-stage-offline-fixture', sourceSha256: await imageHash(source), approvedAt: start, expiresAt: start + twoStageLimits.windowMs };
  return { store, scope, ledger: new TwoStageLedger(store, scope, () => start + 1) };
}
async function completedMasks(ledger: TwoStageLedger, m = masks()) {
  for (const stage of ['foreground', 'skin', 'hair'] as const) {
    await ledger.reserve(stage, source); await ledger.complete(stage, 'completed', await rasterHash(m[stage]));
  }
}
test('two-pass algebra preserves exact surviving source pixels, makes removed pixels transparent and never fills holes', async () => {
  const original = new Uint8Array(source), m = masks(), r = await prepareResidual(source, await imageHash(source), m);
  assert.equal(r.stop, 'visual_check_required'); assert.equal(r.binding.removedPixels, 31); assert.equal(r.binding.remainingPixels, 225);
  const before = await pngPixels(source), after = await pngPixels(r.image);
  for (let i = 0; i < 256; i++) assert.deepEqual(after.rgba.slice(i * 4, i * 4 + 4), m.skin.data[i] || m.hair.data[i] ? new Uint8ClampedArray(4) : before.rgba.slice(i * 4, i * 4 + 4));
  assert.deepEqual(new Uint8Array(source), original);
});
test('mask dimensions, binary values, source hash and unknown body conflicts fail closed without colour thresholds', async () => {
  const sha = await imageHash(source), m = masks();
  await assert.rejects(prepareResidual(source, '0'.repeat(64), m), /source_mismatch/);
  await assert.rejects(prepareResidual(source, sha, { ...m, hair: { ...m.hair, width: 15 } }), /mask_dimensions/);
  const bad = masks(); bad.skin.data[50] = 2; await assert.rejects(prepareResidual(source, sha, bad), /mask_not_binary/);
  const conflict = await prepareResidual(source, sha, m, raster(i => i === 0));
  assert.equal(conflict.stop, 'target_overlap_uncertain'); assert.equal(conflict.binding.targetConflictPixels, 1);
  assert.equal((await prepareResidual(source, sha, { ...m, foreground: raster(() => false) })).stop, 'empty_foreground');
  assert.equal((await prepareResidual(source, sha, { ...m, skin: raster(() => true) })).stop, 'empty_residual');
  assert.equal((await prepareResidual(source, sha, { ...m, skin: raster(() => false), hair: raster(() => false) })).stop, 'no_human_material_removed');
});
test('official parsed masks are lifted to a source union without expanding boxes or interpreting tissue colours', async () => {
  const text = readFileSync(new URL('./fixtures/sam-button.txt', import.meta.url), 'utf8').trim();
  async function* events() { yield { type: 'response.output_text.done', item_id: 'f', output_index: 0, content_index: 0, text }; yield { type: 'response.completed' }; }
  const records = await parseMasks(events(), 320, 334), r = sourceRaster(records, 320, 334);
  assert.ok(r.data.some(Boolean)); assert.ok(r.data.some(v => v === 0));
  assert.deepEqual(sourceRaster([...records, ...records], 320, 334), r);
  assert.equal(sourceRaster([], 320, 334).data.some(Boolean), false);
  assert.throws(() => sourceRaster(records, 10, 10), /mask_bounds/);
});
test('exact five-stage ceiling persists across controller restarts; no retries, extra OpenAI or reselection', async () => {
  const { store, scope, ledger } = await setup(); await completedMasks(ledger);
  const r = await ledger.bindResidual(source, masks(), review);
  const resumed = new TwoStageLedger(store, scope, () => start + 2);
  await resumed.reserve('discover', r.image); await resumed.complete('discover', 'completed', 'b'.repeat(64), 'sunglasses');
  await resumed.reserve('accessory', r.image); await resumed.complete('accessory', 'completed', 'c'.repeat(64));
  await assert.rejects(resumed.reserve('accessory', r.image), /already_attempted/);
  await assert.rejects(resumed.reserve('foreground', source), /already_attempted/);
  await assert.rejects(resumed.reserve('finish' as any, source), /invalid_stage/);
  assert.equal(Object.keys((await store.get<any>(scope.id)).attempts).length, 5);
  assert.equal(twoStageLimits.openai, 0);
});
test('source and derived image are independently bound; altered masks or residual cannot dispatch', async () => {
  const { ledger } = await setup(); await assert.rejects(ledger.reserve('skin', source), /stage_order/);
  await assert.rejects(ledger.reserve('foreground', syntheticPng(17, 16)), /input_not_bound/);
  await completedMasks(ledger);
  const changed = masks(); changed.skin.data[17] = 1;
  await assert.rejects(ledger.bindResidual(source, changed, review), /mask_not_bound/);
  const r = await ledger.bindResidual(source, masks(), review);
  await assert.rejects(ledger.reserve('discover', source), /input_not_bound/);
  const tampered = new Uint8Array(r.image); tampered[tampered.length - 1] ^= 1;
  await assert.rejects(ledger.reserve('discover', tampered), /input_not_bound/);
});
test('automatic discovery must return a supported accessory, never a body concept; Worker retains explicit scope gating', async () => {
  const { ledger } = await setup(); await completedMasks(ledger);
  const r = await ledger.bindResidual(source, masks(), review); await ledger.reserve('discover', r.image);
  await assert.rejects(ledger.complete('discover', 'completed', 'a'.repeat(64), 'person'), /automatic_target_missing/);
  await assert.rejects(ledger.complete('discover', 'completed', 'a'.repeat(64), 'shirt'), /automatic_target_missing/);
  await ledger.complete('discover', 'unknown');
  await assert.rejects(ledger.reserve('accessory', r.image), /halted/);
  assert.equal(readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8').includes('twoStageScope(env)'), true);
});
test('quality stop is durably committed even with real transaction rollback semantics', async () => {
  const { ledger, store, scope } = await setup(); await completedMasks(ledger);
  await assert.rejects(ledger.bindResidual(source, masks(), { ...review, itemPixelsPreserved: false }), /residual_quality_stop/);
  assert.equal((await store.get<any>(scope.id)).halted, true);
  await assert.rejects(ledger.reserve('discover', source), /halted/);
  await assert.rejects(ledger.bindResidual(source, masks(), review), /residual_already_bound_or_halted/);
});
test('known accessory overlap cannot be rescued by a positive semantic review', async () => {
  const { ledger } = await setup(); await completedMasks(ledger);
  await assert.rejects(ledger.bindResidual(source, masks(), review, raster(i => i === 0)), /residual_quality_stop/);
});
test('concurrent reservations consume a stage once, and unresolved dispatch survives a controller restart', async () => {
  const { ledger, store, scope } = await setup();
  const concurrent = await Promise.allSettled([ledger.reserve('foreground', source), ledger.reserve('foreground', source)]);
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
  const resumed = new TwoStageLedger(store, scope, () => start + 3);
  await assert.rejects(resumed.reserve('foreground', source), /outcome_uncertain/);
  await resumed.complete('foreground', 'unknown');
  await assert.rejects(resumed.reserve('skin', source), /halted/);
});
test('failed/empty foreground outcomes stop, immutable expiry cannot reset counters', async () => {
  for (const state of ['failed', 'empty'] as const) {
    const { ledger } = await setup(); await ledger.reserve('foreground', source); await ledger.complete('foreground', state);
    await assert.rejects(ledger.reserve('skin', source), /halted/);
  }
  const { ledger, store, scope } = await setup(); await ledger.reserve('foreground', source); await ledger.complete('foreground', 'completed', await rasterHash(masks().foreground));
  const extended = new TwoStageLedger(store, { ...scope, approvedAt: start + 1, expiresAt: scope.expiresAt + 1 }, () => start + 2);
  await assert.rejects(extended.reserve('skin', source), /scope_changed/);
  const expired = new TwoStageLedger(store, scope, () => scope.expiresAt);
  await assert.rejects(expired.reserve('skin', source), /expired/);
  assert.throws(() => new TwoStageLedger(store, { ...scope, expiresAt: scope.expiresAt + 1 }), /invalid_scope/);
});
test('incomplete visual review, absent human removal and all-foreground deletion cannot authorize discovery', async () => {
  for (const variant of ['review', 'empty', 'unchanged'] as const) {
    const { ledger } = await setup(), m = masks();
    if (variant === 'empty') m.skin = raster(() => true);
    if (variant === 'unchanged') { m.skin = raster(() => false); m.hair = raster(() => false); }
    await completedMasks(ledger, m);
    await assert.rejects(ledger.bindResidual(source, m, variant === 'review' ? {} as any : review), /residual_quality_stop/);
  }
});
test('one-SAM diagnostic stage restriction is durable and cannot widen to the five-call plan',async()=>{
  const{store,scope}=await setup(),ledger=new TwoStageLedger(store,{...scope,plan:'foreground-only-v1'},()=>start+1);
  await ledger.reserve('foreground',source);await ledger.complete('foreground','completed',await rasterHash(masks().foreground));
  for(const stage of ['skin','hair','discover','accessory']as const)await assert.rejects(ledger.reserve(stage,source),/stage_not_approved/);
  const wider=new TwoStageLedger(store,scope,()=>start+2);await assert.rejects(wider.reserve('skin',source),/scope_changed/);
});
