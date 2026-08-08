// Плейтест волны 4 (промт §4/§10): полёт (ласты раскрыты + воздушный след),
// нитро (пламя + огненный трейл), near-miss (бейдж РИСК!), speed lines.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/playtests/wave4';
mkdirSync(OUT, { recursive: true });

const report = { consoleErrors: [], pageErrors: [], checks: [] };
const check = (name, ok, note = '') => {
  report.checks.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`);
};

const browser = await chromium.launch({
  args: [
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
page.on('pageerror', (e) => report.pageErrors.push(e.message));
const state = () => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState());

await page.goto(URL, { waitUntil: 'networkidle' });
for (let i = 0; i < 20; i++) {
  const s = await state();
  if (s?.state === 'menu') break;
  await page.waitForTimeout(500);
}

// --- заезд: ловим кадр полёта (airborne) ---
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(1));
let gotAir = false;
let gotNearMiss = false;
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  const s = await state();
  if (!s) break;
  if (s.state === 'run' && s.airborne && !gotAir) {
    gotAir = true;
    await page.screenshot({ path: `${OUT}/1-airborne-flight-pose.png` });
  }
  if (s.state === 'results' || s.state === 'menu') break;
  await page.waitForTimeout(60);
}
check('airborne frame captured', gotAir);

// --- буст: даём ракет и жмём boost в заезде ---
await page.evaluate(() => {
  const h = window.__THREE_GAME_TEST_HOOKS__;
  h.setState('menu');
});
await page.waitForTimeout(800);
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(1));
// ждём именно RUN (launch в headless идёт ~1.5 с реального времени)
for (let i = 0; i < 20; i++) {
  const s = await state();
  if (s?.state === 'run') break;
  await page.waitForTimeout(400);
}
await page.waitForTimeout(600);
// Shift — интент буста
await page.keyboard.down('Shift');
await page.waitForTimeout(120);
await page.keyboard.up('Shift');
await page.waitForTimeout(400);
const boostState = await state();
if (boostState?.boosting) {
  await page.screenshot({ path: `${OUT}/2-boost-flame-trail.png` });
}
check('boost activated', boostState?.boosting === true, JSON.stringify({ boosting: boostState?.boosting, rockets: boostState?.rockets }));
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/3-boost-late.png` });

// ждём конца заезда
const t1 = Date.now();
while (Date.now() - t1 < 60000) {
  const s = await state();
  if (!s || s.state === 'results' || s.state === 'menu') break;
  await page.waitForTimeout(400);
}
await page.screenshot({ path: `${OUT}/4-end.png` });

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('consoleErrors:', report.consoleErrors.length, 'pageErrors:', report.pageErrors.length);
if (report.pageErrors.length) console.log(report.pageErrors.slice(0, 3));
await browser.close();
