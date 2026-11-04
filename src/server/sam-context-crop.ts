import{MetaAdapters,ProviderError}from'./meta';
import{pngPixels}from'./png-pixels';
import{encodeRgbaPng}from'./encode-png';
import{localizationCrop,cropSourcePixels,sourcePixelToCrop,liftCropMask,type CropView}from'../localization-crop';
import{sourceBox,sourcePoint,type Point}from'../grounding';
import type{DiscoveredPiece}from'../discovery';
export const samViewProtocol='context-crop-v1';
// One SAM request on an exact source-pixel crop. No resize, synthetic pixels,
// extra provider call or fallback is introduced. Returned masks use original coordinates.
export async function segmentContextCrop(adapter:MetaAdapters,bytes:Uint8Array,concept:string,piece:DiscoveredPiece,signal:AbortSignal,spatial:boolean,native?:{positive:Point[];negative:Point[]},context?:CropView){
 const source=await pngPixels(bytes),e=piece.grounding;if(!e)throw new ProviderError('input');
 const points=native??{positive:e.positivePoints.map(p=>sourcePoint(p,source)),negative:e.negativePoints.map(p=>sourcePoint(p,source))};
 let view=context??localizationCrop(source,piece.region,1,256);const box=sourceBox(piece.region,source);
 const all=[...points.positive,...points.negative];if(all.some(p=>!Number.isSafeInteger(p.x)||!Number.isSafeInteger(p.y)||p.x<0||p.y<0||p.x>=source.width||p.y>=source.height))throw new ProviderError('input');
 const left=Math.min(view.left,box.left,...all.map(p=>p.x)),top=Math.min(view.top,box.top,...all.map(p=>p.y)),right=Math.max(view.left+view.width,box.right,...all.map(p=>p.x+1)),bottom=Math.max(view.top+view.height,box.bottom,...all.map(p=>p.y+1));
 view={sourceWidth:source.width,sourceHeight:source.height,left,top,width:right-left,height:bottom-top};
 const image=await encodeRgbaPng(cropSourcePixels(source,view)),local={positive:points.positive.map(p=>sourcePixelToCrop(p,view)),negative:points.negative.map(p=>sourcePixelToCrop(p,view))},norm=(p:Point)=>({x:p.x/view.width*1000,y:p.y/view.height*1000});
 const region={left:Math.floor((box.left-left)/view.width*1000),top:Math.floor((box.top-top)/view.height*1000),right:Math.ceil((box.right-left)/view.width*1000),bottom:Math.ceil((box.bottom-top)/view.height*1000)};
 const evidence={...e,positivePoints:local.positive.map(norm),negativePoints:local.negative.map(norm)};
 try{const masks=await adapter.segment(image,concept,signal,{region,evidence,spatial,nativePoints:local}),lifted=masks.map(m=>liftCropMask(m,view));adapter.parsedSegmentationMasks=lifted;if(adapter.segmentationDiagnostics)adapter.segmentationDiagnostics.view=samViewProtocol;return lifted;}
 catch(error){if(adapter.parsedSegmentationMasks)adapter.parsedSegmentationMasks=adapter.parsedSegmentationMasks.map(m=>liftCropMask(m,view));if(error instanceof ProviderError&&error.diagnostics)error.diagnostics.view=samViewProtocol;throw error;}
}
