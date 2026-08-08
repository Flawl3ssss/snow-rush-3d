// QA driver part 6: full finish -> results panel, rewards, persistence.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { writeFileSync, readFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/qa';
const report = JSON.parse(readFileSync(`${OUT}/qa-report.json`, 'utf8'));
report.flow6 = [];
report.consoleErrors6 = [];
report.pageErrors6 = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors6.push(m.text()); });
page.on('pageerror', (e) => report.pageErrors6.push(e.message));
const getState = () => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState() ?? null);

await page.goto(URL, { waitUntil: 'load' });
for (let i = 0; i < 40; i++) { const s = await getState(); if (s?.state === 'menu') break; await page.waitForTimeout(500); }

await page.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__.seed(42); window.__THREE_GAME_TEST_HOOKS__.startRun(1); });
const t0 = Date.now();
let lastState = '';
let done = null;
while (Date.now() - t0 < 300000) {
  const s = await getState();
  if (s?.state !== lastState) {
    report.flow6.push({ t: +((Date.now() - t0) / 1000).toFixed(1), state: s?.state, distance: s?.distance });
    lastState = s?.state;
  }
  if (s?.state === 'results') { done = s; break; }
  await page.waitForTimeout(500);
}
report.resultsFinal = done ? { distance: done.distance, best: done.best, coins: done.coins, results: done.results } : { timeout: true, lastState };
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/d10-results-panel.png` });
// check results buttons in DOM
report.resultsButtons = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map((b) => b.textContent.trim()).filter(Boolean));

// click ЕЩЁ РАЗ if present (restart from results via UI)
const btn = await page.$('button:has-text("ЕЩЁ РАЗ")');
if (btn) {
  await btn.click();
  await page.waitForTimeout(1500);
  const s = await getState();
  report.afterRetryClick = s?.state;
}

// persistence: reload, check best
await page.reload({ waitUntil: 'load' });
for (let i = 0; i < 40; i++) { const s = await getState(); if (s?.state === 'menu') break; await page.waitForTimeout(500); }
const s2 = await getState();
report.persistence3 = { best: s2?.best, coins: s2?.coins, playerLevel: s2?.playerLevel };

await ctx.close();
await browser.close();
writeFileSync(`${OUT}/qa-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ flow6: report.flow6, resultsFinal: report.resultsFinal, resultsButtons: report.resultsButtons, afterRetryClick: report.afterRetryClick, persistence3: report.persistence3, consoleErrors6: report.consoleErrors6, pageErrors6: report.pageErrors6 }, null, 2));
