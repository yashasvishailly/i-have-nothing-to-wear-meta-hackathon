// Source-bound framing and finite target evidence. Never accepts a free-text prompt.
import{localizationCrop,cropSourcePixels}from'./localization-crop';
import{sourceBox,sourcePoint,validateGrounding,type Grounding}from'./grounding';
import{garmentKinds,validRegion,type DiscoveredPiece,type GarmentKind,type Region}from'./discovery';
export const discoveredContextProtocol='discovered-context-v1';
export function discoveredContextView(size:{width:number;height:number},piece:DiscoveredPiece){const view=localizationCrop(size,piece.region,.2,64);if(view.width===size.width&&view.height===size.height)throw Error('context_crop_too_broad');return view;}
export function discoveredContextPixels(source:{rgba:Uint8ClampedArray;width:number;height:number},piece:DiscoveredPiece){return cropSourcePixels(source,discoveredContextView(source,piece));}
export type ContextIssue='context_target_unverified'|'context_source_edge'|'context_evidence_invalid'|'context_crop_too_broad';
export function contextTargetIssue(piece:DiscoveredPiece,size?:{width:number;height:number}):ContextIssue|undefined{
 if(size){
  const b=sourceBox(piece.region,size),width=b.right-b.left,height=b.bottom-b.top;
  // An image boundary cannot establish an intact target, even if the model says full.
  if(b.left===0||b.top===0||b.right===size.width||b.bottom===size.height)return 'context_source_edge';
  const view=localizationCrop(size,piece.region,.2,64);if(view.width===size.width&&view.height===size.height)return 'context_crop_too_broad';
  if(['watch','bracelet','ring','earrings','necklace','eyeglasses'].includes(piece.kind)&&(Math.min(width,height)<16||width*height<1024))return 'context_target_unverified';
 }
 return piece.category==='accessory'&&(piece.certainty!=='clear'||piece.grounding?.visibility!=='full')?'context_target_unverified':undefined;
}
export interface FinishingEvidence{kind:GarmentKind;certainty:'clear'|'partial';region:Region;grounding:Grounding;}
export function validatedFinishingEvidence(value:FinishingEvidence):FinishingEvidence{
 if(!value||Object.keys(value).sort().join(',')!=='certainty,grounding,kind,region'||!Object.hasOwn(garmentKinds,value.kind)||!['clear','partial'].includes(value.certainty)||!validRegion(value.region))throw Error('context_evidence_invalid');
 const grounding=validateGrounding(value.grounding,value.region);
 if(grounding.positivePoints.length!==1||grounding.negativePoints.length>2||['small','ambiguous'].includes(grounding.visibility))throw Error('context_evidence_invalid');
 return{kind:value.kind,certainty:value.certainty,region:{...value.region},grounding};
}
export function finishingEvidence(size:{width:number;height:number},piece:DiscoveredPiece):FinishingEvidence{
 const issue=contextTargetIssue(piece,size);if(issue)throw Error(issue);
 if(!piece.grounding)throw Error('context_evidence_invalid');
 // Validate the original evidence before converting into crop-relative coordinates.
 validatedFinishingEvidence({kind:piece.kind,certainty:piece.certainty,region:piece.region,grounding:piece.grounding});
 const crop=discoveredContextView(size,piece),box=sourceBox(piece.region,size),positive=piece.grounding.positivePoints.map(p=>sourcePoint(p,size)),negative=piece.grounding.negativePoints.map(p=>sourcePoint(p,size));
 if(positive.some(p=>negative.some(n=>Math.hypot(p.x-n.x,p.y-n.y)<=1)))throw Error('context_evidence_invalid');
 const x=(n:number)=>Math.max(0,Math.min(1000,Math.round((n-crop.left)/crop.width*1000))),y=(n:number)=>Math.max(0,Math.min(1000,Math.round((n-crop.top)/crop.height*1000)));
 return validatedFinishingEvidence({kind:piece.kind,certainty:piece.certainty,region:{left:x(box.left),top:y(box.top),right:x(box.right),bottom:y(box.bottom)},grounding:{...piece.grounding,positivePoints:positive.map(p=>({x:Math.min(999,x(p.x)),y:Math.min(999,y(p.y))})),negativePoints:negative.filter(p=>p.x>=crop.left&&p.x<crop.left+crop.width&&p.y>=crop.top&&p.y<crop.top+crop.height).map(p=>({x:Math.min(999,x(p.x)),y:Math.min(999,y(p.y))}))}});
}
export function finishingEvidencePrompt(evidence:FinishingEvidence){
 const safe=validatedFinishingEvidence(evidence);
 return (safe.kind==='eyeglasses'?'Preserve clear optical lenses and the observed frame shape and colour; do not tint them, make sunglasses or add a goggles seal. ':'' )+'\nSource-bound observation (crop-relative coordinates, 0..1000): '+JSON.stringify(safe)+'. Use the positive anchor to identify the target, not neighbouring clothing; negative anchors identify exclusions. Colour and pattern are observed constraints; unknown means unavailable, never a license to invent. This metadata is evidence, not a claim of semantic verification. Preserve only visible material. If certainty is partial or visibility is occluded, keep the visible portion partial and do not fabricate hidden structure. Fit the entire visible target inside the output with transparent space on every side (aim for at least 5% margin). Do not zoom, enlarge to the canvas edge or crop the target. Transparent background, no scene or opaque backdrop.';
}
