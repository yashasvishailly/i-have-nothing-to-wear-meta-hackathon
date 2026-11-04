import{intactPreviewPng}from'./fixtures/synthetic-png';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {ordinaryApi,ordinaryObject,type OrdinaryEnv} from '../src/server/ordinary-upload';
import worker,{MetaTrial} from '../src/worker';
import {encodeRgbaPng} from '../src/server/encode-png';import {pngPixels} from '../src/server/png-pixels';import {discoveredContextPixels} from '../src/source-context';import type {Store} from '../src/server/hosted';
class Memory implements Store{data=new Map<string,any>();tail=Promise.resolve();alarm=0;async get<T>(k:string){return structuredClone(this.data.get(k)) as T|undefined;}async put<T>(k:string,v:T){this.data.set(k,structuredClone(v));}async transaction<T>(fn:(s:Store)=>Promise<T>){const old=this.tail;let release!:()=>void;this.tail=new Promise(r=>release=r);await old;try{return await fn(this);}finally{release();}}async setAlarm(n:number){this.alarm=n;}async delete(keys:string[]){for(const k of keys)this.data.delete(k);}}
const origin='https://wardrobe.example',time=Date.now(),end=time+3600000,env:OrdinaryEnv={APP_ORIGIN:origin,WARDROBE_ORDINARY_MODE:'approved',WARDROBE_ORDINARY_ID:'ordinary-test-v1',WARDROBE_ORDINARY_STARTS_AT:new Date(time-1000).toISOString(),WARDROBE_ORDINARY_EXPIRES_AT:new Date(end).toISOString(),MODEL_API_KEY:'mock-meta',OPENAI_API_KEY:'mock-openai'};
async function png(n=1,size=640){const rgba=new Uint8ClampedArray(480*size*4);for(let i=0;i<rgba.length;i+=4)rgba.set([n,60,90,255],i);return encodeRgbaPng({width:480,height:size,rgba});}
const raw={photoQuality:{usable:true,reason:'ok'},items:[{kind:'skirt',certainty:'clear',region:{left:200,top:300,right:800,bottom:900},grounding:{visibility:'full',layer:'single',color:'brown',pattern:'solid',positivePoints:[{x:500,y:500}],negativePoints:[]}}]};
const request=(stage:string,body?:any,cookie='',job='')=>new Request(origin+'/api/ordinary/'+stage,{method:stage==='status'?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':stage==='discover'?'image/png':'application/json','X-Wardrobe-Consent':'photo-pipeline-v1','X-Wardrobe-Context-Consent':'source-context-v1','X-Wardrobe-Request-Id':crypto.randomUUID(),'X-Wardrobe-Upload-Job':job},body:stage==='status'?undefined:stage==='discover'?body:JSON.stringify(body??{})});
async function session(store:Memory,opts:any){const r=await ordinaryApi(request('status'),env,store,opts);assert.equal(r.status,200);const cookie=r.headers.get('set-cookie')!;assert.match(cookie,/Secure; HttpOnly; SameSite=Strict/);return cookie.split(';')[0];}
const meta=(calls:string[],fail=false)=>async()=>{calls.push('meta');if(fail)throw Error('uncertain');return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}});};
const output=intactPreviewPng();
const openai=(calls:string[])=>async(_u:any,init:any)=>{calls.push('openai');assert.equal(init.redirect,'manual');return Response.json({data:[{b64_json:Buffer.from(output).toString('base64')}],usage:{input_tokens:100,output_tokens:439,total_tokens:539,input_tokens_details:{image_tokens:40,text_tokens:60}}});};

