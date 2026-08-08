// ФИНАЛЬНЫЙ комплексный плейтест (промт §13): полный цикл на valley
// (меню → aim → запуск → заезд → пауза/резюме → результаты), затем заезды
// на всех остальных биомах (canyon/aurora/caves/volcano) через селектор карт,
// контроль палитр скриншотами, запросы биомной музыки, ноль console/page errors.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/playtests/final';
mkdirSync(OUT, { recursive: true });

const report = { startedAt: new Date().toISOString(), consoleErrors: [], pageErrors: [], musicRequests: [], checks: [] };
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
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('/music/')) report.musicRequests.push(u.split('/music/')[1]);
});

const state = () => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState());
const waitState = async (targets, timeoutMs = 30000) => {
  const arr = Array.isArray(targets) ? targets : [targets];
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await state();
    if (st && arr.includes(st.state)) return st;
    await page.waitForTimeout(200);
  }
  return await state();
};

// Сейв: все 5 карт открыты, высокий уровень, тир-3 апгрейды.
// addInitScript обязателен: обычный evaluate+goto перезаписывается автосейвом
// на visibilitychange во время навигации. version=3 — иначе миграция в null.
await page.addInitScript(() => {
  const data = {
    version: 3,
    coins: 99999,
    crystals: 9999,
    diamonds: 500,
    rockets: 3,
    upgrades: { slingshot: 23, sled: 25, income: 12 },
    currentMap: 'valley',
    unlockedMaps: ['valley', 'canyon', 'aurora', 'caves', 'volcano'],
    best: { distance: 0, coins: 0 },
    settings: { music: true, sound: true, reducedMotion: false },
  };
  const raw = localStorage.getItem('snowrush_save_v1');
  const prev = raw ? JSON.parse(raw) : {};
  localStorage.setItem('snowrush_save_v1', JSON.stringify({ ...prev, ...data }));
});

// ===== 1. Меню (valley) =====
await page.goto(URL, { waitUntil: 'networkidle' });
const menu = await waitState('menu', 25000);
check('загрузка в меню', menu?.state === 'menu', `state=${menu?.state}`);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/01-menu-valley.png` });

// ===== 2. Valley: полный цикл заезда =====
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(1));
const run = await waitState('run', 15000); // launch ~0.4s game-time ≈ 1.5-2s real
check('запуск valley → run', run?.state === 'run' && run?.speed > 5, `state=${run?.state} v=${run?.speed?.toFixed?.(1)}`);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/02-run-valley.png` });

// ===== 3. Пауза / резюме =====
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const paused = await state();
check('пауза по Escape', paused?.state === 'pause', `state=${paused?.state}`);
await page.screenshot({ path: `${OUT}/03-pause.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const resumed = await state();
check('резюме по Escape', resumed?.state === 'run', `state=${resumed?.state}`);

// ===== 4. Доводим заезд до результатов =====
let end = await waitState(['results', 'crash'], 150000);
if (end?.state === 'crash') end = await waitState('results', 15000);
check('заезд завершился результатами', end?.state === 'results', `state=${end?.state} dist=${end?.distance}`);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/04-results.png` });
const res = await state();
check('пейлоад результатов заполнен', !!res?.results && res.results.distance > 0, `dist=${res?.results?.distance} coins=${res?.results?.coins}`);

// ===== 5. Биомы: canyon / aurora / caves / volcano =====
for (const mapId of ['canyon', 'aurora', 'caves', 'volcano']) {
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('menu'));
  await waitState('menu', 10000);
  await page.waitForTimeout(600);

  const before = report.musicRequests.length;
  await page.click(`button.map-card[data-map-id="${mapId}"]`);
  await page.waitForTimeout(1200); // rebuildMapWorld
  const isCurrent = await page.evaluate((id) => {
    const btn = document.querySelector(`button.map-card[data-map-id="${id}"]`);
    return btn?.classList.contains('map-card--current') ?? false;
  }, mapId);
  check(`селектор: ${mapId} выбран`, isCurrent);
  await page.screenshot({ path: `${OUT}/05-menu-${mapId}.png` });

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(1));
  const r = await waitState('run', 15000);
  check(`заезд ${mapId} стартовал`, r?.state === 'run' && r?.speed > 5, `state=${r?.state}`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/06-run-${mapId}.png` });

  const reqs = report.musicRequests.slice(before);
  const biomeReq = reqs.find((f) => f === `run-${mapId}.mp3`);
  console.log(`  music requests после выбора ${mapId}:`, reqs.length ? reqs.join(', ') : '(нет — автоплей мог быть заблокирован)');
  if (reqs.length) check(`музыка биома ${mapId}`, !!biomeReq, reqs.join(', '));
}

// ===== 6. Возврат в меню, финальный кадр =====
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('menu'));
await waitState('menu', 10000);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/07-menu-final.png` });

// ===== Итог =====
check('ноль console errors', report.consoleErrors.length === 0, report.consoleErrors.slice(0, 3).join(' | '));
check('ноль page errors', report.pageErrors.length === 0, report.pageErrors.slice(0, 3).join(' | '));

report.finishedAt = new Date().toISOString();
report.pass = report.checks.every((c) => c.ok);
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`\n=== ${report.pass ? 'ВСЕ ПРОВЕРКИ PASS' : 'ЕСТЬ FAIL'} ===`);

const lines = [
  `# Журнал финального плейтеста SNOW RUSH 3D`,
  ``,
  `Дата: ${report.startedAt}`,
  `Сценарий: меню → заезд valley (запуск/пауза/резюме/результаты) → селектор карт → заезды canyon/aurora/caves/volcano.`,
  `Сейв: все 5 карт открыты, тир-3 апгрейды (рогатка 23, тюбинг 25).`,
  ``,
  `## Проверки`,
  ...report.checks.map((c) => `- ${c.ok ? '✅' : '❌'} **${c.name}**${c.note ? ` — ${c.note}` : ''}`),
  ``,
  `## Музыкальные запросы (биомные треки)`,
  ...(report.musicRequests.length ? report.musicRequests.map((r) => `- ${r}`) : ['- (нет — headless autoplay)']),
  ``,
  `## Ошибки`,
  `- console: ${report.consoleErrors.length ? report.consoleErrors.join(' ; ') : 'нет'}`,
  `- page: ${report.pageErrors.length ? report.pageErrors.join(' ; ') : 'нет'}`,
  ``,
  `## Скриншоты`,
  `- 01-menu-valley.png — меню, тир-3 рогатка/тюбинг`,
  `- 02-run-valley.png — заезд по долине`,
  `- 03-pause.png — оверлей паузы`,
  `- 04-results.png — экран результатов`,
  `- 05-menu-<биом>.png / 06-run-<биом>.png — палитры четырёх биомов`,
  `- 07-menu-final.png — возврат в меню`,
];
writeFileSync(`${OUT}/ЖУРНАЛ.md`, lines.join('\n'));

await browser.close();
process.exit(report.pass ? 0 : 1);
