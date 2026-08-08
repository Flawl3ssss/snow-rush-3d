import type { Game } from '@/game/Game';
import { formatCurrency } from '@/utils/math';
import { el, iconImg } from './Screen';
import { ModalScreen } from './ModalScreen';

/**
 * STATS (ui.md §3.2, тап по аватару): lifetimeDistance, runs, BEST.
 */
export class StatsPanel extends ModalScreen {
  private readonly game: Game;
  private readonly rows: HTMLDivElement;

  constructor(root: HTMLElement, game: Game) {
    super(root, 'screen-stats', 'СТАТИСТИКА');
    this.game = game;
    this.rows = el('div', 'stats-rows');
    this.content.appendChild(this.rows);
  }

  protected override onShow(): void {
    const save = this.game.meta.save;
    const data: Array<{ icon: string; label: string; value: string }> = [
      { icon: '/icon-crown.png', label: 'РЕКОРД', value: `${formatCurrency(save.best)}m` },
      { icon: '/icon-flag.png', label: 'ВСЕГО ПРОЕХАНО', value: `${formatCurrency(save.stats.lifetimeDistance)}m` },
      { icon: '/icon-restart.png', label: 'ЗАЕЗДОВ', value: formatCurrency(save.stats.runs) },
      { icon: '/menu-penguin.png', label: 'УРОВЕНЬ', value: `${this.game.meta.playerLevel}` },
    ];
    this.rows.replaceChildren();
    for (const d of data) {
      const row = el('div', 'stats-row');
      row.append(iconImg(d.icon, 'stats-row__icon'), el('span', 'stats-row__label', d.label), el('span', 'stats-row__value', d.value));
      this.rows.appendChild(row);
    }
  }
}
