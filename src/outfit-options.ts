import type{Item,Profile}from'./core';
export const outfitKey=(p:Profile,ids:string[])=>JSON.stringify([p.occasion,p.style,...ids.slice().sort()]);
// Only garment names provide occasion evidence. Unknown descriptions stay neutral.
function occasionScore(item:Item,p:Profile){const name=item.name.toLowerCase();const has=(r:RegExp)=>r.test(name);if(has(/\b(swimwear|swimsuit|bikini|pyjamas?|pajamas?)\b/))return -100;
 if(p.occasion==='Work')return (has(/\b(blazer|tailored|chinos?|trousers?|loafers?|button.down|oxford)\b/)?3:0)+(has(/\bshirt\b/)&&!has(/t.shirt/)?1:0)-(has(/\b(shorts?|flip.flops?|party|sequin)\b/)?4:0);
 if(p.occasion==='Dinner')return(has(/\b(satin|silk|dress|loafers?|blazer|tailored|party|sequin)\b/)?3:0)-(has(/\b(flip.flops?|sportswear|joggers?)\b/)?3:0);
 return(has(/\b(jeans|denim|t.shirt|sneakers?|trainers?|chinos?|shorts?|sweater|hoodie)\b/)?3:0)-(has(/\b(sequin|evening.gown|tuxedo)\b/)?3:0);
}
export function outfitOptions(pool:Item[],p:Profile,seen:string[]=[]){const by=(c:Item['category'])=>pool.filter(i=>i.category===c).sort((a,b)=>a.id.localeCompare(b.id));const bases=[...by('dress').map(i=>[i]),...by('top').flatMap(t=>by('bottom').map(b=>[t,b]))];const slots:Item[][]=[];if(by('shoes').length)slots.push(by('shoes'));if(p.style!=='Minimal'){if(by('layer').length)slots.push(by('layer'));const roles=new Map<string,Item[]>();for(const i of by('accessory')){const role=i.accessoryRole??'other';roles.set(role,[...(roles.get(role)??[]),i]);}slots.push(...roles.values());}
 let combinations=bases;for(const options of slots){combinations=combinations.flatMap(base=>options.map(i=>[...base,i])).slice(0,400);}combinations=combinations.filter(parts=>!parts.some(i=>occasionScore(i,p)<=-100));
 // Clear name evidence outranks variety. Avoid cycling into less suitable choices.
 const score=(parts:Item[])=>parts.reduce((n,i)=>n+occasionScore(i,p),0)/Math.max(1,parts.length);const best=Math.max(...combinations.map(score));const suitable=combinations.filter(parts=>score(parts)>=Math.max(0,best-3));const candidates=suitable.length?suitable:combinations.filter(parts=>score(parts)>=0);const known=new Set(seen);const unseen=candidates.filter(parts=>!known.has(outfitKey(p,parts.map(i=>i.id))));const available=(unseen.length?unseen:candidates).slice();const picked:Item[][]=[];
 while(available.length&&picked.length<3){let at=0,highest=-Infinity;for(let n=0;n<available.length;n++){const parts=available[n],novelty=picked.length?Math.min(...picked.map(old=>parts.filter(i=>!old.some(x=>x.id===i.id)).length)):0;const mix=new Set(parts.map(i=>i.sourceId)).size;const value=score(parts)*100+novelty*4+mix;if(value>highest){highest=value;at=n;}}picked.push(available.splice(at,1)[0]);}
 return{picked,total:candidates.length,exhausted:unseen.length===0&&candidates.length>0};
}
