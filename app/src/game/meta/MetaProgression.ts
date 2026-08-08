import { CONTINUE, ECONOMY, MAPS, getMapDef } from '@/config';
import type { MapDef } from '@/config';
import type { SaveData } from '@/core/SaveSystem';
import { SaveSystem } from '@/core/SaveSystem';
import type { EventBus } from '@/utils/events';
import type { Economy } from './Economy';
import type { DailyTask, DailyTaskKey, TaskReward } from './dailyTasks';
import {
  DAILY_TASKS_PER_DAY,
  buildDailyTask,
  generateDailyTasks,
  secondsUntilMidnight,
  todayId,
} from './dailyTasks';
import { CHEST_INTERVAL_MS, CHEST_SPEEDUP_COST_CRYSTALS, rollChestReward } from './chest';
import type { ShopOffer } from './shop';
import { SHOP_OFFERS, getShopOffer } from './shop';

export type UpgradeLine = 'slingshot' | 'sled' | 'income';
export const UPGRADE_LINES: readonly UpgradeLine[] = ['slingshot', 'sled', 'income'] as const;

export type { DailyTask, TaskReward } from './dailyTasks';
export type { ShopOffer } from './shop';
export { SHOP_OFFERS } from './shop';
export { CHEST_SPEEDUP_COST_CRYSTALS } from './chest';

export interface ChestState {
  ready: boolean;
  secondsLeft: number;
}

/**
 * MetaProgression — ПУБЛИЧНЫЙ API мета-прогресса (уровни апгрейдов, XP, LEVEL, best,
 * ежедневные задания, сундук, ракеты, «второй шанс», магазин).
 * Формулы — gdd §5. Meta-агент расширяет ЭТОТ класс (задания, сундук, ракета),
 * не меняя существующие сигнатуры.
 *
 * Связка с шиной/экономикой: Economy при конструировании вызывает attach(bus, economy).
 * Без attach (headless-тесты) класс работает в деградированном режиме:
 * валюта мутирует напрямую в SaveData, события не эмитятся.
 */
export class MetaProgression {
  private readonly data: SaveData;
  private bus: EventBus | null = null;
  private economy: Economy | null = null;
  private readonly persistence = new SaveSystem();

  // --- «второй шанс» (рантайм-состояние заезда, не персистится) ---
  private continueUsedThisRun = false;
  private continueEligible = false;
  // --- сундук: readyAt, для которого уже эмитили chest_ready ---
  private chestReadyNotifiedFor = -1;

  constructor(data: SaveData) {
    this.data = data;
  }

  get save(): SaveData {
    return this.data;
  }

  /**
   * Подключение шины и экономики (вызывается из конструктора Economy).
   * Подписывает прогресс заданий на gameplay-события. Идемпотентно.
   */
  attach(bus: EventBus, economy: Economy): void {
    if (this.bus === bus && this.economy === economy) return;
    this.bus = bus;
    this.economy = economy;
    this.subscribeGameplay();
  }

  // ---------- апгрейды ----------
  getUpgradeLevel(line: UpgradeLine): number {
    return this.data.upgrades[line];
  }

  getUpgradeCost(line: UpgradeLine): number {
    return ECONOMY.upgradeCost(line, this.getUpgradeLevel(line));
  }

  isMaxLevel(line: UpgradeLine): boolean {
    return this.getUpgradeLevel(line) >= ECONOMY.maxUpgradeLevel;
  }

  /** Точка покупки вызывается через Economy.buyUpgrade (проверка средств + списание). */
  applyUpgrade(line: UpgradeLine): void {
    this.data.upgrades[line] = Math.min(ECONOMY.maxUpgradeLevel, this.data.upgrades[line] + 1);
  }

  /** Отображаемые статы карточек (gdd §5.2) */
  getUpgradeStat(line: UpgradeLine): string {
    const l = this.getUpgradeLevel(line);
    switch (line) {
      case 'slingshot':
        return `СТАРТ +${Math.round(3.5 * (l - 1))}%`;
      case 'sled': {
        const muDrop = Math.round(((0.085 - Math.max(0.02, 0.085 - 0.0022 * (l - 1))) / 0.085) * 100);
        const steer = Math.round((0.25 * (l - 1) / 14) * 100);
        return `ТРЕНИЕ −${muDrop}% · РУЛЕНИЕ +${steer}%`;
      }
      case 'income':
        return `×${ECONOMY.incomeMult(l).toFixed(1).replace('.', ',')} МОНЕТ`;
    }
  }

  // ---------- производные статы ----------
  get incomeMult(): number {
    return ECONOMY.incomeMult(this.data.upgrades.income);
  }

  get finishDistance(): number {
    return ECONOMY.finishDistance(this.data.playerLevel);
  }

