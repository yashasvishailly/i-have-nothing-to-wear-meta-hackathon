import{test}from'node:test';import assert from'node:assert/strict';import{processingCropBox}from'../src/processing-crop';
test('processing crop uses exact bounded native pixels, not visual display coordinates',()=>{assert.deepEqual(processingCropBox({width:1000,height:1600},{x:.1,y:.2,w:.8,h:.6}),{left:100,top:320,width:800,height:960});});
test('tiny, invalid or out-of-bounds processing crops fail locally without upscaling',()=>{for(const rect of[{x:0,y:0,w:.1,h:.1},{x:.9,y:0,w:.5,h:.9},{x:NaN,y:0,w:1,h:1}])assert.throws(()=>processingCropBox({width:1000,height:1600},rect));});
