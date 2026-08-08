/**
 * meta-bridge — ЗАЩИТНЫЙ адаптер к API мета-систем, которые реализуются
 * параллельно другим агентом (ежедневные задания, сундук, ракеты, «второй шанс»).
 *
 * Каждый вызов идёт через `?.()` с fallback-значением, поэтому UI собирается
 * и работает до мержа meta-ветки; после мержа автоматически используются
 * настоящие реализации. Контракт — см. задание ui-screens / ui.md §3.5–3.8.
 *
 * Мета-события (`task_completed`, `chest_ready`, `chest_opened`,
 * `rocket_purchased`, `continue_used`) эмитятся/слушаются защитно через
 * шину: типизированный GameEvents их пока не знает, поэтому — loose-каст.
 */

import type { Game } from '@/game/Game';
import type { EventBus } from '@/utils/events';
import { CONTINUE } from '@/config';
import { createSeededRandom } from '@/utils/random';

export interface TaskReward {
  coins?: number;
  crystals?: number;
  diamonds?: number;
}

export interface DailyTask {
  id: string;
  title: string;
  target: number;
  progress: number;
  reward: TaskReward;
  done: boolean;
  claimed: boolean;
}

export interface ChestState {
  ready: boolean;
  secondsLeft: number;
}

/** Необязательные методы, которые meta-агент добавит на MetaProgression. */
interface MetaApiExtension {
  getDailyTasks?: () => DailyTask[];
  claimTaskReward?: (id: string) => boolean;
  getChestState?: () => ChestState;
  openChest?: () => TaskReward | null;
  getRockets?: () => number;
  buyRocket?: () => boolean;
  canContinue?: () => boolean;
  getContinueCost?: () => number;
  spendContinue?: () => boolean;
  /** возможное расширение: ускорение сундука за кристаллы */
  speedUpChest?: () => boolean;
}

type LooseBus = {
  on?: (event: string, handler: (payload: unknown) => void) => unknown;
  emit?: (event: string, payload?: unknown) => void;
};

function api(game: Game): MetaApiExtension {
  return game.meta as unknown as MetaApiExtension;
}

function persist(game: Game): void {
  game.save.save(game.meta.save);
}

/** Защитная подписка на мета-событие шины (нет в типизированном GameEvents). */
export function onMetaEvent(bus: EventBus, event: string, handler: (payload: unknown) => void): void {
  (bus as unknown as LooseBus).on?.(event, handler);
}

/** Защитная эмиссия мета-события шины. */
export function emitMetaEvent(bus: EventBus, event: string, payload?: unknown): void {
  (bus as unknown as LooseBus).emit?.(event, payload);
}

// ================= Ежедневные задания (ui.md §3.7) =================

export function getDailyTasks(game: Game): DailyTask[] {
  const fn = api(game).getDailyTasks;
  if (typeof fn === 'function') {
    try {
      return fn.call(game.meta) ?? [];
    } catch {
      return [];
    }
  }
  return []; // fallback: пустое состояние до мержа meta-ветки
}

export function claimTaskReward(game: Game, task: DailyTask): boolean {
  const fn = api(game).claimTaskReward;
  if (typeof fn === 'function') {
    try {
      const ok = fn.call(game.meta, task.id);
      if (ok) persist(game);
      return ok;
    } catch {
      return false;
    }
  }
  // fallback: начисляем награду напрямую через Economy (claimed не персистится до мержа)
  grantReward(game, task.reward);
  persist(game);
  return true;
}

/** Есть ли невыполненные/незабранные активные задания (бейдж NEW на кнопке). */
export function hasActiveTasks(game: Game): boolean {
  const tasks = getDailyTasks(game);
  return tasks.some((t) => !t.claimed);
}

// ================= Сундук (ui.md §3.8) =================

export function getChestState(game: Game): ChestState {
  const fn = api(game).getChestState;
  if (typeof fn === 'function') {
    try {
      return fn.call(game.meta);
    } catch {
      /* fallback ниже */
    }
  }
  // fallback: таймер из SaveData.chest.readyAt (поле уже в схеме)
  const left = Math.max(0, game.meta.save.chest.readyAt - Date.now());
  return { ready: left <= 0, secondsLeft: Math.ceil(left / 1000) };
}

export function openChest(game: Game): TaskReward | null {
  const fn = api(game).openChest;
  if (typeof fn === 'function') {
    try {
      const reward = fn.call(game.meta);
      if (reward) persist(game);
      return reward;
    } catch {
      return null;
    }
  }
  // fallback: локальный дроп (seeded RNG, Math.random запрещён) + перезапуск таймера
  const state = getChestState(game);
  if (!state.ready) return null;
  const rng = createSeededRandom(`chest:${Date.now()}`);
  const reward: TaskReward = { coins: 60 + Math.floor(rng() * 120) };
  if (rng() < 0.5) reward.crystals = 1 + Math.floor(rng() * 3);
  grantReward(game, reward);
  game.meta.save.chest.readyAt = Date.now() + 15 * 60_000;
  persist(game);
  return reward;
}