  // ---------- XP / LEVEL ----------
  get playerLevel(): number {
    return this.data.playerLevel;
  }

  get xp(): number {
    return this.data.xp;
  }

  get xpNeed(): number {
    return ECONOMY.xpNeed(this.data.playerLevel);
  }

  get xpProgress(): number {
    return Math.min(1, this.data.xp / this.xpNeed);
  }

  /**
   * Начисляет XP, возвращает список достигнутых уровней (может быть несколько).
   * Награды за LEVEL UP начисляет Economy.grantLevelUp на каждый уровень.
   */
  addXp(amount: number): number[] {
    this.data.xp += Math.max(0, Math.round(amount));
    const ups: number[] = [];
    while (this.data.xp >= ECONOMY.xpNeed(this.data.playerLevel)) {
      this.data.xp -= ECONOMY.xpNeed(this.data.playerLevel);
      this.data.playerLevel += 1;
      ups.push(this.data.playerLevel);
    }
    return ups;
  }

  // ---------- best ----------
  get best(): number {
    return this.data.best;
  }

  /** Возвращает true при новом рекорде. */
  recordDistance(d: number): boolean {
    if (d > this.data.best) {
      this.data.best = Math.floor(d);
      return true;
    }
    return false;
  }

  // ---------- статистика ----------
  addRunStats(distance: number): void {
    this.data.stats.runs += 1;
    this.data.stats.lifetimeDistance += Math.floor(distance);
  }

  // ================= ежедневные задания (gdd §5.5) =================

  /** Подписка прогресса заданий и «второго шанса» на gameplay-события шины. */
  private subscribeGameplay(): void {
    const bus = this.bus!;
    bus.on('run_started', () => {
      this.continueUsedThisRun = false;
      this.continueEligible = false;
    });
    bus.on('coin_collected', () => this.addTaskProgress('coins', 1));
    bus.on('crystal_collected', () => this.addTaskProgress('crystals', 1));
    bus.on('jump', () => this.addTaskProgress('jumps', 1));
    bus.on('new_best', () => this.addTaskProgress('record', 1));
    bus.on('crash', (p) => {
      // crash.z — дистанция крэша по трассе (RunSession эмитит s)
      if (p.z > CONTINUE.minDistance) this.continueEligible = true;
    });
    bus.on('run_finished', (r) => {
      this.addTaskProgress('distance', Math.floor(r.distance));
      if (r.finished) this.addTaskProgress('finishes', 1);
      if (r.crashed && r.distance > CONTINUE.minDistance && !this.continueUsedThisRun) {
        this.continueEligible = true;
      }
    });
  }

  /**
   * Гарантирует актуальность набора заданий: при смене локальной даты
   * перегенерирует 3 задания (seeded от dateId, тир по уровню) и сбрасывает
   * прогресс/claimed/seen. Сброс в 00:00 локального времени.
   */
  private ensureDailyTasks(): void {
    const today = todayId();
    const t = this.data.tasks;
    if (t.dateId === today && t.keys.length === DAILY_TASKS_PER_DAY) return;
    const gen = generateDailyTasks(today, this.data.playerLevel);
    this.data.tasks = {
      dateId: today,
      keys: gen.keys,
      targets: gen.targets,
      progress: gen.keys.map(() => 0),
      claimed: gen.keys.map(() => false),
      seen: false,
    };
    this.persist();
  }

  /** 3 задания текущего дня с прогрессом и наградами. */
  getDailyTasks(): DailyTask[] {
    this.ensureDailyTasks();
    const t = this.data.tasks;
    return t.keys.map((key, i) =>
      buildDailyTask(t.dateId, key as DailyTaskKey, t.targets[i], t.progress[i], t.claimed[i]),
    );
  }

  private addTaskProgress(key: DailyTaskKey, amount: number): void {
    this.ensureDailyTasks();
    const t = this.data.tasks;
    const idx = t.keys.indexOf(key);
    if (idx < 0 || t.claimed[idx]) return;
    const target = t.targets[idx];
    if (t.progress[idx] >= target) return;
    t.progress[idx] = Math.min(target, t.progress[idx] + amount);
    if (t.progress[idx] >= target) {
      const task = this.getDailyTasks()[idx];
      this.bus?.emit('task_completed', { task });
      this.persist();
    }
  }

  /**
   * Забрать награду выполненного задания (кнопка «ЗАБРАТЬ», ui.md §3.7).
   * Начисляет валюту, эмитит task_claimed. true — награда выдана.
   */
  claimTaskReward(id: string): boolean {
    const tasks = this.getDailyTasks();
    const idx = tasks.findIndex((task) => task.id === id);
    if (idx < 0) return false;
    const task = tasks[idx];
    if (!task.done || task.claimed) return false;
    this.grantReward(task.reward);
    this.data.tasks.claimed[idx] = true;
    const claimedTask = this.getDailyTasks()[idx];
    this.bus?.emit('task_claimed', { task: claimedTask });
    this.persist();
    return true;
  }

