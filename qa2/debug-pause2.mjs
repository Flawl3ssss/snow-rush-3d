import { launch, waitMenu, URL, SHOT_DIR } from './common.mjs';
const { browser, page } = await launch({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.waitForTimeout(1200);
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(0.8));
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(700);
  const st = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.getState().state);
  console.log('t+' + (i * 0.7).toFixed(1) + 's state=' + st);
  if (st === 'run') break;
}
await page.keyboard.press('Escape');
await page.waitForTimeout(2000);
const info = await page.evaluate(() => {
  const state = window.__THREE_GAME_TEST_HOOKS__.getState().state;
  const pauseNode = [...document.querySelectorAll('*')].filter(e => e.children.length === 0).find(e => e.textContent.trim() === 'ПАУЗА');
  let chain = [];
  let n = pauseNode;
  while (n && chain.length < 9) {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    chain.push({ tag: n.tagName, cls: String(n.className).slice(0, 70), display: cs.display, vis: cs.visibility, op: cs.opacity, pe: cs.pointerEvents, rect: [r.x | 0, r.y | 0, r.width | 0, r.height | 0] });
    n = n.parentElement;
  }
  return { state, found: !!pauseNode, chain };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: SHOT_DIR + 'dbg-pause-kbd.png' });
await browser.close();
