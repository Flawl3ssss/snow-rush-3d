// QA driver part 4: real-input pull-launch, full run to results, desktop pixel stats.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('/home/kimi/.npm-global/lib/node_modules/sharp/dist/index.cjs');
import { writeFileSync, readFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/qa';
const report = JSON.parse(readFileSync(`${OUT}/qa-report.json`, 'utf8'));
report.flow4 = [];
report.consoleErrors4 = [];
report.pageErrors4 = [];

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
page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors4.push(m.text()); });
page.on('pageerror', (e) => report.pageErrors4.push(e.message));
const getState = () => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState() ?? null);
const log = async (step) => { const s = await getState(); report.flow4.push({ step, state: s?.state, distance: s?.distance, speed: +(s?.speed ?? 0).toFixed(1), pullPower: s?.pullPower, coins: s?.coins, best: s?.best }); return s; };

await page.goto(URL, { waitUntil: 'load' });
for (let i = 0; i < 40; i++) { const s = await getState(); if (s?.state === 'menu') break; await page.waitForTimeout(500); }
let shot = await page.screenshot({ path: `${OUT}/d1b-menu.png` });
await pixelStats(shot, 'd1b-menu');

// click directly on TAP TO PLAY text
await page.mouse.click(640, 520);
await page.waitForTimeout(700);
await log('click-on-tap-text');
shot = await page.screenshot({ path: `${OUT}/d2b-aim.png` });
await pixelStats(shot, 'd2b-aim');

// pull gesture while in aim
await page.mouse.move(640, 400);
await page.mouse.down();
for (let y = 400; y <= 660; y += 20) { await page.mouse.move(640, y); await page.waitForTimeout(40); }
const pulling = await log('pulling-full');
shot = await page.screenshot({ path: `${OUT}/d3b-pull.png` });
await page.mouse.up();
await page.waitForTimeout(600);
await log('after-release');
for (let i = 0; i < 25; i++) { const s = await getState(); if (s?.state === 'run') break; await page.waitForTimeout(400); }
await page.waitForTimeout(4000);
await log('mid-run');
shot = await page.screenshot({ path: `${OUT}/d4b-run.png` });
await pixelStats(shot, 'd4b-run');
report.rendererActiveRun = await page.evaluate(() => {
  const r = window.__THREE_GAME_DIAGNOSTICS__?.renderer;
  return r?.render ? { calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures } : null;
});

// wait for run end
let endS = null;
for (let i = 0; i < 300; i++) {
  const s = await getState();
  if (['results', 'crash', 'finish', 'stopped'].includes(s?.state)) { endS = s; break; }
  await page.waitForTimeout(1000);
}
report.flow4.push({ step: 'run-end', state: endS?.state, distance: endS?.distance, endResults: endS?.results ?? null });
await page.waitForTimeout(2000);
await log('results-visible');
shot = await page.screenshot({ path: `${OUT}/d5c-results.png` });
await pixelStats(shot, 'd5c-results');

// verify best/save persisted after reload
const bestBefore = (await getState())?.best;
await page.reload({ waitUntil: 'load' });
for (let i = 0; i < 40; i++) { const s = await getState(); if (s?.state === 'menu') break; await page.waitForTimeout(500); }
const s2 = await getState();
report.persistence = { bestBeforeReload: bestBefore, afterReload: { best: s2?.best, coins: s2?.coins, playerLevel: s2?.playerLevel } };

await ctx.close();
await browser.close();
writeFileSync(`${OUT}/qa-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ flow4: report.flow4, rendererActiveRun: report.rendererActiveRun, persistence: report.persistence, consoleErrors4: report.consoleErrors4, pageErrors4: report.pageErrors4 }, null, 2));
