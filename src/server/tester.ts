// Private, disabled-by-default, one-photo tester gate. Never logs bodies or stores access codes/images.
import{automaticApi,automaticDisabled,type AutomaticEnv}from'./automatic';
import{digest}from'../discovery';import type{Store}from'./hosted';
export interface TesterEnv extends AutomaticEnv{WARDROBE_TESTER_INPUT_MODE?:string;WARDROBE_TESTER_MAX_ACCESSORY_CHECKS?:string;WARDROBE_TESTER_MODE?:string;WARDROBE_TESTER_ID?:string;WARDROBE_TESTER_TOKEN_SHA256?:string;WARDROBE_TESTER_STARTS_AT?:string;WARDROBE_TESTER_EXPIRES_AT?:string;WARDROBE_TESTER_MAX_ITEMS?:string;WARDROBE_TESTER_MAX_SEGMENTS?:string;WARDROBE_TESTER_MAX_FINISHES?:string;WARDROBE_TESTER_MAX_FALLBACKS?:string;WARDROBE_TESTER_BUDGET_MICRO_USD?:string;}
interface Registration{configuration:string;sourceHash:string;expires:number;registeredAt:number;}
const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export const testerOff=()=>({...automaticDisabled(),privateTest:true,registrationRequired:false});
export function testerId(env:TesterEnv){return env.WARDROBE_TESTER_MODE==='approved'&&/^[a-z0-9-]{8,32}$/.test(env.WARDROBE_TESTER_ID??'')?'private-tester-'+env.WARDROBE_TESTER_ID:undefined;}
function configuration(env:TesterEnv,origin:string,now:number){
 if(!testerId(env)||env.APP_ORIGIN!==origin||!/^https:\/\/[^/]+$/.test(origin))return;
 const inputMode=env.WARDROBE_TESTER_INPUT_MODE??'sam-cutout';if(!['sam-cutout','discovered-context-v1'].includes(inputMode))return;
 const checks=Number(env.WARDROBE_TESTER_MAX_ACCESSORY_CHECKS??0);if(!Number.isInteger(checks)||checks<0||checks>6)return;
 const start=Date.parse(env.WARDROBE_TESTER_STARTS_AT??''),end=Date.parse(env.WARDROBE_TESTER_EXPIRES_AT??''),items=Number(env.WARDROBE_TESTER_MAX_ITEMS),segments=Number(env.WARDROBE_TESTER_MAX_SEGMENTS),finishes=Number(env.WARDROBE_TESTER_MAX_FINISHES),fallbacks=Number(env.WARDROBE_TESTER_MAX_FALLBACKS),budget=Number(env.WARDROBE_TESTER_BUDGET_MICRO_USD);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<=now||end-start>4*3600000||!Number.isInteger(items)||items<1||items>6||!Number.isInteger(segments)||segments<(inputMode==='discovered-context-v1'?0:1)||segments>(inputMode==='discovered-context-v1'?0:18)||!Number.isInteger(finishes)||finishes<1||finishes>6||finishes>items||![0,1,2].includes(fallbacks)||!Number.isSafeInteger(budget)||budget<125000||budget>750000)return;
 return{inputMode,start,end,items,segments,finishes,fallbacks,budget,checks,accessoryPolicy:env.WARDROBE_PROCESSING_ACCESSORY_POLICY==='grounded-v1',id:env.WARDROBE_TESTER_ID!};
}
async function authorized(request:Request,expected:string|undefined){const code=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];if(!code||!/^[a-f0-9]{64}$/.test(expected??''))return false;const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code)))].map(v=>v.toString(16).padStart(2,'0')).join('');let diff=0;for(let i=0;i<64;i++)diff|=actual.charCodeAt(i)^expected!.charCodeAt(i);return diff===0;}
export async function testerApi(request:Request,env:TesterEnv,store:Store,options:Parameters<typeof automaticApi>[3]={}){
 const now=options.now??Date.now,url=new URL(request.url),cfg=configuration(env,url.origin,now());
 if(!cfg)return url.pathname==='/api/tester/status'&&request.method==='GET'?reply(testerOff()):reply({error:'disabled'},503);
 if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return reply({error:'access_unavailable'},403);
 if(!await authorized(request,env.WARDROBE_TESTER_TOKEN_SHA256))return reply({error:'access_unavailable'},401);
 const fingerprint=await digest([cfg,env.WARDROBE_TESTER_TOKEN_SHA256]),read=await store.get<Registration>('tester-registration');
 if(read&&read.configuration!==fingerprint)return reply({error:'approval_changed'},409);
 if(url.pathname==='/api/tester/register'){
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
  if(request.headers.get('origin')!==url.origin||request.headers.get('x-wardrobe-consent')!=='photo-pipeline-v1')return reply({error:'consent_required'},403);
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'input'},400);
  let data:any;try{const reader=request.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let size=0;try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>4096)throw Error();chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}const bytes=new Uint8Array(size);let o=0;for(const c of chunks){bytes.set(c,o);o+=c.length;}data=JSON.parse(new TextDecoder().decode(bytes));if(!data||Object.keys(data).join(',')!=='sourceSha256'||!/^[a-f0-9]{64}$/.test(data.sourceSha256))throw Error();}catch{return reply({error:'input'},400);}
  const result=await store.transaction(async tx=>{const saved=await tx.get<Registration>('tester-registration');if(saved)return saved.configuration===fingerprint&&saved.sourceHash===data.sourceSha256?'same':'different';await tx.put('tester-registration',{configuration:fingerprint,sourceHash:data.sourceSha256,registeredAt:now(),expires:Math.min(cfg.end,now()+45*60000)} satisfies Registration);return'bound';});
  if(result==='different')return reply({error:'one_photo_only'},409);return reply({registered:true,alreadyRegistered:result==='same'});
 }
 const record=read;
 if(url.pathname==='/api/tester/status'&&request.method==='GET'&&!record)return reply({...testerOff(),enabled:true,registrationRequired:true,inputMode:cfg.inputMode,remainingDiscovery:1,remainingSegments:cfg.segments,remainingFinishes:cfg.finishes,maxItems:cfg.items,maxFallbacks:cfg.fallbacks,approvalExpiresAt:new Date(cfg.end).toISOString()});
 if(!record)return reply({error:'photo_not_registered'},403);
 if(record.expires<=now())return url.pathname==='/api/tester/status'&&request.method==='GET'?reply(testerOff()):reply({error:'expired'},410);
 const stage=url.pathname.slice('/api/tester/'.length);if(!['status','discover','segment','finish','localize','verify'].includes(stage))return reply({error:'not_found'},404);
 // Inherit provider bindings lazily: status/register must never read either provider credential.
 const derived=Object.create(env)as AutomaticEnv;const vars={WARDROBE_PROCESSING_INPUT_MODE:cfg.inputMode,WARDROBE_PROCESSING_MODE:'approved',WARDROBE_PROCESSING_MAX_LOCALIZATIONS:String(cfg.checks),WARDROBE_PROCESSING_MAX_VERIFICATIONS:String(cfg.checks),WARDROBE_PROCESSING_ID:'automatic-approved-tester-'+cfg.id,WARDROBE_PROCESSING_SOURCE_SHA256:record.sourceHash,WARDROBE_PROCESSING_EXPIRES_AT:new Date(record.expires).toISOString(),WARDROBE_PROCESSING_MAX_ITEMS:String(cfg.items),WARDROBE_PROCESSING_MAX_SEGMENT_CALLS:String(cfg.segments),WARDROBE_PROCESSING_MAX_FINISH_CALLS:String(cfg.finishes),WARDROBE_PROCESSING_MAX_FALLBACKS:String(cfg.fallbacks),WARDROBE_PROCESSING_BUDGET_MICRO_USD:String(cfg.budget),WARDROBE_PROCESSING_DISCOVERY_RESERVE_MICRO_USD:'20000',WARDROBE_PROCESSING_ESTIMATE_ACCEPTED:'photo-estimate-v1'};for(const[k,v]of Object.entries(vars))Object.defineProperty(derived,k,{value:v,enumerable:true});
 const response=await automaticApi(new Request(url.origin+'/api/processing/'+stage,request),derived,store,options);
 if(stage!=='status')return response;const status=await response.json()as any;return reply({...status,privateTest:true,registrationRequired:false},response.status);
}
