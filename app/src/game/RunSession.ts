import { BOOST, CONTINUE, PHYSICS, PICKUPS, TRACK } from '@/config';
import type { Track } from '@/entities/Track';
import { CollisionSystem } from '@/systems/CollisionSystem';
import type { CollisionWorld } from '@/systems/CollisionSystem';
import { clamp, degToRad } from '@/utils/math';
import type { EventBus } from '@/utils/events';
import type { MetaProgression } from './meta/MetaProgression';

export type RunEndReason = 'crash' | 'stopped' | 'finish';

/**
 * RunSession — состояние и fixed-step симуляция одного заезда (gdd §4.1).
 * Кинематический контроллер на heightfield: продольная динамика
 * a = g·sinθ − μ(v)·g·cosθ − k_drag·v², боковая — steerAccel + экспоненциальное
 * сцепление, вертикаль — баллистика трамплинов. Никаких аллокаций в step().
 */
export class RunSession {
  // --- состояние (трасса-координаты) ---
  x = 0;
  s = 0;
  sPrev = 0;
  v = 0;
  vx = 0;
  steer = 0; // сглаженный steerInput
  airborne = false;
  yOff = 0; // высота над поверхностью
  vy = 0;

  // --- буст ---
  boostTimer = 0;
  // --- неуязвимость (continue/старт) ---
  invulnTimer = 0;

  // --- статистика заезда ---
  coinsFloat = 0; // монеты с IncomeMult, floor в конце
  crystals = 0;
  diamonds = 0;
  crashFree = true;
  finished = false;
  endReason: RunEndReason | null = null;
  bestBefore: number;
  newBestFired = false;

  // --- банкинг наград (continue: не платить дважды за тот же прогресс) ---
  bankedDistance = 0;
  bankedCoinsFloat = 0;
  bankedCrystals = 0;
  bankedDiamonds = 0;

  private stopTimer = 0;
  /** Кулдаун вылета с гребня (не чаще раза в 0.9 с). */
  private crestCooldown = 0;
  private readonly collision = new CollisionSystem();
  /** Препятствия, за которые уже начислен near-miss (промт §4). */
  private readonly nearMissed = new Set<object>();
  /** FX-хук: вызывается при подборе пикапа (pop-анимация, счётчик). */
  onPickupCollected: ((p: import('@/entities/Pickup').Pickup) => void) | null = null;

  readonly seed: number;
  private readonly track: Track;
  private readonly world: CollisionWorld;
  private readonly meta: MetaProgression;
  private readonly bus: EventBus;

  constructor(
    seed: number,
    track: Track,
    world: CollisionWorld,
    meta: MetaProgression,
    bus: EventBus,
  ) {
    this.seed = seed;
    this.track = track;
    this.world = world;
    this.meta = meta;
    this.bus = bus;
    this.bestBefore = meta.best;
  }

  get distance(): number {
    return Math.max(0, this.s);
  }

  get finishDistance(): number {
    return this.track.finishDistance;
  }

  get onIce(): boolean {
    return this.track.surfaceAt(this.x) === 'ice';
  }

  get progress(): number {
    return clamp(this.s / this.track.finishDistance, 0, 1);
  }

  /** Активация ракеты (gdd §4.4). Game списывает ракету и эмитит boost_started. */
  startBoost(): void {
    this.boostTimer = BOOST.duration;
    this.v = Math.min(BOOST.ceiling, this.v + BOOST.instant);
  }

  get boosting(): boolean {
    return this.boostTimer > 0;
  }

  launch(speed: number): void {
    this.v = speed;
    this.s = 0;
  }

  /**
   * «Второй шанс» (gdd §5.7): респавн после краша на той же позиции —
   * v=10 м/с, неуязвимость 2 с, деактивация препятствий в радиусе 15 м впереди.
   */
  revive(): void {
    if (this.endReason !== 'crash') return;
    this.endReason = null;
    this.v = CONTINUE.respawnSpeed;
    this.vx = 0;
    this.steer = 0;
    this.airborne = false;
    this.yOff = 0;
    this.vy = 0;
    this.boostTimer = 0;
    this.stopTimer = 0;
    this.invulnTimer = CONTINUE.invulnSec;
    for (const o of this.world.obstacles) {
      if (!o.active) continue;
      const ds = o.s - this.s;
      if (ds > -1 && ds <= CONTINUE.clearRadius) {
        o.active = false;
        o.mesh.visible = false;
      }
    }
  }

  /** Один fixed-шаг 1/60 с. */
  step(dt: number, steerTarget: number): void {
    if (this.endReason) return;

    // --- сглаживание стеринга: атака 10/с, отпуск 8/с ---
    const rate = Math.abs(steerTarget) > Math.abs(this.steer) ? PHYSICS.steerAttack : PHYSICS.steerRelease;
    this.steer += clamp(steerTarget - this.steer, -rate * dt, rate * dt);

    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      if (this.boostTimer <= 0) this.bus.emit('boost_ended', {});
    }
    for (const pad of this.world.pads) if (pad.cooldown > 0) pad.cooldown -= dt;

