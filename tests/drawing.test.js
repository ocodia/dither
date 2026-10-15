import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createLayer, migrateDocument, validateDocument } from '../js/model/document.js';
import { validGradient, pathBounds, validPath, editableStops, addGradientStop, gradientOffset } from '../js/model/vector.js';
import { floodFill } from '../js/rendering/flood-fill.js';
import { strokeSamples, sourcePoint, paintSize } from '../js/rendering/paint.js';
import { localToWorld } from '../js/interaction/geometry.js';
import { AssetStore } from '../js/storage/assets.js';

test('painting grows stretched axes without shrinking source detail',()=>{
  const image={width:64,height:128};
  const layer={transform:{width:256.25,height:32}};
  assert.deepEqual(paintSize(layer,image),{width:257,height:128});
  layer.transform={width:16,height:200};
  assert.deepEqual(paintSize(layer,image),{width:64,height:200});
});

test('paint coordinates account for nonuniform scaling, rotation and flips',()=>{
  const t={x:80,y:60,width:200,height:100,rotation:37,flipX:true,flipY:true};
  const p=sourcePoint(localToWorld({x:30,y:-20},t),t,1000,300);
  assert.ok(Math.abs(p.x-650)<1e-8);assert.ok(Math.abs(p.y-90)<1e-8);
  const samples=strokeSamples({x:0,y:0},{x:100,y:0},20);
  assert.equal(samples.length,50);assert.deepEqual(samples.at(-1),{x:100,y:0});
});
test('fill respects connectivity, tolerance and selection barriers',()=>{
  const pixels=new Uint8ClampedArray([10,10,10,255, 12,12,12,255, 255,255,255,255, 10,10,10,255]);
  floodFill(pixels,4,1,0,0,[200,0,0],1,2);
  assert.deepEqual([...pixels],[200,0,0,255,200,0,0,255,255,255,255,255,10,10,10,255]);
  const mask=new Uint8ClampedArray([0,0,0,255,0,0,0,0,0,0,0,255]);
  const data=new Uint8ClampedArray(12);floodFill(data,3,1,0,0,[0,200,0],1,0,mask);
  assert.equal(data[3],255);assert.equal(data[11],0);
});
test('transparent fill ignores hidden RGB and uses source-over opacity',()=>{
  const data=new Uint8ClampedArray([255,0,10,0, 0,250,0,0]);
  floodFill(data,2,1,0,0,[20,40,60],.5,0);
  assert.deepEqual([...data],[20,40,60,128,20,40,60,128]);
  floodFill(data,2,1,-1,0,[0,0,0],1,255);assert.equal(data[0],20);
});
test('version-one migration preserves shapes, images and erasures without mutating input',()=>{
  const doc=createDocument();doc.version=1;doc.layers.push(createLayer('shape',doc.canvas));
  const loaded=migrateDocument(doc);assert.equal(loaded.version,2);assert.equal(doc.version,1);assert.deepEqual(loaded.layers,doc.layers);
  assert.throws(()=>migrateDocument({...doc,version:99}),/version/);
});
test('paths and gradients validate and bounds include curve handles',()=>{
  const anchors=[{x:0,y:0,in:{x:-.5,y:0},out:{x:.3,y:.7}},{x:1,y:1,in:{x:.7,y:.3},out:{x:1,y:1}}];
  const doc=createDocument(),l=createLayer('shape',doc.canvas);doc.layers.push(l);Object.assign(l.shape,{kind:'path',anchors,closed:true});
  const g={type:'linear',start:{x:0,y:0},end:{x:1,y:0},stops:[{offset:0,colour:'#000000',opacity:1},{offset:1,colour:'#ffffff',opacity:0}]};
  l.shape.gradient=g;assert.equal(validateDocument(doc),doc);assert.equal(pathBounds(anchors).x,-.5);assert.ok(validPath(l.shape));
  assert.ok(!validGradient({...g,end:g.start}));assert.ok(!validGradient({...g,stops:[...g.stops].reverse()}));
  l.shape.closed=false;assert.throws(()=>validateDocument(doc),/gradient/);
});
test('asset collection retains current, undo and redo sources and releases discarded branches',()=>{
  const assets=new AssetStore(),closed=[];
  for(const id of ['current','undo','redo','discarded']){assets.blobs.set(id,{});assets.images.set(id,{close:()=>closed.push(id)});}
  const doc={layers:[{assetId:'current'}],assets:[...assets.blobs.keys()].map(id=>({id}))};
  const history={undoStack:[{assetIds:['undo']}],redoStack:[{assetIds:['redo']}]};
  assets.collect(doc,history);assert.deepEqual(closed,['discarded']);assert.equal(assets.blobs.size,3);
  history.redoStack=[];assets.collect(doc,history);assert.deepEqual(closed,['discarded','redo']);assert.deepEqual(doc.assets.map(a=>a.id),['current','undo']);
});

test('gradient stops retain identities, fixed endpoints and a six-stop editing limit',()=>{
  const source=[{offset:.2,colour:'#ff0000',opacity:0},{offset:.8,colour:'#0000ff',opacity:1}];
  const stops=editableStops(source);
  assert.equal(source.length,2);assert.equal(stops.length,4);
  assert.deepEqual(stops.filter(s=>s.order<2).map(s=>[s.order,s.offset]),[[0,0],[1,1]]);
  const added=addGradientStop(stops);assert.equal(added.offset,.5);assert.equal(added.colour,'#800080');assert.equal(added.opacity,.5);
  added.offset=.9;stops.sort((a,b)=>a.offset-b.offset);
  assert.deepEqual(editableStops(stops),stops);
  assert.ok(addGradientStop(stops));assert.equal(stops.length,6);assert.equal(addGradientStop(stops),null);
  const gradient={type:'linear',start:{x:0,y:0},end:{x:1,y:1},stops};
  assert.ok(validGradient(gradient));
  assert.ok(!validGradient({...gradient,stops:stops.map(s=>({...s,order:0}))}));
  assert.ok(!validGradient({...gradient,stops:stops.map(s=>s.order===1?{...s,offset:.9}:s)}));
  assert.equal(gradientOffset({x:.5,y:.5},gradient,{width:400,height:100}),.5);
  assert.equal(gradientOffset({x:2,y:2},gradient,{width:400,height:100}),1);
  assert.equal(gradientOffset({x:-1,y:-1},gradient,{width:400,height:100}),0);
});
test('legacy gradients gain endpoints without losing stops during migration',()=>{
  const doc=createDocument(),layer=createLayer('shape',doc.canvas);doc.layers.push(layer);
  layer.shape.gradient={type:'radial',start:{x:0,y:0},end:{x:1,y:1},stops:Array.from({length:32},(_,i)=>({offset:(i+1)/34,colour:'#123456',opacity:.5}))};
  const loaded=migrateDocument(doc),stops=loaded.layers[0].shape.gradient.stops;
  assert.equal(stops.length,34);assert.equal(stops[0].offset,0);assert.equal(stops.at(-1).offset,1);
  assert.deepEqual(stops.slice(1,-1).map(({order,...s})=>s),layer.shape.gradient.stops);
  assert.equal(validateDocument(loaded),loaded);
});
