import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.DITHER_PLAYWRIGHT_PATH ? pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href : 'playwright');
const browser = await chromium.launch({ channel: process.env.DITHER_BROWSER || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const ready = () => page.waitForFunction(() => document.querySelector('#workspace').getAttribute('aria-busy') === 'false');
const dimensions = () => page.locator('#stage').evaluate(el => [parseFloat(el.style.width), parseFloat(el.style.height)]);
async function image(width, height, type = 'image/png') {
  const data = await page.evaluate(({ width, height, type }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, width, height);
    return canvas.toDataURL(type).split(',')[1];
  }, { width, height, type });
  return { name: `Picture.${type.split('/')[1]}`, mimeType: type, buffer: Buffer.from(data, 'base64') };
}
async function openDialog() {
  await page.locator('#workspace').focus(); await page.keyboard.press('Control+o');
  await page.locator('#open-dialog').waitFor({ state: 'visible' });
}
try {
  await page.goto(process.env.DITHER_URL || 'http://127.0.0.1:4173/');
  await page.locator('#new-dialog [data-action=open]').click();
  // The visible button opens the native picker; cancelling leaves the document alone.
  const [picker] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open image from disk' }).click()]);
  await picker.setFiles([]);
  assert.deepEqual(await dimensions(), [1600, 1000]);
  const png = await image(347, 219);
  await page.locator('#open-image-input').setInputFiles(png);
  await page.locator('#open-dialog').waitFor({ state: 'hidden' }); await ready();
  assert.deepEqual(await dimensions(), [347, 219]);
  assert.equal(await page.locator('#layer-count').textContent(), '1');
  for (const [path, value] of Object.entries({ width:347, height:219, x:173.5, y:109.5 }))
    assert.equal(await page.locator(`[data-path="transform.${path}"]`).inputValue(), String(value));
  // Save/reload validates metadata, original pixels and the full-size layer.
  await page.locator('#workspace').focus(); await page.keyboard.press('Control+s');
  await page.locator('#toast').filter({ hasText: 'Project saved' }).waitFor();
  const saved = await page.evaluate(async () => {
    const { listProjects, loadProject } = await import('./js/storage/projects.js');
    const project = await loadProject((await listProjects())[0].id);
    const bitmap = project.assets.images.get(project.doc.layers[0].assetId);
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const pixel = [...canvas.getContext('2d').getImageData(0,0,1,1).data];
    project.assets.dispose(); return { doc: project.doc, pixel };
  });
  assert.deepEqual(saved.pixel, [255,0,0,255]); assert.equal(saved.doc.name, 'Picture');
  assert.deepEqual([saved.doc.canvas.width, saved.doc.canvas.height], [347,219]);
  // Import still fits inside the existing canvas without resizing it.
  await page.locator('#image-input').setInputFiles(await image(700, 900)); await ready();
  await page.waitForFunction(() => document.querySelector('#layer-count').textContent === '2');
  assert.deepEqual(await dimensions(), [347,219]);
  await openDialog();
  let prompted = false;
  page.once('dialog', async dialog => { prompted = true; await dialog.dismiss(); });
  await page.locator('#open-image-input').setInputFiles(png);
  await page.waitForFunction(() => document.querySelector('#open-image-input').value === '');
  await page.waitForTimeout(200);
  assert.ok(prompted); assert.equal(await page.locator('#layer-count').textContent(), '2');
  // Broken and oversized files leave the existing document intact.
  await page.locator('#open-image-input').setInputFiles({ name:'broken.png', mimeType:'image/png', buffer:Buffer.from('bad image') });
  await page.locator('#toast').filter({ hasText: 'could not be decoded' }).waitFor();
  await page.locator('#open-image-input').setInputFiles(await image(8193, 1));
  await page.locator('#toast').filter({ hasText: 'whole dimensions' }).waitFor();
  assert.deepEqual(await dimensions(), [347,219]);
  assert.equal(await page.locator('#layer-count').textContent(), '2');
  for (const type of ['image/jpeg', 'image/webp']) {
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#open-image-input').setInputFiles(await image(123, 456, type));
    await page.locator('#open-dialog').waitFor({ state:'hidden' }); await ready();
    assert.deepEqual(await dimensions(), [123,456]);
    assert.equal(await page.locator('#layer-count').textContent(), '1');
    await openDialog();
  }
  await page.setViewportSize({ width:390, height:844 });
  const bounds = await page.getByRole('button', { name:'Open image from disk' }).boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.deepEqual(errors, []);
  console.log('PASS open image: native picker, cancellation, exact dimensions, full-size layer, save/reload, import, unsaved changes, invalid files, PNG/JPEG/WebP and mobile layout');
} finally { await browser.close(); }
