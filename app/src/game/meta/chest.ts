import { createRng } from '@/utils/random';
import type { Rng } from '@/utils/random';
import type { TaskReward } from './dailyTasks';

/**
 * Сундук с таймером (gdd §5.6): бесплатный сундук каждые 15 минут,
 * 2 дропа за открытие из взвешенной таблицы (seeded RNG, никакого Math.random).
 * Таймер — timestamp readyAt в SaveData; оркестрация — MetaProgression.
 */

export const CHEST_INTERVAL_MS = 15 * 60_000;
/** Ускорение сундука (gdd §5.6, ui.md §3.8): сброс таймера за кристаллы. */
export const CHEST_SPEEDUP_COST_CRYSTALS = 10;
/** Дропов за одно открытие (gdd §5.6). */
export const CHEST_DROPS_PER_OPEN = 2;

type ChestDropKind = 'coins' | 'crystals' | 'rocket' | 'diamond';

interface ChestDropDef {
  kind: ChestDropKind;
  weight: number;
}

/** Таблица весов gdd §5.6 (нормализуются по сумме). */
const DROP_TABLE: readonly ChestDropDef[] = [
  { kind: 'coins', weight: 60 },
  { kind: 'crystals', weight: 30 },
  { kind: 'rocket', weight: 25 },
  { kind: 'diamond', weight: 8 },
] as const;

const TOTAL_WEIGHT = DROP_TABLE.reduce((s, d) => s + d.weight, 0);

function rollDropKind(rng: Rng): ChestDropKind {
  let roll = rng.next() * TOTAL_WEIGHT;
  for (const def of DROP_TABLE) {
    roll -= def.weight;
    if (roll < 0) return def.kind;
  }
  return DROP_TABLE[DROP_TABLE.length - 1].kind;
}

/**
 * Бросить дропы сундука. Детерминированно по seed (readyAt открываемого сундука).
 * Монеты: 150–400 · IncomeMult (округл. вниз); кристаллы 3–8; ракета ×1; алмаз ×1.
 */
export function rollChestReward(seed: number, incomeMult: number): TaskReward {
  const rng = createRng(`chest:${seed}`);
  const reward: TaskReward = {};
  for (let i = 0; i < CHEST_DROPS_PER_OPEN; i += 1) {
    switch (rollDropKind(rng)) {
      case 'coins':
        reward.coins = (reward.coins ?? 0) + Math.floor(rng.int(150, 400) * incomeMult);
        break;
      case 'crystals':
        reward.crystals = (reward.crystals ?? 0) + rng.int(3, 8);
        break;
      case 'rocket':
        reward.rockets = (reward.rockets ?? 0) + 1;
        break;
      case 'diamond':
        reward.diamonds = (reward.diamonds ?? 0) + 1;
        break;
    }
  }
  return reward;
}