/** Ускорение сундука за кристаллы (магазин/модалка сундука). Цена — 10 кр. */
export const CHEST_SPEEDUP_COST = 10;

export function speedUpChest(game: Game): boolean {
  const fn = api(game).speedUpChest;
  if (typeof fn === 'function') {
    try {
      const ok = fn.call(game.meta);
      if (ok) persist(game);
      return ok;
    } catch {
      return false;
    }
  }
  // fallback: списать кристаллы и обнулить таймер напрямую в SaveData
  if (getChestState(game).ready) return false;
  if (!game.economy.spendCrystals(CHEST_SPEEDUP_COST)) return false;
  game.meta.save.chest.readyAt = Date.now();
  persist(game);
  return true;
}

// ================= Ракеты (ui.md §3.2/§3.6) =================

export function getRockets(game: Game): number {
  const fn = api(game).getRockets;
  if (typeof fn === 'function') {
    try {
      return fn.call(game.meta);
    } catch {
      /* fallback ниже */
    }
  }
  return game.economy.rockets;
}

/** Покупка ракеты за 2◆ (контракт). */
export function buyRocket(game: Game): boolean {
  const fn = api(game).buyRocket;
  let ok: boolean;
  if (typeof fn === 'function') {
    try {
      ok = fn.call(game.meta);
    } catch {
      ok = false;
    }
  } else {
    // fallback через публичный Economy API
    ok = game.economy.spendDiamonds(2);
    if (ok) game.economy.addRockets(1);
  }
  if (ok) {
    emitMetaEvent(game.bus, 'rocket_purchased', { rockets: getRockets(game) });
    persist(game);
  }
  return ok;
}

/** Набор ×5 ракет за 8◆ (скидка −20%, ui.md §3.6). */
export function buyRocketPack(game: Game): boolean {
  const ok = game.economy.spendDiamonds(8);
  if (!ok) return false;
  game.economy.addRockets(5);
  emitMetaEvent(game.bus, 'rocket_purchased', { rockets: getRockets(game), pack: 5 });
  persist(game);
  return true;
}

// ================= «Второй шанс» / CONTINUE (ui.md §3.5, gdd §5.7) =================

/** Локальный флаг «1 раз за заезд» для fallback-режима (до мержа meta-ветки). */
let continueUsedThisRun = false;

/** Сброс на старте заезда — вызывается ScreenManager по событию run_started. */
export function resetContinueForRun(): void {
  continueUsedThisRun = false;
}

export function canContinue(game: Game): boolean {
  const fn = api(game).canContinue;
  if (typeof fn === 'function') {
    try {
      return fn.call(game.meta);
    } catch {
      return false;
    }
  }
  // fallback: crash, дистанция ≥ порога, ещё не использован в этом заезде
  const r = game.currentResults;
  return !!r && r.crashed && !continueUsedThisRun && r.distance >= CONTINUE.minDistance;
}

/** Стоимость продолжения (контракт: монеты). */
export function getContinueCost(game: Game): number {
  const fn = api(game).getContinueCost;
  if (typeof fn === 'function') {
    try {
      return fn.call(game.meta);
    } catch {
      /* fallback ниже */
    }
  }
  return 500; // fallback до мержа meta-ветки
}

export function spendContinue(game: Game): boolean {
  const fn = api(game).spendContinue;
  let ok: boolean;
  if (typeof fn === 'function') {
    try {
      ok = fn.call(game.meta);
    } catch {
      ok = false;
    }
  } else {
    // fallback: списать монеты через Economy (респавн проводит Game после мержа)
    ok = game.economy.coins >= getContinueCost(game);
    if (ok) game.economy.addCoins(-getContinueCost(game));
    if (ok) continueUsedThisRun = true;
  }
  if (ok) {
    emitMetaEvent(game.bus, 'continue_used', {});
    persist(game);
  }
  return ok;
}

/**
 * Попытка возобновить заезд после CONTINUE. Game получит настоящий респавн
 * при интеграции meta-ветки (метод continueRun); до этого — fallback на
 * новый заезд (AIM), чтобы модалка не оставляла игру в тупике.
 */
export function resumeAfterContinue(game: Game): void {
  const g = game as unknown as { continueRun?: () => boolean | void };
  try {
    const resumed = g.continueRun?.();
    if (resumed) return;
  } catch {
    /* fallback ниже */
  }
  game.toAim();
}

// ================= утилиты =================

function grantReward(game: Game, reward: TaskReward): void {
  if (reward.coins) game.economy.addCoins(reward.coins);
  if (reward.crystals) game.economy.addCrystals(reward.crystals);
  if (reward.diamonds) game.economy.addDiamonds(reward.diamonds);
}

/** Формат таймера MM:SS (фиксированная ширина, ui.md §1.4). */
export function formatTimer(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Формат HH:MM:SS (таймер обновления заданий). */
export function formatTimerHms(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Секунды до следующей полуночи (ротация ежедневных заданий). */
export function secondsToMidnight(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  return Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
}
