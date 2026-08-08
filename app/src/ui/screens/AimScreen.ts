import type { Game } from '@/game/Game';
import { Screen, el, iconButton } from './Screen';

/**
 * AIM (ui.md §3.3): % натяжения (hot ≥90%), полоса силы со «сладкой зоной»
 * 85–100%, drag-loop подсказка, BACK, шестерёнка. Release-вспышка на launched.
 */
export class AimScreen extends Screen {
  private readonly percent: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private hinted = false;

  constructor(root: HTMLElement, game: Game, openSettings: () => void) {
    super(root, 'screen-aim');

    this.percent = el('div', 'aim-percent text-outline--big', '0%');

    const bar = el('div', 'aim-bar');
    this.fill = el('div', 'aim-bar__fill');
    const sweet = el('div', 'aim-bar__sweet'); // маркер 85–100% (белые засечки)
    bar.append(this.fill, sweet);

    // подсказка: круг 56px с пунктирной стрелкой вниз (CSS/SVG), drag-loop 1.2с
    this.hint = el('div', 'aim-hint');
    const gesture = el('div', 'aim-hint__gesture');
    const ring = el('div', 'aim-hint__ring');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 24 40');
    arrow.setAttribute('class', 'aim-hint__arrow');
    arrow.innerHTML =
      '<line x1="12" y1="2" x2="12" y2="30" stroke="#fff" stroke-width="3" stroke-dasharray="5 4" stroke-linecap="round"/>' +
      '<path d="M4 26 L12 38 L20 26" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
    gesture.append(ring, arrow);
    const isTouch = 'ontouchstart' in window;
    const hintText = el(
      'div',
      'aim-hint__text text-outline',
      isTouch ? 'ТЯНИ ВНИЗ!' : 'ДЕРЖИ SPACE И ОТПУСТИ!',
    );
    this.hint.append(gesture, hintText);

    const back = el('button', 'btn btn--blue btn--lg aim-back', 'BACK');
    back.type = 'button';
    back.onclick = () => {
      game.audio.play('ui_click');
      game.quitToMenu();
    };

    const gear = iconButton('/icon-gear.png', 'aim-gear', () => {
      game.audio.play('ui_click');
      openSettings();
    }, 'Настройки');

    this.el.append(this.percent, bar, this.hint, back, gear);

    // release → вспышка «замороженного» процента (ui.md §3.3)
    game.bus.on('launched', () => {
      this.percent.animate(
        [{ transform: 'translateX(-50%) scale(1.3)' }, { transform: 'translateX(-50%) scale(1)' }],
        { duration: 150, easing: 'ease-out' },
      );
    });
  }

  setPower(p: number): void {
    const pct = Math.round(p * 100);
    this.percent.textContent = `${pct}%`;
    this.percent.classList.toggle('aim-percent--hot', p >= 0.9);
    this.fill.style.width = `${pct}%`;
    if (!this.hinted && p > 0) {
      this.hinted = true;
      this.hint.classList.add('aim-hint--hidden');
    }
  }

  protected override onShow(): void {
    this.hinted = false;
    this.hint.classList.remove('aim-hint--hidden');
    this.setPower(0);
  }
}
