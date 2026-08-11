/**
 * SNOW RUSH 3D — единый источник тюнинг-констант.
 * ВСЕ числа — из design/gdd.md. Менять только здесь (или через lil-gui в ?debug=1).
 * Единицы: метры, секунды, м/с. HUD показывает км/ч (×3.6).
 */

// ---------- Палитра (design.md §3) ----------
export const COLORS = {
  snowBase: 0xf4f8ff,
  snowShadow: 0xdce8f8,
  iceTrack: 0x7fc4e8,
  iceTrackDeep: 0x4fa8d8,
  rock: 0x8d9bb0,
  rockDark: 0x6b7a92,
  pineGreen: 0x2e7d5b,
  pineDark: 0x1f5c42,
  trunk: 0x8a5a3b,
  mountainFar: 0xb9cbe8,
  accentRed: 0xe84545,
  accentRedDark: 0xb52e2e,
  warmSand: 0xf2d8a8,
  penguinBlack: 0x2b3242,
  penguinWhite: 0xffffff,
  penguinOrange: 0xff9f43,
  tubeBlue: 0x3d8bfd,
  tubeBlueDark: 0x2563c4,
  skyHorizon: 0xcfe8ff,
  skyZenith: 0x8fc3f0,
  fog: 0xd8e8f8,
  coinGold: 0xffc93c,
  coinGoldDark: 0xe0a41e,
  crystalPink: 0xff6fb5,
  diamondCyan: 0x5fe3ff,
} as const;

// ---------- Физика (gdd.md §4.1) ----------
export const PHYSICS = {
  g: 9.81,
  fixedDt: 1 / 60,
  maxDelta: 0.1,
  kDrag: 0.0012,
  /** μ_base(SledLevel) = 0.085 − 0.0022·(L−1), мин 0.02 */
  muBase: (sledLevel: number): number => Math.max(0.02, 0.085 - 0.0022 * (sledLevel - 1)),
  /** steerAccel = 14 + 0.25·(L−1), макс 20 */
  steerAccel: (sledLevel: number): number => Math.min(20, 14 + 0.25 * (sledLevel - 1)),
  surface: { ice: 0.45, snow: 1.0, loose: 1.9, icePatch: 0.15 },
  steerBrakeK: 0.9, // steerBrake = 1 + 0.9·|steerInput|
  steerAttack: 10, // /с
  steerRelease: 8, // /с
  gripSnow: 3.2, // vx *= exp(−3.2·dt)
  gripIce: 1.6, // на льду exp(−1.6·dt)
  maxVx: 9,
  wallBounce: 0.3,
  wallSpeedLoss: 0.97,
  wallTrauma: 0.1,
  tubeRadius: 0.9,
  ramp: { angleDeg: 15, vyBonus: 2.0, airSteerFactor: 0.4, landSpeedLoss: 0.985, landTrauma: 0.2 },
  stopSpeed: 1.0,
  stopTime: 1.5,
  lightHitSpeedMul: 0.55,
  lightHitstopMs: 70,
  lightHitTrauma: 0.4,
  crashHitstopMs: 90,
  crashTrauma: 0.7,
  crashTumbleTime: 0.8,
  coinTrauma: 0.05,
} as const;

// ---------- Рогатка (gdd.md §4.2) ----------
export const SLINGSHOT = {
  vBase: 6,
  vRange: 22,
  levelMul: 0.035,
  /** v_launch = (6 + 22·p) · (1 + 0.035·(L−1)) */
  launchSpeed: (p: number, level: number): number =>
    (SLINGSHOT.vBase + SLINGSHOT.vRange * p) * (1 + SLINGSHOT.levelMul * (level - 1)),
  maxDragMeters: 3.5,
  dragPx: 250, // моб. свайп 0–250 px → 0–100%
  cancelThreshold: 0.15,
  autoReleaseSec: 4,
  holdCycleSec: 1.6, // десктоп hold: пила 0→100→0%
  launchKinematicSec: 0.4,
} as const;

