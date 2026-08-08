import { ECONOMY } from '@/config';
import type { SaveData } from '@/core/SaveSystem';
import type { EventBus } from '@/utils/events';
import type { UpgradeLine } from './MetaProgression';
import { MetaProgression } from './MetaProgression';

/**
 * Economy — ПУБЛИЧНЫЙ API валют и покупок. Meta-агент расширяет
 * (сундук, задания, магазин ракет) новыми методами здесь, не ломая существующие.
 */
export class Economy {
  private readonly data: SaveData;
  private readonly meta: MetaProgression;
  private readonly bus: EventBus;

  constructor(data: SaveData, meta: MetaProgression, bus: EventBus) {
    this.data = data;
    this.meta = meta;
    this.bus = bus;
    // Связка меты с шиной/экономикой (задания, сундук, магазин, continue).
    meta.attach(bus, this);
  }

  get coins(): number {
    return this.data.coins;
  }
  get crystals(): number {
    return this.data.crystals;
  }
  get diamonds(): number {
    return this.data.diamonds;
  }
  get rockets(): number {
    return this.data.rockets;
  }

  private emitChanged(): void {
    this.bus.emit('currency_changed', {
      coins: this.data.coins,
      crystals: this.data.crystals,
      diamonds: this.data.diamonds,
      rockets: this.data.rockets,
    });
  }

  addCoins(n: number): void {
    this.data.coins = Math.max(0, this.data.coins + Math.floor(n));
    this.emitChanged();
  }

  addCrystals(n: number): void {
    this.data.crystals = Math.max(0, this.data.crystals + Math.floor(n));
    this.emitChanged();
  }

  addDiamonds(n: number): void {
    this.data.diamonds = Math.max(0, this.data.diamonds + Math.floor(n));
    this.emitChanged();
  }

  addRockets(n: number): void {
    this.data.rockets = Math.max(0, this.data.rockets + Math.floor(n));
    this.emitChanged();
  }

  spendCrystals(n: number): boolean {
    if (this.data.crystals < n) return false;
    this.data.crystals -= n;
    this.emitChanged();
    return true;
  }

  spendDiamonds(n: number): boolean {
    if (this.data.diamonds < n) return false;
    this.data.diamonds -= n;
    this.emitChanged();
    return true;
  }

  useRocket(): boolean {
    if (this.data.rockets <= 0) return false;
    this.data.rockets -= 1;
    this.emitChanged();
    this.bus.emit('rocket_used', { rocketsLeft: this.data.rockets });
    return true;
  }

  /** Покупка апгрейда (gdd §5.2). Эмитит upgrade_purchased / upgrade_failed. */
  buyUpgrade(line: UpgradeLine): boolean {
    if (this.meta.isMaxLevel(line)) return false;
    const cost = this.meta.getUpgradeCost(line);
    if (this.data.coins < cost) {
      this.bus.emit('upgrade_failed', { line });
      return false;
    }
    this.data.coins -= cost;
    this.meta.applyUpgrade(line);
    this.emitChanged();
    this.bus.emit('upgrade_purchased', { line, level: this.meta.getUpgradeLevel(line), cost });
    return true;
  }

  /** Награда LEVEL UP (gdd §5.3): монеты 300·N, кристаллы 2·ceil(N/3), каждые 5 ур. +1◆ +1 ракета. */
  grantLevelUp(level: number): void {
    const coins = ECONOMY.levelUpCoins(level);
    const crystals = ECONOMY.levelUpCrystals(level);
    const diamonds = level % 5 === 0 ? 1 : 0;
    const rockets = level % 5 === 0 ? 1 : 0;
    this.data.coins += coins;
    this.data.crystals += crystals;
    this.data.diamonds += diamonds;
    this.data.rockets += rockets;
    this.emitChanged();
    this.bus.emit('level_up', { level, coins, crystals, diamonds, rockets });
  }

  // Задания (§5.5), сундук (§5.6), ракеты, «второй шанс» (§5.7) и магазин
  // (ui.md §3.6) реализованы в MetaProgression (см. attach + dailyTasks/chest/shop).
}

export { MetaProgression };
