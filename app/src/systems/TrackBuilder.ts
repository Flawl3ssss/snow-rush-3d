import * as THREE from 'three';
import { PICKUPS, TRACK } from '@/config';
import { Track } from '@/entities/Track';
import { Obstacle } from '@/entities/Obstacle';
import type { ObstacleKind } from '@/entities/Obstacle';
import { Pickup } from '@/entities/Pickup';
import { BoostPad, IcePatch, Ramp } from '@/entities/Ramp';
import { FinishGate } from '@/entities/FinishGate';
import { buildWorldDecor } from '@/world/WorldDecor';
import { clamp, degToRad } from '@/utils/math';
import { createRng } from '@/utils/random';
import type { Rng } from '@/utils/random';

export interface TrackContent {
  group: THREE.Group;
  obstacles: Obstacle[];
  pickups: Pickup[];
  ramps: Ramp[];
  pads: BoostPad[];
  icePatches: IcePatch[];
  finishGate: FinishGate;
  windmillBlades: THREE.Object3D[];
}

interface PlacedObstacle {
  x: number;
  s: number;
  r: number;
}

/**
 * TrackBuilder — seeded расстановка контента по энкаунтер-плану gdd §7.2/§7.3:
 * фазы обучения (0–180 м), далее модули 50 м с density = min(1, 0.25 + z/1200),
 * min-зазор препятствий 25 м, corridor-check ≥ 3.5 м сэмплами каждые 2 м.
 *
 * Владение: ЛОГИКА расстановки — scaffold; визуальное оформление
 * генерируемых мешей — world-graphics.
 */
export class TrackBuilder {
  /**
   * Snap-to-ground (fix «висячих объектов»): опускает объект так, чтобы низ
   * его bbox касался МИНИМАЛЬНОЙ высоты террейна под пятном (±halfX/±halfS)
   * с лёгким заглублением. На склоне объект больше не парит над нижней кромкой.
   */
  private snapToGround(
    track: Track,
    obj: THREE.Object3D,
    x: number,
    s: number,
    halfX: number,
    halfS: number,
    embed = 0.06,
  ): void {
    let minH = Infinity;
    for (const dx of [-halfX, 0, halfX]) {
      for (const ds of [-halfS, 0, halfS]) {
        minH = Math.min(minH, track.heightAt(x + dx, s + ds));
      }
    }
    const box = new THREE.Box3().setFromObject(obj);
    const bottomLocal = box.min.y - obj.position.y;
    obj.position.y = minH - bottomLocal - embed;
  }

