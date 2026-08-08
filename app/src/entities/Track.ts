import * as THREE from 'three';
import { COLORS, TRACK } from '@/config';
import type { MapPalette, MapTrackProfile } from '@/config';
import { clamp, degToRad } from '@/utils/math';
import { createRng } from '@/utils/random';
import { buildMountains } from '@/world/Mountains';

export type SurfaceKind = 'ice' | 'snow' | 'loose';

const START_PAD = 20; // метры «за» стартом (площадка рогатки)

/** Палитра/профиль по умолчанию — базовый биом «Снежная долина». */
const DEFAULT_PALETTE: MapPalette = {
  snowBase: COLORS.snowBase,
  snowShadow: COLORS.snowShadow,
  iceTrack: COLORS.iceTrack,
  iceTrackDeep: COLORS.iceTrackDeep,
  rock: COLORS.rock,
  pine: COLORS.pineGreen,
  skyHorizon: COLORS.skyHorizon,
  skyZenith: COLORS.skyZenith,
  fog: COLORS.fog,
  sunIntensityMul: 1,
  hemiIntensityMul: 1,
  exposure: 1,
};

const DEFAULT_PROFILE: MapTrackProfile = {
  curveAmplitude: TRACK.curveAmplitude,
  curvePeriod: TRACK.curvePeriod,
  baseSlopeDeg: TRACK.baseSlopeDeg,
  maxSlopeDeg: TRACK.maxSlopeDeg,
  iceHalfW: TRACK.iceHalfW,
  looseFrom: TRACK.looseFrom,
  densityMul: 1,
  archEvery: 0,
};

/**
 * Track — процедурный heightfield-склон (gdd §7.1 + W2 «живой рельеф»).
 * Координаты: s — дистанция спуска (м), world z = −s; x — поперёк трассы,
 * world x = centerX(s) + x.
 *
 * W2 (QUALITY_OVERHAUL.md): профиль H(s) = секционный ритм уклонов
 * (техничные 8–11° → круз ~15° → сбросы ~20–24°) + роллеры (сумма двух
 * синусов, производная входит в slopeDegAt аналитически — физика и меш
 * всегда согласованы). Центральная линия — двухгармонические S-кривые
 * (амплитуда 6.5–10 м по биому). На поворотах — вираж (поперечный наклон
 * банкинга до 11°, внешняя кромка выше). Всё seeded, детерминировано.
 *
 * Владение: ЛОГИКА (эта часть) — scaffold; визуал меша может дорабатывать
 * world-graphics агент, не меняя heightAt/surfaceAt/centerX.
 */
export class Track {
  readonly finishDistance: number;
  readonly length: number; // finish + buffer + апхилл-хвост
  readonly group = new THREE.Group();
  private readonly heights: Float32Array; // H(s), шаг 1 м, индекс 0 = s=-START_PAD
  /** Секции ритма: [от s, уклон °] — отсортированы по fromS. */
  private readonly sections: Array<{ fromS: number; slopeDeg: number }> = [];
  /** Фазы роллеров и кривых (seeded). */
  private readonly rollerPhase1: number;
  private readonly rollerPhase2: number;
  private readonly curvePhase1: number;
  private readonly curvePhase2: number;
  readonly seed: number;
  readonly palette: MapPalette;
  readonly profile: MapTrackProfile;

