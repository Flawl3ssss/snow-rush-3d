import * as THREE from 'three';
import { COLORS } from '@/config';
import { makePineGeometry, makeRockGeometry, makeSnowmanGeometry, mergeParts, trs } from '@/world/props';
import { createRng } from '@/utils/random';
import { AssetLib } from '@/systems/AssetLib';
import type { ModelName } from '@/systems/AssetLib';

export type ObstacleKind =
  | 'snowdrift' // лёгкий вал
  | 'gift' // лёгкий подарок
  | 'pine' // тяжёлая ёлка
  | 'rock' // тяжёлая скала
  | 'snowman'; // тяжёлый снеговик

export const HEAVY_OBSTACLES: ReadonlySet<ObstacleKind> = new Set(['pine', 'rock', 'snowman']);

/** Радиусы сфер коллизий (gdd §4.3, сфера/сфера против r=0.9 тюбинга). */
export const OBSTACLE_RADIUS: Record<ObstacleKind, number> = {
  snowdrift: 1.1,
  gift: 0.8,
  pine: 0.9,
  rock: 1.3,
  snowman: 0.9,
};

// ---------------------------------------------------------------------------
// Визуал: каждый вид — ОДНА мерджнутая vertex-color геометрия (1 draw call на
// препятствие, shared материал). Контрастные силуэты + красный телеграф
// (gdd §7.2): вал — флажок, подарок — лента, ёлка/скала/снеговик — крупные.
// ---------------------------------------------------------------------------

/** Shared vertex-color материал (per-run dispose безопасен: three ре-инициализирует). */
let sharedMat: THREE.MeshStandardMaterial | null = null;
function obstacleMaterial(): THREE.MeshStandardMaterial {
  if (!sharedMat) {
    sharedMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.95,
      metalness: 0,
    });
  }
  return sharedMat;
}

const geoCache = new Map<ObstacleKind, THREE.BufferGeometry>();

function obstacleGeometry(kind: ObstacleKind): THREE.BufferGeometry {
  const cached = geoCache.get(kind);
  if (cached) return cached;
  let geo: THREE.BufferGeometry;
  switch (kind) {
    case 'snowdrift':
      geo = mergeParts([
        { geo: new THREE.SphereGeometry(1.0, 9, 7), color: COLORS.snowShadow, matrix: trs(0, 0.3, 0, 0, 0, 0, 1.5, 0.6, 1.0) },
        { geo: new THREE.SphereGeometry(0.65, 8, 6), color: COLORS.snowBase, matrix: trs(0.7, 0.42, 0.2, 0, 0.8, 0, 1.1, 0.55, 0.9) },
        { geo: new THREE.SphereGeometry(0.55, 8, 6), color: COLORS.snowBase, matrix: trs(-0.75, 0.35, -0.15, 0, 2.1, 0, 1.0, 0.5, 0.85) },
        // красный флажок-телеграф
        { geo: new THREE.CylinderGeometry(0.03, 0.04, 1.1, 5), color: COLORS.trunk, matrix: trs(0.15, 1.0, 0) },
        { geo: new THREE.BoxGeometry(0.42, 0.26, 0.04), color: COLORS.accentRed, matrix: trs(0.36, 1.42, 0) },
      ]);
      break;
    case 'gift':
      geo = mergeParts([
        { geo: new THREE.BoxGeometry(0.95, 0.85, 0.95), color: COLORS.accentRed, matrix: trs(0, 0.45, 0, 0, 0.5, 0) },
        // белая лента (крест)
        { geo: new THREE.BoxGeometry(0.2, 0.87, 0.97), color: 0xffffff, matrix: trs(0, 0.45, 0, 0, 0.5, 0) },
        { geo: new THREE.BoxGeometry(0.97, 0.87, 0.2), color: 0xffffff, matrix: trs(0, 0.45, 0, 0, 0.5, 0) },
        // бант
        { geo: new THREE.ConeGeometry(0.14, 0.28, 4), color: 0xffffff, matrix: trs(-0.12, 0.98, 0, 0, 0, 0.7) },
        { geo: new THREE.ConeGeometry(0.14, 0.28, 4), color: 0xffffff, matrix: trs(0.12, 0.98, 0, 0, 0, -0.7) },
        // снежная шапка
        { geo: new THREE.BoxGeometry(0.9, 0.1, 0.9), color: COLORS.snowBase, matrix: trs(0, 0.9, 0, 0, 0.5, 0) },
      ]);
      break;
    case 'pine':
      geo = makePineGeometry(0, createRng('obstacle-pine'));
      break;
    case 'rock':
      geo = makeRockGeometry(createRng('obstacle-rock'));
      geo.applyMatrix4(trs(0, 0, 0, 0, 0, 0, 1.25, 1.1, 1.25));
      break;
    case 'snowman':
      geo = makeSnowmanGeometry(true);
      geo.applyMatrix4(trs(0, 0, 0, 0, 0, 0, 0.85, 0.85, 0.85));
      break;
  }
  geoCache.set(kind, geo);
  return geo;
}

