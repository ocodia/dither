import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.DITHER_PLAYWRIGHT_PATH ? pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href : 'playwright');
const browser = await chromium.launch({ channel: process.env.DITHER_BROWSER || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.accept());
const menu = page.getByRole('menu', { name: 'Context actions' });
const option = name => menu.getByRole('menuitem', { name, exact: true });
const row = name => page.locator('.layer-row').filter({ has: page.locator('.layer-name', { hasText: new RegExp(`^${name}$`) }) });
const ready = () => page.waitForFunction(() => document.querySelector('#workspace').getAttribute('aria-busy') === 'false');
const key = async value => { await page.locator('#workspace').focus(); await page.keyboard.press(value); await ready(); };
try {
  await page.goto(process.env.DITHER_URL || 'http://127.0.0.1:4173/');
  await page.locator('#new-dialog [data-close]').click();
  await page.locator('[data-action=rectangle]').click();
  await page.locator('[data-action=text]').click();
  await row('Rectangle').click({ button: 'right' });
  assert.ok(await row('Rectangle').evaluate(el => el.classList.contains('selected')));
  assert.ok(await option('Paste layer').isDisabled());
  await option('Copy layer').click();
  await row('Rectangle').click({ button: 'right' });
  await option('Paste layer').click();
  assert.equal(await page.locator('#layer-count').textContent(), '3');
  await key('Control+z'); assert.equal(await page.locator('#layer-count').textContent(), '2');
  await key('Control+Shift+z'); assert.equal(await page.locator('#layer-count').textContent(), '3');
  await row('Rectangle').click({ button: 'right' }); await option('Rasterise').click();
  await page.locator('.layer-row.selected .layer-thumb use[href="./icons/ui.svg#image"]').waitFor({state:'attached'}); await ready();
  await row('Rectangle').click({ button: 'right' }); assert.equal(await option('Rasterise').count(), 0);
  await option('Lock layer').click();
  await row('Rectangle').click({ button: 'right' });
  for (const name of ['Duplicate layer', 'Delete layer', 'Bring forward', 'Send backward']) assert.ok(await option(name).isDisabled());
  assert.ok(await option('Copy layer').isEnabled());
  await option('Unlock layer').click();
  await row('Text').click({ button: 'right' }); await option('Hide layer').click();
  await row('Text').click({ button: 'right' }); assert.ok(await option('Show layer').isEnabled());
  await page.keyboard.press('Escape'); assert.ok(await menu.isHidden());
  assert.ok(await row('Text').evaluate(el => el.classList.contains('selected')));
  await row('Rectangle copy').locator('.layer-select').focus();
  await page.keyboard.press('Shift+F10'); assert.ok(await menu.isVisible());
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#layer-count').textContent(), '4');
  // The canvas chooses the layer under the pointer, even if another row was selected.
  await ready();
  const bounds = await page.locator('#stage').boundingBox();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { button: 'right' });
  assert.ok(await option('Duplicate layer').isVisible());
  await option('Duplicate layer').click(); assert.equal(await page.locator('#layer-count').textContent(), '5');
  await page.locator('#workspace').click({ button: 'right', position: { x: 8, y: 8 } });
  assert.ok(await option('Fit canvas').isVisible());
  await page.locator('[data-action=text]').click(); assert.ok(await menu.isHidden());
  // Clamp the menu at the bottom-right of the viewport.
  await row('Text').first().dispatchEvent('contextmenu', { clientX: 1278, clientY: 898 });
  const box = await menu.boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 900);
  await page.keyboard.press('Escape');
  // An image clipboard keeps its source blob when replacing the document.
  await row('Rectangle').click({ button: 'right' }); await option('Copy layer').click();
  await page.locator('.document-menu-toggle').click(); await page.locator('[data-action=new]').click();
  await page.getByRole('button', { name: 'Create document' }).click();
  await page.locator('#workspace').click({ button: 'right', position: { x: 8, y: 8 } });
  await option('Paste layer').click(); await page.locator('.layer-row.selected .layer-thumb use[href="./icons/ui.svg#image"]').waitFor({state:'attached'}); await ready();
  assert.equal(await page.locator('#layer-count').textContent(), '1');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await key('Control+c');
  await page.waitForFunction(async () => (await navigator.clipboard.readText()).startsWith('Dither layer '));
  await key('Control+v');
  assert.equal(await page.locator('#layer-count').textContent(), '2');
  await row('Rectangle copy copy').click({ button: 'right' });
  if (process.env.DITHER_SCREENSHOT) await page.screenshot({ path: process.env.DITHER_SCREENSHOT });
  await page.keyboard.press('Delete'); assert.equal(await page.locator('#layer-count').textContent(), '2');
  await page.keyboard.press('Escape');
  // Menu creation uses the original document point, including after zoom/pan,
  // rather than the pointer's later position over the menu item.
  await page.locator('[data-action=zoom-in]').click();
  const area = await page.locator('#workspace').boundingBox();
  await page.mouse.move(area.x + 40, area.y + 40);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(area.x + 70, area.y + 60);
  await page.mouse.up({ button: 'middle' });
  for (const [label, x, y] of [['Add rectangle', 240, 220], ['Add text', 1200, 750]]) {
    const canvas = await page.locator('#stage').boundingBox();
    const dimensions = await page.locator('#stage').evaluate(el => [parseFloat(el.style.width), parseFloat(el.style.height)]);
    await page.mouse.click(canvas.x + x * canvas.width / dimensions[0], canvas.y + y * canvas.height / dimensions[1], { button: 'right' });
    await option(label).click();
    const actualX = Number(await page.locator('[data-path="transform.x"]').inputValue());
    const actualY = Number(await page.locator('[data-path="transform.y"]').inputValue());
    assert.ok(Math.abs(actualX - x) < 2, `${label}: x ${actualX}`);
    assert.ok(Math.abs(actualY - y) < 2, `${label}: y ${actualY}`);
    await key('Control+z');
  }
  assert.deepEqual(errors, []);
  console.log('PASS context menus: targeting, clipboard, rasterise, locks, history, keyboard, dismissal, viewport bounds and cross-document image paste');
} finally { await browser.close(); }
