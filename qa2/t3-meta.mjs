// Test 4: meta screens via real clicks + PAUSE + re-verify post-ЕЩЁ РАЗ aim camera
import { launch, waitMenu, URL, SHOT_DIR } from './common.mjs';

const { browser, page, consoleErrors, pageErrors, failedReqs } = await launch({ width: 1280, height: 720 });
const log = {};

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.waitForTimeout(1200);

async function snap(name) { await page.screenshot({ path: SHOT_DIR + name }); }
async function clickBtn(imgName) {
  const loc = page.locator(`button:has(img[src*="${imgName}"]):visible, [role="button"]:has(img[src*="${imgName}"]):visible`).first();
  if (await loc.count()) { await loc.click({ timeout: 5000 }); return; }
  await page.locator(`img[src*="${imgName}"]:visible`).first().click({ timeout: 5000 });
}

// TASKS
await clickBtn('icon-tasks');
await page.waitForTimeout(900);
await snap('08-tasks.png');
log.tasksText = (await page.evaluate(() => document.body.innerText)).slice(0, 600);
// close via X
await page.locator('button:has-text("✕"), button:has-text("×"), [aria-label*="close" i]').first().click().catch(() => page.keyboard.press('Escape'));
await page.waitForTimeout(600);

// CHEST
await clickBtn('icon-chest');
await page.waitForTimeout(900);
await snap('09-chest.png');
log.chestText = (await page.evaluate(() => document.body.innerText)).slice(0, 400);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// SHOP
await clickBtn('icon-shop');
await page.waitForTimeout(900);
await snap('10-shop.png');
log.shopText = (await page.evaluate(() => document.body.innerText)).slice(0, 500);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// SETTINGS via gear
await clickBtn('icon-gear');
await page.waitForTimeout(900);
await snap('11-settings.png');
log.settingsText = (await page.evaluate(() => document.body.innerText)).slice(0, 500);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Avatar stats panel
await clickBtn('menu-penguin');
await page.waitForTimeout(700);
await snap('12-stats.png');
log.statsText = (await page.evaluate(() => document.body.innerText)).slice(0, 300);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// Full loop again to verify post-ЕЩЁ РАЗ aim camera with long settle
await page.mouse.click(640, 420);
await page.waitForTimeout(600);
await page.mouse.move(640, 300); await page.mouse.down();
for (let y = 300; y <= 640; y += 30) { await page.mouse.move(640, y); await page.waitForTimeout(30); }
await page.mouse.up();
await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.getState().state === 'run', null, { timeout: 15000 });

// open PAUSE via gear in run
await page.waitForTimeout(1500);
await clickBtn('icon-gear');
await page.waitForTimeout(900);
log.pauseState = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().state);
await snap('13-pause.png');
log.pauseText = (await page.evaluate(() => document.body.innerText)).slice(0, 400);
// resume
await page.locator('button:has-text("ПРОДОЛЖИТЬ")').first().click().catch(() => page.keyboard.press('Escape'));
await page.waitForTimeout(800);
log.afterResume = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().state);

// wait results
await page.waitForFunction(() => ['results'].includes(window.__THREE_GAME_TEST_HOOKS__.getState().state), null, { timeout: 90000 });
await page.waitForTimeout(1500);
await snap('14-results-panel.png');
log.resultsText2 = (await page.evaluate(() => document.body.innerText)).slice(0, 400);

// ЕЩЁ РАЗ -> AIM, long settle then screenshot
await page.locator('text=ЕЩЁ РАЗ').first().click();
await page.waitForTimeout(3000);
log.afterAgain = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().state);
await snap('15-again-aim-settled.png');

log.consoleErrors = consoleErrors; log.pageErrors = pageErrors; log.failedReqs = failedReqs;
console.log(JSON.stringify(log, null, 1));
await browser.close();
