import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS } from '@/config';
import type { Rng } from '@/utils/random';

/**
 * WorldPropKit — процедурные low-poly пропсы долины (design.md §2.1:
 * всё моделируется кодом, flat shading, vertex colors).
 * Повторяющийся декор строится как ЕДИНАЯ мерджнутая геометрия с запечёнными
 * цветами → один InstancedMesh на семейство (technical-art: instancing).
 */

export interface ColoredPart {
  geo: THREE.BufferGeometry;
  color: number;
  matrix?: THREE.Matrix4;
}

/** TRS-матрица для раскладки партов перед мерджем. */
export function trs(
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = sx,
  sz = sx,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** Мердж партов в одну геометрию с vertex colors (линейное пространство, как Track). */
export function mergeParts(parts: ColoredPart[]): THREE.BufferGeometry {
  const tmp = new THREE.Color();
  const geos: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    if (p.matrix) p.geo.applyMatrix4(p.matrix);
    tmp.setHex(p.color);
    const count = p.geo.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    p.geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(p.geo);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) throw new Error('mergeParts: incompatible geometries');
  return merged;
}

// ---------------------------------------------------------------------------
// Ёлки — 3 варианта силуэта (model-recipes: distinct variants)
// ---------------------------------------------------------------------------

export function makePineGeometry(variant: 0 | 1 | 2, rng: Rng): THREE.BufferGeometry {
  const green = rng.chance(0.5) ? COLORS.pineGreen : COLORS.pineDark;
  const parts: ColoredPart[] = [
    { geo: new THREE.CylinderGeometry(0.16, 0.26, 0.8, 9), color: COLORS.trunk, matrix: trs(0, 0.4, 0) },
  ];
  if (variant === 0) {
    // классическая трёхъярусная со снегом на ярусах
    const tiers: Array<[number, number, number]> = [
      [1.25, 1.5, 1.5],
      [0.95, 1.25, 2.45],
      [0.6, 1.0, 3.25],
    ];
    for (const [r, h, y] of tiers) {
      parts.push({ geo: new THREE.ConeGeometry(r, h, 11), color: green, matrix: trs(0, y, 0) });
      parts.push({
        geo: new THREE.ConeGeometry(r * 0.72, h * 0.32, 11),
        color: COLORS.snowBase,
        matrix: trs(0, y + h * 0.38, 0),
      });
    }
    parts.push({
      geo: new THREE.ConeGeometry(0.22, 0.5, 11),
      color: COLORS.snowBase,
      matrix: trs(0, 3.95, 0),
    });
  } else if (variant === 1) {
    // высокая стройная
    parts.push(
      { geo: new THREE.ConeGeometry(0.95, 2.6, 10), color: green, matrix: trs(0, 1.9, 0) },
      { geo: new THREE.ConeGeometry(0.62, 1.7, 10), color: green, matrix: trs(0, 3.35, 0) },
      { geo: new THREE.ConeGeometry(0.4, 0.6, 10), color: COLORS.snowBase, matrix: trs(0, 4.1, 0) },
      {
        geo: new THREE.ConeGeometry(0.68, 0.5, 10),
        color: COLORS.snowBase,
        matrix: trs(0, 2.95, 0),
      },
    );
  } else {
    // низкая раскидистая
    parts.push(
      { geo: new THREE.ConeGeometry(1.45, 1.5, 12), color: green, matrix: trs(0, 1.25, 0, 0, 0, 0, 1, 0.9, 1) },
      { geo: new THREE.ConeGeometry(1.0, 1.2, 12), color: green, matrix: trs(0, 2.15, 0, 0, 0, 0, 1, 0.9, 1) },
      { geo: new THREE.ConeGeometry(0.55, 0.5, 12), color: COLORS.snowBase, matrix: trs(0, 2.75, 0) },
    );
  }
  return mergeParts(parts);
}

// ---------------------------------------------------------------------------
// Скала: основной массив + спутник + снежная шапка
// ---------------------------------------------------------------------------

export function makeRockGeometry(rng: Rng): THREE.BufferGeometry {
  const main = rng.chance(0.5) ? COLORS.rock : COLORS.rockDark;
  const r = rng.range(0.9, 1.6);
  return mergeParts([
    { geo: new THREE.IcosahedronGeometry(r, 1), color: main, matrix: trs(0, r * 0.45, 0, 0, rng.range(0, 3), 0, 1.15, 0.75, 1) },
    {
      geo: new THREE.IcosahedronGeometry(r * 0.5, 1),
      color: main === COLORS.rock ? COLORS.rockDark : COLORS.rock,
      matrix: trs(r * 0.9, r * 0.22, r * 0.3, 0.3, rng.range(0, 3), 0.2, 1, 0.7, 1),
    },
    {
      geo: new THREE.IcosahedronGeometry(r * 0.62, 1),
      color: COLORS.snowBase,
      matrix: trs(-r * 0.1, r * 0.86, 0, 0.2, 0.4, 0, 1.05, 0.32, 1.05),
    },
  ]);
}

