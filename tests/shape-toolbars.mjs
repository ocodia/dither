import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const {chromium}=await import(process.env.DITHER_PLAYWRIGHT_PATH?pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href:'playwright');
const browser=await chromium.launch({channel:process.env.DITHER_BROWSER||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const ready=()=>page.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');
const toolbar=page.locator('#tool-options');
const field=key=>toolbar.locator(`[data-path="shape.${key}"]`);
const count=()=>page.locator('[data-history-state]').count();
const key=async value=>{await page.locator('#workspace').focus();await page.keyboard.press(value);await ready();};
async function value(key,value){
  const control=field(key);
  if(await control.getAttribute('type')==='range'){
    await control.focus();await control.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},String(value));
    assert.equal(await control.locator('..').locator('output').count(),0);
  }else await control.fill(String(value));
  await control.press('Tab');await ready();
}
async function select(name){await page.locator(`.layer-select[title="Select ${name}"]`).click();await ready();}
try{
  await page.goto(process.env.DITHER_URL||'http://127.0.0.1:4173/');await page.locator('#new-dialog [data-close]').click();
  for(const [kind,size] of [['ellipse',5],['rectangle',6],['arrow',6],['line',3]]){
    await page.locator('[data-tool=eyedropper]').click();
    await page.locator(`[data-action=${kind}]`).click();await ready();
    assert.equal(await toolbar.getAttribute('aria-label'),`${kind[0].toUpperCase()+kind.slice(1)} options`);
    assert.equal(await toolbar.locator('[data-path^="shape."]').count(),size);
    assert.equal(await page.locator('#properties [data-path^="shape."]').count(),0);
    assert.ok(await page.locator('#properties [data-path="transform.width"]').isVisible());
    assert.equal(await page.locator('#properties [data-action=rasterise]').count(),0);
    assert.ok(await toolbar.locator('[data-action=rasterise]').isVisible());
    for(const slider of await toolbar.locator('input[data-path$="Opacity"]').all()){
      assert.equal(await slider.getAttribute('min'),'0');assert.equal(await slider.getAttribute('max'),'1');assert.equal(await slider.getAttribute('step'),'0.05');
    }
    assert.equal(await field('strokeWidth').getAttribute('type'),'range');
    assert.equal(await field('strokeWidth').getAttribute('min'),'1');assert.equal(await field('strokeWidth').getAttribute('max'),'100');assert.equal(await field('strokeWidth').getAttribute('step'),'1');
    await field('strokeWidth').focus();await field('strokeWidth').press('End');assert.equal(await field('strokeWidth').inputValue(),'100');
    await field('strokeWidth').press('Home');assert.equal(await field('strokeWidth').inputValue(),'1');await field('strokeWidth').press('Tab');
    await field('strokeOpacity').focus();await field('strokeOpacity').press('Home');await field('strokeOpacity').press('ArrowRight');
    assert.equal(await field('strokeOpacity').inputValue(),'0.05');
    await field('strokeOpacity').press('End');assert.equal(await field('strokeOpacity').inputValue(),'1');
    await field('strokeOpacity').press('Tab');await ready();
    const initial=await field('strokeWidth').inputValue(),before=await count();
    await value('strokeWidth',11);assert.equal(await count(),before+1);
    await key('Control+z');assert.equal(await field('strokeWidth').inputValue(),initial);
    await key('Control+Shift+z');assert.equal(await field('strokeWidth').inputValue(),'11');
    await value('stroke','#dd3355');await value('strokeOpacity',.4);
    if(kind==='ellipse'||kind==='rectangle'){
      await value('fill','#44aaff');await value('fillOpacity',.7);
      assert.equal(await toolbar.locator('[data-tool=gradient]').count(),1);
    }else assert.equal(await toolbar.locator('[data-tool=gradient]').count(),0);
    if(kind==='rectangle'){
      assert.equal(await field('radius').getAttribute('type'),'range');
      assert.equal(await field('radius').getAttribute('min'),'0');assert.equal(await field('radius').getAttribute('max'),'100');
      assert.equal(await field('radius').getAttribute('step'),'10');
      await value('radius',20);
    }
    if(kind==='arrow'){
      assert.equal(await field('arrowSize').getAttribute('type'),'range');
      assert.equal(await field('arrowSize').getAttribute('min'),'10');assert.equal(await field('arrowSize').getAttribute('max'),'500');
      await field('arrowSize').focus();await field('arrowSize').press('Home');assert.equal(await field('arrowSize').inputValue(),'10');
      await field('arrowSize').press('End');assert.equal(await field('arrowSize').inputValue(),'500');await field('arrowSize').press('Tab');
      await key('Control+s');await page.getByRole('status').filter({hasText:'Project saved'}).waitFor();
      const savedSize=await page.evaluate(async()=>{const {listProjects,loadProject}=await import('./js/storage/projects.js');const p=await loadProject((await listProjects())[0].id);const size=p.doc.layers.find(l=>l.shape.kind==='arrow').shape.arrowSize;p.assets.dispose();return size;});assert.equal(savedSize,500);
      await value('arrowSize',33);await field('startArrow').check();
      await key('Control+z');assert.equal(await field('startArrow').isChecked(),false);
      await key('Control+Shift+z');assert.equal(await field('startArrow').isChecked(),true);
    }
    await mkdir('.test-results',{recursive:true});await page.screenshot({path:`.test-results/${kind}-toolbar.png`});
  }
  assert.equal(await page.locator('#layer-count').textContent(),'4');
  await select('Rectangle');await page.locator('[data-tool=eyedropper]').click();await select('Rectangle');
  assert.equal(await toolbar.getAttribute('aria-label'),'Rectangle options');
  await page.locator('#properties [data-path=locked]').check();await page.locator('#properties [data-path=locked]').press('Tab');
  for(const input of await toolbar.locator('input,button').all())assert.ok(await input.isDisabled());
  await page.locator('#properties [data-path=locked]').uncheck();await page.locator('#properties [data-path=locked]').press('Tab');
  await page.locator('.layer-row.selected [data-layer-action=visibility]').click();assert.ok(await field('fill').isDisabled());
  await page.locator('.layer-row.selected [data-layer-action=visibility]').click();assert.ok(await field('fill').isEnabled());
  await toolbar.locator('[data-tool=gradient]').click();
  const stage=await page.locator('#stage').boundingBox();
  await page.mouse.move(stage.x+stage.width*.4,stage.y+stage.height*.4);await page.mouse.down();await page.mouse.move(stage.x+stage.width*.6,stage.y+stage.height*.6,{steps:5});await page.mouse.up();await ready();
  await select('Rectangle');assert.ok(await toolbar.locator('[data-tool-action=solid]').isVisible());
  await value('fill','#55bb77');assert.equal(await toolbar.locator('[data-tool-action=solid]').count(),0);
  await key('Control+z');assert.ok(await toolbar.locator('[data-tool-action=solid]').isVisible());
  await toolbar.locator('[data-tool-action=solid]').click();await ready();assert.equal(await toolbar.locator('[data-tool-action=solid]').count(),0);
  await select('Line');assert.equal(await page.locator('[data-endpoint]').count(),2);
  await key('Control+s');await page.getByRole('status').filter({hasText:'Project saved'}).waitFor();
  const shapes=await page.evaluate(async()=>{const {listProjects,loadProject}=await import('./js/storage/projects.js');const p=await loadProject((await listProjects())[0].id);const shapes=p.doc.layers.map(l=>l.shape);p.assets.dispose();return shapes;});
  for(const s of shapes){assert.equal(s.strokeWidth,11);assert.equal(s.stroke,'#dd3355');assert.equal(s.strokeOpacity,.4);}
  assert.equal(shapes.find(s=>s.kind==='rectangle').radius,20);assert.equal(shapes.find(s=>s.kind==='arrow').arrowSize,33);assert.equal(shapes.find(s=>s.kind==='arrow').startArrow,true);
  assert.equal(shapes.find(s=>s.kind==='ellipse').fill,'#44aaff');assert.equal(shapes.find(s=>s.kind==='ellipse').fillOpacity,.7);
  await select('Arrow');await page.setViewportSize({width:600,height:820});await ready();
  const box=await toolbar.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=600);
  await page.screenshot({path:'.test-results/arrow-toolbar-narrow.png'});
  await page.locator('[data-action=canvas]').click();assert.ok(await toolbar.isHidden());
  assert.deepEqual(errors,[]);
  console.log('PASS all four shape toolbars, live fields, undo/redo, selection, locks, visibility, gradients, endpoints, saved settings and narrow layout');
}finally{await browser.close();}
