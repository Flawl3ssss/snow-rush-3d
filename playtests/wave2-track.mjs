// W2 видео-аудит трассы: valley + volcano, длинные заезды, скриншоты рельефа.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/playtests/wave2';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

async function run(mapId, tag, maxSec) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((mid) => {
    const data = {
      version: 3, coins: 9000, crystals: 900, diamonds: 100, rockets: 2,
      upgrades: { slingshot: 12, sled: 14, income: 6 },
      currentMap: mid, unlockedMaps: ['valley', 'canyon', 'aurora', 'caves', 'volcano'],
      settings: { music: false, sound: false, reducedMotion: false },
    };
    localStorage.setItem('snowrush_save_v1', JSON.stringify(data));
  }, mapId);

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__?.getState()?.state === 'menu', { timeout: 30000 });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(0.9));

  const t0 = Date.now();
  let shot = 0;
  let lastD = 0;
  let lastState = 'launch';
  const marks = [];
  // руление: держимся центра, мягкие змейки
  let steerUntil = 0, steerKey = null;
  let rng = 42;
  const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  while (Date.now() - t0 < maxSec * 1000) {
    const st = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState());
    if (!st) break;
    if (st.state !== lastState) {
      marks.push(`${lastState}→${st.state}@${st.distance?.toFixed(0)}m v=${st.speed?.toFixed(1)}`);
      lastState = st.state;
    }
    if (st.state === 'results' || st.state === 'crash') {
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/${tag}-end-${st.state}.png` });
      break;
    }
    if (st.state === 'run') {
      const d = st.distance ?? 0;
      if (d - lastD > 120 && shot < 7) {
        lastD = d;
        shot += 1;
        await page.screenshot({ path: `${OUT}/${tag}-${String(shot)}-${d.toFixed(0)}m-v${st.speed?.toFixed(0)}.png` });
      }
      const now = Date.now();
      if (now > steerUntil) {
        if (steerKey) await page.keyboard.up(steerKey);
        steerKey = rand() < 0.5 ? 'ArrowLeft' : 'ArrowRight';
        steerUntil = now + 300 + rand() * 600;
        await page.keyboard.down(steerKey);
      }
    }
    await page.waitForTimeout(100);
  }
  if (steerKey) await page.keyboard.up(steerKey);
  writeFileSync(`${OUT}/${tag}-marks.txt`, marks.join('\n') + '\nerrors:\n' + errors.join('\n'));
  await ctx.close();
  console.log(`${tag}: ${marks.join(' | ')}${errors.length ? '\nERRORS: ' + errors.join('; ') : ''}`);
}

await run('valley', 'valley', 110);
await run('volcano', 'volcano', 110);
await browser.close();
console.log('DONE');
