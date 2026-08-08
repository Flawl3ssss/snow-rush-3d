import * as THREE from 'three';
import { COLORS, SLINGSHOT, UPGRADE_TIERS } from '@/config';
import { makeGarlandGeometry, mergeParts, trs } from '@/world/props';
import { AssetLib } from '@/systems/AssetLib';

/**
 * Slingshot — рогатка на стартовой площадке.
 * GLB-режим (AssetLib): модель Jarlan Perez со своей резинкой и карманом —
 * при натяжении двигаем GLB-карман (и героя в нём) назад-вниз по дуге.
 * Процедурный фолбэк: Y-рама из столбов, растяжимые резинки, карман-чаша.
 * Натяжение: setPull(0..1) отъезжает карманом на 0–3.5 м (design.md §6.1).
 * API (setPull/getPocketPosition) — контракт scaffold, неизменен.
 */
export class Slingshot {
  readonly group = new THREE.Group();
  private bandL: THREE.Mesh | null = null;
  private bandR: THREE.Mesh | null = null;
  private pocket: THREE.Group | null = null;
  /** GLB-карман (двигается при натяжении) и его исходная позиция. */
  private glbPouch: THREE.Object3D | null = null;
  private glbPouchRest = new THREE.Vector3();
  private readonly forkL = new THREE.Vector3(-1.6, 3.4, 0);
  private readonly forkR = new THREE.Vector3(1.6, 3.4, 0);
  private readonly pocketRest = new THREE.Vector3(0, 1.4, 0.6);
  private readonly rubber: THREE.MeshStandardMaterial;
  private readonly tier1Details = new THREE.Group();
  private readonly tier2Details = new THREE.Group();
  private readonly tier3Details = new THREE.Group();
  private garlandMat: THREE.MeshStandardMaterial | null = null;
  /** GLB-режим: тир-детали только над столбом (хомуты фолбэка не подходят). */
  private glbMode = false;
  private glbPostX = 0;
  private glbTopY = 4.1;

  constructor() {
    const vertex = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    const rubber = new THREE.MeshStandardMaterial({ color: COLORS.accentRed, flatShading: true, roughness: 0.55 });
    this.rubber = rubber;

    let frameHalfSpan = 1.6;
    let frameTopY = 3.4;

    if (AssetLib.has('slingshot')) {
      // ===== GLB-рама (poly.pizza, Jarlan Perez, CC-BY) =====
      const frame = AssetLib.clone('slingshot');
      this.group.add(frame);
      frame.updateMatrixWorld(true);

      // Карман модели — самый маленький меш (тёмная кожаная чаша)
      let pouch: THREE.Mesh | null = null;
      let pouchVol = Infinity;
      frame.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        const vol = size.x * size.y * size.z;
        if (vol < pouchVol) {
          pouchVol = vol;
          pouch = mesh;
        }
      });
      if (pouch) {
        this.glbPouch = pouch;
        this.glbPouchRest.copy(pouch.position);
        const box = new THREE.Box3().setFromObject(pouch);
        const center = box.getCenter(new THREE.Vector3());
        // Герой сидит В кармане: низ тюбинга утоплен в чашу
        this.pocketRest.copy(center).add(new THREE.Vector3(0, -0.22, 0.1));
      }

