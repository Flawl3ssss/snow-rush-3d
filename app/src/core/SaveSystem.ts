import { SAVE_KEY, SAVE_VERSION } from '@/config';

/**
 * SaveSystem — localStorage `snowrush_save_v1`, версия схемы (gdd §6).
 * Структура SaveData — ФИНАЛЬНЫЙ контракт; meta-агент расширяет
 * (tasks, chest уже заложены как поля-заглушки).
 */

export interface SaveData {
  version: number;
  coins: number;
  crystals: number;
  diamonds: number;
  rockets: number;
  upgrades: { slingshot: number; sled: number; income: number };
  playerLevel: number;
  xp: number;
  best: number;
  /**
   * meta-агент: ежедневные задания (gdd §5.5).
   * keys/targets — сгенерированный набор дня (seeded по dateId, tier по уровню),
   * progress/claimed — индексованы параллельно keys; seen — экран заданий открыт (бейдж NEW).
   */
  tasks: {
    dateId: string;
    keys: string[];
    targets: number[];
    progress: number[];
    claimed: boolean[];
    seen: boolean;
  };
  /** meta-агент: сундук с таймером (timestamp ms) */
  chest: { readyAt: number };
  settings: { music: boolean; sfx: boolean; quality: 'low' | 'med' | 'high'; reducedMotion: boolean };
  stats: { lifetimeDistance: number; runs: number };
  /** экономика v2: выбранная карта и список открытых (id из MAPS) */
  currentMap: string;
  unlockedMaps: string[];
}

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    coins: 150,
    crystals: 0,
    diamonds: 3,
    rockets: 1,
    upgrades: { slingshot: 1, sled: 1, income: 1 },
    playerLevel: 1,
    xp: 0,
    best: 0,
    tasks: { dateId: '', keys: [], targets: [], progress: [], claimed: [], seen: false },
    chest: { readyAt: Date.now() + 15 * 60_000 },
    settings: { music: true, sfx: true, quality: 'high', reducedMotion: false },
    stats: { lifetimeDistance: 0, runs: 0 },
    currentMap: 'valley',
    unlockedMaps: ['valley'],
  };
}

/**
 * Пошаговая миграция старых схем к SAVE_VERSION.
 * v1 → v2: tasks расширен полями keys/targets/seen (прогресс v1 сбрасывается —
 * набор заданий дня перегенерируется seeded по дате). Неизвестные версии → null.
 */
function migrateSave(parsed: Partial<SaveData>): Partial<SaveData> | null {
  let cur = parsed;
  let v = typeof cur.version === 'number' ? cur.version : 0;
  if (v === 1) {
    cur = { ...cur, version: 2 };
    v = 2;
  }
  if (v === 2) {
    // v2 → v3: система карт (экономика v2) — все начинают с долины
    cur = { ...cur, version: 3, currentMap: 'valley', unlockedMaps: ['valley'] };
    v = 3;
  }
  return v === SAVE_VERSION ? cur : null;
}

export class SaveSystem {
  load(): SaveData {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return createDefaultSave();
      let parsed = JSON.parse(raw) as Partial<SaveData>;
      if (parsed.version !== SAVE_VERSION) {
        const migrated = migrateSave(parsed);
        if (!migrated) return createDefaultSave();
        parsed = migrated;
      }
      // merge поверх дефолта — устойчивость к частичным/старым полям
      const def = createDefaultSave();
      return {
        ...def,
        ...parsed,
        upgrades: { ...def.upgrades, ...parsed.upgrades },
        tasks: { ...def.tasks, ...parsed.tasks },
        chest: { ...def.chest, ...parsed.chest },
        settings: { ...def.settings, ...parsed.settings },
        stats: { ...def.stats, ...parsed.stats },
      };
    } catch {
      return createDefaultSave();
    }
  }

  save(data: SaveData): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* quota / private mode — молча */
    }
  }

  reset(): SaveData {
    const def = createDefaultSave();
    this.save(def);
    return def;
  }
}
