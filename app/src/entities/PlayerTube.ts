import * as THREE from 'three';
import { COLORS, PHYSICS, UPGRADE_TIERS } from '@/config';
import { AssetLib } from '@/systems/AssetLib';
import { Penguin } from './Penguin';
import type { TweenManager } from '@/utils/tween';
import { easeOutBack } from '@/utils/tween';
import { vfxHub } from '@/world/vfxHub';
import { clamp } from '@/utils/math';

/**
 * PlayerTube — пингвин в тюбинге. Визуальная иерархия (контракт scaffold):
 * group (мировая позиция/курс)
 *  └─ squashNode (squash&stretch, tumble)
 *      └─ bodyNode (roll от стеринга, bob)
 *          ├─ tube + penguin
 * Тюбинг: синий #3D8BFD глянец, красные борта (#E84545), ручки, тёмное дно.
 * group назван 'playerTube' — ParticleSystem находит его для брызг/speed lines.
 */
export class PlayerTube {
  readonly group = new THREE.Group();
  readonly squashNode = new THREE.Group();
  readonly bodyNode = new THREE.Group();
  readonly penguin = new Penguin();

  private roll = 0;
  private pitch = 0;
  private airPitch = 0; // W4: сглаженный подъём носа в полёте (∝ vy)
  private tumbleAngle = 0;
  private tumbleVelocity = 0;
  private tumbling = false;

  // материалы и детали визуальной эволюции (промт §9)
  private readonly tubeMat: THREE.MeshStandardMaterial;
  private readonly rimMat: THREE.MeshStandardMaterial;
  private readonly tier1Details = new THREE.Group();
  private readonly tier2Details = new THREE.Group();
  private readonly tier3Details = new THREE.Group();
  // полёт/буст (промт §4)
  private flightBlend = 0;
  private readonly boostFlame = new THREE.Group();
  private boostOn = false;

