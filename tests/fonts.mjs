import { editTextContent } from './text-helpers.js';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.DITHER_PLAYWRIGHT_PATH ? pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href : 'playwright');
const browser = await chromium.launch({ channel: process.env.DITHER_BROWSER || 'msedge', headless: true });
const context = await browser.newContext(), page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const ready = () => page.waitForFunction(() => document.querySelector('#workspace').getAttribute('aria-busy') === 'false');
try {
  await page.goto(process.env.DITHER_URL || 'http://127.0.0.1:4173/');
  await page.locator('#new-dialog [data-close]').click();
  await page.evaluate(() => document.fonts.ready);
  assert.ok(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Inter' && font.weight === '400' && font.status === 'loaded')));
  const cdp = await context.newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const {root} = await cdp.send('DOM.getDocument');
  const {nodeId} = await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'[data-tab=properties]'});
  const {fonts} = await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
  assert.ok(fonts.some(font => font.familyName.startsWith('Inter') && font.isCustomFont));
  await page.locator('[data-action=text]').click();
  const options=await page.locator('[data-path="text.fontFamily"] option').allTextContents();
  for(const family of ['Inter','Noto Sans','Noto Emoji','Arial']) assert.ok(options.includes(family));
  const firstRender = await page.evaluate(async () => {
    const {DocumentRenderer}=await import('./js/rendering/renderer.js');
    const {createDocument,createLayer}=await import('./js/model/document.js');
    const {AssetStore}=await import('./js/storage/assets.js');
    const doc=createDocument({width:500,height:240}), layer=createLayer('text',doc.canvas);
    Object.assign(layer.text,{fontFamily:'Inter',fontWeight:'900',fontStyle:'italic',content:'First render'});doc.layers=[layer];
    const assets=new AssetStore(),canvas=document.createElement('canvas'),renderer=new DocumentRenderer();
    await renderer.renderDocument(doc,assets,canvas);const first=canvas.toDataURL();
    const loaded=[...document.fonts].some(font=>font.family==='Inter'&&font.weight==='900'&&font.style==='italic'&&font.status==='loaded');
    renderer.clear(); await renderer.renderDocument(doc,assets,canvas);assets.dispose();return {loaded,same:first===canvas.toDataURL()};
  });
  assert.deepEqual(firstRender,{loaded:true,same:true});
  for(const family of ['Inter','Noto Sans','Noto Emoji']) {
    await page.locator('[data-path="text.fontFamily"]').selectOption(family); await editTextContent(page,'Hello ☀ ★ 😀'); await ready();
    assert.ok(await page.evaluate(family=>[...document.fonts].some(font=>font.family===family&&font.status==='loaded'),family));
  }
  await page.locator('#workspace').focus();await page.keyboard.press('Control+s');await page.getByRole('status').filter({hasText:'Project saved'}).waitFor();
  const savedFont=await page.evaluate(async()=>{const {listProjects,loadProject}=await import('./js/storage/projects.js');const saved=await loadProject((await listProjects())[0].id);saved.assets.dispose();return saved.doc.layers[0].text.fontFamily;});assert.equal(savedFont,'Noto Emoji');
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);await page.reload();await page.evaluate(()=>document.fonts.ready);
  const offline=await page.evaluate(async()=>{
    const faces=[];
    for(const weight of [400,500,600,700,900]) for(const style of ['normal','italic']) faces.push(await document.fonts.load(`${style} ${weight} 20px Inter`,'Offline'));
    for(const weight of [400,500,700,900]) for(const style of ['normal','italic']) faces.push(await document.fonts.load(`${style} ${weight} 20px "Noto Sans"`,'Offline text'));
    for(const weight of [400,500,700]) faces.push(await document.fonts.load(`${weight} 20px "Noto Emoji"`,'😀'));
    return faces.every(loaded=>loaded.length>0&&loaded.every(font=>font.status==='loaded'));
  });assert.ok(offline);
  assert.deepEqual(errors,[]);
  console.log('PASS actual Inter UI rendering, text options, cold canvas font loading, saved font selection and all bundled faces offline');
} finally { await browser.close(); }
