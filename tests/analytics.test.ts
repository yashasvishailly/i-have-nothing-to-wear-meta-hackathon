import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UsageAnalytics,analyticsConfig,type UsageEvent} from '../src/analytics';
function setup(origin=analyticsConfig.origin,internal=false){const values=new Map<string,string>(),sent:{url:string;body:any}[]=[],google:string[]=[];let counter=0;const analytics=new UsageAnalytics({origin,internal,storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);}},uuid:()=>`random-event-${++counter}`,send:(async(url,init)=>{sent.push({url:String(url),body:JSON.parse(String(init?.body))});return new Response('ok');}) as typeof fetch,ga:event=>google.push(event)});return{analytics,values,sent,google};}
test('analytics never contacts providers before opt-in, after opt-out or on local/test origins',async()=>{
 const a=setup();await a.analytics.capture('pile_open');assert.equal(a.sent.length,0);a.analytics.setConsent(true);await a.analytics.capture('pile_open');assert.equal(a.sent.length,1);a.analytics.setConsent(false);await a.analytics.capture('pile_open');assert.equal(a.sent.length,1);
 for(const origin of ['http://127.0.0.1:4181','http://localhost:4173','https://i-have-nothing-to-wear.yshailly.workers.dev','https://example.test']){const local=setup(origin);local.analytics.setConsent(true);await local.analytics.capture('pile_open');assert.equal(local.sent.length,0);}
});
test('allowlisted manual events contain no wardrobe content or persistent identity; internal traffic is labeled',async()=>{
 const a=setup(undefined,true);a.analytics.setConsent(true);await a.analytics.capture('look_saved');await a.analytics.capture('hanger_open');await a.analytics.capture('private-filename.jpg' as UsageEvent);assert.equal(a.sent.length,2);assert.notEqual(a.sent[0].body.distinct_id,a.sent[1].body.distinct_id);
 assert.deepEqual(Object.keys(a.sent[0].body).sort(),['api_key','distinct_id','event','properties']);assert.deepEqual(a.sent[0].body.properties,{$process_person_profile:false,$geoip_disable:true,app:'wardrobe',environment:'internal',traffic_type:'internal'});
 assert.equal(a.google.length,2);assert.equal(analyticsConfig.gaManualVerified,true);assert.equal(a.values.size,1); // Consent choice only; no user/session ID is saved.
});
test('analytics storage and network failures do not break app flow or retry requests',async()=>{
 let sends=0;const a=new UsageAnalytics({origin:analyticsConfig.origin,internal:false,storage:{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}},send:(async()=>{sends++;throw Error('network');}) as typeof fetch,uuid:()=>crypto.randomUUID()});a.setConsent(true);await a.capture('pile_open');assert.equal(sends,0);
});
