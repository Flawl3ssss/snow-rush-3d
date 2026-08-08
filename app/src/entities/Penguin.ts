import * as THREE from 'three';
import { AssetLib } from '@/systems/AssetLib';
import { clamp, dampTo as damp, easeOutBack } from '@/utils/math';

/**
 * Penguin — герой на GLB-модели (Peppermint Penguin, poly.pizza, CREDITS.md).
 * Процедурная анимация поверх статичной модели (game feel research §3):
 *  - крен в повороте (lean roll до ~35°), наклон по склону (pitch);
 *  - squash & stretch: stretch на вылете (y→1.25), squash на приземлении
 *    (y→0.72), восстановление-пружина ~0.2 с; пределы 0.7–1.3;
 *  - полёт: наклон вперёд, лёгкое «распластывание» (scale.x);
 *  - wobble: пружинная качка после неровностей (вторичное движение тюбинга);
 *  - idle: дыхание + озиралка; краш: кувырок (приводит Game через setCrashSpin).
 *
 * Иерархия: group (якорь) → orient (yaw модели) → lean (roll/pitch) →
 * squash (scale) → model (GLB).
 */
export class Penguin {
  readonly group = new THREE.Group();
  private readonly orient = new THREE.Group();
  private readonly lean = new THREE.Group();
  private readonly squash = new THREE.Group();
  private readonly model: THREE.Group;

  // --- цели/состояние анимации ---
  private leanTarget = 0; // roll, рад
  private pitchTarget = 0; // наклон по склону
  private leanCur = 0;
  private pitchCur = 0;
  private flight = 0; // 0..1
  private squashY = 1; // текущий вертикальный скейл
  private squashVel = 0; // пружина squash
  private wobblePhase = 0;
  private wobbleAmp = 0;
  private crashSpin = 0; // >0 — кувырок
  private crashSpinVel = 0;
  private prevTime = 0;
  private idleSeed = Math.PI * 0.37; // детерминированная фаза idle

  constructor() {
    this.model = AssetLib.ready() ? AssetLib.clone('penguin') : this.fallbackModel();
    // GLB смотрит в +Z? — подобрано визуально: разворот к камере/по курсу.
    this.model.rotation.y = 0; // GLB смотрит в -Z (подобрано визуально: заезд — спиной к камере)
    this.squash.add(this.model);
    this.lean.add(this.squash);
    this.orient.add(this.lean);
    this.group.add(this.orient);
    // лёгкий наклон «сидя в тюбинге»
    this.model.position.y = -0.08;
  }

