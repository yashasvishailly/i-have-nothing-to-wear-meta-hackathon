import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createMetaApi, imageHash } from '../src/server/routes.ts';
import { crc32 } from '../src/server/png.ts';
import { conceptCategories } from '../src/concepts.ts';
import { demo } from '../src/fixtures.ts';
import { initial } from '../src/core.ts';
import { inventoryMetadata, segmentPhoto, requestOutfits, ApiError } from '../src/api.ts';
const origin = 'http://127.0.0.1:4180';
function chunk(type: string, data: Buffer) { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, b.length - 4)), b.length - 4); return b; }
export function pngFixture() { const h = Buffer.alloc(13); h.writeUInt32BE(320); h.writeUInt32BE(334, 4); h[8] = 8; h[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', h), chunk('IDAT', deflateSync(Buffer.alloc(320 * 334 * 4 + 334))), chunk('IEND', Buffer.alloc(0))]); }
const png = pngFixture(); const hash = await imageHash(png);
const maskText = readFileSync(new URL('./fixtures/sam-button.txt', import.meta.url), 'utf8').trim();
const stream = () => new Response([{ type:'response.output_text.delta', item_id:'mock', output_index:0, content_index:0, delta:maskText },{ type:'response.output_text.done',item_id:'mock',output_index:0,content_index:0,text:maskText },{type:'response.completed'}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''), {headers:{'content-type':'text/event-stream'}});
const timestamp=1000000;
const env = (extra={}) => ({ MODEL_API_KEY:'fixture-not-a-real-key',WARDROBE_LIVE_MODE:'approved',WARDROBE_APPROVED_IMAGE_SHA256:hash,WARDROBE_APPROVAL_EXPIRES_AT:new Date(timestamp+60000).toISOString(),WARDROBE_MAX_CALLS:'10',...extra });
const request=(path='/api/segment', extra: Record<string,string>={}, body:BodyInit=png, signal?:AbortSignal)=>new Request(origin+path,{method:'POST',headers:{origin,'content-type':'image/png','x-wardrobe-consent':'image-v1','x-wardrobe-concept':'shirt','x-wardrobe-image-sha256':hash,'x-wardrobe-request-id':crypto.randomUUID(),...extra},body,signal});

test('disabled, incomplete, expired and hosted gates never inspect a key or invoke a provider',async()=>{
 let calls=0,reads=0;const secret={get MODEL_API_KEY(){reads++;throw Error('must not read');}};
 for(const [settings,hosted]of [[secret,false],[{...env(),MODEL_API_KEY:undefined},false],[env(),true],[env({WARDROBE_APPROVAL_EXPIRES_AT:new Date(timestamp-1).toISOString()}),false],[env({WARDROBE_MAX_CALLS:'100'}),false]] as const){
  const api=createMetaApi(settings,{hosted,now:()=>timestamp,transport:async()=>{calls++;return stream();}});
  assert.equal(api.status().uploadsEnabled,false);assert.equal((await api.handle(request())).status,503);
 }
 const hosted=createMetaApi({...env(),get MODEL_API_KEY(){reads++;throw Error('must not inspect hosted key');}},{hosted:true,now:()=>timestamp});assert.equal(hosted.status().uploadsEnabled,false);assert.equal(reads,0);assert.equal(calls,0);
});
test('origin, consent, PNG, exact photo scope and concept checks reject before provider dispatch',async()=>{
 let calls=0;const api=createMetaApi(env(),{now:()=>timestamp,transport:async()=>{calls++;return stream();}});
 for(const [headers,status]of [[{origin:'https://elsewhere.invalid'},403],[{'x-wardrobe-consent':''},403],[{'content-type':'image/jpeg'},415],[{'x-wardrobe-image-sha256':'0'.repeat(64)},403],[{'x-wardrobe-concept':'all clothing'},400],[{'content-length':String(8*1024*1024+1)},413]] as const)assert.equal((await api.handle(request('/api/segment',headers))).status,status);
 assert.equal((await api.handle(request('/api/segment',{},'corrupt PNG'))).status,400);assert.equal(calls,0);assert.equal(api.status().remainingCalls,10);
});
test('every new skirt, bag and accessory concept reaches the documented SAM contract using mock transport only',async()=>{
 for(const concept of ['skirt','bag','bracelet','ring','watch','sunglasses','necklace','earrings','coat','jeans']){
  let calls=0;const api=createMetaApi(env(),{now:()=>timestamp,transport:async(url,init)=>{calls++;assert.equal(url,'https://api.meta.ai/v1/responses');assert.equal(JSON.parse(String(init.body)).input[0].content[0].text,concept);return stream();}});
  const response=await api.handle(request('/api/segment',{'x-wardrobe-concept':concept}));assert.equal(response.status,200);const body=await response.json();assert.equal(body.masks.length,2);assert.equal(body.reconstruction,false);assert.equal(body.imageSha256,hash);assert.equal(calls,1);
 }
 assert.equal(conceptCategories.skirt,'bottom');assert.equal(conceptCategories.bag,'accessory');
});
test('duplicate requests and call limits prevent repeat dispatch, and expiry closes an existing session',async()=>{
 let calls=0,clock=timestamp;const api=createMetaApi(env({WARDROBE_MAX_CALLS:'2'}),{now:()=>clock,transport:async()=>{calls++;return stream();}});const id=crypto.randomUUID();
 assert.equal((await api.handle(request('/api/segment',{'x-wardrobe-request-id':id}))).status,200);
 assert.equal((await api.handle(request('/api/segment',{'x-wardrobe-request-id':id}))).status,409);
 assert.equal((await api.handle(request())).status,200);assert.equal((await api.handle(request())).status,429);assert.equal(calls,2);assert.equal(api.status().uploadsEnabled,false);
 const fresh=createMetaApi(env(),{now:()=>clock,transport:async()=>{calls++;return stream();}});clock+=61000;assert.equal((await fresh.handle(request())).status,503);assert.equal(calls,2);
});
test('concurrent requests cannot double-dispatch; failed calls consume a reservation without leaking content',async()=>{
 let enter!:()=>void,release!:()=>void,calls=0;const entered=new Promise<void>(r=>enter=r),pending=new Promise<Response>(r=>release=()=>r(stream()));
 const api=createMetaApi(env(),{now:()=>timestamp,transport:async()=>{calls++;enter();return pending;}});const first=api.handle(request());await entered;assert.equal((await api.handle(request())).status,409);release();assert.equal((await first).status,200);assert.equal(calls,1);
 const bad=createMetaApi(env({WARDROBE_MAX_CALLS:'1'}),{now:()=>timestamp,transport:async()=>new Response('private upstream body and fixture-not-a-real-key',{status:401})});const response=await bad.handle(request());assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'authentication',providerStatus:401,diagnostics:{stage:'http'}});assert.equal(bad.status().remainingCalls,0);
});
test('outfit route accepts explicit metadata consent, excludes images and rejects image-bearing inventory',async()=>{
 const state=initial();state.items=demo().items;state.items.forEach(i=>i.confirmed=true);const ids=state.items.slice(0,3).map(i=>i.id);let calls=0;
 const api=createMetaApi(env({WARDROBE_ALLOW_REASONING:'approved'}),{now:()=>timestamp,transport:async(url,init)=>{calls++;assert.equal(url,'https://api.meta.ai/v1/chat/completions');assert.ok(!String(init.body).includes('data:image'));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({looks:[{ids,reason:'Mock structured reasoning.'}]})}}]});}});
 const headers={'content-type':'application/json','x-wardrobe-consent':'metadata-v1'};const body={items:inventoryMetadata(state.items),profile:state.profile};
 assert.equal((await api.handle(request('/api/outfits',headers,JSON.stringify(body)))).status,200);
 const tainted={...body,items:body.items.map(i=>({...i,image:'must-not-be-transmitted'}))};assert.equal((await api.handle(request('/api/outfits',headers,JSON.stringify(tainted)))).status,400);
 assert.equal((await api.handle(request('/api/outfits',{...headers,'x-wardrobe-consent':''},JSON.stringify(body)))).status,403);assert.equal(calls,1);
});
test('browser transport refuses absent consent, sends only the approved PNG or metadata, and maps safe errors',async()=>{
 let calls=0;const transport=(async()=>{calls++;return Response.json({error:'photo_not_approved'},{status:403});}) as typeof fetch;
 await assert.rejects(segmentPhoto(new Blob([png]),'bag',hash,false,new AbortController().signal,transport),e=>e instanceof ApiError&&e.code==='image_consent_required');assert.equal(calls,0);
 await assert.rejects(segmentPhoto(new Blob([png]),'bag',hash,true,new AbortController().signal,transport),e=>e instanceof ApiError&&e.code==='photo_not_approved');assert.equal(calls,1);
 const state=initial();state.items=demo().items;await assert.rejects(requestOutfits(state.items,state.profile,false,new AbortController().signal,transport));assert.equal(calls,1);
});
test('request cancellation propagates upstream, consumes its reserved attempt and never retries',async()=>{
 let enter!:()=>void,calls=0,aborted=0;const entered=new Promise<void>(r=>enter=r);const controller=new AbortController();
 const api=createMetaApi(env({WARDROBE_MAX_CALLS:'1'}),{now:()=>timestamp,transport:async(_url,init)=>{calls++;enter();return new Promise((_ok,no)=>init.signal!.addEventListener('abort',()=>{aborted++;no(Error('fixture abort'));},{once:true}));}});
 const pending=api.handle(request('/api/segment',{},png,controller.signal));await entered;controller.abort();const response=await pending;assert.equal(response.status,408);assert.equal(calls,1);assert.equal(aborted,1);assert.equal(api.status().remainingCalls,0);
});
test('incomplete eligible inventory is rejected before reserving an attempt or calling a model',async()=>{
 let calls=0;const api=createMetaApi(env({WARDROBE_ALLOW_REASONING:'approved'}),{now:()=>timestamp,transport:async()=>{calls++;throw Error('not allowed');}});
 const response=await api.handle(request('/api/outfits',{'content-type':'application/json','x-wardrobe-consent':'metadata-v1'},JSON.stringify({items:[],profile:initial().profile})));assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'insufficient_inventory'});assert.equal(calls,0);assert.equal(api.status().remainingCalls,10);
});

test('SAM route returns content-free structural diagnostics and consumes a failed attempt without retry',async()=>{
 let calls=0;const secretMarker='private_body_or_key_must_not_escape';
 const api=createMetaApi(env({WARDROBE_MAX_CALLS:'1'}),{now:()=>timestamp,transport:async()=>{calls++;return new Response('data: '+JSON.stringify({type:'response.failed',response:{error:{message:secretMarker}}})+'\n\n',{headers:{'content-type':'text/event-stream'}});}});
 const response=await api.handle(request());assert.equal(response.status,502);const result=await response.json();assert.equal(result.providerStatus,200);assert.equal(result.diagnostics.stage,'segmentation');assert.equal(result.diagnostics.terminal,'failed');assert.equal(result.diagnostics.validation,'upstream_failed');assert.equal(result.diagnostics.events,1);assert.ok(!JSON.stringify(result).includes(secretMarker));assert.equal(api.status().remainingCalls,0);assert.equal(calls,1);
});
