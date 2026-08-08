import * as THREE from 'three';
import { CAMERA } from '@/config';

/** Детерминированный value-noise в [−1, 1] (game-feel reference). */
function pseudoNoise(t: number, seed: number): number {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * ShakeRig — trauma-based screenshake (game-feel): shake = trauma²,
 * decay 1.4/с, MAX_OFFSET 0.35 м, MAX_ROLL 0.06 рад (gdd §4.5).
 * Вызывать ПОСЛЕ CameraRig, реальным delta.
 */
export class ShakeRig {
  private trauma = 0;
  private time = 0;
  /** reduced motion: тряска ÷4 (design.md §6.3) */
  scale = 1;

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount * this.scale);
  }

  get level(): number {
    return this.trauma;
  }

  update(delta: number, camera: THREE.PerspectiveCamera): void {
    this.time += delta;
    this.trauma = Math.max(0, this.trauma - CAMERA.shake.decay * delta);
    if (this.trauma <= 0) return;
    const shake = this.trauma * this.trauma;
    const freq = this.time * 32;
    camera.position.x += CAMERA.shake.maxOffset * shake * pseudoNoise(freq, 1);
    camera.position.y += CAMERA.shake.maxOffset * shake * pseudoNoise(freq, 2);
    camera.rotation.z += CAMERA.shake.maxRoll * shake * pseudoNoise(freq, 3);
  }

  reset(): void {
    this.trauma = 0;
  }
}