  /** Фолбэк на случай отсутствия ассетов (smoke-run без DOM не строит Penguin). */
  private fallbackModel(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.9 }),
    );
    body.scale.set(0.9, 1.15, 0.9);
    body.position.y = 0.55;
    g.add(body);
    return g;
  }

  // ---------- публичные ручки ----------

  /** Крен в повороте: -1..1 (право +). Макс. визуальный roll ~0.6 рад. */
  setLean(steer: number, vx: number): void {
    this.leanTarget = clamp(-steer * 0.45 - vx * 0.028, -0.62, 0.62);
  }

  /** Наклон по склону (рад, вперёд = вниз). */
  setSlopePitch(pitch: number): void {
    this.pitchTarget = clamp(pitch, -0.5, 0.6);
  }

  setFlight(f: number): void {
    this.flight = clamp(f, 0, 1);
  }

  /** Вылет с трамплина/гребня: stretch + небольшой anticipation-импульс. */
  onJump(): void {
    this.squashY = 1.24;
    this.squashVel = 0;
    this.wobbleAmp = Math.min(0.5, this.wobbleAmp + 0.22);
  }

  /** Приземление: squash ∝ жёсткости (0..1). */
  onLand(hardness: number): void {
    this.squashY = 1 - 0.28 * clamp(hardness, 0, 1);
    this.squashVel = 0;
    this.wobbleAmp = Math.min(0.6, this.wobbleAmp + 0.3 * hardness + 0.12);
  }

  /** Толчок неровности (кочка, лёгкое касание). */
  bump(strength: number): void {
    this.wobbleAmp = Math.min(0.55, this.wobbleAmp + strength);
  }

  /** Кувырок при краше: рад/с по оси X (подбрасывание задаёт Game). */
  setCrashSpin(vel: number): void {
    this.crashSpinVel = vel;
    this.crashSpin = vel !== 0 ? this.crashSpin || 0.0001 : 0;
  }

  /** Сброс поз (новый заезд). */
  reset(): void {
    this.leanTarget = this.pitchTarget = this.leanCur = this.pitchCur = 0;
    this.flight = 0;
    this.squashY = 1;
    this.squashVel = 0;
    this.wobbleAmp = 0;
    this.crashSpin = 0;
    this.crashSpinVel = 0;
    this.lean.rotation.set(0, 0, 0);
    this.squash.scale.set(1, 1, 1);
  }

  /**
   * Кадр анимации. time — секунды (монотонные), excitement 0..1 —
   * скорость/интенсивность микродвижений.
   */
  animate(time: number, excitement: number): void {
    const dt = clamp(time - this.prevTime, 0.001, 0.1);
    this.prevTime = time;

    // --- краш-кувырок: быстрое вращение вперёд, затухает с vel ---
    if (this.crashSpinVel !== 0) {
      this.crashSpin += this.crashSpinVel * dt;
      this.lean.rotation.x = -this.crashSpin;
      this.lean.rotation.z = Math.sin(this.crashSpin * 0.7) * 0.35;
      this.squash.scale.set(1, 1, 1);
      return;
    }

    // --- пружины крена/питча ---
    const flightPitch = -0.34 * this.flight; // в полёте — нос вниз (ласты вверх)
    this.leanCur = damp(this.leanCur, this.leanTarget, 10, dt);
    this.pitchCur = damp(this.pitchCur, this.pitchTarget + flightPitch, 8, dt);

    // --- wobble (вторичная качка, затухающая) ---
    this.wobblePhase += dt * (9 + excitement * 6);
    this.wobbleAmp = Math.max(0, this.wobbleAmp - dt * 1.4);
    const wobble = Math.sin(this.wobblePhase) * this.wobbleAmp * 0.16;

    this.lean.rotation.z = this.leanCur + wobble;
    this.lean.rotation.x = this.pitchCur + Math.cos(this.wobblePhase * 0.83) * this.wobbleAmp * 0.1;

    // --- squash & stretch: пружина к 1 (ω~22, ζ~0.55 → восстановление ~0.2с с overshoot) ---
    const k = 220;
    const c = 24;
    const acc = (1 - this.squashY) * k - this.squashVel * c;
    this.squashVel += acc * dt;
    this.squashY = clamp(this.squashY + this.squashVel * dt, 0.7, 1.3);
    const sy = this.squashY;
    // сохранение объёма (0.7..1.3 → x/z обратно, пределы 0.85..1.18)
    const sxz = clamp(1 / Math.sqrt(sy), 0.85, 1.18) + this.flight * 0.04;
    this.squash.scale.set(sxz, sy, sxz);

    // --- idle/бег: дыхание + микро-покачивание ---
    const t = time + this.idleSeed;
    const breathe = Math.sin(t * (2.2 + excitement * 2.5)) * (0.012 + excitement * 0.01);
    this.model.scale.set(1, 1 + breathe, 1);
    this.model.position.y = -0.08 + Math.sin(t * 1.7) * 0.008;
    // озиралка в покое (excitement низкий — меню/aim)
    const lookYaw = (1 - excitement) * Math.sin(t * 0.6) * 0.3;
    this.model.rotation.y = lookYaw;
  }

  /** Появление (меню): easeOutBack-поп. */
  playSpawn(): void {
    this.squash.scale.setScalar(0.01);
    const target = 1;
    const start = performance.now();
    const tick = (): void => {
      const t = clamp((performance.now() - start) / 380, 0, 1);
      this.squash.scale.setScalar(Math.max(0.01, easeOutBack(t) * target));
      if (t < 1 && this.squash.parent) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
