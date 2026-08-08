import * as THREE from 'three';
import { COLORS, VISUAL } from '@/config';
import type { Track } from '@/entities/Track';
import type { Rng } from '@/utils/random';
import { mergeParts, trs } from './props';

/**
 * Mountains — 3 пояса процедурных low-poly гор (design §2.2: дальние силуэты
 * утопают в fog). Каждый пояс — пара InstancedMesh (скала + снежная шапка,
 * матрицы общие) → 6 draw calls на все горы мира. Тени не отбрасывают
 * (design §5.1). Строится один раз вместе с Track (не per-run).
 */

interface BeltSpec {
  xMin: number;
  xMax: number;
  hMin: number;
  hMax: number;
  spacing: number;
}

function mountainPairGeometry(sides: number): { rock: THREE.BufferGeometry; cap: THREE.BufferGeometry } {
  // Скала: фасеточный конус, низ чуть раскидан для «кромки»
  const rock = mergeParts([
    { geo: new THREE.ConeGeometry(1, 1, sides), color: 0xffffff, matrix: trs(0, 0.5, 0, 0, 0, 0, 1, 1, 0.85) },
    { geo: new THREE.ConeGeometry(0.55, 0.45, sides), color: 0xffffff, matrix: trs(0.5, 0.22, 0.3, 0, 0.7, 0, 1, 1, 0.8) },
    { geo: new THREE.ConeGeometry(0.45, 0.35, sides), color: 0xffffff, matrix: trs(-0.55, 0.17, -0.2, 0, 1.9, 0, 1, 1, 0.8) },
  ]);
  // Шапка: верхние ~52% основного конуса (та же форма, белая) —
  // щедрые снежные шапки, как в референсах (горы читаются снежными, не «картонными»)
  const cap = mergeParts([
    { geo: new THREE.ConeGeometry(0.52, 0.52, sides), color: 0xffffff, matrix: trs(0, 0.74, 0, 0, 0, 0, 1, 1, 0.85) },
  ]);
  return { rock, cap };
}

/** Цвета поясов — атмосферная перспектива: уже ближний пояс заметно поднят к снегу/дымке,
 * иначе на скорости скалы читаются тёмными «картонными» силуэтами (видео-аудит W2). */
const BELT_COLORS = [
  [0x9fb2ca, 0x8798b2],
  [COLORS.mountainFar, 0xc6d5ec],
  [0xccd9ee, COLORS.fog],
] as const;

export function buildMountains(track: Track, rng: Rng, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mountains';
  const sFrom = 2; // от старта вниз по склону (за спиной старта гор не видно)
  const sTo = track.length + 200;
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  VISUAL.mountains.belts.forEach((belt: BeltSpec, beltIdx: number) => {
    const transforms: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    for (let s = sFrom; s < sTo; s += belt.spacing * rng.range(0.75, 1.3)) {
      for (const side of [-1, 1]) {
        if (beltIdx > 0 && rng.chance(0.25)) continue; // дальние пояса реже
        const x = side * rng.range(belt.xMin, belt.xMax);
        const h = rng.range(belt.hMin, belt.hMax);
        const w = h * rng.range(0.55, 0.8);
        // основание — МИНИМАЛЬНАЯ высота террейна под пятном горы
        // (fix «висячих гор»: на склоне гора опирается на нижнюю кромку,
        // остальное — легитимное заглубление в склон)
        const ss = Math.max(0, s);
        const e = w * 0.9;
        let groundY = track.heightAt(x, ss);
        for (const dx of [-e, 0, e]) {
          for (const ds of [-e, 0, e]) {
            groundY = Math.min(groundY, track.heightAt(x + dx, Math.max(0, ss + ds)));
          }
        }
        groundY -= h * 0.04 + 0.1; // лёгкое заглубление, без парения
        dummy.position.set(track.centerX(ss) + x, groundY, -s);
        dummy.rotation.set(0, rng.range(0, Math.PI * 2), 0);
        dummy.scale.set(w, h, w);
        dummy.updateMatrix();
        transforms.push(dummy.matrix.clone());
        const [cA, cB] = BELT_COLORS[beltIdx];
        colors.push(color.setHex(cA).lerp(new THREE.Color(cB), rng.next()).clone());
      }
    }
    if (transforms.length === 0) return;

    const sides = beltIdx === 0 ? 6 : 5; // дальше — грубее силуэт
    const { rock, cap } = mountainPairGeometry(sides);
    const rockMesh = new THREE.InstancedMesh(rock, material, transforms.length);
    const capMesh = new THREE.InstancedMesh(cap, material, transforms.length);
    transforms.forEach((m, i) => {
      rockMesh.setMatrixAt(i, m);
      capMesh.setMatrixAt(i, m);
      rockMesh.setColorAt(i, colors[i]);
      capMesh.setColorAt(i, new THREE.Color(0xffffff)); // Mountain Snow Cap
    });
    rockMesh.instanceMatrix.needsUpdate = true;
    capMesh.instanceMatrix.needsUpdate = true;
    if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
    if (capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true;
    rockMesh.castShadow = false;
    rockMesh.receiveShadow = false;
    capMesh.castShadow = false;
    capMesh.receiveShadow = false;
    // статические объекты: триcчитаем bounding для корректного culling'а
    rockMesh.computeBoundingSphere();
    capMesh.computeBoundingSphere();
    group.add(rockMesh, capMesh);
  });

  return group;
}
