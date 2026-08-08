import type { Game } from '@/game/Game';
import { el, iconImg } from './Screen';
import { ModalScreen } from './ModalScreen';

type Control = 'swipe' | 'tilt';

const CONTROL_KEY = 'snowrush_control';

/**
 * SETTINGS (ui.md §3.9): музыка/звук (тогглы), reduced motion,
 * управление (свайп/наклон, моб.), сброс прогресса (confirm).
 * Пишет в SaveData.settings и эмитит settings_changed.
 * Переключатель «качество графики» УДАЛЁН (промт §1): он был фейковым —
 * хук applyQuality нигде не реализован, настройка ничего не меняла.
 */
export class SettingsScreen extends ModalScreen {
  private readonly game: Game;
  private readonly musicToggle: HTMLButtonElement;
  private readonly soundToggle: HTMLButtonElement;
  private readonly motionToggle: HTMLButtonElement;
  private readonly controlSeg: HTMLDivElement | null;
  private readonly confirmModal: HTMLDivElement;

  constructor(root: HTMLElement, game: Game) {
    super(root, 'screen-settings', 'НАСТРОЙКИ');
    this.game = game;

    const mkRow = (icon: string, label: string): { row: HTMLDivElement; controlSlot: HTMLDivElement; iconEl: HTMLImageElement } => {
      const row = el('div', 'settings-row');
      const iconEl = iconImg(icon, 'settings-row__icon');
      row.append(iconEl, el('span', 'settings-row__label', label));
      const controlSlot = el('div', 'settings-row__control');
      row.appendChild(controlSlot);
      return { row, controlSlot, iconEl };
    };

    const mkToggle = (onChange: (v: boolean) => void): HTMLButtonElement => {
      const t = el('button', 'toggle');
      t.type = 'button';
      t.setAttribute('role', 'switch');
      t.appendChild(el('span', 'toggle__knob'));
      t.onclick = () => {
        const v = !t.classList.contains('toggle--on');
        this.game.audio.play('ui_click');
        onChange(v);
      };
      return t;
    };

    // Тач-таргет тоггла 56×32 < 48px (ui.md §1.3): вся строка-лейбл кликабельна.
    const makeRowClickable = (row: HTMLDivElement, toggle: HTMLButtonElement): void => {
      row.classList.add('settings-row--toggle');
      row.onclick = (e) => {
        if ((e.target as HTMLElement).closest('.toggle')) return; // без двойного срабатывания
        toggle.click();
      };
    };

    // --- МУЗЫКА ---
    const music = mkRow('/icon-music-on.png', 'МУЗЫКА');
    this.musicToggle = mkToggle((v) => {
      this.game.meta.save.settings.music = v;
      this.game.audio.setMusicEnabled(v);
      this.commit();
      this.sync();
    });
    music.controlSlot.appendChild(this.musicToggle);
    makeRowClickable(music.row, this.musicToggle);

    // --- ЗВУК ---
    const sound = mkRow('/icon-sound-on.png', 'ЗВУК');
    this.soundToggle = mkToggle((v) => {
      this.game.meta.save.settings.sfx = v;
      this.game.audio.setSfxEnabled(v);
      this.commit();
      this.sync();
    });
    sound.controlSlot.appendChild(this.soundToggle);
    makeRowClickable(sound.row, this.soundToggle);

    // --- УМЕНЬШИТЬ АНИМАЦИИ ---
    const motion = mkRow('/icon-pause.png', 'УМЕНЬШИТЬ АНИМАЦИИ');
    this.motionToggle = mkToggle((v) => {
      this.game.meta.save.settings.reducedMotion = v;
      // тестовый хук движка (design.md §6.3) — если уже выставлен
      window.__THREE_GAME_TEST_HOOKS__?.setReducedMotion(v);
      this.commit();
      this.sync();
    });
    motion.controlSlot.appendChild(this.motionToggle);
    makeRowClickable(motion.row, this.motionToggle);

    // --- УПРАВЛЕНИЕ (только тач-устройства) ---
    const rows: HTMLDivElement[] = [music.row, sound.row, motion.row];
    this.controlSeg = null;
    if ('ontouchstart' in window) {
      const control = mkRow('/icon-play.png', 'УПРАВЛЕНИЕ');
      const seg = el('div', 'segment');
      (['swipe', 'tilt'] as Control[]).forEach((c) => {
        const b = el('button', 'segment__btn', c === 'swipe' ? 'СВАЙП' : 'НАКЛОН');
        b.type = 'button';
        b.dataset.control = c;
        b.onclick = () => void this.setControl(c);
        seg.appendChild(b);
      });
      control.controlSlot.appendChild(seg);
      this.controlSeg = seg;
      rows.push(control.row);
    }

    // --- СБРОС ПРОГРЕССА ---
    const resetRow = el('div', 'settings-row');
    const reset = el('button', 'btn btn--danger btn--md settings-reset', 'СБРОС ПРОГРЕССА');
    reset.type = 'button';
    reset.onclick = () => {
      this.game.audio.play('ui_click');
      this.confirmModal.classList.add('confirm-modal--show');
    };
    resetRow.appendChild(reset);
    rows.push(resetRow);

    this.content.append(...rows, el('div', 'settings-version', 'SNOW RUSH 3D · v0.2.0'));

    // --- CREDITS (CC-BY модели с poly.pizza) ---
    const credits = el(
      'div',
      'settings-credits',
      '3D-модели: poly.pizza — Peppermint Penguin, Franco Ricci, Jarlan Perez, Chris Lee, Daniel Melchior, dook, Poly by Google, S. Paul Michael, jeremy, snowman2, gem (CC-BY); Quaternius, iPoly3D (CC0). Подробности — CREDITS.md',
    );
    this.content.appendChild(credits);

    // --- confirm-модалка сброса ---
    this.confirmModal = el('div', 'confirm-modal');
    const cPanel = el('div', 'panel confirm-panel');
    cPanel.appendChild(el('div', 'confirm-text', 'ТОЧНО? ПРОГРЕСС БУДЕТ УДАЛЁН'));
    const cYes = el('button', 'btn btn--danger btn--md', 'ДА');
    cYes.type = 'button';
    cYes.onclick = () => {
      this.game.save.reset();
      window.location.reload();
    };
    const cNo = el('button', 'btn btn--blue btn--md', 'НЕТ');
    cNo.type = 'button';
    cNo.onclick = () => {
      this.game.audio.play('ui_click');
      this.confirmModal.classList.remove('confirm-modal--show');
    };
    const cBtns = el('div', 'confirm-btns');
    cBtns.append(cYes, cNo);
    cPanel.appendChild(cBtns);
    this.confirmModal.appendChild(cPanel);
    this.el.appendChild(this.confirmModal);
  }

