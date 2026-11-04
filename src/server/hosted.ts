import {createMetaApi, imageHash, type MetaEnvironment, type DurableBudget} from './routes';
import type {Transport} from './meta';
export interface Store {
 get<T>(key:string):Promise<T|undefined>;
 put<T>(key:string,value:T):Promise<void>;
 transaction<T>(fn:(store:Store)=>Promise<T>):Promise<T>;
}
interface Record {scope:string;used:number;ids:string[];activeId:string;leaseUntil:number;concepts?:string[];}
export const originalTrial='initial-one-photo-trial-v1';
export const accessoriesTrial='synthetic-accessories-trial-v2';
export const secondSyntheticTrial='second-synthetic-five-trial-v3';
export const blazerDiagnosticTrial='second-synthetic-blazer-diagnostic-v1';
export function selectedTrial(env:HostedEnv){const id=env.WARDROBE_TRIAL_ID??originalTrial;return [originalTrial,accessoriesTrial,secondSyntheticTrial,blazerDiagnosticTrial].includes(id)?id:undefined;}
export async function trialAudit(store:Store){const record=await store.get<Record>('trial');return {used:record&&Number.isInteger(record.used)&&record.used>=0&&record.used<=7?record.used:0};}
export interface HostedEnv extends MetaEnvironment {
 APP_ORIGIN?:string;
 WARDROBE_TRIAL_ID?:string;
}
export async function hostedApi(request:Request,env:HostedEnv,store:Store, options:{now?:()=>number;transport?:Transport}={}) {
 const now=options.now??Date.now;
 // Each explicitly approved trial has a fixed object. Earlier records are never deleted or reset.
 const accessories=env.WARDROBE_TRIAL_ID===accessoriesTrial;
 const second=env.WARDROBE_TRIAL_ID===secondSyntheticTrial;
 const blazer=env.WARDROBE_TRIAL_ID===blazerDiagnosticTrial;
 const concepts=blazer?['blazer']:accessories?['shoes','bag','sunglasses']:second?['top','jeans','jacket','shoes','bag']:null;
 const expiry=Date.parse(env.WARDROBE_APPROVAL_EXPIRES_AT??'');
 const max=Number(env.WARDROBE_MAX_CALLS);
 const hash=env.WARDROBE_APPROVED_IMAGE_SHA256??'';
 const url=new URL(request.url);
 const valid=selectedTrial(env)!==undefined && (!accessories||max===3)&&(!second||max===5)&&(!blazer||max===1) && env.WARDROBE_LIVE_MODE==='approved' && env.APP_ORIGIN===url.origin &&
   /^https:\/\/[^/]+$/.test(env.APP_ORIGIN) && /^[a-f0-9]{64}$/.test(hash) &&
   Number.isInteger(max)&&max>=1&&max<=7&&expiry>now()&&expiry<=now()+3600000;
 if(!valid)return createMetaApi({}, {hosted:true}).handle(request);
 const scope=await imageHash(new TextEncoder().encode(JSON.stringify(concepts?[env.APP_ORIGIN,hash,expiry,max,concepts]:[env.APP_ORIGIN,hash,expiry,max])));
 const saved=await store.get<Record>('trial');
 if(saved&&saved.scope!==scope)return Response.json({error:'approval_changed'},{status:409,headers:{'Cache-Control':'no-store'}});
 const budget:DurableBudget={used:saved?.used??0,
  reserve:async (id,concept)=>store.transaction(async tx=>{
   const record=await tx.get<Record>('trial')??{scope,used:0,ids:[],activeId:'',leaseUntil:0};
   if(record.scope!==scope)return 'approval_changed';
   if(record.ids.includes(id))return 'duplicate_request';
   if(concepts&&(!concept||!concepts.includes(concept)))return 'concept_not_approved';
   if(concepts&&record.concepts?.includes(concept!))return 'duplicate_concept';
   if(record.used>=max||now()>=expiry)return 'call_limit';
   if(record.leaseUntil>now())return 'request_in_progress';
   record.used++;if(concepts)record.concepts=[...(record.concepts??[]),concept!];record.ids.push(id);record.activeId=id;record.leaseUntil=now()+60000;
   await tx.put('trial',record);return 'ok';
  }),
  release:async id=>store.transaction(async tx=>{
   const record=await tx.get<Record>('trial');
   if(record?.activeId===id){record.activeId='';record.leaseUntil=0;await tx.put('trial',record);}
  })
 };
 // Outfit reasoning stays off during the initial one-photo SAM test, even if another flag is set.
 const gated:MetaEnvironment={...(blazer?{WARDROBE_SEGMENT_DIAGNOSTICS:"counts-v1"}:{}),...(concepts?{WARDROBE_APPROVED_CONCEPTS:concepts.join(',')}:{}),MODEL_API_KEY:env.MODEL_API_KEY,WARDROBE_LIVE_MODE:env.WARDROBE_LIVE_MODE,WARDROBE_APPROVED_IMAGE_SHA256:hash,WARDROBE_APPROVAL_EXPIRES_AT:env.WARDROBE_APPROVAL_EXPIRES_AT,WARDROBE_MAX_CALLS:env.WARDROBE_MAX_CALLS,WARDROBE_ALLOW_REASONING:'disabled'};
 return createMetaApi(gated,{hosted:true,budget,now,transport:options.transport}).handle(request);
}
