import { launch, waitMenu, URL, SHOT_DIR } from './common.mjs';
const { browser, page, consoleErrors, pageErrors } = await launch({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.locator('button:has(img[src*="icon-gear"]):visible').first().click();
await page.waitForTimeout(2500);
const toggles = await page.evaluate(() => {
  return [...document.querySelectorAll('.screen-settings :is(button,[role="switch"],input), [class*="settings"] :is(button,[role="switch"],input)')]
    .map(e => { const b = e.getBoundingClientRect(); return { cls: String(e.className).slice(0, 50), x: b.x | 0, y: b.y | 0, w: b.width | 0, h: b.height | 0 }; })
    .filter(t => t.w > 0);
});
console.log('toggle candidates:', JSON.stringify(toggles));
// click the first switch-like control right of МУЗЫКА row
const row = await page.evaluate(() => {
  const label = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'МУЗЫКА');
  if (!label) return null;
  const row = label.closest('div[class]');
  const sw = row.querySelector('button, [role="switch"], input');
  if (!sw) return null;
  const b = sw.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, cls: String(sw.className) };
});
console.log('music switch:', JSON.stringify(row));
if (row) {
  await page.mouse.click(row.x, row.y);
  await page.waitForTimeout(1500);
}
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('snowrush_save_v1')).settings);
await page.screenshot({ path: SHOT_DIR + '19-settings-toggled.png' });
console.log(JSON.stringify({ after, consoleErrors, pageErrors }));
await browser.close();
