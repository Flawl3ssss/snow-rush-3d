import * as THREE from 'three';
import { COLORS } from '@/config';
import { mergeParts, trs } from '@/world/props';

/**
 * Финишные ворота (gdd §7.2): полосатые столбы, балка, гирлянда флажков
 * с анимацией махания (design §6.1), золотая звезда. group названа
 * 'finishGate' — ParticleSystem детектит пролёт для конфетти.
 */
export class FinishGate {
  readonly group = new THREE.Group();
  readonly s: number;
  private readonly flags: THREE.Mesh[] = [];
  private readonly topFlags: THREE.Mesh[] = [];

  constructor(s: number, halfW: number) {
    this.s = s;
    this.group.name = 'finishGate';
    const vertex = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });

    // Полосатые столбы (мердж по 4 сегмента + навершие)
    for (const side of [-1, 1]) {
      const parts = [];
      for (let i = 0; i < 4; i += 1) {
        parts.push({
          geo: new THREE.CylinderGeometry(0.2, 0.2, 1.15, 8),
          color: i % 2 === 0 ? COLORS.accentRed : 0xffffff,
          matrix: trs(0, 0.58 + i * 1.15, 0),
        });
      }
      parts.push(
        { geo: new THREE.CylinderGeometry(0.3, 0.36, 0.35, 8), color: COLORS.accentRedDark, matrix: trs(0, 0.17, 0) },
        { geo: new THREE.SphereGeometry(0.24, 8, 6), color: COLORS.coinGold, matrix: trs(0, 4.85, 0) },
      );
      const post = new THREE.Mesh(mergeParts(parts), vertex);
      post.position.set(side * (halfW + 0.6), 0, 0);
      post.castShadow = true;
      this.group.add(post);

      // Флажок на навершии (машет, остриё к игроку +z)
      const topFlagGeo = new THREE.ConeGeometry(0.28, 0.85, 4);
      topFlagGeo.rotateX(Math.PI / 2); // остриё +z
      topFlagGeo.translate(0, 0, 0.45); // pivot у древка
      const topFlag = new THREE.Mesh(
        topFlagGeo,
        new THREE.MeshStandardMaterial({ color: COLORS.accentRed, flatShading: true, roughness: 0.8, side: THREE.DoubleSide }),
      );
      topFlag.position.set(side * (halfW + 0.6), 4.85, 0);
      this.topFlags.push(topFlag);
      this.group.add(topFlag);
    }

    // Перекладина с белой кромкой
    const beam = new THREE.Mesh(
      mergeParts([
        { geo: new THREE.BoxGeometry(halfW * 2 + 1.6, 0.5, 0.4), color: COLORS.accentRed },
        { geo: new THREE.BoxGeometry(halfW * 2 + 1.7, 0.14, 0.42), color: 0xffffff, matrix: trs(0, 0.28, 0) },
        { geo: new THREE.BoxGeometry(halfW * 2 + 1.7, 0.14, 0.42), color: 0xffffff, matrix: trs(0, -0.28, 0) },
      ]),
      vertex,
    );
    beam.position.y = 4.6;
    beam.castShadow = true;
    this.group.add(beam);

    // Золотая звезда по центру балки
    const star = new THREE.Mesh(
      mergeParts([
        { geo: new THREE.ConeGeometry(0.34, 0.16, 5), color: COLORS.coinGold, matrix: trs(0, 0, 0.1, Math.PI / 2, 0, 0) },
        { geo: new THREE.ConeGeometry(0.34, 0.16, 5), color: COLORS.coinGoldDark, matrix: trs(0, 0, -0.1, -Math.PI / 2, 0, 0) },
      ]),
      vertex,
    );
    star.position.set(0, 4.6, 0);
    this.group.add(star);

    // Гирлянда треугольных флажков (провисает, машет)
    const flagGeo = new THREE.ConeGeometry(0.3, 0.8, 4);
    flagGeo.rotateZ(Math.PI); // остриём вниз
    flagGeo.translate(0, -0.4, 0); // pivot на линии подвеса — махание вокруг неё
    const flagRed = new THREE.MeshStandardMaterial({ color: COLORS.accentRed, flatShading: true, roughness: 0.85, side: THREE.DoubleSide });
    const flagWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.85, side: THREE.DoubleSide });
    const flagBlue = new THREE.MeshStandardMaterial({ color: COLORS.tubeBlue, flatShading: true, roughness: 0.85, side: THREE.DoubleSide });
    const flagMats = [flagRed, flagWhite, flagBlue];
    const count = 9;
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const flag = new THREE.Mesh(flagGeo, flagMats[i % 3]);
      const sag = Math.sin(t * Math.PI) * 0.55;
      flag.position.set(-halfW + 1 + t * (halfW * 2 - 2), 4.28 - sag, 0);
      this.flags.push(flag);
      this.group.add(flag);
    }
  }

  /** Флажки машут (design.md §6.1 финиш). */
  update(time: number): void {
    for (let i = 0; i < this.flags.length; i += 1) {
      this.flags[i].rotation.x = Math.sin(time * 6 + i) * 0.28;
      this.flags[i].rotation.y = Math.sin(time * 4.2 + i * 1.7) * 0.2;
    }
    for (let i = 0; i < this.topFlags.length; i += 1) {
      this.topFlags[i].rotation.y = Math.sin(time * 5 + i * 2) * 0.35;
    }
  }
}
