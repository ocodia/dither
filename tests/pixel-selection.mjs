import { artworkPixel, checkSavedRendering } from './viewport-helpers.js';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.DITHER_PLAYWRIGHT_PATH?pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href:'playwright');
const browser=await chromium.launch({channel:process.env.DITHER_BROWSER||'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(10000);
const base=process.env.DITHER_URL||'http://127.0.0.1:4173/';
const ready=()=>page.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');
const alpha=async(x,y)=>(await artworkPixel(page,x,y))[3];
async function key(key){await page.locator('#workspace').focus();await page.keyboard.press(key);await ready();}
async function point(x,y){const b=await page.locator('#stage').boundingBox();return {x:b.x+x*b.width/400,y:b.y+y*b.height/300};}
async function chooseTool(tool){await page.locator("#selection-tool-toggle").click();await page.locator(`#selection-tool-menu [data-tool="${tool}"]`).click();}
async function drag(tool,coords){await chooseTool(tool);let p=await point(...coords[0]);await page.mouse.move(p.x,p.y);await page.mouse.down();for(const xy of coords.slice(1)){p=await point(...xy);await page.mouse.move(p.x,p.y,{steps:5});}await page.mouse.up();}
async function property(path,value){const input=page.locator(`[data-path="${path}"]`);await input.fill(String(value));await input.press('Tab');await ready();}
async function save(){await key('Control+s');await page.getByRole('status').filter({hasText:'Project saved'}).waitFor();}
async function stored(){return page.evaluate(async()=>{const {loadProject,listProjects}=await import('./js/storage/projects.js');const p=await loadProject((await listProjects())[0].id);const data=structuredClone(p.doc);p.assets.dispose();return data;});}
try{
 await page.goto(base);await page.locator('[name=width]').fill('400');await page.locator('[name=height]').fill('300');await page.locator('#new-form [type=submit]').click();
 const fixture=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=300;const x=c.getContext('2d');x.fillStyle='#e86245';x.fillRect(0,0,400,300);x.fillStyle='#326ee4';x.fillRect(200,0,200,300);return c.toDataURL().split(',')[1];});
 await page.locator('#image-input').setInputFiles({name:'source.png',mimeType:'image/png',buffer:Buffer.from(fixture,'base64')});await page.waitForFunction(()=>document.querySelector('#layer-count').textContent==='1');await ready();
 await drag('marquee-rect',[[40,40],[120,100]]);assert.equal(await page.locator('.pixel-selection-outline').count(),1);await key('Delete');assert.equal(await alpha(80,70),0);assert.equal(await alpha(20,20),255);assert.equal(await page.locator('#layer-count').textContent(),'1');await key('Control+z');assert.equal(await alpha(80,70),255);await key('Control+Shift+z');assert.equal(await alpha(80,70),0);await key('Control+z');
 console.log('PASS rectangular deletion and undo/redo');
 await drag('marquee-ellipse',[[140,40],[240,140]]);await key('Delete');assert.equal(await alpha(190,90),0);assert.equal(await alpha(142,42),255);await key('Control+z');
 await drag('lasso',[[50,150],[130,150],[90,230],[50,150]]);await key('Delete');assert.equal(await alpha(90,175),0);assert.equal(await alpha(125,220),255);await key('Control+z');
 await chooseTool('polygon-lasso');for(const xy of [[260,150],[350,150],[305,240]]){const p=await point(...xy);await page.mouse.click(p.x,p.y);}await key('Enter');await key('Delete');assert.equal(await alpha(305,175),0);assert.equal(await alpha(265,230),255);await key('Control+z');
 // Escape cancels only the unfinished polygon, preserving the previous completed selection.
 await page.waitForTimeout(310);const p=await point(200,200);await page.mouse.click(p.x,p.y);await key('Escape');assert.equal(await page.locator('.pixel-selection-outline').count(),1);await key('Control+d');assert.equal(await page.locator('.pixel-selection-outline').count(),0);
 // Double-click and clicking the starting point both close a polygon.
 for(const close of ['double','start']){
   await page.waitForTimeout(310);await chooseTool('polygon-lasso');
   for(const xy of [[260,150],[350,150]]){const at=await point(...xy);await page.mouse.click(at.x,at.y);}
   const end=await point(305,240);if(close==='double')await page.mouse.dblclick(end.x,end.y);else{await page.mouse.click(end.x,end.y);const start=await point(260,150);await page.mouse.click(start.x,start.y);}
   await key('Delete');assert.equal(await alpha(305,175),0);await key('Control+z');await key('Control+d');
 }
 // Editing a text field must not delete/copy image pixels or change tools.
 await drag('marquee-rect',[[40,40],[120,100]]);const name=page.locator('#properties [data-path=name]');await name.focus();await name.press('Control+a');await name.press('Backspace');await name.fill('source');await name.press('Tab');await ready();assert.equal(await alpha(80,70),255);assert.equal(await page.locator('#layer-count').textContent(),'1');await key('Control+d');
 console.log('PASS ellipse, freehand and polygon masks; cancel/deselect');
 await property('transform.rotation',30);await page.locator('[data-action=flip-x]').click();await drag('marquee-rect',[[155,115],[245,185]]);await key('Delete');assert.equal(await alpha(200,150),0);assert.equal(await alpha(150,150),255);await save();let doc=await stored();assert.equal(doc.layers[0].eraseRegions.length,1);assert.equal(doc.assets.length,1);
 await key('Control+z');await property('transform.rotation',0);await page.locator('[data-action=flip-x]').click();
 // Force denied system clipboard: local Copy/Cut/Paste must still work.
 await page.evaluate(()=>Object.defineProperty(navigator.clipboard,'write',{configurable:true,value:async()=>{throw new Error('Denied');}}));
 await drag('marquee-rect',[[40,40],[120,100]]);await key('Control+x');await page.waitForFunction(()=>!document.querySelector('[data-pixel-action=paste]').disabled);await ready();assert.equal(await alpha(80,70),0);
 await page.locator('[data-pixel-action=paste]').click();await page.waitForFunction(()=>document.querySelector('#layer-count').textContent==='2');await ready();assert.equal(await alpha(80,70),255);assert.equal(Number(await page.locator('[data-path="transform.width"]').inputValue()),80);assert.equal(Number(await page.locator('[data-path="transform.x"]').inputValue()),80);
 await save();doc=await stored();assert.equal(doc.assets.length,2);assert.ok(doc.layers[0].eraseRegions.length);assert.equal(doc.layers[1].eraseRegions,undefined);await key('Control+z');assert.equal(await alpha(80,70),0);await key('Control+Shift+z');assert.equal(await alpha(80,70),255);
 console.log('PASS transformed selections; cut/paste preserve originals and cropped position');
 // Native paste routing recognizes locally copied pixel data and retains its position.
 await key('Control+a');await key('Control+c');await page.waitForFunction(()=>!document.querySelector('[data-pixel-action=paste]').disabled);
 await page.evaluate(async()=>{const {loadProject,listProjects}=await import('./js/storage/projects.js');const p=await loadProject((await listProjects())[0].id),blob=p.assets.blobs.get(p.doc.layers[1].assetId);const transfer=new DataTransfer();transfer.items.add(new File([blob],'clipboard.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));p.assets.dispose();});
 await page.waitForFunction(()=>document.querySelector('#layer-count').textContent==='3');await ready();assert.equal(Number(await page.locator('[data-path="transform.x"]').inputValue()),80);
 await page.locator('.layer-row.selected [data-layer-action=lock]').click();await chooseTool('marquee-rect');assert.ok(await page.locator('[data-pixel-action=all]').isDisabled());
 await save();await page.evaluate(()=>navigator.serviceWorker.ready);await context.setOffline(true);await page.reload();await page.locator('#new-dialog [data-action=open]').click();await page.locator('.project-card').first().click();await page.locator('#open-dialog').waitFor({state:'hidden'});await ready();assert.equal(await page.locator('#layer-count').textContent(),'3');assert.equal(await alpha(80,70),255);
 // Export pixels match the artwork while a selection outline is visible.
 await page.locator('.layer-row').last().locator('[data-layer-action=select]').click();await key('Control+a');
 assert.deepEqual(await checkSavedRendering(page),{equal:true,width:400,height:300});
 await mkdir('.test-results',{recursive:true});await page.screenshot({path:resolve('.test-results/pixel-selection.png')});assert.deepEqual(errors,[]);
 // Small deterministic fixtures verify alpha extraction, original immutability and masks before effects.
 const pixels=await page.evaluate(async()=>{
   const {extractSelection}=await import('./js/rendering/image-pixels.js'),{DocumentRenderer}=await import('./js/rendering/renderer.js'),{createLayer,createDocument}=await import('./js/model/document.js'),{marqueePoints}=await import('./js/model/pixel-region.js'),{createEffect}=await import('./js/model/effects.js');
   const source=document.createElement('canvas');source.width=20;source.height=20;const ctx=source.getContext('2d');ctx.fillStyle='rgba(255,0,0,.5)';ctx.fillRect(0,0,20,20);
   const d=createDocument({width:20,height:20}),layer=createLayer('image',d.canvas,{assetId:'original',transform:{x:10,y:10,width:20,height:20,rotation:0,flipX:false,flipY:false},eraseRegions:[marqueePoints({x:.4,y:.4},{x:.6,y:.6})]});
   const copy=await extractSelection(layer,source,marqueePoints({x:.2,y:.2},{x:.8,y:.8},true)),bitmap=await createImageBitmap(copy.blob),c=document.createElement('canvas');c.width=12;c.height=12;c.getContext('2d').drawImage(bitmap,0,0);const at=(canvas,x,y)=>canvas.getContext('2d').getImageData(x,y,1,1).data[3];
   const result={width:bitmap.width,height:bitmap.height,hole:at(c,6,6),inside:at(c,6,2),outside:at(c,0,0),original:at(source,10,10)};
   layer.effects=[{...createEffect('stroke'),enabled:true,width:2,colour:'#00ff00'}];d.layers=[layer];const output=document.createElement('canvas');await new DocumentRenderer().renderDocument(d,{images:new Map([['original',source]])},output);result.strokeInsideHole=output.getContext('2d').getImageData(9,9,1,1).data[1];bitmap.close();return result;
 });assert.deepEqual(pixels,{width:12,height:12,hole:0,inside:128,outside:0,original:128,strokeInsideHole:255});
 console.log('PASS native paste routing, locked layers, offline reopen and exact export without overlay');
}finally{await browser.close();}

