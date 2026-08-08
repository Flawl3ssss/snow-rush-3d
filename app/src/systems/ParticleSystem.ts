import * as THREE from 'three';
import { COLORS, VISUAL } from '@/config';
import { createSeededRandom } from '@/utils/random';
import type { RandomFn } from '@/utils/random';
import {
  confettiFallbackTexture,
  snowflakeFallbackTexture,
  snowPuffFallbackTexture,
  speedLineFallbackTexture,
  starBurstFallbackTexture,
  textureWithFallback,
} from '@/world/materials';
import { vfxHub } from '@/world/vfxHub';
import type { VfxEvent } from '@/world/vfxHub';

/**
 * ParticleSystem — все VFX мира (world-graphics):
 *  • снегопад по design §5.4 (800/1200 частиц, wrap-коробка 60×40×60 вокруг
 *    камеры, спрайт /fx-snowflake.png с procedural fallback, 3 слоя размеров
 *    0.12–0.35 м, обычный блендинг, seeded дрейф);
 *  • снежные брызги из-под тюбинга (∝ скорости и стерингу, /fx-snow-puff.png);
 *  • speed lines при бусте (12 streak-спрайтов, /fx-speed-line.png);
 *  • звёздные вспышки пикапов (/fx-star-burst.png) + кольцевые вспышки;
 *  • конфетти финиша (80 частиц) и снежный всплеск приземления/крэша.
 *
 * API для Game сохранён: constructor(scene, count, seed),
 * update(delta, time, cameraCenter), setVisible(v), dispose(scene).
 * События приходят через world/vfxHub (game/* не трогаем).
 */

// ---------------------------------------------------------------------------
// BurstPool — пул точечных частиц с per-particle size/alpha (1 draw call).
// Шейдер минимален (shader-cookbook: shader только ради перформанса/читаемости).
// ---------------------------------------------------------------------------