// ---------------------------------------------------------------------------
// Снеговик (декор и тяжёлое препятствие): 3 шара, морковь, угли, шапка Санты
// ---------------------------------------------------------------------------

export function makeSnowmanGeometry(withSantaHat: boolean): THREE.BufferGeometry {
  const parts: ColoredPart[] = [
    { geo: new THREE.SphereGeometry(0.78, 14, 10), color: 0xffffff, matrix: trs(0, 0.72, 0) },
    { geo: new THREE.SphereGeometry(0.55, 13, 10), color: 0xffffff, matrix: trs(0, 1.62, 0) },
    { geo: new THREE.SphereGeometry(0.38, 12, 9), color: 0xffffff, matrix: trs(0, 2.28, 0) },
    // морковный нос (смотрит в +z — к подъезжающему игроку)
    { geo: new THREE.ConeGeometry(0.09, 0.42, 6), color: COLORS.penguinOrange, matrix: trs(0, 2.28, 0.5, Math.PI / 2, 0, 0) },
    // угли-глаза и пуговицы
    { geo: new THREE.SphereGeometry(0.05, 5, 4), color: 0x22314a, matrix: trs(-0.13, 2.38, 0.33) },
    { geo: new THREE.SphereGeometry(0.05, 5, 4), color: 0x22314a, matrix: trs(0.13, 2.38, 0.33) },
    { geo: new THREE.SphereGeometry(0.06, 5, 4), color: 0x22314a, matrix: trs(0, 1.7, 0.52) },
    { geo: new THREE.SphereGeometry(0.06, 5, 4), color: 0x22314a, matrix: trs(0, 1.45, 0.53) },
    // руки-ветки
    { geo: new THREE.CylinderGeometry(0.035, 0.05, 0.9, 5), color: COLORS.trunk, matrix: trs(-0.75, 1.7, 0, 0, 0, 1.1) },
    { geo: new THREE.CylinderGeometry(0.035, 0.05, 0.9, 5), color: COLORS.trunk, matrix: trs(0.75, 1.7, 0, 0, 0, -1.1) },
    // красный шарф
    { geo: new THREE.TorusGeometry(0.32, 0.09, 6, 12), color: COLORS.accentRed, matrix: trs(0, 1.95, 0, Math.PI / 2, 0, 0) },
    { geo: new THREE.BoxGeometry(0.14, 0.4, 0.06), color: COLORS.accentRed, matrix: trs(0.18, 1.68, 0.42, 0, 0, 0.15) },
  ];
  if (withSantaHat) {
    parts.push(
      { geo: new THREE.TorusGeometry(0.28, 0.09, 6, 12), color: 0xffffff, matrix: trs(0, 2.55, 0, Math.PI / 2, 0, 0) },
      { geo: new THREE.ConeGeometry(0.3, 0.65, 8), color: COLORS.accentRed, matrix: trs(0.05, 2.85, 0, 0, 0, -0.18) },
      { geo: new THREE.SphereGeometry(0.09, 6, 5), color: 0xffffff, matrix: trs(0.18, 3.15, 0) },
    );
  }
  return mergeParts(parts);
}

// ---------------------------------------------------------------------------
// Знак-указатель: красная доска, белая стрелка (dir — куда указывает)
// ---------------------------------------------------------------------------

export function makeSignGeometry(dir: 1 | -1): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.CylinderGeometry(0.07, 0.09, 1.5, 6), color: COLORS.trunk, matrix: trs(0, 0.75, 0) },
    { geo: new THREE.BoxGeometry(1.15, 0.6, 0.08), color: COLORS.accentRed, matrix: trs(0, 1.6, 0) },
    { geo: new THREE.BoxGeometry(1.25, 0.7, 0.05), color: COLORS.accentRedDark, matrix: trs(0, 1.6, -0.03) },
    // стрелка: шафт + наконечник
    { geo: new THREE.BoxGeometry(0.5, 0.14, 0.05), color: 0xffffff, matrix: trs(-0.12 * dir, 1.6, 0.05) },
    { geo: new THREE.ConeGeometry(0.18, 0.34, 4), color: 0xffffff, matrix: trs(0.32 * dir, 1.6, 0.05, 0, 0, (-Math.PI / 2) * dir) },
    // снежная шапка на доске
    { geo: new THREE.BoxGeometry(1.2, 0.12, 0.12), color: COLORS.snowBase, matrix: trs(0, 1.95, 0) },
  ]);
}