  /** Бейдж NEW на кнопке заданий: не просмотрены сегодня или есть невзятые награды. */
  hasTasksBadge(): boolean {
    const tasks = this.getDailyTasks();
    return !this.data.tasks.seen || tasks.some((t) => t.done && !t.claimed);
  }

  /** UI открыл экран заданий — снять «не просмотрено». */
  markTasksSeen(): void {
    this.ensureDailyTasks();
    if (!this.data.tasks.seen) {
      this.data.tasks.seen = true;
      this.persist();
    }
  }

  /** Секунды до сброса заданий (00:00 локального времени) — таймер в ui.md §3.7. */
  getTasksResetSeconds(): number {
    return secondsUntilMidnight();
  }

  // ================= сундук с таймером (gdd §5.6) =================

  /**
   * Состояние сундука. Побочный эффект: при первом обнаружении готовности
   * эмитит chest_ready (UI опрашивает каждую секунду для таймера mm:ss).
   */
  getChestState(): ChestState {
    const now = Date.now();
    const readyAt = this.data.chest.readyAt;
    const ready = now >= readyAt;
    if (ready && this.chestReadyNotifiedFor !== readyAt) {
      this.chestReadyNotifiedFor = readyAt;
      this.bus?.emit('chest_ready', {});
    }
    return { ready, secondsLeft: ready ? 0 : Math.ceil((readyAt - now) / 1000) };
  }

  /**
   * Открыть готовый сундук: 2 дропа по взвешенной таблице (seeded от readyAt),
   * награда начисляется сразу, таймер перезапускается на 15 мин. null — не готов.
   */
  openChest(): TaskReward | null {
    if (!this.getChestState().ready) return null;
    const openedReadyAt = this.data.chest.readyAt;
    const reward = rollChestReward(openedReadyAt, this.incomeMult);
    this.grantReward(reward);
    this.data.chest.readyAt = Date.now() + CHEST_INTERVAL_MS;
    this.bus?.emit('chest_opened', { reward });
    this.persist();
    return reward;
  }

  /** Ускорение сундука за кристаллы (gdd §5.6, ui.md §3.8): сброс таймера. */
  speedUpChest(): boolean {
    if (this.getChestState().ready) return false;
    if (!this.spendCurrency('crystals', CHEST_SPEEDUP_COST_CRYSTALS)) return false;
    this.data.chest.readyAt = Date.now();
    this.persist();
    this.getChestState(); // эмитит chest_ready
    return true;
  }

  // ================= ракеты (gdd §4.4) =================

  getRockets(): number {
    return this.data.rockets;
  }

  /** Покупка ракеты за 2 алмаза (BOOST.rocketPriceDiamonds). Эмитит rocket_purchased. */
  buyRocket(): boolean {
    if (!this.spendCurrency('diamonds', 2)) return false;
    this.grantReward({ rockets: 1 });
    this.bus?.emit('rocket_purchased', { rockets: this.data.rockets });
    this.persist();
    return true;
  }

  // ================= «второй шанс» (gdd §5.7) =================

  /**
   * Доступен ли CONTINUE после крэша: 1 раз за заезд, крэш на дистанции
   * > CONTINUE.minDistance (150 м). Оплату проверяет spendContinue.
   */
  canContinue(): boolean {
    return this.continueEligible && !this.continueUsedThisRun;
  }

  getContinueCost(): number {
    return CONTINUE.costCrystals; // 5 кристаллов
  }

  /**
   * Оплатить «второй шанс» (5 кристаллов): списывает валюту, эмитит continue_used
   * (ядро/UI подхватывают респавн по gdd §5.7). true — оплата прошла.
   */
  spendContinue(): boolean {
    if (!this.canContinue()) return false;
    if (!this.spendCurrency('crystals', CONTINUE.costCrystals)) return false;
    this.continueUsedThisRun = true;
    this.continueEligible = false;
    this.bus?.emit('continue_used', {});
    this.persist();
    return true;
  }

  // ================= магазин (ui.md §3.6, mock-покупки без реальных платежей) =================

  getShopOffers(): ShopOffer[] {
    return [...SHOP_OFFERS];
  }

  /** Доступность набора: хватает валюты; ускорение сундука — только когда таймер идёт. */
  canBuyOffer(id: string): boolean {
    const offer = getShopOffer(id);
    if (!offer) return false;
    if (offer.kind === 'chest_speedup' && this.getChestState().ready) return false;
    return this.balanceOf(offer.costCurrency) >= offer.cost;
  }