// ---------- Трасса (gdd.md §7) ----------
export const TRACK = {
  halfW: 9,
  iceHalfW: 3,
  looseFrom: 0.8, // доля halfW
  moduleLength: 50,
  bufferMeters: 400,
  baseSlopeDeg: 6,
  maxSlopeDeg: 14,
  slopeRampPer100m: 0.55, // +° за каждые 100 м после старта
  uphillAfterDeg: -7, // мягкий подъём за буфером
  microNoiseAmp: 0.15,
  curveAmplitude: 3, // м, синус центральной линии (legacy; биомы переопределяют)
  curvePeriod: 180, // м
  minObstacleGap: 25,
  corridorMinWidth: 3.5,
  groundHalfW: 30, // ширина меша долины
  rowStep: 2,
  // ---------- W2: живой рельеф (QUALITY_OVERHAUL.md) ----------
  /** Роллеры — сумма двух синусов поверх секционного профиля (Alto/SSX). */
  rollers: {
    amp1: 2.6, // м, основная волна
    period1: 72, // м
    amp2: 1.5, // м, вторая гармоника
    period2: 43,
    fadeStart: 25, // м — волны начинают нарастать после стартовой площадки
    fadeEnd: 85, // м — полная амплитуда
    maxUphillDeg: 6, // предел локального подъёма на гребне
    maxTotalDeg: 32, // предел суммарного уклона на сбросе
  },
  /** Секции ритма: техничные (пологие) / круз / разгонные сбросы. */
  sections: {
    minLen: 90,
    maxLen: 160,
    blendMeters: 18, // сглаживание перехода между секциями
    techChance: 0.25,
    burstChance: 0.18,
    techAddDeg: 2, // tech = baseSlope + это
    cruiseAddDeg: 4, // cruise = lerp(base,max,0.6) + это
    burstAddDeg: 6, // burst = max + это
  },
  /** Виражи: поперечный наклон трассы на поворотах (∝ крутизне центра). */
  banking: {
    factor: 0.45, // bank(tan) = clamp(centerX'·factor)
    maxDeg: 11,
    edgeFadeStart: 2, // за halfW+start наклон затухает
    edgeFadeEnd: 7,
  },
} as const;

// ---------- Камера (gdd.md §4.5) ----------
export const CAMERA = {
  fovPortrait: 60,
  fovLandscape: 55,
  followOffset: { x: 0, y: 4.2, z: 7.8 },
  lookAhead: { x: 0, y: 1.2, z: -6 },
  posLag: 5.0,
  lookLag: 8.0,
  lateralShift: 0.35,
  fovSpeedStart: 14,
  fovSpeedMul: 0.62,
  fovSpeedMax: 14, // FOV-кик до ~70–75° на топ-скорости (W5)
  fovSpeedDamp: 3, // демпфирование скоростного FOV (λ, 1/с)
  fovPunchTau: 0.2,
  menuPos: { x: 0, y: 3.2, z: 7.5 },
  menuLook: { x: 0, y: 1.6, z: -10 },
  aimPos: { x: 0, y: 2.6, z: 6.2 },
  menuBobAmp: 0.05,
  menuBobHz: 0.3,
  /** W5: крен камеры ∝ боковой скорости (до rollMaxDeg), look-ahead ∝ v. */
  // rollMul подобран под maxVx=9: 9·0.0155 ≈ 0.14 рад ≈ 8° точно на пределе
  // руления, поэтому крен растёт пропорционально, а не упирается в кламп
  // уже на трети боковой скорости.
  rollMul: 0.0155,
  rollMaxDeg: 8,
  rollDamp: 6,
  lookAheadSpeedMul: 0.25,
  lookAheadSpeedMax: 8,
  airPosLag: 2.6, // ослабленный демпфинг в полёте
  airFovBonus: 2.5,
  shake: { maxOffset: 0.35, maxRoll: 0.06, decay: 1.8 },
  finish: { offset: { x: 2.5, y: 2.0, z: 4.5 }, fovDelta: -6, duration: 0.6, slowMo: 0.35 },
} as const;

// ---------- Пикапы (gdd.md §4.6) ----------
export const PICKUPS = {
  coinRadius: 1.1,
  gemRadius: 1.2,
  magnetRadius: 2.5,
  magnetSpeed: 12,
  coinLineStep: 3,
  diamondChance: 0.35,
  diamondMinProgress: 0.7,
  crystalPerModuleChance: 0.12,
} as const;

// ---------- Ракета-буст (gdd.md §4.4) и буст-пады ----------
export const BOOST = {
  instant: 10,
  thrust: 6,
  duration: 3,
  ceiling: 36,
  minSpeed: 12,
  padBoost: 4,
  padCeiling: 32,
  rocketPriceDiamonds: 2,
} as const;

