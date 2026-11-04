import{sharedSpendClient,type SharedSpend,type SpendBinding}from'./shared-spend';
import {automaticApi,automaticDisabled,automaticRecoveryState,type AutomaticEnv} from './automatic';
import {jobStore} from './ordinary-upload';
import {imageHash} from './routes';
import {validatePng} from './png';
import {photoResolutionIssue} from '../photo-quality';
import type {Store} from './hosted';

export const openSessionCookie='__Host-wardrobe-open';
export const openSessionLifetime=30*86400000;
export function openUploadEnabled(env:AutomaticEnv&{WARDROBE_ORDINARY_MODE?:string}){
 return env.WARDROBE_ORDINARY_MODE==='open';
}
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
interface OpenJob{sourceHash:string;expires:string;}

// Each anonymous browser has its own Durable Object. Pilot consumption remains untouched.
export async function openUploadApi(request:Request,env:AutomaticEnv&{META_TRIAL?:SpendBinding},store:Store,options:Parameters<typeof automaticApi>[3]&{sharedBudget?:SharedSpend}={}){
 const url=new URL(request.url),stage=url.pathname.split('/').pop(),now=options.now??Date.now;
 if(url.origin!==env.APP_ORIGIN||!url.origin.startsWith('https:')||request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return reply({error:'origin_not_allowed'},403);
 const budget=options.sharedBudget??(env.META_TRIAL?sharedSpendClient(env.META_TRIAL,url.origin):undefined);
 if(stage==='status'&&request.method==='GET'){let sharedBudget;try{sharedBudget=await budget?.status();}catch{}return reply({...automaticDisabled(),enabled:!!env.MODEL_API_KEY&&!!env.OPENAI_API_KEY&&sharedBudget?.enabled===true,ordinaryUpload:true,registrationRequired:true,inputMode:'discovered-context-v1',ordinarySession:request.headers.get('x-wardrobe-session-proof')??undefined,remainingDiscovery:sharedBudget?.enabled?1:0,remainingFinishes:sharedBudget?.enabled?12:0,maxItems:12,unlimitedUploads:true,sharedBudget:sharedBudget??{enabled:false,reason:'shared_budget_unavailable'},usage:{remainingPhotos:null,expiresAt:null}});}
 if(stage==='job'&&request.method==='GET'){
  const source=request.headers.get('x-wardrobe-source-sha256')??'',requestId=request.headers.get('x-wardrobe-discovery-request')??'';
  let id=request.headers.get('x-wardrobe-upload-job')??'';
  if(!/^[a-f0-9]{64}$/.test(source))return reply({error:'input'},400);
  if(!id&&/^[A-Za-z0-9-]{16,80}$/.test(requestId)){const known=await store.get<{jobId:string;sourceHash:string}|boolean>('open-discovery:'+requestId);if(!known){const proof=request.headers.get('x-wardrobe-original-session');return reply({state:proof&&proof===request.headers.get('x-wardrobe-session-proof')?'not_started':'unavailable',sourceSha256:source,discovery:proof&&proof===request.headers.get('x-wardrobe-session-proof')?'not_started':'unknown',finishes:{}});}if(typeof known==='object'&&known.sourceHash===source)id=known.jobId;else return reply({state:'unavailable',sourceSha256:source,discovery:'unknown',finishes:{}});}
  if(!/^[a-f0-9]{64}$/.test(id))return reply({state:'unavailable',sourceSha256:source,discovery:'unknown',finishes:{}});
  const job=await store.get<OpenJob>('open-job:'+id);if(!job||job.sourceHash!==source)return reply({state:'unavailable',sourceSha256:source,discovery:'unknown',finishes:{}});
  const summary=await automaticRecoveryState(jobStore(store,'open-'+id));
  return reply({...summary,state:Date.parse(job.expires)<=now()?'expired':summary.blocked?'blocked':'ready',sourceSha256:source,ordinaryJobId:id,ordinaryJobExpiresAt:job.expires});
 }
 if(!['discover','finish','close'].includes(stage??''))return reply({error:'not_found'},404);
 if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
 if(request.headers.get('origin')!==url.origin||request.headers.get('x-wardrobe-consent')!=='photo-pipeline-v1'||request.headers.get('x-wardrobe-context-consent')!=='source-context-v1')return reply({error:'consent_required'},403);
 let jobId=request.headers.get('x-wardrobe-upload-job')??'',job:OpenJob|undefined,bytes:Uint8Array|undefined;
 if(stage==='discover'){
  if(request.headers.get('content-type')?.split(';')[0]!=='image/png')return reply({error:'input'},400);
  const reader=request.body?.getReader();if(!reader)return reply({error:'input'},400);
  const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>6*1024*1024)return reply({error:'too_large'},413);chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
  bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  try{const size=await validatePng(bytes);if(photoResolutionIssue(size.width,size.height)||Math.max(size.width,size.height)>1600)throw Error();}catch{return reply({error:'photo_resolution'},400);}
  const requestId=request.headers.get('x-wardrobe-request-id')??'';
  if(!/^[A-Za-z0-9-]{16,80}$/.test(requestId))return reply({error:'input'},400);
  const candidateId=await imageHash(new TextEncoder().encode(crypto.randomUUID())),sourceHash=await imageHash(bytes);
  const reserved=await store.transaction(async tx=>{const key='open-discovery:'+requestId,known=await tx.get<{jobId:string;sourceHash:string}|boolean>(key);if(known){if(typeof known!=='object'||known.sourceHash!==sourceHash)return undefined;return{id:known.jobId,job:await tx.get<OpenJob>('open-job:'+known.jobId)};}const entry={sourceHash,expires:new Date(now()+30*60000).toISOString()};await tx.put(key,{jobId:candidateId,sourceHash});await tx.put('open-job:'+candidateId,entry);return{id:candidateId,job:entry};});
  if(!reserved?.job)return reply({error:'already_attempted'},409);
  jobId=reserved.id;job=reserved.job;
 }else{
  if(!/^[a-f0-9]{64}$/.test(jobId))return reply({error:'job_unavailable'},403);
  job=await store.get<OpenJob>('open-job:'+jobId);if(!job)return reply({error:'job_unavailable'},403);
 }
 if(stage==='close')return reply({closed:true});
 if(!budget)return reply({error:'shared_budget_unavailable',notDispatched:true},503);
 const derived=Object.create(env) as AutomaticEnv;
 const vars={WARDROBE_PROCESSING_MODE:'approved',WARDROBE_PROCESSING_SHARED_SPEND:'ordinary-v1',WARDROBE_PROCESSING_ID:'automatic-approved-open-'+jobId.slice(0,40),WARDROBE_PROCESSING_INPUT_MODE:'discovered-context-v1',WARDROBE_PROCESSING_SOURCE_SHA256:job.sourceHash,WARDROBE_PROCESSING_EXPIRES_AT:job.expires,WARDROBE_PROCESSING_MAX_ITEMS:'12',WARDROBE_PROCESSING_MAX_FINISH_CALLS:'12',WARDROBE_PROCESSING_MAX_SEGMENT_CALLS:'0',WARDROBE_PROCESSING_MAX_FALLBACKS:'0',WARDROBE_PROCESSING_MAX_LOCALIZATIONS:'0',WARDROBE_PROCESSING_MAX_VERIFICATIONS:'0',WARDROBE_PROCESSING_BUDGET_MICRO_USD:'2000000',WARDROBE_PROCESSING_DISCOVERY_RESERVE_MICRO_USD:'20000',WARDROBE_PROCESSING_ESTIMATE_ACCEPTED:'photo-estimate-v1'};
 for(const[key,value]of Object.entries(vars))Object.defineProperty(derived,key,{value,enumerable:true});
 const headers=new Headers(request.headers);headers.set('x-wardrobe-request-id',crypto.randomUUID());
 const forwarded=stage==='discover'?new Request(url.origin+'/api/processing/discover',{method:'POST',headers,body:bytes as BodyInit,signal:request.signal}):new Request(new Request(url.origin+'/api/processing/finish',request),{headers});
 const operation=(key:string)=>imageHash(new TextEncoder().encode(jobId+'/'+key));const sharedSpend={reserve:async(key:string,stage:'discovery'|'finish')=>budget.reserve(await operation(key),stage),settle:async(key:string,state:'completed'|'unknown',estimatedMicroUsd?:number)=>budget.settle(await operation(key),state,estimatedMicroUsd)};
 const result=await automaticApi(forwarded,derived,jobStore(store,'open-'+jobId),{...options,sharedSpend});
 return reply({...await result.json() as object,ordinaryJobId:jobId,ordinaryJobExpiresAt:job.expires,ordinarySession:request.headers.get('x-wardrobe-session-proof')??undefined},result.status);
}