/** Детерминированный вариант GLB-модели по позиции (стабильно между пересборками). */
function glbVariant(kind: ObstacleKind, x: number, s: number): ModelName | null {
  const h = Math.abs(Math.sin(x * 12.9898 + s * 78.233) * 43758.5453) % 1;
  switch (kind) {
    case 'pine':
      if (AssetLib.has('pine1') && AssetLib.has('pine2')) return h < 0.5 ? 'pine1' : 'pine2';
      if (AssetLib.has('pine1')) return 'pine1';
      if (AssetLib.has('pine2')) return 'pine2';
      return null;
    case 'rock':
      if (AssetLib.has('rocks') && AssetLib.has('boulder')) return h < 0.6 ? 'rocks' : 'boulder';
      if (AssetLib.has('rocks')) return 'rocks';
      if (AssetLib.has('boulder')) return 'boulder';
      return null;
    case 'snowman':
      return AssetLib.has('snowman') ? 'snowman' : null;
    default:
      return null; // snowdrift/gift остаются процедурными
  }
}

function makeMesh(kind: ObstacleKind, x: number, s: number): THREE.Object3D {
  const model = glbVariant(kind, x, s);
  if (model) {
    const m = AssetLib.clone(model);
    m.rotation.y = (Math.abs(Math.sin(x * 3.7 + s * 1.3)) * 2 - 1) * Math.PI;
    m.traverse((o) => {
      // Без castShadow: мелкие препятствия не рисуются в shadow-map —
      // это ~2× экономия draw calls на каждом видимом объекте (промт §3, ≤150 calls).
      o.castShadow = false;
    });
    return m;
  }
  const m = new THREE.Mesh(obstacleGeometry(kind), obstacleMaterial());
  m.castShadow = false;
  return m;
}

/**
 * Obstacle — препятствие на трассе. Логика (scaffold): данные коллизии,
 * попадание, разлёт. Визуал — мерджнутый vertex-color меш (world-graphics).
 */
export class Obstacle {
  readonly kind: ObstacleKind;
  readonly heavy: boolean;
  readonly radius: number;
  readonly mesh: THREE.Object3D;
  /** трасса-координаты */
  x: number;
  s: number;
  active = true;
  private destroyed = false;
  private flyVel = new THREE.Vector3();

  constructor(kind: ObstacleKind, x: number, s: number) {
    this.kind = kind;
    this.x = x;
    this.s = s;
    this.heavy = HEAVY_OBSTACLES.has(kind);
    this.radius = OBSTACLE_RADIUS[kind];
    this.mesh = makeMesh(kind, x, s);
  }

  /** Разлёт при попадании (лёгкие) или крошение под ракетой. */
  destroy(dirX: number): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active = false;
    this.flyVel.set(dirX * 6 + Math.sign(dirX || 1) * 2, 7, -4);
  }

  /** Анимация разлёта; вернуть true когда можно убрать из сцены. */
  updateDestroy(dt: number): boolean {
    if (!this.destroyed) return false;
    this.flyVel.y -= 9.81 * dt;
    this.mesh.position.addScaledVector(this.flyVel, dt);
    this.mesh.rotation.x += 4 * dt;
    this.mesh.rotation.z += 3 * dt;
    this.mesh.scale.multiplyScalar(Math.max(0, 1 - 1.6 * dt));
    return this.mesh.scale.x < 0.05;
  }
}
