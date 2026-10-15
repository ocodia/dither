import test from 'node:test';
import assert from 'node:assert/strict';
import { floydSteinberg } from '../js/rendering/dither.js';
import { processPixels } from '../js/rendering/pixels.js';
test('dither is deterministic, binary and preserves alpha', () => {
  const input = new Uint8ClampedArray([100,100,100,255, 100,100,100,128, 200,200,200,0, 180,180,180,255]);
  const a = floydSteinberg(input.slice(),2,2), b = floydSteinberg(input.slice(),2,2); assert.deepEqual(a,b);
  for (const i of [0,4,12]) assert.ok(a[i] === 0 || a[i] === 255);
  for (const i of [3,7,11,15]) assert.equal(a[i],input[i]); assert.deepEqual(a.slice(8,12),input.slice(8,12));
  assert.deepEqual(floydSteinberg(input.slice(),2,2,0),input);
});
test('neutral brightness and contrast leave colour and alpha unchanged', () => {
  const a = new Uint8ClampedArray([40,100,200,123]);
  for(const type of ['brightness','contrast']) assert.deepEqual(processPixels(a.slice(),1,1,{type,amount:0}),a);
});
test('outside stroke expands the alpha contour without recolouring the opaque source', () => {
  const data = new Uint8ClampedArray(5*5*4); data.set([255,0,0,255],(2*5+2)*4);
  const out = processPixels(data,5,5,{type:'stroke',width:1,colour:'#00ff00',opacity:1});
  assert.deepEqual([...out.slice(48,52)],[255,0,0,255]);
  assert.deepEqual([...out.slice(24,28)],[0,255,0,255]); assert.equal(out[3],0);
  assert.equal([...out].filter((v,i)=>i%4===3&&v>0).length,9);
});
test('blur spreads alpha symmetrically without transparent colour halos', () => {
  const size=41, data=new Uint8ClampedArray(size*size*4);
  // Invisible green must not tint the partially transparent red square.
  for(let p=0;p<size*size;p++)data[p*4+1]=255;
  for(let y=17;y<24;y++)for(let x=17;x<24;x++)data.set([255,0,0,128],(y*size+x)*4);
  const original=data.slice(), out=processPixels(data,size,size,{type:'blur',radius:3});
  assert.deepEqual(data,original,'input is immutable');
  const alpha=(x,y)=>out[(y*size+x)*4+3];
  assert.ok(alpha(20,20)>0&&alpha(20,20)<128);
  assert.ok(alpha(25,20)>0);assert.equal(alpha(0,0),0);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    assert.equal(alpha(x,y),alpha(size-1-x,y));
    assert.equal(alpha(x,y),alpha(y,x));
    if(alpha(x,y))assert.deepEqual([...out.slice((y*size+x)*4,(y*size+x)*4+3)],[255,0,0]);
  }
  assert.deepEqual(processPixels(original.slice(),size,size,{type:'blur',radius:0}),original);
});
test('blur treats samples outside the bitmap as transparent', () => {
  const data=new Uint8ClampedArray(9*9*4).fill(255);
  const out=processPixels(data,9,9,{type:'blur',radius:2});
  assert.ok(out[3]>0&&out[3]<out[(4*9+4)*4+3]);
  const tiny=processPixels(new Uint8ClampedArray([255,0,0,255]),1,1,{type:'blur',radius:40});
  assert.deepEqual([...tiny],[0,0,0,0]);
});
