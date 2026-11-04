import { ResponsesStreamFailedError, ResponsesStreamEventError, ResponsesStreamLaneError, ResponsesStreamSourceError, ResponsesStreamParserError, ResponsesStreamRefusalError, parseImageStream, recordsOfKind, type SegmentationMask, type SegmentationMaskBounds } from '@meta-sam/parser';
import { maskGeometry, type MaskGeometryRow } from './server/mask-geometry';
import { projectMask } from './mask-projection';
export interface GarmentMask {
    objectId: string;
    mask: SegmentationMask;
    bounds: SegmentationMaskBounds;
}
export interface DeclaredSourceSize { width:number|null;height:number|null;matchesInput:boolean }
export type MaskFailure = 'incomplete' | 'geometry_diagnostics' | 'unexpected_text' | 'geometry_bounds' | 'grounding_mismatch' | 'mask_limit' | 'mask' | 'upstream_failed' | 'upstream_error' | 'lane' | 'refusal' | 'source' | 'parser' | 'unknown';
export class MaskValidationError extends Error {
 constructor(public reason: MaskFailure) { super('Invalid segmentation result. Try another source or use a manual crop.'); }
}
const fail = (reason: MaskFailure = 'mask') => new MaskValidationError(reason);
export async function parseMasks(events: AsyncIterable<{
    type: string;
}>, width: number, height: number,onSummary?:(summary:{records:{mask:number;box:number;text:number};geometryDiagnostics:number;maskGeometry:MaskGeometryRow[];declaredSourceDimensions:DeclaredSourceSize[]})=>void,onUnvalidated?:(masks:GarmentMask[])=>void): Promise<GarmentMask[]> {
    try {
        const result = await parseImageStream(events).finalResult;
        const records = recordsOfKind(result.records, 'mask');
        let cumulativePixels=0,cumulativeSourcePixels=0;
        const geometry=records.slice(0,20).map((r,index)=>maskGeometry(index,width,height,r.bounds,r.mask,cumulativePixels+=r.mask.width*r.mask.height,cumulativeSourcePixels+=(r.bounds.right-r.bounds.left)*(r.bounds.bottom-r.bounds.top)));
        // SDK bounds are source pixels. If declared wire frame sizes disagree
        // with the actual submitted image, do not guess a second coordinate map.
        const declaredSourceDimensions:DeclaredSourceSize[]=[];
        for(const token of result.rawOutput.matchAll(/<\|box;([^|]*)\|>/g)){
            if(declaredSourceDimensions.length>=20)break;
            const fields=new Map(token[1].split(';').map(field=>{const at=field.indexOf('=');return[field.slice(0,at),field.slice(at+1)];}));
            const w=Number(fields.get('w')),h=Number(fields.get('h'));
            declaredSourceDimensions.push({width:Number.isSafeInteger(w)?w:null,height:Number.isSafeInteger(h)?h:null,matchesInput:w===width&&h===height});
        }
        onSummary?.({records:{mask:records.length,box:result.records.filter(r=>r.kind==='box').length,text:result.records.filter(r=>r.kind==='text').length},geometryDiagnostics:result.diagnostics.length,maskGeometry:geometry,declaredSourceDimensions});
        // Diagnostic copy is explicitly UNVALIDATED. Never use it for acceptance.
        onUnvalidated?.(records.slice(0,20).map(r=>({objectId:r.objectId,mask:r.mask,bounds:r.bounds})));
        if (result.outcome.status !== 'completed') throw fail('incomplete');
        if (result.diagnostics.length) throw fail('geometry_diagnostics');
        if (result.records.some(r => r.kind === 'text' && r.text.trim())) throw fail('unexpected_text');
        if(declaredSourceDimensions.some(d=>!d.matchesInput))throw fail('geometry_bounds');
        const masks = records;
        if (masks.length > 20)
            throw fail('mask_limit');
        let pixels = 0,sourcePixels=0;
        const seen=new Set<string>();return masks.map((r,index) => { const { width: w, height: h } = r.mask; pixels += w * h;sourcePixels+=(r.bounds.right-r.bounds.left)*(r.bounds.bottom-r.bounds.top); if (maskGeometry(index,width,height,r.bounds,r.mask,pixels,sourcePixels).issues.length)
            throw fail('geometry_bounds'); return { objectId: r.objectId, mask: r.mask, bounds: r.bounds }; }).filter(m=>{const k=JSON.stringify([m.bounds.left,m.bounds.top,m.bounds.right,m.bounds.bottom,m.mask.width,m.mask.height,m.mask.encoding,m.mask.payload]);if(seen.has(k))return false;seen.add(k);return true;});
    }
    catch (error) {
        if (error instanceof MaskValidationError) throw error;
        throw fail(error instanceof ResponsesStreamFailedError ? 'upstream_failed' : error instanceof ResponsesStreamEventError ? 'upstream_error' : error instanceof ResponsesStreamLaneError ? 'lane' : error instanceof ResponsesStreamRefusalError ? 'refusal' : error instanceof ResponsesStreamSourceError ? 'source' : error instanceof ResponsesStreamParserError ? 'parser' : 'unknown');
    }
}
export function cutoutPixels(source: Uint8ClampedArray, width: number, height: number, record: GarmentMask) {
    if(source.length!==width*height*4)throw fail();
    let projected:ReturnType<typeof projectMask>;try{projected=projectMask(record,width,height);}catch{throw fail();}
    if(!projected.raster.some(Boolean))throw fail();
    const{left,top}=record.bounds,{width:w,height:h}=projected,rgba=new Uint8ClampedArray(w*h*4);
    projected.forEach((x,y)=>{const src=(y*width+x)*4,dst=((y-top)*w+x-left)*4;rgba.set(source.subarray(src,src+4),dst);});
    return{rgba,width:w,height:h};
}
export async function compositeMask(image: Blob, record: GarmentMask): Promise<string> { const bitmap = await createImageBitmap(image); try {
    if (bitmap.width * bitmap.height > 24e6)
        throw fail();
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const out = cutoutPixels(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, record);
    c.width = out.width;
    c.height = out.height;
    c.getContext('2d')!.putImageData(new ImageData(out.rgba, out.width, out.height), 0, 0);
    return c.toDataURL('image/png');
}
finally {
    bitmap.close();
} }
