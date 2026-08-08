// Test 1+2: LOADING -> MENU, errors, assets in DOM, canvas check
import { launch, waitMenu, canvasPixelCheck, rendererInfo, URL, SHOT_DIR } from './common.mjs';

const { browser, page, consoleErrors, pageErrors, failedReqs } = await launch({ width: 1280, height: 720 });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
// try to catch LOADING screen early
await page.waitForTimeout(400);
const loadingInfo = await page.evaluate(() => {
  const root = document.querySelector('#ui-root') || document.body;
  const imgs = [...document.querySelectorAll('img')].map(i => i.getAttribute('src'));
  const text = document.body.innerText.slice(0, 300);
  return { imgs, text, state: window.__THREE_GAME_TEST_HOOKS__?.getState?.().state };
});
await page.screenshot({ path: SHOT_DIR + '01-loading.png' });

await waitMenu(page);
await page.waitForTimeout(1500);
await page.screenshot({ path: SHOT_DIR + '02-menu.png' });

const menuInfo = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('#ui-root img, img')].map(i => ({ src: i.src.replace(location.origin, ''), visible: i.offsetWidth > 0 && i.offsetHeight > 0, w: i.offsetWidth }));
  const texts = document.body.innerText;
  const hooks = window.__THREE_GAME_TEST_HOOKS__.getState();
  return { imgCount: imgs.length, imgs, hooks, hasTapToPlay: /TAP TO PLAY/i.test(texts), level: /LEVEL/i.test(texts) };
});

const pix = await canvasPixelCheck(page);
const ri = await rendererInfo(page);

console.log(JSON.stringify({ loadingInfo, menuInfo: { imgCount: menuInfo.imgCount, visibleImgs: menuInfo.imgs.filter(i => i.visible), hooks: menuInfo.hooks, hasTapToPlay: menuInfo.hasTapToPlay, levelBadge: menuInfo.level }, pix, ri, consoleErrors, pageErrors, failedReqs }, null, 1));
await browser.close();
