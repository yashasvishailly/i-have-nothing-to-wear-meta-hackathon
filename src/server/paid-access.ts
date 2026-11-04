import {createRemoteJWKSet,customFetch,jwtVerify,type FetchImplementation} from 'jose';

export interface PaidAccessEnv {
 WARDROBE_PAID_ACCESS_MODE?:string;
 WARDROBE_ACCESS_TEAM_DOMAIN?:string;
 WARDROBE_ACCESS_AUD?:string;
}
export interface PaidAccessResult {allowed:boolean;required:boolean;reason:'ok'|'access_required'|'access_unavailable';signInPath?:'/processing-access';}
const resolvers=new Map<string,ReturnType<typeof createRemoteJWKSet>>();

// Optional until the owner approves policy activation. No secret, allowlist or
// identity is provisioned here. A configured gate never trusts header presence.
export async function paidAccess(request:Request,env:PaidAccessEnv,options:{transport?:FetchImplementation;now?:Date}={}):Promise<PaidAccessResult>{
 if(env.WARDROBE_PAID_ACCESS_MODE===undefined||env.WARDROBE_PAID_ACCESS_MODE==='open')return{allowed:true,required:false,reason:'ok'};
 const domain=env.WARDROBE_ACCESS_TEAM_DOMAIN??'',audience=env.WARDROBE_ACCESS_AUD??'';
 if(env.WARDROBE_PAID_ACCESS_MODE!=='cloudflare-access'||!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(domain)||!/^[a-f0-9]{64}$/.test(audience))return{allowed:false,required:true,reason:'access_unavailable'};
 const denied:PaidAccessResult={allowed:false,required:true,reason:'access_required',signInPath:'/processing-access'};
 // Public status is outside the edge login redirect. Validate the signed
 // Access cookie there too; neither cookie/header presence alone is trusted.
 const cookie=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('CF_Authorization='))?.slice('CF_Authorization='.length);
 const token=request.headers.get('Cf-Access-Jwt-Assertion')??cookie;
 if(!token||token.length>16384||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(token))return denied;
 const issuer='https://'+domain;
 try{
  // Tests supply an entirely local JWKS transport. Production fetches only the
  // configured Cloudflare team's public keys, never the token or user content.
  let keys=options.transport?undefined:resolvers.get(issuer);
  if(!keys){keys=createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'),{timeoutDuration:4000,cacheMaxAge:300000,cooldownDuration:30000,...(options.transport?{[customFetch]:options.transport}:{})});if(!options.transport){if(resolvers.size>=8)resolvers.clear();resolvers.set(issuer,keys);}}
  await jwtVerify(token,keys,{issuer,audience,algorithms:['RS256'],requiredClaims:['exp','iss','aud','sub'],clockTolerance:0,...(options.now?{currentDate:options.now}:{})});
  return{allowed:true,required:true,reason:'ok'};
 }catch{return denied;} // No token, identity or validation error enters logs/responses.
}
