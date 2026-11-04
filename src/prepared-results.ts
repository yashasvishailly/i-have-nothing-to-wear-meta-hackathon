import{acceptFinishedPreview}from'./preview-acceptance';
// Browser-only import of already prepared synthetic API results. Never dispatches a provider request.
import {photoHash} from './api';
import {reconstructionPreset,reconstructionNotice} from './reconstruction-model';
import type {Item,Source,State,Category,AccessoryRole} from './core';
const categories:Category[]=['top','bottom','dress','shoes','layer','accessory'];
const roles:AccessoryRole[]=['bag','eyewear','watch','jewellery','other'];
export class PreparedResultsError extends Error{constructor(message:string){super(message);}}
function fail():never{throw new PreparedResultsError('That sample file is invalid or incomplete. Your wardrobe has not changed.');}
function dataPng(value:unknown,max:number){if(typeof value!=='string'||!/^data:image\/png;base64,([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)||value.length>Math.ceil(max/3)*4+22)fail();const bytes=Uint8Array.from(atob(value.slice(22)),c=>c.charCodeAt(0));if(bytes.length>max)fail();return new Blob([bytes],{type:'image/png'});}
const nativeDecode=async(blob:Blob)=>{const b=await createImageBitmap(blob);try{return{width:b.width,height:b.height};}finally{b.close();}};
export interface PreparedResults{source:Source;sources?:Source[];items:Item[];}
export async function parsePreparedResults(file:Blob,signal:AbortSignal,decode=nativeDecode):Promise<PreparedResults>{
 if(file.size>32*1024*1024)throw new PreparedResultsError('This results file is larger than 32 MB. Your wardrobe has not changed.');signal.throwIfAborted();let value:any;try{value=JSON.parse(await file.text());}catch{fail();}
 if(value?.format==='wardrobe-prepared-collection-v1'){if(!Array.isArray(value.photos)||value.photos.length<1||value.photos.length>8)fail();const sources:Source[]=[],items:Item[]=[];for(const photo of value.photos){if(photo?.format!=='wardrobe-prepared-review-v1')fail();const result=await parsePreparedResults(new Blob([JSON.stringify(photo)]),signal,decode);if(sources.some(s=>s.id===result.source.id))fail();sources.push(result.source);items.push(...result.items);if(items.length>32)fail();}return{source:sources[0],sources,items};}
 if(value?.format!=='wardrobe-prepared-review-v1'||value.source?.synthetic!==true||!Array.isArray(value.items)||value.items.length<1||value.items.length>32)fail();
 const image=dataPng(value.source.image,6*1024*1024),dims=await decode(image);if(Math.min(dims.width,dims.height)<32||Math.max(dims.width,dims.height)>1600)fail();const sourceSha256=await photoHash(image);if(value.source.sha256!==sourceSha256)fail();const sourceId='prepared-source-'+sourceSha256,source:Source={id:sourceId,sha256:sourceSha256,name:'Synthetic API evaluation source',image,demo:false,synthetic:true},items:Item[]=[];
 for(const entry of value.items){signal.throwIfAborted();if(typeof entry.name!=='string'||!entry.name.trim()||entry.name.length>80||!categories.includes(entry.category)||!entry.reconstruction||entry.reconstruction.provider!=='OpenAI'||entry.reconstruction.model!==reconstructionPreset.model||entry.extraction!=='sam-mask')fail();if(entry.category==='accessory'&&!roles.includes(entry.accessoryRole))fail();
  const raw=dataPng(entry.cutout,2*1024*1024),rawDims=await decode(raw);if(Math.min(rawDims.width,rawDims.height)<1||Math.max(rawDims.width,rawDims.height)>1024)fail();const cutoutSha256=await photoHash(raw);if(entry.reconstruction.sourceSha256!==sourceSha256||entry.reconstruction.cutoutSha256!==cutoutSha256)fail();
  const preview=dataPng(entry.reconstruction.image,8*1024*1024),previewDims=await decode(preview);if(previewDims.width!==1024||previewDims.height!==1024)fail();const id='prepared-'+sourceSha256+'-'+cutoutSha256;if(items.some(i=>i.id===id))fail();
  items.push({id,sourceId,name:entry.name.trim(),category:entry.category,image:entry.cutout,partial:false,available:true,heels:typeof entry.heels==='boolean'?entry.heels:null,sleeveless:typeof entry.sleeveless==='boolean'?entry.sleeveless:null,confirmed:true,demo:false,synthetic:true,prepared:true,reviewNote:typeof entry.reviewNote==='string'?entry.reviewNote.slice(0,700):undefined,accessoryRole:entry.category==='accessory'?entry.accessoryRole:undefined,extraction:'sam-mask',reconstruction:{image:entry.reconstruction.image,provider:'OpenAI',model:reconstructionPreset.model,notice:reconstructionNotice,sourceSha256,cutoutSha256,confirmed:true},useReconstruction:true});
 }signal.throwIfAborted();return{source,items};
}
export function addPreparedResults(state:State,results:PreparedResults){const existing=new Set([...state.items,...state.pending].map(i=>i.id)),fresh=results.items.filter(i=>!existing.has(i.id));for(const source of results.sources??[results.source])if(fresh.some(i=>i.sourceId===source.id)&&!state.sources.some(s=>s.id===source.id))state.sources.push(source);state.items.push(...fresh);return fresh.length;}

// Old pending results are retained/moved without discarding their source or raw pixels.
export function finishStoredResults(state:State){
 let changed=false;
 const ready=state.pending.filter(i=>!!i.reconstruction||i.demo||(i.partial&&!i.extraction));
 for(const item of ready){if(!state.items.some(i=>i.id===item.id)){const copy={...item};if(copy.reconstruction)acceptFinishedPreview(copy);else copy.confirmed=true;state.items.push(copy);}changed=true;}
 if(ready.length)state.pending=state.pending.filter(i=>!ready.includes(i));
 for(const item of state.items)if(acceptFinishedPreview(item))changed=true;
 return changed;
}