  build(track: Track, runSeed: number): TrackContent {
    const rng = createRng(`content-${runSeed}`);
    const group = new THREE.Group();
    const obstacles: Obstacle[] = [];
    const pickups: Pickup[] = [];
    const ramps: Ramp[] = [];
    const pads: BoostPad[] = [];
    const icePatches: IcePatch[] = [];
    const windmillBlades: THREE.Object3D[] = [];

    const addObstacle = (kind: ObstacleKind, x: number, s: number): Obstacle => {
      const o = new Obstacle(kind, x, s);
      track.worldPos(x, s, 0, o.mesh.position as THREE.Vector3);
      this.snapToGround(track, o.mesh, x, s, o.radius, o.radius, 0.08);
      obstacles.push(o);
      group.add(o.mesh);
      return o;
    };
    const addRamp = (x: number, s: number): Ramp => {
      const ramp = new Ramp(x, s);
      track.worldPos(x, s, 0, ramp.mesh.position as THREE.Vector3);
      // наклон по склону (fix «висячего трамплина»): +z-край выше на tan(slope)
      ramp.mesh.rotation.x = -degToRad(track.slopeDegAt(s));
      this.snapToGround(track, ramp.mesh, x, s, ramp.width / 2, ramp.length / 2 + 1.2, 0.1);
      ramps.push(ramp);
      group.add(ramp.mesh);
      return ramp;
    };
    const addPickup = (kind: 'coin' | 'crystal' | 'diamond', x: number, s: number, yOff = 0.9): void => {
      const p = new Pickup(kind, x, s, yOff, rng.range(0, Math.PI * 2));
      track.worldPos(x, s, yOff, p.mesh.position);
      p.setBaseY(p.mesh.position.y);
      pickups.push(p);
      group.add(p.mesh);
    };
    const coinLine = (x: number, sFrom: number, count: number, yOff = 0.9, xDrift = 0): void => {
      for (let i = 0; i < count; i += 1) {
        addPickup('coin', clamp(x + xDrift * i, -TRACK.halfW + 1, TRACK.halfW - 1), sFrom + i * PICKUPS.coinLineStep, yOff);
      }
    };

    // ===== Фаза 0–60: обучение, 2 линии монет по центру =====
    coinLine(-1.5, 8, 8);
    coinLine(1.5, 34, 8);

    // ===== 60–100: первый вал слева/справа + монеты огибают =====
    const driftSide = rng.sign();
    addObstacle('snowdrift', driftSide * 3, 78);
    coinLine(-driftSide * 3, 66, 6);

    // ===== 100–140: пара ёлок с воротами 5 м =====
    const gate = rng.range(-2.5, 2.5);
    addObstacle('pine', gate - 2.5, 122);
    addObstacle('pine', gate + 2.5, 122);
    coinLine(gate, 104, 5);

    // ===== 140–180: первый трамплин + дуга монет (баллистика) =====
    addRamp(0, 152);
    {
      const kick = degToRad(25);
      const v = 16; // обучающий заезд медленнее
      for (let i = 0; i < 6; i += 1) {
        const ds = 3 + i * 2.4;
        const t = ds / (v * Math.cos(kick));
        const h = 1.2 + ds * Math.tan(kick) - (9.81 * t * t) / 2;
        if (h < 0.7) break;
        addPickup('coin', 0, 152 + ds, h);
      }
    }

    // ===== Модули 50 м до конца буфера (§7.3) =====
    let lastRampS = 152;
    const placed: PlacedObstacle[] = obstacles.map((o) => ({ x: o.x, s: o.s, r: o.radius }));
    const moduleStart = 180;
    const moduleEnd = track.finishDistance + TRACK.bufferMeters - 40;

    // W2: трамплины ставим на крутые сбросы (посадка совпадает с баллистикой)
    const rampSpots = track.rampSpots();
    const usedSpots = new Set<number>();
    const nearestSpot = (s: number): number | null => {
      let best: number | null = null;
      let bestD = 28;
      for (const spot of rampSpots) {
        if (usedSpots.has(spot)) continue;
        const d = Math.abs(spot - s);
        if (d < bestD) {
          bestD = d;
          best = spot;
        }
      }
      return best;
    };
    /** Баллистическая дуга монет за трамплином (kick 25°, v≈19 м/с). */
    const rampCoinArc = (x: number, s: number): void => {
      const kick = degToRad(25);
      const v = 19;
      const g = 9.81;
      for (let i = 0; i < 6; i += 1) {
        const ds = 3.2 + i * 2.4; // вдоль трассы за кромкой трамплина
        const t = ds / (v * Math.cos(kick));
        const h = 1.2 + ds * Math.tan(kick) - (g * t * t) / 2;
        if (h < 0.7) break; // приземлилась — дальше монеты не ведём
        addPickup('coin', x, s + ds, h);
      }
    };

    for (let mStart = moduleStart; mStart < moduleEnd; mStart += TRACK.moduleLength) {
      const zMid = mStart + TRACK.moduleLength / 2;
      const density = Math.min(1, (0.25 + zMid / 1200) * track.profile.densityMul);
      const targetCount = Math.floor(1 + 3 * density);

      // --- препятствия с min-зазором 25 м ---
      const sSlots: number[] = [];
      let cursor = mStart + rng.range(4, 10);
      while (cursor < mStart + TRACK.moduleLength - 6 && sSlots.length < targetCount + 2) {
        sSlots.push(cursor);
        cursor += TRACK.minObstacleGap + rng.range(0, 12);
      }
      for (let i = 0; i < Math.min(targetCount, sSlots.length); i += 1) {
        const s = sSlots[i];
        const kind = this.pickObstacleKind(rng, s);
        const x = rng.range(-TRACK.halfW + 1.5, TRACK.halfW - 1.5);
        const o = addObstacle(kind, x, s);
        placed.push({ x, s, r: o.radius });
      }

      // --- corridor-check: гарантированный проход ≥ 3.5 м ---
      this.enforceCorridor(placed, obstacles, group, mStart, mStart + TRACK.moduleLength);

      // --- монетная линия по безопасной линии ---
      const safeX = this.findSafeX(placed, zMid);
      coinLine(safeX, mStart + 8, rng.int(5, 9));

      // --- кристалл: 12% на модуль, на рискованной линии ---
      if (rng.chance(PICKUPS.crystalPerModuleChance)) {
        const riskyX = clamp(-safeX + rng.range(-1, 1), -TRACK.halfW + 1, TRACK.halfW - 1);
        addPickup('crystal', riskyX, mStart + rng.range(15, 40), 1.0);
      }

      // --- трамплин: 22%, ≥60 м друг от друга, на крутом сбросе (W2) ---
      if (rng.chance(0.22) && mStart - lastRampS >= 60) {
        const wanted = mStart + rng.range(15, 35);
        const spot = nearestSpot(wanted);
        if (spot) {
          const rx = rng.range(-3, 3);
          addRamp(rx, spot);
          usedSpots.add(spot);
          lastRampS = spot;
          rampCoinArc(rx, spot);
        }
      }

      // --- буст-пад: 8% ---
      if (rng.chance(0.08)) {
        const pad = new BoostPad(this.findSafeX(placed, zMid), mStart + rng.range(20, 40));
        track.worldPos(pad.x, pad.s, 0.05, pad.mesh.position as THREE.Vector3);
        pad.mesh.rotation.x = -degToRad(track.slopeDegAt(pad.s));
        this.snapToGround(track, pad.mesh, pad.x, pad.s, pad.width / 2, pad.length / 2, -0.02);
        pads.push(pad);
        group.add(pad.mesh);
      }

      // --- ice patch: 10% после 350 м ---
      if (zMid > 350 && rng.chance(0.1)) {
        const patch = new IcePatch(rng.range(-3, 3), mStart + rng.range(10, 40));
        track.worldPos(patch.x, patch.s, 0.04, patch.mesh.position as THREE.Vector3);
        patch.mesh.rotation.x = -degToRad(track.slopeDegAt(patch.s));
        this.snapToGround(track, patch.mesh, patch.x, patch.s, 1.6, 1.6, -0.02);
        icePatches.push(patch);
        group.add(patch.mesh);
      }
    }

    // --- алмаз: 35%, только за 70% дистанции уровня (gdd §4.6) ---
    if (rng.chance(PICKUPS.diamondChance)) {
      addPickup(
        'diamond',
        rng.range(-6, 6),
        track.finishDistance * rng.range(PICKUPS.diamondMinProgress + 0.02, 0.95),
        1.0,
      );
    }

    // --- ледяные арки биома «пещеры»: своды над трассой каждые archEvery м ---
    if (track.profile.archEvery > 0) {
      const archMat = new THREE.MeshStandardMaterial({
        color: track.palette.iceTrackDeep,
        roughness: 0.4,
        metalness: 0.1,
        flatShading: true,
      });
      for (let s = 220; s < track.finishDistance + TRACK.bufferMeters - 60; s += track.profile.archEvery) {
        const arch = new THREE.Mesh(
          new THREE.TorusGeometry(TRACK.halfW + 3, 1.4, 6, 14, Math.PI),
          archMat,
        );
        track.worldPos(0, s, 0, arch.position as THREE.Vector3);
        arch.rotation.y = track.headingAt(s);
        group.add(arch);
      }
    }

    // --- финишные ворота ---
    const finishGate = new FinishGate(track.finishDistance, TRACK.halfW);
    track.worldPos(0, track.finishDistance, 0, finishGate.group.position as THREE.Vector3);
    group.add(finishGate.group);

    // --- монетная дорожка к финишу (release перед воротами) ---
    coinLine(0, track.finishDistance - 42, 10);

    // ===== Декор по бокам (вне halfW+2) — world-graphics: инстансинг =====
    // Ёлки ×3 варианта, скалы, снеговики, знаки-стрелки перед кластерами,
    // сугробы кромки, ветряки, маяки, деревни иглу, стартовый снеговик
    // и гирлянда (gdd §7.3 + design §2.2). Логика расстановки препятствий
    // выше не меняется; знаки читают `placed` как подсказку (визуал).
    const decorRng = createRng(`decor-${runSeed}`);
    const decor = buildWorldDecor(track, decorRng, placed);
    group.add(decor.group);
    for (const blades of decor.windmillBlades) windmillBlades.push(blades);

    return { group, obstacles, pickups, ramps, pads, icePatches, finishGate, windmillBlades };
  }

