import type {Store} from './hosted';

// Short rolling limits, not a lifetime photo allowance or a monetary ceiling.
export const openAbuseLimits = {
 windowMs: 10 * 60_000,
 leaseMs: 120_000,
 sessionConcurrent: 1,
 globalConcurrent: 6,
 session: {discover: 6, finish: 60},
 global: {discover: 30, finish: 180},
} as const;
export const openAbuseObject = 'open-upload-abuse-v1';
interface Binding {idFromName(name:string):unknown;get(id:unknown):{fetch(request:Request):Promise<Response>};}
type Stage = 'discover' | 'finish';
interface Event {time: number; stage: Stage; session: string;}
interface Lease {id: string; session: string; expires: number;}
interface Ledger {events: Event[]; leases: Lease[];}
type Storage = Store & {setAlarm?:(time:number)=>Promise<void>};
const reply = (value:unknown, status=200, retry=0) => Response.json(value, {status, headers:{'Cache-Control':'no-store', ...(retry ? {'Retry-After':String(retry)} : {})}});

// This handler is reached only through the existing Durable Object binding.
// The public Worker never forwards client requests to /_internal/ paths.
export async function openAbuseApi(request:Request, store:Storage, now=Date.now()) {
 if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
 const text=await request.text();if(text.length>512)return reply({error:'input'},400);
 let input:any;try{input=JSON.parse(text);}catch{return reply({error:'input'},400);}
 if(!input||!['reserve','release'].includes(input.action)||!/^[a-f0-9]{64}$/.test(input.session??'')||!/^[a-f0-9-]{36}$/.test(input.ticket??'')||input.action==='reserve'&&!['discover','finish'].includes(input.stage))return reply({error:'input'},400);
 const result=await store.transaction(async tx=>{
  const old=await tx.get<Ledger>('open-abuse')??{events:[],leases:[]};
  const events=old.events.filter(e=>e.time>now-openAbuseLimits.windowMs),leases=old.leases.filter(l=>l.expires>now);
  if(input.action==='release'){
   await tx.put('open-abuse',{events,leases:leases.filter(l=>l.id!==input.ticket||l.session!==input.session)});
   return reply({released:true});
  }
  const stage=input.stage as Stage;
  const globalEvents=events.filter(e=>e.stage===stage),sessionEvents=globalEvents.filter(e=>e.session===input.session);
  const concurrent=leases.length>=openAbuseLimits.globalConcurrent||leases.filter(l=>l.session===input.session).length>=openAbuseLimits.sessionConcurrent;
  if(concurrent)return reply({error:'admission_busy'},429,5);
  if(globalEvents.length>=openAbuseLimits.global[stage]||sessionEvents.length>=openAbuseLimits.session[stage]){
   const oldest=globalEvents.length>=openAbuseLimits.global[stage]?globalEvents[0]:sessionEvents[0];
   return reply({error:'admission_rate_limit'},429,Math.max(1,Math.ceil((oldest.time+openAbuseLimits.windowMs-now)/1000)));
  }
  events.push({time:now,stage,session:input.session});leases.push({id:input.ticket,session:input.session,expires:now+openAbuseLimits.leaseMs});
  await tx.put('open-abuse',{events,leases});return reply({reserved:true});
 });
 // Expire the entire short-lived ledger after traffic stops; no raw IPs, photos,
 // request content, source hashes or cookie tokens enter this object.
 await store.put('open-abuse-expires',now+openAbuseLimits.windowMs);
 await store.setAlarm?.(now+openAbuseLimits.windowMs);
 return result;
}

export async function guardedOpenRequest(request:Request, token:string, binding:Binding, run:()=>Promise<Response>) {
 const url=new URL(request.url),stage=url.pathname.split('/').pop();
 if(!['discover','finish'].includes(stage??'')||request.method!=='POST')return run();
 if(request.headers.get('origin')!==url.origin||request.headers.get('x-wardrobe-consent')!=='photo-pipeline-v1'||request.headers.get('x-wardrobe-context-consent')!=='source-context-v1')return reply({error:'consent_required'},403);
 const type=request.headers.get('content-type')?.split(';')[0];
 if(type!==(stage==='discover'?'image/png':'application/json'))return reply({error:'input'},400);
 const max=stage==='discover'?6*1024*1024:12*1024*1024;
 const declared=request.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>max))return reply({error:'too_large'},413);
 const session=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 const ticket=crypto.randomUUID(),stub=binding.get(binding.idFromName(openAbuseObject));
 const send=(action:string)=>stub.fetch(new Request(url.origin+'/_internal/open-abuse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,session,ticket,stage})}));
 let reserved:Response;try{reserved=await send('reserve');}catch{return reply({error:'unavailable'},503);}
 if(!reserved.ok){if(reserved.status===429)return reserved;return reply({error:'unavailable'},503);}
 try{return await run();}catch{return reply({error:'unavailable'},503);}
 finally{try{await send('release');}catch{/* The bounded lease expires without permitting a provider retry. */}}
}
