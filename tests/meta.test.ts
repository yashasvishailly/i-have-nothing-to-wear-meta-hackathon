import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { MetaAdapters, ProviderError } from '../src/server/meta.ts';
import { crc32 } from '../src/server/png.ts';
import { parseMasks, cutoutPixels } from '../src/masks.ts';
import { initial } from '../src/core.ts';
import { demo } from '../src/fixtures.ts';
const text = readFileSync(new URL('./fixtures/sam-button.txt', import.meta.url), 'utf8').trim();
export const events = (delta = text) => [{ type: 'response.output_text.delta', item_id: 'fixture', output_index: 0, content_index: 0, delta }, { type: 'response.output_text.done', item_id: 'fixture', output_index: 0, content_index: 0, text: delta }, { type: 'response.completed' }];
async function* sequence(list: any[]) { yield* list; }
function chunk(type: string, data: Buffer) { const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, b.length - 4)), b.length - 4); return b; }
function png(w = 320, h = 334) { const header = Buffer.alloc(13); header.writeUInt32BE(w); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc((w * 4 + 1) * h))), chunk('IEND', Buffer.alloc(0))]); }
const signal = () => new AbortController().signal;
const config = { approvedLiveMode: true, apiKey: 'test-fixture-not-a-credential' };
test('official documented mask payload parses, keeps box placement and source RGB, removes background', async () => { const records = await parseMasks(sequence(events()), 320, 334); assert.equal(records.length, 2); assert.deepEqual(records[0].bounds, { left: 211, top: 228, right: 271, bottom: 255 }); const rgba = new Uint8ClampedArray(320 * 334 * 4); for (let i = 0; i < rgba.length; i += 4)
    rgba.set([20, 80, 140, 255], i); const result = cutoutPixels(rgba, 320, 334, records[0]); assert.equal(result.width, 60); assert.equal(result.height, 27); const alphas = result.rgba.filter((_, i) => i % 4 === 3); assert.ok(alphas.includes(0)); assert.ok(alphas.includes(255)); for (let i = 0; i < result.rgba.length; i += 4)
    if (result.rgba[i + 3])
        assert.deepEqual([...result.rgba.slice(i, i + 4)], [20, 80, 140, 255]); });
test('SAM documented request and SSE contract via injected mock transport only', async () => { let calls = 0; const client = new MetaAdapters(config, async (url, init) => { calls++; assert.equal(url, 'https://api.meta.ai/v1/responses'); assert.equal(init.redirect, 'manual'); const body = JSON.parse(String(init.body)); assert.equal(body.model, 'sam-3.1'); assert.equal(body.metadata.mask_encoding, 'one_bit'); assert.equal(body.input[0].content[0].text, 'shirt'); assert.ok(body.input[0].content[1].image_url.startsWith('data:image/png;base64,')); return new Response(events().map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } }); }); assert.equal((await client.segment(png(), 'shirt', signal())).length, 2); assert.equal(calls, 1); });
test('disabled mode, corrupt bytes and oversized images never call transport', async () => { let calls = 0; const transport = async () => { calls++; return new Response(); }; await assert.rejects(new MetaAdapters({ ...config, approvedLiveMode: false }, transport).segment(png(), 'shirt', signal()), e => e instanceof ProviderError && e.code === 'disabled'); await assert.rejects(new MetaAdapters(config, transport).segment(new Uint8Array(50), 'shirt', signal())); const broken = png(); broken[50] ^= 1; await assert.rejects(new MetaAdapters(config, transport).segment(broken, 'shirt', signal())); await assert.rejects(new MetaAdapters(config, transport).segment(new Uint8Array(8 * 1024 * 1024 + 1), 'shirt', signal())); assert.equal(calls, 0); });
test('malformed, incomplete and failed SAM output is rejected without exposing provider content', async () => { for (const list of [events('not geometry'), events().slice(0, 1), [{ type: 'response.failed', response: { error: { message: 'private content' } } }]])
    await assert.rejects(parseMasks(sequence(list), 320, 334), e => !String(e).includes('private content')); assert.deepEqual(await parseMasks(sequence(events('')), 320, 334), []); });