  /** Семейства по мин. дистанции появления (gdd §7.2). */
  private pickObstacleKind(rng: Rng, s: number): ObstacleKind {
    const pool: ObstacleKind[] = ['snowdrift'];
    if (s >= 100) pool.push('pine', 'pine');
    if (s >= 200) pool.push('gift');
    if (s >= 250) pool.push('rock', 'rock');
    if (s >= 400) pool.push('snowman');
    return rng.pick(pool);
  }

  /** Самая широкая свободная полоса на данном s (для монетных линий). */
  private findSafeX(placed: PlacedObstacle[], s: number): number {
    const blocked: Array<[number, number]> = [];
    for (const o of placed) {
      if (Math.abs(o.s - s) < 20) {
        blocked.push([o.x - o.r - 1, o.x + o.r + 1]);
      }
    }
    blocked.sort((a, b) => a[0] - b[0]);
    let bestStart = -TRACK.halfW + 1;
    let bestWidth = 0;
    let cursor = -TRACK.halfW + 1;
    for (const [a, b] of blocked) {
      if (a - cursor > bestWidth) {
        bestWidth = a - cursor;
        bestStart = cursor;
      }
      cursor = Math.max(cursor, b);
    }
    if (TRACK.halfW - 1 - cursor > bestWidth) {
      bestWidth = TRACK.halfW - 1 - cursor;
      bestStart = cursor;
    }
    return bestStart + bestWidth / 2;
  }

