import type { Game } from '@/game/Game';
import type { RunResults } from '@/utils/events';
import { CONTINUE } from '@/config';
import { formatCurrency } from '@/utils/math';
import { Screen, countUp, el, iconImg } from './Screen';
import * as meta from '../meta-bridge';

/**
 * RESULTS (ui.md §3.5): панель с ленточкой (РЕЗУЛЬТАТ/ФИНИШ!/НОВЫЙ РЕКОРД!),
 * гигантская дистанция, награды count-up со stagger, XP-бар, кнопки.
 * CONTINUE-модалка с таймером-кольцом 5 с поверх результатов крэша (gdd §5.7).
 */
export class ResultsScreen extends Screen {
  private readonly game: Game;
  private readonly ribbonText: HTMLSpanElement;
  private readonly ribbon: HTMLDivElement;
  private readonly crown: HTMLImageElement;
  private readonly distValue: HTMLDivElement;
  private readonly bestLine: HTMLDivElement;
  private readonly rewardsList: HTMLDivElement;
  private readonly xpBar: HTMLDivElement;
  private readonly xpFill: HTMLDivElement;
  private readonly panel: HTMLDivElement;

  // --- continue modal ---
  private readonly continueModal: HTMLDivElement;
  private readonly continueRing: HTMLDivElement;
  private readonly continueLabel: HTMLDivElement;
  private continueTimer: number | null = null;
  private continueEnd = 0;

  constructor(root: HTMLElement, game: Game) {
    super(root, 'screen-results');
    this.game = game;
    const overlay = el('div', 'overlay-dim');

    this.panel = el('div', 'panel results-panel');
    this.ribbon = el('div', 'panel-ribbon text-outline');
    this.ribbon.appendChild(iconImg('/ui-panel-ribbon.png', 'panel-ribbon__img'));
    this.crown = iconImg('/icon-crown.png', 'panel-ribbon__crown');
    this.ribbonText = el('span', 'panel-ribbon__text', 'РЕЗУЛЬТАТ');
    this.ribbon.append(this.crown, this.ribbonText);

    this.distValue = el('div', 'results-distance text-outline--big', '0m');
    this.bestLine = el('div', 'results-best', 'ЛУЧШИЙ: 0m');
    this.rewardsList = el('div', 'results-rewards');

    this.xpBar = el('div', 'results-xpbar');
    this.xpFill = el('div', 'results-xpbar__fill');
    this.xpBar.append(this.xpFill, el('span', 'results-xpbar__label', 'XP'));

    const again = el('button', 'btn btn--green btn--xl', 'ЕЩЁ РАЗ');
    again.type = 'button';
    again.onclick = () => {
      game.audio.play('ui_click');
      game.toAim();
    };
    const upgrades = el('button', 'btn btn--blue btn--lg', 'АПГРЕЙДЫ');
    upgrades.type = 'button';
    upgrades.onclick = () => {
      game.audio.play('ui_click');
      game.quitToMenu();
    };
    const menu = el('button', 'btn btn--ghost btn--md', 'В МЕНЮ');
    menu.type = 'button';
    menu.onclick = () => {
      game.audio.play('ui_click');
      game.quitToMenu();
    };
    const btns = el('div', 'results-buttons');
    btns.append(again, upgrades, menu);

    this.panel.append(this.ribbon, this.distValue, this.bestLine, this.rewardsList, this.xpBar, btns);

    // ===== CONTINUE-модалка (gdd §5.7, до панели результатов крэша) =====
    this.continueModal = el('div', 'continue-modal');
    const cPanel = el('div', 'panel continue-panel');
    const cRibbon = el('div', 'panel-ribbon panel-ribbon--orange text-outline');
    cRibbon.append(iconImg('/ui-panel-ribbon.png', 'panel-ribbon__img'), el('span', 'panel-ribbon__text', 'ПРОДОЛЖИТЬ?'));
    this.continueRing = el('div', 'continue-ring');
    this.continueLabel = el('div', 'continue-ring__label text-outline', '5');
    this.continueRing.appendChild(this.continueLabel);
    const cText = el('div', 'continue-text');
    const cYes = el('button', 'btn btn--orange btn--lg');
    cYes.type = 'button';
    const cNo = el('button', 'btn btn--ghost btn--md', 'НЕТ');
    cNo.type = 'button';
    cYes.onclick = () => {
      game.audio.play('ui_click');
      if (meta.spendContinue(game)) {
        this.stopContinueTimer();
        this.setVisible(false);
        meta.resumeAfterContinue(game);
      }
    };
    cNo.onclick = () => {
      game.audio.play('ui_click');
      this.stopContinueTimer();
      this.showPanel();
    };
    const cBtns = el('div', 'results-buttons');
    cBtns.append(cYes, cNo);
    cPanel.append(cRibbon, this.continueRing, cText, cBtns);
    this.continueModal.appendChild(cPanel);

    this.el.append(overlay, this.continueModal, this.panel);
  }

