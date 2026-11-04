import{openWatchCropReview}from'./watch-crop-ui';
import{checkedWatchCrop}from'./checked-watch-crop';
import type{Source}from'./core';
import type{DiscoveredPiece}from'./discovery';
import{finishedImageIssues}from'./finished-image-quality';
import{prepareProcessingCrop,processingCropBox}from'./processing-crop';
import{boundedPhotoStep}from'./photo-response';
import{visualCrop}from'./visual-crop';
import{outfitKey}from'./outfit-options';
import{decodeSelectedPhoto}from'./photo-input';
import{sampleCollections}from'./sample-data';
import{prepareSample,addSample}from'./sample-import';
import{photoResolutionIssue,photoQualityMessage,type PhotoQualityReason}from'./photo-quality';
import './style.css';
import './selected-design.css';
import {finishStoredResults} from './prepared-results';
import {shownImage,openAccessoryReview,imageNeedsReview} from './reconstruction-ui';
import {browserAnalytics, analyticsConfig} from './analytics';
const usage=browserAnalytics();
import { initial, load, persist, suggest, validate, eligible, removeItem, removeSource, type State, type Item, type Category, type Look,accessoryRole,disableRetiredWearPreferences } from './core';
import{photoHash}from'./api';
import{photoProgressText}from'./photo-recovery';
import{processingUnavailableMessage,processingStatus,processingOff,runPhotoPipeline,settleInterruptedJobs,PhotoError,setPrivateTestAccess,hasPrivateTestAccess,registerPrivatePhoto,closeOrdinaryPhoto}from'./photo-pipeline';
let apiStatus=processingOff(),apiJob:AbortController|undefined;
const sourceUrls=new Map<string,string>();
let uploadHash = '', imageConsent = false, metadataConsent = false;
let preparedJob:AbortController|undefined;
function cancelApiJob(){preparedJob?.abort();imageConsent=false;metadataConsent=false;apiJob?.abort();}
function goPage(next:string){cancelApiJob();page=next;notice='';render();window.scrollTo(0,0);focusView();}
function focusView(){const heading=root.querySelector<HTMLElement>('main h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}
async function refreshApi(){apiStatus=await processingStatus();}

let uploadGeneration = 0;
let photoLoading=false, manualCropOpen=false,samplePickerOpen=false,sampleLoading=false;
let uploadSourceId: string | undefined;
let uploadName='My outfit photo';
let uploadOriginal:Blob|undefined,uploadOriginalLastModified:number|undefined;
let state: State = initial(), page = 'import', filter = 'all', notice = '', busy = false, current: Look | undefined, upload: HTMLImageElement | undefined, uploadBlob: Blob | undefined;
const root = document.querySelector<HTMLDivElement>('#app')!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => { const e = document.createElement(tag); e.textContent = text; e.className = cls; return e; };
const button = (text: string, fn: () => unknown, cls = '') => { const b = el('button', text, cls); b.onclick = async event => {if(event.detail>1||b.disabled)return;b.disabled=true;try{await fn();}catch{message('Something went wrong. Please try again; your saved wardrobe is still on this device.');}finally{if(b.isConnected)b.disabled=false;}}; return b; };
function img(src: string, alt: string) { const i = el('img'); i.src = src; i.alt = alt; return i; }
function field(label: string, input: HTMLElement) { const l = el('label', label); input.setAttribute('aria-label',label);l.append(input); return l; }
function select(values: string[], value: string, change: (s: string) => void) { const s = el('select'); for (const v of values) {
    const o = el('option', v);
    o.value = v;
    s.append(o);
} s.value = value; s.onchange = () => change(s.value); return s; }
async function save() { try {
    await persist(state);
    return true;
}
catch (e) {
    notice = String(e);
    render();
    return false;
} }
async function mutate(fn: () => void) { cancelApiJob();const previous=structuredClone(state);fn(); if(state.drafts){const valid=state.drafts.filter(l=>validate(l.ids,state.items,state.profile));if(valid.length!==state.drafts.length){notice='A piece changed. Find fresh combinations using your available wardrobe.';state.drafts=valid;current=valid[0];}}if(!await save()){state=previous;notice='Could not save the change. Your previous wardrobe is unchanged.';}render(); }
function message(text: string) { notice = text; render(); }
// One visible wardrobe. Legacy wardrobeView values remain stored but do not filter it.
function activeItems(){return state.items;}
function card(item:Item){const c=el('article','','garment');c.append(img(shownImage(item),item.name));return c;}
function render() {for(const[id,url]of sourceUrls)if(!state.sources.some(s=>s.id===id)){URL.revokeObjectURL(url);sourceUrls.delete(id);}if(page==='review')page='wardrobe';root.replaceChildren(); const header = el('header');header.dataset.page=page; const brand=el('div','','brand-block');brand.append(button('I have Nothing to Wear!',()=>goPage('import'),'brand home'));if(page==='import')brand.append(el('p','Let’s unlock outfits from your wardrobe.','home-tagline'));header.append(brand,button('My device',()=>goPage('settings'),'device-tools')); root.append(header); const nav = el('nav');nav.setAttribute('aria-label','Main navigation'); for (const [key, label] of [['import','The Pile'], ['wardrobe', 'Wardrobe'], ['dress', 'Hanger']]) {
    const b = button(label, () => { cancelApiJob();page = key; notice = ''; if(key==='import')void usage.capture('pile_open');if(key==='wardrobe')void usage.capture('wardrobe_open');if(key==='dress')void usage.capture('hanger_open');render();window.scrollTo(0,0);focusView(); });
    b.setAttribute('aria-current', (page==='review'?'import':page==='saved'?'dress':page) === key ? 'page' : 'false');
    nav.append(b);
} root.append(nav); const main = el('main');main.dataset.page=page;document.title=({import:'The Pile',wardrobe:'Wardrobe',dress:'Hanger',saved:'Saved looks',settings:'My device'}[page]??'Wardrobe')+' | I have Nothing to Wear!'; root.append(main); if (notice&&!apiJob) {
    const n = el('p', notice, 'notice');
    n.setAttribute('role', 'status');
    main.append(n);
} if (page === 'wardrobe')
    wardrobe(main); if (page === 'import')
    importPage(main); if (page === 'dress')
    dress(main); if (page === 'saved')
    saved(main); if (page === 'settings')
    settings(main);const footer=el('footer');footer.append(el('p','A little ‘oh, I could wear that!’ Your wardrobe is saved in this browser.'));const credit=el('a','Built by Yashasvi ❤️');credit.href='https://yashasvishailly.com/';credit.rel='noopener noreferrer';credit.target='_blank';footer.append(credit,button('About',about,'quiet'),button('Privacy & usage counts',usageSettings,'quiet'));root.append(footer); }
async function checkWatchSource(source:Source,piece:DiscoveredPiece){
 if(apiJob)return;let chosen=false;
 try{await openWatchCropReview(source,piece,async choice=>{
  const job=source.processing;if(!job?.manifest?.some(p=>p.id===piece.id)||state.items.some(i=>i.id==='auto-'+piece.id)||['sending-finish','unknown','result_unavailable'].includes(job.pieces[piece.id]?.stage??''))return false;
  const before=structuredClone(job);if(choice==='skip'){job.skippedWatches=[...new Set([...(job.skippedWatches??[]),piece.id])];job.pieces[piece.id]={stage:'skipped-watch',attempt:0};delete job.watchCrops?.[piece.id];job.stopReason='watch_skipped';job.state=job.manifest.every(p=>['saved','review','skipped-watch'].includes(job.pieces[p.id]?.stage??''))?'complete':'partial';}
  else{checkedWatchCrop(choice,source.sha256!,piece.id);job.watchCrops={...job.watchCrops,[piece.id]:choice};job.skippedWatches=job.skippedWatches?.filter(id=>id!==piece.id);job.pieces[piece.id]={stage:'waiting',attempt:0};job.stopReason=Object.values(job.pieces).some(p=>p.stage==='crop-review')?'watch_crop_review':undefined;}
  if(!await save()){source.processing=before;return false;}chosen=choice!=='skip';return true;
 },()=>{if(!chosen){notice='Watch skipped. Your other pieces remain.';render();return;}void(async()=>{const image=new Image();image.src=URL.createObjectURL(source.image);await image.decode();clearPhoto();upload=image;uploadBlob=source.image;uploadOriginal=source.original;uploadOriginalLastModified=source.originalLastModified;uploadHash=source.sha256!;uploadName=source.name;uploadSourceId=source.id;page='import';imageConsent=false;notice='Watch crop checked. Continue when you are ready; nothing has been sent.';render();focusView();})();});}catch{message('Could not open this saved photo. Your pieces remain.');}
}
function watchCropActions(m:HTMLElement,source:Source){const job=source.processing;if(!job||apiJob)return 0;const list=job.manifest?.filter(p=>p.kind==='watch'&&['crop-review','waiting'].includes(job.pieces[p.id]?.stage??'')&&(job.pieces[p.id]?.stage==='crop-review'||!!job.watchCrops?.[p.id])&&!state.items.some(i=>i.id==='auto-'+p.id))??[];if(list.length){const section=el('section','','watch-crop-checks');section.append(el('h2','Check a watch crop'),el('p','Your other pieces are saved. Check where the watch is before spending on its preview.'));for(const p of list)section.append(button(job.watchCrops?.[p.id]?'Change checked watch crop':'Check watch crop',()=>void checkWatchSource(source,p),'secondary'));m.append(section);}return list.filter(p=>job.pieces[p.id]?.stage==='crop-review').length;}
function wardrobe(m:HTMLElement){
 const confirmed=activeItems().filter(item=>item.confirmed&&!imageNeedsReview(item));
 const hero=el('section','','hero');hero.append(el('h1','Wardrobe'));
 if(confirmed.length)hero.append(button('Create outfit',()=>goPage('dress'),'primary'));
 m.append(hero);
 for(const source of state.sources.filter(s=>!s.demo))watchCropActions(m,source);
 if(activeItems().some(i=>i.reconstruction))m.append(el('p','AI-generated previews can differ from your clothes. Compare or remove any piece.','mode-note'));

 if(activeItems().some(i=>i.synthetic||i.demo))m.append(el('p','Sample','sample-context'));
 const visible=activeItems().filter(item=>item.confirmed||!!item.reconstruction);
 const grid=el('div','','grid');for(const i of visible){
    const c = card(i);if(i.demo||i.synthetic)c.append(el('p','Sample','sample-context'));
    const actions=el('div','','piece-actions');actions.append(button('Edit',()=>editPiece(i),'quiet'),button('Remove',()=>removePiece(i),'quiet'));if(i.reconstruction)actions.append(button('Compare images',()=>openAccessoryReview(i,save,render),'quiet'));c.append(actions);if(i.previewDecision==='set-aside')c.append(el('p','Set aside · not used in outfits','mode-note'));
    grid.append(c);
} if(!visible.length){const empty=el('section','','empty');empty.append(el('h2','Your pieces will appear here.'),el('p','Add an outfit photo in The Pile to get started.'),button('Go to The Pile',()=>goPage('import'),'secondary'));grid.append(empty);}else if(!grid.children.length)grid.append(el('p','No pieces in this category yet.','empty'));m.append(grid);}
async function removePiece(item:Item){
 const affected=state.looks.filter(look=>look.ids.includes(item.id)).length;
 const consequence=affected?` This also deletes ${affected} saved ${affected===1?'look':'looks'} containing it.`:'';
 if(!confirm(`Remove “${item.name}” from your wardrobe?${consequence} This cannot be undone. Your source photo will stay.`))return;
 await mutate(()=>removeItem(state,item.id));focusView();
}
function editPiece(item:Item){const dialog=el('dialog','','sheet edit-piece');dialog.setAttribute('aria-label','Edit piece');dialog.append(el('h2','Edit piece'));const name=el('input');name.value=item.name;name.maxLength=80;const category=select(['top','bottom','dress','shoes','layer','accessory'],item.category,()=>{}),available=el('input');available.type='checkbox';available.checked=item.available;dialog.append(field('Name',name),field('Category',category),field('Available to wear',available));let heels=item.heels,sleeveless=item.sleeveless;const comfort=el('div');function draw(){comfort.replaceChildren();if(category.value==='shoes')comfort.append(field('Has heels?',select(['Unknown','No','Yes'],heels===null?'Unknown':heels?'Yes':'No',v=>heels=v==='Unknown'?null:v==='Yes')));if(['top','dress','layer'].includes(category.value))comfort.append(field('Sleeveless?',select(['Unknown','No','Yes'],sleeveless===null?'Unknown':sleeveless?'Yes':'No',v=>sleeveless=v==='Unknown'?null:v==='Yes')));}category.onchange=draw;draw();dialog.append(comfort);const status=el('p');status.setAttribute('role','status');dialog.append(status);const saveButton=button('Save changes',async()=>{if(!name.value.trim()){status.textContent='Give this piece a name.';name.focus();return;}if(!state.items.includes(item)){dialog.close();return;}const nextCategory=category.value as Category;await mutate(()=>{item.name=name.value.trim();item.category=nextCategory;item.available=available.checked;item.heels=heels;item.sleeveless=sleeveless;if(nextCategory!=='accessory')delete item.accessoryRole;});dialog.close();},'primary');dialog.append(saveButton,button('Cancel',()=>dialog.close(),'quiet'));document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();name.focus();}
function clearPhoto(){
 cancelApiJob();uploadGeneration++;if(upload)URL.revokeObjectURL(upload.src);
 upload=undefined;uploadBlob=undefined;uploadOriginal=undefined;uploadOriginalLastModified=undefined;uploadSourceId=undefined;uploadHash='';photoLoading=false;manualCropOpen=false;notice='';
}
async function selectOutfitPhoto(file:File|undefined){
 if(!file||apiJob)return;
 cancelApiJob();const generation=++uploadGeneration;photoLoading=true;notice='';render();
 let nextUrl:string|undefined;
 try{
  const bitmap=await decodeSelectedPhoto(file);
  const canvas=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const normalizedIssue=photoResolutionIssue(canvas.width,canvas.height);if(normalizedIssue){bitmap.close();throw Error(normalizedIssue);}canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const decoded=await new Promise<Blob>((ok,no)=>canvas.toBlob(b=>b?ok(b):no(Error('Try another photo.')),'image/png'));
  const hash=await photoHash(decoded),image=new Image();nextUrl=URL.createObjectURL(decoded);image.src=nextUrl;await image.decode();
  if(generation!==uploadGeneration){URL.revokeObjectURL(nextUrl);return;}
  if(upload)URL.revokeObjectURL(upload.src);upload=image;uploadBlob=decoded;uploadOriginal=file;uploadOriginalLastModified=file.lastModified;uploadHash=hash;uploadName=file.name;uploadSourceId=state.sources.find(s=>s.sha256===hash)?.id;manualCropOpen=false;nextUrl=undefined;await refreshApi();
 }catch(error){if(nextUrl)URL.revokeObjectURL(nextUrl);if(generation===uploadGeneration)notice='Could not open this image: '+(error instanceof Error?error.message:'Try another photo.');}
 finally{if(generation===uploadGeneration){photoLoading=false;render();}}
}
function importPage(m:HTMLElement){
 m.append(el('h1','The Pile'));
 const photoGuidance='The best photo is clear, well-lit and full-length, with the focus on you and only you. Dark or blurry images may result in no capture or only a partial capture.';
 if(upload&&uploadBlob)m.append(el('p','Drop your outfit photos here','page-intro'),el('p',photoGuidance,'local-note'));

 if(apiStatus.accessRequired&&(!upload||!uploadBlob))processingAccessNotice(m);
 const file=el('input');file.type='file';file.accept='image/jpeg,image/png,image/webp';file.hidden=true;file.disabled=!!apiJob;file.setAttribute('aria-label','Choose outfit photo');
 file.onchange=()=>{const selected=file.files?.[0];file.value='';void selectOutfitPhoto(selected);};m.append(file);
 if(!upload||!uploadBlob){
  const zone=el('section','','upload-zone');zone.setAttribute('aria-label','Add an outfit photo');zone.setAttribute('aria-busy',String(photoLoading));
  const choose=button(photoLoading?'Opening your photo…':'Choose a photo',()=>file.click(),'primary');choose.disabled=photoLoading||!!apiJob;
  zone.append(el('h2','Drop your outfit photos here','upload-heading'),el('p',photoGuidance,'local-note'),choose);
  zone.ondragover=e=>{e.preventDefault();zone.classList.add('drag-over');};zone.ondragleave=()=>zone.classList.remove('drag-over');
  zone.ondrop=e=>{e.preventDefault();zone.classList.remove('drag-over');const files=e.dataTransfer?.files;if(!files?.length)return;if(files.length!==1){message('Choose one outfit photo at a time.');return;}void selectOutfitPhoto(files[0]);};
  const layout=el('div','','pile-layout'),photo=el('section','','pile-upload'),samples=el('section','','pile-samples');
  photo.setAttribute('aria-label','Upload guidance');samples.setAttribute('aria-label','Explore saved sample outfits');
  photo.append(zone,el('p','Adding more photos? Wait for the current photo to finish processing before uploading the next.','local-note'),el('p','Photos stay on this device until you allow processing.','local-note'));
  samples.append(el('h2','Try a sample'));
  if(!samplePickerOpen){const pictures=el('div','','sample-source-preview');for(const collection of [sampleCollections[0],sampleCollections[3]])pictures.append(img(collection.source,'AI-generated outfit — '+collection.title));samples.append(el('p','Try saved outfits. No upload needed.','sample-intro'),pictures,el('p','AI-generated sample outfits','sample-provenance'));}
  samplePicker(samples);layout.append(photo,samples);m.append(layout);
 }else{
  const preview=el('section','','photo-workspace'),picture=el('div','','photo-preview'),options=el('div','','photo-options');
  preview.setAttribute('aria-busy',String(photoLoading));picture.append(img(upload.src,'Your outfit photo preview'));
  const photoActions=el('div','','actions'),replacePhoto=button('Use another photo',()=>file.click(),'quiet');replacePhoto.disabled=photoLoading||!!apiJob;const closePhoto=button('Close photo',()=>{clearPhoto();render();},'quiet');closePhoto.disabled=photoLoading||!!apiJob;photoActions.append(replacePhoto,closePhoto);picture.append(photoActions);

  if(state.sources.some(source=>source.id===uploadSourceId&&source.demo)){options.append(el('p','These sample pieces are already saved. No processing is needed.','mode-note'),button('Open Wardrobe',()=>goPage('wardrobe'),'primary'));}else automaticPhotoControls(options);
  if(photoLoading)options.append(el('p','Opening your replacement photo…','processing-note'));
  if(!manualCropOpen){const cropButton=button('Make a manual crop',()=>{manualCropOpen=true;render();document.querySelector<HTMLElement>('.manual-editor')?.scrollIntoView({block:'start'});document.querySelector<HTMLElement>('.crop-area')?.focus({preventScroll:true});},'secondary manual-crop-toggle');cropButton.disabled=photoLoading||!!apiJob;options.append(cropButton);}
  preview.append(picture,options);m.append(preview,el('p','Adding more photos? Wait for the current photo to finish processing before uploading the next.','local-note'));
  if(manualCropOpen){
   const manual=el('section','','manual-editor');manual.append(el('h2','Choose an area'),el('p','Drag the box to move it. Pull a corner to resize.','mode-note'),el('p','Use this crop, then choose Find my pieces. Nothing is processed until you allow it.','mode-note'));
   const crop=visualCrop(upload),cropStatus=el('p','','mode-note');cropStatus.setAttribute('role','status');
   manual.append(crop.element,cropStatus,button('Use this crop',async()=>{
    if(photoLoading||apiJob||!upload||!uploadBlob)return;const rect=crop.value();try{processingCropBox({width:upload.naturalWidth,height:upload.naturalHeight},rect);}catch(error){cropStatus.textContent=error instanceof Error?error.message:'Choose a larger area.';return;}
    const selected=upload,generation=++uploadGeneration;cancelApiJob();photoLoading=true;manualCropOpen=false;notice='Preparing crop…';render();let nextUrl:string|undefined;
    try{const blob=await prepareProcessingCrop(selected,rect),hash=await photoHash(blob),image=new Image();nextUrl=URL.createObjectURL(blob);image.src=nextUrl;await boundedPhotoStep(image.decode(),new AbortController().signal,10000);
     if(generation!==uploadGeneration){URL.revokeObjectURL(nextUrl);return;}
     if(upload)URL.revokeObjectURL(upload.src);upload=image;uploadBlob=blob;uploadHash=hash;uploadSourceId=state.sources.find(source=>source.sha256===hash)?.id;nextUrl=undefined;imageConsent=false;notice='Crop ready. Allow processing, then choose Find my pieces.';await refreshApi();
    }catch(error){if(nextUrl)URL.revokeObjectURL(nextUrl);if(generation===uploadGeneration)notice='Could not use this crop: '+(error instanceof Error?error.message:'Try again.');}
    finally{if(generation===uploadGeneration){photoLoading=false;render();document.querySelector<HTMLElement>('.photo-options')?.scrollIntoView({block:'center'});}}
   },'primary'),button('Cancel',()=>{manualCropOpen=false;render();document.querySelector<HTMLButtonElement>('.manual-crop-toggle')?.focus();},'quiet'));m.append(manual);
  }
 }
 if(upload&&uploadBlob)samplePicker(m);
 savedSourceGallery(m);
 if(preparedJob)m.append(el('p','Adding pieces…','mode-note'),button('Cancel adding pieces',()=>preparedJob?.abort(),'quiet'));



}
function choiceGroup(label:string,values:string[],value:string,onChange:(s:string)=>void){const group=el('fieldset','','choices');group.append(el('legend',label));for(const v of values){const b=button(v,()=>{cancelApiJob();onChange(v);metadataConsent=false;state.drafts=[];current=undefined;void save();render();const replacement=Array.from(root.querySelectorAll<HTMLFieldSetElement>('fieldset')).find(f=>f.querySelector('legend')?.textContent===label);Array.from(replacement?.querySelectorAll('button')??[]).find(b=>b.textContent===v)?.focus({preventScroll:true});});b.setAttribute('aria-pressed',String(v===value));group.append(b);}return group;}
function dress(m:HTMLElement){const heading=el('div','','hanger-heading');heading.append(el('h1','Hanger'),button('Saved looks',()=>goPage('saved'),'quiet'));m.append(heading);const layout=el('div','','styling-layout'),controls=el('section','','preferences');controls.append(choiceGroup('What are you dressing for?',['Dinner','Everyday','Work','Weekend'],state.profile.occasion,v=>state.profile.occasion=v),choiceGroup('Mood',['Relaxed','Minimal','Playful'],state.profile.style,v=>state.profile.style=v));controls.append(button((state.drafts?.some(l=>l.profile.occasion===state.profile.occasion&&l.profile.style===state.profile.style&&validate(l.ids,activeItems(),state.profile))?'Try another outfit':'Create outfit'),async()=>{const generate=controls.querySelector('button.primary') as HTMLButtonElement;generate.disabled=true;generate.textContent='Putting pieces together…';state.drafts=suggest(activeItems(),state.profile,state.outfitHistory??[]);state.outfitHistory=Array.from(new Set([...(state.outfitHistory??[]),...state.drafts.map(l=>outfitKey(l.profile,l.ids))])).slice(-4800);current=state.drafts[0];notice=current?'':'Choose an available top and bottom, or a dress.';await save();render();const results=document.querySelector<HTMLElement>('.results');results?.scrollIntoView({block:'start'});(results?.querySelector<HTMLElement>('[role=tab]')??results)?.focus({preventScroll:true});},'primary'));const results=el('section','','results');results.setAttribute('aria-label','Outfit');results.tabIndex=-1;const drafts=(state.drafts??[]).filter(l=>l.profile.occasion===state.profile.occasion&&l.profile.style===state.profile.style&&validate(l.ids,activeItems(),state.profile));if(!current||!drafts.some(l=>l.id===current!.id))current=drafts[0];if(current){const tabs=el('div','','look-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Outfit options');drafts.forEach((look,n)=>{const b=button(`Look ${n+1}`,()=>{current=look;render();});b.setAttribute('role','tab');b.tabIndex=look.id===current!.id?0:-1;b.setAttribute('aria-selected',String(look.id===current!.id));b.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const i=(n+(e.key==='ArrowRight'?1:-1)+drafts.length)%drafts.length;current=drafts[i];render();(document.querySelectorAll('[role=tab]')[i] as HTMLElement)?.focus();}};tabs.append(b);});if(drafts.length>1)results.append(tabs);board(results,current,true);}else{const empty=el('div','','outfit-empty');empty.append(el('h2','Add a few pieces.'),el('p',activeItems().some(item=>item.confirmed)?'Choose available pieces in Wardrobe, then return here to make an outfit.':'Add pieces to Wardrobe before making an outfit. A top and bottom, or a dress, is enough to begin.'),button('Open Wardrobe',()=>goPage('wardrobe'),'secondary'));results.append(empty);}layout.append(controls,results);m.append(layout);}
function swapPicker(look:Look,item:Item){const options=eligible(activeItems(),state.profile).filter(i=>i.category===item.category&&(item.category!=='accessory'||accessoryRole(i)===accessoryRole(item))&&!look.ids.includes(i.id)&&validate(look.ids.map(id=>id===item.id?i.id:id),state.items,state.profile));const dialog=el('dialog','','sheet');dialog.setAttribute('aria-label','Swap '+(item.category==='accessory'?accessoryRole(item):item.category));dialog.append(el('h2','Swap '+(item.category==='accessory'?accessoryRole(item):item.category)));if(options.length){const list=el('div','','swap-options');for(const option of options){const b=button('',async()=>{const replacement={...look,id:crypto.randomUUID(),ids:look.ids.map(id=>id===item.id?option.id:id)};if(!validate(replacement.ids,state.items,state.profile)){dialog.close();message('That piece is no longer available. Try another combination.');return;}state.drafts=(state.drafts??[]).map(l=>l.id===look.id?replacement:l);current=replacement;dialog.close();await save();render();},'swap-option');b.setAttribute('aria-label',option.name);b.prepend(img(shownImage(option),''));list.append(b);}dialog.append(list);}else dialog.append(el('p','No other suitable '+(item.category==='accessory'?accessoryRole(item):item.category)+' is available yet. Add another piece or update availability in your wardrobe.','empty'));const cancel=button('Cancel swap',()=>dialog.close(),'secondary');dialog.append(cancel);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();cancel.focus();}
function board(m:HTMLElement,l:Look,editable=false){
 const b=el('section','','look'),heading=el('div','','outfit-heading'),title=el('div','','outfit-title');
 const unavailable=!validate(l.ids,state.items,l.profile);if(unavailable)b.append(el('p','A piece in this saved look is unavailable or has changed. Check your wardrobe before wearing it.','notice'));
 title.append(el('h2','Your outfit'));if(l.ids.some(id=>{const i=state.items.find(i=>i.id===id);return i?.synthetic||i?.demo;}))title.append(el('p','Sample outfit','sample-context'));heading.append(title);b.append(heading);
 const images=el('div','','board'),clothing=el('div','','outfit-main-pieces'),accessories=el('div','','outfit-accessory-pieces');
 for(const id of l.ids){const item=state.items.find(i=>i.id===id);if(!item)continue;const wrap=el('div','',`board-piece ${item.category}`),frame=el('div','','outfit-piece-image');frame.append(img(shownImage(item),item.name));wrap.append(frame);
  if(editable){const caption=el('div','','outfit-piece-caption'),swap=button('Swap',()=>swapPicker(l,item),'swap-link');swap.setAttribute('aria-label','Swap '+item.name);caption.append(swap);wrap.append(caption);}(item.category==='accessory'?accessories:clothing).append(wrap);
 }
 clothing.dataset.count=String(clothing.children.length);images.append(clothing);if(accessories.children.length)images.append(el('h3','Accessories','accessories-heading'),accessories);
 let extras:HTMLDetailsElement|undefined;
 if(editable){const finishing=el('details','','finishing-pieces');finishing.append(el('summary','Add pieces'));for(const item of eligible(activeItems(),l.profile).filter(i=>['shoes','layer','accessory'].includes(i.category))){const input=el('input');input.type='checkbox';input.checked=l.ids.includes(item.id);input.onchange=async()=>{let ids=l.ids.filter(id=>id!==item.id);if(input.checked){ids=ids.filter(id=>{const old=state.items.find(i=>i.id===id)!;return item.category==='layer'?old.category!=='layer':item.category==='shoes'?old.category!=='shoes':old.category!=='accessory'||accessoryRole(old)!==accessoryRole(item);});ids.push(item.id);}if(!validate(ids,activeItems(),l.profile)){message('That piece is no longer available. Check your wardrobe.');return;}const replacement={...l,id:crypto.randomUUID(),ids};state.drafts=(state.drafts??[]).map(old=>old.id===l.id?replacement:old);current=replacement;await save();render();};input.setAttribute('aria-label',item.name);const choice=el('label','','piece-toggle');choice.append(input,img(shownImage(item),item.name));finishing.append(choice);}if(finishing.children.length>1)extras=finishing;}
 b.append(images);if(extras)b.append(extras);b.append(el('p',l.reason,'mode-note'));if(editable)heading.append(button(state.looks.some(x=>x.id===l.id)?'Saved':'Save look',async()=>{if(!state.looks.some(x=>x.id===l.id)&&validate(l.ids,activeItems(),state.profile)){state.looks.push(structuredClone(l));if(await save())void usage.capture('look_saved');render();}},'secondary look-save'));else b.append(button('Delete saved look',async()=>{if(!confirm('Delete this saved look? This cannot be undone. Your wardrobe pieces will stay.'))return;await mutate(()=>{state.looks=state.looks.filter(x=>x.id!==l.id);});focusView();},'quiet'));m.append(b);
}
function saved(m: HTMLElement) { m.append(el('h1', 'Saved looks'),el('p','Your saved looks keep the pieces you chose when saving them.','mode-note'),button('Back to Hanger',()=>goPage('dress'),'quiet')); for (const l of state.looks)
    board(m, l); if (!state.looks.length)
    m.append(el('p', 'Save a combination and find it here next time.', 'empty')); }
