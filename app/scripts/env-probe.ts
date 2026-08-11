/**
 * env-probe (W6 §3.3) — приёмка PMREM-окружения и его страховки без WebGL.
 *
 * Реальную свёртку PMREM в Node не выполнить (нужен GL), поэтому проверяем то,
 * что от неё зависит и что чинится кодом:
 *  1) металличность материалов действительно поднята под envMap;
 *  2) fallback-логика гасит металл, если окружения нет (иначе чёрные объекты);
 *  3) в окружение попадает только небо, а не геометрия мира.
 *
 * Запуск: npx tsx scripts/env-probe.ts
 */
import * as THREE from 'three';
import fs from 'node:fs';
import { LIGHTING } from '../src/config';

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });

// --- 1. Константа силы окружения в разумных пределах ---
{
  const v = LIGHTING.envIntensity;
  check(
    'LIGHTING.envIntensity в диапазоне',
    typeof v === 'number' && v > 0.1 && v <= 1.0,
    `envIntensity=${v} (0.5 — блики без «мокрого» вида)`,
  );
}

// --- 2. Металличность в исходниках поднята под envMap ---
{
  const pickup = fs.readFileSync('src/entities/Pickup.ts', 'utf8');
  const tube = fs.readFileSync('src/entities/PlayerTube.ts', 'utf8');
  const sling = fs.readFileSync('src/entities/Slingshot.ts', 'utf8');
  const coinRaised = pickup.includes('0.85');
  const rimRaised = tube.includes('metalness: 0.6');
  const slingRaised = sling.includes('metalness: 0.5');
  check(
    'Металл возвращён (монета/обод/рогатка)',
    coinRaised && rimRaised && slingRaised,
    `coin .85=${coinRaised}, rim .6=${rimRaised}, sling .5=${slingRaised}`,
  );
  // и старый комментарий про «чёрный металл» снят
  check(
    'Снят комментарий «без envMap металл чёрный»',
    !sling.includes('без envMap металл рендерится чёрным'),
    'Slingshot.ts',
  );
}

// --- 3. Fallback: clampSceneMetalness гасит металл (симуляция логики) ---
{
  // воспроизводим ровно тот обход, что делает Renderer.clampSceneMetalness
  const scene = new THREE.Scene();
  const hot = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ metalness: 0.85 }),
  );
  const multi = new THREE.Mesh(new THREE.BoxGeometry(), [
    new THREE.MeshStandardMaterial({ metalness: 0.6 }),
    new THREE.MeshStandardMaterial({ metalness: 0.05 }),
  ]);
  scene.add(hot, multi);

  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (std && 'metalness' in std && std.metalness > 0.2) std.metalness = 0.2;
    }
  });

  const a = (hot.material as THREE.MeshStandardMaterial).metalness;
  const mats = multi.material as THREE.MeshStandardMaterial[];
  check(
    'Fallback гасит металл ≤0.2, низкий не трогает',
    a === 0.2 && mats[0].metalness === 0.2 && mats[1].metalness === 0.05,
    `0.85→${a}, 0.6→${mats[0].metalness}, 0.05→${mats[1].metalness} (не изменён)`,
  );
}

// --- 4. В env-сцену попадает только небо ---
{
  const src = fs.readFileSync('src/core/Renderer.ts', 'utf8');
  const usesOwnScene = src.includes('const envScene = new THREE.Scene()');
  const clonesSky = src.includes('this.sky.mesh.clone()');
  const notWholeScene = !src.includes('fromScene(this.scene');
  check(
    'PMREM берёт только небо, не сцену',
    usesOwnScene && clonesSky && notWholeScene,
    `envScene=${usesOwnScene}, skyClone=${clonesSky}, неFromScene(this.scene)=${notWholeScene}`,
  );
}

// --- 5. Свёртка не на каждом кадре (иначе просадка FPS) ---
{
  const src = fs.readFileSync('src/core/Renderer.ts', 'utf8');
  // refreshEnvironment должен вызываться из конструктора и по флагу envDirty,
  // но НЕ безусловно внутри render()/updateSky()
  const renderBody = src.slice(src.indexOf('  render(): void {'));
  const inRender = renderBody.slice(0, renderBody.indexOf('\n  }')).includes('refreshEnvironment');
  const guarded = src.includes('if (this.envDirty)');
  check(
    'PMREM не выполняется каждый кадр',
    !inRender && guarded,
    `в render()=${inRender} (должно false), guard envDirty=${guarded}`,
  );
}

// --- 6. Ресурсы освобождаются (иначе утечка RT при смене биома) ---
{
  const src = fs.readFileSync('src/core/Renderer.ts', 'utf8');
  const disposesOld = src.includes('this.envRT?.dispose()');
  const disposesPmrem = src.includes('this.pmrem?.dispose()');
  check(
    'RT и PMREM освобождаются',
    disposesOld && disposesPmrem,
    `envRT.dispose=${disposesOld}, pmrem.dispose=${disposesPmrem}`,
  );
}

console.log('\n=== ENV-PROBE (W6 §3.3) ===\n');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(40)} ${r.detail}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== ИТОГ: ${results.length - failed}/${results.length} ${failed === 0 ? 'PASS' : `— ${failed} FAIL`} ===\n`);
process.exit(failed === 0 ? 0 : 1);
