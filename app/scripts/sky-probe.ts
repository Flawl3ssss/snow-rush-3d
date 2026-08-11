/**
 * sky-probe (W6 §3.2) — приёмка небосвода без WebGL.
 *
 * SkyDome конструирует ShaderMaterial и SphereGeometry; ни то, ни другое не
 * требует GL-контекста (компиляция шейдера происходит при первом рендере),
 * поэтому логику палитр и блендинга можно проверить в Node.
 *
 * Отдельно валидируем GLSL текстово: несбалансированные скобки или
 * незадекларированный uniform в Node не всплывут, а в браузере дадут чёрный
 * экран — дешёвая проверка окупается.
 *
 * Запуск: npx tsx scripts/sky-probe.ts
 */
import * as THREE from 'three';
import { SkyDome, lookForBiome } from '../src/world/SkyDome';
import { MAPS } from '../src/config';

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });

const sunDir = new THREE.Vector3(-40, 60, -20);

// --- 1. Каждый биом из MAPS получает валидную палитру неба ---
{
  let allOk = true;
  const parts: string[] = [];
  for (const map of MAPS) {
    const biome = map.track.biome;
    const look = lookForBiome(biome, map.palette);
    const finite =
      [look.horizon, look.mid, look.zenith, look.sun].every(
        (c) => Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b),
      ) &&
      look.sunPower >= 0 &&
      look.sunPower <= 2 &&
      look.clouds >= 0 &&
      look.clouds <= 1;
    if (!finite) allOk = false;
    parts.push(`${biome}:sun${look.sunPower.toFixed(2)}/cl${look.clouds.toFixed(2)}`);
  }
  check(`Палитры всех ${MAPS.length} биомов валидны`, allOk, parts.join(' '));
}

// --- 2. Биомы визуально различимы (не один и тот же градиент) ---
{
  const looks = MAPS.map((m) => lookForBiome(m.track.biome, m.palette));
  let minDist = Infinity;
  let pair = '';
  for (let i = 0; i < looks.length; i++) {
    for (let j = i + 1; j < looks.length; j++) {
      const a = looks[i];
      const b = looks[j];
      const d =
        Math.abs(a.horizon.r - b.horizon.r) +
        Math.abs(a.horizon.g - b.horizon.g) +
        Math.abs(a.horizon.b - b.horizon.b) +
        Math.abs(a.zenith.r - b.zenith.r) +
        Math.abs(a.zenith.g - b.zenith.g) +
        Math.abs(a.zenith.b - b.zenith.b);
      if (d < minDist) {
        minDist = d;
        pair = `${MAPS[i].track.biome}/${MAPS[j].track.biome}`;
      }
    }
  }
  check('Биомы различимы по цвету', minDist > 0.15, `min Δ=${minDist.toFixed(3)} (${pair})`);
}

// --- 3. Пещеры темнее долины (сумрак), вулкан теплее (багровый горизонт) ---
{
  const valley = lookForBiome('valley', MAPS[0].palette);
  const caves = lookForBiome('caves', MAPS.find((m) => m.track.biome === 'caves')!.palette);
  const volcano = lookForBiome('volcano', MAPS.find((m) => m.track.biome === 'volcano')!.palette);
  const cavesDark = caves.sunPower < valley.sunPower;
  const volcanoWarm = volcano.sun.r > volcano.sun.b;
  check(
    'caves сумрачнее, volcano теплее',
    cavesDark && volcanoWarm,
    `caves sunPower=${caves.sunPower} < valley ${valley.sunPower}; volcano sun r=${volcano.sun.r.toFixed(2)} > b=${volcano.sun.b.toFixed(2)}`,
  );
}

// --- 4. Блендинг: за BLEND_SEC цвет доходит до целевого ---
{
  const from = lookForBiome('valley', MAPS[0].palette);
  const toMap = MAPS.find((m) => m.track.biome === 'volcano')!;
  const to = lookForBiome('volcano', toMap.palette);
  const dome = new SkyDome(sunDir, from);
  dome.setBiome(to);
  // 1.2 с при 60 fps — с запасом больше BLEND_SEC=1.0
  for (let i = 0; i < 72; i++) dome.update(1 / 60, i / 60);
  const u = dome.mesh.material as THREE.ShaderMaterial;
  const gotZen = u.uniforms.uZenith.value as THREE.Color;
  const d =
    Math.abs(gotZen.r - to.zenith.r) + Math.abs(gotZen.g - to.zenith.g) + Math.abs(gotZen.b - to.zenith.b);
  check('Блендинг доходит до цели за 1 с', d < 0.01, `Δ до целевого зенита = ${d.toFixed(4)}`);
  dome.dispose();
}

