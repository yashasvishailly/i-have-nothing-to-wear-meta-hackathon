// Deterministic raster checks, not an identity, material, colour or completeness verifier.
export const finishedImageIssues=['output_empty','output_opaque','output_clipped','output_margin','output_invalid_pixels','output_provenance_too_large'] as const;
export type FinishedImageIssue='output_empty'|'output_opaque'|'output_clipped'|'output_margin';
export interface PreviewFraming{method:'transparent-padding-v1';originalSha256:string;normalizedSha256:string;}
// Edge-contact policy: >=32/255 at any edge pixel OR >=2 opaque-equivalent
// pixels of total edge alpha is substantial. Lower contact is ambiguous, never verified.
export const edgeContactPolicy={peakAlpha:32,alphaMass:2} as const;
export type PreviewPixels={width:number;height:number;rgba:Uint8ClampedArray};
export function finishedImageQuality(p:PreviewPixels){
 const{width,height,rgba}=p;if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||rgba.length!==width*height*4)throw Error('pixels');
 let left=width,top=height,right=-1,bottom=-1,transparent=0,foreground=0,edgePeak=0,edgeAlpha=0,edgePixels=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=rgba[(y*width+x)*4+3];if(x===0||y===0||x===width-1||y===height-1){edgePeak=Math.max(edgePeak,a);edgeAlpha+=a;if(a)edgePixels++;}if(a===0)transparent++;if(a>=16)foreground++;if(a>0){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
 const bounds=right>=0?{left,top,right:right+1,bottom:bottom+1}:undefined;
 let issue:FinishedImageIssue|undefined;const edge={peakAlpha:edgePeak,alphaMass:edgeAlpha/255,nonzeroPixels:edgePixels},warning=edgePixels&&edgePeak<edgeContactPolicy.peakAlpha&&edgeAlpha/255<edgeContactPolicy.alphaMass?'faint_edge_fringe' as const:undefined;
 if(foreground<16)issue='output_empty';else if(!transparent)issue='output_opaque';else if(edgePixels&&!warning)issue='output_clipped';else if(!warning&&(Math.min(left,top,width-1-right,height-1-bottom)<Math.max(2,Math.ceil(Math.min(width,height)*.02))))issue='output_margin';
 return{issue,bounds,foregroundPixels:foreground,warning,edge};
}
export function normalizeFinishedPixels(p:PreviewPixels){
 const assessment=finishedImageQuality(p);
 if(assessment.issue&&assessment.issue!=='output_margin'||!assessment.issue&&!assessment.warning)return{pixels:p,assessment,reframed:false,warning:assessment.warning};
 // Preserve every nonzero alpha pixel, including ambiguous faint edge fringe.
 // Padding does not resolve that uncertainty; its warning must survive for user review.
 // Copy at 1:1 onto a larger canvas: no interpolation, cropping of visible pixels or inference.
 const b=assessment.bounds!,width=p.width+2*Math.ceil(p.width/16),height=p.height+2*Math.ceil(p.height/16),rgba=new Uint8ClampedArray(width*height*4),left=Math.floor((width-(b.right-b.left))/2),top=Math.floor((height-(b.bottom-b.top))/2);
 for(let y=b.top;y<b.bottom;y++){const from=(y*p.width+b.left)*4;rgba.set(p.rgba.subarray(from,from+(b.right-b.left)*4),((top+y-b.top)*width+left)*4);}
 const pixels={width,height,rgba},result=finishedImageQuality(pixels);
 if(result.issue)throw Error('padding_failed');
 return{pixels,assessment:result,reframed:true,warning:assessment.warning};
}