async function deleteSavedSource(id:string){if(!confirm('Remove this saved photo and its pieces and looks?'))return;cancelApiJob();if(uploadSourceId===id)clearPhoto();await mutate(()=>removeSource(state,id));}
function settings(m: HTMLElement) { m.append(el('h1', 'My device'), el('p', 'Your photos, pieces and saved looks stay in this browser. OpenAI regenerates the individual previews, including obscured parts, so details can differ from the original. Nothing is sent for AI processing without your permission. Clearing browser storage removes your wardrobe. Return in this same browser to find your saved pieces and looks.')); const privacy=el('details','','processing-privacy');privacy.append(el('summary','How photos are processed'),el('p','With your permission, the AI analysis provider receives a selected photo to identify pieces, or selected wardrobe details and preferences for outfit suggestions. For automatic processing, OpenAI receives either an extracted item cutout or a model-selected source crop to regenerate the individual previews, including obscured parts. Source crops can include faces, skin, other clothes or background; the processing consent identifies which mode applies. Provider data-use and retention policies apply; AI analysis provider free-credit processing may use content for product improvement.'),el('p','The app server does not retain your photos or wardrobe. A shared spending ledger retains aggregate estimated charges and anonymous operation markers without an automatic reset. Stored photos stay in this browser until you delete them. New uploads retain the selected original file as well as the normalized working image; older photos may only have the normalized image. Manually cropped images may include background.'));m.append(privacy);  for (const source of state.sources)
    m.append(el('p',`Photo ${state.sources.indexOf(source)+1}: ${source.original?'Original file retained':'Normalized image only — original file unavailable'}`,'local-note'),button('Delete photo '+(state.sources.indexOf(source)+1)+' and its pieces', () => deleteSavedSource(source.id))); m.append(button('Delete all local data', async () => { if (!confirm('Delete all photos, pieces, profile and saved looks from this browser?'))
    return; state = initial(); current = undefined; if(upload)URL.revokeObjectURL(upload.src);uploadSourceId=undefined;uploadGeneration++;upload = undefined; uploadBlob = undefined; await save(); message('All wardrobe data has been deleted from this browser.'); }, 'danger')); }


