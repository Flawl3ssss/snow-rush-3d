import { launch, waitMenu, URL, SHOT_DIR } from './common.mjs';
const { browser, page } = await launch({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.waitForTimeout(1200);

// find the tasks screen root & its state before click
const before = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find(d => d.textContent.includes('ОБНОВЛЕНИЕ ЧЕРЕЗ') && d.querySelector('.panel, [class*=panel]'));
  return { found: !!el };
});
// click tasks button (left column, second item). Inspect candidates:
const cands = await page.evaluate(() => {
  return [...document.querySelectorAll('button')].map(b => {
    const r = b.getBoundingClientRect();
    const img = b.querySelector('img');
    return { cls: b.className, img: img ? img.src.split('/').pop() : null, x: r.x, y: r.y, w: r.width, visible: r.width > 0 && getComputedStyle(b).visibility !== 'hidden' && getComputedStyle(b).display !== 'none' };
  }).filter(b => b.visible);
});
console.log('visible buttons:', JSON.stringify(cands.filter(b => b.x < 200), null, 1));

// click the visible tasks button by coordinates (left col ~x=52,y=190 based on screenshot)
const tasksBtn = cands.find(b => b.img === 'icon-tasks.png' && b.x < 200);
if (tasksBtn) await page.mouse.click(tasksBtn.x + 10, tasksBtn.y + 10);
await page.waitForTimeout(300);
await page.screenshot({ path: SHOT_DIR + 'dbg-tasks-300ms.png' });
await page.waitForTimeout(1200);
await page.screenshot({ path: SHOT_DIR + 'dbg-tasks-1500ms.png' });
const dom = await page.evaluate(() => {
  const screens = [...document.querySelectorAll('#ui-root > *, #ui-root *')].filter(e => e.children.length === 0 && /ЗАДАНИЯ/.test(e.textContent));
  const panel = [...document.querySelectorAll('*')].filter(e => e.children.length === 0).find(e => e.textContent.trim() === 'ЗАДАНИЯ');
  let chain = [];
  let n = panel;
  while (n && chain.length < 8) {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    chain.push({ tag: n.tagName, cls: String(n.className).slice(0, 60), display: cs.display, vis: cs.visibility, op: cs.opacity, z: cs.zIndex, rect: [r.x | 0, r.y | 0, r.width | 0, r.height | 0], transform: cs.transform.slice(0, 60) });
    n = n.parentElement;
  }
  return chain;
});
console.log(JSON.stringify(dom, null, 1));
await browser.close();
