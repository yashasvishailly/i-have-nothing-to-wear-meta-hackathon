export interface AccessoryChecks {
 matchesVisibleTarget:boolean;
 outsideTargetHumanPixels:boolean;
 visiblePartEnough:boolean;
 transparentLensShowsScene:boolean;
 reason:'match'|'wrong_object'|'external_occluder'|'unresolved'|'partial_object';
}
export type EvidenceDecision='recognized_target'|'recognized_partial'|'wrong_target'|'contaminated'|'insufficient_identity';
export function validAccessoryChecks(value:unknown):value is AccessoryChecks{
 const v=value as AccessoryChecks;return !!v&&typeof v==='object'&&Object.keys(v).sort().join(',')==='matchesVisibleTarget,outsideTargetHumanPixels,reason,transparentLensShowsScene,visiblePartEnough'&&[v.matchesVisibleTarget,v.outsideTargetHumanPixels,v.visiblePartEnough,v.transparentLensShowsScene].every(x=>typeof x==='boolean')&&['match','wrong_object','external_occluder','unresolved','partial_object'].includes(v.reason);
}
// A partial silhouette alone is neither success nor failure. Identity, clean target pixels
// and enough visible design evidence are required before any finishing request.
export function assessAccessory(checks:AccessoryChecks,role?:string){
 let decision:EvidenceDecision='insufficient_identity';
 if(!validAccessoryChecks(checks))return{decision,accepted:false,visibleOnly:false};
 if(checks.reason==='wrong_object')decision='wrong_target';
 else if(checks.outsideTargetHumanPixels||checks.reason==='external_occluder')decision='contaminated';
 else if(checks.matchesVisibleTarget&&checks.visiblePartEnough&&(!checks.transparentLensShowsScene||role==='eyewear')){
  if(checks.reason==='match')decision='recognized_target';
  if(checks.reason==='partial_object')decision='recognized_partial';
 }
 return{decision,accepted:decision==='recognized_target'||decision==='recognized_partial',visibleOnly:decision==='recognized_partial'};
}
