import type { Item, Profile, Look } from './core';
// Legacy local fallback contracts, NOT an asserted Meta API schema.
// Guarded HTTP browser calls now live in api.ts and server/routes.ts.
export interface SegmentationProvider {
    segment(image: Blob, signal: AbortSignal): Promise<{
        items: Item[];
        model: string;
    }>;
}
export interface ReasoningProvider {
    outfits(items: Item[], profile: Profile, signal: AbortSignal): Promise<Look[]>;
}
export class MetaUnavailable implements SegmentationProvider {
    async segment(_image: Blob, _signal: AbortSignal): Promise<{
        items: Item[];
        model: string;
    }> { throw Error('Meta segmentation is not connected. No image has been sent. Use manual crop or the labeled demo.'); }
}
export const liveProvider = new MetaUnavailable();