  constructor() {
    this.group.name = 'playerTube';
    const tubeDark = new THREE.MeshStandardMaterial({ color: COLORS.tubeBlueDark, flatShading: true, roughness: 0.45, metalness: 0.05 });
    const redMat = new THREE.MeshStandardMaterial({ color: COLORS.accentRed, flatShading: true, roughness: 0.4, metalness: 0.05 });
    this.rimMat = redMat;

    // Основное кольцо — GLB (надувной бублик без фламинго, poly.pizza).
    // Материал клонируем, чтобы applyTier мог тонировать ТОЛЬКО наш экземпляр.
    let tube: THREE.Object3D;
    if (AssetLib.ready()) {
      const glb = AssetLib.clone('tube');
      let found: THREE.MeshStandardMaterial | null = null;
      glb.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !found) {
          m.material = (m.material as THREE.MeshStandardMaterial).clone();
          found = m.material as THREE.MeshStandardMaterial;
          found.roughness = 0.32;
          found.metalness = 0.04;
        }
      });
      this.tubeMat = found ?? new THREE.MeshStandardMaterial({ color: COLORS.tubeBlue });
      tube = glb;
    } else {
      this.tubeMat = new THREE.MeshStandardMaterial({ color: COLORS.tubeBlue, flatShading: true, roughness: 0.3 });
      const torus = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.3, 16, 36), this.tubeMat);
      torus.rotation.x = Math.PI / 2;
      torus.castShadow = true;
      tube = torus;
    }
    tube.position.y = 0.06;

    // Красные борта: верхний и нижний обод по внешней кромке
    const rimTop = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.09, 10, 32), redMat);
    rimTop.rotation.x = Math.PI / 2;
    rimTop.position.y = 0.38;
    rimTop.castShadow = true;
    const rimBottom = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.07, 10, 32), redMat);
    rimBottom.rotation.x = Math.PI / 2;
    rimBottom.position.y = 0.16;

    // Дно тюбинга
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.6, 0.12, 16), tubeDark);
    bottom.position.y = 0.1;

    // Внутреннее сиденье (теневая чаша)
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.1, 14), tubeDark);
    seat.position.y = 0.17;

    // Ручки спереди-сбоку
    const handleGeo = new THREE.CapsuleGeometry(0.045, 0.16, 3, 6);
    for (const side of [-1, 1]) {
      const handle = new THREE.Mesh(handleGeo, redMat);
      handle.position.set(side * 0.62, 0.52, 0.55);
      handle.rotation.z = side * 0.5;
      handle.rotation.x = 0.4;
      this.bodyNode.add(handle);
    }

    // Ниппель надувного клапана
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 6), tubeDark);
    valve.position.set(-0.55, 0.52, -0.45);

    this.penguin.group.position.y = 0.18;
    this.penguin.group.scale.setScalar(0.9);

    this.buildTierDetails();
    this.buildBoostFlame();

    this.bodyNode.add(
      tube,
      rimTop,
      rimBottom,
      bottom,
      seat,
      valve,
      this.penguin.group,
      this.tier1Details,
      this.tier2Details,
      this.tier3Details,
      this.boostFlame,
    );
    this.squashNode.add(this.bodyNode);
    this.group.add(this.squashNode);
  }

  /**
   * Детали визуальной эволюции (промт §9):
   * тир 1 — белые полосы на бортике; тир 2 — металлические полозья;
   * тир 3 — золотые шипы по ободу и свечение бортов.
   */
  private buildTierDetails(): void {
    // тир 1: две тонкие полосы-ободы
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf5f8ff, flatShading: true, roughness: 0.35 });
    for (const y of [0.22, 0.34]) {
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.035, 6, 22), stripeMat);
      stripe.rotation.x = Math.PI / 2;
      stripe.position.y = y;
      this.tier1Details.add(stripe);
    }

    // тир 2: два металлических полозя снизу («санки»)
    const skidMat = new THREE.MeshStandardMaterial({ color: 0xc9d6e8, flatShading: true, roughness: 0.35, metalness: 0.3 });
    for (const side of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 1.0, 3, 8), skidMat);
      skid.rotation.x = Math.PI / 2;
      skid.position.set(side * 0.55, 0.0, 0);
      const upturn = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 3, 8), skidMat);
      upturn.rotation.x = Math.PI / 2 - 0.7;
      upturn.position.set(side * 0.55, 0.08, -0.62);
      this.tier2Details.add(skid, upturn);
    }

    // тир 3: золотые шипы по верхнему ободу
    const spikeMat = new THREE.MeshStandardMaterial({
      color: 0xffc933,
      flatShading: true,
      roughness: 0.3,
      metalness: 0.3,
      emissive: 0x664400,
      emissiveIntensity: 0.35,
    });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), spikeMat);
      spike.position.set(Math.cos(a) * 0.95, 0.48, Math.sin(a) * 0.95);
      this.tier3Details.add(spike);
    }

    this.tier1Details.visible = false;
    this.tier2Details.visible = false;
    this.tier3Details.visible = false;
  }

  /** Применить визуальный тир (0..3) — вызывается при загрузке и покупке апгрейда. */
  applyTier(tier: number): void {
    const t = UPGRADE_TIERS.tube[Math.min(tier, UPGRADE_TIERS.tube.length - 1)];
    this.tubeMat.color.setHex(t.body);
    this.rimMat.color.setHex(t.rims);
    this.tier1Details.visible = tier >= 1;
    this.tier2Details.visible = tier >= 2;
    this.tier3Details.visible = tier >= 3;
  }

  /** Пламя ракеты-нитро за тюбингом (промт §4): два конуса, фликер в updateVisual. */
  private buildBoostFlame(): void {
    const outer = new THREE.Mesh(
      new THREE.ConeGeometry(0.26, 0.9, 8),
      new THREE.MeshBasicMaterial({ color: 0xff8c42, transparent: true, opacity: 0.9 }),
    );
    outer.rotation.x = -Math.PI / 2; // остриё назад (local −z — корма при движении)
    outer.position.set(0, 0.32, -1.15);
    const inner = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.55, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe08a }),
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(0, 0.32, -1.0);
    this.boostFlame.add(outer, inner);
    this.boostFlame.visible = false;
  }

  /** Вкл/выкл пламя нитро (Game знает session.boosting). */
  setBoosting(on: boolean): void {
    this.boostOn = on;
    this.boostFlame.visible = on;
  }

  /**
   * Крейсерская анимация (design.md §6.1): roll ±3°→−12° от стеринга, bob 2.2 Гц.
   * W4: сверху — непрерывный воббл ∝ скорости (тюб «живой» даже на прямой)
   * и подъём носа в полёте ∝ vy (баллистическая поза вместо статичной).
   */
  updateVisual(
    dt: number,
    time: number,
    steer: number,
    vx: number,
    onIce: boolean,
    airborne = false,
    speed = 0,
    vy = 0,
  ): void {
    const targetRoll = -steer * 0.21; // до −12°
    this.roll += (targetRoll - this.roll) * Math.min(1, 8 * dt);
    // W4: воббл — частота и амплитуда растут со скоростью; на льду тише
    // (скольжение ровнее, чем по рыхлому снегу).
    const wobbleAmp = 0.02 * Math.min(1, speed / 20) * (onIce ? 0.5 : 1);
    const wobble = Math.sin(time * (4 + speed * 0.12)) * wobbleAmp;
    this.bodyNode.rotation.z = this.roll + (airborne ? 0 : wobble);
    // pitch +2° при торможении рулением о снег (design §6.1)
    const targetPitch = Math.abs(steer) * 0.035;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, 6 * dt);
    // W4: в полёте нос вверх на подъёме, вниз на падении (clamp −0.15…+0.25)
    const targetAirPitch = airborne ? clamp(vy * 0.02, -0.15, 0.25) : 0;
    this.airPitch += (targetAirPitch - this.airPitch) * Math.min(1, 5 * dt);
    this.bodyNode.rotation.x = this.pitch + this.airPitch;
    const bobAmp = onIce ? 0.015 : 0.04;
    this.bodyNode.position.y = airborne ? 0 : Math.sin(time * 2.2 * Math.PI * 2) * bobAmp;
    const excitement = Math.min(1, Math.abs(vx) / 6 + Math.abs(steer) * 0.5);
    // полёт: ласты раскрыты (промт §4), плавный переход за ~0.15 с
    this.flightBlend += ((airborne ? 1 : 0) - this.flightBlend) * Math.min(1, 7 * dt);
    this.penguin.setFlight(this.flightBlend);
    this.penguin.animate(time, 0.3 + excitement * 0.7);
    // фликер пламени нитро
    if (this.boostOn) {
      const flick = 1 + Math.sin(time * 42) * 0.22 + Math.sin(time * 27) * 0.12;
      this.boostFlame.scale.set(1, 1, flick);
    }
  }

  /** Squash & stretch с сохранением объёма (game-feel). squashY<1 — сплющить, >1 — растянуть. */
  squash(tweens: TweenManager, squashY: number, durationSec = 0.18): void {
    // VFX-фидбек (design §6.1): 0.9 — приземление, 0.85 — удар, 1.15 — старт/трамплин
    if (squashY <= 0.88) {
      vfxHub.emit({ type: 'hit', position: this.group.position.clone() });
    } else if (squashY < 1) {
      vfxHub.emit({ type: 'land', position: this.group.position.clone() });
    } else {
      vfxHub.emit({ type: 'launch', position: this.group.position.clone() });
    }
    const startY = this.squashNode.scale.y || 1;
    const startXZ = this.squashNode.scale.x || 1;
    const targetXZ = 1 / Math.sqrt(squashY);
    // фаза 1: к цели, фаза 2: обратно к 1 с overshoot
    tweens.tween(
      durationSec / 2,
      (t) => {
        const y = startY + (squashY - startY) * t;
        const xz = startXZ + (targetXZ - startXZ) * t;
        this.squashNode.scale.set(xz, y, xz);
      },
      easeOutBack,
      () => {
        tweens.tween(
          durationSec / 2,
          (t) => {
            const y = squashY + (1 - squashY) * t;
            const xz = targetXZ + (1 - targetXZ) * t;
            this.squashNode.scale.set(xz, y, xz);
          },
          easeOutBack,
        );
      },
    );
  }

  /** Кувырок при крэше (W3): скорость вращения ∝ силе удара, длительность 2–4 с. */
  startTumble(strength = 1): void {
    this.tumbling = true;
    this.tumbleAngle = 0;
    this.tumbleVelocity = 5 + strength * 5;
    vfxHub.emit({ type: 'crash', position: this.group.position.clone(), strength });
  }

  updateTumble(dt: number): boolean {
    if (!this.tumbling) return true;
    this.tumbleAngle += this.tumbleVelocity * dt;
    this.tumbleVelocity *= Math.exp(-1.2 * dt);
    this.squashNode.rotation.x = -this.tumbleAngle;
    this.squashNode.position.y = Math.abs(Math.sin(this.tumbleAngle)) * 0.4;
    if (this.tumbleVelocity < 0.3) {
      this.tumbling = false;
      return true;
    }
    return false;
  }

  resetPose(): void {
    this.tumbling = false;
    this.tumbleAngle = 0;
    this.squashNode.rotation.set(0, 0, 0);
    this.squashNode.scale.set(1, 1, 1);
    this.squashNode.position.y = 0;
    this.bodyNode.rotation.set(0, 0, 0);
    this.roll = 0;
    this.pitch = 0;
  }

  get radius(): number {
    return PHYSICS.tubeRadius;
  }
}