  private async setControl(c: Control): Promise<void> {
    if (c === 'tilt') {
      // наклон — только после deviceorientation permission (ui.md §3.9)
      try {
        const doe = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
        if (typeof doe.requestPermission === 'function') {
          const res = await doe.requestPermission();
          if (res !== 'granted') c = 'swipe';
        }
      } catch {
        c = 'swipe'; // отказ/ошибка → принудительно СВАЙП
      }
    }
    this.game.audio.play('ui_click');
    try {
      localStorage.setItem(CONTROL_KEY, c);
    } catch {
      /* private mode */
    }
    this.sync();
  }

  private commit(): void {
    this.game.save.save(this.game.meta.save);
    const s = this.game.meta.save.settings;
    this.game.bus.emit('settings_changed', {
      music: s.music,
      sfx: s.sfx,
      reducedMotion: s.reducedMotion,
      quality: s.quality,
    });
  }

  private sync(): void {
    const s = this.game.meta.save.settings;
    this.setToggle(this.musicToggle, s.music);
    this.setToggle(this.soundToggle, s.sfx);
    this.setToggle(this.motionToggle, s.reducedMotion);
    const seg = this.controlSeg;
    if (seg) {
      let current: Control = 'swipe';
      try {
        current = (localStorage.getItem(CONTROL_KEY) as Control | null) ?? 'swipe';
      } catch {
        /* private mode */
      }
      seg.querySelectorAll<HTMLButtonElement>('.segment__btn').forEach((b) => {
        b.classList.toggle('segment__btn--active', b.dataset.control === current);
      });
    }
  }

  private setToggle(t: HTMLButtonElement, on: boolean): void {
    t.classList.toggle('toggle--on', on);
    t.setAttribute('aria-checked', String(on));
  }

  protected override onShow(): void {
    this.confirmModal.classList.remove('confirm-modal--show');
    this.sync();
  }
}
