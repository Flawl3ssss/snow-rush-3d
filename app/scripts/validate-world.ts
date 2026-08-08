/**
 * validate-world — автоматический валидатор мира (промт §6, DoD).
 * Запуск: npx vite-node scripts/validate-world.ts
 *
 * Проверяет на ВСЕХ картах (MAPS):
 *  1. Контакт с землёй: низ bbox каждого препятствия/трамплина/декора/гор —
 *     не выше +0.35 м над минимальной точкой террейна под пятном (не «висячие»)
 *     и не глубже −1.2 м (не «утонувшие»).
 *  2. Коллизия = видимый меш: радиус коллизии препятствия в пределах
 *     [0.5, 1.8] × XZ-радиуса видимого bbox (нет «невидимых камней» и наоборот).
 * Exit 0 — мир чист на всех картах, 1 — есть нарушения.
 */
import * as THREE from 'three';
import { ECONOMY, MAPS } from '../src/config';
import { Track } from '../src/entities/Track';
import { TrackBuilder } from '../src/systems/TrackBuilder';

interface Violation {
  map: string;
  what: string;
  detail: string;
}

const violations: Violation[] = [];
const box = new THREE.Box3();
const m = new THREE.Matrix4();
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3();

function terrainMin(track: Track, x: number, s: number, e: number): number {
  let min = Infinity;
  for (const dx of [-e, 0, e]) {
    for (const ds of [-e, 0, e]) {
      min = Math.min(min, track.heightAt(x + dx, s + ds));
    }
  }
  return min;
}

function checkGroundContact(
  mapId: string,
  track: Track,
  what: string,
  obj: THREE.Object3D,
  x: number,
  s: number,
  e: number,
): void {
  box.setFromObject(obj);
  if (box.isEmpty()) return;
  const bottom = box.min.y;
  const minT = terrainMin(track, x, s, e);
  const gap = bottom - minT;
  if (gap > 0.35) {
    violations.push({ map: mapId, what, detail: `парит +${gap.toFixed(2)} м над землёй @s=${s.toFixed(0)}` });
  } else if (gap < -1.2) {
    violations.push({ map: mapId, what, detail: `утонул ${gap.toFixed(2)} м @s=${s.toFixed(0)}` });
  }
}

let checked = 0;
for (const map of MAPS) {
  const finishDistance = ECONOMY.finishDistance(1);
  const track = new Track(finishDistance, map.seed, map.palette, map.track);
  const content = new TrackBuilder().build(track, map.seed + 7);

  // --- препятствия: контакт + коллизия=меш ---
  for (const o of content.obstacles) {
    checkGroundContact(map.id, track, `obstacle:${o.kind}`, o.mesh, o.x, o.s, o.radius);
    box.setFromObject(o.mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const meshR = Math.max(size.x, size.z) / 2;
    if (meshR > 0.01) {
      const ratio = o.radius / meshR;
      if (ratio < 0.5 || ratio > 1.8) {
        violations.push({
          map: map.id,
          what: `obstacle:${o.kind}`,
          detail: `коллизия r=${o.radius} vs меш r=${meshR.toFixed(2)} (×${ratio.toFixed(2)}) @s=${o.s.toFixed(0)}`,
        });
      }
    }
    checked += 1;
  }

  // --- трамплины / буст-пады / ледяные patches ---
  for (const r of content.ramps) {
    checkGroundContact(map.id, track, 'ramp', r.mesh, r.x, r.s, r.length / 2 + 1);
    checked += 1;
  }
  for (const p of content.pads) {
    checkGroundContact(map.id, track, 'boostpad', p.mesh, p.x, p.s, 1.5);
    checked += 1;
  }
  for (const ip of content.icePatches) {
    checkGroundContact(map.id, track, 'icepatch', ip.mesh, ip.x, ip.s, 1.5);
    checked += 1;
  }

  // --- горы + декор: per-instance контакт с террейном ---
  const groups: Array<[string, THREE.Object3D]> = [
    ['mountains', track.group.getObjectByName('mountains') ?? track.group],
    ['decor', content.group.getObjectByName('worldDecor') ?? content.group],
  ];
  for (const [label, root] of groups) {
    root.traverse((obj) => {
      const inst = obj as THREE.InstancedMesh;
      if (!inst.isInstancedMesh) return;
      inst.geometry.computeBoundingBox();
      const gBox = inst.geometry.boundingBox!;
      for (let i = 0; i < inst.count; i += 1) {
        inst.getMatrixAt(i, m);
        m.decompose(pos, quat, scl);
        const s = -pos.z;
        const x = pos.x - track.centerX(Math.max(0, s));
        // якорь — origin инстанса; геометрия с base>0 (снежные шапки гор)
        // по дизайну сидит на другой части, её «низ» не является опорой
        const bottom = pos.y + Math.min(0, gBox.min.y * scl.y);
        const footR = Math.max(scl.x, scl.z) * 0.9;
        const minT = terrainMin(track, x, s, footR);
        // Крупный фоновый объект (горы): «стоит» = касается террейна ХОТЯ БЫ
        // в одной точке пятна (низ не выше максимума пятна), допустимо
        // заглубление в склон с подветренной стороны. Мелкий декор — строго по минимуму.
        const isHuge = footR > 15;
        let maxT = -Infinity;
        if (isHuge) {
          for (const dx of [-footR, 0, footR]) {
            for (const ds of [-footR, 0, footR]) {
              maxT = Math.max(maxT, track.heightAt(x + dx, s + ds));
            }
          }
        }
        const gap = bottom - (isHuge ? maxT : minT);
        if (gap > 0.35) {
          violations.push({
            map: map.id,
            what: `${label}:${obj.uuid.slice(0, 6)}#${i}`,
            detail: `парит +${gap.toFixed(2)} м @s=${s.toFixed(0)} x=${x.toFixed(0)}`,
          });
        } else if (bottom - minT < -Math.max(1.2, 0.25 * (gBox.max.y - gBox.min.y) * scl.y)) {
          violations.push({
            map: map.id,
            what: `${label}:${obj.uuid.slice(0, 6)}#${i}`,
            detail: `утонул ${gap.toFixed(2)} м @s=${s.toFixed(0)} x=${x.toFixed(0)}`,
          });
        }
        checked += 1;
      }
    });
  }
  console.log(`[${map.id}] проверено объектов: ${checked}`);
}

if (violations.length > 0) {
  console.error(`\n=== VALIDATE-WORLD: FAIL (${violations.length} нарушений) ===`);
  for (const v of violations.slice(0, 40)) {
    console.error(`  [${v.map}] ${v.what}: ${v.detail}`);
  }
  if (violations.length > 40) console.error(`  …и ещё ${violations.length - 40}`);
  process.exit(1);
}
console.log(`\n=== VALIDATE-WORLD: PASS (${checked} объектов, все 5 карт чисты) ===`);
process.exit(0);
