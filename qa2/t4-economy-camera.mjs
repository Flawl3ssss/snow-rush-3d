// Test 5: upgrade purchase + persistence; Test: pause retake; post-ЕЩЁ РАЗ camera deep-check
import { launch, waitMenu, URL, SHOT_DIR } from './common.mjs';
const { browser, ctx, page, consoleErrors, pageErrors } = await launch({ width: 1280, height: 720 });
const log = {};

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.waitForTimeout(1500);

// --- purchase SLINGSHOT upgrade (cost 100, have 150) ---
log.before = await page.evaluate(() => { const s = window.__THREE_GAME_TEST_HOOKS__.getState(); return { coins: s.coins }; });
const buyBtn = page.locator('.upgrade-card:has-text("SLINGSHOT") button:visible, [class*=card]:has-text("SLINGSHOT") button:visible').first();
await buyBtn.click();
await page.waitForTimeout(1200);
log.afterBuy = await page.evaluate(() => {
  const s = window.__THREE_GAME_TEST_HOOKS__.getState();
  const save = JSON.parse(localStorage.getItem('snowrush_save_v1'));
  return { coins: s.coins, saveCoins: save.coins, saveUpgrades: save.upgrades };
});
await page.screenshot({ path: SHOT_DIR + '16-after-upgrade.png' });

// --- persistence: reload ---
await page.reload({ waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.waitForTimeout(1000);
log.afterReload = await page.evaluate(() => {
  const save = JSON.parse(localStorage.getItem('snowrush_save_v1'));
  return { coins: save.coins, upgrades: save.upgrades };
});

// --- full loop, pause retake with long wait ---
await page.mouse.click(640, 420);
await page.waitForTimeout(600);
await page.mouse.move(640, 300); await page.mouse.down();
for (let y = 300; y <= 640; y += 30) { await page.mouse.move(640, y); await page.waitForTimeout(30); }
await page.mouse.up();
await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.getState().state === 'run', null, { timeout: 15000 });
await page.waitForTimeout(1500);
await page.locator('button:has(img[src*="icon-gear"]):visible').first().click();
await page.waitForTimeout(2500);
log.pauseState = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().state);
await page.screenshot({ path: SHOT_DIR + '13-pause.png' });
// resume via Escape
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
log.afterEsc = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().state);

// wait results, click ЕЩЁ РАЗ, long settle, check camera + drag functionality
await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.getState().state === 'results', null, { timeout: 90000 });
await page.waitForTimeout(2000);
await page.locator('text=ЕЩЁ РАЗ').first().click();
await page.waitForTimeout(5000);
log.afterAgain5s = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().state);
await page.screenshot({ path: SHOT_DIR + '17-again-aim-5s.png' });
// try drag launch from this state
await page.mouse.move(640, 300); await page.mouse.down();
for (let y = 300; y <= 640; y += 30) { await page.mouse.move(640, y); await page.waitForTimeout(30); }
await page.mouse.up();
await page.waitForTimeout(1500);
log.dragFromAgain = await page.evaluate(() => { const s = window.__THREE_GAME_TEST_HOOKS__.getState(); return { state: s.state, speedKmh: s.speedKmh }; });
await page.waitForTimeout(3000);
log.run2 = await page.evaluate(() => { const s = window.__THREE_GAME_TEST_HOOKS__.getState(); return { state: s.state, distance: s.distance }; });
await page.screenshot({ path: SHOT_DIR + '18-run2.png' });

log.consoleErrors = consoleErrors; log.pageErrors = pageErrors;
console.log(JSON.stringify(log, null, 1));
await browser.close();
