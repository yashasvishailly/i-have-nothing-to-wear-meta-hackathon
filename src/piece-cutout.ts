// Shared deterministic source-pixel composition for browser rendering and server verification.
import{overlap,type DiscoveredPiece}from'./discovery';import{cutoutPixels,type GarmentMask}from'./masks';
export function piecePixels(source:Uint8ClampedArray,width:number,height:number,piece:DiscoveredPiece,masks:GarmentMask[]){
 if(!Array.isArray(masks)||masks.length<1||masks.length>20)throw Error('mask');const region=(m:GarmentMask)=>({left:m.bounds.left/width*1000,top:m.bounds.top/height*1000,right:m.bounds.right/width*1000,bottom:m.bounds.bottom/height*1000});const relevant=masks.filter(m=>overlap(region(m),piece.region)>.05);if(!relevant.length)throw Error('empty_mask');
 const selected=piece.category==='shoes'||piece.kind==='earrings'?relevant:relevant.sort((a,b)=>overlap(region(b),piece.region)-overlap(region(a),piece.region)).slice(0,1);
 const left=Math.min(...selected.map(m=>m.bounds.left)),top=Math.min(...selected.map(m=>m.bounds.top)),right=Math.max(...selected.map(m=>m.bounds.right)),bottom=Math.max(...selected.map(m=>m.bounds.bottom)),w=right-left,h=bottom-top;if(w<=0||h<=0||w*h>24e6)throw Error('bounds');const raw=new Uint8ClampedArray(w*h*4);
 for(const mask of selected){const part=cutoutPixels(source,width,height,mask);for(let y=0;y<part.height;y++)for(let x=0;x<part.width;x++){const from=(y*part.width+x)*4;if(part.rgba[from+3])raw.set(part.rgba.subarray(from,from+4),((y+mask.bounds.top-top)*w+x+mask.bounds.left-left)*4);}}
 if(!raw.some((n,i)=>i%4===3&&n))throw Error('empty_mask');const scale=Math.min(1,1024/Math.max(w,h)),outW=Math.max(32,Math.round(w*scale)),outH=Math.max(32,Math.round(h*scale)),rgba=new Uint8ClampedArray(outW*outH*4);
 for(let y=0;y<Math.round(h*scale);y++)for(let x=0;x<Math.round(w*scale);x++){const sx=Math.min(w-1,Math.floor((x+.5)/scale)),sy=Math.min(h-1,Math.floor((y+.5)/scale)),from=(sy*w+sx)*4;rgba.set(raw.subarray(from,from+4),(y*outW+x)*4);}return{rgba,width:outW,height:outH};
}
