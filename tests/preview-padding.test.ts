import{test}from'node:test';import assert from'node:assert/strict';import{finishedImageQuality,normalizeFinishedPixels}from'../src/finished-image-quality';
function fixture(width:number,height:number,rects:{left:number;top:number;right:number;bottom:number;color:number[];}[]){const rgba=new Uint8ClampedArray(width*height*4);for(const r of rects)for(let y=r.top;y<r.bottom;y++)for(let x=r.left;x<r.right;x++)rgba.set(r.color,(y*width+x)*4);return{width,height,rgba};}
const rect=(left:number,top:number,right:number,bottom:number,color=[30,90,140,255])=>({left,top,right,bottom,color});
function componentPixels(p:ReturnType<typeof fixture>){const out:number[][]=[];for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++){const k=(y*p.width+x)*4;if(p.rgba[k+3]>0)out.push([x,y,...p.rgba.slice(k,k+4)]);}return out;}
for(const[name,input]of[
 ['tight margins',fixture(100,100,[rect(1,1,99,99)])],
 ['offset',fixture(100,100,[rect(1,20,30,70)])],
 ['elongated',fixture(100,300,[rect(45,1,55,299)])],
 ['disconnected and translucent',fixture(100,100,[rect(1,10,30,70),rect(95,20,99,50,[170,20,30,120]),rect(80,80,81,81,[10,240,20,1])])]
]as const){test('padding preserves every nonzero pixel, component, alpha and aspect ratio: '+name,()=>{
 const before=input.rgba.slice(),source=componentPixels(input),result=normalizeFinishedPixels(input);assert.equal(result.reframed,true);assert.equal(result.assessment.issue,undefined);assert.equal(finishedImageQuality(result.pixels).issue,undefined);assert.deepEqual(input.rgba,before);const after=componentPixels(result.pixels);assert.equal(after.length,source.length);const dx=after[0][0]-source[0][0],dy=after[0][1]-source[0][1];for(let i=0;i<source.length;i++)assert.deepEqual(after[i],[source[i][0]+dx,source[i][1]+dy,...source[i].slice(2)]);const old=finishedImageQuality(input).bounds!,b=result.assessment.bounds!;assert.equal(b.right-b.left,old.right-old.left);assert.equal(b.bottom-b.top,old.bottom-old.top);assert.ok(Math.abs((result.pixels.width-(b.right-b.left))/2-b.left)<=1);assert.ok(Math.abs((result.pixels.height-(b.bottom-b.top))/2-b.top)<=1);
 });}
test('transparent-padding never repairs substantial clipping, opaque or empty outputs',()=>{
 for(const[p,reason]of[[fixture(100,100,[]),'output_empty'],[fixture(100,100,[rect(0,0,100,100)]),'output_opaque'],[fixture(100,100,[rect(0,10,50,90)]),'output_clipped']]as const){const r=normalizeFinishedPixels(p);assert.equal(r.reframed,false);assert.equal(r.assessment.issue,reason);assert.equal(r.pixels,p);}
});
test('well-framed output is unchanged and padding policy is idempotent',()=>{const p=fixture(100,100,[rect(20,20,80,80)]);assert.equal(normalizeFinishedPixels(p).pixels,p);const padded=normalizeFinishedPixels(fixture(100,100,[rect(1,1,99,99)])).pixels;const again=normalizeFinishedPixels(padded);assert.equal(again.reframed,false);assert.equal(again.pixels,padded);});

test('low-mass faint edge fringe is preserved and padded with mandatory uncertainty, not labelled intact',()=>{
 const p=fixture(100,100,[rect(10,10,50,90),rect(0,1,1,2,[10,20,30,1])]);const before=p.rgba.slice(),r=normalizeFinishedPixels(p);assert.equal(r.assessment.issue,undefined);assert.equal(r.warning,'faint_edge_fringe');assert.equal(r.reframed,true);assert.deepEqual(p.rgba,before);const a=componentPixels(p),b=componentPixels(r.pixels);assert.equal(a.length,b.length);const dx=b[0][0]-a[0][0],dy=b[0][1]-a[0][1];for(let i=0;i<a.length;i++)assert.deepEqual(b[i],[a[i][0]+dx,a[i][1]+dy,...a[i].slice(2)]);
});
test('meaningful translucent edge content is rejected by opacity or aggregate mass, even below the peak threshold',()=>{
 const peak=fixture(100,100,[rect(10,10,50,90),rect(0,1,1,2,[10,20,30,32])]);assert.equal(normalizeFinishedPixels(peak).assessment.issue,'output_clipped');const mass=fixture(100,100,[rect(10,10,50,90),rect(0,1,1,80,[10,20,30,8])]);assert.equal(finishedImageQuality(mass).edge.peakAlpha,8);assert.ok(finishedImageQuality(mass).edge.alphaMass>=2);assert.equal(normalizeFinishedPixels(mass).assessment.issue,'output_clipped');
 const opaque=fixture(100,100,[rect(0,0,100,100,[10,20,30,1]),rect(10,10,50,90)]);assert.equal(normalizeFinishedPixels(opaque).assessment.issue,'output_opaque');assert.equal(normalizeFinishedPixels(opaque).reframed,false);
});

test('reload makes finished fringe previews usable without erasing warnings or claiming human acceptance',async()=>{
 const {initial,eligible}=await import('../src/core'),{finishStoredResults}=await import('../src/prepared-results');const s=initial();s.items.push({id:'fringe',sourceId:'s',name:'Shirt',category:'top',image:'fixture',partial:true,available:true,heels:null,sleeveless:null,confirmed:false,reviewNeeded:true,useReconstruction:false,demo:false,extraction:'model-source-crop',reconstruction:{image:'fixture',originalImage:'original',qualityWarning:'faint_edge_fringe',provider:'OpenAI',model:'fixture',notice:'fixture',sourceSha256:'a'.repeat(64),cutoutSha256:'b'.repeat(64),confirmed:false}});finishStoredResults(s);assert.equal(s.items[0].reconstruction?.confirmed,true);assert.equal(s.items[0].useReconstruction,true);assert.equal(eligible(s.items,s.profile).length,1);assert.equal(s.items[0].reconstruction?.reviewedByUser,undefined);s.items[0].confirmed=true;s.items[0].reviewNeeded=false;s.items[0].useReconstruction=true;s.items[0].reconstruction!.confirmed=true;s.items[0].reconstruction!.reviewedByUser=true;finishStoredResults(s);assert.equal(eligible(s.items,s.profile).length,1);assert.equal(s.items[0].reconstruction?.originalImage,'original');
});