// ---------- Экономика и прогрессия (gdd.md §5) ----------
export const ECONOMY = {
  start: { coins: 150, crystals: 0, diamonds: 3, rockets: 1 },
  distanceCoinRate: 0.08, // d·0.08·IncomeMult, floor
  finishCoinBonus: 250, // ×IncomeMult
  finishCrystals: 5,
  finishXp: 150,
  crashFreeXp: 50,
  xpPerMeter: 0.25,
  recordCrystalPer50m: 1,
  recordCrystalMax: 10,
  maxUpgradeLevel: 30,
  /** IncomeMult = round(1.145^(L−1) · 10)/10 */
  incomeMult: (level: number): number => Math.round(Math.pow(1.145, level - 1) * 10) / 10,
  /** Стоимость L→L+1, округление до 10 */
  upgradeCost: (line: 'slingshot' | 'sled' | 'income', level: number): number => {
    const raw =
      line === 'income' ? 150 * Math.pow(1.44, level - 1) : 100 * Math.pow(1.3, level - 1);
    return Math.round(raw / 10) * 10;
  },
  /**
   * XP_need(N) = 320 + 170·(N−1) — экономика v2 (docs/ECONOMY.md):
   * почти линейная кривая, откалибрована симуляцией под темп
   * 15–25 заездов на карту (см. scripts/sim-economy.ts).
   */
  xpNeed: (level: number): number => 320 + 170 * (level - 1),
  levelUpCoins: (n: number): number => 300 * n,
  levelUpCrystals: (n: number): number => 2 * Math.ceil(n / 3),
  /** D_finish(N) = 500 + 120·(N−1) */
  finishDistance: (playerLevel: number): number => 500 + 120 * (playerLevel - 1),
} as const;

// ---------- Визуальная эволюция апгрейдов (промт §9) ----------
/**
 * Тиры по уровню линии апгрейда: тюбинг (линия sled) и рогатка
 * (линия slingshot) меняют цвет и обрастают деталями.
 * Пороги: базовый → усиленный → спортивный → золотой.
 */
export const UPGRADE_TIERS = {
  thresholds: [1, 8, 15, 22],
  names: ['Базовый', 'Усиленный', 'Спортивный', 'Золотой'],
  /** Тюбинг: цвет корпуса и бортов по тиру. */
  tube: [
    { body: 0x3d8bfd, rims: 0xe84545 },
    { body: 0x2ec4b6, rims: 0xf5f8ff },
    { body: 0x8b5cf6, rims: 0xffd166 },
    { body: 0xe84545, rims: 0xffc933 },
  ],
  /** Рогатка: цвет резинок по тиру. */
  slingshotBands: [0xe84545, 0xff8c42, 0x8b5cf6, 0xffc933],
} as const;

/** Тир (0..3) по уровню линии апгрейда. */
export function tierForLevel(level: number): number {
  let t = 0;
  for (let i = 0; i < UPGRADE_TIERS.thresholds.length; i++) {
    if (level >= UPGRADE_TIERS.thresholds[i]) t = i;
  }
  return t;
}

// ---------- Карты / миры (экономика v2, docs/ECONOMY.md §4) ----------
/**
 * 5 карт-биомов. Открытие: уровень игрока + кристаллы (sinks).
 * Пороги откалиброваны scripts/sim-economy.ts: прохождение карты
 * (до открытия следующей) занимает 15–25 заездов у среднего игрока
 * и не меньше 15 у сильного. Менять пороги ТОЛЬКО через симуляцию.
 */
export interface MapPalette {
  snowBase: number;
  snowShadow: number;
  iceTrack: number;
  iceTrackDeep: number;
  rock: number;
  pine: number;
  skyHorizon: number;
  skyZenith: number;
  fog: number;
  /** множители света биома (вечер/пещера темнее) */
  sunIntensityMul: number;
  hemiIntensityMul: number;
  exposure: number;
}

export interface MapTrackProfile {
  curveAmplitude: number;
  curvePeriod: number;
  baseSlopeDeg: number;
  maxSlopeDeg: number;
  iceHalfW: number;
  looseFrom: number;
  /** множитель плотности препятствий (сложность биома) */
  densityMul: number;
  /** декоративные арки над трассой каждые N метров (0 = нет) — «пещеры» */
  archEvery: number;
  /** id биома для тематического декора (W2) */
  biome?: 'valley' | 'canyon' | 'aurora' | 'caves' | 'volcano';
  /** множитель крутизны стен долины (каньон — узкие высокие стены) */
  wallMul?: number;
}

export interface MapDef {
  id: string;
  name: string;
  tagline: string;
  seed: number;
  unlockLevel: number;
  unlockCrystals: number;
  coinMul: number;
  crystalMul: number;
  palette: MapPalette;
  track: MapTrackProfile;
}

