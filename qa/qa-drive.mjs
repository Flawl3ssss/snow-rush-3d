// QA driver for SNOW RUSH 3D — read-only checks, screenshots, console errors.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('/home/kimi/.npm-global/lib/node_modules/sharp/dist/index.cjs');
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/qa';
mkdirSync(OUT, { recursive: true });

const report = { consoleErrors: [], pageErrors: [], states: [], pixels: {} };

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
  const dominant = Math.max(...buckets.values()) / n;
  report.pixels[name] = { width, height, meanLum: +mean.toFixed(1), stdLum: +std.toFixed(1), uniqueBuckets: buckets.size, dominantShare: +dominant.toFixed(3) };
  return report.pixels[name];
}

function attach(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => report.pageErrors.push(`[${tag}] ${e.message}`));
}

const hooks = (page) => page.evaluate(() => {
  const h = window.__THREE_GAME_TEST_HOOKS__;
  if (!h) return null;
  return h.getState();
});

async function waitState(page, wanted, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await hooks(page);
    if (s && wanted.includes(s.state)) return s;
    await page.waitForTimeout(500);
  }
  return await hooks(page);
}

const browser = await chromium.launch();

// ---------- DESKTOP ----------
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
attach(page, 'desktop');
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(4000); // loading -> menu

let s = await hooks(page);
report.states.push({ step: 'menu-after-load', ...s });

let shot = await page.screenshot({ path: `${OUT}/d1-menu.png` });
await pixelStats(shot, 'd1-menu');

// Real input path: click TAP TO PLAY area (bottom center)
await page.mouse.click(640, 700);
await page.waitForTimeout(800);
s = await hooks(page);
report.states.push({ step: 'after-tap-to-play-click', ...s });
shot = await page.screenshot({ path: `${OUT}/d2-aim.png` });
await pixelStats(shot, 'd2-aim');

// Pull via real drag: press, drag down, release -> launch
await page.mouse.move(640, 400);
await page.mouse.down();
for (let y = 400; y <= 640; y += 20) { await page.mouse.move(640, y); await page.waitForTimeout(30); }
shot = await page.screenshot({ path: `${OUT}/d3-aim-pull.png` });
await page.mouse.up();
await page.waitForTimeout(500);
s = await hooks(page);
report.states.push({ step: 'after-release', ...s });

// Run: steer with arrows a bit, screenshot mid-run
await page.waitForTimeout(2500);
await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(400); await page.keyboard.up('ArrowLeft');
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(400); await page.keyboard.up('ArrowRight');
shot = await page.screenshot({ path: `${OUT}/d4-run.png` });
await pixelStats(shot, 'd4-run');
s = await hooks(page);
report.states.push({ step: 'mid-run', ...s });

// Wait for finish/crash/stopped -> results
s = await waitState(page, ['results', 'finish', 'crash', 'stopped'], 90000);
report.states.push({ step: 'run-end', ...s });
await page.waitForTimeout(1500);
s = await hooks(page);
report.states.push({ step: 'results-state', ...s });
shot = await page.screenshot({ path: `${OUT}/d5-results.png` });
await pixelStats(shot, 'd5-results');

// Restart via hook: startRun again from results, verify run restarts (state machine)
await page.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__.seed(7); window.__THREE_GAME_TEST_HOOKS__.startRun(0.8); });
await page.waitForTimeout(3000);
s = await hooks(page);
report.states.push({ step: 'restart-run', ...s });
shot = await page.screenshot({ path: `${OUT}/d6-restart-run.png` });
await pixelStats(shot, 'd6-restart-run');
// pause via Esc
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
s = await hooks(page);
report.states.push({ step: 'after-esc', ...s });
shot = await page.screenshot({ path: `${OUT}/d7-pause.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
s = await hooks(page);
report.states.push({ step: 'after-esc-resume', ...s });

// renderer diagnostics
const diag = await page.evaluate(() => {
  const d = window.__THREE_GAME_DIAGNOSTICS__;
  if (!d || !d.renderer) return null;
  const i = d.renderer.info;
  return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
});
report.renderer = diag;

// Debug panel gating check: without ?debug=1 there should be no lil-gui
const hasLilGui = await page.evaluate(() => !!document.querySelector('.lil-gui'));
report.lilGuiNoFlag = hasLilGui;

await ctx.close();

// ---------- DESKTOP with ?debug=1 ----------
const ctxDbg = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const pageDbg = await ctxDbg.newPage();
attach(pageDbg, 'debug');
await pageDbg.goto(URL + '?debug=1', { waitUntil: 'load' });
await pageDbg.waitForTimeout(4000);
report.lilGuiDebugFlag = await pageDbg.evaluate(() => !!document.querySelector('.lil-gui'));
await pageDbg.screenshot({ path: `${OUT}/d8-debug.png` });
await ctxDbg.close();

// ---------- MOBILE PORTRAIT ----------
const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const pageM = await ctxM.newPage();
attach(pageM, 'mobile');
await pageM.goto(URL, { waitUntil: 'load' });
await pageM.waitForTimeout(4000);
shot = await pageM.screenshot({ path: `${OUT}/m1-menu.png` });
await pixelStats(shot, 'm1-menu');
// touch tap on TAP TO PLAY
await pageM.touchscreen.tap(195, 700);
await pageM.waitForTimeout(800);
let sm = await hooks(pageM);
report.states.push({ step: 'mobile-after-tap', ...sm });
await pageM.screenshot({ path: `${OUT}/m2-aim.png` });
// launch via hook (drag emulation by touch is flaky), then mid-run screenshot
await pageM.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__.seed(11); window.__THREE_GAME_TEST_HOOKS__.startRun(1); });
await pageM.waitForTimeout(4000);
sm = await hooks(pageM);
report.states.push({ step: 'mobile-mid-run', ...sm });
shot = await pageM.screenshot({ path: `${OUT}/m3-run.png` });
await pixelStats(shot, 'm3-run');
await ctxM.close();

// ---------- MOBILE LANDSCAPE ----------
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
await ctxL.close();

await browser.close();

writeFileSync(`${OUT}/qa-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