    const inIcePatch = this.collision.icePatchAt(this.world, this.x, this.s);

    let hStepStart = 0; // высота террейна в начале шага (для ground-relative yOff)
    if (this.airborne) {
      // --- баллистика (yOff считается относительно террейна: после продвижения
      // s вычитаем ΔH — на роллерах земля может ПОДНИМАТЬся навстречу) ---
      hStepStart = this.track.heightAt(this.x, this.s);
      this.vy -= PHYSICS.g * dt;
      this.yOff += this.vy * dt;
    } else {
      // --- продольная динамика (grounded) ---
      const theta = degToRad(this.track.slopeDegAt(this.s));
      const surface = this.track.surfaceAt(this.x);
      const surfaceMul = inIcePatch
        ? PHYSICS.surface.icePatch
        : surface === 'ice'
          ? PHYSICS.surface.ice
          : surface === 'loose'
            ? PHYSICS.surface.loose
            : PHYSICS.surface.snow;
      const steerBrake = 1 + PHYSICS.steerBrakeK * Math.abs(this.steer);
      const mu = PHYSICS.muBase(this.meta.getUpgradeLevel('sled')) * surfaceMul * steerBrake;
      let a = PHYSICS.g * Math.sin(theta) - mu * PHYSICS.g * Math.cos(theta) - PHYSICS.kDrag * this.v * this.v;
      if (this.boosting) a += BOOST.thrust;
      this.v += a * dt;
      const ceiling = this.boosting ? BOOST.ceiling : 34;
      this.v = Math.min(this.v, ceiling);
      if (this.boosting) this.v = Math.max(this.v, BOOST.minSpeed);
      else this.v = Math.max(this.v, 0);
    }

    // --- боковая динамика ---
    // W3: ease-in кривая стеринга (точный контроль на малых углах) +
    // лёгкое снижение авторитети на большой скорости (стабильность).
    const steerCurved = Math.sign(this.steer) * Math.pow(Math.abs(this.steer), 1.25);
    const speedAuthority = 1 / (1 + 0.004 * this.v * this.v);
    const steerFactor =
      (this.airborne ? PHYSICS.ramp.airSteerFactor : 1) * (inIcePatch ? 0.5 : 1) * speedAuthority;
    const steerAccel = PHYSICS.steerAccel(this.meta.getUpgradeLevel('sled'));
    this.vx += steerCurved * steerAccel * steerFactor * dt;
    const grip = this.onIce || inIcePatch ? PHYSICS.gripIce : PHYSICS.gripSnow;
    this.vx *= Math.exp(-grip * dt);
    this.vx = clamp(this.vx, -PHYSICS.maxVx, PHYSICS.maxVx);
    this.x += this.vx * dt;

    // --- борта трассы ---
    if (Math.abs(this.x) > TRACK.halfW) {
      this.x = Math.sign(this.x) * TRACK.halfW;
      this.vx = -this.vx * PHYSICS.wallBounce;
      this.v *= PHYSICS.wallSpeedLoss;
      this.bus.emit('collision', { kind: 'wall', x: this.x, z: this.s });
    }

    // --- продвижение вперёд ---
    this.sPrev = this.s;
    this.s += this.v * dt;

    // --- приземление (после продвижения: учитываем рельеф под райдером) ---
    if (this.airborne) {
      this.yOff -= this.track.heightAt(this.x, this.s) - hStepStart;
      if (this.yOff <= 0) {
        this.yOff = 0;
        this.airborne = false;
        // W3: качество приземления — угол входа vs уклон склона (research:
        // landing slope match). Мягкое (<15°) — мини-буст; жёсткое (>30°) — потеря.
        const flightAngle = (Math.atan2(Math.abs(this.vy), Math.max(this.v, 1)) * 180) / Math.PI;
        const landSlope = this.track.slopeDegAt(this.s);
        const mismatch = Math.abs(flightAngle - landSlope);
        if (mismatch < 15) {
          this.v = Math.min(this.v * 1.05 + 0.4, this.boosting ? BOOST.ceiling : 34);
          this.bus.emit('land_clean', {});
        } else if (mismatch > 30) {
          this.v *= PHYSICS.ramp.landSpeedLoss * 0.82;
          this.bus.emit('land_hard', {});
        } else {
          this.v *= PHYSICS.ramp.landSpeedLoss;
        }
        this.bus.emit('land', {});
      }
    }

    // --- трамплины ---
    if (!this.airborne) {
      const ramp = this.collision.checkRamp(this.world, this.x, this.s, this.sPrev);
      if (ramp) {
        ramp.used = true;
        this.airborne = true;
        this.vy = this.v * Math.sin(degToRad(PHYSICS.ramp.angleDeg)) + PHYSICS.ramp.vyBonus;
        this.yOff = 0.01;
        this.crestCooldown = 0.6;
        this.bus.emit('jump', {});
      }
    }