// ---------------------------------------------------------------------------
// Иглу: купол с «кирпичными» поясами + входной тоннель
// ---------------------------------------------------------------------------

export function makeIglooGeometry(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.SphereGeometry(1.6, 16, 11, 0, Math.PI * 2, 0, Math.PI / 2), color: 0xffffff, matrix: trs(0, 0, 0) },
    // пояса блоков (чуть темнее)
    { geo: new THREE.TorusGeometry(1.28, 0.06, 5, 16), color: COLORS.snowShadow, matrix: trs(0, 0.85, 0, Math.PI / 2, 0, 0, 1, 1, 1.35) },
    { geo: new THREE.TorusGeometry(0.85, 0.06, 5, 14), color: COLORS.snowShadow, matrix: trs(0, 1.32, 0, Math.PI / 2, 0, 0, 1, 1, 1.3) },
    // вход
    { geo: new THREE.BoxGeometry(0.9, 0.85, 0.9), color: 0xffffff, matrix: trs(0, 0.42, 1.55) },
    { geo: new THREE.BoxGeometry(0.55, 0.55, 0.2), color: 0x22314a, matrix: trs(0, 0.28, 2.02) },
    // снежный отлив сверху
    { geo: new THREE.SphereGeometry(0.5, 7, 5), color: COLORS.snowBase, matrix: trs(0, 1.62, 0, 0, 0, 0, 1, 0.4, 1) },
  ]);
}

// ---------------------------------------------------------------------------
// Придорожный сугроб (инстансится вдоль кромок трассы)
// ---------------------------------------------------------------------------

export function makeEdgeLumpGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(0.55, 7, 5).scale(1.4, 0.5, 1).translate(0, 0.12, 0);
}

// ---------------------------------------------------------------------------
// Гирлянда: провес из цветных лампочек (для рогатки/старта)
// ---------------------------------------------------------------------------

export function makeGarlandGeometry(width: number, sag: number, bulbs: number): THREE.BufferGeometry {
  const parts: ColoredPart[] = [];
  const palette = [COLORS.accentRed, COLORS.coinGold, 0xffffff, COLORS.diamondCyan];
  for (let i = 0; i < bulbs; i += 1) {
    const t = i / (bulbs - 1);
    const x = (t - 0.5) * width;
    const y = -Math.sin(t * Math.PI) * sag;
    parts.push({
      geo: new THREE.SphereGeometry(0.07, 5, 4),
      color: palette[i % palette.length],
      matrix: trs(x, y, 0),
    });
  }
  return mergeParts(parts);
}

// ---------------------------------------------------------------------------
// Ветряк (красно-белый, design §2.2) — башня мерджнутая, лопасти отдельной
// группой с именем 'windmillBlades' (Game вращает rotation.z).
// ---------------------------------------------------------------------------

export function makeWindmill(vertexMat: THREE.Material, bladeMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const tower = new THREE.Mesh(
    mergeParts([
      { geo: new THREE.CylinderGeometry(1.15, 1.5, 0.8, 8), color: COLORS.rockDark, matrix: trs(0, 0.4, 0) },
      { geo: new THREE.CylinderGeometry(0.62, 1.05, 4.6, 8), color: COLORS.warmSand, matrix: trs(0, 3.0, 0) },
      { geo: new THREE.CylinderGeometry(0.68, 0.68, 0.35, 8), color: COLORS.accentRed, matrix: trs(0, 4.1, 0) },
      { geo: new THREE.ConeGeometry(0.95, 1.1, 8), color: COLORS.accentRed, matrix: trs(0, 5.85, 0) },
      { geo: new THREE.SphereGeometry(0.12, 6, 5), color: COLORS.coinGold, matrix: trs(0, 6.5, 0) },
      // дверь и окно
      { geo: new THREE.BoxGeometry(0.5, 0.9, 0.12), color: COLORS.trunk, matrix: trs(0, 0.95, 1.05) },
      { geo: new THREE.BoxGeometry(0.3, 0.3, 0.1), color: 0x22314a, matrix: trs(0, 3.2, 0.85) },
      // снежная юбка у основания
      { geo: new THREE.SphereGeometry(1.7, 8, 5), color: COLORS.snowBase, matrix: trs(0, 0.1, 0, 0, 0, 0, 1, 0.25, 1) },
    ]),
    vertexMat,
  );
  tower.castShadow = true;

  // Лопасти: 4 шт, белые с красными концами; лежат в плоскости XY (rotation.z — spin)
  const bladeParts: ColoredPart[] = [];
  for (let i = 0; i < 4; i += 1) {
    const a = (i * Math.PI) / 2;
    const rot = new THREE.Matrix4().makeRotationZ(a);
    const mk = (geo: THREE.BufferGeometry, color: number, local: THREE.Matrix4): ColoredPart => ({
      geo,
      color,
      matrix: rot.clone().multiply(local),
    });
    bladeParts.push(
      mk(new THREE.BoxGeometry(0.3, 1.5, 0.07), 0xffffff, trs(0, 1.05, 0)),
      mk(new THREE.BoxGeometry(0.34, 1.05, 0.07), COLORS.accentRed, trs(0, 2.25, 0)),
      mk(new THREE.BoxGeometry(0.1, 2.7, 0.05), COLORS.trunk, trs(0.18, 1.6, -0.02)),
    );
  }
  bladeParts.push({ geo: new THREE.CylinderGeometry(0.18, 0.18, 0.3, 8), color: COLORS.accentRedDark, matrix: trs(0, 0, 0, Math.PI / 2, 0, 0) });
  const blades = new THREE.Mesh(mergeParts(bladeParts), bladeMat);
  blades.castShadow = true;
  const bladesGroup = new THREE.Group();
  bladesGroup.name = 'windmillBlades';
  bladesGroup.position.set(0, 5.3, 1.0);
  bladesGroup.add(blades);
  g.add(tower, bladesGroup);
  return g;
}

