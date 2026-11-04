import{sourceBox,type Point}from'./grounding';
import type{Region}from'./discovery';
// Conservative geometric uncertainty check, not a semantic recognizer. A small
// proposal may move by 16 native pixels; larger proposals allow 40% of their axis.
// This tolerates a thin-chain correction but rejects the observed forehead drift.
export function refinementConsistent(region:Region,positive:Point,size:{width:number;height:number}){
 const b=sourceBox(region,size),padX=Math.max(16,(b.right-b.left)*.4),padY=Math.max(16,(b.bottom-b.top)*.4);
 if(![positive.x,positive.y].every(Number.isSafeInteger)||positive.x<0||positive.y<0||positive.x>=size.width||positive.y>=size.height)return false;
 return positive.x>=b.left-padX&&positive.x<b.right+padX&&positive.y>=b.top-padY&&positive.y<b.bottom+padY;
}
