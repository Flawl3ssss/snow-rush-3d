import { launch, waitMenu, URL, SHOT_DIR } from './common.mjs';
const { browser, page } = await launch({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.waitForTimeout(1200);
// start run via hooks for speed
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(0.8));
await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.getState().state === 'run', null, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.keyboard.press('Escape'); // try keyboard pause
await page.waitForTimeout(2000);
const info = await page.evaluate(() => {
  const state = window.__THREE_GAME_TEST_HOOKS__.getState().state;
  const pauseNode = [...document.querySelectorAll('*')].filter(e => e.children.length === 0).find(e => e.textContent.trim() === 'ПАУЗА');
  let chain = [];
  let n = pauseNode;
  while (n && chain.length < 9) {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    chain.push({ tag: n.tagName, cls: String(n.className).slice(0, 70), display: cs.display, vis: cs.visibility, op: cs.opacity, rect: [r.x | 0, r.y | 0, r.width | 0, r.height | 0] });
    n = n.parentElement;
  }
  return { state, chain };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: SHOT_DIR + 'dbg-pause-kbd.png' });
await browser.close();
