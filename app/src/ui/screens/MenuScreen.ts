import type { Game } from '@/game/Game';
import { UPGRADE_LINES } from '@/game/meta/MetaProgression';
import type { UpgradeLine } from '@/game/meta/MetaProgression';
import { formatCurrency } from '@/utils/math';
import { Screen, countUp, el, iconButton, iconImg } from './Screen';
import * as meta from '../meta-bridge';

const LINE_META: Record<UpgradeLine, { title: string; icon: string; className: string }> = {
  slingshot: { title: 'SLINGSHOT', icon: '/icon-slingshot.png', className: 'upg-card--slingshot' },
  sled: { title: 'SLED', icon: '/icon-sled.png', className: 'upg-card--sled' },
  income: { title: 'INCOME', icon: '/icon-income.png', className: 'upg-card--income' },
};

export interface MenuActions {
  openShop(): void;
  openTasks(): void;
  openChest(): void;
  openSettings(): void;
  openStats(): void;
}

interface UpgradeCardRefs {
  price: HTMLButtonElement;
  level: HTMLSpanElement;
  stat: HTMLDivElement;
  segments: HTMLDivElement;
  root: HTMLDivElement;
}

/**
 * MENU (ui.md §3.2): top-bar (чипы валют + LEVEL + XP), левая колонка
 * (аватар/задания/сундук с таймером), правая (магазин/ракета), TAP TO PLAY,
 * 3 карточки апгрейдов с сегментной шкалой и состояниями can/can't afford.
 */
export class MenuScreen extends Screen {
  private readonly coinValue: HTMLSpanElement;
  private readonly crystalValue: HTMLSpanElement;
  private readonly diamondValue: HTMLSpanElement;
  private readonly levelBadge: HTMLDivElement;
  private readonly xpFill: HTMLDivElement;
  private readonly rocketCount: HTMLSpanElement;
  private readonly tasksBadge: HTMLDivElement;
  private readonly chestBtn: HTMLButtonElement;
  private readonly chestTimer: HTMLDivElement;
  private readonly rocketBuyBtn: HTMLButtonElement;
  private readonly rocketCard: HTMLDivElement;
  private readonly cards = new Map<UpgradeLine, UpgradeCardRefs>();
  private readonly mapStrip: HTMLDivElement;
  private readonly mapButtons = new Map<string, HTMLButtonElement>();

  private readonly game: Game;
  private lastChestSec = -1;

