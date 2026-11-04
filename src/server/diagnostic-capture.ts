// Request-local capture only for explicitly gated operator diagnostics. No storage,
// logs, request headers, original image input or credential values are included.
export interface CapturedProviderResponse {
  protocol: 'operator-response-v1'; status: number; contentType: 'event-stream' | 'json' | 'other' | 'missing';
  bodyBase64: string; retainedBytes: number; complete: boolean; truncated: boolean;
  credentialRedacted: boolean; byteExact: boolean;
}
function b64(bytes: Uint8Array) { let text=''; for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text); }
export function capturedProviderResponse(status: number, contentType: string | null, body: Uint8Array, complete: boolean, truncated: boolean, credential: string): CapturedProviderResponse {
  // Exact byte replacement avoids corrupting non-UTF8 evidence unnecessarily.
  const key=new TextEncoder().encode(credential),replacement=new TextEncoder().encode('[REDACTED_CONFIGURED_CREDENTIAL]'),parts:Uint8Array[]=[];
  let start=0,redacted=false;
  if(key.length)for(let i=0;i<=body.length-key.length;i++)if(body[i]===key[0]&&key.every((v,j)=>body[i+j]===v)){parts.push(body.subarray(start,i),replacement);i+=key.length-1;start=i+1;redacted=true;}
  parts.push(body.subarray(start));const bytes=new Uint8Array(parts.reduce((sum,p)=>sum+p.length,0));let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}
  const type=contentType?.split(';')[0].trim().toLowerCase();
  return{protocol:'operator-response-v1',status,contentType:type==='text/event-stream'?'event-stream':type==='application/json'?'json':type?'other':'missing',bodyBase64:b64(bytes),retainedBytes:body.length,complete,truncated,credentialRedacted:redacted,byteExact:!redacted&&complete&&!truncated};
}
