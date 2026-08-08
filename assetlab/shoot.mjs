// Рендер GLB-моделей через вьювер: общий вид + изоляция узлов пингвина/тюба.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const OUT = '/mnt/agents/output/assetlab/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 480, height: 480 } });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

const jobs = [
  ['penguin_all', '/assetlab/glb/penguin.glb', {}],
  ['penguin_n0', '/assetlab/glb/penguin.glb', { only: '0' }],
  ['penguin_n1', '/assetlab/glb/penguin.glb', { only: '1' }],
  ['penguin_n2', '/assetlab/glb/penguin.glb', { only: '2' }],
  ['penguin_n3', '/assetlab/glb/penguin.glb', { only: '3' }],
  ['penguin_n4', '/assetlab/glb/penguin.glb', { only: '4' }],
  ['tube_all', '/assetlab/glb/tube_flamingo.glb', {}],
  ['tube_n0', '/assetlab/glb/tube_flamingo.glb', { only: '0' }],
  ['tube_n1', '/assetlab/glb/tube_flamingo.glb', { only: '1' }],
  ['tube_n2', '/assetlab/glb/tube_flamingo.glb', { only: '2' }],
  ['tube_n3', '/assetlab/glb/tube_flamingo.glb', { only: '3' }],
  ['tube_n4', '/assetlab/glb/tube_flamingo.glb', { only: '4' }],
  ['tube_n5', '/assetlab/glb/tube_flamingo.glb', { only: '5' }],
  ['tube_n6', '/assetlab/glb/tube_flamingo.glb', { only: '6' }],
  ['tube_n7', '/assetlab/glb/tube_flamingo.glb', { only: '7' }],
  ['tube_n8', '/assetlab/glb/tube_flamingo.glb', { only: '8' }],
  ['tube_n9', '/assetlab/glb/tube_flamingo.glb', { only: '9' }],
  ['tube_n10', '/assetlab/glb/tube_flamingo.glb', { only: '10' }],
  ['slingshot', '/assetlab/glb/slingshot.glb', {}],
  ['snowman', '/assetlab/glb/snowman.glb', {}],
  ['igloo', '/assetlab/glb/igloo.glb', {}],
  ['pine_snow', '/assetlab/glb/pine_snow.glb', {}],
  ['chest', '/assetlab/glb/chest.glb', {}],
  ['rocket', '/assetlab/glb/rocket.glb', {}],
  ['coin', '/assetlab/glb/coin.glb', {}],
  ['gem', '/assetlab/glb/gem.glb', {}],
  ['crystal', '/assetlab/glb/crystal.glb', {}],
  ['flag', '/assetlab/glb/flag.glb', {}],
  ['torch', '/assetlab/glb/torch.glb', {}],
  ['iceberg', '/assetlab/glb/iceberg.glb', {}],
  ['boulder_snow', '/assetlab/glb/boulder_snow.glb', {}],
  ['rocks', '/assetlab/glb/rocks.glb', {}],
  ['snowy_trees', '/assetlab/glb/snowy_trees.glb', {}],
  ['dead_trees', '/assetlab/glb/dead_trees.glb', {}],
  ['pine_snow2', '/assetlab/glb/pine_snow2.glb', {}],
  ['penguin_alt', '/assetlab/glb/penguin_alt.glb', {}],
];

for (const [name, src, extra] of jobs) {
  const params = new URLSearchParams({ src, ...extra });
  await page.goto(`http://127.0.0.1:5191/assetlab/viewer.html?${params}`, { waitUntil: 'networkidle' });
  try {
    await page.waitForFunction('window.__done === true', { timeout: 8000 });
  } catch { console.log('TIMEOUT', name); }
  const names = await page.evaluate('window.__names');
  if (extra.only || name.endsWith('_all')) console.log(name, '→', JSON.stringify(names));
  await page.screenshot({ path: `${OUT}/${name}.png` });
}
await browser.close();
console.log('done');
