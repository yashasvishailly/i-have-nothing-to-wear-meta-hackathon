// One watch only; diagnostics, not automatic inventory admission. No public route
// or credential lookup. An approved server caller must supply transports/keys.
import type{Store}from'./hosted';import type{DiscoveredPiece}from'../discovery';import{digest}from'../discovery';import{imageHash}from'./routes';import{validatePng}from'./png';
import{pngPixels,samePixels}from'./png-pixels';import{discoveredContextPixels}from'../source-context';
import{validateContextPresence,contextPresenceAccepted,correctedContext,validateContextFidelity,contextFidelityAccepted,type ContextPresence,type ContextFidelity}from'./context-identity';
import{reconstructionPreset}from'../reconstruction-model';import{safeReconstructionUsage}from'./reconstruction';
export interface ContextIdentityApproval{mode:'disabled'|'approved';id:'one-watch-context-v1';sourceSha256:string;contextSha256:string;pieceSha256:string;expiresAt:string;estimateAccepted:boolean;}
type Stage='presence'|'reconstruct'|'verify';
type PresenceFlags=Pick<ContextPresence,'targetPresent'|'currentCropContainsTarget'|'enoughVisibleIdentity'|'ambiguous'>;
interface Journal{presence?:PresenceFlags;scope:string;attempts:Partial<Record<Stage,{state:'started'|'completed'|'unknown'}>>;outcome:'running'|'absent'|'uncorrected'|'accepted'|'rejected'|'unknown';}
export interface ContextIdentityServices{
 presence:(source:Uint8Array,context:Uint8Array,piece:DiscoveredPiece,signal:AbortSignal)=>Promise<{check:ContextPresence;usage:unknown}>;
 reconstruct:(source:Uint8Array,context:Uint8Array,piece:DiscoveredPiece,signal:AbortSignal)=>Promise<{image:string;model:string;usage?:unknown}>;
 verify:(source:Uint8Array,context:Uint8Array,preview:Uint8Array,piece:DiscoveredPiece,signal:AbortSignal)=>Promise<{check:ContextFidelity;usage:unknown}>;
}
export async function runContextIdentityExperiment(source:Uint8Array,originalContext:Uint8Array,piece:DiscoveredPiece,approval:ContextIdentityApproval,store:Store,services:ContextIdentityServices,signal:AbortSignal,now=Date.now){
 const expiry=Date.parse(approval.expiresAt);if(approval.mode!=='approved'||approval.id!=='one-watch-context-v1'||!approval.estimateAccepted||!Number.isFinite(expiry)||expiry<=now()||expiry>now()+20*60000)return{outcome:'disabled' as const,eligibleForInventory:false as const};
 if(piece.kind!=='watch'||piece.category!=='accessory'||source.length>6*1024*1024||originalContext.length>2*1024*1024||await imageHash(source)!==approval.sourceSha256||await imageHash(originalContext)!==approval.contextSha256||await digest(piece)!==approval.pieceSha256)throw Error('scope');
 const size=await validatePng(source);if(Math.max(size.width,size.height)>1600)throw Error('scope');const original=await pngPixels(source);if(!samePixels(discoveredContextPixels(original,piece),await pngPixels(originalContext)))throw Error('context_not_from_source');
 const validVisionUsage=(v:any)=>v&&[v.inputTokens,v.outputTokens].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000);
 const scope=await digest([approval,reconstructionPreset,'presence-pair-edit-fidelity-v1']),key='context-identity-once';
 const reserve=async(stage:Stage)=>store.transaction(async tx=>{const r=await tx.get<Journal>(key)??{scope,attempts:{},outcome:'running'};if(r.scope!==scope)throw Error('approval_changed');if(now()>=expiry||signal.aborted)throw Error('expired_or_cancelled');if(r.outcome!=='running'||r.attempts[stage]||Object.values(r.attempts).some(a=>a?.state!=='completed'))throw Error('already_attempted');if(stage==='presence'&&Object.keys(r.attempts).length||stage==='reconstruct'&&!r.attempts.presence||stage==='verify'&&!r.attempts.reconstruct)throw Error('stage_order');r.attempts[stage]={state:'started'};await tx.put(key,r);});
 const finish=async(stage:Stage,outcome?:Journal['outcome'],presence?:ContextPresence)=>store.transaction(async tx=>{const r=await tx.get<Journal>(key);if(!r||r.scope!==scope||r.attempts[stage]?.state!=='started')throw Error('stage_state');r.attempts[stage]!.state='completed';if(outcome)r.outcome=outcome;if(presence)r.presence={targetPresent:presence.targetPresent,currentCropContainsTarget:presence.currentCropContainsTarget,enoughVisibleIdentity:presence.enoughVisibleIdentity,ambiguous:presence.ambiguous};await tx.put(key,r);});
 let active:Stage|undefined;const usage:Partial<Record<Stage,unknown>>={};
 try{
  await reserve('presence');active='presence';const presence=await services.presence(source,originalContext,piece,signal),check=validateContextPresence(presence.check);signal.throwIfAborted();if(!validVisionUsage(presence.usage))throw Error('usage_unknown');usage.presence=presence.usage;
  if(!contextPresenceAccepted(check)){await finish('presence','absent',check);active=undefined;return{outcome:'absent' as const,eligibleForInventory:false as const,presence:check,usage};}
  if(!check.currentCropContainsTarget&&(['left','top','right','bottom'] as const).every(k=>check.region![k]===piece.region[k])){await finish('presence','uncorrected',check);active=undefined;return{outcome:'uncorrected' as const,eligibleForInventory:false as const,presence:check,usage};}
  const context=await correctedContext(source,piece,check);await finish('presence',undefined,check);active=undefined;
  await reserve('reconstruct');active='reconstruct';const preview=await services.reconstruct(source,context,piece,signal);signal.throwIfAborted();if(!safeReconstructionUsage(preview.usage))throw Error('usage_unknown');usage.reconstruct=preview.usage;
  if(preview.model!==reconstructionPreset.model||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(preview.image)||preview.image.length>12*1024*1024)throw Error('invalid_output');const output=Uint8Array.from(atob(preview.image.slice(22)),c=>c.charCodeAt(0)),dims=await validatePng(output);if(dims.width!==1024||dims.height!==1024)throw Error('invalid_output');await finish('reconstruct');active=undefined;
  await reserve('verify');active='verify';const verification=await services.verify(source,context,output,piece,signal);signal.throwIfAborted();if(!validVisionUsage(verification.usage))throw Error('usage_unknown');usage.verify=verification.usage;const fidelity=validateContextFidelity(verification.check),accepted=contextFidelityAccepted(fidelity);await finish('verify',accepted?'accepted':'rejected');active=undefined;
  // Even a positive model verdict remains an experiment artifact for visual QA.
  return{outcome:accepted?'accepted' as const:'rejected' as const,eligibleForInventory:false as const,presence:check,fidelity,context,preview,usage};
 }catch(error){if(active)await store.transaction(async tx=>{const r=await tx.get<Journal>(key);if(r?.scope===scope&&r.attempts[active!]?.state==='started'){r.attempts[active!]!.state='unknown';r.outcome='unknown';await tx.put(key,r);}});throw error;}
}
