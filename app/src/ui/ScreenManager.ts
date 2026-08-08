import type { Game } from '@/game/Game';
import { LoadingScreen } from './screens/LoadingScreen';
import { MenuScreen } from './screens/MenuScreen';
import { AimScreen } from './screens/AimScreen';
import { HudScreen } from './screens/HudScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { PauseScreen } from './screens/PauseScreen';
import { ShopScreen } from './screens/ShopScreen';
import { TasksScreen } from './screens/TasksScreen';
import { ChestScreen } from './screens/ChestScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { StatsPanel } from './screens/StatsPanel';
import { LevelUpScreen } from './screens/LevelUpScreen';
import type { LevelUpReward } from './screens/LevelUpScreen';
import type { ModalScreen } from './screens/ModalScreen';
import { BannerManager } from './BannerManager';
import { resetContinueForRun } from './meta-bridge';

export type ScreenName = 'loading' | 'menu' | 'aim' | 'hud' | 'results';
export type OverlayName = 'shop' | 'tasks' | 'chest' | 'settings' | 'stats';

/**
 * ScreenManager — DOM-оверлей поверх canvas (НЕ React, design.md §10).
 * Полные экраны по ui.md: loading / menu / aim / hud / results + модальные
 * оверлеи (shop, tasks, chest, settings, stats, level-up) + слой баннеров.
 * Публичные методы showOnly/showPause/update — зафиксированный контракт
 * (docs/ARCHITECTURE.md), расширение: openOverlay/closeOverlays.
 */
export class ScreenManager {
  readonly root: HTMLDivElement;
  readonly loading: LoadingScreen;
  readonly menu: MenuScreen;
  readonly aim: AimScreen;
  readonly hud: HudScreen;
  readonly results: ResultsScreen;
  readonly pause: PauseScreen;
  readonly shop: ShopScreen;
  readonly tasks: TasksScreen;
  readonly chest: ChestScreen;
  readonly settings: SettingsScreen;
  readonly stats: StatsPanel;
  readonly levelUp: LevelUpScreen;
  readonly banners: BannerManager;

  private active: ScreenName | null = null;
  private readonly overlays: Record<OverlayName, ModalScreen>;
  private pendingLevelUps: LevelUpReward[] = [];

  constructor(container: HTMLElement, game: Game) {
    this.root = document.createElement('div');
    this.root.id = 'ui-root';
    container.appendChild(this.root);

    this.loading = new LoadingScreen(this.root);
    this.shop = new ShopScreen(this.root, game);
    this.tasks = new TasksScreen(this.root, game);
    this.chest = new ChestScreen(this.root, game);
    this.settings = new SettingsScreen(this.root, game);
    this.stats = new StatsPanel(this.root, game);
    this.levelUp = new LevelUpScreen(this.root, game);

    this.menu = new MenuScreen(this.root, game, {
      openShop: () => this.openOverlay('shop'),
      openTasks: () => this.openOverlay('tasks'),
      openChest: () => this.openOverlay('chest'),
      openSettings: () => this.openOverlay('settings'),
      openStats: () => this.openOverlay('stats'),
    });
    this.aim = new AimScreen(this.root, game, () => this.openOverlay('settings'));
    this.hud = new HudScreen(this.root, game);
    this.results = new ResultsScreen(this.root, game);
    this.pause = new PauseScreen(this.root, game, () => this.openOverlay('settings'));

    this.overlays = {
      shop: this.shop,
      tasks: this.tasks,
      chest: this.chest,
      settings: this.settings,
      stats: this.stats,
    };
    this.banners = new BannerManager(this.root, game);

    // --- мета-события движка ---
    game.bus.on('run_started', () => resetContinueForRun());
    game.bus.on('level_up', (p) => {
      // показываем ПОСЛЕ закрытия результатов (ui.md §3.11)
      this.pendingLevelUps.push(p);
      if (game.state === 'menu') this.flushLevelUps();
    });
    game.bus.on('state_changed', ({ from }) => {
      if (from === 'results') this.flushLevelUps();
      if (from === 'menu' || from === 'aim') this.closeOverlays();
    });

    // --- клавиатура: модалки перехватывают Space/Enter у InputController ---
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.anyOverlayOpen() && (e.key === ' ' || e.key === 'Enter')) {
          e.stopPropagation();
        }
      },
      true,
    );

    this.syncReducedMotion(game);
    game.bus.on('settings_changed', () => this.syncReducedMotion(game));
  }

  // ================= базовые экраны (контракт) =================

  showOnly(name: ScreenName | null): void {
    this.active = name;
    this.loading.setVisible(name === 'loading');
    this.menu.setVisible(name === 'menu');
    this.aim.setVisible(name === 'aim');
    this.hud.setVisible(name === 'hud');
    this.results.setVisible(name === 'results');
    if (name !== null) this.pause.setVisible(false);
  }

  showPause(v: boolean): void {
    this.pause.setVisible(v);
    if (!v) this.settings.setVisible(false);
  }

  update(delta: number, elapsed: number): void {
    if (this.active === 'hud') this.hud.update(delta);
    if (this.active === 'menu') this.menu.update(elapsed);
    this.tasks.update(delta);
    this.chest.update(delta);
  }

  // ================= оверлеи =================

  openOverlay(name: OverlayName): void {
    for (const [key, overlay] of Object.entries(this.overlays)) {
      overlay.setVisible(key === name);
    }
  }

  closeOverlays(): void {
    for (const overlay of Object.values(this.overlays)) overlay.setVisible(false);
  }

  anyOverlayOpen(): boolean {
    return Object.values(this.overlays).some((o) => o.visible) || this.levelUp.visible;
  }

  // ================= level-up очередь =================

  private flushLevelUps(): void {
    const last = this.pendingLevelUps[this.pendingLevelUps.length - 1];
    if (!last) return;
    // несколько level-up подряд схлопываем в один экран с суммарными наградами
    const total = this.pendingLevelUps.reduce<LevelUpReward>(
      (acc, p) => ({
        level: p.level,
        coins: acc.coins + p.coins,
        crystals: acc.crystals + p.crystals,
        diamonds: acc.diamonds + p.diamonds,
        rockets: acc.rockets + p.rockets,
      }),
      { level: last.level, coins: 0, crystals: 0, diamonds: 0, rockets: 0 },
    );
    this.pendingLevelUps = [];
    this.levelUp.showLevel(total);
  }

  // ================= reduced motion (design.md §6.3) =================

  private syncReducedMotion(game: Game): void {
    const reduced =
      game.meta.save.settings.reducedMotion ||
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    this.root.classList.toggle('ui-reduced-motion', reduced);
  }
}
