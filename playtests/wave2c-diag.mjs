// Диагностика: меню/aim с текущего билда + кадр с высоты над трассой.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  localStorage.setItem('snowrush_save_v1', JSON.stringify({
    version: 3, coins: 100, crystals: 10, diamonds: 3, rockets: 1,
    upgrades: { slingshot: 1, sled: 1, income: 1 },
    currentMap: 'valley', unlockedMaps: ['valley'],
    settings: { music: false, sound: false, reducedMotion: false },
  }));
});
await page.goto('http://127.0.0.1:5188', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__?.getState()?.state === 'menu', { timeout: 30000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: '/mnt/agents/output/playtests/wave2c/diag-menu.png' });
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('aim'));
await page.waitForTimeout(800);
await page.screenshot({ path: '/mnt/agents/output/playtests/wave2c/diag-aim.png' });
await browser.close();
console.log('OK');
