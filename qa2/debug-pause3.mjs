import { launch, waitMenu, URL, SHOT_DIR } from './common.mjs';
const { browser, page } = await launch({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.waitForTimeout(1200);
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(0.8));
await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.getState().state === 'run', null, { timeout: 20000 });
await page.keyboard.press('Escape');
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(1000);
  const op = await page.evaluate(() => {
    const s = document.querySelector('.screen-pause');
    return s ? getComputedStyle(s).opacity : 'none';
  });
  console.log(`pause screen opacity at +${i + 1}s: ${op}`);
}
await page.screenshot({ path: SHOT_DIR + 'dbg-pause-6s.png' });
// also measure FPS
const fps = await page.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now();
  function f() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }
  requestAnimationFrame(f);
}));
console.log('FPS(headless swiftshader):', fps);
await browser.close();
