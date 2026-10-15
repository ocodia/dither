import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.DITHER_PLAYWRIGHT_PATH?pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href:'playwright');
const browser=await chromium.launch({channel:process.env.DITHER_BROWSER||'msedge',headless:true});
const page=await browser.newPage();
try{
  await page.goto(process.env.DITHER_URL||'http://127.0.0.1:4173/');
  await page.locator('#new-dialog [data-close]').click();
  await page.locator('[data-action=rectangle]').click();
  const ready=()=>page.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');await ready();
  const before=await page.locator('[data-handle="1,1"]').boundingBox();
  for(let i=0;i<8;i++)await page.locator('[data-action=zoom-in]').click();await ready();
  const after=await page.locator('[data-handle="1,1"]').boundingBox();
  // Playwright's SVG bounds include the one-pixel outline around the 7px handle.
  assert.ok(Math.abs(before.width-8)<.1&&Math.abs(after.width-8)<.1,`handles keep their screen size: ${before.width}, ${after.width}`);
  assert.equal(await page.locator('#overlay').evaluate(el=>el.parentElement.id),'workspace');
  const aligned=await page.locator('[data-handle="1,1"]').evaluate(handle=>{
    const matrix=new DOMMatrix(getComputedStyle(document.querySelector('#stage')).transform),svg=handle.ownerSVGElement.getBoundingClientRect(),area=document.querySelector('#workspace').getBoundingClientRect();
    const box=handle.getBoundingClientRect(),group=handle.parentElement.transform.baseVal.consolidate().matrix;
    const corner=new DOMPoint(Number(handle.getAttribute('x'))+3.5/matrix.a,Number(handle.getAttribute('y'))+3.5/matrix.a).matrixTransform(group);
    return Math.abs(box.x+box.width/2-area.x-matrix.e-corner.x*matrix.a)<.1&&Math.abs(box.y+box.height/2-area.y-matrix.f-corner.y*matrix.a)<.1&&svg.width>0;
  });assert.ok(aligned,'handles align with layer after zoom');
  await page.locator('[data-action=fit]').click();await ready();
  console.log('PASS native zoom keeps controls at eight screen pixels including outlines, aligned with artwork');
  const resolution=await page.evaluate(async()=>{
    const {ToolController}=await import('./js/interaction/tools.js');
    const {createDocument,createLayer,clone}=await import('./js/model/document.js');
    const {AssetStore}=await import('./js/storage/assets.js');
    const {DocumentRenderer}=await import('./js/rendering/renderer.js');
    const {surface}=await import('./js/rendering/effects.js');
    const {pngBlob}=await import('./js/rendering/paint.js');
    const {History,patchCommand}=await import('./js/history/history.js');
    const {localToWorld}=await import('./js/interaction/geometry.js');
    const results=[];
    for(const tool of ['brush','eraser'])for(const hardness of [1,.5]){
      const doc=createDocument({width:256,height:256}),assets=new AssetStore(),source=surface(16,16);
      if(tool==='eraser'){const ctx=source.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,16,16);}
      const meta=await assets.add(await pngBlob(source));doc.assets=[meta];
      const layer=createLayer('image',doc.canvas,{assetId:meta.id});
      Object.assign(layer.transform,{width:256,height:64,rotation:37,flipX:true,flipY:true});doc.layers=[layer];
      const transform=clone(layer.transform),history=new History(),errors=[];
      const workspace={element:document.createElement('div'),tool,view:{zoom:1},draw(){},point:e=>e.world};
      const controller=new ToolController(workspace,{controls:document.createElement('div'),renderer:new DocumentRenderer(),selection:{current:()=>null},getLayer:()=>layer,getDocument:()=>doc,getAssets:()=>assets,preview(){},notify:m=>errors.push(m),patch:(l,changes,label)=>{const before={};for(const key of Object.keys(changes))before[key]=clone(l[key]);history.execute(patchCommand(l,before,changes,label));}});
      controller.capture=()=>{};
      Object.assign(controller.settings,{size:24,hardness,foreground:'#ffffff'});
      controller.down({world:{x:layer.transform.x,y:layer.transform.y}});
      const g=controller.gesture;
      const sized=g.base.width===256&&g.base.height===64;
      // Edges of a new dab have a one-pixel antialias transition, rather
      // than an enlarged source pixel. Soft dabs have a smooth six-pixel ramp.
      const pixels=g.output.getContext('2d').getImageData(0,hardness===1?25:32,256,1).data;
      let partial=0;for(let x=0;x<256;x++)if(pixels[x*4+3]>0&&pixels[x*4+3]<255)partial++;
      const detail=hardness===1?partial>0&&partial<=4:partial>=8&&partial<=16;
      controller.gesture=null;await controller.commitPaint(g,g.output);
      const committed=assets.images.get(layer.assetId).width===256&&assets.images.get(layer.assetId).height===64&&JSON.stringify(layer.transform)===JSON.stringify(transform);
      const painted=layer.assetId;history.undo();const undo=layer.assetId===meta.id;history.redo();const redo=layer.assetId===painted;
      // Repeating after a committed stroke reuses the expanded resolution.
      controller.down({world:{x:layer.transform.x+10,y:layer.transform.y}});
      const reused=controller.gesture.base.width===256&&controller.gesture.base.height===64;
      controller.cancel();
      const event=(x,y)=>({world:localToWorld({x:x-128,y:y-32},layer.transform)});
      const finish=async e=>{controller.up(e);while(controller.busy)await new Promise(resolve=>setTimeout(resolve,1));};
      const count=history.undoStack.length,previous=layer.assetId;
      controller.down(event(-40,10));await finish(event(-30,10));
      const outsideNoOp=history.undoStack.length===count&&layer.assetId===previous;
      // A dab whose centre is outside can still overlap the bitmap edge.
      controller.down(event(-3,10));
      const alpha=(x,y)=>controller.gesture.output.getContext('2d').getImageData(x,y,1,1).data[3];
      const edgeOverlap=tool==='brush'?alpha(0,10)>128:alpha(0,10)<128;
      controller.cancel();
      const cancelled=layer.assetId===previous&&history.undoStack.length===count;
      controller.down(event(-30,10));controller.move(event(35,10));
      controller.move(event(280,10));controller.move(event(220,10));
      const enters=tool==='brush'?alpha(2,10)===255:alpha(2,10)===0;
      const reenters=tool==='brush'?alpha(240,10)===255:alpha(240,10)===0;
      await finish(event(220,10));
      const oneStroke=history.undoStack.length===count+1;
      history.undo();const boundaryUndo=layer.assetId===previous;
      history.redo();
      // Fill outside the image remains a no-op.
      workspace.tool='fill';controller.down(event(-30,10));const fillOutside=!controller.gesture;
      controller.cancel();assets.dispose();results.push({tool,hardness,partial,sized,detail,committed,undo,redo,reused,outsideNoOp,edgeOverlap,cancelled,enters,reenters,oneStroke,boundaryUndo,fillOutside,errors});
    }
    return results;
  });
  for(const result of resolution){assert.deepEqual(result.errors,[]);for(const key of ['sized','detail','committed','undo','redo','reused','outsideNoOp','edgeOverlap','cancelled','enters','reenters','oneStroke','boundaryUndo','fillOutside'])assert.equal(result[key],true,`${key}: ${JSON.stringify(result)}`);}
  console.log('PASS brush and eraser expand stretched bitmaps, preserve edge detail, commit and undo/redo');
  console.log('PASS outside-start strokes enter and reenter rotated/flipped layers, edge overlap, cancellation and outside-only no-ops');
  const result=await page.evaluate(async()=>{
    const {ToolController}=await import('./js/interaction/tools.js');
    const {createDocument,createLayer,clone}=await import('./js/model/document.js');
    const {AssetStore}=await import('./js/storage/assets.js');
    const {DocumentRenderer}=await import('./js/rendering/renderer.js');
    const {surface}=await import('./js/rendering/effects.js');
    const {paintSurface,selectionMask,stamp,brushScale,composeStroke,pngBlob}=await import('./js/rendering/paint.js');
    const {History,patchCommand}=await import('./js/history/history.js');
    let doc=createDocument({width:64,height:64});const assets=new AssetStore(),base=surface(64,64);
    base.getContext('2d').fillStyle='#ff0000';base.getContext('2d').fillRect(0,0,64,64);
    const meta=await assets.add(await pngBlob(base));doc.assets.push(meta);
    let layer=createLayer('image',doc.canvas,{assetId:meta.id});Object.assign(layer.transform,{width:64,height:64});doc.layers.push(layer);
    const duplicate=clone(layer);duplicate.id+='copy';doc.layers.push(duplicate);
    const original=meta.id,history=new History(),errors=[];
    const area=document.createElement('div'),controls=document.createElement('div');
    const workspace={element:area,tool:'brush',draw(){},view:{zoom:1},getDocument:()=>doc};
    const renderer=new DocumentRenderer();
    const controller=new ToolController(workspace,{controls,renderer,selection:{current:()=>null},getLayer:()=>layer,getDocument:()=>doc,getAssets:()=>assets,preview(){},notify:m=>errors.push(m),patch:(l,changes,label)=>{const before={};for(const k of Object.keys(changes))before[k]=clone(l[k]);history.execute(patchCommand(l,before,changes,label));}});
    const g=()=>({type:'brush',layer,snapshot:clone(layer),document:doc,assets,base:paintSurface(layer,assets.images.get(layer.assetId))});
    const blue=surface(64,64);blue.getContext('2d').fillStyle='#0000ff';blue.getContext('2d').fillRect(0,0,64,64);
    await controller.commitPaint(g(),blue);const painted=layer.assetId;
    const independent=painted!==original&&duplicate.assetId===original&&assets.images.has(original);
    history.undo();const undo=layer.assetId===original;history.redo();const redo=layer.assetId===painted;
    const count=history.undoStack.length;await controller.commitPaint(g(),blue);const noOp=history.undoStack.length===count;
    const failed=surface(64,64);failed.toBlob=cb=>cb(null);await controller.commitPaint(g(),failed);
    const failedAtomic=layer.assetId===painted&&history.undoStack.length===count&&errors.some(e=>e.includes('encode'));
    const delayed=surface(64,64),encode=delayed.toBlob.bind(delayed);let release;
    delayed.toBlob=cb=>encode(blob=>{release=()=>cb(blob);});const pending=controller.commitPaint(g(),delayed);
    while(!release)await new Promise(r=>setTimeout(r,1));const old=doc;doc=createDocument();release();await pending;doc=old;
    const staleAtomic=layer.assetId===painted&&history.undoStack.length===count;
    const ink=surface(64,64);stamp(ink.getContext('2d'),{x:32,y:32},40,.5,'#ffffff');
    const mask=selectionMask([{x:0,y:0},{x:.5,y:0},{x:.5,y:1},{x:0,y:1}],64,64);
    const erased=composeStroke(base,ink,mask,.5,true),pixels=erased.getContext('2d').getImageData(0,0,64,64).data;
    const eraseAlpha=pixels[(32*64+30)*4+3],outsideAlpha=pixels[(32*64+40)*4+3],softAlpha=pixels[(32*64+14)*4+3];
    layer.eraseRegions=[[{x:0,y:0},{x:.5,y:0},{x:.5,y:1},{x:0,y:1}]];
    const erasedBase=paintSurface(layer,assets.images.get(layer.assetId));const priorErase=erasedBase.getContext('2d').getImageData(10,10,1,1).data[3];await controller.commitPaint(g(),blue);const baked=layer.eraseRegions.length===0;
    // A circular document-space dab must survive nonuniform source scaling,
    // rotation and flips, for both painting and erasing (including soft edges).
    const roundness=[];
    for(const rotation of [0,37,90])for(const flipX of [false,true])for(const hardness of [1,.5])for(const erase of [false,true]){
      const source=surface(128,128),sc=source.getContext('2d');
      if(erase){sc.fillStyle='#ffffff';sc.fillRect(0,0,128,128);}
      const dab=surface(128,128),t={x:128,y:128,width:256,height:64,rotation,flipX,flipY:true};
      stamp(dab.getContext('2d'),{x:64,y:64},32,hardness,'#ffffff',brushScale(t,128,128));
      const painted=composeStroke(source,dab,null,1,erase),paintLayer=createLayer('image',{width:256,height:256},{assetId:'round'});
      paintLayer.transform=t;
      const d=createDocument({width:256,height:256});d.canvas.background=null;d.layers=[paintLayer];
      const output=surface(256,256);await renderer.renderDocument(d,{images:new Map([['round',painted]])},output);
      const pixels=output.getContext('2d').getImageData(0,0,256,256).data;
      let minX=256,maxX=0,minY=256,maxY=0;
      for(let y=104;y<152;y++)for(let x=104;x<152;x++)if(Math.hypot(x-128,y-128)<23&&(erase?pixels[(y*256+x)*4+3]<128:pixels[(y*256+x)*4+3]>128)){minX=Math.min(x,minX);maxX=Math.max(x,maxX);minY=Math.min(y,minY);maxY=Math.max(y,maxY);}
      roundness.push(Math.abs((maxX-minX)-(maxY-minY))<=2&&maxX>minX);
    }
    // A zoomed diagonal is traced at screen resolution, not enlarged from a
    // document bitmap. Inspect the partially covered pixels across its edge.
    const vectorDoc=createDocument({width:64,height:64});vectorDoc.canvas.background=null;
    const vector=createLayer('shape',vectorDoc.canvas);Object.assign(vector.transform,{x:32,y:32,width:32,height:32});
    Object.assign(vector.shape,{kind:'path',closed:false,fillOpacity:0,strokeWidth:1,stroke:'#ffffff',anchors:[{x:0,y:0,in:{x:0,y:0},out:{x:0,y:0}},{x:1,y:1,in:{x:1,y:1},out:{x:1,y:1}}]});vectorDoc.layers=[vector];
    const screen=surface(1,1);await renderer.renderDocument(vectorDoc,assets,screen,{x:-384,y:-384,zoom:16,width:256,height:256,pixelRatio:2});
    const row=screen.getContext('2d').getImageData(0,256,512,1).data;let partial=0;for(let x=0;x<512;x++)if(row[x*4+3]>0&&row[x*4+3]<255)partial++;
    const sharpVector=partial<=4&&partial>0,viewportSize=screen.width===512&&screen.height===512;
    const png=await createImageBitmap(await renderer.exportPNG(vectorDoc,assets)),exportSize=png.width===64&&png.height===64;png.close();
    vector.effects=[{id:'blur',type:'blur',enabled:true,radius:1}];
    const standard=surface(1,1),view=surface(1,1);await renderer.renderDocument(vectorDoc,assets,standard);await renderer.renderDocument(vectorDoc,assets,view,{x:0,y:0,zoom:1,width:64,height:64,pixelRatio:1});
    const a=standard.getContext('2d').getImageData(0,0,64,64).data,b=view.getContext('2d').getImageData(0,0,64,64).data,effectParity=a.every((v,i)=>v===b[i]);
    // Exercise the actual worker and commit path on a 12-megapixel image.
    const large=surface(4000,3000),largeMeta=await assets.add(await pngBlob(large));doc.assets.push(largeMeta);layer.assetId=largeMeta.id;layer.eraseRegions=[];
    controller.gesture={...g(),settings:{foreground:'#123456',opacity:1,tolerance:0},mask:null};
    let heartbeat=false;setTimeout(()=>{heartbeat=true;},0);const start=performance.now();await controller.fill({x:0,y:0});
    const largePixels=paintSurface(layer,assets.images.get(layer.assetId)).getContext('2d').getImageData(3999,2999,1,1).data;
    const largeMs=Math.round(performance.now()-start);controller.cancel();assets.dispose();
    return {roundness,sharpVector,viewportSize,exportSize,effectParity,partial,independent,undo,redo,noOp,failedAtomic,staleAtomic,eraseAlpha,outsideAlpha,softAlpha,priorErase,baked,heartbeat,largePixels:[...largePixels],largeMs};
  });
  assert.ok(result.roundness.every(Boolean),'round brush and eraser on stretched/rotated/flipped layers');
  for(const k of ['sharpVector','viewportSize','exportSize','effectParity'])assert.equal(result[k],true,k);
  console.log('PASS round document-space painting, sharp zoomed paths, bounded viewport and export/effect parity');
  for(const k of ['independent','undo','redo','noOp','failedAtomic','staleAtomic','baked','heartbeat'])assert.equal(result[k],true,k);
  assert.equal(result.eraseAlpha,127);assert.equal(result.outsideAlpha,255);assert.ok(result.softAlpha>result.eraseAlpha&&result.softAlpha<255);assert.equal(result.priorErase,0);assert.deepEqual(result.largePixels,[18,52,86,255]);
  console.log('PASS immutable assets, no-op edits, encoding failure, stale commits, soft erasure and legacy erasure baking');
  console.log('PASS 12-megapixel worker fill keeps event loop responsive:',result.largeMs,'ms');
}finally{await browser.close();}