  constructor(root: HTMLElement, game: Game, actions: MenuActions) {
    super(root, 'screen-menu');
    this.game = game;

    // ===== top-bar (зоны A→центр→B) =====
    const topBar = el('div', 'menu-topbar anim-menu-topbar');

    const chipsLeft = el('div', 'menu-chips');
    const coinChip = this.makeChip('/icon-coin.png', 'Монеты');
    this.coinValue = coinChip.value;
    const crystalChip = this.makeChip('/icon-crystal.png', 'Кристаллы');
    this.crystalValue = crystalChip.value;
    chipsLeft.append(coinChip.el, crystalChip.el);

    const levelWrap = el('div', 'menu-level');
    this.levelBadge = el('div', 'menu-level__badge', 'LEVEL 1');
    const xpBar = el('div', 'menu-level__xpbar');
    this.xpFill = el('div', 'menu-level__xpfill');
    xpBar.appendChild(this.xpFill);
    levelWrap.append(this.levelBadge, xpBar);

    const chipsRight = el('div', 'menu-chips');
    const diamondChip = this.makeChip('/icon-diamond.png', 'Алмазы');
    this.diamondValue = diamondChip.value;
    const plus = el('button', 'btn btn--green currency-chip__plus', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Купить алмазы');
    plus.onclick = () => {
      game.audio.play('ui_click');
      actions.openShop();
    };
    diamondChip.el.appendChild(plus);
    const gear = iconButton('/icon-gear.png', '', () => {
      game.audio.play('ui_click');
      actions.openSettings();
    }, 'Настройки');
    chipsRight.append(diamondChip.el, gear);

    topBar.append(chipsLeft, levelWrap, chipsRight);

    // ===== левая колонка (аватар / задания / сундук) =====
    const leftCol = el('div', 'menu-col menu-col--left anim-menu-left');

    const avatar = el('button', 'menu-avatar');
    avatar.type = 'button';
    avatar.setAttribute('aria-label', 'Статистика');
    avatar.appendChild(iconImg('/menu-penguin.png', 'menu-avatar__img'));
    avatar.onclick = () => {
      game.audio.play('ui_click');
      actions.openStats();
    };

    const tasksWrap = el('div', 'menu-btn-wrap');
    const tasksBtn = iconButton('/icon-tasks.png', 'btn--lg-icon', () => {
      game.audio.play('ui_click');
      actions.openTasks();
    }, 'Задания');
    this.tasksBadge = el('div', 'menu-badge-new');
    this.tasksBadge.appendChild(iconImg('/ui-badge-new.png', 'menu-badge-new__img'));
    tasksWrap.append(tasksBtn, this.tasksBadge);

    const chestWrap = el('div', 'menu-btn-wrap menu-chest-wrap');
    this.chestBtn = iconButton('/icon-chest.png', 'btn--lg-icon', () => {
      game.audio.play('ui_click');
      actions.openChest();
    }, 'Сундук');
    this.chestTimer = el('div', 'menu-chest-timer text-outline', '15:00');
    chestWrap.append(this.chestBtn, this.chestTimer);

    leftCol.append(avatar, tasksWrap, chestWrap);

    // ===== правая колонка (магазин / ракета) =====
    const rightCol = el('div', 'menu-col menu-col--right anim-menu-right');
    const shopBtn = iconButton('/icon-shop.png', 'btn--lg-icon', () => {
      game.audio.play('ui_click');
      actions.openShop();
    }, 'Магазин');

    this.rocketCard = el('div', 'rocket-card panel-mini');
    this.rocketCard.appendChild(iconImg('/icon-rocket.png', 'rocket-card__icon'));
    const rocketLabel = el('div', 'rocket-card__label');
    rocketLabel.append('РАКЕТА ');
    this.rocketCount = el('span', 'rocket-card__count', '×0');
    rocketLabel.appendChild(this.rocketCount);
    this.rocketBuyBtn = el('button', 'btn btn--green btn--md rocket-card__buy');
    this.rocketBuyBtn.type = 'button';
    this.rocketBuyBtn.append('UPGRADE · 2');
    this.rocketBuyBtn.appendChild(iconImg('/icon-diamond.png', 'btn-inline-icon'));
    this.rocketBuyBtn.onclick = () => {
      game.audio.play('ui_click');
      if (meta.buyRocket(game)) {
        game.audio.play('ui_buy');
      } else {
        this.shakeEl(this.rocketCard);
      }
      this.refreshRockets();
    };
    this.rocketCard.append(rocketLabel, this.rocketBuyBtn);
    rightCol.append(shopBtn, this.rocketCard);

    // ===== TAP TO PLAY (зона F) =====
    const tapWrap = el('div', 'menu-tap-wrap anim-menu-tap');
    tapWrap.append(
      el('div', 'menu-tap text-outline--big', 'TAP TO PLAY'),
      el('div', 'menu-tap-sub text-outline', 'ИЛИ НАЖМИ SPACE'),
    );

    // ===== карточки апгрейдов =====
    const cardsRow = el('div', 'menu-upgrades');
    UPGRADE_LINES.forEach((line, i) => {
      const m = LINE_META[line];
      const card = el('div', `upg-card ${m.className} anim-menu-card`);
      card.style.animationDelay = `${i * 100}ms`;

      const head = el('div', 'upg-card__head');
      head.appendChild(iconImg(m.icon, 'upg-card__icon'));
      head.append(el('span', 'upg-card__title text-outline', m.title));
      const level = el('span', 'upg-card__level text-outline', 'УР. 1');
      head.appendChild(level);

      const stat = el('div', 'upg-card__stat');

      const segments = el('div', 'upg-card__segments');
      for (let s = 0; s < 5; s += 1) {
        const seg = el('div', 'upg-card__seg');
        seg.appendChild(el('div', 'upg-card__segfill'));
        segments.appendChild(seg);
      }

      const price = el('button', 'btn btn--green upg-card__buy');
      price.type = 'button';
      price.onclick = () => {
        game.audio.play('ui_click');
        game.economy.buyUpgrade(line);
      };

      card.append(head, stat, segments, price);
      cardsRow.appendChild(card);
      this.cards.set(line, { price, level, stat, segments, root: card });
    });

    // ===== селектор карт (экономика v2, 5 миров) =====
    this.mapStrip = el('div', 'map-strip anim-menu-tap');
    for (const def of this.game.meta.getAllMaps()) {
      const btn = el('button', 'map-card', '') as HTMLButtonElement;
      btn.type = 'button';
      btn.dataset.mapId = def.id;
      btn.onclick = () => {
        game.audio.play('ui_click');
        const st = this.game.meta.getMapUnlockState(def.id);
        if (st.unlocked) {
          if (this.game.meta.selectMap(def.id)) game.audio.play('ui_buy');
        } else if (st.canUnlock) {
          if (this.game.meta.unlockMap(def.id)) {
            game.audio.play('ui_buy');
            game.save.save(this.game.meta.save);
          }
        } else {
          this.shakeEl(btn);
        }
        this.refreshMaps();
      };
      this.mapButtons.set(def.id, btn);
      this.mapStrip.appendChild(btn);
    }

    this.el.append(topBar, leftCol, rightCol, tapWrap, this.mapStrip, cardsRow);

    // ===== события =====
    game.bus.on('currency_changed', () => {
      this.refreshCurrencies(true);
      this.refreshRockets();
      this.refreshMaps();
    });
    game.bus.on('upgrade_purchased', ({ line }) => {
      this.game.save.save(this.game.meta.save);
      this.refreshCard(line);
      const card = this.cards.get(line);
      if (!card) return;
      // flash + подпрыгивание иконки (design.md §6.2)
      card.root.animate(
        [{ filter: 'brightness(1.3)' }, { filter: 'brightness(1)' }],
        { duration: 300, easing: 'ease-out' },
      );
      card.root.querySelector('.upg-card__icon')?.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }],
        { duration: 350, easing: 'cubic-bezier(.2,1.6,.4,1)' },
      );
    });
    game.bus.on('upgrade_failed', ({ line }) => {
      const card = this.cards.get(line);
      if (card) this.shakeEl(card.root);
    });
    game.bus.on('level_up', () => this.refresh());
    game.bus.on('map_unlocked', () => this.refreshMaps());
    game.bus.on('map_changed', () => this.refreshMaps());
    // мета-события (защитно): бейдж заданий, готовность сундука
    meta.onMetaEvent(game.bus, 'task_completed', () => this.refreshTasksBadge());
    meta.onMetaEvent(game.bus, 'chest_ready', () => this.refreshChest(true));
  }

  private makeChip(icon: string, label: string): { el: HTMLDivElement; value: HTMLSpanElement } {
    const chip = el('div', 'currency-chip');
    chip.setAttribute('aria-label', label);
    chip.appendChild(iconImg(icon, 'currency-chip__icon'));
    const value = el('span', 'currency-chip__value text-outline', '0');
    chip.appendChild(value);
    return { el: chip, value };
  }

  private shakeEl(node: HTMLElement): void {
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

  refresh(): void {
    this.refreshCurrencies(false);
    this.levelBadge.textContent = `LEVEL ${this.game.meta.playerLevel}`;
    this.xpFill.style.width = `${Math.round(this.game.meta.xpProgress * 100)}%`;
    this.refreshRockets();
    this.refreshTasksBadge();
    this.refreshChest(true);
    this.refreshMaps();
    for (const line of UPGRADE_LINES) this.refreshCard(line);
  }

  /** Селектор карт: название/тэглайн, замок с условием, кнопка ОТКРЫТЬ. */
  private refreshMaps(): void {
    const m = this.game.meta;
    for (const def of m.getAllMaps()) {
      const btn = this.mapButtons.get(def.id);
      if (!btn) continue;
      const st = m.getMapUnlockState(def.id);
      btn.classList.toggle('map-card--current', st.isCurrent);
      btn.classList.toggle('map-card--locked', !st.unlocked);
      btn.classList.toggle('map-card--openable', st.canUnlock);
      const title = el('span', 'map-card__name text-outline', def.name);
      if (st.unlocked) {
        const sub = el('span', 'map-card__sub', st.isCurrent ? '▶ ВЫБРАНА' : def.tagline);
        btn.replaceChildren(title, sub);
      } else if (st.canUnlock) {
        const open = el('span', 'map-card__open');
        open.append('ОТКРЫТЬ · ');
        open.appendChild(iconImg('/icon-crystal.png', 'btn-inline-icon'));
        open.append(` ${st.needCrystals}`);
        btn.replaceChildren(title, open);
      } else {
        const lock = el('span', 'map-card__lock');
        lock.append(`🔒 УР. ${st.needLevel} · `);
        lock.appendChild(iconImg('/icon-crystal.png', 'btn-inline-icon'));
        lock.append(` ${st.needCrystals}`);
        btn.replaceChildren(title, lock);
      }
    }
  }

  private refreshCurrencies(animate: boolean): void {
    const e = this.game.economy;
    if (animate) {
      countUp(this.coinValue, e.coins, formatCurrency);
      countUp(this.crystalValue, e.crystals, formatCurrency);
      countUp(this.diamondValue, e.diamonds, formatCurrency);
    } else {
      this.coinValue.dataset.countValue = String(e.coins);
      this.coinValue.textContent = formatCurrency(e.coins);
      this.crystalValue.dataset.countValue = String(e.crystals);
      this.crystalValue.textContent = formatCurrency(e.crystals);
      this.diamondValue.dataset.countValue = String(e.diamonds);
      this.diamondValue.textContent = formatCurrency(e.diamonds);
    }
  }

  private refreshRockets(): void {
    this.rocketCount.textContent = `×${meta.getRockets(this.game)}`;
    const afford = this.game.economy.diamonds >= 2;
    this.rocketBuyBtn.classList.toggle('btn--disabled', !afford);
    this.rocketBuyBtn.classList.toggle('btn--green', afford);
  }

  private refreshTasksBadge(): void {
    this.tasksBadge.classList.toggle('menu-badge-new--show', meta.hasActiveTasks(this.game));
  }

  private refreshChest(force = false): void {
    const state = meta.getChestState(this.game);
    this.chestBtn.classList.toggle('menu-chest--ready', state.ready);
    if (state.ready) {
      this.chestTimer.textContent = 'ГОТОВ!';
      this.lastChestSec = -1;
      return;
    }
    if (force || state.secondsLeft !== this.lastChestSec) {
      this.lastChestSec = state.secondsLeft;
      this.chestTimer.textContent = meta.formatTimer(state.secondsLeft);
    }
  }

  private refreshCard(line: UpgradeLine): void {
    const card = this.cards.get(line);
    if (!card) return;
    const m = this.game.meta;
    const lvl = m.getUpgradeLevel(line);
    card.level.textContent = `УР. ${lvl}`;
    card.stat.textContent = m.getUpgradeStat(line);
    // 5 сегментов × 5 уровней (ui.md §2.5)
    card.segments.querySelectorAll<HTMLDivElement>('.upg-card__segfill').forEach((f, i) => {
      const segProgress = Math.min(5, Math.max(0, lvl - i * 5)) / 5;
      f.style.width = `${segProgress * 100}%`;
    });
    if (m.isMaxLevel(line)) {
      card.price.replaceChildren('MAX');
      card.price.className = 'btn btn--disabled upg-card__buy';
      card.price.disabled = true;
      return;
    }
    const cost = m.getUpgradeCost(line);
    card.price.replaceChildren(iconImg('/icon-coin.png', 'btn-inline-icon'), document.createTextNode(formatCurrency(cost)));
    const afford = this.game.economy.coins >= cost;
    card.price.className = `btn ${afford ? 'btn--green' : 'btn--disabled'} upg-card__buy`;
    card.price.disabled = false;
  }

  /** Тикает каждый кадр из ScreenManager (таймер сундука, доступность цен). */
  override update(_time: number): void {
    this.refreshChest();
    // состояния can/can't afford без протухания при count-up
    for (const line of UPGRADE_LINES) {
      const card = this.cards.get(line);
      if (!card || this.game.meta.isMaxLevel(line)) continue;
      const afford = this.game.economy.coins >= this.game.meta.getUpgradeCost(line);
      card.price.classList.toggle('btn--green', afford);
      card.price.classList.toggle('btn--disabled', !afford);
    }
  }
}
