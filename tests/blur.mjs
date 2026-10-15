import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.DITHER_PLAYWRIGHT_PATH?pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href:'playwright');
const browser=await chromium.launch({channel:process.env.DITHER_BROWSER||'msedge',headless:true});
try {
  for(const mode of ['native','missing','ignored','no-worker']) {
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.DITHER_URL||'http://127.0.0.1:4173/');
    const result=await page.evaluate(async mode=>{
      const proto=CanvasRenderingContext2D.prototype;
      if(mode==='missing'||mode==='no-worker')delete proto.filter;
      if(mode==='ignored')Object.defineProperty(proto,'filter',{configurable:true,get:()=> 'none',set(){}});
      if(mode==='no-worker')globalThis.Worker=undefined;
      const {applyEffects}=await import('./js/rendering/effects.js');
      const {DocumentRenderer}=await import('./js/rendering/renderer.js');
      const {createDocument,createLayer}=await import('./js/model/document.js');
      const source=document.createElement('canvas');source.width=source.height=65;
      const ctx=source.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(28,28,9,9);
      const at=(c,x,y)=>[...c.getContext('2d').getImageData(x,y,1,1).data];
      const blurred=await applyEffects(source,[{type:'blur',enabled:true,radius:4}]);
      const spread=at(blurred,40,32)[3]>0&&at(blurred,32,32)[3]<255;
      // Recreate a crisp source because pixel effects may process in place.
      ctx.clearRect(0,0,65,65);ctx.fillRect(28,28,9,9);
      const sharp=await applyEffects(source,[{type:'blur',enabled:true,radius:0}]);
      const zero=at(sharp,32,32)[3]===255&&at(sharp,40,32)[3]===0;
      const shadow=await applyEffects(source,[{type:'drop-shadow',enabled:true,colour:'#ff0000',opacity:.5,offsetX:10,offsetY:0,blur:3}]);
      const edge=at(shadow,48,32),centre=at(shadow,32,32);
      const softShadow=edge[0]===255&&edge[1]===0&&edge[3]>0&&edge[3]<128&&centre.every(v=>v===255);
      const doc=createDocument({width:65,height:65});
      const layer=createLayer('image',doc.canvas,{assetId:'source'});Object.assign(layer.transform,{width:65,height:65});
      layer.effects=[{type:'blur',enabled:true,radius:4}];doc.layers=[layer];
      const renderer=new DocumentRenderer(),assets={images:new Map([['source',source]])};
      const preview=document.createElement('canvas');await renderer.renderDocument(doc,assets,preview,{x:0,y:0,zoom:1,width:65,height:65,pixelRatio:1});
      const bitmap=await createImageBitmap(await renderer.exportPNG(doc,assets));
      const exported=document.createElement('canvas');exported.width=exported.height=65;exported.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
      const p=preview.getContext('2d').getImageData(0,0,65,65).data,e=exported.getContext('2d').getImageData(0,0,65,65).data;
      const exportBlur=at(exported,40,32)[3]>0&&p.every((v,i)=>v===e[i]);
      let heartbeat=false;setTimeout(()=>heartbeat=true,0);
      const large=document.createElement('canvas');large.width=large.height=512;large.getContext('2d').fillRect(200,200,100,100);
      await applyEffects(large,[{type:'blur',enabled:true,radius:40}]);
      return {spread,zero,softShadow,exportBlur,responsive:mode==='native'||mode==='no-worker'||heartbeat};
    },mode);
    for(const [key,value] of Object.entries(result))assert.equal(value,true,`${mode}: ${key}`);
    assert.deepEqual(errors,[]);await page.close();
    console.log(`PASS ${mode}: blur, soft shadows, zero radius, preview/export and worker responsiveness`);
  }
} finally { await browser.close(); }
