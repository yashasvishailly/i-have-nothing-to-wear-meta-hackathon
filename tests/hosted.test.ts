import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {hostedApi,secondSyntheticTrial,blazerDiagnosticTrial,type Store,type HostedEnv} from '../src/server/hosted';
import {imageHash} from '../src/server/routes';
import {crc32} from '../src/server/png';
class MemoryStore implements Store {
 values=new Map<string,unknown>();tail=Promise.resolve();
 async get<T>(key:string){return structuredClone(this.values.get(key)) as T|undefined;}
 async put<T>(key:string,value:T){this.values.set(key,structuredClone(value));}
 async transaction<T>(fn:(store:Store)=>Promise<T>){let release!:()=>void;const previous=this.tail;this.tail=new Promise<void>(r=>release=r);await previous;try{return await fn(this);}finally{release();}}
}
function chunk(type:string,data:Buffer){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,b.length-4)),b.length-4);return b;}
const h=Buffer.alloc(13);h.writeUInt32BE(320);h.writeUInt32BE(334,4);h[8]=8;h[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.alloc(320*334*4+334))),chunk('IEND',Buffer.alloc(0))]);
const hash=await imageHash(png),origin='https://wardrobe.example',timestamp=1000000;
const env:HostedEnv={APP_ORIGIN:origin,MODEL_API_KEY:'fixture-only',WARDROBE_LIVE_MODE:'approved',WARDROBE_APPROVED_IMAGE_SHA256:hash,WARDROBE_APPROVAL_EXPIRES_AT:new Date(timestamp+60000).toISOString(),WARDROBE_MAX_CALLS:'3'};
const request=(id=crypto.randomUUID(),headers:Record<string,string>={})=>new Request(origin+'/api/segment',{method:'POST',headers:{origin,'content-type':'image/png','x-wardrobe-consent':'image-v1','x-wardrobe-concept':'bag','x-wardrobe-image-sha256':hash,'x-wardrobe-request-id':id,...headers},body:png});
const text=readFileSync(new URL('./fixtures/sam-button.txt',import.meta.url),'utf8').trim();
const stream=()=>new Response([{type:'response.output_text.done',item_id:'fixture',output_index:0,content_index:0,text},{type:'response.completed'}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});

test('hosted trial fails closed before secret access for disabled, bad origin, broad scope and expired approvals',async()=>{
 const secret={get MODEL_API_KEY():string{throw Error('must not inspect secret');}};
 for(const overrides of [{WARDROBE_LIVE_MODE:'disabled'},{APP_ORIGIN:'https://elsewhere.example'},{WARDROBE_MAX_CALLS:'8'},{WARDROBE_APPROVED_IMAGE_SHA256:hash+','+hash},{WARDROBE_APPROVAL_EXPIRES_AT:new Date(timestamp-1).toISOString()}]){
  const e={...env,...overrides};Object.defineProperty(e,'MODEL_API_KEY',Object.getOwnPropertyDescriptor(secret,'MODEL_API_KEY')!);
  assert.equal((await hostedApi(request(),e,new MemoryStore(),{now:()=>timestamp})).status,503);
 }
});
test('persistent global budget survives handler restarts, rejects replay and config changes, stores no image or key',async()=>{
 const store=new MemoryStore();let calls=0;const options={now:()=>timestamp,transport:async()=>{calls++;return stream();}};
 const first=crypto.randomUUID();assert.equal((await hostedApi(request(first),env,store,options)).status,200);
 assert.equal((await hostedApi(request(first),env,store,options)).status,409);
 assert.equal((await hostedApi(request(),{...env,WARDROBE_MAX_CALLS:'2'},store,options)).status,409);
 assert.equal((await hostedApi(request(),env,store,options)).status,200);
 assert.equal((await hostedApi(request(),env,store,options)).status,200);
 assert.equal((await hostedApi(request(),env,store,options)).status,429);assert.equal(calls,3);
 const status=await (await hostedApi(new Request(origin+'/api/status'),env,store,options)).json();assert.equal(status.remainingCalls,0);assert.equal(status.uploadsEnabled,false);
 const stored=JSON.stringify([...store.values]);assert.ok(!stored.includes('fixture-only')&&!stored.includes('data:image')&&!stored.includes(hash));
});
test('concurrent hosted isolates reserve atomically; upstream errors still consume attempts; reasoning stays disabled',async()=>{
 const store=new MemoryStore();let enter!:()=>void,release!:()=>void,calls=0;const entered=new Promise<void>(r=>enter=r),held=new Promise<Response>(r=>release=()=>r(new Response('private upstream response',{status:401})));
 const options={now:()=>timestamp,transport:async()=>{calls++;enter();return held;}};
 const first=hostedApi(request(),env,store,options);await entered;assert.equal((await hostedApi(request(),env,store,options)).status,409);release();assert.equal((await first).status,502);assert.equal(calls,1);
 const record=await store.get<{used:number}>('trial');assert.equal(record?.used,1);
 const reasoning=await hostedApi(new Request(origin+'/api/outfits',{method:'POST',headers:{origin},body:'{}'}),{...env,WARDROBE_ALLOW_REASONING:'approved'},store,options);assert.equal(reasoning.status,403);assert.equal(calls,1);
});