test('429, auth failure, timeout and cancellation make at most one attempt', async () => { for (const status of [429, 401]) {
    let calls = 0;
    await assert.rejects(new MetaAdapters(config, async () => { calls++; return new Response('private provider body', { status }); }).segment(png(), 'shirt', signal()), e => e instanceof ProviderError && e.code === (status === 429 ? 'rate_limit' : 'authentication') && !e.message.includes('private'));
    assert.equal(calls, 1);
} await assert.rejects(new MetaAdapters(config, () => new Promise(() => { }), 10).segment(png(), 'shirt', signal()), e => e instanceof ProviderError && e.code === 'timeout'); const c = new AbortController(); c.abort(); await assert.rejects(new MetaAdapters(config).segment(png(), 'shirt', c.signal), e => e instanceof ProviderError && e.code === 'cancelled'); });
test('Muse documented structured contract, metadata only, valid inventory IDs', async () => { const s = initial(); s.items = demo().items; s.items.forEach(i => i.confirmed = true); const ids = s.items.slice(0, 3).map(i => i.id); const client = new MetaAdapters(config, async (url, init) => { assert.equal(url, 'https://api.meta.ai/v1/chat/completions'); const body = JSON.parse(String(init.body)); assert.equal(body.model, 'muse-spark-1.3'); assert.equal(body.response_format.json_schema.strict, true); assert.equal(body.max_completion_tokens, 1500); assert.ok(!String(init.body).includes('data:image')); return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ looks: [{ ids, reason: 'Fixture response, not a live style assessment.' }] }) } }] }); }); const looks = await client.outfits(s.items, s.profile, signal()); assert.deepEqual(looks[0].ids, ids); });
test('Muse refuses hallucinated IDs, repeated IDs, refusal, truncated and malformed JSON', async () => { const s = initial(); s.items = demo().items; s.items.forEach(i => i.confirmed = true); for (const payload of [{ finish_reason: 'stop', message: { content: JSON.stringify({ looks: [{ ids: ['invented'], reason: 'bad' }] }) } }, { finish_reason: 'length', message: { content: '{}' } }, { finish_reason: 'stop', message: { refusal: 'private refusal', content: null } }, { finish_reason: 'stop', message: { content: 'not json' } }])
    await assert.rejects(new MetaAdapters(config, async () => Response.json({ choices: [payload] })).outfits(s.items, s.profile, signal()), e => e instanceof ProviderError && e.code === 'invalid_output'); });
