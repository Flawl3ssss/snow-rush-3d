// Test 6: mobile portrait 390x844 + landscape 844x390; Test 8: AudioContext unlock
import { launch, waitMenu, URL, SHOT_DIR } from './common.mjs';

async function scenario(viewport, tag) {
  const { browser, page, consoleErrors, pageErrors, failedReqs } = await launch(viewport);
  // instrument AudioContext creation
  await page.addInitScript(() => {
    window.__audioLog = { created: 0, states: [] };
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      window.AudioContext = class extends AC {
        constructor(...a) { super(...a); window.__audioLog.created++; window.__audioLog.states.push(this.state); this.addEventListener?.('statechange', () => window.__audioLog.states.push(this.state)); }
      };
    }
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitMenu(page);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT_DIR}${tag}-menu.png` });
  // TASKS overlay
  const tb = page.locator('button:has(img[src*="icon-tasks"]):visible').first();
  await tb.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT_DIR}${tag}-tasks.png` });
  const x = page.locator('button:has-text("✕"):visible').first();
  if (await x.count()) await x.click(); else await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  // audio: simulate first gesture (tap to play) and check AudioContext
  await page.mouse.click(viewport.width / 2, viewport.height * 0.55);
  await page.waitForTimeout(1200);
  const audio = await page.evaluate(() => window.__audioLog);
  // start run for HUD shot
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(0.9));
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.getState().state === 'run', null, { timeout: 30000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${SHOT_DIR}${tag}-run.png` });
  const hudCheck = await page.evaluate(() => {
    const t = document.body.innerText;
    return { hasKmh: /KM\/H/i.test(t), hasDist: /\d+m/.test(t), hasPct: /\d+%/.test(t) };
  });
  await browser.close();
  return { tag, audio, hudCheck, consoleErrors, pageErrors, failedReqs };
}

const r1 = await scenario({ width: 390, height: 844 }, 'm1-portrait');
console.log(JSON.stringify(r1, null, 1));
const r2 = await scenario({ width: 844, height: 390 }, 'm2-landscape');
console.log(JSON.stringify(r2, null, 1));
