import { createRng } from '@/utils/random';

/**
 * Ежедневные задания (gdd §5.5): 3 задания/день из пула, seeded по дате,
 * сброс в 00:00 локального времени. Чистая логика без побочек —
 * состояние (progress/claimed/seen) живёт в SaveData, оркестрация — MetaProgression.
 */

export interface TaskReward {
  coins?: number;
  crystals?: number;
  diamonds?: number;
  rockets?: number;
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

export type DailyTaskKey = 'coins' | 'distance' | 'finishes' | 'crystals' | 'jumps' | 'record';

interface TaskDef {
  key: DailyTaskKey;
  /** Цели по тиру сложности (tier = 0..2, выбирается по LEVEL игрока). */
  targets: readonly number[];
  reward: TaskReward;
  title: (target: number) => string;
}

/** Пул заданий — таблица gdd §5.5 (3-й тир экстраполирован для высоких уровней). */
export const DAILY_TASK_POOL: readonly TaskDef[] = [
  {
    key: 'coins',
    targets: [300, 600, 1200],
    reward: { coins: 150, crystals: 3 },
    title: (t) => `Собери ${t} монет за день`,
  },
  {
    key: 'distance',
    targets: [2000, 4000, 8000],
    reward: { coins: 200, crystals: 4 },
    title: (t) => `Проедь суммарно ${t} м`,
  },
  {
    key: 'finishes',
    targets: [1, 2, 3],
    reward: { coins: 250, crystals: 5, rockets: 1 },
    title: (t) => (t === 1 ? 'Финишируй заезд' : `Финишируй заезды: ${t} раза`),
  },
  {
    key: 'crystals',
    targets: [3, 6, 9],
    reward: { coins: 150, diamonds: 1 },
    title: (t) => `Подбери кристаллов: ${t} шт`,
  },
  {
    key: 'jumps',
    targets: [3, 6, 9],
    reward: { coins: 120, crystals: 3 },
    title: (t) => `Прыгни с трамплинов: ${t} раз`,
  },
  {
    key: 'record',
    targets: [1, 1, 1],
    reward: { coins: 300, crystals: 5 },
    title: () => 'Побей свой рекорд',
  },
] as const;

export const DAILY_TASKS_PER_DAY = 3;

/** Локальная дата YYYY-MM-DD — идентификатор «дня» для сброса в 00:00. */
export function todayId(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Секунды до локальной полуночи (таймер «ОБНОВЛЕНИЕ ЧЕРЕЗ …» в ui.md §3.7). */
export function secondsUntilMidnight(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  return Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

/** Тир сложности по уровню игрока: L1–4 → 0, L5–14 → 1, L15+ → 2. */
export function taskTier(playerLevel: number): number {
  if (playerLevel >= 15) return 2;
  if (playerLevel >= 5) return 1;
  return 0;
}

export interface GeneratedDay {
  keys: DailyTaskKey[];
  targets: number[];
}

/**
 * Детерминированная генерация набора дня: seeded RNG от dateId тасует пул,
 * берутся первые DAILY_TASKS_PER_DAY типов; цели — по тиру уровня игрока.
 */
export function generateDailyTasks(dateId: string, playerLevel: number): GeneratedDay {
  const rng = createRng(`daily:${dateId}`);
  const pool = [...DAILY_TASK_POOL];
  // Fisher–Yates на seeded RNG
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const tier = taskTier(playerLevel);
  const picked = pool.slice(0, DAILY_TASKS_PER_DAY);
  return {
    keys: picked.map((d) => d.key),
    targets: picked.map((d) => d.targets[tier]),
  };
}

/** Собрать публичный DailyTask из определения + состояния save. */
export function buildDailyTask(
  dateId: string,
  key: DailyTaskKey,
  target: number,
  progress: number,
  claimed: boolean,
): DailyTask {
  const def = DAILY_TASK_POOL.find((d) => d.key === key)!;
  return {
    id: `daily:${dateId}:${key}`,
    title: def.title(target),
    target,
    progress: Math.min(Math.floor(progress), target),
    reward: { ...def.reward },
    done: progress >= target,
    claimed,
  };
}
