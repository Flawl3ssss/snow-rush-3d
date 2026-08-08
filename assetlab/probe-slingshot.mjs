// Проба структуры slingshot.glb: имена/позиции нод + bbox детей.
import { chromium } from '/home/kimi/.npm-global/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5191/assetlab/viewer.html?src=/assetlab/glb/slingshot.glb');
await page.waitForFunction(() => window.__done === true, { timeout: 30000 });
const info = await page.evaluate(async () => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('/assetlab/vendor/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync('/assetlab/glb/slingshot.glb');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const out = [];
  const walk = (o, depth) => {
    const box = o.isMesh ? new THREE.Box3().setFromObject(o) : null;
    out.push({
      depth,
      name: o.name || '(anon)',
      type: o.type,
      pos: o.position.toArray().map((v) => +v.toFixed(2)),
      box: box
        ? {
            min: box.min.toArray().map((v) => +v.toFixed(2)),
            max: box.max.toArray().map((v) => +v.toFixed(2)),
          }
        : null,
      matColor: o.material?.color?.getHexString?.() ?? null,
    });
    o.children.forEach((c) => walk(c, depth + 1));
  };
  walk(scene, 0);
  const total = new THREE.Box3().setFromObject(scene);
  return { nodes: out, total: { min: total.min.toArray(), max: total.max.toArray() } };
});
for (const n of info.nodes) {
  console.log(
    '  '.repeat(n.depth) + `${n.name} [${n.type}] pos=${n.pos} color=#${n.matColor ?? '-'}`,
    n.box ? `box x[${n.box.min[0]}..${n.box.max[0]}] y[${n.box.min[1]}..${n.box.max[1]}] z[${n.box.min[2]}..${n.box.max[2]}]` : '',
  );
}
console.log('TOTAL', info.total.min.map((v) => v.toFixed(2)), info.total.max.map((v) => v.toFixed(2)));
await browser.close();
