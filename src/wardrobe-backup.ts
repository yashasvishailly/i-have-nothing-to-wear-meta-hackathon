import{checkedWatchCrop}from'./checked-watch-crop';
import {initial,type State,type Source,type Item,type Look,type Profile} from './core';
export const BACKUP_FORMAT='my-wardrobe';
export const BACKUP_VERSION=1;
export const MAX_BACKUP_BYTES=128*1024*1024;
export const MAX_IMAGE_BYTES=20*1024*1024;
export const MAX_ORIGINAL_BYTES=8*1024*1024;
const MAX_DECODED_BYTES=96*1024*1024, MAX_RECORDS=10000;
function fail(message:string):never{throw Error('Cannot import wardrobe: '+message);}
function record(v:unknown):Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v))fail('invalid record.');return v as Record<string,any>;}
function str(v:unknown,max=1000):string{if(typeof v!=='string'||v.length>max)fail('invalid text.');return v;}
function id(v:unknown):string{const s=str(v,200);if(!s||/[\x00-\x1f]/.test(s))fail('invalid ID.');return s;}
function bool(v:unknown):boolean{if(typeof v!=='boolean')fail('invalid boolean.');return v;}
function profile(v:unknown):Profile{const p=record(v);return{occasion:str(p.occasion,100),style:str(p.style,100),noHeels:bool(p.noHeels),noSleeveless:bool(p.noSleeveless)};}
function list(v:unknown):any[]{if(!Array.isArray(v)||v.length>MAX_RECORDS)fail('invalid or oversized collection.');return v;}
function refs(v:unknown):string[]{return list(v).map(id);}
function enumValue<T extends string>(v:unknown,values:readonly T[]):T{if(!values.includes(v as T))fail('unknown field value.');return v as T;}
function unique<T extends{id:string}>(a:T[]){if(new Set(a.map(x=>x.id)).size!==a.length)fail('duplicate IDs inside the file.');return a;}
function blobData(blob:Blob):Promise<string>{return new Promise((ok,no)=>{const r=new FileReader();r.onerror=()=>no(Error('Could not read a saved image.'));r.onload=()=>ok(String(r.result));r.readAsDataURL(blob);});}
export async function exportWardrobe(state:State){
 const sources=await Promise.all(state.sources.map(async s=>({...s,imageKind:'normalized',image:await blobData(s.image),original:s.original?await blobData(s.original):undefined})));
 let decodedBytes=sources.reduce((n,s)=>n+s.image.split(',')[1].length*3/4+(s.original?s.original.split(',')[1].length*3/4:0),0);
 for(const item of [...state.items,...state.pending])decodedBytes+=item.image.split(',')[1].length*3/4+(item.reconstruction?item.reconstruction.image.split(',')[1].length*3/4+(item.reconstruction.originalImage?item.reconstruction.originalImage.split(',')[1].length*3/4:0):0);
 if(decodedBytes>MAX_DECODED_BYTES)throw Error('This wardrobe exceeds the 96 MB embedded-image backup limit. Keep this device data before clearing it.');
 const text=JSON.stringify({format:BACKUP_FORMAT,version:BACKUP_VERSION,exportedAt:new Date().toISOString(),state:{...state,sources}});
 if(new Blob([text]).size>MAX_BACKUP_BYTES)throw Error('This wardrobe exceeds the 128 MB export limit. Keep this device data and contact support before clearing it.');
 return text;
}
export async function readBackupFile(file:Blob):Promise<State>{if(file.size>MAX_BACKUP_BYTES)fail('file exceeds 128 MB.');return parseWardrobeBackup(await file.text());}
export async function parseWardrobeBackup(text:string):Promise<State>{
 if(new Blob([text]).size>MAX_BACKUP_BYTES)fail('file exceeds 128 MB.');
 let root:Record<string,any>;try{root=record(JSON.parse(text));}catch{fail('not valid wardrobe JSON.');}
 const versioned='format'in root||'version'in root;
 if(versioned&&(root.format!==BACKUP_FORMAT||root.version!==BACKUP_VERSION))fail('unsupported backup format or version.');
 const s=versioned?record(root.state):root;let decoded=0;
 const image=(v:unknown,limit=MAX_IMAGE_BYTES):{url:string;blob:Blob}=>{
  const url=str(v,Math.ceil(limit/3)*4+100),m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
  if(!m||!m[2]||m[2].length%4!==0)fail('images must be embedded PNG, JPEG or WebP bytes.');
  const size=m[2].length/4*3-(m[2].endsWith('==')?2:m[2].endsWith('=')?1:0);if(size>limit||(decoded+=size)>MAX_DECODED_BYTES)fail('image size limit exceeded.');
  let binary:string;try{binary=atob(m[2]);}catch{fail('invalid image encoding.');}const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const signature=m[1]==='png'?bytes[0]===137&&String.fromCharCode(...bytes.slice(1,8))==='PNG\r\n\x1a\n':m[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(!signature)fail('image bytes do not match their type.');return{url,blob:new Blob([bytes],{type:'image/'+m[1]})};
 };
 const sources=unique(list(s.sources).map((v):Source=>{const x=record(v),source:Source={id:id(x.id),name:str(x.name),demo:bool(x.demo),image:image(x.image).blob,imageKind:'normalized'};
  if(x.sha256!==undefined){if(!/^[a-f0-9]{64}$/.test(x.sha256))fail('invalid photo hash.');source.sha256=x.sha256;}
  if(x.sourceRefs!==undefined)source.sourceRefs=refs(x.sourceRefs);
  if(x.synthetic!==undefined)source.synthetic=bool(x.synthetic);
  if(x.original!==undefined){source.original=image(x.original,MAX_ORIGINAL_BYTES).blob;source.originalName=str(x.originalName??x.name);if(x.originalLastModified!==undefined){if(!Number.isSafeInteger(x.originalLastModified)||x.originalLastModified<0)fail('invalid original date.');source.originalLastModified=x.originalLastModified;}}
  // Processing jobs are device/server state, never resumed or replayed from an import.
  return source;
 }));
 const itemsOf=(v:unknown)=>unique(list(v).map((v):Item=>{const x=record(v),i:Item={id:id(x.id),sourceId:id(x.sourceId),name:str(x.name),category:enumValue(x.category,['top','bottom','dress','shoes','layer','accessory']),image:image(x.image).url,partial:bool(x.partial),available:bool(x.available),heels:x.heels===null?null:bool(x.heels),sleeveless:x.sleeveless===null?null:bool(x.sleeveless),confirmed:bool(x.confirmed),demo:bool(x.demo)};
  for(const key of ['synthetic','prepared','useReconstruction','reviewNeeded'] as const)if(x[key]!==undefined)i[key]=bool(x[key]);
  if(x.sourceRefs!==undefined)i.sourceRefs=refs(x.sourceRefs);if(x.accessoryRole!==undefined)i.accessoryRole=enumValue(x.accessoryRole,['bag','eyewear','watch','jewellery','other'] as const);
  if(x.extraction!==undefined)i.extraction=enumValue(x.extraction,['sam-mask','model-source-crop'] as const);if(x.reviewNote!==undefined)i.reviewNote=str(x.reviewNote,10000);
  if(x.reviewDraft!==undefined){const r=record(x.reviewDraft);i.reviewDraft={preview:bool(r.preview),acknowledged:bool(r.acknowledged)};}
  if(x.reconstruction!==undefined){const r=record(x.reconstruction);i.reconstruction={image:image(r.image).url,provider:enumValue(r.provider,['OpenAI']),model:str(r.model),notice:str(r.notice,10000),sourceSha256:str(r.sourceSha256,64),cutoutSha256:str(r.cutoutSha256,64),confirmed:bool(r.confirmed),...(r.qualityWarning===undefined?{}:{qualityWarning:enumValue(r.qualityWarning,['faint_edge_fringe'] as const)}),...(r.reviewedByUser===undefined?{}:{reviewedByUser:bool(r.reviewedByUser)})};if(r.originalImage!==undefined||r.framing!==undefined){const f=record(r.framing);if(f.method!=='transparent-padding-v1'||!['originalSha256','normalizedSha256'].every(k=>typeof f[k]==='string'&&/^[a-f0-9]{64}$/.test(f[k])))fail('invalid preview framing.');i.reconstruction.originalImage=image(r.originalImage).url;i.reconstruction.framing={method:'transparent-padding-v1',originalSha256:f.originalSha256,normalizedSha256:f.normalizedSha256};}}
  if(x.watchCropCheck!==undefined)i.watchCropCheck=checkedWatchCrop(x.watchCropCheck,x.watchCropCheck?.sourceSha256,x.watchCropCheck?.pieceId);
  if(i.useReconstruction&&!i.reconstruction)fail('missing reconstructed image.');return i;
 }));
 const items=itemsOf(s.items),pending=itemsOf(s.pending);unique([...items,...pending]);
 const looksOf=(v:unknown)=>unique(list(v).map((v):Look=>{const x=record(v);const ids=refs(x.ids);if(new Set(ids).size!==ids.length)fail('duplicate pieces in a look.');return{id:id(x.id),ids,reason:str(x.reason,10000),profile:profile(x.profile)};}));
 const looks=looksOf(s.looks),drafts=looksOf(s.drafts??[]);const sourceIds=new Set(sources.map(x=>x.id)),itemIds=new Set(items.map(x=>x.id));
 for(const i of [...items,...pending])if(!sourceIds.has(i.sourceId)||(i.sourceRefs??[]).some(x=>!sourceIds.has(x)))fail('piece references a missing photo.');
 for(const l of [...looks,...drafts])if(l.ids.some(x=>!itemIds.has(x)))fail('look references a missing piece.');
 if(typeof createImageBitmap==='function')for(const source of sources){for(const blob of [source.image,...(source.original?[source.original]:[])]){let bitmap:ImageBitmap;try{bitmap=await createImageBitmap(blob);}catch{fail('image cannot be decoded.');}const pixels=bitmap.width*bitmap.height;bitmap.close();if(pixels>24e6)fail('image exceeds 24 megapixels.');}}
 if(typeof createImageBitmap==='function')for(const item of [...items,...pending])for(const url of [item.image,...(item.reconstruction?[item.reconstruction.image,...(item.reconstruction.originalImage?[item.reconstruction.originalImage]:[])]:[])]){const raw=atob(url.split(',')[1]),blob=new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:url.slice(5,url.indexOf(';'))});let bitmap:ImageBitmap;try{bitmap=await createImageBitmap(blob);}catch{fail('piece image cannot be decoded.');}const pixels=bitmap.width*bitmap.height;bitmap.close();if(pixels>24e6)fail('piece image exceeds 24 megapixels.');}
 const wardrobeView=s.wardrobeView===undefined?undefined:(()=>{const v=record(s.wardrobeView),kind=enumValue(v.kind,['own','samples','sample'] as const);return kind==='sample'?{kind,id:id(v.id)}:{kind};})();return{sources,items,pending,looks,drafts,profile:profile(s.profile),...(wardrobeView?{wardrobeView}: {})};
}
async function digest(blob:Blob){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');}
function canonical(v:any):any{if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])]));return v;}
function content<T extends{id:string}>(x:T){const{id,...rest}=x;return JSON.stringify(canonical(rest));}
function fresh(id:string,pool:{id:string}[]){let n=1,next=id;while(pool.some(x=>x.id===next))next=id.slice(0,160)+'-import-'+n++;return next;}
/** Pure merge: builds a new state; persist it before changing the visible app state. */
export async function mergeWardrobeBackup(existing:State,incoming:State,restorePreferences?:boolean):Promise<State>{
 const next=structuredClone(existing),sourceMap=new Map<string,string>(),itemMap=new Map<string,string>();
 const hashes=await Promise.all(next.sources.map(async s=>({s,hash:await digest(s.image),original:s.original?await digest(s.original):undefined})));
 for(const source of incoming.sources){const hash=await digest(source.image),original=source.original?await digest(source.original):undefined;
  const match=hashes.find(x=>x.hash===hash&&(!x.original||!original||x.original===original));
  if(match){sourceMap.set(source.id,match.s.id);if(!match.s.original&&source.original){match.s.original=source.original;match.s.originalName=source.originalName;match.s.originalLastModified=source.originalLastModified;match.original=original;}continue;}
  const copy={...source,id:fresh(source.id,next.sources)};sourceMap.set(source.id,copy.id);next.sources.push(copy);hashes.push({s:copy,hash,original});
 }
 for(const [key,pool]of [['items',incoming.items],['pending',incoming.pending]] as const)for(const item of pool){const copy={...item,sourceId:sourceMap.get(item.sourceId)!,...(item.sourceRefs?{sourceRefs:item.sourceRefs.map(x=>sourceMap.get(x)!)}:{})};const all=[...next.items,...next.pending],same=all.find(x=>content(x)===content(copy));if(same){itemMap.set(item.id,same.id);continue;}copy.id=fresh(item.id,all);itemMap.set(item.id,copy.id);next[key].push(copy);}
 for(const [key,pool]of [['looks',incoming.looks],['drafts',incoming.drafts??[]]] as const){next[key]??=[];for(const look of pool){const copy={...look,ids:look.ids.map(x=>itemMap.get(x)!)};if(next[key]!.some(x=>content(x)===content(copy)))continue;copy.id=fresh(copy.id,next[key]!);next[key]!.push(copy);}}
 if(restorePreferences??(!existing.sources.length&&!existing.items.length&&!existing.looks.length&&JSON.stringify(existing.profile)===JSON.stringify(initial().profile)))next.profile={...incoming.profile};
 return next;
}
