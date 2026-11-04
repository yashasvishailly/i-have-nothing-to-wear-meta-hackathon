import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processingStatus,processingOff,processingUnavailableMessage,setPrivateTestAccess} from '../src/photo-pipeline';

test('disabled processing explains exhausted allowance using read-only history',async()=>{
 const paths:string[]=[];
 const result=await processingStatus((async(path,init)=>{
  paths.push(String(path));assert.equal(init?.method,undefined);
  return Response.json(paths.length===1?processingOff():{ledgerPresent:true,admittedPhotos:3,remainingPhotos:0});
 }) as typeof fetch);
 assert.deepEqual(paths,['/api/processing/status','/api/ordinary/history']);
 assert.equal(result.enabled,false);assert.equal(result.unavailableReason,'quota_exhausted');
 assert.match(processingUnavailableMessage(result),/allowance has been used up/);
});

test('failed or malformed status stays unavailable without claiming quota exhaustion',async()=>{
 for(const response of [new Response('',{status:503}),Response.json({enabled:false})]){
  let calls=0;const result=await processingStatus((async()=>{calls++;return response;}) as typeof fetch);
  assert.equal(calls,1);assert.equal(result.enabled,false);assert.equal(result.unavailableReason,'check_failed');
 }
});

test('missing, failed or malformed history preserves disabled status',async()=>{
 for(const history of [{ledgerPresent:false,admittedPhotos:3,remainingPhotos:0},{ledgerPresent:true,admittedPhotos:0,remainingPhotos:3},{ledgerPresent:true,admittedPhotos:'3',remainingPhotos:0},null]){
  let calls=0;const result=await processingStatus((async()=>{if(++calls===1)return Response.json(processingOff());if(history===null)throw Error('offline');return Response.json(history);}) as typeof fetch);
  assert.equal(result.enabled,false);assert.equal(result.unavailableReason,'disabled');
 }
});

test('enabled processing and private tests never consult ordinary history',async()=>{
 for(const privateTest of [false,true]){
  setPrivateTestAccess(privateTest?'a'.repeat(32):'');let calls=0;
  try{
   const result=await processingStatus((async()=>{calls++;return Response.json({...processingOff(),enabled:!privateTest});}) as typeof fetch);
   assert.equal(calls,1);assert.equal(result.enabled,!privateTest);
  }finally{setPrivateTestAccess('');}
 }
});
