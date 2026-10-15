import { artworkPixel } from './viewport-helpers.js';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const {chromium}=await import(process.env.DITHER_PLAYWRIGHT_PATH?pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href:'playwright');
const browser=await chromium.launch({channel:process.env.DITHER_BROWSER||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');
const historyCount=()=>page.locator('[data-history-state]').count();
async function point(x,y){const b=await page.locator('#stage').boundingBox();return {x:b.x+b.width*x,y:b.y+b.height*y};}
async function click(x,y){const p=await point(x,y);await page.mouse.click(p.x,p.y);await ready();}
async function drag(x,y,xx,yy){const a=await point(x,y),b=await point(xx,yy);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();}
async function key(k){await page.locator('#workspace').focus();await page.keyboard.press(k);await ready();}
async function pixel(x,y){return artworkPixel(page,x,y,true);}
async function committed(n){await page.waitForFunction(n=>document.querySelectorAll('[data-history-state]').length===n,n);await ready();}
try{
  await page.goto(process.env.DITHER_URL||'http://127.0.0.1:4173/');await page.locator('#new-dialog [data-close]').click();await ready();
  await page.locator('[data-action=new-layer]').click();await committed(2);await key('b');
  assert.deepEqual(await page.locator('#tool-options label').evaluateAll(els=>els.map(el=>el.textContent.trim().replace(/100%$/, '').trim())),['Colour','Size (px)','Hardness']);
  const brushHistory=await historyCount(),wheelPoint=await point(.5,.5),zoomBefore=(await page.locator('#stage').boundingBox()).width;
  await page.mouse.move(wheelPoint.x,wheelPoint.y);await page.keyboard.down('Shift');await page.mouse.wheel(0,-100);await page.keyboard.up('Shift');
  await page.waitForFunction(()=>document.querySelector('[data-setting=size]').value==='22');
  assert.equal((await page.locator('#stage').boundingBox()).width,zoomBefore);assert.equal(await historyCount(),brushHistory);
  await page.keyboard.down('Shift');await page.mouse.wheel(0,100);await page.keyboard.up('Shift');await page.waitForFunction(()=>document.querySelector('[data-setting=size]').value==='20');
  for(const [size,delta] of [['1',100],['1024',-100]]){
    await page.locator('[data-setting=size]').fill(size);await page.locator('[data-setting=size]').press('Tab');
    await page.locator('#artwork').dispatchEvent('wheel',{shiftKey:true,deltaY:delta,clientX:wheelPoint.x,clientY:wheelPoint.y});
    assert.equal(await page.locator('[data-setting=size]').inputValue(),size);
  }
  await page.mouse.wheel(0,-100);await page.waitForFunction(width=>document.querySelector('#stage').getBoundingClientRect().width>width,zoomBefore);await key('Control+0');
  await page.locator('[data-setting=foreground]').fill('#ff0000');await page.locator('[data-setting=size]').fill('50');await page.locator('[data-setting=size]').press('Tab');
  const n=await historyCount();await drag(.3,.5,.7,.5);await committed(n+1);assert.deepEqual(await pixel(.5,.5),[255,0,0,255]);
  await key('Control+z');assert.equal((await pixel(.5,.5))[3],0);await key('Control+Shift+z');assert.equal((await pixel(.5,.5))[0],255);
  await key('Shift+E');
  assert.deepEqual(await page.locator('#tool-options label').evaluateAll(els=>els.map(el=>el.textContent.trim().replace(/100%$/, '').trim())),['Opacity','Size (px)','Hardness']);
  const eraserHistory=await historyCount(),eraserZoom=(await page.locator('#stage').boundingBox()).width,eraserPoint=await point(.5,.5);
  await page.mouse.move(eraserPoint.x,eraserPoint.y);await page.keyboard.down('Shift');await page.mouse.wheel(0,-100);await page.keyboard.up('Shift');
  await page.waitForFunction(()=>document.querySelector('[data-setting=size]').value==='55');
  await page.keyboard.down('Shift');await page.mouse.wheel(0,100);await page.keyboard.up('Shift');await page.waitForFunction(()=>document.querySelector('[data-setting=size]').value==='49');
  assert.equal((await page.locator('#stage').boundingBox()).width,eraserZoom);assert.equal(await historyCount(),eraserHistory);
  await click(.5,.5);await committed(n+2);assert.equal((await pixel(.5,.5))[3],0);
  await key('b');await click(.5,.5);await committed(n+3);assert.equal((await pixel(.5,.5))[3],255);
  await key('i');const beforeSample=await historyCount();await click(.4,.5);assert.equal(await page.locator('[data-setting=foreground]').inputValue(),'#ff0000');assert.equal(await historyCount(),beforeSample);
  await key('f');await page.locator('[data-setting=foreground]').fill('#0000ff');await click(.5,.8);await committed(beforeSample+1);assert.deepEqual(await pixel(.5,.8),[0,0,255,255]);assert.deepEqual(await pixel(.4,.5),[255,0,0,255]);
  console.log('PASS brush, erase, repaint, sample, connected fill and undo/redo');
  // A selected region clips all painting; Escape cancels a live stroke.
  await key('m');await drag(.2,.65,.4,.85);await key('b');await page.locator('[data-setting=foreground]').fill('#00ff00');await drag(.1,.75,.6,.75);await committed(beforeSample+2);
  assert.deepEqual(await pixel(.3,.75),[0,255,0,255]);assert.deepEqual(await pixel(.5,.75),[0,0,255,255]);
  const beforeCancel=await historyCount(),p=await point(.3,.7);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+20,p.y);await page.keyboard.press('Escape');await page.mouse.up();await ready();assert.equal(await historyCount(),beforeCancel);
  await key('Control+d');
  await key('g');await drag(.2,.4,.8,.7);await committed(beforeCancel+1);assert.equal(await page.locator('[data-path=name]').inputValue(),'Gradient');
  await page.locator('[data-setting=gradientType]').selectOption('radial');await ready();await page.locator('[data-tool-action=add-stop]').click();await ready();assert.equal(await page.locator('.gradient-stop').count(),3);
  await page.locator('[data-stop-order="2"] [data-tool-action=edit-stop]').click();
  await page.locator('[data-stop-order="2"] [data-stop=colour]').fill('#ff00ff');await ready();
  await key('p');await click(.2,.4);await drag(.5,.65,.55,.55);await click(.75,.45);await key('Enter');
  assert.equal(await page.locator('[data-path=name]').inputValue(),'Path');assert.equal(await page.locator('[data-anchor-handle=point]').count(),3);
  const idleHistory=await historyCount();await page.locator('[data-anchor-handle=point]').first().click();await ready();assert.equal(await historyCount(),idleHistory);
  const h=await historyCount();const handle=page.locator('[data-anchor-handle=point]').nth(1),box=await handle.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+35,box.y+45);await page.mouse.up();await committed(h+1);await key('Control+z');await key('Control+Shift+z');
  await page.locator('[data-tool-action=corner]').first().click();await ready();
  console.log('PASS selection clipping, cancellation, editable radial gradient and Bézier anchors');
  await key('Control+s');await page.getByRole('status').filter({hasText:'Project saved'}).waitFor();
  const saved=await page.evaluate(async()=>{
    const {listProjects,loadProject}=await import('./js/storage/projects.js');const {DocumentRenderer}=await import('./js/rendering/renderer.js');
    const loaded=await loadProject((await listProjects())[0].id),r=new DocumentRenderer(),canvas=document.createElement('canvas');await r.renderDocument(loaded.doc,loaded.assets,canvas);
    const blob=await r.exportPNG(loaded.doc,loaded.assets),img=await createImageBitmap(blob),out=document.createElement('canvas');out.width=canvas.width;out.height=canvas.height;out.getContext('2d').drawImage(img,0,0);
    const a=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,b=out.getContext('2d').getImageData(0,0,out.width,out.height).data;
    const result={version:loaded.doc.version,kinds:loaded.doc.layers.map(l=>l.shape?.kind||l.type),same:a.every((v,i)=>v===b[i]),gradient:loaded.doc.layers[1].shape.gradient.type};loaded.assets.dispose();img.close();return result;
  });
  assert.deepEqual(saved,{version:2,kinds:['image','rectangle','path'],same:true,gradient:'radial'});
  assert.deepEqual(errors,[]);await mkdir('.test-results',{recursive:true});await page.screenshot({path:'.test-results/drawing-tools.png'});
  console.log('PASS save/reopen, exact PNG rendering and no browser errors');
  await page.getByRole('button',{name:'Hide Path',exact:true}).click();await page.getByRole('button',{name:'Hide Gradient',exact:true}).click();
  await page.locator('[title="Select Paint"]').click();
  for(const [name,value] of [['transform.width','800'],['transform.height','500'],['transform.rotation','37']]){await page.locator(`[data-path="${name}"]`).fill(value);await page.locator(`[data-path="${name}"]`).press('Tab');}
  await page.locator('[data-action=flip-x]').click();await key('b');await page.locator('[data-setting=foreground]').fill('#ffff00');
  const transformedHistory=await historyCount();await click(.5,.5);await committed(transformedHistory+1);assert.deepEqual(await pixel(.5,.5),[255,255,0,255]);
  await page.locator('[data-path=locked]').check();await page.locator('[data-path=locked]').press('Tab');const lockedHistory=await historyCount();await key('b');assert.ok(await page.locator('[data-tool=brush]').isDisabled());assert.equal(await historyCount(),lockedHistory);
  await page.locator('[data-path=locked]').uncheck();await page.locator('[data-path=locked]').press('Tab');
  await page.getByRole('button',{name:'Hide Paint',exact:true}).click();const hiddenHistory=await historyCount();await key('b');assert.ok(await page.locator('[data-tool=brush]').isDisabled());assert.equal(await historyCount(),hiddenHistory);
  await page.getByRole('button',{name:'Show Paint',exact:true}).click();await key('Shift+E');const outsideHistory=await historyCount();await click(.98,.98);assert.equal(await historyCount(),outsideHistory);
  await key('Control+s');await page.getByRole('status').filter({hasText:'Project saved'}).waitFor();
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.context().setOffline(true);await page.reload();await page.locator('#new-dialog [data-close]').click();await key('Control+o');await page.locator('[data-project]').first().click();await page.waitForFunction(()=>document.querySelector('#layer-count').textContent==='3');await ready();
  assert.equal(await page.locator('#layer-count').textContent(),'3');assert.deepEqual(await pixel(.5,.5),[255,255,0,255]);
  assert.deepEqual(errors,[]);console.log('PASS transformed painting, locked/hidden layers, outside-image no-op and version-2 offline reopen');
}finally{await browser.close();}
