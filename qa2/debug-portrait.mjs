import { launch, waitMenu, URL } from './common.mjs';
const { browser, page } = await launch({ width: 390, height: 844 });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.waitForTimeout(2500);
const r = await page.evaluate(() => {
  const out = {};
  const grab = (sel) => [...document.querySelectorAll(sel)].map(e => {
    const b = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { x: b.x | 0, y: b.y | 0, w: b.width | 0, h: b.height | 0, disp: cs.display, vis: cs.visibility };
  });
  out.diamondChipImgs = grab('img[src*="icon-diamond"]');
  out.gearBtns = grab('button:has(img[src*="icon-gear"])');
  out.topbar = grab('[class*="top"], [class*="Top"]');
  out.cards = grab('[class*="card"]');
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
