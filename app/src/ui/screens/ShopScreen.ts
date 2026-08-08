import type { Game } from '@/game/Game';
import { formatCurrency } from '@/utils/math';
import { el, iconImg } from './Screen';
import { ModalScreen } from './ModalScreen';
import * as meta from '../meta-bridge';

/**
 * SHOP (ui.md §3.6): ракеты (×1 за 2◆, ×5 за 8◆ со скидкой), наборы алмазов
 * за кристаллы, ускорение сундука. Покупки ≤10 кр. без confirm, с тостом.
 */
export class ShopScreen extends ModalScreen {
  private readonly game: Game;
  private readonly rocketBuy1: HTMLButtonElement;
  private readonly rocketBuy5: HTMLButtonElement;
  private readonly diamondBtns: HTMLButtonElement[] = [];
  private readonly chestBtn: HTMLButtonElement;
  private readonly toast: HTMLDivElement;

  constructor(root: HTMLElement, game: Game) {
    super(root, 'screen-shop', 'МАГАЗИН', true);
    this.game = game;

    // ===== секция РАКЕТЫ =====
    const rocketsSection = el('div', 'shop-section');
    rocketsSection.appendChild(el('div', 'shop-section__title', 'РАКЕТЫ'));
    const rocketRow = el('div', 'shop-card shop-card--row');
    rocketRow.appendChild(iconImg('/icon-rocket.png', 'shop-card__icon'));
    const rocketInfo = el('div', 'shop-card__info');
    rocketInfo.append(el('div', 'shop-card__name', 'РАКЕТА ×1'), el('div', 'shop-card__desc', 'Мгновенный буст в заезде'));
    this.rocketBuy1 = this.priceBtn('2', '/icon-diamond.png', 'green', () => {
      if (meta.buyRocket(this.game)) {
        this.game.audio.play('ui_buy');
        this.showToast('РАКЕТА КУПЛЕНА!');
      } else this.shake(this.rocketBuy1);
      this.refresh();
    });
    rocketRow.append(rocketInfo, this.rocketBuy1);

    const rocketPack = el('div', 'shop-card shop-card--row');
    rocketPack.appendChild(iconImg('/icon-rocket.png', 'shop-card__icon'));
    const packInfo = el('div', 'shop-card__info');
    packInfo.append(el('div', 'shop-card__name', 'РАКЕТА ×5'), el('div', 'shop-card__desc', 'Запас на весь день'));
    rocketPack.appendChild(el('span', 'shop-badge', '−20%'));
    this.rocketBuy5 = this.priceBtn('8', '/icon-diamond.png', 'green', () => {
      if (meta.buyRocketPack(this.game)) {
        this.game.audio.play('ui_buy');
        this.showToast('НАБОР РАКЕТ КУПЛЕН!');
      } else this.shake(this.rocketBuy5);
      this.refresh();
    });
    rocketPack.append(packInfo, this.rocketBuy5);
    rocketsSection.append(rocketRow, rocketPack);

    // ===== секция АЛМАЗЫ (наборы за кристаллы) =====
    const diamondsSection = el('div', 'shop-section');
    diamondsSection.appendChild(el('div', 'shop-section__title', 'АЛМАЗЫ'));
    const grid = el('div', 'shop-grid');
    const packs: Array<{ diamonds: number; crystals: number; badge?: string }> = [
      { diamonds: 10, crystals: 40 },
      { diamonds: 30, crystals: 100, badge: 'ВЫГОДНО' },
      { diamonds: 100, crystals: 280, badge: 'ЛУЧШЕЕ' },
    ];
    for (const pack of packs) {
      const card = el('div', 'shop-card shop-card--pack');
      if (pack.badge) card.appendChild(el('span', 'shop-badge', pack.badge));
      card.appendChild(iconImg('/icon-diamond.png', 'shop-card__icon shop-card__icon--big'));
      card.appendChild(el('div', 'shop-card__name', `◆ ${pack.diamonds}`));
      const buy = this.priceBtn(formatCurrency(pack.crystals), '/icon-crystal.png', 'blue', () => {
        if (this.game.economy.spendCrystals(pack.crystals)) {
          this.game.economy.addDiamonds(pack.diamonds);
          this.game.save.save(this.game.meta.save);
          this.game.audio.play('ui_buy');
          this.showToast(`+${pack.diamonds} ◆`);
        } else this.shake(buy);
        this.refresh();
      });
      buy.dataset.crystals = String(pack.crystals);
      this.diamondBtns.push(buy);
      card.appendChild(buy);
      grid.appendChild(card);
    }
    diamondsSection.appendChild(grid);

    // ===== секция СУНДУК =====
    const chestSection = el('div', 'shop-section');
    chestSection.appendChild(el('div', 'shop-section__title', 'СУНДУК'));
    const chestRow = el('div', 'shop-card shop-card--row');
    chestRow.appendChild(iconImg('/icon-chest.png', 'shop-card__icon'));
    const chestInfo = el('div', 'shop-card__info');
    chestInfo.append(el('div', 'shop-card__name', 'УСКОРИТЬ СУНДУК'), el('div', 'shop-card__desc', 'Открыть прямо сейчас'));
    this.chestBtn = this.priceBtn(String(meta.CHEST_SPEEDUP_COST), '/icon-crystal.png', 'blue', () => {
      if (meta.speedUpChest(this.game)) {
        this.game.audio.play('ui_buy');
        this.showToast('СУНДУК ГОТОВ!');
      } else this.shake(this.chestBtn);
      this.refresh();
    });
    chestRow.append(chestInfo, this.chestBtn);
    chestSection.appendChild(chestRow);

    this.toast = el('div', 'shop-toast text-outline');
    this.content.append(rocketsSection, diamondsSection, chestSection, this.toast);

    game.bus.on('currency_changed', () => {
      if (this.visible) this.refresh();
    });
  }

  private priceBtn(price: string, icon: string, variant: 'green' | 'blue', onClick: () => void): HTMLButtonElement {
    const btn = el('button', `btn btn--${variant} btn--md shop-price`);
    btn.type = 'button';
    btn.dataset.variant = variant;
    btn.append(iconImg(icon, 'btn-inline-icon'), document.createTextNode(price));
    btn.onclick = onClick;
    return btn;
  }

  private shake(node: HTMLElement): void {
    this.game.audio.play('ui_click');
    node.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 200, easing: 'ease-in-out' },
    );
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove('shop-toast--show');
    // перезапуск анимации
    void this.toast.offsetWidth;
    this.toast.classList.add('shop-toast--show');
  }

  private refresh(): void {
    const e = this.game.economy;
    this.setAfford(this.rocketBuy1, e.diamonds >= 2);
    this.setAfford(this.rocketBuy5, e.diamonds >= 8);
    for (const btn of this.diamondBtns) {
      this.setAfford(btn, e.crystals >= Number(btn.dataset.crystals));
    }
    const chest = meta.getChestState(this.game);
    const chestActive = !chest.ready && e.crystals >= meta.CHEST_SPEEDUP_COST;
    this.setAfford(this.chestBtn, chestActive);
  }

  private setAfford(btn: HTMLButtonElement, afford: boolean): void {
    const variant = btn.dataset.variant === 'blue' ? 'btn--blue' : 'btn--green';
    btn.classList.toggle(variant, afford);
    btn.classList.toggle('btn--disabled', !afford);
  }

  protected override onShow(): void {
    this.refresh();
  }
}