// ---------------------------------------------------------------------------
// Маяк: полосатый красно-белый корпус, тёплая кабина, вращающийся луч.
// beaconHolder — трюк совместимости: Game вращает rotation.z всем объектам
// из TrackContent.windmillBlades; holder повёрнут так, что local z = world Y,
// поэтому луч метёт горизонт (без изменений в game/*).
// ---------------------------------------------------------------------------

export function makeLighthouse(vertexMat: THREE.Material): { group: THREE.Group; beaconHolder: THREE.Group } {
  const g = new THREE.Group();
  const parts: ColoredPart[] = [
    { geo: new THREE.CylinderGeometry(1.5, 1.9, 1.0, 9), color: COLORS.rock, matrix: trs(0, 0.5, 0) },
  ];
  // полосатый корпус
  const bands = 5;
  for (let i = 0; i < bands; i += 1) {
    const y0 = 1.0 + i * 1.05;
    const rBot = 1.05 - i * 0.09;
    parts.push({
      geo: new THREE.CylinderGeometry(rBot - 0.09, rBot, 1.05, 9),
      color: i % 2 === 0 ? 0xffffff : COLORS.accentRed,
      matrix: trs(0, y0 + 0.52, 0),
    });
  }
  parts.push(
    // дверь (тёплый песок)
    { geo: new THREE.BoxGeometry(0.55, 1.0, 0.15), color: COLORS.warmSand, matrix: trs(0, 1.55, 1.0) },
    // кабина
    { geo: new THREE.CylinderGeometry(0.72, 0.72, 0.85, 8), color: 0x22314a, matrix: trs(0, 6.7, 0) },
    { geo: new THREE.CylinderGeometry(0.5, 0.5, 0.6, 8), color: 0xfff2b0, matrix: trs(0, 6.7, 0) },
    { geo: new THREE.ConeGeometry(0.9, 0.8, 8), color: COLORS.accentRed, matrix: trs(0, 7.5, 0) },
    { geo: new THREE.SphereGeometry(0.12, 6, 5), color: COLORS.coinGold, matrix: trs(0, 8.0, 0) },
  );
  const tower = new THREE.Mesh(mergeParts(parts), vertexMat);
  tower.castShadow = true;
  g.add(tower);

  // Луч: полупрозрачный тёплый конус. При rotation.x=π/2 holder'а его локальная
  // xy-плоскость отображается в мировую xz (горизонталь): local x→world x,
  // local y→world z. Значит конус вдоль local +y при вращении rotation.z
  // (которое делает Game) метёт горизонт. Euler XYZ: R = Rx·Rz — ок.
  const beamGeo = new THREE.ConeGeometry(1.1, 7, 8, 1, true);
  beamGeo.translate(0, 3.9, 0);
  const beam = new THREE.Mesh(
    beamGeo,
    new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    }),
  );
  const beaconHolder = new THREE.Group();
  beaconHolder.position.set(0, 6.7, 0);
  beaconHolder.rotation.x = Math.PI / 2;
  beaconHolder.add(beam);
  g.add(beaconHolder);
  return { group: g, beaconHolder };
}
