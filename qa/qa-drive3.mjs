// QA driver part 3: desktop state flow via real input + hooks, renderer info, mobile tap retest.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('/home/kimi/.npm-global/lib/node_modules/sharp/dist/index.cjs');
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/qa';
const report = JSON.parse(readFileSync(`${OUT}/qa-report.json`, 'utf8'));
report.flow = [];
report.consoleErrors2 = [];
report.pageErrors2 = [];

async function pixelStats(buf, name) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const step = Math.max(1, Math.floor((info.width * info.height) / 20000));
  let n = 0, sum = 0, sum2 = 0;
  const buckets = new Map();
  for (let i = 0; i < info.width * info.height; i += step) {
    const o = i * info.channels;
    const lum = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    sum += lum; sum2 += lum * lum; n++;
    const key = `${data[o] >> 4},${data[o + 1] >> 4},${data[o + 2] >> 4}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const mean = sum / n;
  report.pixels[name] = { width: info.width, height: info.height, meanLum: +mean.toFixed(1), stdLum: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1), uniqueBuckets: buckets.size, dominantShare: +(Math.max(...buckets.values()) / n).toFixed(3) };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors2.push(m.text()); });
page.on('pageerror', (e) => report.pageErrors2.push(e.message));
const getState = () => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState() ?? null);
const log = async (step) => { const s = await getState(); report.flow.push({ step, state: s?.state, distance: s?.distance, speed: +(s?.speed ?? 0).toFixed(1), coins: s?.coins, best: s?.best }); return s; };

await page.goto(URL, { waitUntil: 'load' });
// wait until menu
for (let i = 0; i < 40; i++) { const s = await getState(); if (s?.state === 'menu') break; await page.waitForTimeout(500); }
await log('menu');

// 1) real click on TAP TO PLAY area
await page.mouse.click(640, 700);
await page.waitForTimeout(700);
await log('click-tap-to-play');

// 2) real drag pull + release
await page.mouse.move(640, 380);
await page.mouse.down();
for (let y = 380; y <= 620; y += 24) { await page.mouse.move(640, y); await page.waitForTimeout(40); }
await log('pulling');
await page.mouse.up();
await page.waitForTimeout(400);
await log('after-release');

// 3) wait until run, then mid-run info + renderer info
for (let i = 0; i < 20; i++) { const s = await getState(); if (s?.state === 'run') break; await page.waitForTimeout(400); }
await page.waitForTimeout(3000);
await log('mid-run');
report.rendererRun2 = await page.evaluate(() => {
  const r = window.__THREE_GAME_DIAGNOSTICS__?.renderer;
  if (!r || !r.render) return null;
  return { calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures };
});

// 4) steer with keys (verify no crash of input path)
await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(300); await page.keyboard.up('ArrowLeft');
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(300); await page.keyboard.up('ArrowRight');

// 5) wait for results (run ~500m, headless may be slow)
let endState = null;
for (let i = 0; i < 240; i++) {
  const s = await getState();
  if (['results', 'crash', 'finish', 'stopped'].includes(s?.state)) { endState = s; break; }
  await page.waitForTimeout(1000);
}
report.flow.push({ step: 'run-end', state: endState?.state, distance: endState?.distance, results: endState?.results ? { distance: endState.results.distance, reason: endState.results.reason ?? endState.results.endReason } : null });
await page.waitForTimeout(1500);
await log('results-visible');
await page.screenshot({ path: `${OUT}/d5b-results.png` });

// 6) restart via hook, then Esc pause/resume
await page.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__.seed(7); window.__THREE_GAME_TEST_HOOKS__.startRun(0.8); });
await page.waitForTimeout(2500);
await log('restart-run');
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
await log('esc-pause');
await page.screenshot({ path: `${OUT}/d7b-pause.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
await log('esc-resume');

await ctx.close();

// mobile tap retest at TAP TO PLAY text height (~y=640 in 390x844)
const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const pageM = await ctxM.newPage();
pageM.on('console', (m) => { if (m.type() === 'error') report.consoleErrors2.push('[m] ' + m.text()); });
pageM.on('pageerror', (e) => report.pageErrors2.push('[m] ' + e.message));
await pageM.goto(URL, { waitUntil: 'load' });
for (let i = 0; i < 40; i++) { const s = await pageM.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState() ?? null); if (s?.state === 'menu') break; await pageM.waitForTimeout(500); }
await pageM.touchscreen.tap(195, 620);
await pageM.waitForTimeout(900);
const sm = await pageM.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState() ?? null);
report.flow.push({ step: 'mobile-tap-at-620', state: sm?.state });
if (sm?.state !== 'aim') {
  await pageM.touchscreen.tap(195, 560);
  await pageM.waitForTimeout(900);
  const sm2 = await pageM.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState() ?? null);
  report.flow.push({ step: 'mobile-tap-at-560', state: sm2?.state });
}
await pageM.screenshot({ path: `${OUT}/m2b-aim.png` });
await ctxM.close();

await browser.close();
writeFileSync(`${OUT}/qa-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ flow: report.flow, rendererRun2: report.rendererRun2, consoleErrors2: report.consoleErrors2, pageErrors2: report.pageErrors2 }, null, 2));
