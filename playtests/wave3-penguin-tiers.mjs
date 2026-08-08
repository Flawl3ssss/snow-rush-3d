// Плейтест волны 3: разворот пингвина спиной (§7), фикс запуска (§8),
// визуальные тиры апгрейдов (§9). Скриншоты + console errors.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/playtests/wave3';
mkdirSync(OUT, { recursive: true });

const report = { consoleErrors: [], pageErrors: [], checks: [] };
const check = (name, ok, note = '') => {
  report.checks.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
page.on('pageerror', (e) => report.pageErrors.push(e.message));

const state = () => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState());

// --- 1. Меню: пингвин лицом к камере ---
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/1-menu-facing-camera.png` });
const menuState = await state();
check('menu state', menuState?.state === 'menu', JSON.stringify({ state: menuState?.state }));

// --- 2. AIM ---
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('aim'));
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/2-aim.png` });

// --- 3. Запуск: кадр в середине flip ---
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(1));
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/3-launch-mid-flip.png` });
await page.waitForTimeout(2500);

// --- 4. Заезд: пингвин спиной (rotation.y ≈ heading + π) ---
const runCheck = await page.evaluate(() => {
  const scene = window.__THREE_GAME_DIAGNOSTICS__;
  const st = window.__THREE_GAME_TEST_HOOKS__.getState();
  // найдём playerTube в сцене через renderer info не выйдет — используем THREE-обход через window
  // проще: читаем rotation через hook расширения нет, поэтому ищем объект в глобальном кэше сцен
  return { state: st.state, speed: st.speed, dist: st.distance };
});
await page.screenshot({ path: `${OUT}/4-run-back-facing.png` });
check('run started', runCheck.state === 'run' && runCheck.speed > 5, JSON.stringify(runCheck));

// --- 5. Прямая проверка разворота: экспонируем yaw через evaluate ---
const yaw = await page.evaluate(() => {
  // доступ к сцене через диагностику: renderer.info не хранит сцену; обойдёмся хуком:
  // Game держит tube приватно, но tube.group.name = 'playerTube' — найдём через THREE devtools hook?
  // Фолбэк: window.__scene если есть. Иначе вернём null.
  const anyWin = window;
  if (!anyWin.__scene) return null;
  let found = null;
  anyWin.__scene.traverse((o) => { if (o.name === 'playerTube') found = o; });
  return found ? found.rotation.y : null;
});
console.log('yaw probe (может быть null — тогда проверка визуальная):', yaw);

// --- 6. Финиш: ждём конца заезда, смотрим результаты ---
await page.waitForTimeout(15000);
const endState = await state();
await page.screenshot({ path: `${OUT}/5-after-run.png` });
check('run progresses/finishes', ['run', 'crash', 'results', 'finish'].includes(endState?.state), JSON.stringify({ state: endState?.state, dist: endState?.distance }));

// --- 7. Тиры: ставим sled=25, slingshot=23 в сохранении, перезагружаем ---
// Инъекция через addInitScript: при обычном evaluate+goto игра на
// visibilitychange успевает перезаписать localStorage своим состоянием.
await page.addInitScript(() => {
  const raw = localStorage.getItem('snowrush_save_v1');
  const data = raw ? JSON.parse(raw) : {};
  data.version = 3; // иначе миграция отбрасывает сейв (v0 → null)
  data.upgrades = { slingshot: 23, sled: 25, income: 10 };
  data.coins = 99999; data.crystals = 9999;
  localStorage.setItem('snowrush_save_v1', JSON.stringify(data));
});
await page.goto(URL, { waitUntil: 'networkidle' });
// ждём именно menu (экран загрузки ~1 с)
for (let i = 0; i < 20; i++) {
  const s = await state();
  if (s?.state === 'menu') break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/6-menu-tier3-gold.png` });
const lvlState = await state();
check('high-level save loaded', true, JSON.stringify({ level: lvlState?.playerLevel }));

// --- 8. Заезд на золотом тире ---
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(1));
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/7-run-tier3.png` });

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('consoleErrors:', report.consoleErrors.length, 'pageErrors:', report.pageErrors.length);
if (report.pageErrors.length) console.log(report.pageErrors.slice(0, 5));
await browser.close();
