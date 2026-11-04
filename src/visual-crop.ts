export interface CropRect{x:number;y:number;w:number;h:number}
export type CropAction='move'|'nw'|'ne'|'sw'|'se';
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
export function adjustCrop(rect:CropRect,action:CropAction,dx:number,dy:number):CropRect{
 if(![rect.x,rect.y,rect.w,rect.h,dx,dy].every(Number.isFinite))throw Error('Invalid crop');
 const min=.02;if(action==='move')return{...rect,x:clamp(rect.x+dx,0,1-rect.w),y:clamp(rect.y+dy,0,1-rect.h)};
 let left=rect.x,right=rect.x+rect.w,top=rect.y,bottom=rect.y+rect.h;
 if(action.includes('w'))left=clamp(left+dx,0,right-min);else right=clamp(right+dx,left+min,1);
 if(action.includes('n'))top=clamp(top+dy,0,bottom-min);else bottom=clamp(bottom+dy,top+min,1);
 return{x:left,y:top,w:right-left,h:bottom-top};
}
export function visualCrop(photo:HTMLImageElement,initial?:CropRect,onChange?:()=>void){
 let rect:CropRect=initial?{...initial}:{x:.15,y:.15,w:.7,h:.7};
 const element=document.createElement('div');element.className='visual-crop';element.style.maxWidth=Math.min(640,Math.round(520*photo.naturalWidth/photo.naturalHeight))+'px';
 const image=document.createElement('img');image.src=photo.src;image.alt='Photo to crop';image.draggable=false;image.width=photo.naturalWidth;image.height=photo.naturalHeight;element.append(image);
 const area=document.createElement('div');area.className='crop-area';area.tabIndex=0;area.setAttribute('role','group');area.setAttribute('aria-label','Crop area. Arrow keys move the box. Hold Shift for larger steps.');area.dataset.cropAction='move';element.append(area);
 const grid=document.createElement('span');grid.className='crop-grid';grid.setAttribute('aria-hidden','true');area.append(grid);
 const status=document.createElement('span');status.className='sr-only';status.setAttribute('aria-live','polite');element.append(status);
 const names={nw:'top left',ne:'top right',sw:'bottom left',se:'bottom right'};
 const paint=()=>{area.style.left=rect.x*100+'%';area.style.top=rect.y*100+'%';area.style.width=rect.w*100+'%';area.style.height=rect.h*100+'%';};
 const key=(event:KeyboardEvent,action:CropAction)=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const step=event.shiftKey?.05:.01;rect=adjustCrop(rect,action,event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0);paint();onChange?.();status.textContent=action==='move'?'Crop moved.':'Crop resized.';};area.onkeydown=e=>key(e,'move');
 for(const action of ['nw','ne','sw','se'] as const){const handle=document.createElement('button');handle.type='button';handle.className='crop-handle '+action;handle.dataset.cropAction=action;handle.setAttribute('aria-label','Resize '+names[action]+' corner. Use arrow keys.');handle.onkeydown=e=>key(e,action);area.append(handle);}
 // The same bounded geometry powers drag, keyboard and single-tap controls.
 const wrapper=document.createElement('div');wrapper.className='visual-crop-editor';wrapper.append(element);
 const controls=document.createElement('details');controls.className='crop-tap-controls';const summary=document.createElement('summary');summary.textContent='Adjust without dragging';controls.append(summary);
 const label=document.createElement('label');label.textContent='Adjust';const select=document.createElement('select');select.setAttribute('aria-label','Crop adjustment');
 for(const [value,name]of [['move','Move crop'],['nw','Resize top left corner'],['ne','Resize top right corner'],['sw','Resize bottom left corner'],['se','Resize bottom right corner']]){const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option);}label.append(select);controls.append(label);
 const directions=document.createElement('div');directions.className='crop-tap-directions';
 for(const [name,dx,dy]of [['Left',-.01,0],['Right',.01,0],['Up',0,-.01],['Down',0,.01]] as const){const button=document.createElement('button');button.type='button';button.textContent=name;button.setAttribute('aria-label','Adjust crop '+name.toLowerCase());button.onclick=()=>{const action=select.value as CropAction;rect=adjustCrop(rect,action,dx,dy);paint();onChange?.();status.textContent=action==='move'?'Crop moved.':'Crop resized.';};directions.append(button);}controls.append(directions);wrapper.append(controls);
 let drag:{pointer:number;x:number;y:number;rect:CropRect;action:CropAction}|undefined;
 element.onpointerdown=e=>{const target=(e.target as HTMLElement).closest<HTMLElement>('[data-crop-action]');if(!target||e.button!==0)return;e.preventDefault();const action=target.dataset.cropAction as CropAction;drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,rect:{...rect},action};element.setPointerCapture(e.pointerId);target.focus({preventScroll:true});};
 element.onpointermove=e=>{if(!drag||drag.pointer!==e.pointerId)return;const box=element.getBoundingClientRect();if(box.width&&box.height){rect=adjustCrop(drag.rect,drag.action,(e.clientX-drag.x)/box.width,(e.clientY-drag.y)/box.height);paint();onChange?.();}};
 const stop=(e:PointerEvent)=>{if(drag?.pointer!==e.pointerId)return;drag=undefined;if(element.hasPointerCapture(e.pointerId))element.releasePointerCapture(e.pointerId);status.textContent='Crop selected.';};element.onpointerup=stop;element.onpointercancel=stop;paint();return{element:wrapper,value:()=>({...rect})};
}
