import * as THREE from 'three';
import { COLORS, TRACK, VISUAL } from '@/config';
import type { Track } from '@/entities/Track';
import type { Rng } from '@/utils/random';
import { createWorldMaterials } from './materials';
import {
  makeEdgeLumpGeometry,
  makeIglooGeometry,
  makePineGeometry,
  makeRockGeometry,
  makeSignGeometry,
  makeSnowmanGeometry,
  makeWindmill,
  makeLighthouse,
  makeGarlandGeometry,
  mergeParts,
  trs,
} from './props';
import { AssetLib } from '@/systems/AssetLib';
import type { ModelName } from '@/systems/AssetLib';

/**
 * WorldDecor — боковой декор долины (gdd §7.3: вне halfW+2).
 * Весь повторяющийся декор — InstancedMesh по семействам (ёлки ×3 варианта,
 * скалы, снеговики, знаки ×2 направления, сугробы кромки) → ~8 draw calls
 * на тысячи объектов. Ветряки/маяки/иглу — одиночные группы (мало на трассу).
 * Строится per-run (seeded), dispose — через контент заезда.
 */

export interface WorldDecorResult {
  group: THREE.Group;
  /** Объекты, которые Game вращает (rotation.z): лопасти ветряков, лучи маяков. */
  windmillBlades: THREE.Object3D[];
  /** W4: материалы с живым огнём (факелы) — Game мерцает emissiveIntensity. */
  flickerMats: THREE.MeshStandardMaterial[];
}

interface ObstacleHint {
  x: number;
  s: number;
  r: number;
}

/** Профиль ветрового покачивания: амплитуды и темп по типу декора. */
interface SwayProfile {
  /** Ключ кэша программы. ОБЯЗАН быть уникальным на профиль: Three кэширует
   *  скомпилированный шейдер по этому ключу, и при совпадении ключей флаги
   *  молча получат программу ёлок (амплитуда не изменится). */
  key: string;
  ampX: number;
  ampZ: number;
  freqX: number;
  freqZ: number;
}

const SWAY_PINE: SwayProfile = { key: 'pine-wind-sway', ampX: 0.035, ampZ: 0.02, freqX: 1.4, freqZ: 1.1 };
/** W4: ткань полощется заметно сильнее и чаще хвои. */
const SWAY_FLAG: SwayProfile = { key: 'flag-wind-sway', ampX: 0.075, ampZ: 0.045, freqX: 2.6, freqZ: 2.1 };

