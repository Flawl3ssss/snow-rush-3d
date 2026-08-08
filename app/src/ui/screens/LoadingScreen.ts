import { Screen, el, iconImg } from './Screen';

const TIPS = [
  'СОВЕТ: ЛЕДЯНАЯ ПОЛОСА — БЫСТРЕЕ, НО СКОЛЬЗКО!',
  'СОВЕТ: РАКЕТА ПРОБИВАЕТ ПРЕПЯТСТВИЯ НА ПОЛНОМ ХОДУ!',
  'СОВЕТ: ТЯНИ РОГАТКУ ДО 90%+ — ТАМ СЛАДКАЯ ЗОНА!',
  'СОВЕТ: АПГРЕЙД SLED ДЕЛАЕТ РУЛЕНИЕ РЕЗЧЕ!',
  'СОВЕТ: ФИНИШ БЕЗ АВАРИЙ ДАЁТ БОНУСНЫЙ XP!',
];

/** LOADING (ui.md §3.1): loading-bg, логотип, прогресс-бар, ротация советов. */
export class LoadingScreen extends Screen {
  private readonly fill: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private tipTimer: number | null = null;
  private tipIndex = 0;

  constructor(root: HTMLElement) {
    super(root, 'screen-loading');
    const bg = iconImg('/loading-bg.png', 'loading-bg');
    const dim = el('div', 'loading-dim');
    const center = el('div', 'loading-center');
    const logo = iconImg('/logo.png', 'loading-logo', 'SNOW RUSH');
    logo.onerror = () => {
      // fallback: текстовый логотип до появления ассета
      logo.style.display = 'none';
      center.prepend(el('div', 'loading-logo-text text-outline--big', 'SNOW RUSH'));
    };
    const bar = el('div', 'loading-bar');
    this.fill = el('div', 'loading-bar__fill');
    bar.appendChild(this.fill);
    this.label = el('div', 'loading-label text-outline', 'ЗАГРУЗКА… 0%');
    center.append(logo, bar, this.label);
    this.tip = el('div', 'loading-tip text-outline', TIPS[0]);
    this.el.append(bg, dim, center, this.tip);
  }

  setProgress(p: number): void {
    this.fill.style.width = `${p}%`;
    this.label.textContent = `ЗАГРУЗКА… ${p}%`;
  }

  protected override onShow(): void {
    this.setProgress(0);
    this.tipIndex = 0;
    this.tip.textContent = TIPS[0];
    // ротация советов (ui.md §3.1)
    this.tipTimer = window.setInterval(() => {
      this.tipIndex = (this.tipIndex + 1) % TIPS.length;
      this.tip.style.opacity = '0';
      window.setTimeout(() => {
        this.tip.textContent = TIPS[this.tipIndex];
        this.tip.style.opacity = '1';
      }, 200);
    }, 2500);
  }

  protected override onHide(): void {
    if (this.tipTimer !== null) {
      clearInterval(this.tipTimer);
      this.tipTimer = null;
    }
  }
}
