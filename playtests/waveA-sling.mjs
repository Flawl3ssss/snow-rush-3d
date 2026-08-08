// Быстрая проверка рогатки: menu/aim/натяжение 60%/старт.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const OUT = '/mnt/agents/output/playtests/waveA';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.addInitScript(() => {
  const data = {
    version: 3, coins: 5000, crystals: 500, diamonds: 100, rockets: 2,
    upgrades: { slingshot: 10, sled: 12, income: 5 },
    currentMap: 'valley', unlockedMaps: ['valley'],
    settings: { music: false, sound: false, reducedMotion: false },
  };
  localStorage.setItem('snowrush_save_v1', JSON.stringify(data));
});

await page.goto('http://127.0.0.1:5188', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__?.getState()?.state === 'menu', { timeout: 30000 });
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/10-menu2.png` });

await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('aim'));
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/11-aim-rest.png` });

// натяжение через прямой вызов setPull на рогатке нельзя — эмулируем через startRun(0.6) чуть позже;
// вместо этого: drag через pointer события? Проще: скрин запуска с силой 0.6 в первые 300мс
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(0.6));
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/12-launch06.png` });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/13-fly.png` });

await browser.close();
console.log('OK');