/** Ветровое покачивание (shader-cookbook (c): амбиент, не геймплей). */
function injectSway(mat: THREE.MeshStandardMaterial, profile: SwayProfile = SWAY_PINE): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    mat.userData.shader = shader;
    shader.vertexShader =
      'uniform float uTime;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float swayPhase = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 1.3;
         #else
           float swayPhase = 0.0;
         #endif
         float swayH = max(position.y, 0.0);
         transformed.x += sin(uTime * ${profile.freqX.toFixed(2)} + swayPhase) * ${profile.ampX.toFixed(3)} * swayH;
         transformed.z += cos(uTime * ${profile.freqZ.toFixed(2)} + swayPhase) * ${profile.ampZ.toFixed(3)} * swayH;`,
      );
  };
  mat.customProgramCacheKey = () => profile.key;
}

function makeSwayMaterial(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const mat = base.clone();
  injectSway(mat);
  return mat;
}

/**
 * InstancedMesh-набор из GLB-модели (по материалам), опционально с ветровым
 * покачиванием и per-instance тинтами. null — если модель не загружена.
 */
function glbInstanced(
  model: ModelName,
  matrices: THREE.Matrix4[],
  tints: THREE.Color[] | null,
  castShadow: boolean,
  sway: boolean,
  swayProfile: SwayProfile = SWAY_PINE,
): THREE.Group | null {
  if (!AssetLib.has(model) || matrices.length === 0) return null;
  const g = new THREE.Group();
  for (const part of AssetLib.mergedParts(model)) {
    let mat = part.material as THREE.MeshStandardMaterial;
    if (sway) {
      mat = mat.clone();
      injectSway(mat, swayProfile);
    }
    const mesh = new THREE.InstancedMesh(part.geometry, mat, matrices.length);
    matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      if (tints) mesh.setColorAt(i, tints[i]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false; // инстансы размазаны по всей трассе
    if (sway) {
      mesh.onBeforeRender = () => {
        const sh = mat.userData.shader as { uniforms: { uTime: { value: number } } } | undefined;
        if (sh) sh.uniforms.uTime.value = performance.now() / 1000;
      };
    }
    g.add(mesh);
  }
  return g;
}

function fillInstances(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: THREE.Matrix4[],
  tints: THREE.Color[] | null,
  castShadow: boolean,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    if (tints) mesh.setColorAt(i, tints[i]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = false;
  mesh.computeBoundingSphere();
  return mesh;
}

export function buildWorldDecor(
  track: Track,
  rng: Rng,
  obstacles: ObstacleHint[],
): WorldDecorResult {
  const group = new THREE.Group();
  group.name = 'worldDecor';
  const mats = createWorldMaterials();
  const windmillBlades: THREE.Object3D[] = [];
  const flickerMats: THREE.MeshStandardMaterial[] = [];
  const dummy = new THREE.Object3D();
  const tmpPos = new THREE.Vector3();

  /** Минимальная высота террейна под пятном ±e (snap-to-ground для декора). */
  const groundMin = (x: number, s: number, e: number): number =>
    Math.min(
      track.heightAt(x, s),
      track.heightAt(x - e, s - e),
      track.heightAt(x + e, s - e),
      track.heightAt(x - e, s + e),
      track.heightAt(x + e, s + e),
    );

  const place = (x: number, s: number, scale: number, yaw: number): THREE.Matrix4 => {
    track.worldPos(x, s, 0, tmpPos);
    // snap: опора на минимальную точку пятна — декор не парит на склоне.
    // Пятно = 0.9·scale: ровно как в validate-world (footR = 0.9·max(scaleXZ)),
    // иначе на крутых сбросах разница пятен даёт ложное «утонул».
    tmpPos.y = groundMin(x, s, 0.9 * scale) - 0.05;
    dummy.position.copy(tmpPos);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };

  // ===== Инстансим ёлки (3 варианта), скалы, снеговиков по бокам =====
  const treeMatrices: THREE.Matrix4[][] = [[], [], []];
  const treeTints: THREE.Color[][] = [[], [], []];
  const rockMatrices: THREE.Matrix4[] = [];
  const snowmanMatrices: THREE.Matrix4[] = [];

  // Крутые стены (каньон wallMul 2.1): декор не лезет на стену — держим ближе к трассе
  const wallMul = track.profile.wallMul ?? 1;
  const decorMaxX = wallMul > 1.3 ? 20 : TRACK.groundHalfW - 3;

  for (let s = 10; s < track.length - 20; s += rng.range(VISUAL.decor.spacingMin, VISUAL.decor.spacingMax)) {
    for (const side of [-1, 1]) {
      if (!rng.chance(VISUAL.decor.chance)) continue;
      const x = side * rng.range(TRACK.halfW + 3, decorMaxX);
      const roll = rng.next();
      const js = s + rng.range(-3, 3);
      if (roll < 0.62) {
        const variant = rng.int(0, 2);
        treeMatrices[variant].push(place(x, js, rng.range(0.75, 1.5), rng.range(0, Math.PI * 2)));
        // лёгкая вариация оттенка между экземплярами
        treeTints[variant].push(
          new THREE.Color(1, 1, 1).lerp(new THREE.Color(0.82, 0.9, 0.86), rng.next() * 0.6),
        );
      } else if (roll < 0.87) {
        rockMatrices.push(place(x, js, rng.range(0.7, 1.6), rng.range(0, Math.PI * 2)));
      } else {
        snowmanMatrices.push(place(x, js, rng.range(0.85, 1.15), rng.range(-0.4, 0.4)));
      }
    }
  }

  // GLB-варианты (AssetLib) с фолбэком на процедурные геометрии
  const treeModels: ModelName[] = ['pine1', 'pine2', 'pines3'];
  const useGlbTrees = treeModels.some((m) => AssetLib.has(m));
  if (useGlbTrees) {
    treeModels.forEach((model, i) => {
      const g = glbInstanced(model, treeMatrices[i], treeTints[i], true, true);
      if (g) group.add(g);
    });
  } else {
    const swayMat = makeSwayMaterial(mats.vertexFlat);
    const pineGeos = [
      makePineGeometry(0, rng),
      makePineGeometry(1, rng),
      makePineGeometry(2, rng),
    ];
    pineGeos.forEach((geo, i) => {
      if (treeMatrices[i].length === 0) return;
      const mesh = fillInstances(geo, swayMat, treeMatrices[i], treeTints[i], true);
      mesh.onBeforeRender = () => {
        const sh = swayMat.userData.shader as { uniforms: { uTime: { value: number } } } | undefined;
        if (sh) sh.uniforms.uTime.value = performance.now() / 1000;
      };
      group.add(mesh);
    });
  }
  if (rockMatrices.length > 0) {
    const g = glbInstanced('rocks', rockMatrices, null, true, false);
    if (g) group.add(g);
    else group.add(fillInstances(makeRockGeometry(rng), mats.vertexFlat, rockMatrices, null, true));
  }
  if (snowmanMatrices.length > 0) {
    const g = glbInstanced('snowman', snowmanMatrices, null, true, false);
    if (g) group.add(g);
    else
      group.add(
        fillInstances(makeSnowmanGeometry(true), mats.vertexFlat, snowmanMatrices, null, true),
      );
  }

  // ===== Флажки по кромкам трассы — оптический поток = ощущение скорости =====
  if (AssetLib.has('flag')) {
    const flagMatrices: THREE.Matrix4[] = [];
    for (let s = 20; s < track.finishDistance + 40; s += 14) {
      const side = Math.floor(s / 14) % 2 === 0 ? -1 : 1; // шахматный порядок
      flagMatrices.push(place(side * (TRACK.halfW + 0.9), s, 0.55, side > 0 ? Math.PI : 0));
    }
    const flags = glbInstanced('flag', flagMatrices, null, false, true, SWAY_FLAG);
    if (flags) group.add(flags);
  }

  // ===== Мега-фичи биомов (W2): факелы, айсберги, мёртвые деревья, кристаллы =====
  const biome = track.profile.biome ?? 'valley';

  // Вулкан/пещеры: факелы вдоль кромок (световые ориентиры, фликер — W4)
  if ((biome === 'volcano' || biome === 'caves') && AssetLib.has('torch')) {
    const torchMatrices: THREE.Matrix4[] = [];
    for (let s = 60; s < track.finishDistance + 60; s += 26) {
      const side = Math.floor(s / 26) % 2 === 0 ? -1 : 1;
      torchMatrices.push(place(side * (TRACK.halfW + 1.4), s, 1, side > 0 ? Math.PI : 0));
    }
    const torches = glbInstanced('torch', torchMatrices, null, false, false);
    if (torches) {
      // W4: материалы клонируем — AssetLib отдаёт общий инстанс материала,
      // и правка emissiveIntensity «на месте» протекла бы на другие модели.
      torches.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.MeshStandardMaterial;
        if (!src || !src.isMeshStandardMaterial) return;
        const m = src.clone();
        // пламя должно светиться даже если в исходной модели emissive пуст
        if (m.emissive.getHex() === 0x000000) m.emissive.setHex(0xff7a2a);
        m.emissiveIntensity = 1.1;
        m.userData.flickerPhase = Math.random() * Math.PI * 2;
        mesh.material = m;
        flickerMats.push(m);
      });
      group.add(torches);
    }
  }

  // Пещеры: светящиеся кристаллы у стен
  if (biome === 'caves' && AssetLib.has('crystal')) {
    const crystalMatrices: THREE.Matrix4[] = [];
    for (let s = 90; s < track.finishDistance; s += 34) {
      const side = rng.sign();
      crystalMatrices.push(
        place(side * rng.range(TRACK.halfW + 2.5, TRACK.halfW + 6), s + rng.range(-6, 6), rng.range(0.7, 1.3), rng.range(0, Math.PI * 2)),
      );
    }
    const crystals = glbInstanced('crystal', crystalMatrices, null, false, false);
    if (crystals) group.add(crystals);
  }

  // Аврора: айсберги на дальних склонах (силуэты на фоне неба)
  if (biome === 'aurora' && AssetLib.has('iceberg')) {
    const bergMatrices: THREE.Matrix4[] = [];
    for (let s = 120; s < track.finishDistance + 100; s += 85) {
      const side = rng.sign();
      bergMatrices.push(
        place(side * rng.range(TRACK.groundHalfW - 8, TRACK.groundHalfW + 14), s + rng.range(-20, 20), rng.range(0.8, 1.6), rng.range(0, Math.PI * 2)),
      );
    }
    const bergs = glbInstanced('iceberg', bergMatrices, null, true, false);
    if (bergs) group.add(bergs);
  }

  // Вулкан: мёртвые деревья вместо части зелёных елей (выжженный склон)
  if (biome === 'volcano' && AssetLib.has('deadTrees')) {
    const deadMatrices: THREE.Matrix4[] = [];
    for (let s = 50; s < track.finishDistance; s += 21) {
      const side = rng.sign();
      deadMatrices.push(
        place(side * rng.range(TRACK.halfW + 3.5, TRACK.groundHalfW - 6), s + rng.range(-5, 5), rng.range(0.7, 1.2), rng.range(0, Math.PI * 2)),
      );
    }
    const dead = glbInstanced('deadTrees', deadMatrices, null, true, false);
    if (dead) group.add(dead);
  }

  // ===== Сугробы по кромкам трассы (читаемость границы, 1 draw call) =====
  const lumpMatrices: THREE.Matrix4[] = [];
  for (let s = -8; s < track.finishDistance + 60; s += VISUAL.decor.edgeLumpEvery) {
    for (const side of [-1, 1]) {
      if (!rng.chance(0.8)) continue;
      lumpMatrices.push(
        place(side * rng.range(TRACK.halfW + 0.7, TRACK.halfW + 2.2), s + rng.range(-2, 2), rng.range(0.6, 1.4), rng.range(0, Math.PI)),
      );
    }
  }
  const lumpMesh = fillInstances(makeEdgeLumpGeometry(), mats.snowShadow, lumpMatrices, null, false);
  group.add(lumpMesh);

  // ===== Знаки-стрелки перед опасными секциями (gdd readability) =====
  const sorted = [...obstacles].sort((a, b) => a.s - b.s);
  const signMatrices: THREE.Matrix4[][] = [[], []]; // [dir=+1, dir=-1]
  let i = 0;
  let lastSignS = -60;
  while (i < sorted.length) {
    // кластер: препятствия с зазором < 15 м
    let j = i;
    let sumX = 0;
    while (j < sorted.length && (j === i || sorted[j].s - sorted[j - 1].s < 15)) {
      sumX += sorted[j].x;
      j += 1;
    }
    const clusterSize = j - i;
    const clusterStart = sorted[i].s;
    if (clusterSize >= 2 && clusterStart > 60 && clusterStart - 16 > lastSignS + 30) {
      const avgX = sumX / clusterSize;
      const side = avgX >= 0 ? 1 : -1;
      // стрелка от кластера → к безопасной стороне: кластер справа → стрелка влево (dir=-1)
      const dirIdx = side === 1 ? 1 : 0;
      signMatrices[dirIdx].push(place(side * (TRACK.halfW + 2.2), clusterStart - 14, 1, 0));
      lastSignS = clusterStart - 14;
    }
    i = j;
  }
  const signDirs: Array<1 | -1> = [1, -1];
  signMatrices.forEach((matrices, idx) => {
    if (matrices.length === 0) return;
    group.add(fillInstances(makeSignGeometry(signDirs[idx]), mats.vertexFlat, matrices, null, true));
  });

  // ===== Ветряки (1 на ~500 м) =====
  for (let s = 220; s < track.length - 100; s += VISUAL.decor.windmillEvery) {
    const side = rng.sign();
    const mill = makeWindmill(mats.vertexFlat, mats.vertexFlat);
    const mx = side * (TRACK.groundHalfW - 5);
    const ms = s + rng.range(-40, 40);
    track.worldPos(mx, ms, 0, mill.position);
    mill.position.y = groundMin(mx, ms, 2.5) - 0.1;
    mill.rotation.y = side > 0 ? -0.5 : 0.5; // лопасти к трассе
    const blades = mill.getObjectByName('windmillBlades');
    if (blades) windmillBlades.push(blades);
    group.add(mill);
  }

  // ===== Маяки (1 на ~500 м, со сдвигом от ветряков) =====
  for (let s = 470; s < track.length - 100; s += VISUAL.decor.lighthouseEvery) {
    const side = rng.sign();
    const { group: lh, beaconHolder } = makeLighthouse(mats.vertexFlat);
    const lx = side * (TRACK.groundHalfW - 4);
    const ls = s + rng.range(-30, 30);
    track.worldPos(lx, ls, 0, lh.position);
    lh.position.y = groundMin(lx, ls, 2) - 0.1;
    lh.rotation.y = rng.range(0, Math.PI * 2);
    windmillBlades.push(beaconHolder); // Game вращает — луч метёт горизонт
    group.add(lh);
  }

  // ===== Деревня иглу (2–3 купола на площадку) =====
  const iglooMatrices: THREE.Matrix4[] = [];
  const iglooGeo = makeIglooGeometry();
  for (let s = 320; s < track.finishDistance; s += 380) {
    if (!rng.chance(0.7)) continue;
    const side = rng.sign();
    const baseX = side * rng.range(TRACK.halfW + 6, TRACK.groundHalfW - 8);
    const count = rng.int(2, 3);
    for (let k = 0; k < count; k += 1) {
      const ix = baseX + rng.range(-4, 4);
      const is = s + k * rng.range(5, 9) + rng.range(-2, 2);
      iglooMatrices.push(place(ix, is, rng.range(0.85, 1.2), rng.range(0, Math.PI * 2)));
    }
  }
  if (iglooMatrices.length > 0) {
    const g = glbInstanced('igloo', iglooMatrices, null, true, false);
    if (g) group.add(g);
    else group.add(fillInstances(iglooGeo, mats.vertexFlat, iglooMatrices, null, true));
  }

  // ===== Стартовая площадка: большой снеговик + домик + гирлянда =====
  let santa: THREE.Object3D;
  if (AssetLib.has('snowman')) {
    santa = AssetLib.clone('snowman');
    santa.scale.setScalar(1.6);
  } else {
    santa = new THREE.Mesh(makeSnowmanGeometry(true), mats.vertexFlat);
    santa.scale.setScalar(1.6);
    santa.castShadow = true;
  }
  track.worldPos(-(TRACK.halfW + 4.5), 5, 0, santa.position);
  santa.rotation.y = 0.5;
  group.add(santa);

  // Домик у старта (меню-витрина)
  if (AssetLib.has('cabin')) {
    const cabin = AssetLib.clone('cabin');
    track.worldPos(TRACK.halfW + 7.5, -14, 0, cabin.position);
    cabin.position.y = groundMin(TRACK.halfW + 7.5, -14, 3) - 0.1;
    cabin.rotation.y = -0.9; // лицом к стартовой площадке
    group.add(cabin);
  }

  // Гирлянда над стартовой линией: два полосатых столба + провес лампочек
  const poleGeo = mergeParts([
    { geo: new THREE.CylinderGeometry(0.09, 0.12, 3.4, 6), color: COLORS.accentRed, matrix: trs(0, 1.7, 0) },
    { geo: new THREE.CylinderGeometry(0.11, 0.13, 0.5, 6), color: 0xffffff, matrix: trs(0, 1.1, 0) },
    { geo: new THREE.CylinderGeometry(0.11, 0.13, 0.5, 6), color: 0xffffff, matrix: trs(0, 2.2, 0) },
    { geo: new THREE.SphereGeometry(0.14, 6, 5), color: COLORS.coinGold, matrix: trs(0, 3.5, 0) },
  ]);
  const garlandSpan = TRACK.halfW * 2 + 3;
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(poleGeo, mats.vertexFlat);
    track.worldPos(side * (garlandSpan / 2), 12, 0, pole.position);
    pole.castShadow = true;
    group.add(pole);
  }
  const garland = new THREE.Mesh(
    makeGarlandGeometry(garlandSpan, 1.1, 15),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.6,
      emissive: 0xfff6d8,
      emissiveIntensity: 0.2,
    }),
  );
  track.worldPos(0, 12, 0, garland.position);
  garland.position.y += 3.3;
  group.add(garland);

  return { group, windmillBlades, flickerMats };
}