  constructor(
    finishDistance: number,
    seed: number,
    palette: MapPalette = DEFAULT_PALETTE,
    profile: MapTrackProfile = DEFAULT_PROFILE,
  ) {
    this.finishDistance = finishDistance;
    this.length = finishDistance + TRACK.bufferMeters + 160;
    this.seed = seed;
    this.palette = palette;
    this.profile = profile;
    const rng = createRng(`track-${seed}`);

    this.rollerPhase1 = rng.range(0, Math.PI * 2);
    this.rollerPhase2 = rng.range(0, Math.PI * 2);
    this.curvePhase1 = (this.seed % 7) + rng.range(0, Math.PI * 2);
    this.curvePhase2 = rng.range(0, Math.PI * 2);

    // ===== Секции уклона: стартовая зона пологая, далее ритм tech/cruise/burst =====
    const SEC = TRACK.sections;
    const techSlope = this.profile.baseSlopeDeg + SEC.techAddDeg;
    const cruiseSlope =
      this.profile.baseSlopeDeg +
      (this.profile.maxSlopeDeg - this.profile.baseSlopeDeg) * 0.6 +
      SEC.cruiseAddDeg;
    const burstSlope = this.profile.maxSlopeDeg + SEC.burstAddDeg;
    this.sections.push({ fromS: -START_PAD, slopeDeg: this.profile.baseSlopeDeg });
    let s = 60; // обучающая зона 0–60 м остаётся baseSlope
    while (s < this.length) {
      const roll = rng.next();
      const target =
        roll < SEC.techChance ? techSlope : roll < SEC.techChance + SEC.burstChance ? burstSlope : cruiseSlope;
      this.sections.push({ fromS: s, slopeDeg: target });
      s += rng.range(SEC.minLen, SEC.maxLen);
    }

    const n = Math.ceil(this.length + START_PAD) + 2;
    this.heights = new Float32Array(n);
    let h = 0;
    let prevS = -START_PAD;
    this.heights[0] = 0;
    for (let i = 1; i < n; i += 1) {
      const sNow = i - START_PAD;
      h -= Math.tan(degToRad(this.slopeDegAt((sNow + prevS) / 2))) * (sNow - prevS);
      this.heights[i] = h;
      prevS = sNow;
    }

    this.group.add(this.buildGroundMesh());
    this.group.add(this.buildFarFieldMesh());
    this.group.add(this.buildIceRibbon());
    // Горы: 3 пояса глубины (world-graphics), строятся один раз вместе с трассой
    const mtnMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1,
      metalness: 0,
    });
    // Тонировка гор под биом (vertex colors множатся на color)
    mtnMat.color.setHex(this.palette.snowBase).lerp(new THREE.Color(this.palette.rock), 0.15);
    this.group.add(buildMountains(this, createRng(`mountains-${seed}`), mtnMat));
  }

  /** Fade-in роллеров: 0 до fadeStart, 1 после fadeEnd (стартовая зона гладкая). */
  private rollerFade(s: number): number {
    const R = TRACK.rollers;
    const t = clamp((s - R.fadeStart) / (R.fadeEnd - R.fadeStart), 0, 1);
    const fadeOut = 1 - clamp((s - (this.finishDistance + TRACK.bufferMeters * 0.4)) / 90, 0, 1);
    return t * t * (3 - 2 * t) * fadeOut * fadeOut;
  }

  /** dH/ds роллеров (м/м): положительное значение «съедает» уклон (гребень). */
  private rollerDeriv(s: number): number {
    const R = TRACK.rollers;
    const f = this.rollerFade(s);
    if (f <= 0) return 0;
    const w1 = (Math.PI * 2) / R.period1;
    const w2 = (Math.PI * 2) / R.period2;
    return f * (R.amp1 * w1 * Math.cos(w1 * s + this.rollerPhase1) + R.amp2 * w2 * Math.cos(w2 * s + this.rollerPhase2));
  }

  /** Базовый уклон секций (без роллеров), сглаженный на переходах blendMeters. */
  private sectionSlopeAt(s: number): number {
    const blend = TRACK.sections.blendMeters;
    // бинарный поиск текущей секции
    let lo = 0;
    let hi = this.sections.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.sections[mid].fromS <= s) lo = mid;
      else hi = mid - 1;
    }
    const cur = this.sections[lo];
    const next = this.sections[lo + 1];
    if (!next) return cur.slopeDeg;
    // сглаживание в окне ±blend/2 вокруг границы
    const t = clamp((s - (next.fromS - blend / 2)) / blend, 0, 1);
    return cur.slopeDeg + (next.slopeDeg - cur.slopeDeg) * t * t * (3 - 2 * t);
  }

  /**
   * Уклон (градусы) в точке s — аналитический: секционный ритм + производная
   * роллеров. За буфером — подъём (uphill). Это ЕДИНСТВЕННЫЙ источник правды:
   * таблица heights интегрирует именно эту функцию.
   */
  slopeDegAt(s: number): number {
    if (s > this.finishDistance + TRACK.bufferMeters) return TRACK.uphillAfterDeg;
    const base = this.sectionSlopeAt(s);
    const total = Math.atan(Math.tan(degToRad(base)) - this.rollerDeriv(s));
    const deg = (total * 180) / Math.PI;
    return clamp(deg, -TRACK.rollers.maxUphillDeg, TRACK.rollers.maxTotalDeg);
  }

  /** Высота базового профиля H(s) (без шума). */
  private baseHeightAt(s: number): number {
    const idx = clamp(s + START_PAD, 0, this.heights.length - 1.001);
    const i = Math.floor(idx);
    const f = idx - i;
    return this.heights[i] * (1 - f) + this.heights[i + 1] * f;
  }

  /** Fade-in кривых: стартовая зона (0–45 м) прямая. */
  private curveFade(s: number): number {
    const t = clamp((s - 45) / 70, 0, 1);
    return t * t * (3 - 2 * t);
  }

  /**
   * Центральная линия: двухгармонические S-кривые (амплитуда биома 6.5–10 м).
   * heading ≈ до ~20° — камера W5 рассчитана на живые повороты.
   */
  centerX(s: number): number {
    if (s < 0) return 0;
    const A = this.profile.curveAmplitude;
    const w1 = (Math.PI * 2) / this.profile.curvePeriod;
    const w2 = (Math.PI * 2) / (this.profile.curvePeriod * 0.55);
    const f = this.curveFade(s);
    return (
      A * f * (0.62 * Math.sin(w1 * s + this.curvePhase1) + 0.38 * Math.sin(w2 * s + this.curvePhase2))
    );
  }

  /** Производная центральной линии (м/м) — для банкинга. */
  private centerXDeriv(s: number): number {
    if (s < 0) return 0;
    const A = this.profile.curveAmplitude;
    const w1 = (Math.PI * 2) / this.profile.curvePeriod;
    const w2 = (Math.PI * 2) / (this.profile.curvePeriod * 0.55);
    const f = this.curveFade(s);
    return (
      A * f * (0.62 * w1 * Math.cos(w1 * s + this.curvePhase1) + 0.38 * w2 * Math.cos(w2 * s + this.curvePhase2))
    );
  }

  headingAt(s: number): number {
    const d = 0.5;
    return Math.atan2(this.centerX(s + d) - this.centerX(s - d), 2 * d);
  }

  /** Микрошум снега ±0.15 м, период 8–14 м (gdd §7.1). */
  private microNoise(x: number, s: number): number {
    return (
      TRACK.microNoiseAmp *
      (0.5 * Math.sin((s * Math.PI * 2) / 11 + x * 0.8) + 0.5 * Math.sin((s * Math.PI * 2) / 8.7 + 1.7))
    );
  }

  /**
   * Полная высота поверхности (для физики — в пределах halfW).
   * Вираж: поперечный наклон ∝ крутизне центральной линии (внешняя кромка
   * выше, до banking.maxDeg, затухает за кромкой трассы). Стенки долины:
   * начало и крутизна масштабируются wallMul биома (долина — мягко, каньон — тесно),
   * дальше — мягкое дальнее поле (+0.05/м
   * и крупные волны), чтобы горные пояса стояли на реальном террейне
   * (fix: «висячие горы»).
   */
  heightAt(x: number, s: number): number {
    let h = this.baseHeightAt(s) + this.microNoise(x, s);
    const ax = Math.abs(x);

    // Вираж (только в пределах трассы + мягкий сход за кромкой)
    const B = TRACK.banking;
    const edgeFade = 1 - clamp((ax - (TRACK.halfW + B.edgeFadeStart)) / (B.edgeFadeEnd - B.edgeFadeStart), 0, 1);
    if (edgeFade > 0) {
      const maxTan = Math.tan(degToRad(B.maxDeg));
      const bank = clamp(this.centerXDeriv(s) * B.factor, -maxTan, maxTan);
      h -= x * bank * edgeFade;
    }

    // Стенки: биом-масштаб. Долина/аврора — мягкие снежные валы (отодвинуты, пологие),
    // каньон/пещеры — высокие тесные стены. Дальнее поле — как раньше.
    const wallMul = this.profile.wallMul ?? 1;
    const wallStart = clamp(12 + (1.6 - wallMul) * 2.4, 11, 16);
    const wallSlope = 0.28 * Math.pow(wallMul, 1.15);
    if (ax > wallStart) {
      h += Math.min(ax - wallStart, 20) * wallSlope;
      if (ax > 32) {
        h += (ax - 32) * 0.05 + Math.sin(ax * 0.045 + s * 0.008) * 2.2 + Math.cos(s * 0.021 + ax * 0.03) * 1.4;
      }
    }
    return h;
  }

  /**
   * Точки для трамплинов (W2): локальные максимумы уклона ≥ 17° с разгонным
   * участком ≥ 40 м перед ними и средним уклоном разгона ≥ 10°. Посадка под
   * таким трамплином крутая — совпадает с баллистикой (research: landing
   * slope matches trajectory).
   */
  rampSpots(): number[] {
    const spots: number[] = [];
    const from = 140;
    const to = this.finishDistance + TRACK.bufferMeters - 80;
    let lastSpot = -100;
    for (let s = from; s < to; s += 5) {
      if (s - lastSpot < 60) continue;
      const here = this.slopeDegAt(s);
      if (here < 17) continue;
      // локальный максимум в окне ±25 м
      let isMax = true;
      for (let d = -25; d <= 25; d += 5) {
        if (d !== 0 && this.slopeDegAt(s + d) > here + 0.5) {
          isMax = false;
          break;
        }
      }
      if (!isMax) continue;
      // разгон: средний уклон на [s-45, s-5] ≥ 10°
      let sum = 0;
      for (let d = -45; d <= -5; d += 5) sum += this.slopeDegAt(s + d);
      if (sum / 9 < 10) continue;
      spots.push(s);
      lastSpot = s;
    }
    return spots;
  }

  surfaceAt(x: number): SurfaceKind {
    const ax = Math.abs(x);
    if (ax <= this.profile.iceHalfW) return 'ice';
    if (ax <= TRACK.halfW * this.profile.looseFrom) return 'snow';
    return 'loose';
  }

  /** Локальная точка трассы → мировые координаты. */
  worldPos(x: number, s: number, yOffset: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(this.centerX(s) + x, this.heightAt(x, s) + yOffset, -s);
    return out;
  }

  // ---------- визуал (world-graphics) ----------

  /**
   * Грунт долины: укатанный снег с мягкими тональными переходами.
   * Центр под ледяной полосой чуть приглушён (ribbon лежит сверху),
   * рыхлый снег у краёв — Snow Shadow (#DCE8F8), стены долины — холоднее.
   * Вариация — детерминированный триг-шум (без Math.random).
   */
  private buildGroundMesh(): THREE.Mesh {
    const halfW = TRACK.groundHalfW;
    const colStep = 2;
    const cols = Math.floor((halfW * 2) / colStep) + 1;
    const rows = Math.floor((this.length + START_PAD) / TRACK.rowStep) + 1;

    const positions = new Float32Array(rows * cols * 3);
    const colors = new Float32Array(rows * cols * 3);
    const cSnow = new THREE.Color(this.palette.snowBase);
    const cShadow = new THREE.Color(this.palette.snowShadow);
    const cPacked = new THREE.Color(this.palette.snowBase).lerp(new THREE.Color(this.palette.snowShadow), 0.35);
    const cWall = new THREE.Color(this.palette.snowShadow).lerp(new THREE.Color(this.palette.rock), 0.25);
    const tmp = new THREE.Color();

    const smooth = (a: number, b: number, v: number): number => {
      const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    let p = 0;
    for (let r = 0; r < rows; r += 1) {
      const s = r * TRACK.rowStep - START_PAD;
      for (let c = 0; c < cols; c += 1) {
        const x = c * colStep - halfW;
        const y = this.heightAt(x, s);
        positions[p] = this.centerX(s) + x;
        positions[p + 1] = y;
        positions[p + 2] = -s;

        const ax = Math.abs(x);
        // база: укатанный снег в центре → snowBase
        tmp.copy(ax <= this.profile.iceHalfW + 1 ? cPacked : cSnow);
        // рыхлый снег у кромки (плавный переход к краю трассы)
        tmp.lerp(cShadow, smooth(TRACK.halfW * this.profile.looseFrom - 0.8, TRACK.halfW - 0.6, ax));
        // скала только на крутых гранях (как в реальных горах): пологие валы остаются снежными,
        // отвесные стены каньона — камень. Крутизна берётся из реального heightAt → само масштабируется wallMul.
        if (ax > TRACK.halfW + 1) {
          const dhdx = Math.abs(this.heightAt(x + Math.sign(x) * 1.4, s) - y) / 1.4;
          tmp.lerp(cWall, smooth(0.42, 0.85, dhdx) * 0.8);
        }
        // детерминированная вариация тона (читаемость скорости и формы, без шахматки)
        const n =
          0.5 *
          (Math.sin(s * 0.31 + x * 1.7) * 0.5 + Math.sin(s * 0.13 - x * 0.6 + 2.1) * 0.5);
        const patch = Math.sin(s * 0.045 + x * 0.21 + 1.7) * Math.sin(s * 0.028 - x * 0.12 + 0.4);
        tmp.lerp(cShadow, 0.1 * (n + 0.5));
        tmp.offsetHSL(patch * 0.012, 0, patch * 0.05);

        colors[p] = tmp.r;
        colors[p + 1] = tmp.g;
        colors[p + 2] = tmp.b;
        p += 3;
      }
    }

    const indices: number[] = [];
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < cols - 1; c += 1) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1.0,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Дальнее поле (fix «висячих гор»): грубый меш (шаг 8 м) от ±26 м до ±370 м
   * по обе стороны долины — террейн продолжается под горные пояса, нигде
   * нет «дыры в мир». Цвета уходят к скале/туману с дистанцией.
   */
  private buildFarFieldMesh(): THREE.Group {
    const group = new THREE.Group();
    const step = 8;
    const xInner = 26;
    const xOuter = 370;
    const rowStep = 8;
    const rows = Math.floor((this.length + START_PAD) / rowStep) + 1;
    const cols = Math.floor((xOuter - xInner) / step) + 1;

    const cNear = new THREE.Color(this.palette.snowShadow);
    const cRock = new THREE.Color(this.palette.rock);
    const cFar = new THREE.Color(this.palette.fog);
    const tmp = new THREE.Color();

    for (const side of [-1, 1]) {
      const positions = new Float32Array(rows * cols * 3);
      const colors = new Float32Array(rows * cols * 3);
      let p = 0;
      for (let r = 0; r < rows; r += 1) {
        const s = r * rowStep - START_PAD;
        for (let c = 0; c < cols; c += 1) {
          const x = side * (xInner + c * step);
          const y = this.heightAt(x, s) - 0.15; // чуть ниже основного меша, без z-fight
          positions[p] = this.centerX(s) + x;
          positions[p + 1] = y;
          positions[p + 2] = -s;
          const t = Math.min(1, (Math.abs(x) - xInner) / (xOuter - xInner));
          tmp.copy(cNear).lerp(cRock, Math.min(1, t * 1.6));
          tmp.lerp(cFar, t * t * 0.7);
          colors[p] = tmp.r;
          colors[p + 1] = tmp.g;
          colors[p + 2] = tmp.b;
          p += 3;
        }
      }
      const indices: number[] = [];
      for (let r = 0; r < rows - 1; r += 1) {
        for (let c = 0; c < cols - 1; c += 1) {
          const a = r * cols + c;
          const b = a + 1;
          const d = a + cols;
          const e = d + 1;
          indices.push(a, d, b, b, d, e);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setIndex(indices);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 }),
      );
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    return group;
  }

  /**
   * Ледяная полоса (design §3: Ice Track #7FC4E8, кромки/борозды #4FA8D8):
   * отдельный гладкий ribbon с продольными бороздами от тюбингов (vertex
   * colors, roughness 0.35). Если сгенерирован /tex-ice-track.png — подменяет
   * vertex-раскраску (fallback остаётся процедурным).
   */
  private buildIceRibbon(): THREE.Mesh {
    const halfW = this.profile.iceHalfW + 0.4;
    const colStep = 0.425;
    const cols = Math.floor((halfW * 2) / colStep) + 1;
    const rows = Math.floor((this.length + START_PAD) / TRACK.rowStep) + 1;

    const positions = new Float32Array(rows * cols * 3);
    const colors = new Float32Array(rows * cols * 3);
    const uvs = new Float32Array(rows * cols * 2);
    const cIce = new THREE.Color(this.palette.iceTrack);
    const cDeep = new THREE.Color(this.palette.iceTrackDeep);
    const cSheen = new THREE.Color(0xffffff);
    const tmp = new THREE.Color();

    const smooth = (a: number, b: number, v: number): number => {
      const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    let p = 0;
    let q = 0;
    for (let r = 0; r < rows; r += 1) {
      const s = r * TRACK.rowStep - START_PAD;
      for (let c = 0; c < cols; c += 1) {
        const x = c * colStep - halfW;
        positions[p] = this.centerX(s) + x;
        positions[p + 1] = this.heightAt(x, s) + 0.04;
        positions[p + 2] = -s;
        uvs[q] = x / (halfW * 2) + 0.5;
        uvs[q + 1] = s / 8; // тайлинг текстуры каждые 8 м

        const ax = Math.abs(x);
        tmp.copy(cIce);
        // продольные борозды от полозьев (две пары, с лёгким меандром)
        const wobble = Math.sin(s * 0.11) * 0.15;
        for (const g of [0.85, 2.05]) {
          const d = Math.abs(ax - g + wobble * (g > 1 ? 1 : -0.5));
          tmp.lerp(cDeep, (1 - smooth(0.05, 0.22, d)) * 0.75);
        }
        // тёмная кромка полосы
        tmp.lerp(cDeep, smooth(2.55, 3.35, ax) * 0.85);
        // редкий бликовый проблеск вдоль льда
        const sheen = Math.max(0, Math.sin(s * 0.045 + 1.3)) * 0.1 * (1 - smooth(2.0, 2.6, ax));
        tmp.lerp(cSheen, sheen);

        colors[p] = tmp.r;
        colors[p + 1] = tmp.g;
        colors[p + 2] = tmp.b;
        p += 3;
        q += 2;
      }
    }

    const indices: number[] = [];
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < cols - 1; c += 1) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.35,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    // Ассет из манифеста (design §9.5): тайлящаяся текстура льда с бороздами.
    // Ленивая загрузка только в браузере: в headless-окружении (vite-node smoke-run)
    // нет DOM — TextureLoader упал бы на document.createElementNS, поэтому
    // остаёмся на процедурном fallback (vertex-color борозды).
    // Текстура льда — только для базового биома (её голубой тон совпадает с
    // палитрой долины); остальные биомы остаются на vertex-color бороздах,
    // чтобы не ломать палитру (тёплый вулкан, бирюзовые пещеры).
    if (typeof document !== 'undefined' && this.palette.iceTrack === COLORS.iceTrack) {
      new THREE.TextureLoader().load(
        '/tex-ice-track.png',
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = 4;
          mat.vertexColors = false;
          mat.color.setHex(0xffffff);
          mat.map = tex;
          mat.needsUpdate = true;
        },
        undefined,
        () => {
          /* fallback — процедурные vertex-color борозды */
        },
      );
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }
}
