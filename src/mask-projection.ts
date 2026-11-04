import { decodeMaskToRaster } from '@meta-sam/parser';
import type { GarmentMask } from './masks';
import { maskGeometry } from './server/mask-geometry';
export const maskProjectionProtocol='native-raster-to-source-box-v1';
// The SDK's half-open source box is the placement/extent. The mask is its own
// native binary grid. Sample at source-pixel centres with nearest-cell ownership;
// do not resize raw payloads, shift bounds, invent alpha values or clamp errors.
export function projectMask(record:GarmentMask,sourceWidth:number,sourceHeight:number){
  const b=record.bounds,m=record.mask,geometry=maskGeometry(0,sourceWidth,sourceHeight,b,m,m.width*m.height);
  if(geometry.issues.length)throw Error('mask_geometry');
  const raster=decodeMaskToRaster(m);
  if(raster.length!==m.width*m.height||!raster.every(v=>v===0||v===1))throw Error('mask_raster');
  const width=b.right-b.left,height=b.bottom-b.top;
  const at=(x:number,y:number)=>{
    if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y))throw Error('mask_point');
    if(x<b.left||x>=b.right||y<b.top||y>=b.bottom)return 0;
    const nx=Math.floor((x-b.left+.5)*m.width/width),ny=Math.floor((y-b.top+.5)*m.height/height);
    return raster[ny*m.width+nx];
  };
  const forEach=(visit:(x:number,y:number)=>void)=>{for(let y=b.top;y<b.bottom;y++)for(let x=b.left;x<b.right;x++)if(at(x,y))visit(x,y);};
  return{width,height,raster,at,forEach,protocol:maskProjectionProtocol};
}
