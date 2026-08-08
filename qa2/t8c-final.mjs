import { launch, waitMenu, URL, SHOT_DIR } from './common.mjs';
const { browser, page } = await launch({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.waitForTimeout(1500);
// tasks via coordinate click (left column 2nd button)
const tb = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(b => b.querySelector('img[src*="icon-tasks"]') && b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().x < 200);
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(tb.x, tb.y);
await page.waitForTimeout(3000);
await page.screenshot({ path: SHOT_DIR + '08-tasks.png' });
await page.locator('button.panel-close:visible, button:has-text("✕"):visible').first().click().catch(() => {});
await page.waitForTimeout(1000);

// settings toggle visual state after click
await page.locator('button:has(img[src*="icon-gear"]):visible').first().click();
await page.waitForTimeout(3000);
const beforeCls = await page.evaluate(() => document.querySelector('.toggle')?.className);
await page.mouse.click(783, 223);
await page.waitForTimeout(2500);
const afterCls = await page.evaluate(() => document.querySelector('.toggle')?.className);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('snowrush_save_v1')).settings);
await page.screenshot({ path: SHOT_DIR + '19-settings-toggled.png' });
console.log(JSON.stringify({ beforeCls, afterCls, saved }));
await browser.close();
