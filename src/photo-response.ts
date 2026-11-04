// A response-body reader or decoder must not hold the upload UI indefinitely.
// Expiry only stops local waiting; it never retries a provider request.
export class PhotoResponseTimeout extends Error {}
export function boundedPhotoStep<T>(work:Promise<T>,signal:AbortSignal,milliseconds:number,onLate?:(value:T)=>void):Promise<T>{
 return new Promise((resolve,reject)=>{let settled=false;const stop=(error:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);reject(error);};const abort=()=>stop(signal.reason??new DOMException('Aborted','AbortError'));const timer=setTimeout(()=>stop(new PhotoResponseTimeout()),milliseconds);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();work.then(value=>{if(settled){onLate?.(value);return;}settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);resolve(value);},stop);});
}
export async function readPhotoResponse(r:Response,signal:AbortSignal){
 const reader=r.body?.getReader();if(!reader)throw Error('invalid_output');const parts:Uint8Array[]=[];let size=0;
 try{for(;;){const p=await boundedPhotoStep(reader.read(),signal,115000);if(p.done)break;size+=p.value.length;if(size>12*1024*1024)throw Error('invalid_output');parts.push(p.value);}}
 finally{// A stalled cancel promise must not prevent the error reaching the UI.
  void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}
 }
 const b=new Uint8Array(size);let o=0;for(const p of parts){b.set(p,o);o+=p.length;}return JSON.parse(new TextDecoder().decode(b));
}
