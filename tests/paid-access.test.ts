import{test}from'node:test';import assert from'node:assert/strict';
import{exportJWK,generateKeyPair,SignJWT,type JWTPayload}from'jose';
import{paidAccess,type PaidAccessEnv}from'../src/server/paid-access';
import worker from'../src/worker';
const domain='wardrobe-security-fixture.cloudflareaccess.com',issuer='https://'+domain,aud='a'.repeat(64),origin='https://wardrobe.example',now=new Date('2026-11-03T12:00:00Z');
const config:PaidAccessEnv={WARDROBE_PAID_ACCESS_MODE:'cloudflare-access',WARDROBE_ACCESS_TEAM_DOMAIN:domain,WARDROBE_ACCESS_AUD:aud};
const keys=await generateKeyPair('RS256',{extractable:true});const jwk={...await exportJWK(keys.publicKey),kid:'fixture-key',alg:'RS256'};
async function token(changes:JWTPayload={},key=keys.privateKey){return new SignJWT({iss:issuer,aud,sub:'fixture-approved-user',exp:Math.floor(+now/1000)+3600,...changes}).setProtectedHeader({alg:'RS256',kid:'fixture-key'}).sign(key);}
const request=(jwt?:string)=>new Request(origin+'/api/ordinary/discover',{method:'POST',headers:{Origin:origin,...(jwt?{'Cf-Access-Jwt-Assertion':jwt}:{})},body:'never dispatched'});
const localCerts=async(url:string,options:any)=>{assert.equal(url,issuer+'/cdn-cgi/access/certs');assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.headers.get('Cf-Access-Jwt-Assertion'),null);return Response.json({keys:[jwk]});};
test('existing recording access is unchanged until explicit configuration; unknown/missing gate configuration fails closed',async()=>{
 assert.equal((await paidAccess(request(),{})).allowed,true);assert.equal((await paidAccess(request(),{WARDROBE_PAID_ACCESS_MODE:'open'})).allowed,true);
 for(const env of[{WARDROBE_PAID_ACCESS_MODE:'typo'}, {...config,WARDROBE_ACCESS_AUD:''},{...config,WARDROBE_ACCESS_TEAM_DOMAIN:'evil.example'},{...config,WARDROBE_ACCESS_TEAM_DOMAIN:'valid.cloudflareaccess.com/evil'},{...config,WARDROBE_ACCESS_TEAM_DOMAIN:'valid.cloudflareaccess.com@evil.example'}])assert.deepEqual(await paidAccess(request(),env),{allowed:false,required:true,reason:'access_unavailable'});
});
test('header presence, fake email, malformed and oversized assertions never authorize or fetch certificates',async()=>{
 for(const raw of[undefined,'approved-user@example.test','x'.repeat(17000),'Bearer pretend']){let calls=0;const r=request(raw);r.headers.set('Cf-Access-Authenticated-User-Email','approved@example.test');r.headers.set('X-Wardrobe-Access','allowed');const v=await paidAccess(r,config,{now,transport:async()=>{calls++;throw Error('must not fetch');}});assert.equal(v.allowed,false);assert.equal(v.reason,'access_required');assert.equal(calls,0);}
});
test('verified Access signature, issuer, audience, expiration and subject are required; no token or identity is sent to the cert endpoint',async()=>{
 assert.equal((await paidAccess(request(await token()),config,{now,transport:localCerts})).allowed,true);
 for(const claims of[{iss:'https://other.cloudflareaccess.com'},{aud:'b'.repeat(64)},{exp:Math.floor(+now/1000)-1},{nbf:Math.floor(+now/1000)+60},{sub:undefined},{exp:undefined}])assert.equal((await paidAccess(request(await token(claims)),config,{now,transport:localCerts})).allowed,false);
 const other=await generateKeyPair('RS256');assert.equal((await paidAccess(request(await token({},other.privateKey)),config,{now,transport:localCerts})).allowed,false);
 const signed=await token(),parts=signed.split('.');parts[1]=Buffer.from(JSON.stringify({iss:issuer,aud,sub:'forged',exp:Math.floor(+now/1000)+7200})).toString('base64url');assert.equal((await paidAccess(request(parts.join('.')),config,{now,transport:localCerts})).allowed,false);
});
test('unknown signing key, wrong algorithm and unavailable or redirected certificates fail closed without leaking diagnostic content',async()=>{
 const jwt=await token();for(const transport of[async()=>{throw Error('private connection detail');},async()=>new Response('',{status:302,headers:{Location:'https://evil.example'}}),async()=>Response.json({keys:[]}),async()=>Response.json({keys:[{...jwk,kid:'different'}]})]){const v=await paidAccess(request(jwt),config,{now,transport});assert.equal(v.allowed,false);assert.doesNotMatch(JSON.stringify(v),/private connection|fixture-approved/);}
 const bad=new SignJWT({iss:issuer,aud,sub:'fixture',exp:Math.floor(+now/1000)+10}).setProtectedHeader({alg:'HS256',kid:'fixture-key'});const hs=await bad.sign(new Uint8Array(32));assert.equal((await paidAccess(request(hs),config,{now,transport:localCerts})).allowed,false);
});
test('production Worker denies anonymous paid/recovery paths before reading a body, touching quota storage or reading provider keys, while public samples remain available',async()=>{
 let touched=0;const env={...config,WARDROBE_ORDINARY_MODE:'open',APP_ORIGIN:origin,ASSETS:{fetch:async(r:Request)=>{assert.equal(new URL(r.url).pathname,'/');return new Response('public sample app');}},META_TRIAL:{idFromName:()=>{touched++;throw Error('must not touch quota');},get:()=>{touched++;throw Error('must not touch quota');}},get MODEL_API_KEY():string{assert.fail('provider secret read');},get OPENAI_API_KEY():string{assert.fail('provider secret read');}};
 for(const path of['/api/ordinary/discover','/api/ordinary/finish','/api/ordinary/close','/api/ordinary/job']){const response=await worker.fetch(new Request(origin+path,{method:path.endsWith('/job')?'GET':'POST',headers:{Origin:origin,'Cf-Access-Authenticated-User-Email':'forged@example.test'},body:path.endsWith('/job')?undefined:'fixture'}),env);assert.equal(response.status,403);assert.equal((await response.json()).error,'access_required');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');}
 const status=await worker.fetch(new Request(origin+'/api/processing/status'),env),value=await status.json();assert.equal(value.enabled,false);assert.equal(value.accessRequired,true);assert.equal(value.processingAccessUrl,'/processing-access');assert.equal(status.headers.get('Set-Cookie'),null);assert.equal(touched,0);
 assert.equal(await(await worker.fetch(new Request(origin+'/'),env)).text(),'public sample app');assert.equal(await(await worker.fetch(new Request(origin+'/processing-access'),env)).text(),'public sample app');
 for(const path of['/api/processing/discover','/api/tester/discover','/api/reconstruct'])assert.equal((await worker.fetch(new Request(origin+path,{method:'POST'}),env)).status,503);
});
test('all Worker early refusals and unexpected failures are hardened and redacted',async()=>{
 const env={WARDROBE_ORDINARY_MODE:'open',APP_ORIGIN:origin,ASSETS:{fetch:async()=>{throw Error('private-account-config');}}};
 for(const r of[new Request(origin+'/'),new Request('https://wrong.example/api/processing/status'),new Request(origin+'/api/ordinary/finish',{method:'POST'})]){const response=await worker.fetch(r,env);assert.ok([403,503].includes(response.status));assert.match(response.headers.get('Content-Security-Policy')!,/frame-ancestors 'none'/);assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.doesNotMatch(await response.text(),/private-account-config/);}
});
test('approved Access user keeps ordinary status/session behavior and emergency off still wins',async t=>{
 const jwt=await token({exp:Math.floor(Date.now()/1000)+3600});
 t.mock.method(globalThis,'fetch',localCerts);
 let calls=0;const env={...config,WARDROBE_ORDINARY_MODE:'open',APP_ORIGIN:origin,ASSETS:{fetch:async()=>new Response('sample app')},META_TRIAL:{idFromName:(id:string)=>id,get:()=>({fetch:async()=>{calls++;return Response.json({enabled:true,ordinaryUpload:true});}})}};
 const r=await worker.fetch(new Request(origin+'/api/processing/status',{headers:{'Cf-Access-Jwt-Assertion':jwt}}),env);assert.equal(r.status,200);assert.equal((await r.json()).enabled,true);assert.equal(calls,1);assert.match(r.headers.get('Set-Cookie')!,/Secure; HttpOnly; SameSite=Strict/);
 const off=await worker.fetch(new Request(origin+'/api/processing/status',{headers:{'Cf-Access-Jwt-Assertion':jwt}}),{...env,WARDROBE_ORDINARY_MODE:'disabled'});assert.equal((await off.json()).enabled,false);assert.equal(calls,1);
});
test('client status does not recover public history for an access gate or accept external sign-in links and contradictory enabled state',async()=>{
 const{processingStatus}=await import('../src/photo-pipeline');let calls=0;const base={enabled:false,remainingDiscovery:0,remainingSegments:0,remainingFinishes:0,maxItems:0,maxFallbacks:0,approvedSourceSha256:null,approvalExpiresAt:null,ordinaryUpload:true,accessRequired:true,processingAccessUrl:'/processing-access'};
 const good=await processingStatus(async()=>{calls++;return Response.json(base);});assert.equal(good.accessRequired,true);assert.equal(calls,1);
 for(const change of[{processingAccessUrl:'https://evil.example'},{enabled:true},{accessRequired:'yes'}]){const bad=await processingStatus(async()=>Response.json({...base,...change}));assert.equal(bad.enabled,false);assert.equal(bad.unavailableReason,'check_failed');}
});
test('client trusts access refusal as unattempted only with the explicit pre-dispatch proof',async()=>{
 const{processingStatus,photoClient,PhotoError}=await import('../src/photo-pipeline');
 await processingStatus(async()=>Response.json({enabled:true,remainingDiscovery:1,remainingSegments:0,remainingFinishes:12,maxItems:12,maxFallbacks:0,approvedSourceSha256:null,approvalExpiresAt:null,ordinaryUpload:true,inputMode:'discovered-context-v1'}));
 for(const code of['access_required','access_unavailable'])for(const proven of[true,false]){const client=photoClient(async()=>Response.json({error:code,...(proven?{notDispatched:true}:{})},{status:403}));await assert.rejects(client.discover({id:'fixture',name:'fixture',sha256:'a'.repeat(64),image:new Blob(['fixture']),demo:false},new AbortController().signal),(e:unknown)=>e instanceof PhotoError&&e.code===(proven?code:'outcome_unknown'));}
});
test('public status accepts a cryptographically verified Access cookie but rejects a forged cookie and gives no header/cookie presence shortcut',async()=>{
 const jwt=await token(),r=new Request(origin+'/api/processing/status',{headers:{Cookie:'unrelated=x; CF_Authorization='+jwt}});assert.equal((await paidAccess(r,config,{now,transport:localCerts})).allowed,true);
 const fake=new Request(origin+'/api/processing/status',{headers:{Cookie:'CF_Authorization=pretend'}});assert.equal((await paidAccess(fake,config,{now,transport:localCerts})).allowed,false);
 r.headers.set('Cf-Access-Jwt-Assertion','invalid');assert.equal((await paidAccess(r,config,{now,transport:localCerts})).allowed,false);
});
