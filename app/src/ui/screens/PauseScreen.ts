import type { Game } from '@/game/Game';
import { Screen, el, iconImg } from './Screen';

/** PAUSE (ui.md §3.10): blur-оверлей, панель 360px, 4 действия. */
export class PauseScreen extends Screen {
  constructor(root: HTMLElement, game: Game, openSettings: () => void) {
    super(root, 'screen-pause');
    const overlay = el('div', 'overlay-dim overlay-dim--blur');
    const panel = el('div', 'panel pause-panel');
    const ribbon = el('div', 'panel-ribbon text-outline');
    ribbon.append(iconImg('/ui-panel-ribbon.png', 'panel-ribbon__img'), el('span', 'panel-ribbon__text', 'ПАУЗА'));

    const resume = el('button', 'btn btn--green btn--lg', 'ПРОДОЛЖИТЬ');
    resume.type = 'button';
    resume.onclick = () => {
      game.audio.play('ui_click');
      game.resumeFromPause();
    };
    const restart = el('button', 'btn btn--blue btn--lg');
    restart.type = 'button';
    restart.append(iconImg('/icon-restart.png', 'btn-inline-icon'), document.createTextNode('ЗАНОВО'));
    restart.onclick = () => {
      game.audio.play('ui_click');
      game.restartRun();
    };
    const settings = el('button', 'btn btn--ghost btn--md', 'НАСТРОЙКИ');
    settings.type = 'button';
    settings.onclick = () => {
      game.audio.play('ui_click');
      openSettings();
    };
    const menu = el('button', 'btn btn--ghost btn--md', 'В МЕНЮ');
    menu.type = 'button';
    menu.onclick = () => {
      game.audio.play('ui_click');
      game.quitToMenu();
    };

    const btns = el('div', 'results-buttons pause-buttons');
    btns.append(resume, restart, settings, menu);
    panel.append(ribbon, btns);
    this.el.append(overlay, panel);
  }

  protected override onShow(): void {
    this.el.querySelector<HTMLButtonElement>('.btn--green')?.focus();
  }
}