  /** Corridor-check сэмплами каждые 2 м: проход ≥ 3.5 м, иначе убираем последнее препятствие модуля. */
  private enforceCorridor(
    placed: PlacedObstacle[],
    obstacles: Obstacle[],
    group: THREE.Group,
    sFrom: number,
    sTo: number,
  ): void {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let ok = true;
      for (let s = sFrom; s < sTo && ok; s += 2) {
        const intervals: Array<[number, number]> = [];
        for (const o of placed) {
          if (Math.abs(o.s - s) < 2.5) {
            intervals.push([o.x - o.r - 0.9, o.x + o.r + 0.9]);
          }
        }
        intervals.sort((a, b) => a[0] - b[0]);
        // слияние и поиск свободного окна
        let cursor = -TRACK.halfW;
        let maxGap = 0;
        for (const [a, b] of intervals) {
          maxGap = Math.max(maxGap, a - cursor);
          cursor = Math.max(cursor, b);
        }
        maxGap = Math.max(maxGap, TRACK.halfW - cursor);
        if (maxGap < TRACK.corridorMinWidth) ok = false;
      }
      if (ok) return;
      // удалить последнее препятствие, добавленное в этом модуле
      for (let i = obstacles.length - 1; i >= 0; i -= 1) {
        const o = obstacles[i];
        if (o.s >= sFrom && o.s < sTo && o.active) {
          o.active = false;
          o.mesh.visible = false;
          group.remove(o.mesh);
          const pi = placed.findIndex((p) => p.s === o.s && p.x === o.x);
          if (pi >= 0) placed.splice(pi, 1);
          obstacles.splice(i, 1);
          break;
        }
      }
    }
  }
}