function savedSourceGallery(m:HTMLElement){
 if(!state.sources.length)return;const section=el('section','','saved-sources');section.append(el('h2','Your photos'),el('p','Saved on this device','local-note'));const grid=el('div','','source-grid');
 for(const source of state.sources){if(!sourceUrls.has(source.id))sourceUrls.set(source.id,URL.createObjectURL(source.image));const card=el('article','','source-card');const open=button('Open photo',async()=>{if(apiJob)return;clearPhoto();const image=new Image();image.src=URL.createObjectURL(source.image);await image.decode();upload=image;uploadBlob=source.image;uploadOriginal=source.original;uploadOriginalLastModified=source.originalLastModified;uploadHash=source.sha256??await photoHash(source.image);uploadName=source.name;uploadSourceId=source.id;await save();render();window.scrollTo(0,0);},'source-open');open.setAttribute('aria-label','Open photo '+(state.sources.indexOf(source)+1));open.prepend(img(sourceUrls.get(source.id)!,'Saved outfit photo'));card.append(open,button('Remove photo',()=>deleteSavedSource(source.id),'quiet'));grid.append(card);}section.append(grid);m.append(section);
 for(const[id,url]of sourceUrls)if(!state.sources.some(s=>s.id===id)){URL.revokeObjectURL(url);sourceUrls.delete(id);}
}
function processingAccessNotice(m:HTMLElement){
 m.append(el('p',processingUnavailableMessage(apiStatus),'processing-note'));
 if(apiStatus.processingAccessUrl==='/processing-access'){const link=el('a','Sign in for photo processing','processing-sign-in');link.href='/processing-access';m.append(link);m.append(el('p','Sign in before choosing a photo. Your saved wardrobe stays in this browser.','mode-note'),el('p','Cloudflare Access handles sign-in and may retain authentication records. Photo processing still needs your separate permission.','mode-note'));}
}
function automaticPhotoControls(m:HTMLElement){
 const source=state.sources.find(s=>s.id===uploadSourceId);if(apiJob){const progress=el('section','','processing-progress');progress.setAttribute('aria-label','Photo processing');const text=el('p',apiJob.signal.aborted?'Stopping processing…':notice||'Finding your pieces…','processing-note');text.setAttribute('role','status');const stop=button(apiJob.signal.aborted?'Stopping…':'Stop processing',()=>{cancelApiJob();render();},'primary stop-processing');stop.disabled=apiJob.signal.aborted;progress.append(text,stop);m.append(progress);return;}
 const job=source?.processing;
 if(job)m.append(el('p',job.photoQualityReason?photoQualityMessage(job.photoQualityReason):photoProgressText(job),'processing-note'));
 if(source&&watchCropActions(m,source)&&job?.stopReason==='watch_crop_review')return;
 if(job?.state==='complete'||(!job&&state.items.some(i=>i.sourceId===source?.id))){m.append(button('Open Wardrobe',()=>goPage('wardrobe'),'primary'));return;}
 if(job&&(job.photoQualityReason||['job_expired','no_items','manifest_unavailable','quality_rejected','context_source_edge','context_evidence_invalid','context_crop_too_broad',...finishedImageIssues].includes(job.stopReason??''))){m.append(button('Open Wardrobe',()=>goPage('wardrobe'),'primary'));return;}
 if(!apiStatus.enabled||(!job?.manifest&&apiStatus.remainingDiscovery<1)||(apiStatus.inputMode!=='discovered-context-v1'&&apiStatus.remainingSegments<1)||apiStatus.remainingFinishes<1||(!apiStatus.registrationRequired&&apiStatus.approvedSourceSha256!==uploadHash)){const disabled=button('Find my pieces',()=>{},'primary');disabled.disabled=true;const recheck=button('Check availability',async()=>{recheck.textContent='Checking…';await refreshApi();render();},'secondary');m.append(disabled);if(apiStatus.accessRequired)processingAccessNotice(m);else m.append(el('p',processingUnavailableMessage(apiStatus),'processing-note'));m.append(recheck);return;}
 const consent=el('input');consent.type='checkbox';consent.checked=imageConsent;consent.disabled=!!apiJob||photoLoading;const start=button(apiJob?'Finding your pieces…':job?'Continue unfinished pieces':'Find my pieces',runAutomaticPhoto,'primary');start.disabled=!imageConsent||!!apiJob||photoLoading;consent.onchange=()=>{imageConsent=consent.checked;start.disabled=!imageConsent||!!apiJob||photoLoading;};m.append(field(apiStatus.inputMode==='discovered-context-v1'?'Allow the AI analysis provider to identify pieces and OpenAI to receive their selected photo crops and regenerate the individual previews, including obscured parts. These crops may include faces or skin. Generated details can differ. Provider data and billing terms apply; AI analysis provider free credits may allow product-improvement use.':'Allow the AI analysis provider to read this photo and OpenAI to regenerate the individual previews, including obscured parts, from the extracted pieces. Provider data and billing terms apply; AI analysis provider free credits may allow product-improvement use.',consent),start);
}
async function runAutomaticPhoto(){
 if(apiJob||photoLoading||!uploadBlob||!imageConsent||!apiStatus.enabled)return;const resolutionIssue=upload&&photoResolutionIssue(upload.naturalWidth,upload.naturalHeight);if(resolutionIssue){message(resolutionIssue);return;}const controller=new AbortController();apiJob=controller;imageConsent=false;const blob=uploadBlob,hash=uploadHash;let source=state.sources.find(s=>s.sha256===hash);
 if(source?.processing?.state==='complete'){apiJob=undefined;message('This photo has already been processed. Your saved pieces are in Wardrobe.');return;}
 if(!source){source={id:'photo-'+hash,sha256:hash,name:uploadName,image:blob,original:uploadOriginal,originalName:uploadOriginal?uploadName:undefined,originalLastModified:uploadOriginalLastModified,imageKind:'normalized',demo:false};state.sources.push(source);}else source.sha256=hash;uploadSourceId=source.id;notice='Finding your pieces…';render();
 try{if(apiStatus.privateTest&&apiStatus.registrationRequired){await registerPrivatePhoto(hash,controller.signal);await refreshApi();}const result=await runPhotoPipeline(state,source,apiStatus,controller.signal,async()=>{if(!await save())throw new PhotoError('storage');},undefined,undefined,(saved,total)=>{notice=saved?`${saved} of ${total} pieces saved.`:'Finding your pieces…';render();});notice=result.saved===result.total&&result.total>0?'Pieces saved.':result.saved?'Some pieces weren’t ready. Your other pieces are saved.':'No pieces were ready. Your photo is saved.';if(source.processing?.stopReason&&[...finishedImageIssues,'context_source_edge','context_evidence_invalid','context_crop_too_broad'].includes(source.processing.stopReason))notice=photoProgressText(source.processing);if(!controller.signal.aborted&&result.saved)page='wardrobe';}
 catch(e){const words:Record<string,string>={job_expired:'This processing session expired. Your saved pieces remain.',manifest_unavailable:'The earlier discovery result could not be recovered. Nothing was repeated.',recovery_unavailable:'We could not safely check this unfinished request. Your saved pieces remain.',busy:'Photo processing is busy. Please wait a moment.',admission_busy:'Photo processing is busy. Please wait a moment.',admission_rate_limit:'Please wait a moment before continuing unfinished pieces.',limit:'Photo processing has reached its limit for now.',duplicate:'This photo has already been added.',rate:'Please wait before adding another photo.',outcome_unknown:'The last request could not be confirmed. Your saved pieces remain.',storage:'Could not save on this device. Processing stopped.'};notice=e instanceof PhotoError?(words[e.code]??(e.code.startsWith('photo_quality_')?photoQualityMessage(e.code.slice(14) as PhotoQualityReason):'Processing stopped. Your saved pieces remain.')):'Processing stopped. Your saved pieces remain.';}
 finally{await closeOrdinaryPhoto();if(apiJob===controller)apiJob=undefined;await refreshApi();render();if(page==='wardrobe')focusView();}
}
load().then(async s => { state=s;const retired=disableRetiredWearPreferences(state),finished=finishStoredResults(state),interrupted=settleInterruptedJobs(state);let changed=retired||finished||interrupted;for(const source of state.sources)if(!source.sha256){source.sha256=await photoHash(source.image);changed=true;}if(changed)await persist(state);current=state.drafts?.find(l=>validate(l.ids,activeItems(),state.profile));await refreshApi(); render(); }).catch(e => { notice = String(e); render(); });

