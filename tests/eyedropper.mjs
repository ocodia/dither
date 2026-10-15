import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const {chromium}=await import(process.env.DITHER_PLAYWRIGHT_PATH?pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href:'playwright');
const browser=await chromium.launch({channel:process.env.DITHER_BROWSER||'msedge',headless:true});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');
async function copy(name,expected){
  await page.getByRole('button',{name,exact:true}).click();
  await page.waitForFunction(async expected=>(await navigator.clipboard.readText())===expected,expected);
}
try{
  await page.goto(process.env.DITHER_URL||'http://127.0.0.1:4173/');await page.locator('#new-dialog [data-close]').click();
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.locator('[data-tool=eyedropper]').click();
  assert.deepEqual(await page.locator('#tool-options label').allTextContents(),['Colour','HEX','RGB']);
  const hex=page.getByRole('textbox',{name:'HEX colour',exact:true}),rgb=page.getByRole('textbox',{name:'RGB colour',exact:true});
  assert.ok(await hex.evaluate(el=>el.readOnly));assert.ok(await rgb.evaluate(el=>el.readOnly));
  assert.equal(await hex.inputValue(),'#000000');assert.equal(await rgb.inputValue(),'rgb(0, 0, 0)');
  assert.equal(await page.locator('#tool-options [data-setting=background], #tool-options [data-setting=opacity]').count(),0);
  await copy('Copy HEX','#000000');await copy('Copy RGB','rgb(0, 0, 0)');
  await page.locator('[data-action=rectangle]').click();
  await page.locator('[data-path="shape.fill"]').fill('#336699');await page.locator('[data-path="shape.fill"]').press('Tab');await ready();
  await page.locator('[data-tool=eyedropper]').click();
  const stage=await page.locator('#stage').boundingBox();await page.mouse.click(stage.x+stage.width/2,stage.y+stage.height/2);
  await page.waitForFunction(()=>document.querySelector('#tool-options [data-setting=foreground]').value==='#336699');
  assert.equal(await hex.inputValue(),'#336699');assert.equal(await rgb.inputValue(),'rgb(51, 102, 153)');
  const history=await page.locator('[data-history-state]').count();
  await copy('Copy HEX','#336699');await copy('Copy RGB','rgb(51, 102, 153)');
  await page.locator('#tool-options [data-setting=foreground]').fill('#ff0080');
  assert.equal(await hex.inputValue(),'#ff0080');assert.equal(await rgb.inputValue(),'rgb(255, 0, 128)');
  await copy('Copy RGB','rgb(255, 0, 128)');await copy('Copy HEX','#ff0080');
  assert.equal(await page.locator('[data-history-state]').count(),history);
  await mkdir('.test-results',{recursive:true});await page.screenshot({path:'.test-results/eyedropper-toolbar.png'});
  await page.setViewportSize({width:390,height:820});await ready();
  const toolbar=await page.locator('#tool-options').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(toolbar.scroll<=toolbar.width+1);
  await page.screenshot({path:'.test-results/eyedropper-toolbar-narrow.png'});
  await page.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw new Error('Denied');}}));
  await page.getByRole('button',{name:'Copy HEX',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Could not copy colour to the clipboard.'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS Eyedropper HEX/RGB clipboard formats, sampled/manual colours, no-layer copy, unchanged history and denied clipboard handling');
}finally{await browser.close();}
