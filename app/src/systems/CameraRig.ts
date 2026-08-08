import * as THREE from 'three';
import { CAMERA } from '@/config';
import { clamp, damp, lerp } from '@/utils/math';

export type CameraMode = 'menu' | 'aim' | 'run' | 'finish';

/**
 * CameraRig — chase-камера 3-го лица (gdd §4.5):
 * MENU/AIM — статичный кадр за рогаткой с «дыханием»; RUN — следование
 * сзади-сверху с лагом (pos 5/с, look 8/с), боковой сдвиг 0.35·vx,
 * FOV = base + min(8, max(0,(v−14)·0.55)) + панчи с τ=0.2 с.
 */
export class CameraRig {
  mode: CameraMode = 'menu';
  /** Мировая опорная точка меню-кадра (база рогатки). */
  readonly origin = new THREE.Vector3();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly lookTarget = new THREE.Vector3();
  private readonly smoothedLook = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private fovPunch = 0;
  private speedFovSm = 0; // демпфированный скоростной FOV (W5)
  private roll = 0;
  private rollTarget = 0;
  private aimBlend = 0; // 0 = menu-кадр, 1 = aim-кадр (по p натяжения)
  private finishBlend = 0;
  private reducedMotion = false;
  private shakeRigTraumaPulse = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.camera.position.set(CAMERA.menuPos.x, CAMERA.menuPos.y, CAMERA.menuPos.z);
    this.smoothedLook.set(CAMERA.menuLook.x, CAMERA.menuLook.y, CAMERA.menuLook.z);
  }

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v;
  }

  /** Базовый FOV: 60 портрет / 55 ландшафт. */
  get baseFov(): number {
    return this.camera.aspect < 1 ? CAMERA.fovPortrait : CAMERA.fovLandscape;
  }

  punchFov(degrees: number): void {
    this.fovPunch = Math.min(12, this.fovPunch + degrees);
  }

  setAimBlend(p: number): void {
    this.aimBlend = clamp(p, 0, 1);
  }

  /** Пульс-дрожь на ≥90% натяжения (gdd §4.2). */
  setAimTensionPulse(active: boolean): void {
    this.shakeRigTraumaPulse = active ? 1 : 0;
  }

  snapToMode(): void {
    // мгновенная установка при смене состояния (без резкого пролёта)
    this.camera.position.copy(this.desiredPos);
    this.smoothedLook.copy(this.lookTarget);
  }

  update(
    delta: number,
    time: number,
    playerPos: THREE.Vector3,
    vx: number,
    speed: number,
    heading: number,
  ): void {
    const bobAmp = this.reducedMotion ? 0 : CAMERA.menuBobAmp;
    const bob = Math.sin(time * CAMERA.menuBobHz * Math.PI * 2) * bobAmp;

    if (this.mode === 'menu' || this.mode === 'aim') {
      const t = this.mode === 'aim' ? this.aimBlend : 0;
      this.desiredPos.set(
        this.origin.x + lerp(CAMERA.menuPos.x, CAMERA.aimPos.x, t),
        this.origin.y + lerp(CAMERA.menuPos.y, CAMERA.aimPos.y, t) + bob,
        this.origin.z + lerp(CAMERA.menuPos.z, CAMERA.aimPos.z, t),
      );
      this.lookTarget.set(
        this.origin.x + CAMERA.menuLook.x,
        this.origin.y + CAMERA.menuLook.y,
        this.origin.z + CAMERA.menuLook.z,
      );
      const k = damp(CAMERA.posLag, delta);
      this.camera.position.lerp(this.desiredPos, k);
      this.smoothedLook.lerp(this.lookTarget, damp(CAMERA.lookLag, delta));
    } else if (this.mode === 'finish') {
      this.finishBlend = Math.min(1, this.finishBlend + delta / CAMERA.finish.duration);
      this.desiredPos.set(
        playerPos.x + CAMERA.finish.offset.x,
        playerPos.y + CAMERA.finish.offset.y,
        playerPos.z + CAMERA.finish.offset.z,
      );
      this.lookTarget.copy(playerPos);
      this.camera.position.lerp(this.desiredPos, damp(4, delta));
      this.smoothedLook.lerp(this.lookTarget, damp(6, delta));
    } else {
      this.finishBlend = 0;
      // целевая позиция = игрок + (0, 4.2, 7.8) в локальных осях движения
      const sin = Math.sin(heading);
      const cos = Math.cos(heading);
      this.desiredPos.set(
        playerPos.x + CAMERA.followOffset.x * cos + CAMERA.followOffset.z * sin + CAMERA.lateralShift * vx,
        playerPos.y + CAMERA.followOffset.y,
        playerPos.z - CAMERA.followOffset.x * sin + CAMERA.followOffset.z * cos,
      );
      // W5: look-ahead растёт со скоростью (видно дальше по склону),
      // в полёте взгляд чуть ниже — на зону приземления
      const ahead = Math.min(speed * CAMERA.lookAheadSpeedMul, CAMERA.lookAheadSpeedMax);
      this.lookTarget.set(
        playerPos.x + CAMERA.lookAhead.x + CAMERA.lateralShift * vx * 0.5,
        playerPos.y + (airborne ? 0.4 : CAMERA.lookAhead.y),
        playerPos.z + CAMERA.lookAhead.z - ahead,
      );
      // W5: в полёте демпфинг слабее — камера «отстаёт», подчёркивая высоту
      const posLag = airborne ? CAMERA.airPosLag : CAMERA.posLag;
      this.camera.position.lerp(this.desiredPos, damp(posLag, delta));
      this.smoothedLook.lerp(this.lookTarget, damp(CAMERA.lookLag, delta));
      // W5: плавный крен ∝ боковой скорости (виражи читаются телом камеры)
      const maxRoll = (CAMERA.rollMaxDeg * Math.PI) / 180;
      this.rollTarget = clamp(-vx * CAMERA.rollMul, -maxRoll, maxRoll);
    }

    // дрожь натяжения ≥90%
    if (this.shakeRigTraumaPulse > 0 && this.mode === 'aim') {
      const n = Math.sin(time * 55) * 0.03;
      this.camera.position.x += n;
      this.camera.position.y += n * 0.6;
    }

    this.camera.lookAt(this.smoothedLook);

    // --- FOV ---
    if (this.fovPunch > 0.001) {
      this.fovPunch *= Math.exp(-delta / CAMERA.fovPunchTau);
      if (this.fovPunch < 0.001) this.fovPunch = 0;
    }
    const speedFov =
      this.mode === 'run' ? clamp((speed - CAMERA.fovSpeedStart) * CAMERA.fovSpeedMul, 0, CAMERA.fovSpeedMax) : 0;
    const finishFov = this.mode === 'finish' ? CAMERA.finish.fovDelta * this.finishBlend : 0;
    this.camera.fov = this.baseFov + speedFov + this.fovPunch + finishFov;
    this.camera.updateProjectionMatrix();
  }

  reset(): void {
    this.fovPunch = 0;
    this.aimBlend = 0;
    this.finishBlend = 0;
  }
}
