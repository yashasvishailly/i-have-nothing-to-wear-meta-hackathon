import type{Store}from'./hosted';
// One fixed object/key across all ordinary users. Never rotate this name or expire this ledger.
export const sharedSpendObject='ordinary-shared-spend-v1',sharedSpendKey=sharedSpendObject;
export const sharedSpendLimit=2_000_000,sharedSpendPendingMs=150_000;
export const sharedSpendReserve={discovery:20_000,finish:100_000}as const;
export interface SharedSpendEnv{WARDROBE_ORDINARY_MODE?:string;WARDROBE_ORDINARY_PRIOR_SPEND_MICRO_USD?:string;WARDROBE_ORDINARY_BUDGET_BASELINE_ACK?:string;}
export interface SpendBinding{idFromName(name:string):unknown;get(id:unknown):{fetch(request:Request):Promise<Response>};}
export interface SharedSpendStatus{enabled:boolean;reason:string;limitMicroUsd:number;chargedMicroUsd:number;remainingMicroUsd:number;costEstimateOnly:true;}
export interface SharedSpend{status():Promise<SharedSpendStatus>;reserve(id:string,stage:'discovery'|'finish'):Promise<void>;settle(id:string,state:'completed'|'unknown',estimatedMicroUsd?:number):Promise<void>;}
export class SharedSpendError extends Error{constructor(public code:string,public status=503){super(code);}}
interface Attempt{stage:'discovery'|'finish';reserved:number;state:'pending'|'completed'|'unknown';startedAt:number;estimatedMicroUsd?:number;}
interface Ledger{version:1;baselineMicroUsd:number;chargedMicroUsd:number;attempts:Record<string,Attempt>;blocked?:string;}
const amount=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
function valid(x:Ledger){return x?.version===1&&amount(x.baselineMicroUsd)&&amount(x.chargedMicroUsd)&&x.chargedMicroUsd>=x.baselineMicroUsd&&x.attempts&&typeof x.attempts==='object'&&!Array.isArray(x.attempts)&&x.chargedMicroUsd===x.baselineMicroUsd+Object.values(x.attempts).reduce((sum,a)=>sum+Math.max(a.reserved,a.estimatedMicroUsd??0),0)&&Object.entries(x.attempts).every(([id,a])=>/^[a-f0-9]{64}$/.test(id)&&a&&['discovery','finish'].includes(a.stage)&&a.reserved===sharedSpendReserve[a.stage]&&['pending','completed','unknown'].includes(a.state)&&amount(a.startedAt)&&(a.estimatedMicroUsd===undefined||amount(a.estimatedMicroUsd)));}
function summary(l?:Ledger):SharedSpendStatus{const pending=l&&Object.values(l.attempts).some(a=>a.state==='pending'),remaining=l?Math.max(0,sharedSpendLimit-l.chargedMicroUsd):0,reason=!l?'shared_budget_baseline_required':l.blocked?'shared_budget_uncertain':pending?'shared_budget_busy':remaining<sharedSpendReserve.discovery?'shared_budget_exhausted':'ok';return{enabled:reason==='ok',reason,limitMicroUsd:sharedSpendLimit,chargedMicroUsd:l?.chargedMicroUsd??0,remainingMicroUsd:remaining,costEstimateOnly:true};}
const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store',...(status===429?{'Retry-After':'5'}:{})}});
export async function sharedSpendApi(request:Request,env:SharedSpendEnv,store:Store,now=Date.now()){
 let input:any;if(request.method==='GET')input={action:'status'};else if(request.method==='POST'){const text=await request.text();if(text.length>512)return reply({error:'input'},400);try{input=JSON.parse(text);}catch{return reply({error:'input'},400);}}else return reply({error:'method_not_allowed'},405);
 if(!input||!['status','reserve','settle'].includes(input.action)||input.action!=='status'&&!/^[a-f0-9]{64}$/.test(input.id??'')||input.action==='reserve'&&!['discovery','finish'].includes(input.stage)||input.action==='settle'&&(!['completed','unknown'].includes(input.state)||input.estimatedMicroUsd!==undefined&&!amount(input.estimatedMicroUsd)))return reply({error:'input'},400);
 try{return await store.transaction(async tx=>{
  let l=await tx.get<Ledger>(sharedSpendKey);if(l!==undefined&&!valid(l))throw Error('ledger');
  const newlyInitialized=l===undefined;
  if(!l){const raw=env.WARDROBE_ORDINARY_PRIOR_SPEND_MICRO_USD;if(env.WARDROBE_ORDINARY_BUDGET_BASELINE_ACK==='prior-usage-reviewed-v1'&&typeof raw==='string'&&/^\d+$/.test(raw)&&amount(Number(raw)))l={version:1,baselineMicroUsd:Number(raw),chargedMicroUsd:Number(raw),attempts:{}};}
  if(!l)return reply(input.action==='status'?summary():{error:'shared_budget_baseline_required'},input.action==='status'?200:503);
  if(Object.values(l.attempts).some(a=>a.state==='unknown'||a.state==='completed'&&a.estimatedMicroUsd===undefined))l.blocked='cost_or_outcome_unknown';
  if(newlyInitialized||l.blocked)await tx.put(sharedSpendKey,l);
  if(Object.values(l.attempts).some(a=>a.state==='pending'&&a.startedAt+sharedSpendPendingMs<=now)){l.blocked='unsettled_outcome';await tx.put(sharedSpendKey,l);}
  if(input.action==='status'){await tx.put(sharedSpendKey,l);return reply(summary(l));}
  if(input.action==='reserve'){
   if(env.WARDROBE_ORDINARY_MODE!=='open')return reply({error:'shared_budget_disabled'},503);
   if(l.blocked)return reply({error:'shared_budget_uncertain'},503);
   if(l.attempts[input.id])return reply({error:'shared_budget_duplicate'},409);
   if(Object.values(l.attempts).some(a=>a.state==='pending'))return reply({error:'shared_budget_busy'},429);
   const reserve=sharedSpendReserve[input.stage as keyof typeof sharedSpendReserve];if(l.chargedMicroUsd+reserve>sharedSpendLimit)return reply({error:'shared_budget_exhausted'},402);
   l.chargedMicroUsd+=reserve;l.attempts[input.id]={stage:input.stage,reserved:reserve,state:'pending',startedAt:now};await tx.put(sharedSpendKey,l);return reply({reserved:true});
  }
  const a=l.attempts[input.id];if(!a)return reply({error:'shared_budget_reservation_missing'},409);
  if(a.state!=='pending')return reply({settled:true}); // Idempotent receipt, never a refund/reset.
  a.state=input.state;if(input.estimatedMicroUsd!==undefined){a.estimatedMicroUsd=input.estimatedMicroUsd;l.chargedMicroUsd+=Math.max(0,input.estimatedMicroUsd-a.reserved);}
  if(input.state==='unknown'||input.estimatedMicroUsd===undefined||l.chargedMicroUsd>sharedSpendLimit)l.blocked='cost_or_outcome_unknown';
  await tx.put(sharedSpendKey,l);return reply({settled:true});
 });}catch{return reply({error:'shared_budget_unavailable'},503);}
}
export function sharedSpendClient(binding:SpendBinding,origin:string):SharedSpend{
 const stub=binding.get(binding.idFromName(sharedSpendObject));const send=async(input:any)=>{let r:Response,v:any;try{r=await stub.fetch(new Request(origin+'/_internal/shared-spend',{method:input.action==='status'?'GET':'POST',headers:{'Content-Type':'application/json'},...(input.action==='status'?{}:{body:JSON.stringify(input)})}));v=await r.json();}catch{throw new SharedSpendError('shared_budget_unavailable');}if(!r.ok)throw new SharedSpendError(typeof v.error==='string'&&/^shared_budget_[a-z_]+$/.test(v.error)?v.error:'shared_budget_unavailable',r.status);return v;};
 return{status:async()=>{const v=await send({action:'status'});if(typeof v.enabled!=='boolean'||typeof v.reason!=='string'||v.limitMicroUsd!==sharedSpendLimit||!amount(v.chargedMicroUsd)||!amount(v.remainingMicroUsd)||v.costEstimateOnly!==true||!['ok','shared_budget_baseline_required','shared_budget_busy','shared_budget_uncertain','shared_budget_exhausted'].includes(v.reason)||v.enabled!==(v.reason==='ok')||v.remainingMicroUsd!==(v.reason==='shared_budget_baseline_required'?0:Math.max(0,sharedSpendLimit-v.chargedMicroUsd))||v.enabled&&v.remainingMicroUsd<sharedSpendReserve.discovery)throw new SharedSpendError('shared_budget_unavailable');return v;},reserve:async(id,stage)=>{if((await send({action:'reserve',id,stage})).reserved!==true)throw new SharedSpendError('shared_budget_unavailable');},settle:async(id,state,estimatedMicroUsd)=>{if((await send({action:'settle',id,state,...(estimatedMicroUsd!==undefined?{estimatedMicroUsd}:{})})).settled!==true)throw new SharedSpendError('shared_budget_unavailable');}};
}
