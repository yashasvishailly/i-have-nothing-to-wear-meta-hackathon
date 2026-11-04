import { MetaAdapters, ProviderError, type Transport } from './meta';
import { validatePng } from './png';
import { isConcept, conceptCategories } from '../concepts';
import { eligible, type Item, type Profile } from '../core';

export interface MetaEnvironment {
  WARDROBE_SEGMENT_DIAGNOSTICS?:string;
  MODEL_API_KEY?: string;
  WARDROBE_APPROVED_CONCEPTS?: string;
  WARDROBE_LIVE_MODE?: string;
  WARDROBE_APPROVED_IMAGE_SHA256?: string;
  WARDROBE_APPROVAL_EXPIRES_AT?: string;
  WARDROBE_MAX_CALLS?: string;
  WARDROBE_ALLOW_REASONING?: string;
}
const IMAGE_LIMIT = 8 * 1024 * 1024;
const JSON_LIMIT = 65536;
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
class InputError extends Error { constructor(public code: string, public status = 400) { super(code); } }
export async function imageHash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
async function bytes(request: Request, max: number): Promise<Uint8Array> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > max)) throw new InputError('too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('empty_body');
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      request.signal.throwIfAborted();
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > max) throw new InputError('too_large', 413);
      parts.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(k => keys.includes(k)) && keys.every(k => Object.hasOwn(value, k));
}
function inventoryInput(value: unknown): { items: Item[]; profile: Profile } {
  if (!exactKeys(value, ['items', 'profile']) || !Array.isArray(value.items) || value.items.length > 200 ||
      !exactKeys(value.profile, ['occasion', 'style', 'noHeels', 'noSleeveless'])) throw new InputError('invalid_inventory');
  const p = value.profile;
  if (!['Dinner', 'Everyday', 'Work', 'Weekend'].includes(String(p.occasion)) || !['Relaxed', 'Minimal', 'Playful'].includes(String(p.style)) ||
      typeof p.noHeels !== 'boolean' || typeof p.noSleeveless !== 'boolean') throw new InputError('invalid_profile');
  const seen = new Set<string>();
  const items = value.items.map(raw => {
    if (!exactKeys(raw, ['id', 'name', 'category', 'confirmed', 'available', 'heels', 'sleeveless']) ||
        typeof raw.id !== 'string' || !raw.id.length || raw.id.length > 80 || seen.has(raw.id) ||
        typeof raw.name !== 'string' || raw.name.length > 80 || !['top', 'bottom', 'dress', 'shoes', 'layer', 'accessory'].includes(String(raw.category)) ||
        typeof raw.confirmed !== 'boolean' || typeof raw.available !== 'boolean' ||
        ![true, false, null].includes(raw.heels as boolean | null) || ![true, false, null].includes(raw.sleeveless as boolean | null)) throw new InputError('invalid_inventory');
    seen.add(raw.id);
    return { ...raw, sourceId: '', image: '', partial: false, demo: false } as unknown as Item;
  });
  return { items, profile: p as unknown as Profile };
}
export interface DurableBudget {
  used: number;
  reserve(id: string, concept?: string): Promise<'ok' | 'duplicate_request' | 'call_limit' | 'request_in_progress' | 'approval_changed' | 'concept_not_approved' | 'duplicate_concept'>;
  release(id: string): Promise<void>;
}
/** Hosted mode requires a durable reservation gate; incomplete configuration fails closed. */
export function createMetaApi(env: MetaEnvironment = {}, options: { transport?: Transport; now?: () => number; hosted?: boolean; budget?: DurableBudget; timeoutMs?: number } = {}) {
  const now = options.now ?? Date.now;
  const requested = (!options.hosted || !!options.budget) && env.WARDROBE_LIVE_MODE === 'approved';
  const expires = requested ? Date.parse(env.WARDROBE_APPROVAL_EXPIRES_AT ?? '') : NaN;
  const max = requested ? Number(env.WARDROBE_MAX_CALLS) : 0;
  const hashes = new Set(requested ? (env.WARDROBE_APPROVED_IMAGE_SHA256 ?? '').split(',').map(s => s.trim()).filter(Boolean) : []);
  const approvedConcepts=env.WARDROBE_APPROVED_CONCEPTS===undefined?null:new Set(env.WARDROBE_APPROVED_CONCEPTS.split(','));
  const conceptsValid=approvedConcepts===null||(approvedConcepts.size>0&&[...approvedConcepts].every(isConcept));
  const scopeValid = conceptsValid && requested && Number.isInteger(max) && max >= 1 && max <= (options.hosted ? 7 : 10) &&
    expires > now() && expires <= now() + 60 * 60 * 1000 && hashes.size >= 1 && hashes.size <= 32 && [...hashes].every(h => /^[a-f0-9]{64}$/.test(h));
  // Do not even inspect the key unless the nonsecret live gate is complete.
  const apiKey = scopeValid ? env.MODEL_API_KEY ?? '' : '';
  const configured = scopeValid && apiKey.length > 0;
  const reasoning = configured && env.WARDROBE_ALLOW_REASONING === 'approved';
  const adapter = new MetaAdapters({ approvedLiveMode: configured, apiKey }, options.transport, options.timeoutMs);
  let used = options.budget?.used ?? 0, active = false; const requestIds = new Set<string>();
  const enabled = () => configured && now() < expires && used < max;
  const status = () => ({ segmentation: enabled() ? (options.hosted ? 'approved-hosted-trial' : 'approved-local-session') : 'disabled', reasoning: enabled() && reasoning ? 'approved-local-session' : 'local-rules',
    uploadsEnabled: enabled(), reasoningEnabled: enabled() && reasoning, remainingCalls: configured ? Math.max(0, max - used) : 0,
    approvalExpiresAt: configured ? new Date(expires).toISOString() : null, maxImageBytes: IMAGE_LIMIT, concepts: approvedConcepts?[...approvedConcepts]:Object.keys(conceptCategories),
    note: options.hosted ? 'Hosted trial requires exact approved photo bytes and an explicit durable attempt cap; not a monetary billing cap.' : 'Approval and counters apply to this server process only; not a monetary billing cap.' });
  async function reserve(request: Request, concept?: string) {
    if (!enabled()) throw new InputError(configured && used >= max ? 'call_limit' : 'live_disabled', configured && used >= max ? 429 : 503);
    if (active) throw new InputError('request_in_progress', 409);
    const id = request.headers.get('x-wardrobe-request-id') ?? '';
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(id)) throw new InputError('invalid_request_id');
    if (requestIds.has(id)) throw new InputError('duplicate_request', 409);
    request.signal.throwIfAborted();
    if (options.budget) {
      const result = await options.budget.reserve(id,concept);
      if (result !== 'ok') throw new InputError(result, result === 'call_limit' ? 429 : 409);
    }
    requestIds.add(id); used++; active = true;
  }
  return { status, async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api/status' && request.method === 'GET') return json(status());
    if (!['/api/segment', '/api/outfits'].includes(path)) return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!configured || now() >= expires) return json({ error: 'live_disabled' }, 503);
    if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'origin_not_allowed' }, 403);
    let reserved = false;
    try {
      if (path === '/api/segment') {
        if (request.headers.get('x-wardrobe-consent') !== 'image-v1') throw new InputError('image_consent_required', 403);
        if (request.headers.get('content-type')?.split(';')[0] !== 'image/png') throw new InputError('png_required', 415);
        const concept = request.headers.get('x-wardrobe-concept'); if (!isConcept(concept)) throw new InputError('invalid_concept');
        if(approvedConcepts&&!approvedConcepts.has(concept))throw new InputError('concept_not_approved',403);
        const png = await bytes(request, IMAGE_LIMIT); await validatePng(png);
        const hash = await imageHash(png);
        if (request.headers.get('x-wardrobe-image-sha256') !== hash || !hashes.has(hash)) throw new InputError('photo_not_approved', 403);
        await reserve(request,concept); reserved = true;
        const masks = await adapter.segment(png, concept, request.signal);
        return json({ masks, model: 'sam-3.1', concept, imageSha256: hash, reconstruction: false,...(env.WARDROBE_SEGMENT_DIAGNOSTICS==='counts-v1'&&concept==='blazer'?{diagnostics:adapter.segmentationDiagnostics}: {}) });
      }
      if (!reasoning) throw new InputError('reasoning_not_approved', 403);
      if (request.headers.get('x-wardrobe-consent') !== 'metadata-v1') throw new InputError('metadata_consent_required', 403);
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new InputError('json_required', 415);
      let value: unknown; try { value = JSON.parse(new TextDecoder().decode(await bytes(request, JSON_LIMIT))); } catch (e) { if (e instanceof InputError) throw e; throw new InputError('invalid_json'); }
      const { items, profile } = inventoryInput(value);
      const categories=eligible(items,profile).map(i=>i.category);
      if(!categories.includes('shoes')||(!categories.includes('dress')&&!(categories.includes('top')&&categories.includes('bottom'))))throw new InputError('insufficient_inventory');
      await reserve(request); reserved = true;
      return json({ looks: await adapter.outfits(items, profile, request.signal), model: 'muse-spark-1.3' });
    } catch (e) {
      if (e instanceof InputError) return json({ error: e.code }, e.status);
      if (request.signal.aborted) return json({ error: 'cancelled' }, 408);
      if (e instanceof ProviderError) return json({ error: e.code, ...(e.providerStatus ? { providerStatus: e.providerStatus } : {}), ...(e.diagnostics ? { diagnostics:e.diagnostics } : {}) }, e.code === 'input' ? 400 : e.code === 'timeout' ? 504 : e.code === 'rate_limit' ? 429 : e.code === 'disabled' ? 503 : 502);
      return json({ error: 'invalid_request' }, 400);
    } finally { if (reserved) { active = false; await options.budget?.release(request.headers.get('x-wardrobe-request-id') ?? '').catch(() => {}); } }
  } };
}
