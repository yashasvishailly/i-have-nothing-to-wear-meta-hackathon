import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startLocalServer } from '../server.mjs';
import { createMetaApi } from '../src/server/routes.ts';

test('actual localhost HTTP bridge serves safe status and refuses live requests by default',async()=>{
 let calls=0;const api=createMetaApi({}, {transport:async()=>{calls++;throw Error('provider must not be reached');}});const server=startLocalServer({api,port:0});await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 try{const status=await fetch(origin+'/api/status');assert.equal(status.status,200);const body=await status.json();assert.equal(body.uploadsEnabled,false);assert.equal(body.reasoningEnabled,false);assert.ok(!JSON.stringify(body).includes('MODEL_API_KEY'));
 const processing=await fetch(origin+'/api/processing/status');assert.equal(processing.status,200);assert.equal((await processing.json()).enabled,false);const automatic=await fetch(origin+'/api/processing/discover',{method:'POST',body:'not sent upstream'});assert.equal(automatic.status,503);
 const denied=await fetch(origin+'/api/segment',{method:'POST',headers:{Origin:origin,'Content-Type':'image/png'},body:'not sent upstream'});assert.equal(denied.status,503);assert.equal(calls,0);const html=await fetch(origin);assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/connect-src 'self'/);
 }finally{server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));}
});
