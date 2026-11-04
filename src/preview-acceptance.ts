import type{Item}from './core';
// Only call after a finished output has passed the existing byte/pixel checks.
// Usable by default is a product choice, not a claim of semantic fidelity.
export function acceptFinishedPreview(item:Item){
 if(!item.reconstruction||item.previewDecision==='set-aside')return false;
 if(item.extraction!=='model-source-crop'&&!item.reviewNeeded&&item.confirmed&&item.useReconstruction&&item.reconstruction.confirmed)return false;
 const changed=!item.confirmed||!!item.reviewNeeded||!item.useReconstruction||!item.reconstruction.confirmed||item.previewDecision!=='automatic';
 item.confirmed=true;item.reviewNeeded=false;item.useReconstruction=true;item.reconstruction.confirmed=true;item.previewDecision='automatic';
 return changed;
}
