// Видео-аудит: «человеческая» игра с записью видео (playwright recordVideo).
// Руление стрелками, буст Shift, прыжки, краш. Лог таймлайна состояний.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/playtests/audit';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

async function playRun(mapId, tag, steerSeed) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  const timeline = [];
  const log = (t, msg) => { timeline.push(`[${t}s] ${msg}`); };

  await page.addInitScript((mid) => {
    const data = {
      version: 3, coins: 5000, crystals: 500, diamonds: 100, rockets: 2,
      upgrades: { slingshot: 10, sled: 12, income: 5 },
      currentMap: mid, unlockedMaps: ['valley', 'canyon', 'aurora', 'caves', 'volcano'],
      settings: { music: true, sound: true, reducedMotion: false },
    };
    const raw = localStorage.getItem('snowrush_save_v1');
    const prev = raw ? JSON.parse(raw) : {};
    localStorage.setItem('snowrush_save_v1', JSON.stringify({ ...prev, ...data }));
  }, mapId);

  const state = () => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState());
  const t0 = Date.now();
  const t = () => ((Date.now() - t0) / 1000).toFixed(1);

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__?.getState()?.state === 'menu', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${tag}-menu.png` });
  log(t(), 'menu');

  // aim
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('aim'));
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${tag}-aim.png` });

  // запуск
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(1));
  log(t(), 'launch');

  // играем: руление змейкой, буст на 6с, ждём краша/финиша
  let lastState = 'launch';
  let boosted = false;
  let rng = steerSeed;
  const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let steerUntil = 0, steerKey = null;

  for (let i = 0; i < 600; i++) {
    const st = await state();
    if (!st) break;
    if (st.state !== lastState) { log(t(), `state: ${lastState} → ${st.state} (dist=${st.distance}, v=${st.speedKmh?.toFixed?.(0)}км/ч)`); lastState = st.state; }
    if (st.state === 'results' || st.state === 'crash') break;
    if (st.state === 'run') {
      if (st.airborne) log(t(), `airborne @ ${st.distance}m`);
      if (!boosted && st.distance > 60) { await page.keyboard.press('Shift'); boosted = true; log(t(), 'BOOST'); }
      // змейка: каждые 0.7-1.3с меняем направление
      const now = Date.now() / 1000;
      if (now > steerUntil) {
        if (steerKey) await page.keyboard.up(steerKey);
        const r = rand();
        steerKey = r < 0.4 ? 'ArrowLeft' : r < 0.8 ? 'ArrowRight' : null;
        if (steerKey) await page.keyboard.down(steerKey);
        steerUntil = now + 0.7 + rand() * 0.6;
      }
    }
    await page.waitForTimeout(100);
  }
  if (steerKey) await page.keyboard.up(steerKey).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${tag}-end.png` });
  const fin = await state();
  log(t(), `конец: state=${fin?.state} dist=${fin?.distance}`);

  const video = page.video();
  await ctx.close();
  const vpath = await video.path();
  writeFileSync(`${OUT}/${tag}-timeline.txt`, timeline.join('\n'));
  console.log(`${tag}: видео=${vpath}`);
  console.log(timeline.join('\n'));
  return vpath;
}

const v1 = await playRun('valley', 'audit1-valley', 42);
const v2 = await playRun('volcano', 'audit2-volcano', 777);
console.log('DONE', v1, v2);
await browser.close();
