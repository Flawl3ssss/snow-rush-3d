import type { Game } from '@/game/Game';
import { BOOST, TRACK } from '@/config';
import { clamp, lerp, msToKmh } from '@/utils/math';
import { Screen, el, iconButton, iconImg } from './Screen';

/**
 * RUN HUD (ui.md §3.4): дистанция top-center (+NEW BEST бейдж с короной),
 * спидометр bottom-left (дуга 0–120 км/ч), вертикальная шкала прогресса
 * right-center с маркерами (ракета 45% / алмаз 70% / BEST / флаг), мини-чип
 * монет заезда, кнопка буста с кольцом-прогрессом, рестарт/пауза top-right,
 * красные виньетки у краёв трассы.
 */
export class HudScreen extends Screen {
  private readonly distance: HTMLDivElement;
  private readonly bestBadge: HTMLDivElement;
  private readonly nearMissBadge: HTMLDivElement;
  private readonly speedValue: HTMLDivElement;
  private readonly speedArc: HTMLDivElement;
  private readonly speedDial: HTMLDivElement;
  private readonly progressFill: HTMLDivElement;
  private readonly progressLabel: HTMLDivElement;
  private readonly bestMarker: HTMLDivElement;
  private readonly coinValue: HTMLSpanElement;
  private readonly coinChip: HTMLDivElement;
  private readonly boostBtn: HTMLButtonElement;
  private readonly boostCount: HTMLSpanElement;
  private readonly boostRing: HTMLDivElement;
  private readonly edgeLeft: HTMLDivElement;
  private readonly edgeRight: HTMLDivElement;
  private shownProgress = 0;

  private readonly game: Game;

  constructor(root: HTMLElement, game: Game) {
    super(root, 'screen-hud');
    this.game = game;

    // --- дистанция top-center (фикс. слот под «9999m») ---
    const distWrap = el('div', 'hud-distance-wrap');
    this.distance = el('div', 'hud-distance text-outline--big', '0m');
    this.bestBadge = el('div', 'hud-best-badge text-outline');
    this.bestBadge.append(iconImg('/icon-crown.png', 'hud-best-badge__icon'), document.createTextNode('NEW BEST!'));
    this.nearMissBadge = el('div', 'hud-nearmiss-badge text-outline', 'РИСК!');
    distWrap.append(this.distance, this.bestBadge, this.nearMissBadge);

    // --- спидометр bottom-left ---
    this.speedDial = el('div', 'hud-speedo');
    this.speedArc = el('div', 'hud-speedo__arc');
    const speedInner = el('div', 'hud-speedo__inner');
    this.speedValue = el('div', 'hud-speedo__value text-outline', '0');
    speedInner.append(this.speedValue, el('div', 'hud-speedo__unit', 'KM/H'));
    this.speedDial.append(this.speedArc, speedInner);

    // --- шкала прогресса right-center (зона G) ---
    const progressWrap = el('div', 'hud-progress');
    const flag = iconImg('/icon-flag.png', 'hud-progress__flag');
    const track = el('div', 'hud-progress__track');
    this.progressFill = el('div', 'hud-progress__fill');
    // маркеры: ракета 45%, алмаз 70% (ui.md §3.4.4)
    const rocketMarker = this.makeMarker('/icon-rocket.png', 45, 'Ракета');
    const diamondMarker = this.makeMarker('/icon-diamond.png', 70, 'Алмаз');
    this.bestMarker = el('div', 'hud-progress__marker hud-progress__best');
    this.bestMarker.append(iconImg('/icon-crystal.png', 'hud-progress__marker-icon'), el('span', 'hud-progress__best-label', 'BEST'));
    track.append(this.progressFill, rocketMarker, diamondMarker, this.bestMarker);
    this.progressLabel = el('div', 'hud-progress__label text-outline', '0%');
    progressWrap.append(flag, track, this.progressLabel);

    // --- счётчик монет заезда top-left ---
    this.coinChip = el('div', 'currency-chip hud-coins');
    this.coinChip.appendChild(iconImg('/icon-coin.png', 'currency-chip__icon'));
    this.coinValue = el('span', 'currency-chip__value text-outline', '0');
    this.coinChip.appendChild(this.coinValue);

    // --- кнопка буста bottom-right (зона E) ---
    this.boostBtn = el('button', 'btn btn--orange hud-boost');
    this.boostBtn.type = 'button';
    this.boostBtn.setAttribute('aria-label', 'Ракета-буст');
    this.boostRing = el('div', 'hud-boost__ring');
    this.boostBtn.append(this.boostRing, iconImg('/icon-flame.png', 'hud-boost__icon'));
    this.boostCount = el('span', 'hud-boost__count', '×0');
    this.boostBtn.appendChild(this.boostCount);
    this.boostBtn.onclick = () => game.tryBoost(); // тот же интент, что и Shift (gdd §8)

    // --- кнопки top-right (зона B): шестерёнка → пауза, рестарт ---
    const sysBtns = el('div', 'hud-sysbtns');
    sysBtns.append(
      iconButton('/icon-gear.png', '', () => {
        game.audio.play('ui_click');
        game.togglePause(); // в RUN шестерёнка → PAUSE (ui.md §3.4.8)
      }, 'Пауза'),
      iconButton('/icon-restart.png', '', () => {
        game.audio.play('ui_click');
        game.restartRun();
      }, 'Заново'),
    );

    // --- виньетки краёв трассы (ui.md §3.4.7) ---
    this.edgeLeft = el('div', 'hud-edge hud-edge--left');
    this.edgeRight = el('div', 'hud-edge hud-edge--right');

    this.el.append(distWrap, this.speedDial, progressWrap, this.coinChip, this.boostBtn, sysBtns, this.edgeLeft, this.edgeRight);

    game.bus.on('coin_collected', ({ runTotal }) => {
      this.coinValue.textContent = String(runTotal);
      this.punchCoins();
    });
    game.bus.on('new_best', () => {
      this.bestBadge.classList.add('hud-best-badge--show');
      window.setTimeout(() => this.bestBadge.classList.remove('hud-best-badge--show'), 1500);
    });
    game.bus.on('boost_started', () => this.boostBtn.classList.add('hud-boost--active'));
    game.bus.on('boost_ended', () => this.boostBtn.classList.remove('hud-boost--active'));
    // near-miss: пролёт впритык — бейдж «РИСК!» (промт §4/§10)
    game.bus.on('near_miss', () => {
      this.nearMissBadge.classList.remove('hud-nearmiss-badge--show');
      // перезапуск CSS-анимации
      void this.nearMissBadge.offsetWidth;
      this.nearMissBadge.classList.add('hud-nearmiss-badge--show');
      this.punchCoins();
    });
  }