function usageSettings(){
 const dialog=el('dialog','','sheet');dialog.setAttribute('aria-label','Privacy and usage counts');dialog.append(el('h2','Your wardrobe stays yours.'),el('p','Optional anonymous usage counts help improve this app. Analytics providers receive named actions, such as opening Wardrobe or Hanger. No photos, filenames, garment details, style preferences, prompts, personal IDs or session replay are sent. Analytics providers still receive network metadata such as your IP address.'));
 const input=el('input');input.type='checkbox';input.checked=usage.consent();dialog.append(field('Allow anonymous usage counts',input));
 if(!analyticsConfig.gaManualVerified)dialog.append(el('p','One analytics provider is currently paused while its automatic measurement settings are checked.','mode-note'));
 dialog.append(button('Save privacy choice',()=>{usage.setConsent(input.checked);dialog.close();},'primary'),button('Close',()=>dialog.close(),'quiet'));
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
}

function privateTestSettings(m:HTMLElement){
 const panel=el('details','','private-test');panel.append(el('summary','Private test'));
 if(hasPrivateTestAccess()){panel.append(el('p','Private test access is active for this tab.'),button('End test',async()=>{cancelApiJob();setPrivateTestAccess('');await refreshApi();render();},'quiet'));}
 else{const code=el('input');code.type='password';code.autocomplete='off';code.spellcheck=false;code.setAttribute('aria-label','Private access code');const status=el('p');status.setAttribute('role','status');panel.append(field('Access code',code),button('Start test',async()=>{const value=code.value;code.value='';try{setPrivateTestAccess(value);await refreshApi();if(!apiStatus.enabled)throw Error();page='import';notice='Private test ready.';render();focusView();}catch{setPrivateTestAccess('');status.textContent='Test access is unavailable.';}},'secondary'),status);}
 m.append(panel);
}
function processingSettings(m:HTMLElement){privateTestSettings(m);
 const panel=el('details','','meta-controls');panel.append(el('summary','Processing status'),el('p',apiStatus.enabled?'Photo processing is available for an approved photo.':processingUnavailableMessage(apiStatus)),button('Check availability',async()=>{await refreshApi();render();}));

 m.append(panel);
}

