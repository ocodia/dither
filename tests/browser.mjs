import { checkSavedRendering } from './viewport-helpers.js';
// Optional integration checks. Point DITHER_PLAYWRIGHT_PATH at an external Playwright installation.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.DITHER_PLAYWRIGHT_PATH ? pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href : 'playwright');
const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(),'dither-test-')), { channel: process.env.DITHER_BROWSER || 'msedge', headless: true, viewport: { width:1440, height:1000 }, acceptDownloads: true });
const page = await context.newPage(), errors = [], failed = [];
page.setDefaultTimeout(10000);
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
page.on('dialog', dialog => dialog.accept());
const base = process.env.DITHER_URL || 'http://127.0.0.1:4173/';
const output = resolve('.test-results'); await mkdir(output, { recursive:true });
const check = (name, details) => console.log(`PASS ${name}${details ? ` — ${details}` : ''}`);
async function checkFluentIcons() {
  const result = await page.evaluate(async () => {
    const response = await fetch('./icons/ui.svg');
    const sprite = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
    const symbols = [...sprite.querySelectorAll('symbol')];
    const ids = new Set(symbols.map(symbol => symbol.id));
    const uses = [...document.querySelectorAll('svg.icon use')];
    const missing = uses.map(use => use.getAttribute('href').split('#')[1]).filter(id => !ids.has(id));
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    probe.setAttribute('width', '20'); probe.setAttribute('height', '20');
    const use = document.createElementNS(probe.namespaceURI, 'use');
    use.setAttribute('href', './icons/ui.svg#cursor'); probe.append(use); document.body.append(probe);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const bounds = use.getBBox(); probe.remove();
    return { ok: response.ok, count: uses.length, missing, rendered: bounds.width > 10 && bounds.height > 10,
      viewBoxes: symbols.every(symbol => symbol.getAttribute('viewBox') === '0 0 20 20'),
      legacy: document.querySelectorAll('.bi, link[href*="bootstrap"]').length };
  });
  assert.ok(result.ok && result.count > 0 && result.rendered && result.viewBoxes);
  assert.deepEqual(result.missing, []); assert.equal(result.legacy, 0);
}
async function action(name) {
  const previous = await page.locator('[data-tab][aria-selected="true"]').getAttribute('data-tab');
  if (['new','open','save','export'].includes(name)) await page.locator('.document-menu-toggle').click();
  if (['undo','redo'].includes(name)) await page.locator('[data-tab=history]').click();
  await page.locator(`[data-action=${name}]`).click();
  if (['undo','redo'].includes(name)) await page.locator(`[data-tab=${previous}]`).click();
}
try {
  await page.goto(base); await page.locator('#new-dialog').waitFor({state:'visible'});
  await page.screenshot({ path: resolve(output,'new-document.png') });
  await page.locator('#new-form [name=name]').fill('Integration composition');
  await page.locator('#new-form [name=width]').fill('800'); await page.locator('#new-form [name=height]').fill('600');
  await page.getByRole('button', { name:'Create document', exact:false }).click();
  await page.locator('#new-dialog').waitFor({state:'hidden'});
  check('Create custom transparent document');

  const fixture = await page.evaluate(() => { const c=document.createElement('canvas');c.width=500;c.height=320;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,500,320);g.addColorStop(0,'#edb98a');g.addColorStop(.5,'#637494');g.addColorStop(1,'#202e42');x.fillStyle=g;x.fillRect(0,0,500,320);x.fillStyle='#f6dbba';x.beginPath();x.arc(350,90,38,0,Math.PI*2);x.fill();x.fillStyle='#334152';x.beginPath();x.moveTo(0,280);x.lineTo(190,90);x.lineTo(320,230);x.lineTo(410,130);x.lineTo(500,240);x.lineTo(500,320);x.lineTo(0,320);x.fill();return c.toDataURL().split(',')[1]; });
  const imageFile = { name:'mountains.png', mimeType:'image/png', buffer:Buffer.from(fixture,'base64') };
  await page.locator('#image-input').setInputFiles([imageFile,{...imageFile,name:'second-image.png'}]);
  await page.waitForFunction(() => document.querySelector('#layer-count').textContent === '2');
  check('Import two original image assets');
  const selectedLayer = () => page.locator('.layer-row.selected');
  async function property(path, value) { const el = page.locator(`#properties [data-path="${path}"]`); await el.fill(String(value)); await el.press('Tab'); }
  await property('transform.x',450); await property('transform.y',340); await property('transform.width',380); await property('transform.height',245);
  await property('transform.rotation',-8); await property('opacity',.8);
  await page.locator('[data-action=flip-x]').click(); await page.locator('[data-action=flip-x]').click();
  await page.locator('[data-action=lower]').click();
  assert.equal(await page.locator('.layer-row').last().getAttribute('class'),'layer-row selected ');
  await selectedLayer().locator('[data-layer-action=visibility]').click(); await selectedLayer().locator('[data-layer-action=visibility]').click();
  await selectedLayer().locator('[data-layer-action=lock]').click(); assert.equal(await page.locator('#overlay [data-handle]').count(),0);
  await selectedLayer().locator('[data-layer-action=lock]').click();
  check('Numeric transforms, flips, opacity, reorder, visibility and lock');

  await page.locator('[data-tab=effects]').click();
  for (const [type, field, value] of [['brightness','amount','12'],['contrast','amount','20'],['colour-overlay','opacity','0.15'],['stroke','width','3'],['blur','radius','1'],['drop-shadow','blur','5'],['dither','intensity','0.7']]) {
    const card = page.locator(`[data-effect="${type}"]`);
    if (!(await card.getAttribute('open') !== null)) await card.locator('summary').click();
    await card.locator(`input[data-path="effect:${type}.enabled"]`).check();
    const input = page.locator(`input[data-path="effect:${type}.${field}"]`);
    await input.fill(value); await input.dispatchEvent('change');
  }
  await page.waitForFunction(() => document.querySelector('#effect-count').textContent === '7');
  check('Every milestone effect enabled and edited');

  await page.locator('[data-action=text]').click(); await property('text.content','DITHER\nMake it your own.'); await property('text.fontSize',40); await property('transform.x',360); await property('transform.y',160);
  for (const shape of ['rectangle','ellipse','arrow','line']) { await page.locator(`[data-action=${shape}]`).click(); if (shape==='rectangle') { await property('shape.fill','#93b9ff'); await property('shape.strokeWidth',3); } }
  assert.equal(await page.locator('#layer-count').textContent(),'7');
  await page.locator('[data-action=duplicate]').click(); assert.equal(await page.locator('#layer-count').textContent(),'8');
  await page.locator('[data-action=delete]').click(); await action('undo'); assert.equal(await page.locator('#layer-count').textContent(),'8');
  await action('redo'); assert.equal(await page.locator('#layer-count').textContent(),'7');
  check('Editable typography, all four shapes and command undo/redo');

  // Drive real pointer gestures, including a rotation and resize at non-100% zoom.
  await page.locator('.layer-select').filter({hasText:'Rectangle'}).click();
  const centre = await page.locator('#overlay g').evaluate(g => {const r=g.getBoundingClientRect();return {x:r.x+r.width*.2,y:r.y+r.height*.2};});
  await page.mouse.move(centre.x,centre.y); await page.mouse.down(); await page.mouse.move(centre.x+35,centre.y+22,{steps:8}); await page.mouse.up();
  const handle = page.locator('#overlay [data-handle="1,1"]'); const bounds=await handle.boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2); await page.mouse.down(); await page.keyboard.down('Shift'); await page.mouse.move(bounds.x+55,bounds.y+35,{steps:8}); await page.mouse.up(); await page.keyboard.up('Shift');
  const rotation=await page.locator('#overlay [data-rotate]').boundingBox(); await page.mouse.move(rotation.x+rotation.width/2,rotation.y+rotation.height/2);await page.mouse.down();await page.keyboard.down('Shift');await page.mouse.move(rotation.x+65,rotation.y+50,{steps:8});await page.mouse.up();await page.keyboard.up('Shift');
  await page.locator('#workspace').focus(); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+Shift+z');
  check('Canvas selection, pointer move/resize/rotation and keyboard nudges');

  await action('save'); await page.getByRole('status').filter({hasText:'Project saved on this device.'}).waitFor();
  assert.ok(await page.locator('[data-action=save]').isDisabled());
  const saved = await page.evaluate(async()=>{const {listProjects}=await import('./js/storage/projects.js');return (await listProjects())[0];});
  assert.equal(saved.layers.length,7); assert.equal(saved.assets.length,2); assert.ok(saved.layers.find(l=>l.type==='text').text.content.includes('DITHER')); assert.equal(saved.layers.find(l=>l.name==='second-image').effects.length,7);
  assert.ok(!JSON.stringify(saved).includes('data:image')); assert.ok(!('_saved' in saved));
  await page.reload(); await page.locator('#new-dialog').waitFor(); await page.locator('#new-dialog [data-action=open]').click(); await page.locator('[data-project]').first().click(); await page.waitForFunction(()=>document.querySelector('#layer-count').textContent==='7');
  await page.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');
  await page.locator('.layer-select').filter({hasText:'second-image'}).click(); await page.locator('[data-tab=effects]').click();
  await page.screenshot({path:resolve(output,'editor.png')});
  check('Transactional save and reload/reopen preserve all layers, effects, text and binary asset references');

  const [download] = await Promise.all([page.waitForEvent('download'),action('export')]); await download.saveAs(resolve(output,'composition.png'));
  const previewMatches = await checkSavedRendering(page);
  assert.deepEqual(previewMatches,{equal:true,width:800,height:600});
  check('Viewport matches screen rendering and document-resolution PNG matches export, with controls excluded');
  const renderChecks = await page.evaluate(async () => {
    const {DocumentRenderer}=await import('./js/rendering/renderer.js'); const {createDocument,createLayer}=await import('./js/model/document.js'); const {createEffect}=await import('./js/model/effects.js'); const {AssetStore}=await import('./js/storage/assets.js');
    const doc=createDocument({width:100,height:100});const layer=createLayer('shape',doc.canvas);layer.transform={...layer.transform,width:20,height:20,x:50,y:50};layer.shape.radius=0;layer.shape.fill='#ff0000';doc.layers=[layer];const renderer=new DocumentRenderer(),assets=new AssetStore(),canvas=document.createElement('canvas');
    await renderer.renderDocument(doc,assets,canvas); const ctx=canvas.getContext('2d'); const initial=[...ctx.getImageData(50,50,1,1).data];const transparent=ctx.getImageData(0,0,1,1).data[3];
    layer.effects=[{...createEffect('stroke'),width:4,colour:'#00ff00'}];await renderer.renderDocument(doc,assets,canvas);const stroke=[...ctx.getImageData(37,50,1,1).data];
    layer.effects=[{...createEffect('drop-shadow'),blur:0,offsetX:18,offsetY:0,opacity:1}];await renderer.renderDocument(doc,assets,canvas);const shadow=ctx.getImageData(72,50,1,1).data[3];
    layer.effects=[{...createEffect('colour-overlay'),colour:'#0000ff',opacity:1}];layer.opacity=.5;await renderer.renderDocument(doc,assets,canvas);const tinted=[...ctx.getImageData(50,50,1,1).data];
    const blob=await renderer.exportPNG(doc,assets),img=await createImageBitmap(blob);return {initial,transparent,stroke,shadow,tinted,width:img.width,height:img.height,type:blob.type};
  });
  assert.deepEqual(renderChecks.initial,[255,0,0,255]);assert.equal(renderChecks.transparent,0);assert.deepEqual(renderChecks.stroke,[0,255,0,255]);assert.equal(renderChecks.shadow,255);assert.equal(renderChecks.tinted[2],255);assert.ok(Math.abs(renderChecks.tinted[3]-128)<=1);assert.equal(renderChecks.width,100);assert.equal(renderChecks.type,'image/png');
  check('PNG export, transparency, layer opacity, outside stroke and padded shadow pixel checks');

  await page.locator('#workspace').focus();
  await page.evaluate(async () => {
    const c=document.createElement('canvas');c.width=32;c.height=24;c.getContext('2d').fillRect(0,0,32,24);
    for(const type of ['image/jpeg','image/webp']) {
      const blob=await new Promise(resolve=>c.toBlob(resolve,type)),file=new File([blob],type==='image/jpeg'?'drop.jpg':'paste.webp',{type}),data=new DataTransfer();data.items.add(file);
      if(type==='image/jpeg') document.querySelector('#workspace').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
      else document.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    }
  });await page.waitForFunction(()=>document.querySelector('#layer-count').textContent==='9');await action('undo');await action('undo');assert.equal(await page.locator('#layer-count').textContent(),'7');check('JPEG drag-and-drop and WebP clipboard import');

  const bad = {name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')};await page.locator('#image-input').setInputFiles(bad); await page.getByRole('status').filter({hasText:'could not be decoded'}).waitFor();
  const validation = await page.evaluate(async () => {
    const {loadProject,saveProject}=await import('./js/storage/projects.js'); const {AssetStore}=await import('./js/storage/assets.js');const {createDocument,createLayer}=await import('./js/model/document.js');
    const doc=createDocument();doc.assets=[{id:'missing',name:'missing.png'}];doc.layers=[createLayer('image',doc.canvas,{assetId:'missing'})];
    try {await saveProject(doc,new AssetStore());return false;}catch(e){return e.message.includes('missing');}
  });assert.ok(validation);check('Corrupt image and missing asset errors');
  const failureChecks = await page.evaluate(async () => {
    const {saveProject,listProjects,loadProject}=await import('./js/storage/projects.js');const {createDocument}=await import('./js/model/document.js');const {AssetStore}=await import('./js/storage/assets.js');
    const before=(await listProjects()).length, original=IDBObjectStore.prototype.put;let quota='';
    try { IDBObjectStore.prototype.put=function(){throw new DOMException('Simulated full disk','QuotaExceededError');};await saveProject(createDocument(),new AssetStore()); } catch(e) {quota=e.message;} finally {IDBObjectStore.prototype.put=original;}
    const after=(await listProjects()).length;
    const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('dither',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
    const broken=createDocument();broken.id='test-missing';broken.assets=[{id:'not-stored',name:'gone.png'}];
    const future={...createDocument(),id:'test-future',version:999};
    await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put(broken);tx.objectStore('projects').put(future);tx.oncomplete=resolve;tx.onabort=reject;});
    let missing='',version='';try{await loadProject(broken.id);}catch(e){missing=e.message;}try{await loadProject(future.id);}catch(e){version=e.message;}
    await new Promise(resolve=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').delete(broken.id);tx.objectStore('projects').delete(future.id);tx.oncomplete=resolve;});db.close();
    return {quota,before,after,missing,version};
  });assert.ok(failureChecks.quota.includes('storage is full'));assert.equal(failureChecks.before,failureChecks.after);assert.ok(failureChecks.missing.includes('Missing original'));assert.ok(failureChecks.version.includes('version'));check('Quota failure is atomic, missing stored assets and future project versions are rejected');

  const large = await page.evaluate(async () => {
    const {DocumentRenderer}=await import('./js/rendering/renderer.js');const {createDocument,createLayer}=await import('./js/model/document.js');const {createEffect}=await import('./js/model/effects.js');const {AssetStore}=await import('./js/storage/assets.js');
    const source=document.createElement('canvas');source.width=4000;source.height=3000;const ctx=source.getContext('2d');const gradient=ctx.createLinearGradient(0,0,4000,3000);gradient.addColorStop(0,'#eab396');gradient.addColorStop(1,'#224466');ctx.fillStyle=gradient;ctx.fillRect(0,0,4000,3000);
    const blob=await new Promise(resolve=>source.toBlob(resolve)),assets=new AssetStore(),asset=await assets.add(blob),doc=createDocument({width:4000,height:3000}),layer=createLayer('image',doc.canvas,{assetId:asset.id});layer.transform.width=4000;layer.transform.height=3000;layer.effects=[{...createEffect('dither'),intensity:1}];doc.layers=[layer];doc.assets=[asset];
    const renderer=new DocumentRenderer(),canvas=document.createElement('canvas'),start=performance.now();let responsive=false;setTimeout(()=>{responsive=true;},0);await renderer.renderDocument(doc,assets,canvas);const first=performance.now()-start;const previous=renderer.cache.get(layer.id).promise;layer.transform.x+=10;const move=performance.now();await renderer.renderDocument(doc,assets,canvas);const moved=performance.now()-move;const reused=renderer.cache.get(layer.id).promise===previous;
    assets.dispose();renderer.clear();return {firstMs:Math.round(first),moveMs:Math.round(moved),reused,responsive,width:canvas.width,height:canvas.height};
  });assert.ok(large.reused);assert.ok(large.responsive);assert.equal(large.width,4000);check('12-megapixel image dithering and cached movement',JSON.stringify(large));

  await checkFluentIcons();
  const unnamed = await page.locator('button').evaluateAll(buttons=>buttons.filter(b=>!b.textContent.trim()&&!b.getAttribute('aria-label')).length); assert.equal(unnamed,0);
  await page.setViewportSize({width:600,height:820}); await page.locator('[data-action=panels]').click();assert.ok(await page.locator('#inspector').isVisible()); await page.screenshot({path:resolve(output,'narrow.png')});
  check('Fluent SVG icons, accessible button names and narrow-screen panels');

  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
  const cdp=await context.newCDPSession(page);const manifest=await cdp.send('Page.getAppManifest');assert.equal(manifest.errors.length,0);const installability=await cdp.send('Page.getInstallabilityErrors');assert.deepEqual(installability.installabilityErrors,[]);check('Manifest and Chromium installability checks');
  await context.setOffline(true);await page.reload();await page.locator('#new-dialog').waitFor();await page.locator('#new-dialog [data-action=open]').click();await page.locator('[data-project]').first().click();await page.waitForFunction(()=>document.querySelector('#layer-count').textContent==='7');
  await checkFluentIcons();
  check('Offline launch, cached Fluent SVG icons and saved-project reopening');
  await context.setOffline(false);
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);check('No browser exceptions or failed HTTP resources');
  console.log(JSON.stringify({renderChecks,screenshots:output},null,2));
} catch (error) { await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{}); throw error; }
finally { await context.close(); }