  /**
   * Mock-покупка набора: списывает цену, выдаёт товар, эмитит purchase_made
   * (mock: true — реальных платежей нет; UI показывает тост/count-down баланса).
   * Для ракет дополнительно эмитит rocket_purchased.
   */
  buyShopOffer(id: string): boolean {
    const offer = getShopOffer(id);
    if (!offer) return false;
    if (offer.kind === 'chest_speedup') {
      if (!this.speedUpChest()) return false;
    } else {
      if (!this.spendCurrency(offer.costCurrency, offer.cost)) return false;
      if (offer.kind === 'rockets') {
        this.grantReward({ rockets: offer.amount });
        this.bus?.emit('rocket_purchased', { rockets: this.data.rockets });
      } else if (offer.kind === 'diamonds') {
        this.grantReward({ diamonds: offer.amount });
      }
      this.persist();
    }
    this.bus?.emit('purchase_made', {
      offerId: offer.id,
      kind: offer.kind,
      amount: offer.amount,
      cost: offer.cost,
      costCurrency: offer.costCurrency,
      mock: true,
    });
    return true;
  }

  // ================= карты / миры (экономика v2, docs/ECONOMY.md §4) =================

  get currentMap(): MapDef {
    return getMapDef(this.data.currentMap);
  }

  getAllMaps(): readonly MapDef[] {
    return MAPS;
  }

  isMapUnlocked(id: string): boolean {
    return this.data.unlockedMaps.includes(id);
  }

  /** Состояние открытия карты для UI-селектора. */
  getMapUnlockState(id: string): {
    unlocked: boolean;
    canUnlock: boolean;
    needLevel: number;
    needCrystals: number;
    isCurrent: boolean;
  } {
    const def = getMapDef(id);
    const unlocked = this.isMapUnlocked(id);
    return {
      unlocked,
      canUnlock:
        !unlocked &&
        this.data.playerLevel >= def.unlockLevel &&
        this.data.crystals >= def.unlockCrystals,
      needLevel: def.unlockLevel,
      needCrystals: def.unlockCrystals,
      isCurrent: this.data.currentMap === def.id,
    };
  }

  /**
   * Открыть карту за кристаллы (sink). Условие: уровень игрока ≥ unlockLevel.
   * Эмитит map_unlocked. true — карта открыта и выбрана текущей.
   */
  unlockMap(id: string): boolean {
    const st = this.getMapUnlockState(id);
    if (st.unlocked || !st.canUnlock) return false;
    const def = getMapDef(id);
    if (!this.spendCurrency('crystals', def.unlockCrystals)) return false;
    this.data.unlockedMaps.push(id);
    this.data.currentMap = id;
    this.bus?.emit('map_unlocked', { id });
    this.bus?.emit('map_changed', { id });
    this.persist();
    return true;
  }

  /** Выбрать уже открытую карту. Эмитит map_changed (Game пересобирает мир). */
  selectMap(id: string): boolean {
    if (!this.isMapUnlocked(id) || this.data.currentMap === id) return false;
    this.data.currentMap = id;
    this.bus?.emit('map_changed', { id });
    this.persist();
    return true;
  }

  // ================= внутренние помощники =================

  private balanceOf(currency: 'coins' | 'crystals' | 'diamonds'): number {
    return this.data[currency];
  }

  /** Списание валюты (через Economy, если подключена — эмитит currency_changed). */
  private spendCurrency(currency: 'crystals' | 'diamonds', amount: number): boolean {
    if (this.economy) {
      return currency === 'crystals'
        ? this.economy.spendCrystals(amount)
        : this.economy.spendDiamonds(amount);
    }
    if (this.data[currency] < amount) return false;
    this.data[currency] -= amount;
    return true;
  }

  /** Начисление награды (через Economy, если подключена — эмитит currency_changed). */
  private grantReward(reward: TaskReward): void {
    if (this.economy) {
      if (reward.coins) this.economy.addCoins(reward.coins);
      if (reward.crystals) this.economy.addCrystals(reward.crystals);
      if (reward.diamonds) this.economy.addDiamonds(reward.diamonds);
      if (reward.rockets) this.economy.addRockets(reward.rockets);
      return;
    }
    this.data.coins += Math.floor(reward.coins ?? 0);
    this.data.crystals += Math.floor(reward.crystals ?? 0);
    this.data.diamonds += Math.floor(reward.diamonds ?? 0);
    this.data.rockets += Math.floor(reward.rockets ?? 0);
  }

  /** Автосохранение после мета-мутаций вне точек ядра (gdd §6: задание, сундук, покупка). */
  private persist(): void {
    this.persistence.save(this.data);
  }
}
