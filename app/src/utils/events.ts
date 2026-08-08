/**
 * EventBus — типизированная шина событий. ПУБЛИЧНЫЙ КОНТРАКТ для всех агентов:
 * HUD, AudioSystem и мета подписываются на события, геймплей только эмитит.
 * Не менять сигнатуры без согласования (docs/ARCHITECTURE.md).
 */

import type { GameState } from '@/game/Game';
import type { UpgradeLine } from '@/game/meta/MetaProgression';
import type { DailyTask, TaskReward } from '@/game/meta/dailyTasks';
import type { ShopOfferKind } from '@/game/meta/shop';

export interface RunResults {
  distance: number;
  best: number;
  isNewBest: boolean;
  finished: boolean;
  crashed: boolean;
  crashFree: boolean;
  coinsCollected: number;
  crystalsCollected: number;
  diamondsCollected: number;
  coinsEarned: number; // пикапы + бонус дистанции + финиш-бонус
  crystalsEarned: number;
  diamondsEarned: number;
  xpEarned: number;
  levelUps: number[]; // достигнутые уровни по порядку
}

export interface GameEvents {
  state_changed: { from: GameState; to: GameState };
  run_started: { seed: number; finishDistance: number };
  run_finished: RunResults;
  pull_changed: { power: number }; // 0..1
  launched: { power: number; speed: number };
  coin_collected: { runTotal: number; x: number; y: number; z: number };
  crystal_collected: { runTotal: number };
  diamond_collected: { runTotal: number };
  new_best: { distance: number };
  /** Промах мимо препятствия впритык (near-miss) — бонус за риск (промт §4/§10). */
  near_miss: { x: number; z: number };
  collision: { kind: 'light' | 'wall' | 'boostpad'; x: number; z: number };
  crash: { x: number; z: number; obstacleType: string };
  finish: { distance: number };
  jump: {};
  land: {};
  boost_started: { rocketsLeft: number };
  boost_ended: {};
  upgrade_purchased: { line: UpgradeLine; level: number; cost: number };
  upgrade_failed: { line: UpgradeLine };
  currency_changed: { coins: number; crystals: number; diamonds: number; rockets: number };
  level_up: { level: number; coins: number; crystals: number; diamonds: number; rockets: number };
  settings_changed: { music: boolean; sfx: boolean; reducedMotion: boolean; quality: string };
  // --- meta-systems (gdd §5.5–5.7, ui.md §3.6–3.8) ---
  /** Задание выполнено (прогресс достиг цели) — баннер «DAILY TASK COMPLETED!». */
  task_completed: { task: DailyTask };
  /** Награда задания забрана (кнопка «ЗАБРАТЬ», валюта начислена). */
  task_claimed: { task: DailyTask };
  /** Сундук стал готов (таймер 15 мин истёк) — анимация покачивания. */
  chest_ready: {};
  /** Сундук открыт, награда начислена. */
  chest_opened: { reward: TaskReward };
  /** Ракета куплена (buyRocket / набор магазина). */
  rocket_purchased: { rockets: number };
  /** Ракета израсходована (буст активирован в заезде). */
  rocket_used: { rocketsLeft: number };
  /** Игрок оплатил «второй шанс» после крэша (ядро/UI подхватывают продолжение). */
  continue_used: {};
  /** Карта открыта за кристаллы (экономика v2). */
  map_unlocked: { id: string };
  /** Текущая карта изменилась (выбор в меню или открытие) — Game пересобирает мир. */
  map_changed: { id: string };
  /** Mock-покупка в магазине совершена (без реальных платежей) — тост/count-down анимация. */
  purchase_made: {
    offerId: string;
    kind: ShopOfferKind;
    amount: number;
    cost: number;
    costCurrency: 'diamonds' | 'crystals';
    mock: true;
  };
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

export class EventBus {
  private readonly handlers = new Map<keyof GameEvents, Set<Handler<keyof GameEvents>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<keyof GameEvents>);
    return () => this.off(event, handler);
  }

  off<K extends keyof GameEvents>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as Handler<keyof GameEvents>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of [...set]) (h as Handler<K>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
