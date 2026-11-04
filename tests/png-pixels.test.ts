import{test}from'node:test';
import assert from'node:assert/strict';
import{deflateSync}from'node:zlib';
import{crc32}from'../src/server/png';
import{pngPixels,samePixels}from'../src/server/png-pixels';

function chunk(type:string,data:Buffer){const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,out.length-4)),out.length-4);return out;}
function png(width:number,height:number){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const rows=Buffer.alloc((width*4+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)rows.set([20,80,140,255],y*(width*4+1)+1+x*4);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

test('expected crop dimensions reject either mismatched side before any decompression',async t=>{
 const bytes=png(32,32),Original=globalThis.DecompressionStream;let decompressions=0;
 t.mock.method(globalThis,'DecompressionStream',function(format:CompressionFormat){decompressions++;return new Original(format);});
 for(const expected of[{width:64,height:32},{width:32,height:64}]){
  await assert.rejects(pngPixels(bytes,expected),/png_dimensions/);
 }
 assert.equal(decompressions,0);
});

test('matching crop dimensions retain PNG validation and exact pixel decoding',async()=>{
 const bytes=png(32,32),decoded=await pngPixels(bytes,{width:32,height:32});
 assert.equal(decoded.width,32);assert.equal(decoded.height,32);
 assert.equal(decoded.rgba.length,32*32*4);assert.deepEqual([...decoded.rgba.slice(0,4)],[20,80,140,255]);
 assert.equal(samePixels(decoded,await pngPixels(bytes)),true);
 const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;
 await assert.rejects(pngPixels(corrupt,{width:32,height:32}));
});