const BASE_PALETTE: MapPalette = {
  snowBase: 0xf4f8ff,
  snowShadow: 0xdce8f8,
  iceTrack: 0x7fc4e8,
  iceTrackDeep: 0x4fa8d8,
  rock: 0x8d9bb0,
  pine: 0x2e7d5b,
  skyHorizon: 0xcfe8ff,
  skyZenith: 0x8fc3f0,
  fog: 0xd8e8f8,
  sunIntensityMul: 1,
  hemiIntensityMul: 1,
  exposure: 1,
};

const BASE_TRACK_PROFILE: MapTrackProfile = {
  curveAmplitude: TRACK.curveAmplitude,
  curvePeriod: TRACK.curvePeriod,
  baseSlopeDeg: TRACK.baseSlopeDeg,
  maxSlopeDeg: TRACK.maxSlopeDeg,
  iceHalfW: TRACK.iceHalfW,
  looseFrom: TRACK.looseFrom,
  densityMul: 1,
  archEvery: 0,
};

export const MAPS: readonly MapDef[] = [
  {
    id: 'valley',
    name: 'Снежная долина',
    tagline: 'Классический склон для разгона',
    seed: 1013,
    unlockLevel: 1,
    unlockCrystals: 0,
    coinMul: 1.0,
    crystalMul: 1.0,
    palette: { ...BASE_PALETTE },
    track: {
      ...BASE_TRACK_PROFILE,
      curveAmplitude: 8,
      curvePeriod: 170,
      biome: 'valley',
      wallMul: 1,
    },
  },
  {
    id: 'canyon',
    name: 'Ледяной каньон',
    tagline: 'Узкие стены, сплошной лёд',
    seed: 2027,
    unlockLevel: 5,
    unlockCrystals: 90,
    coinMul: 1.25,
    crystalMul: 1.5,
    palette: {
      ...BASE_PALETTE,
      snowBase: 0xe4eefa,
      snowShadow: 0xc4d8f0,
      iceTrack: 0x5fb4ec,
      iceTrackDeep: 0x2f88c8,
      rock: 0x7186a8,
      pine: 0x27685a,
      skyHorizon: 0xbcdcf8,
      skyZenith: 0x6ea8de,
      fog: 0xc2d8ee,
    },
    track: {
      ...BASE_TRACK_PROFILE,
      iceHalfW: 3.6,
      curveAmplitude: 7,
      curvePeriod: 150,
      maxSlopeDeg: 15,
      densityMul: 1.15,
      biome: 'canyon',
      wallMul: 2.1,
    },
  },
  {
    id: 'aurora',
    name: 'Поля северного сияния',
    tagline: 'Вечер, аврора и длинные дуги',
    seed: 3041,
    unlockLevel: 8,
    unlockCrystals: 220,
    coinMul: 1.5,
    crystalMul: 2.2,
    palette: {
      ...BASE_PALETTE,
      snowBase: 0xd9e2f8,
      snowShadow: 0xaebfE8,
      iceTrack: 0x6f9fe0,
      iceTrackDeep: 0x4a70b8,
      rock: 0x5c6c92,
      pine: 0x1f4a44,
      skyHorizon: 0x8a7fd0,
      skyZenith: 0x27335e,
      fog: 0x6a74a8,
      sunIntensityMul: 0.55,
      hemiIntensityMul: 0.65,
      exposure: 0.95,
    },
    track: {
      ...BASE_TRACK_PROFILE,
      curveAmplitude: 10,
      curvePeriod: 210,
      densityMul: 1.25,
      biome: 'aurora',
      wallMul: 0.75,
    },
  },
  {
    id: 'caves',
    name: 'Ледниковые пещеры',
    tagline: 'Своды льда и бирюзовый мрак',
    seed: 4057,
    unlockLevel: 12,
    unlockCrystals: 400,
    coinMul: 1.8,
    crystalMul: 3.0,
    palette: {
      ...BASE_PALETTE,
      snowBase: 0xd2ecef,
      snowShadow: 0xa8d4dd,
      iceTrack: 0x59d0d8,
      iceTrackDeep: 0x2fa0b0,
      rock: 0x4f7a8a,
      pine: 0x2a6a72,
      skyHorizon: 0x9fd8e0,
      skyZenith: 0x3a7a92,
      fog: 0x8fc4d0,
      sunIntensityMul: 0.7,
      hemiIntensityMul: 0.8,
    },
    track: {
      ...BASE_TRACK_PROFILE,
      curveAmplitude: 6.5,
      curvePeriod: 130,
      maxSlopeDeg: 13,
      densityMul: 1.35,
      archEvery: 90,
      biome: 'caves',
      wallMul: 1.5,
    },
  },
  {
    id: 'volcano',
    name: 'Вулканический источник',
    tagline: 'Талый снег, пар и горячий финал',
    seed: 5093,
    unlockLevel: 15,
    unlockCrystals: 520,
    coinMul: 2.2,
    crystalMul: 4.0,
    palette: {
      ...BASE_PALETTE,
      snowBase: 0xf6ecdd,
      snowShadow: 0xe0c8b0,
      iceTrack: 0xe8a06a,
      iceTrackDeep: 0xc4763e,
      rock: 0x6a5548,
      pine: 0x4a5a3a,
      skyHorizon: 0xffd9b0,
      skyZenith: 0xe08a5a,
      fog: 0xf0cfae,
      sunIntensityMul: 1.1,
      hemiIntensityMul: 0.9,
      exposure: 1.05,
    },
    track: {
      ...BASE_TRACK_PROFILE,
      curveAmplitude: 9,
      curvePeriod: 170,
      baseSlopeDeg: 7,
      maxSlopeDeg: 16,
      looseFrom: 0.7,
      densityMul: 1.5,
      biome: 'volcano',
      wallMul: 1.1,
    },
  },
] as const;

