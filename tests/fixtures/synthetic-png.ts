// Generated pixels only; no personal/source photo bytes are included in tests.
import{deflateSync}from'node:zlib';import{crc32}from'../../src/server/png';
export function syntheticPng(w=320,h=334,margin=0){const chunk=(type:string,data:Buffer)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,b.length-4)),b.length-4);return b;};const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;const rows=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++)rows.set([20,80,140,x>=margin&&x<w-margin&&y>=margin&&y<h-margin?255:0],y*(w*4+1)+1+x*4);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}

// A deliberately simple foreground with intact transparent margins, not an accuracy fixture.
export const intactPreviewPng=()=>syntheticPng(1024,1024,64);
