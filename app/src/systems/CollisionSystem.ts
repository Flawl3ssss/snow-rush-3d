import type { Obstacle } from '@/entities/Obstacle';
import type { Pickup } from '@/entities/Pickup';
import type { BoostPad, IcePatch, Ramp } from '@/entities/Ramp';

export interface CollisionWorld {
  obstacles: Obstacle[];
  pickups: Pickup[];
  ramps: Ramp[];
  pads: BoostPad[];
  icePatches: IcePatch[];
}

/**
 * CollisionSystem — сфера/сфера (тюбинг r=0.9) против препятствий,
 * сенсор-сферы пикапов, триггеры трамплинов/буст-падов (gdd §4.3, §4.6).
 * Работает в трасса-координатах (x, s); по z — окно длины шага (anti-tunneling).
 */
export class CollisionSystem {
  checkObstacle(world: CollisionWorld, x: number, s: number, sPrev: number, tubeR: number): Obstacle | null {
    for (const o of world.obstacles) {
      if (!o.active) continue;
      if (o.s < sPrev - 1 || o.s > s + 1) continue;
      const rr = o.radius + tubeR;
      const ds = o.s - s;
      const dx = o.x - x;
      if (dx * dx + ds * ds <= rr * rr) return o;
    }
    return null;
  }

  collectPickups(world: CollisionWorld, x: number, s: number, sPrev: number): Pickup[] {
    const out: Pickup[] = [];
    for (const p of world.pickups) {
      if (p.collected) continue;
      if (p.s < sPrev - 1.5 || p.s > s + 1.5) continue;
      const rr = p.radius + 0.6;
      const ds = p.s - s;
      const dx = p.x - x;
      if (dx * dx + ds * ds <= rr * rr) out.push(p);
    }
    return out;
  }

  /** Пикапы в радиусе магнита (2.5 м) — начинают homing. */
  magnetize(world: CollisionWorld, x: number, s: number, radius: number): void {
    for (const p of world.pickups) {
      if (p.collected || p.magnetized) continue;
      const ds = p.s - s;
      const dx = p.x - x;
      if (dx * dx + ds * ds <= radius * radius) p.magnetized = true;
    }
  }

  checkRamp(world: CollisionWorld, x: number, s: number, sPrev: number): Ramp | null {
    for (const r of world.ramps) {
      if (r.used) continue;
      if (r.s > sPrev && r.s <= s && Math.abs(x - r.x) <= r.width / 2) return r;
    }
    return null;
  }

  icePatchAt(world: CollisionWorld, x: number, s: number): boolean {
    for (const p of world.icePatches) {
      if (p.contains(x, s)) return true;
    }
    return false;
  }

  checkPad(world: CollisionWorld, x: number, s: number, sPrev: number): BoostPad | null {
    for (const p of world.pads) {
      if (p.cooldown > 0) continue;
      if (p.s > sPrev && p.s <= s && Math.abs(x - p.x) <= p.width / 2) return p;
    }
    return null;
  }
}
