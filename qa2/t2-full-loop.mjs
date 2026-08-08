// Test 3: full loop MENU -> AIM -> LAUNCH -> RUN -> RESULTS -> ЕЩЁ РАЗ -> AIM
import { launch, waitMenu, rendererInfo, URL, SHOT_DIR } from './common.mjs';

const { browser, page, consoleErrors, pageErrors, failedReqs } = await launch({ width: 1280, height: 720 });
const log = {};

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.waitForTimeout(1000);

// AudioContext state after gesture check later
// 1) TAP TO PLAY -> AIM (tap in lower 60% area, avoiding buttons)
await page.mouse.click(640, 420);
await page.waitForTimeout(800);
log.afterTap = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().state);
await page.screenshot({ path: SHOT_DIR + '03-aim.png' });

// 2) drag to pull: press at center, drag down, watch %
await page.mouse.move(640, 300);
await page.mouse.down();
for (let y = 300; y <= 640; y += 20) { await page.mouse.move(640, y); await page.waitForTimeout(40); }
await page.waitForTimeout(300);
log.pullDuringDrag = await page.evaluate(() => {
  const s = window.__THREE_GAME_TEST_HOOKS__.getState();
  const m = document.body.innerText.match(/(\d+)\s*%/);
  return { state: s.state, pullPower: s.pullPower, pctText: m ? m[1] : null };
});
await page.screenshot({ path: SHOT_DIR + '04-aim-pull.png' });
await page.mouse.up();
await page.waitForTimeout(600);
log.afterRelease = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().state);

// 3) wait for run, then sample HUD + draw calls mid-run
await page.waitForFunction(() => ['run'].includes(window.__THREE_GAME_TEST_HOOKS__.getState().state), null, { timeout: 15000 });
await page.waitForTimeout(2500);
log.runState = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState());
log.runDrawCalls = await rendererInfo(page);
await page.screenshot({ path: SHOT_DIR + '05-run-hud.png' });
log.audioCtx = await page.evaluate(() => {
  const d = window.__THREE_GAME_DIAGNOSTICS__;
  // try to find audio ctx state via game audio getter not exposed; check global AudioContext existence
  return { hasAC: typeof (window.AudioContext || window.webkitAudioContext) !== 'undefined' };
});

// 4) wait until results (crash or finish)
await page.waitForFunction(() => {
  const st = window.__THREE_GAME_TEST_HOOKS__.getState().state;
  return ['results', 'stopped', 'crash', 'finish'].includes(st);
}, null, { timeout: 90000 });
await page.waitForTimeout(2500);
log.endState = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState());
await page.screenshot({ path: SHOT_DIR + '06-results.png' });
log.resultsText = await page.evaluate(() => document.body.innerText.slice(0, 500));
log.resultsImgs = await page.evaluate(() => [...document.querySelectorAll('img')].filter(i => i.offsetWidth > 0).map(i => i.src.replace(location.origin, '')));

// 5) click ЕЩЁ РАЗ -> AIM
const again = page.locator('text=ЕЩЁ РАЗ').first();
if (await again.count()) {
  await again.click();
  await page.waitForTimeout(1000);
  log.afterAgain = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().state);
  await page.screenshot({ path: SHOT_DIR + '07-again-aim.png' });
} else {
  log.afterAgain = 'BUTTON NOT FOUND';
}

log.consoleErrors = consoleErrors; log.pageErrors = pageErrors; log.failedReqs = failedReqs;
console.log(JSON.stringify(log, null, 1));
await browser.close();
