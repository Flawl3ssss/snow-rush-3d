import * as THREE from 'three';
import { COLORS, PICKUPS } from '@/config';
import type { TweenManager } from '@/utils/tween';
import { easeOutCubic } from '@/utils/tween';
import { mergeParts, trs } from '@/world/props';
import { vfxHub } from '@/world/vfxHub';
import { AssetLib } from '@/systems/AssetLib';

export type PickupKind = 'coin' | 'crystal' | 'diamond';

// ---------------------------------------------------------------------------
// Визуал (world-graphics): мерджнутые vertex-color формы, читаемые в движении.
// Монета — золотой диск с тёмной кромкой и звездой; кристалл — розовый
// октаэдр с ярким ядром; алмаз — вытянутый циановый. Геометрии shared,
// материал per-instance (pop-анимация гасит opacity только своего меша).
// ---------------------------------------------------------------------------

const geoCache = new Map<PickupKind, THREE.BufferGeometry>();

function pickupGeometry(kind: PickupKind): THREE.BufferGeometry {
  const cached = geoCache.get(kind);
  if (cached) return cached;
  let geo: THREE.BufferGeometry;
  switch (kind) {
    case 'coin':
      geo = mergeParts([
        // диск (вертикально, лицом к игроку)
        { geo: new THREE.CylinderGeometry(0.42, 0.42, 0.1, 14), color: COLORS.coinGold, matrix: trs(0, 0, 0, Math.PI / 2, 0, 0) },
        // кромка
        { geo: new THREE.TorusGeometry(0.42, 0.045, 6, 16), color: COLORS.coinGoldDark, matrix: trs(0, 0, 0) },
        // звезда на face (плоская пятиконечная из двух «лепестков»)
        { geo: new THREE.ConeGeometry(0.16, 0.06, 5), color: COLORS.coinGoldDark, matrix: trs(0, 0, 0.06, Math.PI / 2, 0, 0, 1, 1, 1) },
        { geo: new THREE.ConeGeometry(0.16, 0.06, 5), color: COLORS.coinGoldDark, matrix: trs(0, 0, -0.06, -Math.PI / 2, 0, 0) },
      ]);
      break;
    case 'crystal':
      geo = mergeParts([
        { geo: new THREE.OctahedronGeometry(0.5, 0), color: COLORS.crystalPink, matrix: trs(0, 0, 0, 0, 0, 0, 1, 1.25, 1) },
        { geo: new THREE.OctahedronGeometry(0.28, 0), color: 0xffd7ec, matrix: trs(0, 0, 0, 0, 0.6, 0, 1, 1.3, 1) },
      ]);
      break;
    case 'diamond':
      geo = mergeParts([
        { geo: new THREE.OctahedronGeometry(0.55, 0), color: COLORS.diamondCyan, matrix: trs(0, 0, 0, 0, 0, 0, 1, 1.35, 1) },
        { geo: new THREE.OctahedronGeometry(0.3, 0), color: 0xd8f7ff, matrix: trs(0, 0.05, 0, 0, 0.8, 0, 1, 1.4, 1) },
      ]);
      break;
  }
  geoCache.set(kind, geo);
  return geo;
}