    // --- W3: вылет с гребня (crest-launch, Alto's feel) ---
    // Склон резко укручается под райдером: если за 2.5 м уклон круче на ≥6°
    // и скорость ≥ 12 м/с — земля «уходит», взлетаем по старой траектории.
    if (!this.airborne && this.v > 12 && this.crestCooldown <= 0) {
      const thetaNow = this.track.slopeDegAt(this.s);
      const thetaAhead = this.track.slopeDegAt(this.s + 2.5);
      const delta = thetaAhead - thetaNow;
      if (delta >= 6) {
        this.airborne = true;
        this.vy = Math.min(this.v * Math.sin(degToRad(Math.min(delta, 14))) * 0.7, 8);
        this.yOff = 0.01;
        this.crestCooldown = 0.9;
        this.bus.emit('crest_jump', { strength: Math.min(delta / 14, 1) });
      }
    }
    if (this.crestCooldown > 0) this.crestCooldown -= dt;

    // --- буст-пады ---
    const pad = this.collision.checkPad(this.world, this.x, this.s, this.sPrev);
    if (pad) {
      pad.cooldown = 1;
      this.v = Math.min(BOOST.padCeiling, this.v + BOOST.padBoost);
      this.bus.emit('collision', { kind: 'boostpad', x: this.x, z: this.s });
    }

    // --- препятствия ---
    if (this.invulnTimer <= 0 && !this.airborne) {
      const hit = this.collision.checkObstacle(this.world, this.x, this.s, this.sPrev, PHYSICS.tubeRadius);
      if (hit) {
        if (this.boosting) {
          // под ракетой: разрушение без потери скорости (тяжёлые v *= 0.9)
          if (hit.heavy) this.v *= 0.9;
          hit.destroy(this.vx);
          this.bus.emit('collision', { kind: 'light', x: hit.x, z: hit.s });
        } else if (hit.heavy) {
          this.crashFree = false;
          hit.destroy(this.vx);
          this.endReason = 'crash';
          this.bus.emit('crash', { x: hit.x, z: hit.s, obstacleType: hit.kind });
          return;
        } else {
          this.crashFree = false;
          this.v *= PHYSICS.lightHitSpeedMul;
          this.vx = -this.vx * 0.5 + Math.sign(this.x - hit.x || 1) * 3;
          hit.destroy(this.vx);
          this.bus.emit('collision', { kind: 'light', x: hit.x, z: hit.s });
        }
      }
    }

    // --- near-miss: пролёт мимо препятствия впритык (промт §4/§10) ---
    if (this.invulnTimer <= 0 && !this.airborne && this.v > 8) {
      for (const o of this.world.obstacles) {
        if (!o.active || this.nearMissed.has(o)) continue;
        if (o.s > this.sPrev && o.s <= this.s) {
          const gap = Math.abs(this.x - o.x) - o.radius - PHYSICS.tubeRadius;
          if (gap > 0 && gap <= 0.9) {
            this.nearMissed.add(o);
            this.coinsFloat += this.meta.incomeMult; // бонус за риск ≈ монета
            // W3: риск → скорость (Alto's loop): мини-буст за пролёт впритык
            this.v = Math.min(this.v * 1.02 + 0.3, this.boosting ? BOOST.ceiling : 34);
            this.bus.emit('near_miss', { x: o.x, z: o.s });
          }
        }
      }
    }

    // --- пикапы ---
    this.collision.magnetize(this.world, this.x, this.s, PICKUPS.magnetRadius);
    const collected = this.collision.collectPickups(this.world, this.x, this.s, this.sPrev);
    for (const p of collected) {
      if (p.kind === 'coin') {
        this.coinsFloat += this.meta.incomeMult;
        this.bus.emit('coin_collected', {
          runTotal: Math.floor(this.coinsFloat),
          x: p.mesh.position.x,
          y: p.mesh.position.y,
          z: p.mesh.position.z,
        });
      } else if (p.kind === 'crystal') {
        this.crystals += 1;
        this.bus.emit('crystal_collected', { runTotal: this.crystals });
      } else {
        this.diamonds += 1;
        this.bus.emit('diamond_collected', { runTotal: this.diamonds });
      }
      this.onPickupCollected?.(p); // pop-анимация/панч HUD — на стороне Game
    }

    // --- NEW BEST ---
    if (!this.newBestFired && this.bestBefore > 0 && this.s > this.bestBefore) {
      this.newBestFired = true;
      this.bus.emit('new_best', { distance: Math.floor(this.s) });
    }

    // --- финиш ---
    if (this.s >= this.track.finishDistance) {
      this.finished = true;
      this.endReason = 'finish';
      this.bus.emit('finish', { distance: Math.floor(this.s) });
      return;
    }

    // --- остановка: v < 1.0 м/с в течение 1.5 с ---
    if (!this.boosting && this.v < PHYSICS.stopSpeed && !this.airborne) {
      this.stopTimer += dt;
      if (this.stopTimer >= PHYSICS.stopTime) {
        this.endReason = 'stopped';
      }
    } else {
      this.stopTimer = 0;
    }
  }
}