import {openUploadApi} from './fixtures/budgeted-open-upload';
const openEnv={...env,WARDROBE_ORDINARY_MODE:'open',WARDROBE_ORDINARY_PRIOR_SPEND_MICRO_USD:'0',WARDROBE_ORDINARY_BUDGET_BASELINE_ACK:'prior-usage-reviewed-v1'};
test('open uploads accept more than three photos, repeated sources, and concurrent jobs without pilot consumption',async()=>{
 const s=new Memory(),calls:string[]=[],source=await png(),opts={metaTransport:meta(calls)};
 await s.put('ordinary-consumption-v1',{starts:3,halted:true});
 const responses=[];for(let n=0;n<5;n++)responses.push(await openUploadApi(request('discover',source),openEnv,s,opts));
 for(const r of responses)assert.equal(r.status,200,await r.clone().text());
 assert.equal(calls.length,5);assert.deepEqual(await s.get('ordinary-consumption-v1'),{starts:3,halted:true});
 assert.equal((await(await openUploadApi(request('status'),openEnv,s)).json()).unlimitedUploads,true);
});
test('open processing finishes through native adapters and refuses replay and another session job',async()=>{
 const s=new Memory(),calls:string[]=[],source=await png(),opts={metaTransport:meta(calls),openaiTransport:openai(calls)};
 const discovery=await(await openUploadApi(request('discover',source),openEnv,s,opts)).json();
 const piece=discovery.items[0],context=await encodeRgbaPng(discoveredContextPixels(await pngPixels(source),piece));
 const body={source:Buffer.from(source).toString('base64'),manifest:discovery.items,pieceId:piece.id,context:Buffer.from(context).toString('base64')};
 assert.equal((await openUploadApi(request('finish',body,'',discovery.ordinaryJobId),openEnv,new Memory(),opts)).status,403);
 const finished=await openUploadApi(request('finish',body,'',discovery.ordinaryJobId),openEnv,s,opts);
 assert.equal(finished.status,200,await finished.clone().text());
 assert.equal((await openUploadApi(request('finish',body,'',discovery.ordinaryJobId),openEnv,s,opts)).status,409);
 assert.deepEqual(calls,['meta','openai']);
});
test('uncertain open upload halts the shared fixture budget without clearing saved job records',async()=>{
 const s=new Memory(),calls:string[]=[],source=await png();
 assert.ok(!(await openUploadApi(request('discover',source),openEnv,s,{metaTransport:meta(calls,true)})).ok);
 assert.equal((await openUploadApi(request('discover',source),openEnv,s,{metaTransport:meta(calls)})).status,503);
 assert.equal((await(await openUploadApi(request('status'),openEnv,s)).json()).enabled,false);assert.equal(calls.length,1);
});
test('open routes require same-origin consent before any provider call',async()=>{
 const s=new Memory(),source=await png(),calls:string[]=[];
 for(const header of ['Origin','X-Wardrobe-Consent','X-Wardrobe-Context-Consent']){
  const r=request('discover',source);r.headers.delete(header);
  assert.equal((await openUploadApi(r,openEnv,s,{metaTransport:meta(calls)})).status,403);
 }
 assert.deepEqual(calls,[]);
});
test('Worker isolates open browser sessions and keeps pilot history in its original object',async()=>{
 const objects=new Map<string,Memory>();
 const e:any={...openEnv,ASSETS:{fetch:async()=>new Response('ok')},META_TRIAL:{idFromName:(n:string)=>n,get:(id:string)=>{let s=objects.get(id);if(!s){s=new Memory();objects.set(id,s);}return new MetaTrial({storage:s},e as any);}}};
 const first=await worker.fetch(new Request(origin+'/api/processing/status'),e as any),cookie=first.headers.get('set-cookie')!.split(';')[0];
 assert.equal((await first.json()).enabled,true);assert.match(cookie,/__Host-wardrobe-open=/);
 await worker.fetch(new Request(origin+'/api/processing/status',{headers:{cookie}}),e as any);assert.equal(objects.size,2);
 await worker.fetch(new Request(origin+'/api/processing/status'),e as any);assert.equal(objects.size,3);
 assert.equal((await worker.fetch(request('discover',await png()),e as any)).status,403);
 assert.equal((await worker.fetch(new Request(origin+'/api/ordinary/history'),e as any)).status,404);assert.ok(!objects.has(ordinaryObject));
});

test('duplicate discovery request cannot dispatch twice',async()=>{const s=new Memory(),calls:string[]=[],r=request('discover',await png());const copy=r.clone();const opts={metaTransport:meta(calls)};const responses=await Promise.all([openUploadApi(r,openEnv,s,opts),openUploadApi(copy,openEnv,s,opts)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(calls.length,1);});

test('reported usage above the total budget closes later dispatch instead of bypassing the allowance',async()=>{const s=new Memory(),calls:string[]=[],source=await png();const opts={metaTransport:async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}],usage:{prompt_tokens:3000000,completion_tokens:100,total_tokens:3000100}}),openaiTransport:openai(calls)};const d=await(await openUploadApi(request('discover',source),openEnv,s,opts)).json();const piece=d.items[0],context=await encodeRgbaPng(discoveredContextPixels(await pngPixels(source),piece));const r=await openUploadApi(request('finish',{source:Buffer.from(source).toString('base64'),manifest:d.items,pieceId:piece.id,context:Buffer.from(context).toString('base64')},'',d.ordinaryJobId),openEnv,s,opts);assert.ok(r.status>=400,await r.clone().text());assert.deepEqual(calls,[]);assert.equal((await(await openUploadApi(request('status'),openEnv,s)).json()).enabled,false);});