function about(){
 const dialog=el('dialog','','sheet about-sheet');dialog.setAttribute('aria-label','About I Have Nothing to Wear');
 dialog.append(el('h2','Why we built this'),el('p','“I have nothing to wear.” It’s a pain point for both men and women. Many men have heard their sisters, girlfriends or wives say it. Many women have stood in front of a wardrobe full of clothes and felt it themselves. As a woman, I understand where that feeling comes from. It’s not that we don’t have clothes. We can’t put together an outfit for the particular occasion, place or situation.'),el('p','I Have Nothing to Wear is a mobile-first web app that helps people see outfits in the clothes they already own. The experience moves from The Pile, where outfit photos go, to Wardrobe, where individual pieces live, and Hanger, where those pieces can be combined, swapped and saved as outfits. The aim is to help someone answer, “What can I wear for this?” without buying more clothes.'),el('p','Built by Yashasvi Shailly, an operator who builds practical AI products.'));
 const products=el('a','More things I’ve built');products.href='https://yashasvishailly.com/products/';products.target='_blank';products.rel='noopener noreferrer';
 dialog.append(products,button('Close',()=>dialog.close(),'quiet'));dialog.tabIndex=-1;document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();dialog.focus();dialog.scrollTop=0;
}

function samplePicker(m:HTMLElement){
 const section=el('section','','sample-picker');const toggle=button(samplePickerOpen?'Hide sample choices':'Load sample wardrobe',()=>{samplePickerOpen=!samplePickerOpen;render();},'secondary');toggle.disabled=!!apiJob||sampleLoading;toggle.setAttribute('aria-expanded',String(samplePickerOpen));section.append(toggle);
 if(samplePickerOpen){section.append(el('p','Choose an AI-generated outfit to add its saved pieces to your wardrobe. They can mix with your other pieces in Hanger. No photo is processed.','mode-note'));const grid=el('div','','sample-choices');for(const collection of sampleCollections){const card=el('article','','sample-choice');card.append(img(collection.source,'AI-generated outfit — '+collection.title),el('h3',collection.title));if(collection.items.length){const choose=button('Use '+collection.title,async()=>{if(sampleLoading||apiJob)return;sampleLoading=true;render();try{const prepared=await prepareSample(collection);await mutate(()=>{const added=addSample(state,prepared);current=undefined;page='wardrobe';notice='Saved sample pieces added to your wardrobe. Generated details can differ from the source.';});}finally{sampleLoading=false;render();if(page==='wardrobe')focusView();}},'secondary');choose.disabled=sampleLoading||!!apiJob;card.append(choose);}else{const pending=button('Saved pieces coming soon',()=>{},'secondary');pending.disabled=true;card.append(pending);}card.append(el('p',collection.note,'mode-note'));grid.append(card);}section.append(grid);}m.append(section);
}
