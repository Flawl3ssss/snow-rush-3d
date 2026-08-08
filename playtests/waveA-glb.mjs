// Wave A визуальная проверка: GLB-ассеты в меню и в заезде.
// Скриншоты меню/прицеливания/заезда + консольные ошибки + видео.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/playtests/waveA';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
});
const page = await ctx.newPage();
const consoleLog = [];
page.on('console', (m) => {
  if (m.type() === 'warning' || m.type() === 'error') consoleLog.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));

await page.addInitScript(() => {
  const data = {
    version: 3, coins: 5000, crystals: 500, diamonds: 100, rockets: 2,
    upgrades: { slingshot: 10, sled: 12, income: 5 },
    currentMap: 'valley', unlockedMaps: ['valley', 'canyon', 'aurora', 'caves', 'volcano'],
    settings: { music: true, sound: true, reducedMotion: false },
  };
  const raw = localStorage.getItem('snowrush_save_v1');
  const prev = raw ? JSON.parse(raw) : {};
  localStorage.setItem('snowrush_save_v1', JSON.stringify({ ...prev, ...data }));
});

const t0 = Date.now();
const t = () => ((Date.now() - t0) / 1000).toFixed(1);
const timeline = [];

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__?.getState()?.state === 'menu', { timeout: 30000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/01-menu.png` });
timeline.push(`[${t()}s] menu`);

// Крупный план героя: камера меню уже смотрит на стартовую площадку
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('aim'));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/02-aim.png` });
timeline.push(`[${t()}s] aim`);

// натяжение ~50% для проверки резинок GLB-рогатки
await page.evaluate(() => {
  const g = window.__THREE_GAME_TEST_HOOKS__;
  // эмулируем drag через setState нельзя — просто стартуем
  g.startRun(0.55);
});
await page.waitForTimeout(450);
await page.screenshot({ path: `${OUT}/03-launch.png` });

// заезд: руление змейкой, скриншоты каждые ~2.5с
let rng = 7;
const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let steerUntil = 0, steerKey = null;
let shot = 4;
let lastState = 'run';
const deadline = Date.now() + 75000;

while (Date.now() < deadline) {
  const st = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState());
  if (!st) break;
  if (st.state !== lastState) {
    timeline.push(`[${t()}s] ${lastState} → ${st.state} d=${st.distance?.toFixed(0) ?? '?'}m`);
    lastState = st.state;
  }
  if (st.state === 'results' || st.state === 'crash') {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${String(shot).padStart(2, '0')}-${st.state}.png` });
    break;
  }
  if (st.state === 'run') {
    const now = Date.now();
    if (now > steerUntil) {
      if (steerKey) await page.keyboard.up(steerKey);
      steerKey = rand() < 0.5 ? 'ArrowLeft' : 'ArrowRight';
      steerUntil = now + 350 + rand() * 700;
      await page.keyboard.down(steerKey);
    }
    if (shot <= 8 && Math.floor((now - t0) / 2500) > shot - 4) {
      await page.screenshot({ path: `${OUT}/${String(shot).padStart(2, '0')}-run-${st.distance?.toFixed(0)}m.png` });
      shot += 1;
    }
  }
  await page.waitForTimeout(120);
}
if (steerKey) await page.keyboard.up(steerKey);

timeline.push(`[${t()}s] end state=${lastState}`);
writeFileSync(`${OUT}/timeline.txt`, timeline.join('\n') + '\n\nCONSOLE:\n' + consoleLog.join('\n'));
await ctx.close();
await browser.close();
console.log('DONE\n' + timeline.join('\n') + '\nCONSOLE:\n' + consoleLog.slice(0, 20).join('\n'));