const BURST_VERT = `
attribute float aSize;
attribute float aBirth;
attribute float aLife;
attribute vec3 aColor;
uniform float uTime;
uniform float uGrow;
uniform float uUseColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float age = uTime - aBirth;
  float alive = step(0.0, age) * step(age, aLife);
  float t = clamp(age / max(aLife, 0.001), 0.0, 1.0);
  vAlpha = alive * (1.0 - t) * (1.0 - t);
  vColor = mix(vec3(1.0), aColor, uUseColor);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float scale = mix(1.0, uGrow, t);
  gl_PointSize = aSize * scale * alive * (280.0 / max(0.1, -mv.z));
  gl_Position = alive > 0.5 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const BURST_FRAG = `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
  if (gl_FragColor.a < 0.02) discard;
}
`;

interface BurstPoolOptions {
  capacity: number;
  map: THREE.Texture;
  gravity: number;
  drag: number;
  grow: number; // конечный множитель размера (1 = без роста)
  useColor: boolean;
  additive?: boolean;
}

class BurstPool {
  readonly points: THREE.Points;
  private readonly capacity: number;
  private readonly vel: Float32Array;
  private readonly birth: Float32Array;
  private readonly life: Float32Array;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly birthAttr: THREE.BufferAttribute;
  private readonly lifeAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private cursor = 0;
  private readonly gravity: number;
  private readonly drag: number;

  constructor(opts: BurstPoolOptions) {
    this.capacity = opts.capacity;
    this.gravity = opts.gravity;
    this.drag = opts.drag;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(this.capacity * 3);
    // стартовая позиция далеко под землёй — на всякий случай
    for (let i = 0; i < this.capacity; i += 1) positions[i * 3 + 1] = -1000;
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.vel = new Float32Array(this.capacity * 3);
    this.birth = new Float32Array(this.capacity).fill(-100);
    this.life = new Float32Array(this.capacity).fill(0.001);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(this.capacity), 1);
    this.birthAttr = new THREE.BufferAttribute(this.birth, 1);
    this.lifeAttr = new THREE.BufferAttribute(this.life, 1);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3);
    for (const a of [this.sizeAttr, this.birthAttr, this.lifeAttr, this.colorAttr]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aBirth', this.birthAttr);
    geo.setAttribute('aLife', this.lifeAttr);
    geo.setAttribute('aColor', this.colorAttr);

    this.material = new THREE.ShaderMaterial({
      vertexShader: BURST_VERT,
      fragmentShader: BURST_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uGrow: { value: opts.grow },
        uUseColor: { value: opts.useColor ? 1 : 0 },
        uMap: { value: opts.map },
      },
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  spawn(
    time: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    color?: THREE.Color,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const pos = this.posAttr.array as Float32Array;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.birth[i] = time;
    this.life[i] = life;
    (this.sizeAttr.array as Float32Array)[i] = size;
    if (color) {
      (this.colorAttr.array as Float32Array)[i * 3] = color.r;
      (this.colorAttr.array as Float32Array)[i * 3 + 1] = color.g;
      (this.colorAttr.array as Float32Array)[i * 3 + 2] = color.b;
      this.colorAttr.needsUpdate = true;
    }
    this.birthAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  update(delta: number, time: number): void {
    this.material.uniforms.uTime.value = time;
    const pos = this.posAttr.array as Float32Array;
    const dragK = Math.exp(-this.drag * delta);
    for (let i = 0; i < this.capacity; i += 1) {
      if (time - this.birth[i] > this.life[i]) continue;
      this.vel[i * 3 + 1] -= this.gravity * delta;
      this.vel[i * 3] *= dragK;
      this.vel[i * 3 + 1] *= dragK;
      this.vel[i * 3 + 2] *= dragK;
      pos[i * 3] += this.vel[i * 3] * delta;
      pos[i * 3 + 1] += this.vel[i * 3 + 1] * delta;
      pos[i * 3 + 2] += this.vel[i * 3 + 2] * delta;
    }
    this.posAttr.needsUpdate = true;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Кольцевая вспышка (design §6.1: ring 300 мс)
// ---------------------------------------------------------------------------

interface ActiveRing {
  mesh: THREE.Mesh;
  birth: number;
  billboard: boolean;
}

// ---------------------------------------------------------------------------
// ParticleSystem
// ---------------------------------------------------------------------------

export class ParticleSystem {
  private readonly scene: THREE.Scene;
  private readonly rng: RandomFn;
  private readonly unsubVfx: () => void;

  // снегопад (3 слоя размеров)
  private readonly snowLayers: THREE.Points[] = [];
  private readonly snowVel: Float32Array[] = [];
  private readonly snowPhase: Float32Array[] = [];
  private readonly box = VISUAL.snow.box;

  // пулы брызг/вспышек/конфетти
  private readonly sprayPool: BurstPool;
  private readonly sparkPool: BurstPool;
  private readonly confettiPool: BurstPool;
  private sprayAccumulator = 0;
  private airAccumulator = 0;
  private boostAccumulator = 0;

  // кольца
  private readonly rings: ActiveRing[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.75, 1, 24);

  // speed lines
  private readonly speedLines: THREE.Sprite[] = [];
  private readonly speedLineSeeds: Float32Array;
  private speedLineIntensity = 0;

  // трекинг игрока/финиша (по именам, game/* не меняем)
  private tube: THREE.Object3D | null = null;
  private gate: THREE.Object3D | null = null;
  private readonly prevTubePos = new THREE.Vector3();
  private readonly smoothVel = new THREE.Vector3();
  private hasPrevPos = false;
  private gateCrossed = false;
  private lastTubeZ = 0;

  constructor(scene: THREE.Scene, count: number, seed: number) {
    this.scene = scene;
    this.rng = createSeededRandom(`vfx-${seed}`);

    // --- снегопад: слои по design §5.4 ---
    const flakeTex = textureWithFallback('/fx-snowflake.png', snowflakeFallbackTexture());
    const layerRng = createSeededRandom(`snow-${seed}`);
    let assigned = 0;
    VISUAL.snow.layers.forEach((layer, li) => {
      const isLast = li === VISUAL.snow.layers.length - 1;
      const layerCount = isLast ? count - assigned : Math.round(count * layer.share);
      assigned += layerCount;
      const positions = new Float32Array(layerCount * 3);
      const vel = new Float32Array(layerCount);
      const phase = new Float32Array(layerCount);
      for (let i = 0; i < layerCount; i += 1) {
        positions[i * 3] = (layerRng() - 0.5) * this.box.x;
        positions[i * 3 + 1] = layerRng() * this.box.y;
        positions[i * 3 + 2] = (layerRng() - 0.5) * this.box.z;
        vel[i] = VISUAL.snow.fallSpeedMin + layerRng() * (VISUAL.snow.fallSpeedMax - VISUAL.snow.fallSpeedMin);
        phase[i] = layerRng() * Math.PI * 2;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        map: flakeTex,
        color: 0xffffff,
        size: layer.size,
        transparent: true,
        opacity: VISUAL.snow.opacity,
        sizeAttenuation: true,
        depthWrite: false,
        alphaTest: 0.01,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.renderOrder = 9;
      scene.add(points);
      this.snowLayers.push(points);
      this.snowVel.push(vel);
      this.snowPhase.push(phase);
    });

    // --- пулы событийных частиц ---
    this.sprayPool = new BurstPool({
      capacity: VISUAL.spray.maxParticles,
      map: textureWithFallback('/fx-snow-puff.png', snowPuffFallbackTexture()),
      gravity: 4.5,
      drag: 2.2,
      grow: 2.2,
      useColor: false,
    });
    this.sparkPool = new BurstPool({
      capacity: 96,
      map: textureWithFallback('/fx-star-burst.png', starBurstFallbackTexture()),
      gravity: 1.2,
      drag: 1.5,
      grow: 0.4,
      useColor: true,
      additive: true,
    });
    this.confettiPool = new BurstPool({
      capacity: Math.max(128, VISUAL.confetti.count + 16),
      map: confettiFallbackTexture(),
      gravity: 3.2,
      drag: 1.1,
      grow: 0.8,
      useColor: true,
    });
    scene.add(this.sprayPool.points, this.sparkPool.points, this.confettiPool.points);

    // --- speed lines (12 streak-спрайтов по краям, design §6.1) ---
    const streakTex = textureWithFallback('/fx-speed-line.png', speedLineFallbackTexture());
    this.speedLineSeeds = new Float32Array(VISUAL.speedLines.count * 2);
    for (let i = 0; i < VISUAL.speedLines.count; i += 1) {
      const mat = new THREE.SpriteMaterial({
        map: streakTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(2.6, 0.4, 1);
      sprite.renderOrder = 20;
      sprite.visible = false;
      const angle = (i / VISUAL.speedLines.count) * Math.PI * 2 + this.rng() * 0.4;
      this.speedLineSeeds[i * 2] = angle;
      this.speedLineSeeds[i * 2 + 1] = this.rng();
      scene.add(sprite);
      this.speedLines.push(sprite);
    }

    this.unsubVfx = vfxHub.on((e) => this.handleVfxEvent(e));
  }

  // ------------------------------------------------------------- события ---

  private eventTime = 0;

  private handleVfxEvent(e: VfxEvent): void {
    const t = this.eventTime;
    const p = e.position;
    const gold = new THREE.Color(COLORS.coinGold);
    const pink = new THREE.Color(COLORS.crystalPink);
    switch (e.type) {
      case 'pickup_coin':
        for (let i = 0; i < 5; i += 1) {
          const a = this.rng() * Math.PI * 2;
          this.sparkPool.spawn(t, p.x, p.y, p.z, Math.cos(a) * 1.6, 1.2 + this.rng() * 1.5, Math.sin(a) * 1.6, 0.45, 0.55, gold);
        }
        break;
      case 'pickup_gem':
        for (let i = 0; i < 10; i += 1) {
          const a = (i / 10) * Math.PI * 2;
          this.sparkPool.spawn(t, p.x, p.y, p.z, Math.cos(a) * 2.6, 1.6 + this.rng() * 2, Math.sin(a) * 2.6, 0.6, 0.8, pink);
        }
        this.spawnRing(t, p, true);
        break;
      case 'land':
        for (let i = 0; i < 14; i += 1) {
          const a = this.rng() * Math.PI * 2;
          const r = 1.5 + this.rng() * 2.5;
          this.sprayPool.spawn(t, p.x + Math.cos(a) * 0.4, p.y + 0.15, p.z + Math.sin(a) * 0.4, Math.cos(a) * r, 1.5 + this.rng() * 2, Math.sin(a) * r, 0.55 + this.rng() * 0.3, 0.9);
        }
        this.spawnRing(t, p, false);
        break;
      case 'hit':
        for (let i = 0; i < 10; i += 1) {
          this.sprayPool.spawn(t, p.x, p.y + 0.3, p.z, (this.rng() - 0.5) * 5, 2 + this.rng() * 3, (this.rng() - 0.5) * 5, 0.5 + this.rng() * 0.3, 1.1);
        }
        break;
      case 'crash': {
        // масштаб взрыва ∝ силе удара (W3)
        const k = 0.75 + (e.strength ?? 0.7) * 0.85;
        const sprayCount = Math.round(18 * k + 8);
        for (let i = 0; i < sprayCount; i += 1) {
          const a = this.rng() * Math.PI * 2;
          const r = (2 + this.rng() * 4) * k;
          this.sprayPool.spawn(t, p.x, p.y + 0.3, p.z, Math.cos(a) * r, (2.5 + this.rng() * 4) * k, Math.sin(a) * r, 0.7 + this.rng() * 0.5, 1.4);
        }
        const sparkCount = Math.round(6 * k + 2);
        for (let i = 0; i < sparkCount; i += 1) {
          const a = this.rng() * Math.PI * 2;
          this.sparkPool.spawn(t, p.x, p.y + 0.6, p.z, Math.cos(a) * 3 * k, (3 + this.rng() * 3) * k, Math.sin(a) * 3 * k, 0.7, 0.9, new THREE.Color(0xffffff));
        }
        this.spawnRing(t, p, false);
        break;
      }
      case 'launch':
        for (let i = 0; i < 8; i += 1) {
          this.sprayPool.spawn(t, p.x, p.y + 0.2, p.z, (this.rng() - 0.5) * 3, 1 + this.rng() * 2, 1 + this.rng() * 2, 0.5, 0.9);
        }
        break;
    }
  }

  private spawnRing(time: number, pos: THREE.Vector3, billboard: boolean): void {
    const mat = new THREE.MeshBasicMaterial({
      color: billboard ? COLORS.crystalPink : 0xffffff,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.copy(pos);
    if (!billboard) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y += 0.15;
    }
    mesh.renderOrder = 11;
    this.scene.add(mesh);
    this.rings.push({ mesh, birth: time, billboard });
  }

  // ----------------------------------------------------------- главный апдейт ---

  update(
    delta: number,
    time: number,
    center: THREE.Vector3,
    ctx?: { boosting?: boolean; airborne?: boolean },
  ): void {
    this.eventTime = time;
    this.updateSnow(delta, time, center);
    this.trackPlayer(delta);
    this.updateSpray(delta, time, ctx?.airborne ?? false);
    if (ctx?.boosting) this.updateBoostTrail(delta, time);
    this.sprayPool.update(delta, time);
    this.sparkPool.update(delta, time);
    this.confettiPool.update(delta, time);
    this.updateRings(time, center);
    this.updateSpeedLines(delta, time);
    this.checkFinishCrossing(time);
  }

  /** Снегопад: падение + синусный дрейф, wrap вокруг камеры (design §5.4). */
  private updateSnow(delta: number, time: number, center: THREE.Vector3): void {
    const { x: bx, y: by, z: bz } = this.box;
    this.snowLayers.forEach((points, li) => {
      const attr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const vel = this.snowVel[li];
      const phase = this.snowPhase[li];
      const count = vel.length;
      for (let i = 0; i < count; i += 1) {
        let y = arr[i * 3 + 1] - vel[i] * delta;
        let x = arr[i * 3] + Math.sin(time * 1.2 + phase[i]) * VISUAL.snow.drift * delta;
        let z = arr[i * 3 + 2] + Math.cos(time * 0.9 + phase[i] * 1.3) * VISUAL.snow.drift * 0.6 * delta;
        if (y < center.y - 4) y += by;
        else if (y > center.y + by - 4) y -= by;
        if (x < center.x - bx / 2) x += bx;
        else if (x > center.x + bx / 2) x -= bx;
        if (z < center.z - bz / 2) z += bz;
        else if (z > center.z + bz / 2) z -= bz;
        arr[i * 3] = x;
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = z;
      }
      attr.needsUpdate = true;
    });
  }

  /** Игрок по имени ('playerTube'); скорость — из дельты позиции. */
  private trackPlayer(delta: number): void {
    if (!this.tube || !this.tube.parent) {
      this.tube = this.scene.getObjectByName('playerTube') ?? null;
      this.hasPrevPos = false;
      if (!this.tube) return;
    }
    const pos = this.tube.position;
    if (this.hasPrevPos && delta > 0.0001) {
      const inv = 1 / delta;
      // сглаженная скорость (экспоненциально, ~8/с)
      const k = Math.min(1, 8 * delta);
      this.smoothVel.x += ((pos.x - this.prevTubePos.x) * inv - this.smoothVel.x) * k;
      this.smoothVel.y += ((pos.y - this.prevTubePos.y) * inv - this.smoothVel.y) * k;
      this.smoothVel.z += ((pos.z - this.prevTubePos.z) * inv - this.smoothVel.z) * k;
    }
    this.prevTubePos.copy(pos);
    this.hasPrevPos = true;
  }

  /** Брызги из-под тюбинга: интенсивность ∝ скорости и стерингу (design §6.1). */
  private updateSpray(delta: number, time: number, airborne: boolean): void {
    if (!this.tube) return;
    const speed = Math.hypot(this.smoothVel.x, this.smoothVel.z);
    const grounded = Math.abs(this.smoothVel.y) < 2.2;
    if (airborne || !grounded) {
      // воздушный след в полёте (промт §4): тонкие белые стримеры за тюбингом
      this.sprayAccumulator = 0;
      if (speed > 8) {
        this.airAccumulator += 22 * delta;
        const p = this.tube.position;
        const inv = 1 / Math.max(speed, 0.001);
        const backX = -this.smoothVel.x * inv;
        const backZ = -this.smoothVel.z * inv;
        const white = new THREE.Color(0xffffff);
        while (this.airAccumulator >= 1) {
          this.airAccumulator -= 1;
          const side = (this.rng() - 0.5) * 1.4;
          this.sparkPool.spawn(
            time,
            p.x + backX * 0.6 - backZ * side,
            p.y + 0.3 + (this.rng() - 0.5) * 0.4,
            p.z + backZ * 0.6 + backX * side,
            backX * speed * 0.25,
            -0.4,
            backZ * speed * 0.25,
            0.35 + this.rng() * 0.2,
            0.5 + this.rng() * 0.3,
            white,
          );
        }
      }
      return;
    }
    if (speed < VISUAL.spray.minSpeed) {
      this.sprayAccumulator = 0;
      return;
    }
    // стеринг ≈ боковая составляющая скорости относительно направления движения
    const forwardZ = -Math.abs(this.smoothVel.z) || -0.001;
    const lateral = Math.abs(this.smoothVel.x) / Math.max(4, Math.abs(forwardZ));
    const rate =
      speed * VISUAL.spray.ratePerSpeed * (1 + VISUAL.spray.steerMul * Math.min(1, lateral * 2.5));
    this.sprayAccumulator += rate * delta;
    const p = this.tube.position;
    // направление "назад" — против горизонтальной скорости
    const inv = 1 / Math.max(speed, 0.001);
    const backX = -this.smoothVel.x * inv;
    const backZ = -this.smoothVel.z * inv;
    while (this.sprayAccumulator >= 1) {
      this.sprayAccumulator -= 1;
      const side = this.rng() < 0.5 ? -1 : 1;
      const spread = 0.3 + this.rng() * 0.5;
      this.sprayPool.spawn(
        time,
        p.x + backX * 0.7 + -backZ * side * 0.5 * spread,
        p.y + 0.12,
        p.z + backZ * 0.7 + backX * side * 0.5 * spread,
        backX * (1.5 + this.rng() * 2) + -backZ * side * spread * 2.2,
        0.8 + this.rng() * 1.8 + speed * 0.04,
        backZ * (1.5 + this.rng() * 2) + backX * side * spread * 2.2,
        VISUAL.spray.lifeMin + this.rng() * (VISUAL.spray.lifeMax - VISUAL.spray.lifeMin),
        0.55 + this.rng() * 0.5,
      );
    }
  }

  /** Огненный след нитро (промт §4): оранжево-золотые искры за тюбингом. */
  private updateBoostTrail(delta: number, time: number): void {
    if (!this.tube) return;
    const speed = Math.hypot(this.smoothVel.x, this.smoothVel.z);
    if (speed < 3) return;
    this.boostAccumulator += 46 * delta;
    const p = this.tube.position;
    const inv = 1 / Math.max(speed, 0.001);
    const backX = -this.smoothVel.x * inv;
    const backZ = -this.smoothVel.z * inv;
    const orange = new THREE.Color(0xff8c42);
    const gold = new THREE.Color(0xffc933);
    while (this.boostAccumulator >= 1) {
      this.boostAccumulator -= 1;
      const side = (this.rng() - 0.5) * 0.5;
      this.sparkPool.spawn(
        time,
        p.x + backX * 0.9 - backZ * side,
        p.y + 0.32 + (this.rng() - 0.5) * 0.25,
        p.z + backZ * 0.9 + backX * side,
        backX * (3 + this.rng() * 3),
        0.6 + this.rng() * 1.4,
        backZ * (3 + this.rng() * 3),
        0.3 + this.rng() * 0.25,
        0.6 + this.rng() * 0.5,
        this.rng() < 0.5 ? orange : gold,
      );
    }
  }

  private updateRings(time: number, cameraPos: THREE.Vector3): void {
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const ring = this.rings[i];
      const t = (time - ring.birth) / VISUAL.ring.life;
      if (t >= 1) {
        this.scene.remove(ring.mesh);
        (ring.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const scale = 0.3 + t * VISUAL.ring.maxScale;
      ring.mesh.scale.setScalar(scale);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t);
      if (ring.billboard) ring.mesh.lookAt(cameraPos);
    }
  }

  /** Speed lines: 12 streak-спрайтов в плоскости ⟂ скорости, по краям кадра. */
  private updateSpeedLines(delta: number, time: number): void {
    if (!this.tube) return;
    const speed = Math.hypot(this.smoothVel.x, this.smoothVel.z);
    const target = THREE.MathUtils.clamp(
      (speed - VISUAL.speedLines.minSpeed) / (VISUAL.speedLines.fullSpeed - VISUAL.speedLines.minSpeed),
      0,
      1,
    );
    this.speedLineIntensity += (target - this.speedLineIntensity) * Math.min(1, 6 * delta);
    const intensity = this.speedLineIntensity;
    const show = intensity > 0.03 && speed > 1;
    const p = this.tube.position;
    // базис: направление движения
    const dirX = this.smoothVel.x / Math.max(speed, 0.001);
    const dirZ = this.smoothVel.z / Math.max(speed, 0.001);
    // "right" в горизонтальной плоскости
    const rightX = -dirZ;
    const rightZ = dirX;
    const cx = p.x + dirX * VISUAL.speedLines.distance;
    const cy = p.y + 1.6;
    const cz = p.z + dirZ * VISUAL.speedLines.distance;
    for (let i = 0; i < this.speedLines.length; i += 1) {
      const sprite = this.speedLines[i];
      sprite.visible = show;
      if (!show) continue;
      const angle = this.speedLineSeeds[i * 2];
      const phase = this.speedLineSeeds[i * 2 + 1];
      // лучи летят наружу по циклу
      const cycle = (time * 2.2 + phase) % 1;
      const r =
        VISUAL.speedLines.radiusMin +
        (VISUAL.speedLines.radiusMax - VISUAL.speedLines.radiusMin) * (0.35 + cycle * 0.65);
      const ox = Math.cos(angle) * r;
      const oy = Math.sin(angle) * r * 0.62;
      sprite.position.set(cx + rightX * ox, cy + oy, cz + rightZ * ox);
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.rotation = -angle;
      mat.opacity = intensity * 0.55 * Math.sin(cycle * Math.PI);
    }
  }

  /** Объект всё ещё в сцене? (контент заезда пересобирается между заездами) */
  private isInScene(obj: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = obj;
    while (cur.parent) cur = cur.parent;
    return cur === this.scene;
  }

  /** Конфетти при пролёте финишных ворот (design §6.1: 80 частиц). */
  private checkFinishCrossing(time: number): void {
    if (!this.tube) return;
    if (!this.gate || !this.isInScene(this.gate)) {
      this.gate = this.scene.getObjectByName('finishGate') ?? null;
      this.gateCrossed = false;
      this.lastTubeZ = this.tube.position.z;
      if (!this.gate) return;
    }
    const gz = this.gate.position.z;
    const pz = this.tube.position.z;
    // движение в −z; пересечение: был «до» ворот (z > gz), стал «за»
    if (!this.gateCrossed && this.lastTubeZ > gz && pz <= gz) {
      this.gateCrossed = true;
      const gp = this.gate.position;
      const palette = [
        new THREE.Color(COLORS.accentRed),
        new THREE.Color(0xffffff),
        new THREE.Color(COLORS.coinGold),
        new THREE.Color(COLORS.diamondCyan),
        new THREE.Color(COLORS.crystalPink),
        new THREE.Color(COLORS.tubeBlue),
      ];
      for (let i = 0; i < VISUAL.confetti.count; i += 1) {
        this.confettiPool.spawn(
          time,
          gp.x + (this.rng() - 0.5) * 16,
          gp.y + 2.5 + this.rng() * 2.5,
          gp.z + (this.rng() - 0.5) * 1.5,
          (this.rng() - 0.5) * 4,
          2 + this.rng() * 4,
          (this.rng() - 0.5) * 2,
          VISUAL.confetti.life * (0.7 + this.rng() * 0.6),
          0.28 + this.rng() * 0.2,
          palette[Math.floor(this.rng() * palette.length)],
        );
      }
    }
    this.lastTubeZ = pz;
  }

  setVisible(v: boolean): void {
    for (const layer of this.snowLayers) layer.visible = v;
  }

  dispose(scene: THREE.Scene): void {
    this.unsubVfx();
    for (const layer of this.snowLayers) {
      scene.remove(layer);
      layer.geometry.dispose();
      (layer.material as THREE.Material).dispose();
    }
    this.sprayPool.dispose(scene);
    this.sparkPool.dispose(scene);
    this.confettiPool.dispose(scene);
    for (const sprite of this.speedLines) {
      scene.remove(sprite);
      (sprite.material as THREE.Material).dispose();
    }
    for (const ring of this.rings) {
      scene.remove(ring.mesh);
      (ring.mesh.material as THREE.Material).dispose();
    }
    this.rings.length = 0;
    this.ringGeo.dispose();
  }
}
