import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { documentPresetGroups } from '../js/model/document-presets.js';
import { checkSize } from '../js/model/document.js';
const presets = documentPresetGroups.flatMap(group => group.presets);
assert.equal(new Set(presets.map(preset => preset.id)).size, presets.length);
for (const preset of presets) { checkSize(preset.width, preset.height); checkSize(preset.height, preset.width); }
const { chromium } = await import(process.env.DITHER_PLAYWRIGHT_PATH ? pathToFileURL(resolve(process.env.DITHER_PLAYWRIGHT_PATH)).href : 'playwright');
const browser = await chromium.launch({ channel: process.env.DITHER_BROWSER || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.DITHER_URL || 'http://127.0.0.1:4173/');
  const form = page.locator('#new-form'), select = form.locator('[name=preset]');
  const width = form.locator('[name=width]'), height = form.locator('[name=height]');
  assert.equal(await select.inputValue(), 'landscape');
  assert.equal(await select.locator('optgroup').count(), 6);
  for (const preset of presets) {
    await select.selectOption(preset.id);
    assert.equal(await width.inputValue(), String(preset.width), preset.id);
    assert.equal(await height.inputValue(), String(preset.height), preset.id);
    assert.ok(await form.evaluate(el => el.checkValidity()));
  }
  await select.selectOption('a1'); assert.match(await page.locator('#preset-note').textContent(), /150 PPI/);
  await select.selectOption('a4');
  assert.equal(await width.inputValue(), '2480'); assert.equal(await height.inputValue(), '3508');
  await page.locator('#swap-dimensions').click();
  assert.equal(await width.inputValue(), '3508'); assert.equal(await height.inputValue(), '2480');
  assert.match(await page.locator('#preset-note').textContent(), /swapped/);
  await page.locator('#swap-dimensions').click(); assert.equal(await width.inputValue(), '2480');
  await width.fill('900'); assert.equal(await select.inputValue(), 'custom');
  assert.doesNotMatch(await page.locator('#preset-note').textContent(), /300 PPI/);
  await select.selectOption('a5');
  if (process.env.DITHER_SCREENSHOT) await page.screenshot({ path: process.env.DITHER_SCREENSHOT });
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await select.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.ok(await page.getByRole('button', { name: 'Create document' }).isVisible());
  await page.getByRole('button', { name: 'Create document' }).click();
  await page.locator('#new-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('#workspace').getAttribute('aria-busy') === 'false');
  assert.deepEqual(await page.locator('#stage').evaluate(el => [parseFloat(el.style.width), parseFloat(el.style.height)]), [1748, 2480]);
  assert.deepEqual(errors, []);
  console.log(`PASS ${presets.length} presets: canvas limits, grouping, dimensions, print hints, swap, custom size, mobile layout and document creation`);
} finally { await browser.close(); }