function makePickupMesh(kind: PickupKind): { obj: THREE.Object3D; materials: THREE.MeshStandardMaterial[] } {
  // ===== GLB-версия (AssetLib): монета/самоцвет с poly.pizza =====
  const glbName = kind === 'coin' ? 'coin' : 'gem';
  if (AssetLib.has(glbName)) {
    const inner = AssetLib.clone(glbName);
    // Пивот в центр bbox — update() крутит rotation.y, TrackBuilder ждёт центр в mesh.position
    const box = new THREE.Box3().setFromObject(inner);
    const center = box.getCenter(new THREE.Vector3());
    inner.position.sub(center);
    const obj = new THREE.Group();
    obj.add(inner);
    const materials: THREE.MeshStandardMaterial[] = [];
    const tint = new THREE.Color(
      kind === 'coin' ? 0xffffff : kind === 'crystal' ? COLORS.crystalPink : COLORS.diamondCyan,
    );
    const emissive = new THREE.Color(
      kind === 'coin' ? COLORS.coinGoldDark : kind === 'crystal' ? COLORS.crystalPink : COLORS.diamondCyan,
    );
    inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = mats.map((m) => {
        const c = (m as THREE.MeshStandardMaterial).clone();
        if (kind !== 'coin') c.color.multiply(tint); // самоцвет → розовый/циан
        c.emissive = emissive.clone();
        c.emissiveIntensity = kind === 'coin' ? 0.25 : 0.35;
        // W6 §3.3: с PMREM-окружением золото больше не чернеет
        c.metalness = kind === 'coin' ? 0.85 : 0.15;
        c.roughness = kind === 'coin' ? 0.35 : 0.25;
        materials.push(c);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
    });
    return { obj, materials };
  }

  // ===== Процедурный фолбэк =====
  const params: THREE.MeshStandardMaterialParameters = {
    vertexColors: true,
    flatShading: true,
    metalness: 0,
  };
  if (kind === 'coin') {
    params.roughness = 0.35;
    params.metalness = 0.85; // W6 §3.3
    params.emissive = new THREE.Color(COLORS.coinGoldDark);
    params.emissiveIntensity = 0.25;
  } else if (kind === 'crystal') {
    params.roughness = 0.3;
    params.emissive = new THREE.Color(COLORS.crystalPink);
    params.emissiveIntensity = 0.3;
  } else {
    params.roughness = 0.25;
    params.emissive = new THREE.Color(COLORS.diamondCyan);
    params.emissiveIntensity = 0.35;
  }
  const mat = new THREE.MeshStandardMaterial(params);
  return { obj: new THREE.Mesh(pickupGeometry(kind), mat), materials: [mat] };
}

/**
 * Pickup — монета/кристалл/алмаз. Сенсор-сфера (gdd §4.6), магнит 2.5 м,
 * pop-анимация подбора (design.md §6.1) + VFX-событие (звёздная вспышка).
 */
export class Pickup {
  readonly kind: PickupKind;
  readonly radius: number;
  readonly mesh: THREE.Object3D;
  private readonly materials: THREE.MeshStandardMaterial[];
  x: number;
  s: number;
  /** вертикальное смещение над поверхностью (дуги над трамплинами) */
  yOff: number;
  collected = false;
  magnetized = false;
  private baseY = 0;
  private spinPhase: number;

  constructor(kind: PickupKind, x: number, s: number, yOff: number, spinPhase: number) {
    this.kind = kind;
    this.x = x;
    this.s = s;
    this.yOff = yOff;
    this.radius = kind === 'coin' ? PICKUPS.coinRadius : PICKUPS.gemRadius;
    const built = makePickupMesh(kind);
    this.mesh = built.obj;
    this.materials = built.materials;
    this.spinPhase = spinPhase;
  }

  setBaseY(y: number): void {
    this.baseY = y;
  }

  /** Вращение + левитация; магнит — homing 12 м/с к игроку (gdd §4.6). */
  update(dt: number, time: number, magnetTarget?: THREE.Vector3): void {
    if (this.collected) return;
    this.mesh.rotation.y = time * 2.5 + this.spinPhase;
    if (this.magnetized && magnetTarget) {
      const toTarget = new THREE.Vector3().subVectors(magnetTarget, this.mesh.position);
      const dist = toTarget.length();
      if (dist > 0.01) {
        this.mesh.position.addScaledVector(toTarget.normalize(), Math.min(PICKUPS.magnetSpeed * dt, dist));
      }
    } else {
      this.mesh.position.y = this.baseY + Math.sin(time * 2 + this.spinPhase) * 0.08;
    }
  }

  /** Pop: рост 1→1.6, подъём +1.2 м, fade 280 мс (design.md §6.1). */
  playPop(tweens: TweenManager): void {
    this.collected = true;
    vfxHub.emit({
      type: this.kind === 'coin' ? 'pickup_coin' : 'pickup_gem',
      position: this.mesh.position.clone(),
    });
    const mesh = this.mesh;
    for (const mat of this.materials) mat.transparent = true;
    const startY = mesh.position.y;
    tweens.tween(
      0.28,
      (t) => {
        mesh.scale.setScalar(1 + 0.6 * t);
        mesh.position.y = startY + t * 1.2;
        for (const mat of this.materials) mat.opacity = 1 - t;
      },
      easeOutCubic,
      () => {
        mesh.visible = false;
      },
    );
  }
}
