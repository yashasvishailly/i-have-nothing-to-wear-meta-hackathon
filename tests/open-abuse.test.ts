import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openAbuseApi,openAbuseLimits,guardedOpenRequest,openAbuseObject} from '../src/server/open-abuse';
import worker,{MetaTrial} from '../src/worker';
import type {Store} from '../src/server/hosted';
class Memory implements Store {
 data=new Map<string,any>();tail=Promise.resolve();alarm=0;
 async get<T>(key:string){return structuredClone(this.data.get(key)) as T|undefined;}
 async put<T>(key:string,value:T){this.data.set(key,structuredClone(value));}
 async transaction<T>(fn:(s:Store)=>Promise<T>){const old=this.tail;let release!:()=>void;this.tail=new Promise(r=>release=r);await old;try{return await fn(this);}finally{release();}}
 async setAlarm(time:number){this.alarm=time;}async deleteAll(){this.data.clear();}
}
const origin='https://wardrobe.example',session='a'.repeat(64);
function command(action='reserve',who=session,stage='discover',ticket=crypto.randomUUID()) {return new Request(origin+'/_internal/open-abuse',{method:'POST',body:JSON.stringify({action,session:who,stage,ticket})});}
const upload=()=>new Request(origin+'/api/ordinary/discover',{method:'POST',headers:{Origin:origin,'Content-Type':'image/png','X-Wardrobe-Consent':'photo-pipeline-v1','X-Wardrobe-Context-Consent':'source-context-v1'},body:'fixture'});
function binding(store:Memory){return{idFromName:(id:string)=>id,get:(id:unknown)=>{assert.equal(id,openAbuseObject);return{fetch:(r:Request)=>openAbuseApi(r,store,1000)};}};}
test('atomic admission allows exactly one in-flight request per browser',async()=>{
 const s=new Memory();const results=await Promise.all(Array.from({length:8},()=>openAbuseApi(command(),s,1000)));
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.status===429).length,7);
 assert.equal(results.find(r=>r.status===429)!.headers.get('Retry-After'),'5');
});
test('new or spoofed browser tokens cannot bypass global concurrency',async()=>{
 const s=new Memory();const results=await Promise.all(Array.from({length:10},(_,n)=>openAbuseApi(command('reserve',n.toString(16).padStart(64,'0')),s,1000)));
 assert.equal(results.filter(r=>r.ok).length,openAbuseLimits.globalConcurrent);
});
test('lease cleanup recovers a crashed request without resetting rolling limits',async()=>{
 const s=new Memory();assert.equal((await openAbuseApi(command(),s,1000)).status,200);
 assert.equal((await openAbuseApi(command(),s,1001)).status,429);
 assert.equal((await openAbuseApi(command(),s,1000+openAbuseLimits.leaseMs)).status,200);
 assert.equal(s.data.get('open-abuse').events.length,2);
});
test('browser rate window renews without a lifetime photo cap and release cannot erase another lease',async()=>{
 const s=new Memory();for(let n=0;n<6;n++){const id=crypto.randomUUID();assert.equal((await openAbuseApi(command('reserve',session,'discover',id),s,1000)).status,200);await openAbuseApi(command('release',session,'discover',id),s,1000);}
 const limited=await openAbuseApi(command(),s,1001);assert.equal(limited.status,429);assert.equal((await limited.json()).error,'admission_rate_limit');
 assert.equal((await openAbuseApi(command(),s,1000+openAbuseLimits.windowMs)).status,200);
 const ledger=s.data.get('open-abuse');await openAbuseApi(command('release','b'.repeat(64),'discover',ledger.leases[0].id),s,1000+openAbuseLimits.windowMs);
 assert.equal(s.data.get('open-abuse').leases.length,1);
});
test('global rolling discovery rate holds across fresh browser sessions',async()=>{
 const s=new Memory();for(let n=0;n<30;n++){const who=n.toString(16).padStart(64,'0'),id=crypto.randomUUID();assert.equal((await openAbuseApi(command('reserve',who,'discover',id),s,1000)).status,200);await openAbuseApi(command('release',who,'discover',id),s,1000);}
 assert.equal((await openAbuseApi(command('reserve','f'.repeat(64)),s,1000)).status,429);
});
test('guard validates consent/type/declared size and denies without invoking processing',async()=>{
 const s=new Memory();let calls=0;const run=async()=>{calls++;return Response.json({ok:true});};
 for(const header of ['Origin','X-Wardrobe-Consent','X-Wardrobe-Context-Consent']){const r=upload();r.headers.delete(header);assert.equal((await guardedOpenRequest(r,session,binding(s),run)).status,403);}
 const wrong=upload();wrong.headers.set('Content-Type','image/svg+xml');assert.equal((await guardedOpenRequest(wrong,session,binding(s),run)).status,400);
 const large=upload();large.headers.set('Content-Length',String(7*1024*1024));assert.equal((await guardedOpenRequest(large,session,binding(s),run)).status,413);
 for(let n=0;n<6;n++)await openAbuseApi(command('reserve',n.toString(16).padStart(64,'0')),s,1000);assert.equal((await guardedOpenRequest(upload(),session,binding(s),run)).status,429);assert.equal(calls,0);
});
test('guard releases success/error reservations and fails closed if storage is unavailable',async()=>{
 const s=new Memory();assert.equal((await guardedOpenRequest(upload(),session,binding(s),async()=>Response.json({ok:true}))).status,200);
 assert.equal(s.data.get('open-abuse').leases.length,0);
 assert.equal((await guardedOpenRequest(upload(),session,binding(s),async()=>{throw Error('private upstream error');})).status,503);
 assert.equal(s.data.get('open-abuse').leases.length,0);
 const failed={idFromName:(id:string)=>id,get:()=>({fetch:async()=>{throw Error('storage');}})};
 const r=await guardedOpenRequest(upload(),session,failed,async()=>{assert.fail('must not dispatch');});assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/storage/);
});
test('short-lived guard records contain only hashed sessions, stages, timestamps and random leases',async()=>{
 const s=new Memory();await guardedOpenRequest(upload(),session,binding(s),async()=>Response.json({ok:true}));
 const stored=JSON.stringify([...s.data.values()]);assert.ok(!stored.includes(session));assert.doesNotMatch(stored,/fixture|sourceHash|photo|address|cookie/);
 assert.equal(s.alarm,1000+openAbuseLimits.windowMs);
 await s.put('open-abuse-expires',Date.now()-1);await new MetaTrial({storage:s},{} as any).alarm();assert.equal(s.data.size,0);
});
test('public history and internal routes cannot reveal operator metadata in open mode',async()=>{
 const env={APP_ORIGIN:origin,WARDROBE_ORDINARY_MODE:'open',ASSETS:{fetch:async()=>{assert.fail('must not use asset fallback');}},META_TRIAL:{idFromName:()=>{assert.fail('must not inspect ledger');}}};
 for(const path of ['/api/ordinary/history','/api/processing/history','/api/reconstruction/history','/api/trial-history','/_internal/open-abuse'])assert.equal((await worker.fetch(new Request(origin+path),env as any)).status,404);
});
