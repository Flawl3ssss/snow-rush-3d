/**
 * SkyDome (W6 §3.2) — небосвод по биомам на шейдере.
 *
 * Заменяет двухцветный canvas-градиент: вертикальный градиент в три стопа
 * (горизонт → середина → зенит), солнечный диск с ореолом и облачные полосы
 * (fbm 2 октавы, медленный дрейф). Смена биома лерпится за BLEND_SEC, чтобы
 * переход между картами не был «щелчком».
 *
 * Почему шейдер, а не картинка: панорама /sky-panorama.png (2048×1152, 1.4 МБ)
 * подходила только долине — остальные четыре биома получали плоский градиент
 * из двух цветов. Один шейдер даёт всем биомам одинаковое качество и не стоит
 * ни байта трафика.
 *
 * Купол рисуется первым (renderOrder −100) без записи глубины и без тумана,
 * поэтому не конфликтует с геометрией мира.
 */
import * as THREE from 'three';
import type { MapPalette } from '@/config';

/** Длительность лерпа палитр при смене биома, сек. */
const BLEND_SEC = 1.0;

export interface SkyBiomeLook {
  horizon: THREE.Color;
  mid: THREE.Color;
  zenith: THREE.Color;
  /** Цвет солнца/свечения у горизонта. */
  sun: THREE.Color;
  /** Сила солнечного диска (0 — нет диска, напр. в пещерах). */
  sunPower: number;
  /** Плотность облачных полос 0..1. */
  clouds: number;
}

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // направление от центра купола — единственное, что нужно фрагменту
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying vec3 vDir;

  uniform vec3 uHorizon;
  uniform vec3 uMid;
  uniform vec3 uZenith;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunPower;
  uniform float uClouds;
  uniform float uTime;

  // --- дешёвый value-noise + fbm 2 октавы (без текстур, детерминированно) ---
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y);
  }
  float fbm(vec2 p) {
    return noise(p) * 0.6 + noise(p * 2.3) * 0.4;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0); // 0 — надир, 1 — зенит

    // три стопа: горизонт (0.5) → mid → зенит. smoothstep убирает полосу.
    float tLow = smoothstep(0.5, 0.72, h);
    float tHigh = smoothstep(0.72, 1.0, h);
    vec3 col = mix(uHorizon, uMid, tLow);
    col = mix(col, uZenith, tHigh);

    // свечение у горизонта со стороны солнца (в т.ч. когда диск за камерой)
    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sunDot, 6.0) * 0.18 * uSunPower;
    // сам диск + мягкий ореол
    col += uSunColor * pow(sunDot, 220.0) * 1.6 * uSunPower;
    col += uSunColor * pow(sunDot, 30.0) * 0.25 * uSunPower;

    // облачные полосы: тянутся по горизонтали, медленно дрейфуют
    if (uClouds > 0.001) {
      vec2 uv = vec2(atan(dir.z, dir.x) * 0.6, dir.y * 2.4);
      float band = fbm(uv * vec2(1.0, 2.0) + vec2(uTime * 0.012, uTime * 0.004));
      // облака только выше линии горизонта и гаснут к зениту
      float mask = smoothstep(0.52, 0.66, h) * (1.0 - smoothstep(0.85, 1.0, h));
      float c = smoothstep(0.55, 0.85, band) * mask * uClouds;
      col = mix(col, col + vec3(0.16, 0.17, 0.19), c);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Палитры неба по биомам (плановые описания §3.2).
 * Принимает не весь MapPalette, а только небесные поля — так вызов из
 * конструктора Renderer (где полной палитры ещё нет) не требует лживого
 * приведения типа, которое молча отдало бы undefined при расширении функции.
 */
export function lookForBiome(
  biome: string | undefined,
  palette: Pick<MapPalette, 'skyZenith' | 'skyHorizon'>,
): SkyBiomeLook {
  const zenith = new THREE.Color(palette.skyZenith);
  const horizon = new THREE.Color(palette.skyHorizon);
  // середина по умолчанию — смесь, чуть ближе к горизонту
  const mid = horizon.clone().lerp(zenith, 0.45);
  switch (biome) {
    case 'canyon':
      return { horizon, mid, zenith, sun: new THREE.Color(0xdcefff), sunPower: 0.75, clouds: 0.35 };
    case 'aurora':
      // ночь: диск не виден, зато зелёное свечение у горизонта
      return { horizon, mid, zenith, sun: new THREE.Color(0x62ffc8), sunPower: 0.35, clouds: 0.18 };
    case 'caves':
      // сумрак: солнца нет вовсе, тёплые блики дают факелы в сцене
      return { horizon, mid, zenith, sun: new THREE.Color(0x9fd8e0), sunPower: 0.12, clouds: 0.0 };
    case 'volcano':
      return { horizon, mid, zenith, sun: new THREE.Color(0xffb066), sunPower: 1.15, clouds: 0.5 };
    case 'valley':
    default:
      return { horizon, mid, zenith, sun: new THREE.Color(0xfff0cf), sunPower: 1.0, clouds: 0.45 };
  }
}

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  /** Текущие (отрисованные) цвета — от них лерпим к целевым. */
  private cur: SkyBiomeLook;
  private target: SkyBiomeLook;
  private blend = 1; // 1 = переход завершён

  constructor(sunDir: THREE.Vector3, initial: SkyBiomeLook) {
    this.cur = cloneLook(initial);
    this.target = cloneLook(initial);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uHorizon: { value: this.cur.horizon.clone() },
        uMid: { value: this.cur.mid.clone() },
        uZenith: { value: this.cur.zenith.clone() },
        uSunColor: { value: this.cur.sun.clone() },
        uSunDir: { value: sunDir.clone().normalize() },
        uSunPower: { value: this.cur.sunPower },
        uClouds: { value: this.cur.clouds },
        uTime: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const geo = new THREE.SphereGeometry(800, 32, 20);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'skyDome';
  }

  /** Плавно перевести небо к палитре нового биома. */
  setBiome(look: SkyBiomeLook): void {
    // фиксируем текущее состояние как старт, иначе смена во время перехода
    // дёрнет цвет назад к палитре предыдущего биома
    this.cur = readUniforms(this.mat);
    this.target = cloneLook(look);
    this.blend = 0;
  }

  /** Направление на солнце (обновляется вместе со светом сцены). */
  setSunDir(dir: THREE.Vector3): void {
    (this.mat.uniforms.uSunDir.value as THREE.Vector3).copy(dir).normalize();
  }

  update(delta: number, time: number): void {
    this.mat.uniforms.uTime.value = time;
    if (this.blend >= 1) return;
    this.blend = Math.min(1, this.blend + delta / BLEND_SEC);
    const t = this.blend;
    const u = this.mat.uniforms;
    (u.uHorizon.value as THREE.Color).copy(this.cur.horizon).lerp(this.target.horizon, t);
    (u.uMid.value as THREE.Color).copy(this.cur.mid).lerp(this.target.mid, t);
    (u.uZenith.value as THREE.Color).copy(this.cur.zenith).lerp(this.target.zenith, t);
    (u.uSunColor.value as THREE.Color).copy(this.cur.sun).lerp(this.target.sun, t);
    u.uSunPower.value = this.cur.sunPower + (this.target.sunPower - this.cur.sunPower) * t;
    u.uClouds.value = this.cur.clouds + (this.target.clouds - this.cur.clouds) * t;
  }

  /** Купол следует за камерой по XZ (иначе «уезжает» на длинной трассе). */
  follow(x: number, z: number): void {
    this.mesh.position.set(x, 0, z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

function cloneLook(l: SkyBiomeLook): SkyBiomeLook {
  return {
    horizon: l.horizon.clone(),
    mid: l.mid.clone(),
    zenith: l.zenith.clone(),
    sun: l.sun.clone(),
    sunPower: l.sunPower,
    clouds: l.clouds,
  };
}

function readUniforms(mat: THREE.ShaderMaterial): SkyBiomeLook {
  const u = mat.uniforms;
  return {
    horizon: (u.uHorizon.value as THREE.Color).clone(),
    mid: (u.uMid.value as THREE.Color).clone(),
    zenith: (u.uZenith.value as THREE.Color).clone(),
    sun: (u.uSunColor.value as THREE.Color).clone(),
    sunPower: u.uSunPower.value as number,
    clouds: u.uClouds.value as number,
  };
}