const recoveryRequest=(source:string,requestId:string,job='',proof='c'.repeat(64),trusted='c'.repeat(64))=>new Request(origin+'/api/ordinary/job',{headers:{Origin:origin,'X-Wardrobe-Source-Sha256':source,'X-Wardrobe-Discovery-Request':requestId,'X-Wardrobe-Upload-Job':job,'X-Wardrobe-Original-Session':proof,'X-Wardrobe-Session-Proof':trusted}});
test('recovery finds the same discovery job after a lost response and never dispatches another discovery',async()=>{
 const s=new Memory(),calls:string[]=[],source=await png(),r=request('discover',source),id=r.headers.get('x-wardrobe-request-id')!,copy=r.clone();
 const first=await(await openUploadApi(r,openEnv,s,{metaTransport:meta(calls)})).json();
 const recovered=await(await openUploadApi(recoveryRequest(first.sourceSha256,id),openEnv,s)).json();assert.equal(recovered.state,'ready');assert.equal(recovered.discovery,'completed');assert.equal(recovered.ordinaryJobId,first.ordinaryJobId);
 assert.equal((await openUploadApi(copy,openEnv,s,{metaTransport:meta(calls)})).status,409);assert.deepEqual(calls,['meta']);
 assert.equal((await(await openUploadApi(recoveryRequest(first.sourceSha256,id),openEnv,new Memory())).json()).state,'not_started');
 assert.equal((await(await openUploadApi(recoveryRequest(first.sourceSha256,id,'','d'.repeat(64)),openEnv,new Memory())).json()).state,'unavailable');
 assert.equal((await(await openUploadApi(recoveryRequest(first.sourceSha256,'',first.ordinaryJobId),openEnv,new Memory())).json()).state,'unavailable');
});
test('recovery reports expiry without extending the job or invoking a provider',async()=>{const s=new Memory(),calls:string[]=[],r=request('discover',await png()),id=r.headers.get('x-wardrobe-request-id')!,time=100000;const first=await(await openUploadApi(r,openEnv,s,{now:()=>time,metaTransport:meta(calls)})).json();const recovered=await(await openUploadApi(recoveryRequest(first.sourceSha256,id,first.ordinaryJobId),openEnv,s,{now:()=>time+31*60000})).json();assert.equal(recovered.state,'expired');assert.equal(recovered.ordinaryJobExpiresAt,first.ordinaryJobExpiresAt);assert.deepEqual(calls,['meta']);});
test('Worker overwrites client session-proof headers before declaring a request unattempted',async()=>{const objects=new Map<string,Memory>(),e:any={...openEnv,ASSETS:{fetch:async()=>new Response('ok')},META_TRIAL:{idFromName:(n:string)=>n,get:(id:string)=>{let s=objects.get(id);if(!s){s=new Memory();objects.set(id,s);}return new MetaTrial({storage:s},e as any);}}};const status=await worker.fetch(new Request(origin+'/api/ordinary/status'),e as any),cookie=status.headers.get('set-cookie')!.split(';')[0],value=await status.json();assert.match(value.ordinarySession,/^[a-f0-9]{64}$/);const query=recoveryRequest('a'.repeat(64),crypto.randomUUID(),'','d'.repeat(64),'d'.repeat(64));query.headers.set('Cookie',cookie);assert.equal((await(await worker.fetch(query,e as any)).json()).state,'unavailable');});
test('server recovery preserves an uncertain billed finish and refuses its repetition',async()=>{const s=new Memory(),calls:string[]=[],source=await png(),r=request('discover',source),id=r.headers.get('x-wardrobe-request-id')!,first=await(await openUploadApi(r,openEnv,s,{metaTransport:meta(calls)})).json(),piece=first.items[0],context=await encodeRgbaPng(discoveredContextPixels(await pngPixels(source),piece)),body={source:Buffer.from(source).toString('base64'),manifest:first.items,pieceId:piece.id,context:Buffer.from(context).toString('base64')};let edits=0;const opts={openaiTransport:async()=>{edits++;throw Error('uncertain provider outcome');}};assert.equal((await openUploadApi(request('finish',body,'',first.ordinaryJobId),openEnv,s,opts)).status,502);const recovered=await(await openUploadApi(recoveryRequest(first.sourceSha256,id,first.ordinaryJobId),openEnv,s)).json();assert.equal(recovered.state,'blocked');assert.equal(recovered.finishes[piece.id],'unknown');assert.equal((await openUploadApi(request('finish',body,'',first.ordinaryJobId),openEnv,s,opts)).status,409);assert.equal(edits,1);});
