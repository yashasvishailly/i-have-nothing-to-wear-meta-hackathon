// Conservative pixel/geometry checks, not a semantic model or reconstruction.
import{projectMask}from'./mask-projection';
import{sourceBox}from'./grounding';import type{Region}from'./discovery';import type{GarmentMask}from'./masks';
export function maskQuality(source:{rgba:Uint8ClampedArray;width:number;height:number},masks:GarmentMask[],piece:{kind:string;color:string;region:Region;visibility?:string}){
 let foreground=0,saturated=0,left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 for(const m of masks){projectMask(m,source.width,source.height).forEach((px,py)=>{const i=(py*source.width+px)*4,r=source.rgba[i],g=source.rgba[i+1],b=source.rgba[i+2],max=Math.max(r,g,b),min=Math.min(r,g,b);foreground++;if(max>60&&max-min>60&&(max-min)/max>.4)saturated++;left=Math.min(left,px);top=Math.min(top,py);right=Math.max(right,px+1);bottom=Math.max(bottom,py+1);});}
 const box=sourceBox(piece.region,source),widthPermille=Math.min(1000,Math.floor(1000*(right-left)/(box.right-box.left))),heightPermille=Math.min(1000,Math.floor(1000*(bottom-top)/(box.bottom-box.top))),saturatedPermille=foreground?Math.floor(1000*saturated/foreground):0;
 // Only an explicitly observed neutral-metal necklace is checked. Multicolor/gem jewellery is not judged by this proxy.
 const reason=piece.kind==='necklace'&&piece.color==='metallic'&&foreground>=64&&saturatedPermille>650?'metallic_necklace_contamination':['shoes','sneakers','trainers','high heels','pumps','heels','boots','sandals'].includes(piece.kind)&&piece.visibility==='full'&&(widthPermille<400||heightPermille<650)?'footwear_fragment':undefined;
 return{reason,foreground,saturatedPermille,widthPermille,heightPermille,partialFootwear:['shoes','sneakers','trainers','high heels','pumps','heels','boots','sandals'].includes(piece.kind)};
}
