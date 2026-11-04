import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{decodeMaskToRaster}from'@meta-sam/parser';
import{parseMasks,cutoutPixels,type GarmentMask}from'../src/masks';import{projectMask}from'../src/mask-projection';import{liftCropMask,cropSourcePixels}from'../src/localization-crop';import{sourceRaster}from'../src/server/two-stage-experiment';import{maskQuality}from'../src/mask-quality';import{MetaAdapters,ProviderError}from'../src/server/meta';import{syntheticPng}from'./fixtures/synthetic-png';
const wire=readFileSync(new URL('./fixtures/sam-button.txt',import.meta.url),'utf8').trim().split(',1<|box')[0];
async function* events(text=wire){yield{type:'response.output_text.done',item_id:'f',output_index:0,content_index:0,text};yield{type:'response.completed'};}
const base=(await parseMasks(events(),320,334))[0],native=decodeMaskToRaster(base.mask),scaled:GarmentMask={...base,bounds:{left:40,top:60,right:160,bottom:114}};
const pixels=(width:number,height:number)=>{const rgba=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set([x%251,y%251,(x+2*y)%251,255],(y*width+x)*4);return{width,height,rgba};};
test('independent native grid maps source pixel centres without rewriting payloads or inferring a1024 limit',()=>{
  const original=JSON.stringify(base);
  for(const[w,h]of[[60,27],[120,54],[30,14],[73,31],[1,1]]){
    const record={...base,bounds:{left:3,top:5,right:3+w,bottom:5+h}},before=JSON.stringify(record),p=projectMask(record,400,300);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)assert.equal(p.at(x+3,y+5),native[Math.floor((y+.5)*27/h)*60+Math.floor((x+.5)*60/w)]);
    assert.equal(p.at(2,5),0);assert.equal(p.at(3+w,5+h),0);assert.throws(()=>p.at(3.2,5),/mask_point/);assert.equal(JSON.stringify(record),before);
  }
  assert.equal(JSON.stringify(base),original);const identity=projectMask(base,320,334);for(let y=0;y<27;y++)for(let x=0;x<60;x++)assert.equal(identity.at(x+211,y+228),native[y*60+x]);
});
test('non-square crop lifting changes bounds only and source RGBA composition is exact under grid projection',()=>{
  const full=pixels(800,700),view={sourceWidth:800,sourceHeight:700,left:53,top:71,width:400,height:300},crop=cropSourcePixels(full,view),lifted=liftCropMask(scaled,view),original=JSON.stringify(scaled);
  assert.equal(lifted.mask,scaled.mask);assert.deepEqual(lifted.bounds,{left:93,top:131,right:213,bottom:185});
  const a=cutoutPixels(full.rgba,800,700,lifted),b=cutoutPixels(crop.rgba,400,300,scaled);assert.deepEqual(a,b);assert.deepEqual([a.width,a.height],[120,54]);
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){const bit=native[Math.floor(y/2)*60+Math.floor(x/2)],src=((y+131)*800+x+93)*4;assert.deepEqual(a.rgba.slice((y*a.width+x)*4,(y*a.width+x+1)*4),bit?full.rgba.slice(src,src+4):new Uint8ClampedArray(4));}
  assert.equal(JSON.stringify(scaled),original);
});
test('anchor, negative pixel and region support checks use the SAME projected source grid and still reject target exclusions',async()=>{
  const foreground=native.findIndex(v=>v===1),background=native.findIndex(v=>v===0),point=(i:number)=>({x:40+(i%60)*2,y:60+Math.floor(i/60)*2}),positive=point(foreground),negative=point(background),region={left:100,top:200,right:400,bottom:380};
  const text=wire.replace(/x1=.*?;h=334/,'x1=40;y1=60;x2=159;y2=113;w=400;h=300'),response=()=>new Response([{type:'response.output_text.done',item_id:'f',output_index:0,content_index:0,text},{type:'response.completed'}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
  const grounding=(p:{x:number;y:number},n:{x:number;y:number})=>({region,evidence:{visibility:'full' as const,layer:'accessory' as const,color:'white',pattern:'solid',positivePoints:[{x:p.x/400*1000,y:p.y/300*1000}],negativePoints:[{x:n.x/400*1000,y:n.y/300*1000}]},spatial:false,nativePoints:{positive:[p],negative:[n]}});
  let calls=0;const client=new MetaAdapters({approvedLiveMode:true,apiKey:'fixture'},async()=>{calls++;return response();});
  const masks=await client.segment(syntheticPng(400,300),'bag',new AbortController().signal,grounding(positive,negative));assert.equal(masks.length,1);assert.equal(client.segmentationDiagnostics?.positiveAnchorsMatched,1);assert.equal(client.segmentationDiagnostics?.regionSupportPermille,1000);assert.equal(masks[0].mask.width,60);
  const bad=new MetaAdapters({approvedLiveMode:true,apiKey:'fixture'},async()=>response());await assert.rejects(bad.segment(syntheticPng(400,300),'bag',new AbortController().signal,grounding(positive,{x:positive.x+1,y:positive.y})),e=>e instanceof ProviderError&&e.diagnostics?.validation==='grounding_mismatch');assert.equal(calls,1);
});
test('source unions and quality checks count projected source pixels rather than indexing native pixels as source coordinates',()=>{
  const s=pixels(400,300),union=sourceRaster([scaled],400,300),expected=native.reduce((n,v)=>n+v,0)*4,quality=maskQuality(s,[scaled],{kind:'bag',color:'multicolor',region:{left:100,top:200,right:400,bottom:380}});
  assert.equal(union.data.reduce((n,v)=>n+v,0),expected);assert.equal(quality.foreground,expected);assert.deepEqual(sourceRaster([scaled,scaled],400,300),union);
});
test('projection rejects malformed bounds/native dimensions/payloads and never clamps or shifts invalid geometry',()=>{
  for(const change of[{bounds:{...scaled.bounds,left:-1}},{bounds:{...scaled.bounds,right:401}},{bounds:{...scaled.bounds,left:40.5}},{bounds:{...scaled.bounds,right:40}},{mask:{...scaled.mask,width:0}},{mask:{...scaled.mask,height:NaN}},{mask:{...scaled.mask,width:2e6,height:2e6}},{mask:{...scaled.mask,payload:'!invalid'}}])assert.throws(()=>projectMask({...scaled,...change}as GarmentMask,400,300));
  assert.throws(()=>liftCropMask({...scaled,bounds:{...scaled.bounds,right:401}},{sourceWidth:800,sourceHeight:700,left:53,top:71,width:400,height:300}));
});
test('projected and native cumulative budgets stay bounded independently, even when native rasters are small',async()=>{
  const box='x1=0;y1=0;x2=4799;y2=4999;w=4800;h=5000',first=wire.replace(/x1=.*?;h=334/,box),second=first.replace('<0f>0','1'),text=first+','+second;
  let summary:any;await assert.rejects(parseMasks(events(text),4800,5000,s=>summary=s),e=>(e as any).reason==='geometry_bounds');assert.ok(summary.maskGeometry[1].issues.includes('source_pixel_budget'));assert.equal(summary.maskGeometry[1].cumulativeSourcePixels,48e6);
});
test('wire source dimensions must match actual submitted pixels; no coordinate-frame guessing is allowed',async()=>{
  const text=wire.replace('w=320','w=400');let summary:any;
  await assert.rejects(parseMasks(events(text),320,334,s=>summary=s),e=>(e as any).reason==='geometry_bounds');assert.deepEqual(summary.declaredSourceDimensions,[{width:400,height:334,matchesInput:false}]);
});
