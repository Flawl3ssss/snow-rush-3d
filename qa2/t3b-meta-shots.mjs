// Retake meta screen screenshots with proper waits
import { launch, waitMenu, URL, SHOT_DIR } from './common.mjs';
const { browser, page, consoleErrors, pageErrors } = await launch({ width: 1280, height: 720 });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await waitMenu(page);
await page.waitForTimeout(1500);

async function openAndShoot(imgName, shot, closeSelector) {
  const btn = page.locator(`button:has(img[src*="${imgName}"]):visible`).first();
  await btn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: SHOT_DIR + shot });
  // close
  const x = page.locator('button:has-text("✕"):visible').first();
  if (await x.count()) await x.click(); else await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
}

await openAndShoot('icon-tasks', '08-tasks.png');
await openAndShoot('icon-chest', '09-chest.png');
await openAndShoot('icon-shop', '10-shop.png');
await openAndShoot('icon-gear', '11-settings.png');
await openAndShoot('menu-penguin', '12-stats.png');

console.log(JSON.stringify({ consoleErrors, pageErrors }));
await browser.close();
