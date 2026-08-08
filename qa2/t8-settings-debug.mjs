import { launch, waitMenu, URL, SHOT_DIR } from './common.mjs';
const { browser, ctx, page, consoleErrors, pageErrors } = await launch({ width: 1280, height: 720 });
// debug gating: no flag -> no lil-gui
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
const guiNoFlag = await page.locator('.lil-gui').count();
// open settings, toggle MUSIC off
await page.locator('button:has(img[src*="icon-gear"]):visible').first().click();
await page.waitForTimeout(2500);
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('snowrush_save_v1')).settings);
// click first toggle row (МУЗЫКА)
await page.locator('text=МУЗЫКА').first().click();
await page.waitForTimeout(1200);
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('snowrush_save_v1')).settings);
await page.screenshot({ path: SHOT_DIR + '19-settings-toggled.png' });
// reload -> persistence
await page.reload({ waitUntil: 'domcontentloaded' });
await waitMenu(page);
const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('snowrush_save_v1')).settings);
// debug flag page
const p2 = await ctx.newPage();
await p2.goto(URL + '?debug=1', { waitUntil: 'domcontentloaded' });
await p2.waitForTimeout(6000);
const guiFlag = await p2.locator('.lil-gui').count();
console.log(JSON.stringify({ guiNoFlag, guiFlag, before, after, afterReload, consoleErrors, pageErrors }, null, 1));
await browser.close();
