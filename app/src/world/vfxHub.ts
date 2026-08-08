import type * as THREE from 'three';

/**
 * vfxHub — лёгкая точка связи между сущностями (entities/*) и VFX-системой
 * (systems/ParticleSystem.ts). game/* и EventBus не трогаем (контракты
 * scaffold), поэтому визуальные события мира идут через этот мини-bus:
 * сущности эмитят из методов, которые уже вызывает игровой цикл
 * (Pickup.playPop, PlayerTube.squash/startTumble), ParticleSystem подписывается.
 * Геймплейной логики здесь нет — только визуальный фидбек.
 */
export type VfxEventType =
  | 'pickup_coin' // монета: маленький золотой блеск
  | 'pickup_gem' // кристалл/алмаз: звёздная вспышка + кольцо (design §6.1)
  | 'land' // приземление: снежный всплеск + кольцо
  | 'hit' // лёгкий удар: брызги снега
  | 'crash' // крэш: большой снежный взрыв
  | 'launch'; // выстрел рогатки: лёгкая позёмка

export interface VfxEvent {
  type: VfxEventType;
  /** Мировая позиция события (копия, можно переиспользовать). */
  position: THREE.Vector3;
  /** Сила события 0..1+ (крэш ∝ скорости удара); необязательно. */
  strength?: number;
}

type VfxListener = (e: VfxEvent) => void;

const listeners = new Set<VfxListener>();

export const vfxHub = {
  emit(e: VfxEvent): void {
    for (const l of [...listeners]) l(e);
  },
  on(listener: VfxListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