  private makeMarker(icon: string, pct: number, label: string): HTMLDivElement {
    const marker = el('div', 'hud-progress__marker');
    marker.style.bottom = `${pct}%`;
    marker.title = label;
    marker.appendChild(iconImg(icon, 'hud-progress__marker-icon'));
    return marker;
  }

  reset(): void {
    this.shownProgress = 0;
    this.el.classList.remove('screen-hud--faded');
    this.coinValue.textContent = '0';
    this.distance.textContent = '0m';
    this.progressLabel.textContent = '0%';
    this.progressFill.style.height = '0%';
    this.edgeLeft.style.opacity = '0';
    this.edgeRight.style.opacity = '0';
    const best = this.game.meta.best;
    const finish = this.game.currentTrack.finishDistance;
    this.bestMarker.style.bottom = `${Math.min(100, (best / finish) * 100)}%`;
    this.bestMarker.style.display = best > 0 && best < finish ? 'flex' : 'none';
    this.boostCount.textContent = `×${this.game.economy.rockets}`;
  }

  fadeOut(): void {
    this.el.classList.add('screen-hud--faded');
  }

  punchCoins(): void {
    this.coinChip.animate(
      [{ transform: 'scale(1.2)' }, { transform: 'scale(1)' }],
      { duration: 120, easing: 'ease-out' },
    );
  }

  override update(delta: number): void {
    const s = this.game.currentSession;
    if (!s) return;
    this.distance.textContent = `${Math.floor(s.distance)}m`;

    // спидометр: дуга #5FE3FF→#FF9F2E, шкала 0–120 км/ч, пульс >80
    const kmh = Math.round(msToKmh(s.v));
    this.speedValue.textContent = String(kmh);
    const arc = clamp(kmh / 120, 0, 1);
    this.speedArc.style.background = `conic-gradient(from -135deg, #5FE3FF 0deg, #FF9F2E ${arc * 270}deg, rgba(34,49,74,0.25) ${arc * 270}deg 270deg, transparent 270deg 360deg)`;
    this.speedDial.classList.toggle('hud-speedo--hot', kmh > 80);

    // шкала прогресса: плавное заполнение (lerp 6/с, design.md §6.2)
    this.shownProgress = lerp(this.shownProgress, s.progress, Math.min(1, 6 * delta));
    this.progressFill.style.height = `${this.shownProgress * 100}%`;
    this.progressLabel.textContent = `${Math.round(s.progress * 100)}%`;
    // маркер BEST мигает при приближении (±5%)
    const nearBest = Math.abs(s.progress * 100 - parseFloat(this.bestMarker.style.bottom)) < 5;
    this.bestMarker.classList.toggle('hud-progress__best--near', nearBest);

    // буст: бейдж ×N, кольцо-прогресс 3 с, disabled при 0
    this.boostCount.textContent = `×${this.game.economy.rockets}`;
    const noRockets = this.game.economy.rockets <= 0 && !s.boosting;
    this.boostBtn.classList.toggle('btn--disabled', noRockets);
    this.boostBtn.classList.toggle('btn--orange', !noRockets);
    if (s.boosting) {
      const k = clamp(s.boostTimer / BOOST.duration, 0, 1);
      this.boostRing.style.background = `conic-gradient(#FFC93C ${k * 360}deg, rgba(34,49,74,0.3) ${k * 360}deg 360deg)`;
      this.boostRing.style.opacity = '1';
    } else {
      this.boostRing.style.opacity = '0';
    }

    // виньетки краёв трассы: >80% halfW → opacity 0→0.25
    const over = clamp((Math.abs(s.x) / TRACK.halfW - 0.8) / 0.2, 0, 1) * 0.25;
    this.edgeLeft.style.opacity = s.x < 0 ? String(over.toFixed(3)) : '0';
    this.edgeRight.style.opacity = s.x > 0 ? String(over.toFixed(3)) : '0';
  }
}
