import * as THREE from 'three';
import type { Rng } from '@/utils/random';
import { makePineGeometry, makeRockGeometry, makeSnowmanGeometry, makeWindmill } from '@/world/props';

/**
 * Decor — фасадные фабрики бокового декора (совместимость API scaffold).
 * Реализация — на общем world/props kit: мерджнутые vertex-color меши.
 * TrackBuilder использует инстансинг через world/WorldDecor; эти функции
 * остаются для одиночных размещений.
 */

function vertexMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
}

export function createDecorTree(rng: Rng): THREE.Object3D {
  const variant = rng.int(0, 2) as 0 | 1 | 2;
  const mesh = new THREE.Mesh(makePineGeometry(variant, rng), vertexMat());
  mesh.scale.setScalar(rng.range(0.75, 1.5));
  mesh.castShadow = true;
  return mesh;
}

export function createDecorRock(rng: Rng): THREE.Object3D {
  const mesh = new THREE.Mesh(makeRockGeometry(rng), vertexMat());
  mesh.castShadow = true;
  return mesh;
}

export function createDecorSnowman(): THREE.Object3D {
  const mesh = new THREE.Mesh(makeSnowmanGeometry(true), vertexMat());
  mesh.castShadow = true;
  return mesh;
}

export function createDecorWindmill(): THREE.Object3D {
  return makeWindmill(vertexMat(), vertexMat());
}
