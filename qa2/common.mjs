// Shared helpers for SNOW RUSH 3D QA
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';

export const URL = 'http://127.0.0.1:5199/';
export const SHOT_DIR = '/mnt/agents/output/qa2/';

export async function launch(viewport = { width: 1280, height: 720 }) {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedReqs = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(`${r.status()} ${r.url()}`); });
  return { browser, ctx, page, consoleErrors, pageErrors, failedReqs };
}

export async function waitMenu(page, timeout = 30000) {
  await page.waitForFunction(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    return h && h.getState && h.getState().state === 'menu';
  }, null, { timeout });
}

export async function canvasPixelCheck(page) {
  return await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return { ok: false, reason: 'no canvas' };
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    // read via 2d copy to avoid context conflicts
    const off = document.createElement('canvas');
    off.width = 160; off.height = 90;
    const octx = off.getContext('2d');
    octx.drawImage(c, 0, 0, 160, 90);
    const d = octx.getImageData(0, 0, 160, 90).data;
    let sum = 0, sumSq = 0, n = 0;
    const colors = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += lum; sumSq += lum * lum; n++;
      colors.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    }
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    return {
      ok: std > 5 && colors.size > 20,
      w: c.width, h: c.height,
      meanLum: +mean.toFixed(1), stdLum: +std.toFixed(1),
      distinctColors16: colors.size,
    };
  });
}

export async function rendererInfo(page) {
  return await page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    if (!d || !d.renderer) return { ok: false, reason: 'no diagnostics.renderer' };
    const i = d.renderer; // diagnostics.renderer IS renderer.info per Game.ts:769
    return { ok: true, calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : -1 };
  });
}