export function getMapDef(id: string): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

// ---------- «Второй шанс» (gdd.md §5.7) — точка расширения для meta/ui агентов ----------
export const CONTINUE = {
  costCrystals: 5,
  minDistance: 150,
  respawnSpeed: 10,
  invulnSec: 2,
  clearRadius: 15,
  timerSec: 5,
} as const;

// ---------- Свет (design.md §5.1) ----------
export const LIGHTING = {
  sunColor: 0xfff3e0,
  sunIntensity: 1.25,
  sunOffset: { x: -40, y: 60, z: -20 },
  shadowMapSize: 2048,
  shadowOrtho: 60,
  hemiSky: 0xbfe0ff,
  hemiGround: 0xeaf2fb,
  hemiIntensity: 0.85,
  fillColor: 0xcfe4ff,
  fillIntensity: 0.3,
  fogNearRun: 120,
  fogFarRun: 900,
  fogNearMenu: 80,
  fogFarMenu: 600,
  toneExposure: 1.1,
} as const;

// ---------- Визуал мира и VFX (world-graphics; design.md §2/§5/§6.1) ----------
// Только визуальные константы — геймплейные числа выше не трогать.
export const VISUAL = {
  /** Снегопад (design §5.4): слои Points с разным размером спрайта (0.12–0.35 м). */
  snow: {
    box: { x: 60, y: 40, z: 60 },
    fallSpeedMin: 1.2,
    fallSpeedMax: 1.8,
    drift: 0.5,
    layers: [
      { size: 0.14, share: 0.5 },
      { size: 0.22, share: 0.3 },
      { size: 0.32, share: 0.2 },
    ],
    opacity: 0.9,
  },
  /** Снежные брызги из-под тюбинга (∝ скорости и стерингу). */
  spray: {
    maxParticles: 240,
    /** частиц/с на каждый м/с скорости */
    ratePerSpeed: 1.6,
    steerMul: 1.4,
    minSpeed: 4,
    lifeMin: 0.45,
    lifeMax: 0.9,
  },
  /** Speed lines при бусте (design §6.1: 12 streak-спрайтов по краям). */
  speedLines: {
    count: 12,
    minSpeed: 26.5,
    fullSpeed: 34,
    distance: 9,
    radiusMin: 2.4,
    radiusMax: 4.2,
  },
  /** Конфетти финиша (design §6.1: 80 частиц). */
  confetti: { count: 80, life: 2.2 },
  /** Кольцевая вспышка пикапа/приземления (design §6.1: 300 мс). */
  ring: { life: 0.3, maxScale: 3.2 },
  /** Горы: 3 пояса глубины (дальний под fog). */
  mountains: {
    belts: [
      { xMin: 38, xMax: 75, hMin: 14, hMax: 30, spacing: 55 },
      { xMin: 85, xMax: 160, hMin: 35, hMax: 70, spacing: 85 },
      { xMin: 190, xMax: 340, hMin: 70, hMax: 130, spacing: 130 },
    ],
  },
  /** Декор вдоль трассы (gdd §7.3: вне halfW+2). */
  decor: {
    spacingMin: 9,
    spacingMax: 18,
    chance: 0.55,
    windmillEvery: 500,
    lighthouseEvery: 500,
    edgeLumpEvery: 7,
  },
} as const;

export const SAVE_KEY = 'snowrush_save_v1';
// v2: meta-systems — tasks{keys,targets,seen} (ежедневные задания), миграция v1→v2 в SaveSystem
// v3: экономика v2 — currentMap/unlockedMaps (система карт), миграция v2→v3
export const SAVE_VERSION = 3;