// --- 5. Смена биома в середине перехода не дёргает цвет назад ---
{
  const valley = lookForBiome('valley', MAPS[0].palette);
  const volcano = lookForBiome('volcano', MAPS.find((m) => m.track.biome === 'volcano')!.palette);
  const aurora = lookForBiome('aurora', MAPS.find((m) => m.track.biome === 'aurora')!.palette);
  const dome = new SkyDome(sunDir, valley);
  const u = (dome.mesh.material as THREE.ShaderMaterial).uniforms;
  dome.setBiome(volcano);
  for (let i = 0; i < 30; i++) dome.update(1 / 60, i / 60); // полперехода
  const mid = (u.uZenith.value as THREE.Color).clone();
  dome.setBiome(aurora); // переключение на полпути
  const justAfter = (u.uZenith.value as THREE.Color).clone();
  const jump =
    Math.abs(mid.r - justAfter.r) + Math.abs(mid.g - justAfter.g) + Math.abs(mid.b - justAfter.b);
  for (let i = 0; i < 72; i++) dome.update(1 / 60, i / 60);
  const end = u.uZenith.value as THREE.Color;
  const reached =
    Math.abs(end.r - aurora.zenith.r) + Math.abs(end.g - aurora.zenith.g) + Math.abs(end.b - aurora.zenith.b);
  check(
    'Перебивание перехода без рывка',
    jump < 0.001 && reached < 0.01,
    `рывок=${jump.toFixed(5)}, дошло до aurora Δ=${reached.toFixed(4)}`,
  );
  dome.dispose();
}

// --- 6. GLSL: скобки сбалансированы и все uniform'ы объявлены в шейдере ---
{
  const dome = new SkyDome(sunDir, lookForBiome('valley', MAPS[0].palette));
  const mat = dome.mesh.material as THREE.ShaderMaterial;
  const frag = mat.fragmentShader;
  const vert = mat.vertexShader;
  const balanced = (src: string) =>
    (src.match(/\{/g) ?? []).length === (src.match(/\}/g) ?? []).length &&
    (src.match(/\(/g) ?? []).length === (src.match(/\)/g) ?? []).length;
  const declared = Object.keys(mat.uniforms).every(
    (name) => frag.includes(`uniform`) && (frag.includes(name) || vert.includes(name)),
  );
  const hasMain = frag.includes('void main') && vert.includes('void main');
  check(
    'GLSL: скобки, uniform-ы, main()',
    balanced(frag) && balanced(vert) && declared && hasMain,
    `frag ${frag.length}b, vert ${vert.length}b, uniforms ${Object.keys(mat.uniforms).length}`,
  );
  dome.dispose();
}

// --- 7. Купол не пишет глубину и не участвует в тумане (иначе перекроет мир) ---
{
  const dome = new SkyDome(sunDir, lookForBiome('valley', MAPS[0].palette));
  const mat = dome.mesh.material as THREE.ShaderMaterial;
  check(
    'Купол: BackSide, depthWrite=false, fog=false',
    mat.side === THREE.BackSide && mat.depthWrite === false && mat.fog === false && dome.mesh.renderOrder === -100,
    `side=${mat.side}, depthWrite=${mat.depthWrite}, fog=${mat.fog}, order=${dome.mesh.renderOrder}`,
  );
  dome.dispose();
}

// --- 8. follow() двигает купол по XZ, но не по Y ---
{
  const dome = new SkyDome(sunDir, lookForBiome('valley', MAPS[0].palette));
  dome.follow(123, -456);
  const p = dome.mesh.position;
  check('follow() по XZ, Y неизменен', p.x === 123 && p.z === -456 && p.y === 0, `pos=(${p.x},${p.y},${p.z})`);
  dome.dispose();
}

console.log('\n=== SKY-PROBE (W6 §3.2) ===\n');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(38)} ${r.detail}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== ИТОГ: ${results.length - failed}/${results.length} ${failed === 0 ? 'PASS' : `— ${failed} FAIL`} ===\n`);
process.exit(failed === 0 ? 0 : 1);
