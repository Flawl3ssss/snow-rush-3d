// Плейтест волны 5 (промт §1): UI-аудит на 3 вьюпортах + настройки без
// фейкового переключателя качества. Скриншоты меню/настроек/зaeзда.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'http://127.0.0.1:5188';
const OUT = '/mnt/agents/output/playtests/wave5';
mkdirSync(OUT, { recursive: true });

const report = { consoleErrors: [], pageErrors: [], checks: [] };
const check = (name, ok, note = '') => {
  report.checks.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ' — ' + note : ''}`);
};

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

const viewports = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
];

for (const vp of viewports) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`[${vp.name}] ${m.text()}`); });
  page.on('pageerror', (e) => report.pageErrors.push(`[${vp.name}] ${e.message}`));
  const state = () => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.getState());

  await page.goto(URL, { waitUntil: 'networkidle' });
  for (let i = 0; i < 30; i++) {
    const s = await state();
    if (s?.state === 'menu') break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${vp.name}-1-menu.png` });

  // настройки: открыть через кнопку шестерёнки (top-right)
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button[aria-label]')];
    const gear = btns.find((b) => b.getAttribute('aria-label')?.includes('Настройки'));
    gear?.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${vp.name}-2-settings.png` });
  const hasQuality = await page.evaluate(() => {
    const txt = document.body.innerText;
    return txt.includes('КАЧЕСТВО') || txt.includes('LOW') || txt.includes('MED');
  });
  check(`${vp.name}: фейковый переключатель качества удалён`, !hasQuality);
  // закрыть настройки
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // перекрытия в меню: ищем серьёзные наложения интерактивных элементов
  const overlaps = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.screen-menu button, .screen-menu .map-card, .screen-menu .upg-card')];
    const bad = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        // вложенные элементы (кнопка внутри карточки) — не перекрытие
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const a = els[i].getBoundingClientRect();
        const b = els[j].getBoundingClientRect();
        const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (ox * oy > 0.35 * Math.min(a.width * a.height, b.width * b.height)) {
          bad.push(`${els[i].className} × ${els[j].className}`);
        }
      }
    }
    return bad;
  });
  check(`${vp.name}: нет перекрытий кнопок меню`, overlaps.length === 0, overlaps.slice(0, 3).join('; '));

  // заезд
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.startRun(1));
  for (let i = 0; i < 20; i++) {
    const s = await state();
    if (s?.state === 'run') break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${vp.name}-3-run.png` });
  await ctx.close();
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log('consoleErrors:', report.consoleErrors.length, 'pageErrors:', report.pageErrors.length);
if (report.pageErrors.length) console.log(report.pageErrors.slice(0, 3));
await browser.close();