test('corrupt encoded mask and mismatched placement fail before becoming a cut-out', async () => { const records = await parseMasks(sequence(events()), 320, 334); const rgba = new Uint8ClampedArray(320 * 334 * 4); assert.throws(() => cutoutPixels(rgba, 320, 334, { ...records[0], mask: { ...records[0].mask, payload: 'corrupt' } })); assert.throws(() => cutoutPixels(rgba, 320, 334, { ...records[0], bounds: { left: -1, top: 228, right: 271, bottom: 255 } })); });
test('stalled stream times out; oversized output is rejected; no automatic retry', async () => { let calls = 0; await assert.rejects(new MetaAdapters(config, async () => { calls++; return new Response(new ReadableStream({ start() { } }), { headers: { 'content-type': 'text/event-stream' } }); }, 10).segment(png(), 'shirt', signal()), e => e instanceof ProviderError && e.code === 'timeout'); assert.equal(calls, 1); await assert.rejects(new MetaAdapters(config, async () => new Response('x'.repeat(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/event-stream' } })).segment(png(), 'shirt', signal()), e => e instanceof ProviderError && e.code === 'invalid_output'); });

test('SAM content_part.done finalization, fragmented UTF-8 SSE, and empty output follow documented stream contract',async()=>{
 const lane={item_id:'fixture',output_index:0,content_index:0};
 const documented=(value:string)=>[{type:'response.created',response:{status:'in_progress'}},{type:'response.output_text.delta',...lane,delta:value.slice(0,25)},{type:'response.output_text.delta',...lane,delta:value.slice(25)},{type:'response.content_part.done',...lane,part:{type:'output_text',text:value}},{type:'response.completed',response:{status:'completed'}}];
 for(const value of [text,'']){
  const wire=documented(value).map(e=>'event: '+e.type+'\r\ndata: '+JSON.stringify(e)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n';
  const encoded=new TextEncoder().encode(wire);let calls=0;
  const client=new MetaAdapters(config,async()=>{calls++;return new Response(new ReadableStream({start(c){for(let i=0;i<encoded.length;i+=7)c.enqueue(encoded.slice(i,i+7));c.close();}}),{headers:{'content-type':'Text/Event-Stream; charset=utf-8'}});});
  assert.equal((await client.segment(png(),'top',signal())).length,value?2:0);assert.equal(calls,1);
 }
 // Either finalizer is accepted; paired identical finalizers are not duplicate geometry.
 const both=events();both.splice(2,0,{type:'response.content_part.done',...lane,part:{type:'output_text',text}} as any);
 assert.equal((await parseMasks(sequence(both),320,334)).length,2);
});

test('safe diagnostics distinguish transport, HTTP, content type, malformed SSE, upstream failure and geometry rejection',async()=>{
 const privateMarker='PRIVATE_CONTENT_MUST_NOT_ESCAPE';
 const cases:[()=>Promise<Response>,string,string|undefined][]=[
  [async()=>{throw Error(privateMarker);},'transport',undefined],
  [async()=>new Response(privateMarker,{status:402}),'http',undefined],
  [async()=>Response.json({output:[{content:[{text:privateMarker}]}]}),'content_type',undefined],
  [async()=>new Response('data: '+privateMarker+'\n\n',{headers:{'content-type':'text/event-stream'}}),'sse_decode','source'],
  [async()=>new Response('data: '+JSON.stringify({type:'response.failed',response:{error:{message:privateMarker,code:privateMarker}}})+'\n\n',{headers:{'content-type':'text/event-stream'}}),'segmentation','upstream_failed'],
  [async()=>new Response('data: '+JSON.stringify({type:'error',error:{message:privateMarker}})+'\n\n',{headers:{'content-type':'text/event-stream'}}),'segmentation','upstream_error'],
  [async()=>new Response(events(privateMarker).map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}}),'segmentation','unexpected_text'],
 ];
 for(const [response,stage,validation] of cases){let calls=0;await assert.rejects(new MetaAdapters(config,async()=>{calls++;return response();}).segment(png(),'top',signal()),e=>{
  assert.ok(e instanceof ProviderError);assert.equal(e.diagnostics?.stage,stage);assert.equal(e.diagnostics?.validation,validation);assert.ok(!JSON.stringify(e).includes(privateMarker));assert.ok(!e.message.includes(privateMarker));if(stage==='transport'){assert.equal(e.code,'unavailable');assert.equal(e.providerStatus,undefined);}else assert.equal(e.providerStatus,stage==='http'?402:200);return true;
 });assert.equal(calls,1);}
});

test('incomplete, conflicting output lanes and out-of-source mask geometry retain safe distinct failure reasons',async()=>{
 const conflict=events();conflict[1]={...conflict[1],text:'different private content'};
 for(const [list,width,height,reason] of [[events().slice(0,1),320,334,'incomplete'],[conflict,320,334,'lane'],[events(),100,100,'geometry_bounds']] as const){
  await assert.rejects(parseMasks(sequence([...list]),width,height),e=>{assert.equal((e as any).reason,reason);assert.ok(!String(e).includes('private'));return true;});
 }
});


test('Cloudflare-compatible manual redirects never forward a credential or image to a Location target',async()=>{
 for(const status of [301,302,303,307,308]){let calls=0;await assert.rejects(new MetaAdapters(config,async(url,init)=>{calls++;assert.equal(url,'https://api.meta.ai/v1/responses');assert.equal(init.redirect,'manual');return new Response(null,{status,headers:{location:'https://untrusted.invalid/should-never-receive-data'}});}).segment(png(),'top',signal()),e=>{assert.ok(e instanceof ProviderError);assert.equal(e.providerStatus,status);assert.equal(e.diagnostics?.stage,'http');return true;});assert.equal(calls,1);}
});


test('default native fetch is called without an adapter receiver, matching Cloudflare brand checks',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async function(url,init){if(this!==undefined&&this!==globalThis)throw new TypeError('Illegal invocation');calls++;assert.equal(url,'https://api.meta.ai/v1/responses');assert.equal(init?.redirect,'manual');return new Response(events().map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});};
 assert.equal((await new MetaAdapters(config).segment(png(),'top',signal())).length,2);assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});

test('segmentation diagnostic distinguishes empty and masked completed streams without content logging',async()=>{for(const [payload,count]of [['',0],[text,2]]as const){const client=new MetaAdapters(config,async()=>new Response(events(payload).map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}}));assert.equal((await client.segment(png(),'blazer',signal())).length,count);assert.deepEqual(client.segmentationDiagnostics?.records,{mask:count,box:count,text:0});assert.equal(client.segmentationDiagnostics?.terminal,'completed');assert.equal(client.segmentationDiagnostics?.geometryDiagnostics,0);assert.ok(!JSON.stringify(client.segmentationDiagnostics).includes(payload||'never-present-sentinel'));}});

test('SAM diagnostics distinguish documented empty, masks, boxes-only and unexpected SSE shapes without payload retention',async()=>{
 const boxes=text.replace(/<\|mask;.*?\|>/g,''),privateMarker='PRIVATE_UNEXPECTED_PAYLOAD';
 const cases=[{list:events(text),count:2,result:'masks',box:2,mask:2},{list:events(''),count:0,result:'empty',box:0,mask:0},{list:events(boxes),count:null,result:'boxes_only',box:2,mask:0},{list:[{type:'response.unexpected_payload',payload:privateMarker},...events('')],count:null,result:'rejected',unexpected:1},{list:[{type:'response.output_text.delta',item_id:'f',output_index:0,content_index:0,delta:{text:privateMarker}},...events('')],count:null,result:'rejected',malformed:1}];
 for(const c of cases){let calls=0;const client=new MetaAdapters(config,async()=>{calls++;return new Response(c.list.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});});let diagnostics;
 if(c.count===null)await assert.rejects(client.segment(png(),'jacket',signal()),e=>{assert.ok(e instanceof ProviderError);diagnostics=e.diagnostics;return true;});else{assert.equal((await client.segment(png(),'jacket',signal())).length,c.count);diagnostics=client.segmentationDiagnostics;}
 assert.equal(calls,1);assert.equal(diagnostics.result,c.result);if(c.box!==undefined)assert.deepEqual(diagnostics.wireTokens,{box:c.box,mask:c.mask});if(c.unexpected)assert.equal(diagnostics.unexpectedEvents,c.unexpected);if(c.malformed)assert.equal(diagnostics.malformedEvents,c.malformed);assert.ok(!JSON.stringify(diagnostics).includes(privateMarker));assert.ok(!JSON.stringify(diagnostics).includes(text));
 }
});

