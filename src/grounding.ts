// Image-grounded evidence from vision, not user-entered category names or inferred box centres.
export interface Point{x:number;y:number;}
export interface Grounding{visibility:'full'|'occluded'|'small'|'ambiguous';layer:'single'|'inner'|'outer'|'accessory'|'unknown';color:string;pattern:string;positivePoints:Point[];negativePoints:Point[];}
export const groundingProtocol='single-visible-anchor-v3';
export const colors=['black','white','gray','beige','brown','red','orange','yellow','green','blue','purple','pink','metallic','multicolor','unknown'];
export const patterns=['solid','striped','checked','floral','printed','unknown'];
const pointSchema={type:'object',additionalProperties:false,properties:{x:{type:'integer',minimum:0,maximum:1000},y:{type:'integer',minimum:0,maximum:1000}},required:['x','y']};
export const groundingSchema={type:'object',additionalProperties:false,properties:{visibility:{type:'string',enum:['full','occluded','small','ambiguous']},layer:{type:'string',enum:['single','inner','outer','accessory','unknown']},color:{type:'string',enum:colors},pattern:{type:'string',enum:patterns},positivePoints:{type:'array',maxItems:1,items:pointSchema},negativePoints:{type:'array',maxItems:2,items:pointSchema}},required:['visibility','layer','color','pattern','positivePoints','negativePoints']};
function checkGrounding(v:any,region:{left:number;top:number;right:number;bottom:number},fractional=false):Grounding{
 if(!v||Object.keys(v).sort().join(',')!=='color,layer,negativePoints,pattern,positivePoints,visibility'||!['full','occluded','small','ambiguous'].includes(v.visibility)||!['single','inner','outer','accessory','unknown'].includes(v.layer)||!colors.includes(v.color)||!patterns.includes(v.pattern))throw Error('grounding');
 const valid=(p:any)=>p&&Object.keys(p).sort().join(',')==='x,y'&&[p.x,p.y].every(n=>(fractional?Number.isFinite(n):Number.isInteger(n))&&n>=0&&n<=1000);
 for(const list of[v.positivePoints,v.negativePoints])if(!Array.isArray(list)||list.length>2||!list.every(valid)||new Set(list.map(p=>p.x+','+p.y)).size!==list.length)throw Error('grounding');
 if(v.positivePoints.some((p:Point)=>p.x<region.left||p.x>=region.right||p.y<region.top||p.y>=region.bottom)||v.positivePoints.some((p:Point)=>v.negativePoints.some((q:Point)=>p.x===q.x&&p.y===q.y)))throw Error('grounding');
 return{visibility:v.visibility,layer:v.layer,color:v.color,pattern:v.pattern,positivePoints:v.positivePoints.map((p:Point)=>({...p})),negativePoints:v.negativePoints.map((p:Point)=>({...p}))};
}

// Same source-pixel conversion is used for prompting, validation and tests. Right/bottom are half-open.
export function sourcePoint(p:Point,size:{width:number;height:number}){if(![size.width,size.height].every(n=>Number.isInteger(n)&&n>0)||!Number.isInteger(p.x)||!Number.isInteger(p.y)||p.x<0||p.x>1000||p.y<0||p.y>1000)throw Error('coordinate');return{x:Math.min(size.width-1,Math.floor(p.x/1000*size.width)),y:Math.min(size.height-1,Math.floor(p.y/1000*size.height))};}
export function sourceBox(r:{left:number;top:number;right:number;bottom:number},size:{width:number;height:number}){const start=sourcePoint({x:r.left,y:r.top},size);if(r.right<=r.left||r.bottom<=r.top||r.right>1000||r.bottom>1000)throw Error('coordinate');return{left:start.x,top:start.y,right:Math.min(size.width,Math.ceil(r.right/1000*size.width)),bottom:Math.min(size.height,Math.ceil(r.bottom/1000*size.height))};}
export function resolvedRegion(r:{left:number;top:number;right:number;bottom:number},size:{width:number;height:number}){const b=sourceBox(r,size);return b.right-b.left>=8&&b.bottom-b.top>=8;}

export const validateGrounding=(v:any,region:{left:number;top:number;right:number;bottom:number})=>checkGrounding(v,region);
// Only source-bound crop refinements may use precise fractional normalized metadata; discovery remains integer-schema strict.
export const validateRefinedGrounding=(v:any,region:{left:number;top:number;right:number;bottom:number})=>checkGrounding(v,region,true);
