// Audio: verify mp3 asset requests fire after gesture and decode without console errors
import { launch, waitMenu, URL } from './common.mjs';
const { browser, page, consoleErrors, pageErrors } = await launch({ width: 1280, height: 720 });
const audioReqs = [];
page.on('request', (r) => { if (/\.mp3/.test(r.url())) audioReqs.push(r.url().replace(URL, '/')); });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.waitForTimeout(1500);
await page.mouse.click(640, 420); // gesture -> aim, unlock
await page.waitForTimeout(1500);
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(1));
await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.getState().state === 'run', null, { timeout: 30000 });
await page.waitForTimeout(8000);
console.log(JSON.stringify({ audioReqs: [...new Set(audioReqs)], consoleErrors, pageErrors }, null, 1));
await browser.close();
