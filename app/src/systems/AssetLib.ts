import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * AssetLib — единая точка загрузки GLB-ассетов (poly.pizza, CREDITS.md).
 * Нормализация: масштаб до целевого размера, посадка низа bbox на y=0,
 * центровка по XZ. Прототипы кэшируются; выдача — клоны (static meshes).
 * Массовые пропсы — через toInstanced() (1 draw call на материал).
 */

export interface ModelSpec {
  /** Индексы top-level детей gltf.scene, которые надо скрыть (флоу пингвина, голова фламинго). */
  hideChildren?: number[];
  /** Целевая высота (м) — если задана, масштаб по высоте. */
  height?: number;
  /** Целевой max-размер (м) — масштаб по наибольшему измерению bbox. */
  size?: number;
  /** Целевая ширина по X (м). */
  width?: number;
  /** Не сажать на землю (для парящих объектов, напр. монет). */
  noGround?: boolean;
  /** Не центрировать по XZ. */
  noCenterXZ?: boolean;
}

export const MODEL_SPECS = {
  penguin: { height: 1.35, hideChildren: [0] }, // Peppermint Penguin без льдины
  tube: { size: 1.9, hideChildren: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, // кольцо без фламинго
  slingshot: { height: 4.3 },
  pine1: { height: 5.2 }, // Quaternius, заснеженная
  pine2: { height: 5.6 }, // teal game-y
  pines3: { height: 6.0 }, // 3 бело-зелёные
  deadTrees: { height: 4.6 },
  rocks: { height: 1.6 },
  boulder: { height: 2.6 },
  snowman: { height: 2.6 },
  igloo: { height: 3.2 },
  flag: { height: 3.4 },
  coin: { height: 0.85, noGround: true },
  gem: { height: 0.9, noGround: true },
  crystal: { height: 2.4 },
  torch: { height: 2.2 },
  iceberg: { height: 7.5 },
  rocket: { height: 1.1, noGround: true },
  chest: { height: 1.6 },
  cabin: { height: 6.5 },
} as const satisfies Record<string, ModelSpec>;

export type ModelName = keyof typeof MODEL_SPECS;

const MODEL_FILES: Record<ModelName, string> = {
  penguin: 'penguin',
  tube: 'tube_flamingo',
  slingshot: 'slingshot',
  pine1: 'pine_snow',
  pine2: 'pine_snow2',
  pines3: 'snowy_trees',
  deadTrees: 'dead_trees',
  rocks: 'rocks',
  boulder: 'boulder_snow',
  snowman: 'snowman',
  igloo: 'igloo',
  flag: 'flag',
  coin: 'coin',
  gem: 'gem',
  crystal: 'crystal',
  torch: 'torch',
  iceberg: 'iceberg',
  rocket: 'rocket',
  chest: 'chest',
  cabin: 'cabin',
};

/**
 * Модели, не участвующие в 3D-сцене: сундук и ракета отрисовываются на
 * DOM-экранах (ChestScreen/HUD) обычными PNG-иконками. Их GLB висели в
 * блокирующем preload и тянули ~1.2 МБ на старте впустую. Файлы оставлены
 * в public/models — при переносе экрана сундука в 3D достаточно убрать имя
 * из этого списка.
 */
const PRELOAD_SKIP: ReadonlySet<string> = new Set<ModelName>(['chest', 'rocket']);

export class AssetLib {
  private static prototypes = new Map<ModelName, THREE.Group>();
  private static loader = new GLTFLoader();

  /** Предзагрузка всех моделей; onProgress(0..1) для лоадера. Сбой одной модели не роняет остальные. */
  static async preload(onProgress?: (t: number) => void): Promise<void> {
    const names = (Object.keys(MODEL_SPECS) as ModelName[]).filter((n) => !PRELOAD_SKIP.has(n));
    let done = 0;
    await Promise.all(
      names.map(async (name) => {
        try {
          const gltf = await this.loader.loadAsync(`/models/${MODEL_FILES[name]}.glb`);
          const proto = this.normalize(gltf.scene, MODEL_SPECS[name]);
          this.prototypes.set(name, proto);
        } catch (err) {
          console.warn(`[AssetLib] модель ${name} не загрузилась — будет процедурный фолбэк`, err);
        } finally {
          done += 1;
          onProgress?.(done / names.length);
        }
      }),
    );
  }

  static ready(): boolean {
    return this.prototypes.size > 0;
  }

  /** Загружена ли конкретная модель. */
  static has(name: ModelName): boolean {
    return this.prototypes.has(name);
  }

  private static normalize(scene: THREE.Group, spec: ModelSpec): THREE.Group {
    const root = new THREE.Group();
    const inner = scene;
    if (spec.hideChildren) {
      inner.children.forEach((c, i) => {
        if (spec.hideChildren!.includes(i)) c.visible = false;
      });
    }
    root.add(inner);
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    let s = 1;
    if (spec.height) s = spec.height / Math.max(size.y, 1e-6);
    else if (spec.width) s = spec.width / Math.max(size.x, 1e-6);
    else s = (spec.size ?? 1) / Math.max(size.x, size.y, size.z, 1e-6);
    inner.scale.setScalar(s);
    root.updateMatrixWorld(true);

    const box2 = new THREE.Box3().setFromObject(root);
    const center = box2.getCenter(new THREE.Vector3());
    if (!spec.noCenterXZ) {
      inner.position.x -= center.x;
      inner.position.z -= center.z;
    }
    if (!spec.noGround) inner.position.y -= box2.min.y;

    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (m && 'roughness' in m) {
          m.roughness = Math.min(0.95, Math.max(0.5, m.roughness ?? 0.9));
          m.metalness = Math.min(m.metalness ?? 0, 0.15);
        }
      }
    });
    return root;
  }

  /** Клон прототипа (группа; материалы/геометрия общие). */
  static clone(name: ModelName): THREE.Group {
    const proto = this.prototypes.get(name);
    if (!proto) throw new Error(`AssetLib: модель ${name} не загружена`);
    return proto.clone(true);
  }

  /**
   * Извлечь смердженные (по материалам) геометрии прототипа в мировых
   * координатах прототипа — для InstancedMesh. Возвращает пары [geometry, material].
   */
  static mergedParts(name: ModelName): Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> {
    const proto = this.prototypes.get(name);
    if (!proto) throw new Error(`AssetLib: модель ${name} не загружена`);
    proto.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    proto.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      let p: THREE.Object3D | null = mesh;
      let visible = true;
      while (p) {
        if (!p.visible) {
          visible = false;
          break;
        }
        p = p.parent;
      }
      if (!visible) return;
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      // убрать атрибуты, которых нет у остальных (иначе mergeGeometries упадёт)
      for (const key of Object.keys(geo.attributes)) {
        if (!['position', 'normal', 'uv', 'color'].includes(key)) geo.deleteAttribute(key);
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mat = mats[0] as THREE.Material;
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat)!.push(geo);
    });
    const out: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> = [];
    for (const [material, geos] of byMat) {
      out.push({ geometry: geos.length === 1 ? geos[0] : mergeGeometries(geos, false), material });
    }
    return out;
  }

  /** InstancedMesh-набор по прототипу (1 draw call на материал). */
  static toInstanced(name: ModelName, count: number): THREE.Group {
    const group = new THREE.Group();
    for (const part of this.mergedParts(name)) {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, count);
      inst.castShadow = true;
      inst.receiveShadow = false;
      inst.frustumCulled = false; // инстансы размазаны по трассе; cull по видимости чанков снаружи
      group.add(inst);
    }
    return group;
  }
}