  show(r: RunResults): void {
    // ленточка: ФИНИШ! (зелёная) / НОВЫЙ РЕКОРД! (корона) / РЕЗУЛЬТАТ
    this.ribbonText.textContent = r.finished ? 'ФИНИШ!' : r.isNewBest ? 'НОВЫЙ РЕКОРД!' : 'РЕЗУЛЬТАТ';
    this.ribbon.classList.toggle('panel-ribbon--green', r.finished);
    this.crown.classList.toggle('panel-ribbon__crown--show', r.isNewBest && !r.finished);
    this.distValue.textContent = `${r.distance}m`;
    this.bestLine.textContent = `ЛУЧШИЙ: ${r.best}m`;

    // награды: stagger slide-left 60 мс + count-up
    this.rewardsList.replaceChildren();
    const rows: Array<{ icon: string; target: number; format: (n: number) => string }> = [
      { icon: '/icon-coin.png', target: r.coinsEarned, format: (n) => `+${formatCurrency(n)}` },
    ];
    if (r.crystalsEarned > 0) rows.push({ icon: '/icon-crystal.png', target: r.crystalsEarned, format: (n) => `+${n}` });
    if (r.diamondsEarned > 0) rows.push({ icon: '/icon-diamond.png', target: r.diamondsEarned, format: (n) => `+${n}` });
    rows.forEach((row, i) => {
      const rowEl = el('div', 'results-row');
      rowEl.style.animationDelay = `${i * 60}ms`;
      rowEl.appendChild(iconImg(row.icon, 'results-row__icon'));
      const val = el('span', 'results-row__value', '+0');
      rowEl.appendChild(val);
      this.rewardsList.appendChild(rowEl);
      window.setTimeout(() => countUp(val, row.target, row.format), i * 60);
    });

    // XP-бар: заполнение 600 мс
    this.xpFill.style.transition = 'none';
    this.xpFill.style.width = '0%';
    window.setTimeout(() => {
      this.xpFill.style.transition = 'width 600ms cubic-bezier(.2,.8,.2,1)';
      this.xpFill.style.width = `${Math.round(this.game.meta.xpProgress * 100)}%`;
    }, rows.length * 60 + 100);

    // CONTINUE до панели, если доступен «второй шанс»
    if (r.crashed && meta.canContinue(this.game)) {
      this.showContinue();
    } else {
      this.showPanel();
    }
  }

  private showPanel(): void {
    this.continueModal.classList.remove('continue-modal--show');
    this.panel.classList.add('results-panel--show');
    this.panel.querySelector<HTMLButtonElement>('.btn--xl')?.focus();
  }

  private showContinue(): void {
    this.panel.classList.remove('results-panel--show');
    const cost = meta.getContinueCost(this.game);
    const cText = this.continueModal.querySelector('.continue-text');
    if (cText) {
      cText.replaceChildren();
      cText.append(`ПРОДОЛЖИТЬ ЗА ${formatCurrency(cost)} `);
      cText.appendChild(iconImg('/icon-coin.png', 'btn-inline-icon'));
      cText.append('?');
    }
    const cYes = this.continueModal.querySelector<HTMLButtonElement>('.btn--orange');
    if (cYes) {
      cYes.replaceChildren('ПРОДОЛЖИТЬ · ', iconImg('/icon-coin.png', 'btn-inline-icon'), document.createTextNode(formatCurrency(cost)));
      const afford = this.game.economy.coins >= cost;
      cYes.classList.toggle('btn--disabled', !afford);
      cYes.classList.toggle('btn--orange', afford);
    }
    this.continueModal.classList.add('continue-modal--show');
    // таймер-кольцо 5 с → автопереход к панели
    this.continueEnd = performance.now() + CONTINUE.timerSec * 1000;
    this.stopContinueTimer();
    this.continueTimer = window.setInterval(() => {
      const left = Math.max(0, (this.continueEnd - performance.now()) / 1000);
      const k = left / CONTINUE.timerSec;
      this.continueLabel.textContent = String(Math.ceil(left));
      this.continueRing.style.background = `conic-gradient(#FF9F2E ${k * 360}deg, rgba(34,49,74,0.15) ${k * 360}deg 360deg)`;
      if (left <= 0) {
        this.stopContinueTimer();
        this.showPanel();
      }
    }, 100);
  }

  private stopContinueTimer(): void {
    if (this.continueTimer !== null) {
      clearInterval(this.continueTimer);
      this.continueTimer = null;
    }
  }

  protected override onHide(): void {
    this.stopContinueTimer();
    this.continueModal.classList.remove('continue-modal--show');
    this.panel.classList.remove('results-panel--show');
  }
}
