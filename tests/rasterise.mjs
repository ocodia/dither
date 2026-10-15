import { editTextContent } from './text-helpers.js';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.DITHER_PLAYWRIGHT_PATH ? pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href : 'playwright');
const browser = await chromium.launch({ channel: process.env.DITHER_BROWSER || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width:1280, height:900 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
const ready = () => page.waitForFunction(() => document.querySelector('#workspace').getAttribute('aria-busy') === 'false');
async function key(value) { await page.locator('#workspace').focus(); await page.keyboard.press(value); await ready(); }
try {
  await page.goto(process.env.DITHER_URL || 'http://127.0.0.1:4173/');
  await page.locator('#new-dialog [data-close]').click();
  const checks = await page.evaluate(async () => {
    const { DocumentRenderer } = await import('./js/rendering/renderer.js');
    const { createDocument, createLayer, validateDocument } = await import('./js/model/document.js');
    const { createEffect } = await import('./js/model/effects.js');
    const { AssetStore } = await import('./js/storage/assets.js');
    const results = [];
    for (const kind of ['rectangle', 'ellipse', 'line', 'arrow', 'text']) {
      const doc = createDocument({ width:400, height:400 }), assets = new AssetStore(), renderer = new DocumentRenderer();
      const layer = createLayer(kind === 'text' ? 'text' : 'shape', doc.canvas);
      if (kind === 'text') Object.assign(layer.text, { content:'Rasterise text', fontFamily:'Noto Sans', fontStyle:'italic', fontSize:25, letterSpacing:.5 });
      else layer.shape.kind = kind;
      if (layer.shape) Object.assign(layer.shape, { strokeWidth:12, strokeOpacity:.7, fillOpacity:.6, arrowSize:35, startArrow:true, endArrow:true });
      Object.assign(layer.transform, { width:120.3, height:85.7, rotation:37, flipX:true, flipY:true }); layer.opacity = .65;
      layer.effects = [{ ...createEffect('drop-shadow'), enabled:true, blur:4, offsetX:15, offsetY:-7 }, { ...createEffect('stroke'), enabled:true, width:3 }];
      doc.layers = [layer];
      const before = document.createElement('canvas'); await renderer.renderDocument(doc, assets, before);
      const { blob, transform } = await renderer.rasteriseLayer(layer, assets);
      const meta = await assets.add(blob); doc.assets.push(meta);
      const image = { ...layer, type:'image', assetId:meta.id, transform, effects:[] }; delete image.shape; delete image.text; doc.layers = [image]; validateDocument(doc);
      const after = document.createElement('canvas'); await renderer.renderDocument(doc, assets, after);
      const a = before.getContext('2d').getImageData(0,0,400,400).data, b = after.getContext('2d').getImageData(0,0,400,400).data;
      // Ignore RGB noise in almost-transparent edge pixels from PNG premultiplication.
      let maxAlpha = 0, maxColour = 0;
      for (let i=0;i<a.length;i+=4) { maxAlpha=Math.max(maxAlpha,Math.abs(a[i+3]-b[i+3])); if(a[i+3]>30 && b[i+3]>30) for(let c=0;c<3;c++) maxColour=Math.max(maxColour,Math.abs(a[i+c]-b[i+c])); }
      results.push({kind,maxAlpha,maxColour}); assets.dispose();
    }
    return results;
  });
  for (const check of checks) { assert.ok(check.maxAlpha <= 2, JSON.stringify(check)); assert.ok(check.maxColour <= 8, JSON.stringify(check)); }
  console.log('PASS raster pixel appearance with fractional sizes, rotation, flips, opacity, strokes, arrowheads and effects', checks);
  for (const kind of ['rectangle', 'ellipse', 'line', 'arrow', 'text']) {
    await page.locator(`[data-action=${kind}]`).click();
    assert.equal(await page.locator('#properties .property-action-buttons, #properties [data-action=rasterise]').count(),0);
    assert.ok(await page.locator('#tool-options [data-action=rasterise]').isVisible());
    if (kind === 'text') {
      await page.locator('[data-path="text.fontFamily"]').selectOption('Inter');
      await editTextContent(page,'Editable after undo');
    }
    await page.locator('[data-path=locked]').check(); await page.locator('[data-path=locked]').press('Tab');
    assert.ok(await page.locator('[data-action=rasterise]').isDisabled());
    await page.locator('[data-path=locked]').uncheck(); await page.locator('[data-path=locked]').press('Tab');
    await page.locator('[data-action=rasterise]').click();
    await page.locator('.layer-row.selected .layer-thumb use[href="./icons/ui.svg#image"]').waitFor({state:'attached'}); await ready();
    assert.equal(await page.locator('[data-action=rasterise]').count(),0);
    await key('Control+z'); assert.ok(await page.locator('[data-action=rasterise]').isVisible());
    if (kind === 'text') { await page.locator('[data-text-action=edit]').click(); assert.equal(await page.locator('#text-editor textarea').inputValue(),'Editable after undo'); await page.locator('#text-editor textarea').press('Control+Enter'); assert.equal(await page.locator('[data-path="text.fontFamily"]').inputValue(),'Inter'); }
    await key('Control+Shift+z'); await page.locator('.layer-row.selected .layer-thumb use[href="./icons/ui.svg#image"]').waitFor({state:'attached'});
  }
  assert.equal(await page.locator('#layer-count').textContent(),'5');
  await key('Control+s'); await page.getByRole('status').filter({hasText:'Project saved'}).waitFor();
  const saved = await page.evaluate(async () => {
    const {listProjects,loadProject}=await import('./js/storage/projects.js');
    const loaded=await loadProject((await listProjects())[0].id);
    const result={names:loaded.doc.layers.map(l=>l.name),types:loaded.doc.layers.map(l=>l.type),assets:loaded.assets.images.size}; loaded.assets.dispose(); return result;
  });
  assert.deepEqual(saved.names,['Rectangle','Ellipse','Line','Arrow','Text']); assert.deepEqual(saved.types,['image','image','image','image','image']); assert.equal(saved.assets,5);
  console.log('PASS shape and text buttons, locked layers, undo/redo, layer order and saved image assets');
  await page.locator('[data-action=rectangle]').click();
  await page.evaluate(async () => {
    const {DocumentRenderer}=await import('./js/rendering/renderer.js'); const original=DocumentRenderer.prototype.rasteriseLayer;
    DocumentRenderer.prototype.rasteriseLayer=async function(...args) { DocumentRenderer.prototype.rasteriseLayer=original; await new Promise(resolve=>window.releaseRasterise=resolve); return original.apply(this,args); };
  });
  await page.locator('[data-action=rasterise]').click();
  const name=page.locator('[data-path=name]'); await name.fill('Changed while rasterising'); await name.press('Tab');
  await page.evaluate(()=>window.releaseRasterise());
  await page.getByRole('status').filter({hasText:'layer changed while rasterising'}).waitFor();
  assert.ok(await page.locator('[data-action=rasterise]').isEnabled());
  assert.equal(await page.locator('.layer-row.selected .layer-thumb use[href="./icons/ui.svg#image"]').count(),0);
  console.log('PASS stale conversion cancellation');
  await key('p');
  const stage=await page.locator('#stage').boundingBox();
  for(const [x,y] of [[.3,.4],[.65,.4],[.5,.65]]){await page.mouse.click(stage.x+stage.width*x,stage.y+stage.height*y);await ready();}
  await key('Enter');
  await page.locator('.layer-row.selected .layer-select').click();await ready();
  const toolbar=page.locator('#tool-options');
  assert.equal(await toolbar.getAttribute('aria-label'),'Path options');
  assert.equal(await page.locator('#properties .property-action-buttons, #properties [data-tool=pen], #properties [data-tool=gradient]').count(),0);
  assert.ok(await toolbar.getByRole('button',{name:'Edit path',exact:true}).isVisible());
  assert.equal(await toolbar.getByRole('button',{name:'Gradient fill',exact:true}).count(),0);
  await toolbar.getByRole('button',{name:'Edit path',exact:true}).click();
  assert.equal(await toolbar.getByRole('button',{name:'Edit path',exact:true}).count(),0);
  assert.equal(await page.locator('[data-anchor-handle=point]').count(),3);
  await toolbar.locator('[data-tool-action=close-shape]').click();await key('v');
  await toolbar.getByRole('button',{name:'Gradient fill',exact:true}).click();
  assert.equal(await toolbar.getByRole('button',{name:'Gradient fill',exact:true}).count(),0);
  await page.mouse.move(stage.x+stage.width*.35,stage.y+stage.height*.45);await page.mouse.down();await page.mouse.move(stage.x+stage.width*.6,stage.y+stage.height*.6,{steps:5});await page.mouse.up();await ready();
  await key('v');await toolbar.getByRole('button',{name:'Solid fill',exact:true}).click();await ready();
  await key('Control+z');assert.ok(await toolbar.getByRole('button',{name:'Solid fill',exact:true}).isVisible());
  await toolbar.locator('[data-action=rasterise]').click();
  await page.locator('.layer-row.selected .layer-thumb use[href="./icons/ui.svg#image"]').waitFor({state:'attached'});await ready();
  assert.equal(await toolbar.locator('[data-action=rasterise]').count(),0);
  await key('Control+z');assert.ok(await toolbar.locator('[data-action=rasterise]').isVisible());
  assert.ok(await toolbar.getByRole('button',{name:'Solid fill',exact:true}).isVisible());
  console.log('PASS contextual path actions: anchors, closed-path gradients, solid fill, rasterise and undo');
  assert.deepEqual(errors,[]);
} finally { await browser.close(); }
