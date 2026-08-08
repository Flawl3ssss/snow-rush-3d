// QA driver part 2: diagnostics (defensive), debug flag, mobile viewports.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('/home/kimi/.npm-global/lib/node_modules/sharp/dist/index.cjs');
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/qa';

const report = existsSync(`${OUT}/qa-report.json`)
  ? JSON.parse(readFileSync(`${OUT}/qa-report.json`, 'utf8'))
  : { consoleErrors: [], pageErrors: [], states: [], pixels: {} };

async function pixelStats(buf, name) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const step = Math.max(1, Math.floor((width * height) / 20000));
  let n = 0, sum = 0, sum2 = 0;
  const buckets = new Map();
  for (let i = 0; i < width * height; i += step) {
    const o = i * channels;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += lum; sum2 += lum * lum; n++;
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  report.pixels[name] = { width, height, meanLum: +mean.toFixed(1), stdLum: +std.toFixed(1), uniqueBuckets: buckets.size, dominantShare: +(Math.max(...buckets.values()) / n).toFixed(3) };
}

function attach(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => report.pageErrors.push(`[${tag}] ${e.message}`));
}
const hooks = (page) => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__ ? window.__THREE_GAME_TEST_HOOKS__.getState() : null);

const browser = await chromium.launch();

// diagnostics on desktop
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
attach(page, 'desktop2');
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(4000);
report.diagKeys = await page.evaluate(() => {
  const d = window.__THREE_GAME_DIAGNOSTICS__;
  if (!d) return null;
  return Object.keys(d);
});
report.renderer = await page.evaluate(() => {
  const d = window.__THREE_GAME_DIAGNOSTICS__;
  try {
    const r = d && d.renderer;
    if (!r || !r.info) return { note: 'renderer/info unavailable', type: typeof r };
    return { calls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures };
  } catch (e) { return { error: String(e) }; }
});
// renderer info during active run
await page.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__.seed(5); window.__THREE_GAME_TEST_HOOKS__.startRun(1); });
await page.waitForTimeout(4000);
report.rendererRun = await page.evaluate(() => {
  const d = window.__THREE_GAME_DIAGNOSTICS__;
  try {
    const r = d && d.renderer;
    if (!r || !r.info) return { note: 'renderer/info unavailable' };
    return { calls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures };
  } catch (e) { return { error: String(e) }; }
});
report.states.push({ step: 'desktop2-mid-run', ...(await hooks(page)) });
report.lilGuiNoFlag = await page.evaluate(() => !!document.querySelector('.lil-gui'));
await ctx.close();

// debug flag
const ctxDbg = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const pageDbg = await ctxDbg.newPage();
attach(pageDbg, 'debug');
await pageDbg.goto(URL + '?debug=1', { waitUntil: 'load' });
await pageDbg.waitForTimeout(4000);
report.lilGuiDebugFlag = await pageDbg.evaluate(() => !!document.querySelector('.lil-gui'));
await pageDbg.screenshot({ path: `${OUT}/d8-debug.png` });
await ctxDbg.close();

// mobile portrait
const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const pageM = await ctxM.newPage();
attach(pageM, 'mobile');
await pageM.goto(URL, { waitUntil: 'load' });
await pageM.waitForTimeout(4000);
let shot = await pageM.screenshot({ path: `${OUT}/m1-menu.png` });
await pixelStats(shot, 'm1-menu');
await pageM.touchscreen.tap(195, 700);
await pageM.waitForTimeout(1000);
report.states.push({ step: 'mobile-after-tap', ...(await hooks(pageM)) });
await pageM.screenshot({ path: `${OUT}/m2-aim.png` });
await pageM.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__.seed(11); window.__THREE_GAME_TEST_HOOKS__.startRun(1); });
await pageM.waitForTimeout(4000);
report.states.push({ step: 'mobile-mid-run', ...(await hooks(pageM)) });
shot = await pageM.screenshot({ path: `${OUT}/m3-run.png` });
await pixelStats(shot, 'm3-run');
await ctxM.close();

// mobile landscape
const ctxL = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
const pageL = await ctxL.newPage();
attach(pageL, 'mobile-landscape');
await pageL.goto(URL, { waitUntil: 'load' });
await pageL.waitForTimeout(4000);
shot = await pageL.screenshot({ path: `${OUT}/l1-menu.png` });
await pixelStats(shot, 'l1-menu');
await pageL.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__.startRun(1); });
await pageL.waitForTimeout(4000);
shot = await pageL.screenshot({ path: `${OUT}/l2-run.png` });
await pixelStats(shot, 'l2-run');
report.states.push({ step: 'landscape-mid-run', ...(await hooks(pageL)) });
await ctxL.close();

await browser.close();
writeFileSync(`${OUT}/qa-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
