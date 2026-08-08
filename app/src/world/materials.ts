import * as THREE from 'three';
import { COLORS } from '@/config';

/**
 * MaterialLibrary — именованные роли материалов (technical-art kit).
 * Мир: flat-shaded MeshStandardMaterial, roughness 0.9–1.0, metalness 0
 * (design.md §3.3). Лёд/тюбинг — глянец (roughness 0.3–0.35).
 *
 * ВАЖНО про dispose: контент заезда (TrackBuilder) уничтожается через
 * disposeObject3D при рестарте; three.js безопасно ре-инициализирует
 * disposed-материалы/геометрии при следующем использовании, поэтому
 * разделяемые роли допустимы и для per-run контента.
 */

export type WorldMaterials = ReturnType<typeof createWorldMaterials>;

/** Свежий набор материалов мира (для per-run контента — свой экземпляр на заезд). */
export function createWorldMaterials() {
  const std = (
    color: number,
    opts: Partial<THREE.MeshStandardMaterialParameters> = {},
  ): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.95, metalness: 0, ...opts });

  return {
    /** vertexColors-меши (мерджнутый декор/препятствия): цвета запечены в геометрию. */
    vertexFlat: std(0xffffff, { vertexColors: true, roughness: 0.95 }),
    /** vertexColors + лёгкий глянец (трасса-лёд использует свой материал в Track). */
    vertexGloss: std(0xffffff, { vertexColors: true, roughness: 0.4, metalness: 0.05 }),
    snow: std(COLORS.snowBase, { roughness: 1 }),
    snowShadow: std(COLORS.snowShadow, { roughness: 1 }),
    rock: std(COLORS.rock, { roughness: 1 }),
    rockDark: std(COLORS.rockDark, { roughness: 1 }),
    pine: std(COLORS.pineGreen, { roughness: 0.95 }),
    pineDark: std(COLORS.pineDark, { roughness: 0.95 }),
    trunk: std(COLORS.trunk, { roughness: 1 }),
    red: std(COLORS.accentRed, { roughness: 0.85 }),
    redDark: std(COLORS.accentRedDark, { roughness: 0.9 }),
    white: std(0xffffff, { roughness: 0.95 }),
    warmSand: std(COLORS.warmSand, { roughness: 0.95 }),
    mountainFar: std(COLORS.mountainFar, { roughness: 1 }),
    /** Глянец героя: тюбинг «надувной», лёд трамплина. */
    tubeGloss: std(COLORS.tubeBlue, { roughness: 0.3, metalness: 0.05 }),
    tubeDark: std(COLORS.tubeBlueDark, { roughness: 0.45, metalness: 0.05 }),
    iceGloss: std(COLORS.iceTrackDeep, { roughness: 0.3, metalness: 0.05 }),
    /** Награды: лёгкий emissive для чтения в движении. */
    coin: std(COLORS.coinGold, {
      roughness: 0.35,
      metalness: 0.4,
      emissive: COLORS.coinGoldDark,
      emissiveIntensity: 0.25,
    }),
    /** Маяк/сигналы: emissive-сердцевина (не весь объект — только акцент). */
    beacon: std(0xfff2b0, { emissive: 0xffd75e, emissiveIntensity: 1.6, roughness: 0.4 }),
  };
}

// ---------------------------------------------------------------------------
// Процедурные canvas-спрайты (fallback, если PNG-ассет ещё не сгенерирован).
// Стиль повторяет манифест design.md §9.5, чтобы подмена ассета была бесшовной.
// ---------------------------------------------------------------------------

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Мягкая снежинка: белый центр, лёгкий синий обвод-глоу (читается на светлом небе). */
export function snowflakeFallbackTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.8, 'rgba(190,220,248,0.55)');
  g.addColorStop(1, 'rgba(190,220,248,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  // намёк на 6 лучей
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i += 1) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(32 - Math.cos(a) * 16, 32 - Math.sin(a) * 16);
    ctx.lineTo(32 + Math.cos(a) * 16, 32 + Math.sin(a) * 16);
    ctx.stroke();
  }
  return toTexture(c);
}

/** Пушистый снежный комок для брызг. */
export function snowPuffFallbackTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128);
  const blob = (x: number, y: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.7, `rgba(244,248,255,${a * 0.8})`);
    g.addColorStop(1, 'rgba(220,232,248,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  blob(64, 70, 46, 0.95);
  blob(42, 62, 28, 0.9);
  blob(88, 60, 26, 0.9);
  blob(58, 46, 24, 0.9);
  // синяя тень снизу
  const sh = ctx.createRadialGradient(64, 96, 4, 64, 96, 40);
  sh.addColorStop(0, 'rgba(160,190,225,0.35)');
  sh.addColorStop(1, 'rgba(160,190,225,0)');
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.arc(64, 96, 40, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c);
}

/** Четырёхлучевая звезда для вспышки пикапа. */
export function starBurstFallbackTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128);
  ctx.translate(64, 64);
  const spike = (len: number, w: number) => {
    ctx.beginPath();
    ctx.moveTo(0, -len);
    ctx.quadraticCurveTo(w, -w, len, 0);
    ctx.quadraticCurveTo(w, w, 0, len);
    ctx.quadraticCurveTo(-w, w, -len, 0);
    ctx.quadraticCurveTo(-w, -w, 0, -len);
    ctx.closePath();
  };
  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 52);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.4, 'rgba(255,230,245,0.85)');
  glow.addColorStop(1, 'rgba(255,160,215,0)');
  ctx.fillStyle = glow;
  spike(56, 9);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  spike(30, 6);
  ctx.fill();
  return toTexture(c);
}

/** Горизонтальный белый streak для speed lines (мягкие конусы по краям). */
export function speedLineFallbackTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256);
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  // вытянутый «капсульный» луч по центру
  ctx.beginPath();
  ctx.ellipse(128, 128, 120, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  const core = ctx.createLinearGradient(0, 0, 256, 0);
  core.addColorStop(0, 'rgba(255,255,255,0)');
  core.addColorStop(0.5, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.ellipse(128, 128, 110, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c);
}

/** Мягкий белый квадрат для конфетти (цвет даёт vertex color). */
export function confettiFallbackTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(32);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fillRect(7, 7, 18, 18);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(4, 4, 24, 24);
  return toTexture(c);
}

/**
 * Загрузка текстуры с procedural-fallback: сразу возвращает fallback,
 * при успешной загрузке PNG подменяет image (бесшовно, без мерцания).
 */
export function textureWithFallback(url: string, fallback: THREE.Texture): THREE.Texture {
  new THREE.TextureLoader().load(
    url,
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      fallback.image = tex.image;
      fallback.needsUpdate = true;
    },
    undefined,
    () => {
      /* ассет ещё не сгенерирован — остаёмся на fallback */
    },
  );
  return fallback;
}
