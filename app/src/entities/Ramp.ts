import * as THREE from 'three';
import { COLORS, PHYSICS } from '@/config';
import { degToRad } from '@/utils/math';
import { mergeParts, trs } from '@/world/props';

/** Трамплин (gdd §4.1 вертикаль): съезд → airborne, vy0 = v·sin(15°) + 2. */
export class Ramp {
  readonly mesh = new THREE.Group();
  readonly x: number;
  readonly s: number;
  readonly width = 3.2;
  readonly length = 4;
  used = false;

  constructor(x: number, s: number) {
    this.x = x;
    this.s = s;
    const angle = degToRad(PHYSICS.ramp.angleDeg);
    const ice = new THREE.MeshStandardMaterial({ color: COLORS.iceTrackDeep, flatShading: true, roughness: 0.35, metalness: 0.05 });
    const vertex = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });

    // Доска: заезд (uphill, +z) касается земли, губа (downhill, −z) поднята.
    // Центр доски на (l/2)·sin(a), чтобы входная кромка лежала на y=0.
    // (fix «кривого трамплина»: раньше доска была развёрнута губой ВВЕРХ по склону)
    const halfL = this.length / 2;
    const boardY = halfL * Math.sin(angle) + 0.15; // +толщина/2
    const board = new THREE.Mesh(new THREE.BoxGeometry(this.width, 0.3, this.length), ice);
    board.rotation.x = angle;
    board.position.y = boardY;
    board.castShadow = true;

    // высота поверхности доски на губе (z = −halfL)
    const lipY = boardY + halfL * Math.sin(angle) + 0.15;

    // Кромки + губа + опоры (мердж, vertex colors)
    const frame = new THREE.Mesh(
      mergeParts([
        // красные борта по краям доски
        { geo: new THREE.BoxGeometry(0.18, 0.12, this.length), color: COLORS.accentRed, matrix: trs(-this.width / 2 + 0.1, boardY + 0.2, 0, angle, 0, 0) },
        { geo: new THREE.BoxGeometry(0.18, 0.12, this.length), color: COLORS.accentRed, matrix: trs(this.width / 2 - 0.1, boardY + 0.2, 0, angle, 0, 0) },
        // бело-красная «губа» на съезде (поднятый downhill-край)
        { geo: new THREE.BoxGeometry(this.width, 0.1, 0.28), color: 0xffffff, matrix: trs(0, lipY + 0.05, -halfL + 0.15, angle, 0, 0) },
        { geo: new THREE.BoxGeometry(this.width, 0.06, 0.28), color: COLORS.accentRed, matrix: trs(0, lipY - 0.02, -halfL + 0.32, angle, 0, 0) },
        // опоры под поднятым краем (длинные, до земли с учётом наклона группы)
        { geo: new THREE.BoxGeometry(0.22, 2.2, 0.22), color: COLORS.trunk, matrix: trs(-this.width / 2 + 0.3, lipY / 2 - 0.2, -halfL + 0.5, 0, 0, 0.12) },
        { geo: new THREE.BoxGeometry(0.22, 2.2, 0.22), color: COLORS.trunk, matrix: trs(this.width / 2 - 0.3, lipY / 2 - 0.2, -halfL + 0.5, 0, 0, -0.12) },
        // снежный пандус перед доской (мягкий заезд, uphill-сторона)
        { geo: new THREE.SphereGeometry(1.6, 8, 6), color: COLORS.snowBase, matrix: trs(0, -0.25, halfL + 0.6, 0, 0, 0, 1.1, 0.35, 1.1) },
      ]),
      vertex,
    );
    frame.castShadow = true;
    this.mesh.add(board, frame);
  }

  contains(x: number, s: number): boolean {
    return Math.abs(x - this.x) <= this.width / 2 && Math.abs(s - this.s) <= this.length / 2;
  }
}

/** Буст-пад (gdd §4.3): красная стрелка, v += 4 м/с (clamp 32). */
export class BoostPad {
  readonly mesh = new THREE.Group();
  readonly x: number;
  readonly s: number;
  readonly width = 2.6;
  readonly length = 3;
  cooldown = 0;

  constructor(x: number, s: number) {
    this.x = x;
    this.s = s;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(this.width, 0.12, this.length),
      new THREE.MeshStandardMaterial({ color: COLORS.accentRed, flatShading: true, roughness: 0.6 }),
    );
    base.position.y = 0.06;
    // двойной белый шеврон вперёд (−z)
    const chevron = new THREE.Mesh(
      mergeParts([
        { geo: new THREE.ConeGeometry(0.62, 1.0, 3), color: 0xffffff, matrix: trs(0, 0, -0.55, -Math.PI / 2, 0, 0) },
        { geo: new THREE.ConeGeometry(0.62, 1.0, 3), color: 0xffffff, matrix: trs(0, 0, 0.55, -Math.PI / 2, 0, 0) },
      ]),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.5,
        emissive: 0xffffff,
        emissiveIntensity: 0.3,
      }),
    );
    chevron.position.y = 0.14;
    this.mesh.add(base, chevron);
  }

  contains(x: number, s: number): boolean {
    return Math.abs(x - this.x) <= this.width / 2 && Math.abs(s - this.s) <= this.length / 2;
  }
}

/** Ледяная гладь-ловушка (gdd §4.3): μ 0.15, стеринг в 2 раза слабее. */
export class IcePatch {
  readonly mesh: THREE.Mesh;
  readonly x: number;
  readonly s: number;
  readonly halfW: number;
  readonly halfL: number;

  constructor(x: number, s: number, w = 6, l = 10) {
    this.x = x;
    this.s = s;
    this.halfW = w / 2;
    this.halfL = l / 2;
    // Гладь + блестящие «трещины»-искры (мердж в одну плоскую геометрию)
    const geo = mergeParts([
      { geo: new THREE.PlaneGeometry(w, l), color: COLORS.iceTrackDeep },
      { geo: new THREE.PlaneGeometry(w * 0.55, 0.1), color: 0xd8f2ff, matrix: trs(-w * 0.1, l * 0.15, 0.005, 0, 0, 0.5) },
      { geo: new THREE.PlaneGeometry(w * 0.4, 0.08), color: 0xd8f2ff, matrix: trs(w * 0.15, -l * 0.2, 0.005, 0, 0, -0.35) },
      { geo: new THREE.PlaneGeometry(w * 0.3, 0.07), color: 0xffffff, matrix: trs(0, l * 0.32, 0.005, 0, 0, 0.15) },
    ]);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.15,
        metalness: 0.05,
        transparent: true,
        opacity: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.03;
  }

  contains(x: number, s: number): boolean {
    return Math.abs(x - this.x) <= this.halfW && Math.abs(s - this.s) <= this.halfL;
  }
}
