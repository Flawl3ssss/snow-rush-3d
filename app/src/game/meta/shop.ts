import { BOOST } from '@/config';
import { CHEST_SPEEDUP_COST_CRYSTALS } from './chest';

/**
 * Магазин (ui.md §3.6, gdd §5.1): внутриигровые наборы БЕЗ реальных платежей.
 * «Покупка» — обмен валюты (mock-purchase): списание цены и выдача товара
 * атомарно в MetaProgression.buyShopOffer, с событием purchase_made (mock: true)
 * для тост-анимации/count-down баланса в UI.
 */

export type ShopOfferKind = 'rockets' | 'diamonds' | 'chest_speedup';

export interface ShopOffer {
  id: string;
  kind: ShopOfferKind;
  /** Сколько товара выдаётся (для chest_speedup — 0, эффект = сброс таймера). */
  amount: number;
  cost: number;
  costCurrency: 'diamonds' | 'crystals';
  /** Короткий лейбл для карточки (ui.md §3.6). */
  title: string;
  /** Бейдж карточки («−20%», «ВЫГОДНО», «ЛУЧШЕЕ»). */
  badge?: string;
}

/** Наборы магазина — ui.md §3.6 (ракеты 2◆/шт, ×5 за 8◆; алмазы за кристаллы; ускорение сундука). */
export const SHOP_OFFERS: readonly ShopOffer[] = [
  {
    id: 'rocket_x1',
    kind: 'rockets',
    amount: 1,
    cost: BOOST.rocketPriceDiamonds, // 2◆
    costCurrency: 'diamonds',
    title: 'РАКЕТА ×1',
  },
  {
    id: 'rocket_x5',
    kind: 'rockets',
    amount: 5,
    cost: 8,
    costCurrency: 'diamonds',
    title: 'РАКЕТА ×5',
    badge: '−20%',
  },
  {
    id: 'diamonds_10',
    kind: 'diamonds',
    amount: 10,
    cost: 40,
    costCurrency: 'crystals',
    title: '10◆',
  },
  {
    id: 'diamonds_30',
    kind: 'diamonds',
    amount: 30,
    cost: 100,
    costCurrency: 'crystals',
    title: '30◆',
    badge: 'ВЫГОДНО',
  },
  {
    id: 'diamonds_100',
    kind: 'diamonds',
    amount: 100,
    cost: 280,
    costCurrency: 'crystals',
    title: '100◆',
    badge: 'ЛУЧШЕЕ',
  },
  {
    id: 'chest_speedup',
    kind: 'chest_speedup',
    amount: 0,
    cost: CHEST_SPEEDUP_COST_CRYSTALS, // 10 кр.
    costCurrency: 'crystals',
    title: 'УСКОРИТЬ СУНДУК',
  },
] as const;

export function getShopOffer(id: string): ShopOffer | null {
  return SHOP_OFFERS.find((o) => o.id === id) ?? null;
}
