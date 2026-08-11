import type { Game } from '@/game/Game';
import { formatCurrency } from '@/utils/math';
import { el, iconImg } from './Screen';
import { ModalScreen } from './ModalScreen';
import * as meta from '../meta-bridge';

type ChestPhase = 'timer' | 'ready' | 'opening' | 'reward';

/**
 * CHEST (ui.md §3.8): модалка 380px. Таймер → «ГОТОВ ЧЕРЕЗ MM:SS» + ускорить;
 * готов → «ОТКРЫТЬ» → squash, icon-chest-open, вспышка, дропы по дуге,
 * досчёт счётчиков → «ЗАБРАТЬ».
 */
export class ChestScreen extends ModalScreen {
  private readonly game: Game;
  private readonly chestImg: HTMLImageElement;
  private readonly status: HTMLDivElement;
  private readonly actionWrap: HTMLDivElement;
  private readonly rewardsRow: HTMLDivElement;
  private phase: ChestPhase = 'timer';
  private lastSec = -1;

  constructor(root: HTMLElement, game: Game) {
    super(root, 'screen-chest', 'СУНДУК');
    this.game = game;

    const chestWrap = el('div', 'chest-wrap');
    this.chestImg = iconImg('/icon-chest.png', 'chest-img');
    chestWrap.appendChild(this.chestImg);
    this.status = el('div', 'chest-status text-outline', '');
    this.rewardsRow = el('div', 'chest-rewards');
    this.actionWrap = el('div', 'chest-actions');
    this.content.append(chestWrap, this.status, this.rewardsRow, this.actionWrap);

    meta.onMetaEvent(game.bus, 'chest_ready', () => {
      if (this.visible) this.render();
    });
  }

  protected override onShow(): void {
    this.phase = meta.getChestState(this.game).ready ? 'ready' : 'timer';
    this.lastSec = -1;
    this.chestImg.src = '/icon-chest.png';
    this.chestImg.style.display = '';
    this.chestImg.className = 'chest-img';
    this.rewardsRow.replaceChildren();
    this.render();
  }

  /** Секундный тик таймера из ScreenManager.update. */
  override update(_delta: number): void {
    if (!this.visible) return;
    if (this.phase === 'timer') {
      const state = meta.getChestState(this.game);
      if (state.ready) {
        this.phase = 'ready';
        this.render();
        return;
      }
      if (state.secondsLeft !== this.lastSec) {
        this.lastSec = state.secondsLeft;
        this.status.textContent = `ГОТОВ ЧЕРЕЗ ${meta.formatTimer(state.secondsLeft)}`;
      }
    }
  }

  private render(): void {
    this.actionWrap.replaceChildren();
    if (this.phase === 'timer') {
      const state = meta.getChestState(this.game);
      this.status.textContent = `ГОТОВ ЧЕРЕЗ ${meta.formatTimer(state.secondsLeft)}`;
      const speedUp = el('button', 'btn btn--blue btn--md');
      speedUp.type = 'button';
      speedUp.append(
        document.createTextNode(`УСКОРИТЬ ${meta.CHEST_SPEEDUP_COST}`),
        iconImg('/icon-crystal.png', 'btn-inline-icon'),
      );
      speedUp.onclick = () => {
        this.game.audio.play('ui_click');
        if (meta.speedUpChest(this.game)) {
          this.phase = 'ready';
          this.render();
        }
      };
      this.actionWrap.appendChild(speedUp);
    } else if (this.phase === 'ready') {
      this.status.textContent = 'СУНДУК ГОТОВ!';
      const open = el('button', 'btn btn--orange btn--lg', 'ОТКРЫТЬ');
      open.type = 'button';
      open.onclick = () => this.open();
      this.actionWrap.appendChild(open);
    } else if (this.phase === 'reward') {
      this.status.textContent = 'НАГРАДА!';
      const take = el('button', 'btn btn--green btn--lg', 'ЗАБРАТЬ');
      take.type = 'button';
      take.onclick = () => {
        this.game.audio.play('ui_click');
        this.setVisible(false);
      };
      this.actionWrap.appendChild(take);
    }
  }

  private open(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'opening';
    this.game.audio.play('chest_open');
    const reward = meta.openChest(this.game);
    if (!reward) {
      // гонка: таймер ещё идёт — вернуться к таймеру
      this.phase = 'timer';
      this.render();
      return;
    }
    meta.emitMetaEvent(this.game.bus, 'chest_opened', reward);
    // W4 §2.2: плановый «поворот ноды крышки GLB» здесь неприменим — экран
    // сундука DOM-овый (PNG-иконки), 3D-сцены на нём нет. Эквивалент замаха
    // даём на CSS: приседание с наклоном (анти-упреждение) → рывок вверх
    // с overshoot по easeOutBack → возврат. Читается как «крышку сорвало».
    this.chestImg.animate(
      [
        { transform: 'scaleY(1) rotate(0deg) translateY(0)', offset: 0 },
        { transform: 'scaleY(0.82) scaleX(1.08) rotate(-3deg) translateY(4px)', offset: 0.35 },
        { transform: 'scaleY(1.14) scaleX(0.94) rotate(2deg) translateY(-10px)', offset: 0.72 },
        { transform: 'scaleY(1) rotate(0deg) translateY(0)', offset: 1 },
      ],
      { duration: 420, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    ).onfinish = () => {
      this.chestImg.src = '/icon-chest-open.png';
      this.chestImg.style.display = '';
      this.chestImg.classList.add('chest-img--open');
      const flash = el('div', 'chest-flash');
      flash.appendChild(iconImg('/fx-star-burst.png', 'chest-flash__img'));
      this.chestImg.parentElement?.appendChild(flash);
      window.setTimeout(() => flash.remove(), 700);
      this.spawnDrops(reward);
      this.phase = 'reward';
      this.render();
    };
  }

  /** Дропы вылетают по дуге (translateY −60px easeOutBack, stagger 120 мс). */
  private spawnDrops(reward: meta.TaskReward): void {
    this.rewardsRow.replaceChildren();
    const drops: Array<{ icon: string; n: number }> = [];
    if (reward.coins) drops.push({ icon: '/icon-coin.png', n: reward.coins });
    if (reward.crystals) drops.push({ icon: '/icon-crystal.png', n: reward.crystals });
    if (reward.diamonds) drops.push({ icon: '/icon-diamond.png', n: reward.diamonds });
    drops.slice(0, 3).forEach((drop, i) => {
      const chip = el('div', 'chest-drop');
      chip.style.animationDelay = `${i * 120}ms`;
      chip.append(iconImg(drop.icon, 'chest-drop__icon'), el('span', 'text-outline', `+${formatCurrency(drop.n)}`));
      this.rewardsRow.appendChild(chip);
    });
  }
}
