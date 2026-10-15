export async function editTextContent(page, content) {
  await page.locator('[data-text-action=edit]').click();
  const editor=page.locator('#text-editor textarea');
  await editor.fill(content);await editor.press('Control+Enter');
  await page.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')==='false');
}
