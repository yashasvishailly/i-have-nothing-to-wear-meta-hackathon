import type { Item, Profile, Look } from './core';
import type { Concept } from './concepts';
import type { GarmentMask } from './masks';
export interface ApiStatus { uploadsEnabled: boolean; reasoningEnabled: boolean; remainingCalls: number; approvalExpiresAt: string | null; }
export const disabledStatus = (): ApiStatus => ({ uploadsEnabled: false, reasoningEnabled: false, remainingCalls: 0, approvalExpiresAt: null });
export class ApiError extends Error { constructor(public code: string) { super(code); } }
export const apiErrorText = (code: string) => ({ concept_not_approved: 'This category is outside the approved trial. No Meta call was made.', duplicate_concept: 'This category was already attempted in this trial. No repeat request was sent.', insufficient_inventory: 'Confirm an available dress or top and bottom, plus suitable shoes, before asking Meta.', too_large: 'The normalized photo or inventory is too large. Choose a smaller photo or fewer pieces.', input: 'The normalized photo could not be validated. Choose another image or use manual crop.', live_disabled: 'Live Meta requests are disabled. No automatic retry was made.', image_consent_required: 'Approve this photo request first.', metadata_consent_required: 'Approve sending the inventory details first.', photo_not_approved: 'This normalized photo is outside the approved session. No Meta call was made.', call_limit: 'The approved call limit has been reached.', request_in_progress: 'A request is already running. Wait or cancel it.', duplicate_request: 'This request has already been submitted. It was not sent again.', authentication: 'Meta authorization failed. Check access privately; no automatic retry was made.', rate_limit: 'Meta rate limit reached. No automatic retry was made.', timeout: 'The request timed out. It may still be charged; no automatic retry was made.', cancelled: 'Cancelled locally. A request already sent may still be charged.', reasoning_not_approved: 'This session has not approved Meta outfit reasoning.', invalid_output: 'The result could not be verified. Keep the source and use manual review.', invalid_inventory: 'The inventory details could not be verified.', unavailable: 'Meta is unavailable. No automatic retry was made.' } as Record<string, string>)[code] ?? 'The request failed safely. No automatic retry was made.';
export async function photoHash(blob: Blob) { const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join(''); }
export const inventoryMetadata = (items: Item[]) => items.map(({ id, name, category, confirmed, available, heels, sleeveless }) => ({ id, name, category, confirmed, available, heels, sleeveless }));
async function boundedJson(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw new ApiError('invalid_output');
  const parts: Uint8Array[] = []; let size = 0;
  try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > 9 * 1024 * 1024) throw new ApiError('invalid_output'); parts.push(r.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const p of parts) { bytes.set(p, offset); offset += p.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ApiError('invalid_output'); }
}
export async function getApiStatus(transport: typeof fetch = fetch): Promise<ApiStatus> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
  try { const response = await transport('/api/status', { signal: controller.signal, cache: 'no-store' }); if (!response.ok) return disabledStatus(); const s = await boundedJson(response);
    if (typeof s.uploadsEnabled !== 'boolean' || typeof s.reasoningEnabled !== 'boolean' || !Number.isInteger(s.remainingCalls) || s.remainingCalls < 0 || s.remainingCalls > 10) return disabledStatus();
    return { uploadsEnabled: s.uploadsEnabled, reasoningEnabled: s.reasoningEnabled, remainingCalls: s.remainingCalls, approvalExpiresAt: typeof s.approvalExpiresAt === 'string' ? s.approvalExpiresAt : null };
  } catch { return disabledStatus(); } finally { clearTimeout(timer); }
}
async function call(path: string, body: BodyInit, headers: Record<string, string>, outer: AbortSignal, transport: typeof fetch) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 35000), signal = AbortSignal.any([outer, controller.signal]);
  try { const response = await transport(path, { method: 'POST', body, headers: { ...headers, 'X-Wardrobe-Request-Id': crypto.randomUUID() }, signal, redirect: 'error', cache: 'no-store' }); const value = await boundedJson(response);
    if (!response.ok) throw new ApiError(typeof value.error === 'string' ? value.error : 'unavailable'); return value;
  } catch (e) { if (outer.aborted) throw new ApiError('cancelled'); if (signal.aborted) throw new ApiError('timeout'); if (e instanceof ApiError) throw e; throw new ApiError('unavailable'); }
  finally { clearTimeout(timer); }
}
export async function segmentPhoto(blob: Blob, concept: Concept, hash: string, consent: boolean, signal: AbortSignal, transport: typeof fetch = fetch): Promise<GarmentMask[]> {
  if (!consent) throw new ApiError('image_consent_required');
  const result = await call('/api/segment', blob, { 'Content-Type': 'image/png', 'X-Wardrobe-Concept': concept, 'X-Wardrobe-Image-Sha256': hash, 'X-Wardrobe-Consent': 'image-v1' }, signal, transport);
  if (!result || result.model !== 'sam-3.1' || result.imageSha256 !== hash || !Array.isArray(result.masks) || result.masks.length > 20) throw new ApiError('invalid_output');
  return result.masks;
}
export async function requestOutfits(items: Item[], profile: Profile, consent: boolean, signal: AbortSignal, transport: typeof fetch = fetch): Promise<Look[]> {
  if (!consent) throw new ApiError('metadata_consent_required');
  const result = await call('/api/outfits', JSON.stringify({ items: inventoryMetadata(items), profile }), { 'Content-Type': 'application/json', 'X-Wardrobe-Consent': 'metadata-v1' }, signal, transport);
  if (!result || result.model !== 'muse-spark-1.3' || !Array.isArray(result.looks) || result.looks.length > 3) throw new ApiError('invalid_output'); return result.looks;
}