test('revised seven-category trial never exceeds seven attempts across handler instances',async()=>{
 const store=new MemoryStore();let calls=0;const revised={...env,WARDROBE_MAX_CALLS:'7'};
 const options={now:()=>timestamp,transport:async()=>{calls++;return stream();}};
 for(const concept of ['top','skirt','shoes','sunglasses','bag','watch','necklace'])assert.equal((await hostedApi(request(crypto.randomUUID(),{'x-wardrobe-concept':concept}),revised,store,options)).status,200);
 assert.equal((await hostedApi(request(),revised,store,options)).status,429);assert.equal(calls,7);
 const status=await (await hostedApi(new Request(origin+'/api/status'),revised,store,options)).json();assert.equal(status.uploadsEnabled,false);assert.equal(status.remainingCalls,0);
});

test('separate accessories allowance preserves the original seven, permits exactly three distinct approved categories',async()=>{
 const {originalTrial,accessoriesTrial,trialAudit}=await import('../src/server/hosted');
 const oldStore=new MemoryStore(),newStore=new MemoryStore();let calls=0;const options={now:()=>timestamp,transport:async()=>{calls++;return stream();}};
 for(let i=0;i<7;i++)assert.equal((await hostedApi(request(),{...env,WARDROBE_TRIAL_ID:originalTrial,WARDROBE_MAX_CALLS:'7'},oldStore,options)).status,200);
 const snapshot=JSON.stringify([...oldStore.values]);
 const scoped={...env,WARDROBE_TRIAL_ID:accessoriesTrial,WARDROBE_MAX_CALLS:'3'};
 assert.equal((await hostedApi(request(crypto.randomUUID(),{'x-wardrobe-concept':'top'}),scoped,newStore,options)).status,403);assert.equal(calls,7);
 assert.equal((await hostedApi(request(crypto.randomUUID(),{'x-wardrobe-concept':'shoes'}),scoped,newStore,options)).status,200);
 const duplicate=await hostedApi(request(crypto.randomUUID(),{'x-wardrobe-concept':'shoes'}),scoped,newStore,options);assert.equal(duplicate.status,409);assert.equal((await duplicate.json()).error,'duplicate_concept');assert.equal(calls,8);
 for(const concept of ['bag','sunglasses'])assert.equal((await hostedApi(request(crypto.randomUUID(),{'x-wardrobe-concept':concept}),scoped,newStore,options)).status,200);
 assert.equal((await hostedApi(request(),scoped,newStore,options)).status,429);assert.equal(calls,10);
 assert.deepEqual(await trialAudit(oldStore),{used:7});assert.deepEqual(await trialAudit(newStore),{used:3});assert.equal(JSON.stringify([...oldStore.values]),snapshot);
 const history=JSON.stringify([...newStore.values]);assert.ok(!history.includes('fixture-only')&&!history.includes(hash)&&!history.includes('data:image'));
});
test('new category allowance cannot expand its fixed cap or select an arbitrary trial',async()=>{
 for(const overrides of [{WARDROBE_TRIAL_ID:'unapproved-new-id'},{WARDROBE_TRIAL_ID:'synthetic-accessories-trial-v2',WARDROBE_MAX_CALLS:'4'}]){const settings={...env,...overrides};Object.defineProperty(settings,'MODEL_API_KEY',{get(){throw Error('must not read secret');}});assert.equal((await hostedApi(request(),settings,new MemoryStore(),{now:()=>timestamp})).status,503);}
});

 test('second synthetic photo has a distinct exact five-concept allowance without resetting historical trials',async()=>{const e={...env,WARDROBE_TRIAL_ID:secondSyntheticTrial,WARDROBE_MAX_CALLS:'5'},s=new MemoryStore();let calls=0;const options={now:()=>timestamp,transport:async()=>{calls++;return stream();}};for(const concept of ['top','jeans','jacket','shoes','bag']){assert.equal((await hostedApi(request(crypto.randomUUID(),{'x-wardrobe-concept':concept}),e,s,options)).status,200);assert.equal((await hostedApi(request(crypto.randomUUID(),{'x-wardrobe-concept':concept}),e,s,options)).status,concept==='bag'?429:409);}assert.equal(calls,5);assert.equal((await s.get<any>('trial')).used,5);assert.equal((await hostedApi(request(),{...e,WARDROBE_MAX_CALLS:'6'},new MemoryStore(),options)).status,503);assert.equal((await hostedApi(request(crypto.randomUUID(),{'x-wardrobe-concept':'necklace'}),e,new MemoryStore(),options)).status,403);assert.equal(calls,5);});

test('one-call blazer diagnostic is exact scope, counts-only, no reasoning or repeat',async()=>{const e={...env,WARDROBE_TRIAL_ID:blazerDiagnosticTrial,WARDROBE_MAX_CALLS:'1'},s=new MemoryStore();let calls=0;const options={now:()=>timestamp,transport:async(_url:any,init:any)=>{calls++;const body=JSON.parse(init.body);assert.equal(body.input[0].content[0].text,'blazer');return stream();}};const r=await hostedApi(request(crypto.randomUUID(),{'x-wardrobe-concept':'blazer'}),e,s,options);assert.equal(r.status,200);const d=await r.json();assert.equal(d.diagnostics.upstreamStatus,200);assert.equal(d.diagnostics.records.mask,2);assert.equal(d.diagnostics.terminal,'completed');assert.equal((await hostedApi(request(crypto.randomUUID(),{'x-wardrobe-concept':'blazer'}),e,s,options)).status,429);assert.equal(calls,1);assert.equal((await hostedApi(request(),{...e,WARDROBE_MAX_CALLS:'2'},new MemoryStore(),options)).status,503);assert.equal((await hostedApi(request(crypto.randomUUID(),{'x-wardrobe-concept':'jacket'}),e,new MemoryStore(),options)).status,403);});
