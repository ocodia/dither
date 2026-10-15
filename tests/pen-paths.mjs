import { artworkPixel } from './viewport-helpers.js';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.DITHER_PLAYWRIGHT_PATH?pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href:'playwright');
const browser=await chromium.launch({channel:process.env.DITHER_BROWSER||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const ready=()=>page.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');
const count=async()=>Number(await page.locator('#layer-count').textContent());
const selected=()=>page.locator('.layer-row.selected').getAttribute('data-layer');
const anchors=()=>page.locator('[data-anchor-handle=point]').count();
const finish=()=>page.locator('[data-tool-action=finish-path]');
async function key(k){await page.locator('#workspace').focus();await page.keyboard.press(k);await ready();}
async function click(x,y){const r=await page.locator('#stage').boundingBox();await page.mouse.click(r.x+r.width*x,r.y+r.height*y);await ready();}
try{
  await page.goto(process.env.DITHER_URL||'http://127.0.0.1:4173/');await page.locator('#new-dialog [data-close]').click();await key('p');
  assert.equal(await finish().count(),0);assert.equal(await page.locator('[data-tool-action=new-path]').count(),0);
  await click(.2,.4);assert.equal(await count(),0);assert.equal(await finish().count(),0);
  await click(.4,.4);assert.equal(await count(),1);const first=await selected();assert.ok(await finish().isVisible());assert.equal(await anchors(),2);assert.equal(await page.locator('[data-tool-action=close-shape]').count(),0);
  // The layer is really rendered before Finish is clicked, rather than only an SVG draft.
  assert.ok((await artworkPixel(page,.3,.4,true))[3]>0);
  await click(.5,.6);assert.equal(await count(),1);assert.equal(await selected(),first);assert.equal(await anchors(),3);
  const historyBeforeFinish=await page.locator('[data-history-state]').count();await finish().click();await ready();
  assert.equal(await finish().count(),0);assert.equal(await page.locator('[data-history-state]').count(),historyBeforeFinish);
  await page.locator('[data-tool-action=close-shape]').click();assert.equal(await page.locator('[data-tool-action=close-shape]').count(),0);
  await key('Control+z');assert.ok(await page.locator('[data-tool-action=close-shape]').isVisible());
  // A selected finished path must not be extended by subsequent blank-canvas clicks.
  await click(.65,.35);assert.equal(await count(),1);await click(.8,.55);assert.equal(await count(),2);const second=await selected();assert.notEqual(second,first);assert.ok(await finish().isVisible());
  await click(.65,.7);assert.equal(await anchors(),3);await page.locator('[data-tool-action=close-shape]').click();assert.equal(await count(),2);assert.equal(await finish().count(),0);
  await key('Control+z');assert.equal(await count(),2);await key('Control+Shift+z');assert.equal(await count(),2);
  // Cancellation preserves anchors already committed to a new layer.
  await click(.2,.7);await click(.35,.8);assert.equal(await count(),3);await key('Escape');assert.equal(await count(),3);assert.equal(await finish().count(),0);
  await key('Control+z');assert.equal(await count(),2);await key('Control+Shift+z');assert.equal(await count(),3);
  // Removing the second anchor returns to a single pending point without invalid layers.
  await click(.4,.75);await click(.55,.85);assert.equal(await count(),4);await key('Backspace');assert.equal(await count(),3);assert.equal(await anchors(),1);assert.equal(await finish().count(),0);
  await click(.6,.85);assert.equal(await count(),4);assert.ok(await finish().isVisible());await key('Enter');assert.equal(await finish().count(),0);
  // Saving an in-progress path keeps its already-created geometry.
  await click(.15,.5);await click(.25,.6);assert.equal(await count(),5);await key('Control+s');await page.getByRole('status').filter({hasText:'Project saved'}).waitFor();
  const saved=await page.evaluate(async()=>{
    const {listProjects,loadProject}=await import('./js/storage/projects.js');const p=await loadProject((await listProjects())[0].id);
    const result=p.doc.layers.map(l=>({id:l.id,anchors:l.shape.anchors.length,closed:l.shape.closed}));p.assets.dispose();return result;
  });
  assert.equal(saved.length,5);assert.deepEqual(saved.slice(0,2),[{id:first,anchors:3,closed:false},{id:second,anchors:3,closed:true}]);
  assert.ok(saved.every(l=>l.anchors>=2));assert.deepEqual(errors,[]);
  console.log('PASS automatic two-anchor layer creation, extension, new paths from selected finished paths, Finish/close, cancellation, Backspace, history and save/reopen');
}finally{await browser.close();}