      const box = new THREE.Box3().setFromObject(frame);
      frameHalfSpan = Math.max(0.8, (box.max.x - box.min.x) * 0.5 * 0.82);
      frameTopY = box.max.y * 0.96;
      this.forkL.set(-frameHalfSpan, frameTopY, 0);
      this.forkR.set(frameHalfSpan, frameTopY, 0);
      this.glbMode = true;
      this.glbPostX = box.max.x - (box.max.x - box.min.x) * 0.18; // столб справа
      this.glbTopY = frameTopY;
    } else {
      // ===== Процедурный фолбэк: столбы-рожки с обмотками =====
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(
          mergeParts([
            { geo: new THREE.CylinderGeometry(0.24, 0.34, 4.4, 12), color: COLORS.trunk, matrix: trs(side * 1.6, 2.2, 0, 0, 0, side * -0.12) },
            { geo: new THREE.CylinderGeometry(0.55, 0.7, 0.7, 12), color: 0x6e452c, matrix: trs(side * 1.78, 0.35, 0) },
            { geo: new THREE.TorusGeometry(0.3, 0.07, 8, 14), color: COLORS.warmSand, matrix: trs(side * 1.35, 3.15, 0, Math.PI / 2, 0, side * -0.12) },
            { geo: new THREE.TorusGeometry(0.28, 0.06, 8, 14), color: COLORS.warmSand, matrix: trs(side * 1.42, 2.75, 0, Math.PI / 2, 0, side * -0.12) },
            { geo: new THREE.SphereGeometry(0.3, 7, 5), color: COLORS.snowBase, matrix: trs(side * 1.32, 3.55, 0, 0, 0, 0, 1, 0.45, 1) },
          ]),
          vertex,
        );
        post.castShadow = true;
        this.group.add(post);
      }

      // Перекладина + распорки
      const cross = new THREE.Mesh(
        mergeParts([
          { geo: new THREE.CylinderGeometry(0.16, 0.16, 3.6, 12), color: COLORS.trunk, matrix: trs(0, 0.9, 0, 0, 0, Math.PI / 2) },
          { geo: new THREE.CylinderGeometry(0.09, 0.09, 2.2, 6), color: 0x6e452c, matrix: trs(-0.9, 0.5, 0.3, 0.5, 0, 0.6) },
          { geo: new THREE.CylinderGeometry(0.09, 0.09, 2.2, 6), color: 0x6e452c, matrix: trs(0.9, 0.5, 0.3, 0.5, 0, -0.6) },
        ]),
        vertex,
      );
      this.group.add(cross);

      // Карман: кожаная чаша с ободом (группа — движется целиком)
      this.pocket = new THREE.Group();
      const cup = new THREE.Mesh(
        new THREE.SphereGeometry(0.48, 9, 6, 0, Math.PI * 2, Math.PI / 2.6, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x6e452c, flatShading: true, roughness: 0.9, side: THREE.DoubleSide }),
      );
      cup.rotation.x = Math.PI;
      cup.position.y = 0.28;
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.44, 0.07, 6, 12),
        new THREE.MeshStandardMaterial({ color: COLORS.warmSand, flatShading: true, roughness: 0.85 }),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.3;
      cup.castShadow = true;
      this.pocket.add(cup, rim);
      this.pocket.position.copy(this.pocketRest);
      this.group.add(this.pocket);

      // Резинки — цилиндры, натягиваем в setPull
      const bandGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6);
      this.bandL = new THREE.Mesh(bandGeo, rubber);
      this.bandR = new THREE.Mesh(bandGeo.clone(), rubber);
      this.bandL.castShadow = this.bandR.castShadow = true;
      this.group.add(this.bandL, this.bandR);
    }

    // Гирлянда между рожками (праздничный акцент design §2.2)
    this.garlandMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.6,
      emissive: 0xfff6d8,
      emissiveIntensity: 0.2,
    });
    const garland = new THREE.Mesh(
      makeGarlandGeometry(frameHalfSpan * 2 - 0.2, 0.5, 11),
      this.garlandMat,
    );
    garland.position.set(0, frameTopY - 0.05, 0.1);
    this.group.add(garland);

    // Сугроб у основания
    const mound = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 10, 6),
      new THREE.MeshStandardMaterial({ color: COLORS.snowBase, flatShading: true, roughness: 1 }),
    );
    mound.scale.set(1, 0.22, 0.8);
    mound.position.y = -0.05;
    mound.receiveShadow = true;
    this.group.add(mound);

    this.buildTierDetails();
    // Детали тиров размечены под эталонную раму (±1.6 / 3.4) — подгоняем под GLB
    const tierScaleX = frameHalfSpan / 1.6;
    const tierScaleY = frameTopY / 3.4;
    for (const g of [this.tier1Details, this.tier2Details, this.tier3Details]) {
      g.scale.set(tierScaleX, tierScaleY, 1);
    }
    this.group.add(this.tier1Details, this.tier2Details, this.tier3Details);
    this.setPull(0);
  }

  /**
   * Детали визуальной эволюции рогатки (промт §9):
   * тир 1 — металлические хомуты на столбах; тир 2 — стальные наконечники
   * рожек и обвязка; тир 3 — золотая звезда и яркая гирлянда.
   */
  private buildTierDetails(): void {
    // metalness низкий: без envMap металл рендерится чёрным
    const metal = new THREE.MeshStandardMaterial({ color: 0x9fb2c8, flatShading: true, roughness: 0.35, metalness: 0.3 });

    if (this.glbMode) {
      // GLB-рамка асимметрична: хомуты фолбэка не лягут — тиры = звезда + огни гирлянды
      const gold = new THREE.MeshStandardMaterial({
        color: 0xffc933,
        flatShading: true,
        roughness: 0.3,
        metalness: 0.35,
        emissive: 0x8a5a00,
        emissiveIntensity: 0.5,
      });
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), gold);
      star.scale.set(1, 1.4, 0.5);
      star.position.set(this.glbPostX, this.glbTopY + 0.45, 0);
      this.tier3Details.add(star);
      // тир 2: золотой набалдашник на столбе
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), gold);
      cap.position.set(this.glbPostX, this.glbTopY + 0.05, 0);
      this.tier2Details.add(cap);
    } else {
      // тир 1: хомуты-обручи на столбах
      for (const side of [-1, 1]) {
        for (const y of [1.2, 2.0]) {
          const clampBand = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 6, 12), metal);
          clampBand.rotation.x = Math.PI / 2;
          clampBand.position.set(side * 1.6 - side * (2.2 - y) * 0.12, y, 0);
          this.tier1Details.add(clampBand);
        }
      }

      // тир 2: стальные наконечники рожек + пластина на перекладине
      for (const side of [-1, 1]) {
        const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 8), metal);
        tip.position.set(side * 1.35, 3.35, 0);
        tip.rotation.z = side * -0.12;
        this.tier2Details.add(tip);
      }
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.34, 0.1), metal);
      plate.position.set(0, 0.9, 0.18);
      this.tier2Details.add(plate);

      // тир 3: золотая звезда над перекладиной
      const gold = new THREE.MeshStandardMaterial({
        color: 0xffc933,
        flatShading: true,
        roughness: 0.3,
        metalness: 0.35,
        emissive: 0x8a5a00,
        emissiveIntensity: 0.5,
      });
      const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), gold);
      star.scale.set(1, 1.4, 0.5);
      star.position.set(0, 4.15, 0);
      this.tier3Details.add(star);
    }

    this.tier1Details.visible = false;
    this.tier2Details.visible = false;
    this.tier3Details.visible = false;
  }

  /** Применить визуальный тир (0..3) — цвет резинок + детали. */
  applyTier(tier: number): void {
    const colors = UPGRADE_TIERS.slingshotBands;
    this.rubber.color.setHex(colors[Math.min(tier, colors.length - 1)]);
    this.tier1Details.visible = tier >= 1;
    this.tier2Details.visible = tier >= 2;
    this.tier3Details.visible = tier >= 3;
    if (this.garlandMat) this.garlandMat.emissiveIntensity = tier >= 3 ? 0.65 : 0.2;
  }

  /** Позиция кармана при натяжении p (0..1): назад (+z к камере) и вниз по дуге. */
  getPocketPosition(p: number): THREE.Vector3 {
    const drag = p * SLINGSHOT.maxDragMeters;
    return new THREE.Vector3(
      this.pocketRest.x,
      this.pocketRest.y - drag * 0.35,
      this.pocketRest.z + drag,
    );
  }

  setPull(p: number): void {
    const pos = this.getPocketPosition(p);
    if (this.glbPouch) {
      // GLB-режим: двигаем карман модели на дельту (world→local через worldScale)
      const delta = new THREE.Vector3().subVectors(pos, this.pocketRest);
      const ws = this.glbPouch.getWorldScale(new THREE.Vector3());
      this.glbPouch.position.copy(this.glbPouchRest).add(
        new THREE.Vector3(delta.x / (ws.x || 1), delta.y / (ws.y || 1), delta.z / (ws.z || 1)),
      );
    }
    if (this.pocket) {
      this.pocket.position.copy(pos);
      if (this.bandL) this.stretchBand(this.bandL, this.forkL, pos);
      if (this.bandR) this.stretchBand(this.bandR, this.forkR, pos);
    }
  }

  private stretchBand(band: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    band.position.copy(mid);
    band.scale.set(1, len, 1);
    band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }
}
