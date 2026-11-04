import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker';
test('hosted Worker never reads secrets, serves disabled status and blocks all provider routes',async()=>{
 const env={ASSETS:{fetch:async()=>new Response('safe app',{headers:{'Content-Type':'text/html'}})},get MODEL_API_KEY(){throw Error('secret accessed');}};
 const response=await worker.fetch(new Request('https://wardrobe.example/api/status'),env);
 assert.equal(response.status,200);const status=await response.json();assert.equal(status.uploadsEnabled,false);assert.equal(status.remainingCalls,0);
 for(const path of ['segment','outfits'])assert.equal((await worker.fetch(new Request('https://wardrobe.example/api/'+path,{method:'POST',body:'private bytes stay here'}),env)).status,503);
 const asset=await worker.fetch(new Request('https://wardrobe.example/'),env);assert.equal(await asset.text(),'safe app');assert.match(asset.headers.get('Content-Security-Policy')!,/connect-src 'self'/);
});

test('disabled history reads only count metadata from fixed historical and second-photo objects; unknown trials fail closed',async()=>{
 const seen:string[]=[];const env={APP_ORIGIN:'https://wardrobe.example',WARDROBE_LIVE_MODE:'disabled',ASSETS:{fetch:async()=>new Response('safe')},META_TRIAL:{idFromName:(id:string)=>id,get:(id:unknown)=>({fetch:async(request:Request)=>{assert.equal(new URL(request.url).pathname,'/_internal/trial-audit');seen.push(String(id));return Response.json({used:id==='initial-one-photo-trial-v1'?7:id==='synthetic-accessories-trial-v2'?3:0});}})},get MODEL_API_KEY():string{throw Error('must not read key');}};
 const history=await worker.fetch(new Request('https://wardrobe.example/api/trial-history'),env);assert.equal(history.status,200);const result=await history.json();assert.equal(result.totalUsed,10);assert.deepEqual(seen,['initial-one-photo-trial-v1','synthetic-accessories-trial-v2','second-synthetic-five-trial-v3','second-synthetic-blazer-diagnostic-v1']);
 const disabled=await worker.fetch(new Request('https://wardrobe.example/api/segment',{method:'POST'}),Object.assign(Object.create(env),{WARDROBE_LIVE_MODE:'approved',WARDROBE_TRIAL_ID:'unapproved-reset-id'}));assert.equal(disabled.status,503);assert.equal(seen.length,4);
});
