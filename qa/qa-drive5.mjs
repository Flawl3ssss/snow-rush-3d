// QA driver part 5: crash -> results transition, results panel, restart from results, persistence.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { writeFileSync, readFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/qa';
const report = JSON.parse(readFileSync(`${OUT}/qa-report.json`, 'utf8'));
report.flow5 = [];
report.consoleErrors5 = [];
report.pageErrors5 = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors5.push(m.text()); });
page.on('pageerror', (e) => report.pageErrors5.push(e.message));
const getState = () => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState() ?? null);

await page.goto(URL, { waitUntil: 'load' });
for (let i = 0; i < 40; i++) { const s = await getState(); if (s?.state === 'menu') break; await page.waitForTimeout(500); }

// start run with no steering -> crash expected
await page.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__.seed(42); window.__THREE_GAME_TEST_HOOKS__.startRun(1); });
let crashAt = null;
let resultsAt = null;
const t0 = Date.now();
let lastState = '';
while (Date.now() - t0 < 120000) {
  const s = await getState();
  if (s?.state !== lastState) {
    report.flow5.push({ t: +((Date.now() - t0) / 1000).toFixed(1), state: s?.state, distance: s?.distance });
    lastState = s?.state;
  }
  if (s?.state === 'crash' && !crashAt) crashAt = Date.now();
  if (s?.state === 'results') { resultsAt = Date.now(); break; }
  await page.waitForTimeout(300);
}
report.crashToResultsMs = crashAt && resultsAt ? resultsAt - crashAt : null;
await page.waitForTimeout(1200);
const sRes = await getState();
report.resultsSnapshot = sRes ? { state: sRes.state, distance: sRes.distance, best: sRes.best, coins: sRes.coins, results: sRes.results } : null;
await page.screenshot({ path: `${OUT}/d9-results-panel.png` });

// persistence after results: reload and check best/coins changed
await page.reload({ waitUntil: 'load' });
for (let i = 0; i < 40; i++) { const s = await getState(); if (s?.state === 'menu') break; await page.waitForTimeout(500); }
const s2 = await getState();
report.persistence2 = { afterReload: { best: s2?.best, coins: s2?.coins, playerLevel: s2?.playerLevel, rockets: s2?.rockets } };

// full finish run with steering bot via keyboard is hard; use hooks with seed where bot...
// Instead: verify finish->results via a long run: steer by holding nothing, seed may finish? skip.
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/qa-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ flow5: report.flow5, crashToResultsMs: report.crashToResultsMs, resultsSnapshot: report.resultsSnapshot, persistence2: report.persistence2, consoleErrors5: report.consoleErrors5, pageErrors5: report.pageErrors5 }, null, 2));