test('split grammar tokens are counted once across deltas; done-only finalization remains supported',async()=>{
 const lane={item_id:'f',output_index:0,content_index:0};const chunks=[];for(let i=0;i<text.length;i++)chunks.push({type:'response.output_text.delta',...lane,delta:text[i]});
 for(const list of [[...chunks,{type:'response.content_part.done',...lane,part:{type:'output_text',text}},{type:'response.completed'}],[{type:'response.content_part.done',...lane,part:{type:'output_text',text}},{type:'response.completed'}]]){const client=new MetaAdapters(config,async()=>new Response(list.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}}));assert.equal((await client.segment(png(),'top',signal())).length,2);assert.deepEqual(client.segmentationDiagnostics?.wireTokens,{box:2,mask:2});assert.equal(client.segmentationDiagnostics?.terminal,'completed');}
});

test('a contradictory terminal envelope is rejected rather than reported as an empty match',async()=>{const list=events('');list[2]={type:'response.completed',response:{status:'failed',private:'DO_NOT_RETAIN'}} as any;const client=new MetaAdapters(config,async()=>new Response(list.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}}));await assert.rejects(client.segment(png(),'jacket',signal()),e=>{assert.ok(e instanceof ProviderError);assert.equal(e.diagnostics?.malformedEvents,1);assert.equal(e.diagnostics?.result,'rejected');assert.ok(!JSON.stringify(e.diagnostics).includes('DO_NOT_RETAIN'));return true;});});

test('identical mask geometry under duplicate object proposals is composited once',async()=>{const first=text.split(',1<|box')[0],duplicate=first+',2'+first.slice(first.indexOf('<|box;'));const masks=await parseMasks(sequence(events(duplicate)),320,334);assert.equal(masks.length,1);assert.equal(masks[0].objectId,'0');});
