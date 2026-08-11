import * as THREE from 'three';
import { CAMERA, ECONOMY, PHYSICS, SLINGSHOT, tierForLevel } from '@/config';
import { Loop } from '@/core/Loop';
import { Renderer } from '@/core/Renderer';
import { InputController } from '@/core/InputController';
import { SaveSystem } from '@/core/SaveSystem';
import { EventBus } from '@/utils/events';
import type { RunResults } from '@/utils/events';
import { TweenManager, easeOutCubic, easeOutBack } from '@/utils/tween';
import { Track } from '@/entities/Track';
import { PlayerTube } from '@/entities/PlayerTube';
import { Slingshot } from '@/entities/Slingshot';
import { TrackBuilder } from '@/systems/TrackBuilder';
import type { TrackContent } from '@/systems/TrackBuilder';
import { CameraRig } from '@/systems/CameraRig';
import { ShakeRig } from '@/systems/ShakeRig';
import { ParticleSystem } from '@/systems/ParticleSystem';
import { AudioSystem } from '@/systems/AudioSystem';
import { MetaProgression } from './meta/MetaProgression';
import { Economy } from './meta/Economy';
import { RunSession } from './RunSession';
import { ScreenManager } from '@/ui/ScreenManager';
import { disposeObject3D } from '@/utils/dispose';
import { clamp, degToRad } from '@/utils/math';

export type GameState =
  | 'loading'
  | 'menu'
  | 'aim'
  | 'launch'
  | 'run'
  | 'crash'
  | 'stopped'
  | 'finish'
  | 'results'
  | 'pause';

/** Тестовые хуки (scaffold-конвенция threejs-gameplay-systems). */
export interface GameTestHooks {
  setState: (state: GameState) => void;
  getState: () => Record<string, unknown>;
  startRun: (power?: number) => void;
  setReducedMotion: (v: boolean) => void;
  seed: (n: number) => void;
}

declare global {
  interface Window {
    __THREE_GAME_TEST_HOOKS__?: GameTestHooks;
    __THREE_GAME_DIAGNOSTICS__?: Record<string, unknown>;
  }
}

/**
 * Game — state machine + оркестрация кадра (gdd §3, design §10).
 * Порядок кадра: input intents → fixed-step симуляция (1/60, аккумулятор,
 * clamp delta ≤0.1) → коллизии/события → камера/VFX/HUD → render.
 */
export class Game {
  readonly bus = new EventBus();
  readonly save: SaveSystem;
  readonly meta: MetaProgression;
  readonly economy: Economy;
  readonly audio: AudioSystem;

  private readonly renderer: Renderer;
  private readonly loop: Loop;
  private readonly input: InputController;
  private readonly tweens = new TweenManager();
  private readonly shake = new ShakeRig();
  private readonly cameraRig: CameraRig;
  private readonly screens: ScreenManager;
  private snow: ParticleSystem | null = null;

  private track!: Track;
  private content: TrackContent | null = null;
  private session: RunSession | null = null;
  private readonly tube = new PlayerTube();
  private readonly slingshot = new Slingshot();
  private readonly slingshotBase = new THREE.Vector3();

  state: GameState = 'loading';
  private prevState: GameState = 'menu';

  // --- time control ---
  private timeScale = 1;
  private hitstopRemaining = 0;
  /** W4: качество последнего приземления (land_clean/land_hard → сила squash). */
  private landQuality: 'clean' | 'hard' | 'normal' = 'normal';
  private slowMoRemaining = 0;
  private accumulator = 0;

  // --- aim/launch ---
  private pullPower = 0;
  private holdStartTime = -1;
  private fullHoldTime = 0;
  private launchTimer = 0;
  private launchSpeed = 0;
  private readonly launchFrom = new THREE.Vector3();

  // --- crash/results ---
  private crashTimer = 0;
  private crashDuration = 1.2;
  private crashSlowMo = 0;
  private crashImpactV = 0;
  private results: RunResults | null = null;
  /** 0 = пингвин лицом к камере (меню/AIM/финиш), 1 = спиной (заезд). */
  private backFacing = 0;

  private runSeedBase = 1;
  private runCount = 0;
  private reducedMotion = false;
  private debugPanel: import('@/systems/DebugPanel').DebugPanel | null = null;

  private readonly flashEl: HTMLDivElement;
  private readonly edgeFlashEl: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.save = new SaveSystem();
    const data = this.save.load();
    this.meta = new MetaProgression(data);
    this.economy = new Economy(data, this.meta, this.bus);
    this.audio = new AudioSystem(this.bus);
    this.reducedMotion =
      data.settings.reducedMotion ||
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

    this.renderer = new Renderer(container);
    this.cameraRig = new CameraRig(this.renderer.camera);
    this.cameraRig.setReducedMotion(this.reducedMotion);
    this.shake.scale = this.reducedMotion ? 0.25 : 1;

    this.input = new InputController(this.renderer.renderer.domElement);
    this.input.handlers = {
      onTap: () => this.handleTap(),
      onPullRelease: (p) => this.handlePullRelease(p),
      onBoost: () => this.tryBoost(),
      onPause: () => this.togglePause(),
      onRestart: () => this.restartRun(),
      onBack: () => this.handleBack(),
      onConfirm: () => this.handleConfirm(),
    };

    // DOM FX-слои (design.md §5.3: виньетка, вспышки)
    const vignette = document.createElement('div');
    vignette.className = 'fx-vignette';
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'fx-flash';
    this.edgeFlashEl = document.createElement('div');
    this.edgeFlashEl.className = 'fx-edge-flash';
    container.append(vignette, this.flashEl, this.edgeFlashEl);

    this.screens = new ScreenManager(container, this);

    this.bindFeedback();

    // Визуальная эволюция тюбинга/рогатки по тирам апгрейдов (промт §9)
    const applyUpgradeTiers = (): void => {
      this.tube.applyTier(tierForLevel(this.meta.getUpgradeLevel('sled')));
      this.slingshot.applyTier(tierForLevel(this.meta.getUpgradeLevel('slingshot')));
    };
    applyUpgradeTiers();
    this.bus.on('upgrade_purchased', applyUpgradeTiers);

    // автосохранение при уходе со страницы (gdd §6)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save.save(this.meta.save);
    });

    this.loop = new Loop((d, t) => this.update(d, t));
    this.exposeTestHooks();

    // Пересборка мира при смене карты (селектор в меню, экономика v2)
    this.bus.on('map_changed', () => {
      if (this.state === 'menu') this.rebuildMapWorld();
    });
  }

  /** Полная пересборка трассы/контента/освещения под выбранную карту. */
  private rebuildMapWorld(): void {
    this.renderer.scene.remove(this.track.group);
    disposeObject3D(this.track.group);
    if (this.content) {
      this.renderer.scene.remove(this.content.group);
      disposeObject3D(this.content.group);
      this.content = null;
    }
    if (this.snow) {
      this.snow.dispose(this.renderer.scene);
      this.snow = null;
    }
    this.renderer.scene.remove(this.slingshot.group, this.tube.group);
    this.buildWorld();
    this.resetTubeToSlingshot();
    this.cameraRig.reset();
  }

  // ================= lifecycle =================

  start(): void {
    this.buildWorld();
    if (new URLSearchParams(window.location.search).get('debug') === '1') {
      void import('@/systems/DebugPanel').then((m) => {
        this.debugPanel = new m.DebugPanel(this);
      });
    }
    this.screens.showOnly('loading');
    // «Загрузка» — реальная инициализация уже сделана синхронно; короткий
    // прогресс для чтения логотипа, затем MENU (ui.md §3.1).
    let progress = 0;
    this.tweens.tween(
      0.9,
      (t) => {
        progress = Math.round(t * 100);
        this.screens.loading.setProgress(progress);
      },
      easeOutCubic,
      () => this.setState('menu'),
    );
    this.loop.start();
  }

  private buildWorld(): void {
    const map = this.meta.currentMap;
    this.runSeedBase = map.seed;
    this.track = new Track(this.meta.finishDistance, map.seed, map.palette, map.track);
    this.renderer.scene.add(this.track.group);
    this.renderer.applyBiome(map.palette);

    // Рогатка на стартовой площадке
    this.track.worldPos(0, -2, 0, this.slingshotBase);
    this.slingshot.group.position.copy(this.slingshotBase);
    this.renderer.scene.add(this.slingshot.group);
    this.cameraRig.origin.copy(this.slingshotBase);

    // Тюбинг в кармане рогатки
    this.renderer.scene.add(this.tube.group);
    this.placeTubeAtPocket(0);

    const snowCount = this.reducedMotion ? 400 : window.innerWidth < 600 ? 800 : 1200;
    this.snow = new ParticleSystem(this.renderer.scene, snowCount, this.runSeedBase);

    this.buildRunContent();
  }

  /** Пересборка контента заезда (препятствия/пикапы/декор) по seed заезда. */
  private buildRunContent(): void {
    if (this.content) {
      this.renderer.scene.remove(this.content.group);
      disposeObject3D(this.content.group);
    }
    const builder = new TrackBuilder();
    this.content = builder.build(this.track, this.runSeedBase + this.runCount);
    this.renderer.scene.add(this.content.group);
  }

  // ================= state machine =================

  setState(to: GameState): void {
    if (to === this.state) return;
    const from = this.state;
    this.state = to;
    this.bus.emit('state_changed', { from, to });

    // вход в состояния
    switch (to) {
      case 'menu':
        this.input.mode = 'menu';
        this.cameraRig.mode = 'menu';
        this.cameraRig.reset();
        this.renderer.setFogMode('menu');
        this.audio.setMusic('menu');
        this.screens.showOnly('menu');
        this.screens.menu.refresh();
        this.resetTubeToSlingshot();
        break;
      case 'aim':
        this.input.mode = 'aim';
        this.cameraRig.mode = 'aim';
        this.pullPower = 0;
        this.holdStartTime = -1;
        this.fullHoldTime = 0;
        this.slingshot.setPull(0);
        this.screens.showOnly('aim');
        this.screens.aim.setPower(0);
        break;
      case 'launch':
        this.input.mode = 'run';
        this.launchTimer = 0;
        this.screens.showOnly('hud');
        break;
      case 'run':
        this.input.mode = 'run';
        this.cameraRig.mode = 'run';
        this.renderer.setFogMode('run');
        this.audio.setMusic('run', this.meta.currentMap.id); // биомный трек (промт §5)
        this.screens.showOnly('hud');
        this.screens.hud.reset();
        this.cameraRig.snapToMode();
        break;
      case 'crash': {
        this.crashTimer = 0;
        const v = this.session?.v ?? 12;
        this.crashImpactV = v;
        // длительность сцены ∝ скорости удара (research W3: 2–4 с), slow-mo после hit-stop
        this.crashDuration = clamp(1.5 + this.crashImpactV * 0.07, 2.0, 4.0);
        this.crashSlowMo = 0.7;
        this.tube.startTumble(clamp(v / 30, 0.3, 1));
        this.screens.hud.fadeOut();
        break;
      }
      case 'stopped':
        this.screens.hud.fadeOut();
        this.endRun();
        break;
      case 'finish':
        this.slowMoRemaining = CAMERA.finish.duration;
        this.timeScale = CAMERA.finish.slowMo;
        this.cameraRig.mode = 'finish';
        this.screens.hud.fadeOut();
        break;
      case 'results':
        this.input.mode = 'ui';
        this.audio.setMusic('menu');
        this.screens.showOnly('results');
        if (this.results) this.screens.results.show(this.results);
        break;
      case 'pause':
        this.input.mode = 'ui';
        this.screens.showPause(true);
        this.audio.setDuck(0.3);
        break;
    }
  }

  /** TAP TO PLAY (menu) → AIM. */
  private handleTap(): void {
    this.audio.unlock();
    if (this.state === 'menu') this.toAim();
  }

  toAim(): void {
    if (this.state !== 'menu' && this.state !== 'results' && this.state !== 'run' && this.state !== 'pause') return;
    this.prepareRun();
    this.setState('aim');
  }

  /** Подготовка нового заезда: свежий контент, новая сессия. */
  private prepareRun(): void {
    this.runCount += 1;
    this.buildRunContent();
    this.session = new RunSession(
      this.runSeedBase + this.runCount,
      this.track,
      {
        obstacles: this.content!.obstacles,
        pickups: this.content!.pickups,
        ramps: this.content!.ramps,
        pads: this.content!.pads,
        icePatches: this.content!.icePatches,
      },
      this.meta,
      this.bus,
    );
    this.session.onPickupCollected = (p) => {
      p.playPop(this.tweens);
      this.screens.hud.punchCoins();
    };
    this.results = null;
    this.timeScale = 1;
    this.hitstopRemaining = 0;
    this.slowMoRemaining = 0;
    this.accumulator = 0;
    this.resetTubeToSlingshot();
    this.shake.reset();
    this.cameraRig.reset();
    this.bus.emit('run_started', { seed: this.session.seed, finishDistance: this.track.finishDistance });
  }

  private resetTubeToSlingshot(): void {
    this.tube.resetPose();
    this.backFacing = 0;
    this.placeTubeAtPocket(0);
    this.tube.group.visible = true;
  }

  private placeTubeAtPocket(p: number): void {
    const pocket = this.slingshot.getPocketPosition(p);
    this.tube.group.position.set(
      this.slingshotBase.x + pocket.x,
      this.slingshotBase.y + pocket.y,
      this.slingshotBase.z + pocket.z,
    );
    this.tube.group.rotation.set(0, 0, 0);
    this.slingshot.setPull(p);
  }

  // ================= aim / launch =================

  private updateAim(delta: number, time: number): void {
    let p = this.pullPower;
    if (this.input.pullDragPower !== null) {
      p = this.input.pullDragPower;
    } else if (this.input.pullHeld) {
      if (this.holdStartTime < 0) this.holdStartTime = time;
      // пила 0→100→0% (gdd §8.1)
      const phase = ((time - this.holdStartTime) % SLINGSHOT.holdCycleSec) / SLINGSHOT.holdCycleSec;
      p = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    } else {
      this.holdStartTime = -1;
    }
    if (p !== this.pullPower) {
      this.pullPower = p;
      this.bus.emit('pull_changed', { power: p });
      this.screens.aim.setPower(p);
      this.cameraRig.setAimBlend(p);
      this.cameraRig.setAimTensionPulse(p >= 0.9);
      this.placeTubeAtPocket(p);
    }
    // автоотпуск: > 4 с на 100% (gdd §4.2)
    if (p >= 0.99) {
      this.fullHoldTime += delta;
      if (this.fullHoldTime >= SLINGSHOT.autoReleaseSec) this.handlePullRelease(p);
    } else {
      this.fullHoldTime = 0;
    }
  }

  private handlePullRelease(dragPower: number | null): void {
    if (this.state !== 'aim') return;
    const p = dragPower ?? this.pullPower;
    this.input.pullHeld = false;
    this.input.pullDragPower = null;
    if (p < SLINGSHOT.cancelThreshold) {
      // отмена: резинка обратно (gdd §4.2)
      const from = this.pullPower;
      this.tweens.tween(0.18, (t) => {
        const k = from * (1 - t);
        this.pullPower = k;
        this.placeTubeAtPocket(k);
        this.screens.aim.setPower(k);
        this.cameraRig.setAimBlend(k);
      });
      return;
    }
    // LAUNCH (gdd §4.2): v_launch = (6 + 22·p)·(1 + 0.035·(SlingshotLevel−1))
    this.pullPower = p;
    this.launchSpeed = SLINGSHOT.launchSpeed(p, this.meta.getUpgradeLevel('slingshot'));
    this.launchFrom.copy(this.tube.group.position);
    this.bus.emit('launched', { power: p, speed: this.launchSpeed });
    this.landQuality = 'normal'; // W4: не тащить качество из прошлого заезда
    // squash & stretch + FOV-кик + trauma (design.md §6.1)
    this.tube.squash(this.tweens, 1.15, 0.18);
    this.cameraRig.punchFov(6);
    this.shake.addTrauma(0.25);
    this.setState('launch');
  }

  private updateLaunch(delta: number): void {
    this.launchTimer += delta;
    const t = clamp(this.launchTimer / SLINGSHOT.launchKinematicSec, 0, 1);
    // кинематика 0.4 с: тюбинг уходит вниз по склону на стартовую линию
    const targetS = 4;
    const target = new THREE.Vector3();
    this.track.worldPos(0, targetS, 0.05, target);
    this.tube.group.position.lerpVectors(this.launchFrom, target, easeOutCubic(t));
    this.slingshot.setPull(1 - t);
    // разворот пингвина спиной к камере: flip ~0.4 с с easeOutBack (промт §7)
    this.backFacing = clamp(easeOutBack(t), 0, 1.08);
    // overshoot (до ~194°) и доседание до 180° — пружинный flip
    this.tube.group.rotation.y = Math.PI * this.backFacing;
    // лёгкий наклон по склону при приземлении на трассу
    this.tube.group.rotation.x = -degToRad(this.track.slopeDegAt(targetS)) * 0.5 * t;
    if (t >= 1) {
      this.backFacing = 1;
      this.session!.launch(this.launchSpeed);
      this.setState('run');
    }
  }

  // ================= run =================

  private updateRun(gameplayDelta: number): void {
    if (!this.session || this.session.endReason) return;
    this.accumulator = Math.min(this.accumulator + gameplayDelta, 0.25);
    while (this.accumulator >= PHYSICS.fixedDt) {
      this.session.step(PHYSICS.fixedDt, this.input.steerTarget);
      this.accumulator -= PHYSICS.fixedDt;
      if (this.session.endReason) break;
    }
    if (this.session.endReason === 'crash') this.setState('crash');
    else if (this.session.endReason === 'stopped') this.setState('stopped');
    else if (this.session.endReason === 'finish') this.setState('finish');
  }

  /** Ракета-буст (Shift / кнопка HUD) — gdd §4.4. */
  tryBoost(): void {
    if (this.state !== 'run' || !this.session || this.session.boosting) return;
    if (!this.economy.useRocket()) return;
    this.session.startBoost();
    this.bus.emit('boost_started', { rocketsLeft: this.economy.rockets });
    this.cameraRig.punchFov(8);
    this.shake.addTrauma(0.1);
  }

  /**
   * «Второй шанс» (gdd §5.7): возобновление заезда после краша.
   * Вызывается UI (ResultsScreen → meta-bridge.resumeAfterContinue) после spendContinue().
   * Респавн: та же позиция, v=10 м/с, инвулн 2 с, чистка препятствий 15 м.
   */
  continueRun(): boolean {
    if (this.state !== 'results' || !this.session || !this.results?.crashed) return false;
    if (this.session.endReason !== 'crash') return false;
    this.session.revive();
    this.results = null;
    this.tube.resetPose();
    this.setState('run');
    return true;
  }

  /** Мгновенный рестарт заезда (R, кнопка HUD, пауза) — часть петли (ui.md §3.4). */
  restartRun(): void {
    if (this.state === 'run' || this.state === 'pause' || this.state === 'aim') {
      if (this.state === 'pause') this.screens.showPause(false);
      this.prepareRun();
      this.setState('aim');
    }
  }

  private handleBack(): void {
    if (this.state === 'aim') this.setState('menu');
    else if (this.state === 'pause') this.resumeFromPause();
  }

  private handleConfirm(): void {
    if (this.state === 'results') this.toAim();
  }

  togglePause(): void {
    if (this.state === 'run' || this.state === 'aim') {
      this.prevState = this.state;
      this.setState('pause');
    } else if (this.state === 'pause') {
      this.resumeFromPause();
    }
  }

  resumeFromPause(): void {
    this.screens.showPause(false);
    this.audio.setDuck(1);
    this.setState(this.prevState === 'pause' ? 'run' : this.prevState);
  }

  quitToMenu(): void {
    this.screens.showPause(false);
    this.audio.setDuck(1);
    this.session = null;
    this.setState('menu');
  }

  // ================= конец заезда / награды (gdd §4.7, §5) =================

  private endRun(): void {
    if (!this.session) return;
    const s = this.session;
    const d = Math.floor(s.distance);
    const incomeMult = this.meta.incomeMult;

    // Дельта-банкинг: после «второго шанса» не платим дважды за тот же прогресс
    const deltaD = Math.max(0, d - s.bankedDistance);
    const coinsCollected = Math.max(0, Math.floor(s.coinsFloat - s.bankedCoinsFloat));
    const deltaCrystals = Math.max(0, s.crystals - s.bankedCrystals);
    const deltaDiamonds = Math.max(0, s.diamonds - s.bankedDiamonds);

    // Множители биома (экономика v2): поздние карты богаче, но и цели дороже
    const mapMul = this.meta.currentMap;
    const distanceBonus = Math.floor(deltaD * ECONOMY.distanceCoinRate * incomeMult * mapMul.coinMul);
    const finishBonus = s.finished ? Math.floor(ECONOMY.finishCoinBonus * incomeMult * mapMul.coinMul) : 0;
    const coinsEarned = coinsCollected + distanceBonus + finishBonus;

    let crystalsEarned =
      deltaCrystals + (s.finished ? Math.floor(ECONOMY.finishCrystals * mapMul.crystalMul) : 0);
    const isNewBest = d > this.meta.best;
    if (isNewBest && this.meta.best > 0) {
      crystalsEarned += Math.min(
        ECONOMY.recordCrystalMax,
        Math.floor((d - this.meta.best) / 50) * ECONOMY.recordCrystalPer50m,
      );
    }
    const diamondsEarned = deltaDiamonds;

    const xpEarned =
      Math.round(deltaD * ECONOMY.xpPerMeter) +
      (s.finished ? ECONOMY.finishXp : 0) +
      (s.crashFree ? ECONOMY.crashFreeXp : 0);

    // начисление
    this.economy.addCoins(coinsEarned);
    this.economy.addCrystals(crystalsEarned);
    if (diamondsEarned > 0) this.economy.addDiamonds(diamondsEarned);
    this.meta.recordDistance(d);
    this.meta.addRunStats(deltaD);
    const levelUps = this.meta.addXp(xpEarned);
    for (const lvl of levelUps) this.economy.grantLevelUp(lvl);

    // отметки банкинга (на случай continue + повторного endRun)
    s.bankedDistance = d;
    s.bankedCoinsFloat = s.coinsFloat;
    s.bankedCrystals = s.crystals;
    s.bankedDiamonds = s.diamonds;

    this.results = {
      distance: d,
      best: this.meta.best,
      isNewBest,
      finished: s.finished,
      crashed: s.endReason === 'crash',
      crashFree: s.crashFree,
      coinsCollected,
      crystalsCollected: s.crystals,
      diamondsCollected: s.diamonds,
      coinsEarned,
      crystalsEarned,
      diamondsEarned,
      xpEarned,
      levelUps,
    };
    this.save.save(this.meta.save);
    this.bus.emit('run_finished', this.results);
    this.setState('results');
  }

  // ================= фидбек (подписки на события) =================

  private bindFeedback(): void {
    this.bus.on('coin_collected', () => {
      this.shake.addTrauma(PHYSICS.coinTrauma);
    });
    this.bus.on('collision', (p) => {
      if (p.kind === 'light') {
        // hitstop 70 мс @0.05, trauma 0.4, squash, красная вспышка краёв
        this.hitstop(PHYSICS.lightHitstopMs, 0.05);
        this.shake.addTrauma(PHYSICS.lightHitTrauma);
        this.tube.squash(this.tweens, 0.85, 0.18);
        this.flashEdges();
      } else if (p.kind === 'wall') {
        this.shake.addTrauma(PHYSICS.wallTrauma);
      } else if (p.kind === 'boostpad') {
        this.cameraRig.punchFov(4);
      }
    });
    this.bus.on('crash', () => {
      this.hitstop(PHYSICS.crashHitstopMs, 0.05);
      this.shake.addTrauma(PHYSICS.crashTrauma);
      this.flashWhite();
      this.audio.playCrashWhomp(clamp((this.session?.v ?? 12) / 30, 0.3, 1));
    });
    this.bus.on('jump', () => {
      this.tube.squash(this.tweens, 1.15, 0.18);
      this.cameraRig.punchFov(4);
    });
    // W4: сила squash зависит от качества приземления (RunSession уже
    // различает land_clean/land_hard по углу входа vs уклону склона).
    // Порядок событий в RunSession: land_clean|land_hard → land, поэтому
    // качество запоминаем флагом и потребляем в обработчике 'land'.
    this.bus.on('land_clean', () => {
      this.landQuality = 'clean';
    });
    this.bus.on('land_hard', () => {
      this.landQuality = 'hard';
    });
    this.bus.on('land', () => {
      const q = this.landQuality;
      this.landQuality = 'normal';
      if (q === 'clean') {
        // чистое приземление — лёгкая упругая просадка, без тряски сверх нормы
        this.tube.squash(this.tweens, 0.92, 0.14);
        this.shake.addTrauma(PHYSICS.ramp.landTrauma * 0.7);
      } else if (q === 'hard') {
        // жёсткое — глубокий и долгий squash + усиленная встряска
        this.tube.squash(this.tweens, 0.78, 0.25);
        this.shake.addTrauma(PHYSICS.ramp.landTrauma * 1.6);
        this.cameraRig.punchFov(-2);
      } else {
        this.tube.squash(this.tweens, 0.9, 0.18);
        this.shake.addTrauma(PHYSICS.ramp.landTrauma);
      }
    });
    this.bus.on('finish', () => {
      this.flashWhite();
    });
  }

  /** Hitstop: scale gameplay delta, не render loop (game-feel). */
  hitstop(durationMs: number, scale = 0.05): void {
    this.hitstopRemaining = Math.max(this.hitstopRemaining, durationMs / 1000);
    this.timeScale = scale;
    this.audio.setDuck(0.6);
  }

  private flashWhite(): void {
    this.flashEl.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 110, easing: 'ease-out' });
  }

  private flashEdges(): void {
    this.edgeFlashEl.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 150, easing: 'ease-out' });
  }

  // ================= главный кадр =================

  private update(delta: number, elapsed: number): void {
    // --- time control (реальное время) ---
    if (this.hitstopRemaining > 0) {
      this.hitstopRemaining -= delta;
      if (this.hitstopRemaining <= 0) {
        // после hit-stop крэш уходит в slow-mo фазу (0.25), иначе — полный ход
        this.timeScale = this.state === 'crash' && this.crashSlowMo > 0 ? 0.25 : 1;
        if (this.timeScale === 1) this.audio.setDuck(1);
        else this.audio.setDuck(0.35);
      }
    }
    if (this.state === 'crash' && this.hitstopRemaining <= 0) {
      if (this.crashSlowMo > 0) {
        this.crashSlowMo -= delta;
        this.timeScale = 0.25;
        if (this.crashSlowMo <= 0) this.audio.setDuck(1);
      } else if (this.timeScale < 1) {
        // плавный выход из slow-mo (~0.35 с)
        this.timeScale = Math.min(1, this.timeScale + delta * 2.2);
      }
    }
    if (this.slowMoRemaining > 0) {
      this.slowMoRemaining -= delta;
      if (this.slowMoRemaining <= 0 && this.state === 'finish') {
        this.timeScale = 1;
        this.endRun();
      }
    }
    const paused = this.state === 'pause' || this.state === 'results' || this.state === 'menu' || this.state === 'loading';
    const gameplayDelta = paused ? 0 : delta * this.timeScale;

    // --- состояния ---
    switch (this.state) {
      case 'aim':
        this.updateAim(delta, elapsed);
        break;
      case 'launch':
        this.updateLaunch(gameplayDelta);
        break;
      case 'run':
      case 'finish':
        this.updateRun(gameplayDelta);
        break;
      case 'crash':
        this.crashTimer += delta; // реальное время — сцена длится crashDuration секунд
        this.tube.updateTumble(delta * Math.max(this.timeScale, 0.3));
        if (this.crashTimer >= this.crashDuration) this.endRun();
        break;
      default:
        break;
    }

    // --- синхронизация визуала с симуляцией ---
    this.syncVisuals(delta, elapsed);

    // --- камера / shake / твины (реальный delta) ---
    const playerPos = this.tube.group.position;
    this.cameraRig.update(
      delta,
      elapsed,
      playerPos,
      this.session?.vx ?? 0,
      this.session?.v ?? 0,
      this.state === 'run' || this.state === 'finish' ? this.track.headingAt(this.session?.s ?? 0) : 0,
      this.session?.airborne ?? false,
    );
    this.shake.update(delta, this.renderer.camera);
    this.tweens.update(delta);

    // --- HUD ---
    this.screens.update(delta, elapsed);

    // --- свет следует за игроком, снег вокруг камеры ---
    this.renderer.followTarget(playerPos.x, playerPos.y, playerPos.z);
    this.snow?.update(delta, elapsed, this.renderer.camera.position, {
      boosting: this.session?.boosting ?? false,
      airborne: this.session?.airborne ?? false,
    });
    this.debugPanel?.update(delta, this);

    this.renderer.render();
  }

  private syncVisuals(delta: number, time: number): void {
    const s = this.session;
    if ((this.state === 'run' || this.state === 'finish' || this.state === 'crash') && s) {
      this.track.worldPos(s.x, s.s, s.yOff + 0.05, this.tube.group.position);
      // спиной к камере в заезде (π), на финише — плавный разворот лицом
      if (this.state === 'finish' && this.backFacing > 0) {
        this.backFacing = Math.max(0, this.backFacing - delta / 0.6);
      }
      this.tube.group.rotation.y = this.track.headingAt(s.s) + Math.PI * this.backFacing;
      this.tube.group.rotation.x = -degToRad(this.track.slopeDegAt(s.s)) * 0.5;
      this.tube.setBoosting(s.boosting && this.state === 'run');
      if (this.state !== 'crash') {
        this.tube.updateVisual(delta, time, s.steer, s.vx, s.onIce, s.airborne, s.v, s.vy);
      }
    } else {
      this.tube.setBoosting(false);
    }
    // пикапы: вращение + магнит
    if (this.content) {
      const tubePos = this.tube.group.position;
      // Дистанционное отсечение мелких объектов (промт §3, бюджет draw calls):
      // дальше ~320 м препятствия/пикапы — крошечные точки в тумане, не рисуем.
      const CULL_AHEAD = 240;
      const CULL_BEHIND = -30;
      for (const p of this.content.pickups) {
        if (p.collected) continue; // pop-анимация сама скрывает меш
        const dz = tubePos.z - p.mesh.position.z;
        p.mesh.visible = dz < CULL_AHEAD && dz > CULL_BEHIND;
        if (p.mesh.visible) p.update(delta, time, p.magnetized ? tubePos : undefined);
      }
      // разлёт препятствий
      for (const o of this.content.obstacles) {
        if (o.active) {
          const dz = tubePos.z - o.mesh.position.z;
          o.mesh.visible = dz < CULL_AHEAD && dz > CULL_BEHIND;
        } else if (o.updateDestroy(delta)) {
          o.mesh.removeFromParent();
        }
      }
      this.content.finishGate.update(time);
      for (const blades of this.content.windmillBlades) blades.rotation.z += delta * 0.8;
      // W4: живой огонь факелов — две несоизмеримые синусоиды (11 и 6.3 Гц)
      // дают апериодичное мерцание без RNG, то есть детерминированно.
      for (const m of this.content.flickerMats) {
        const ph = (m.userData.flickerPhase as number) ?? 0;
        m.emissiveIntensity =
          1.1 + Math.sin(time * 11 + ph) * 0.25 + Math.sin(time * 6.3 + ph * 1.7) * 0.1;
      }
    }
  }

  // ================= тестовые хуки / диагностика =================

  private exposeTestHooks(): void {
    const hooks: GameTestHooks = {
      setState: (state) => {
        if (state === 'run') hooks.startRun(1);
        else if (state === 'aim') this.toAim();
        else if (state === 'menu') this.quitToMenu();
        else if (state === 'results' && this.results) this.setState('results');
      },
      getState: () => ({
        state: this.state,
        distance: this.session ? Math.floor(this.session.distance) : 0,
        speed: this.session?.v ?? 0,
        speedKmh: (this.session?.v ?? 0) * 3.6,
        x: this.session?.x ?? 0,
        steer: this.session?.steer ?? 0,
        airborne: this.session?.airborne ?? false,
        boosting: this.session?.boosting ?? false,
        pullPower: this.pullPower,
        coins: this.economy.coins,
        crystals: this.economy.crystals,
        diamonds: this.economy.diamonds,
        rockets: this.economy.rockets,
        playerLevel: this.meta.playerLevel,
        best: this.meta.best,
        finishDistance: this.track?.finishDistance ?? 0,
        results: this.results,
      }),
      startRun: (power = 1) => {
        if (this.state === 'menu' || this.state === 'results') this.toAim();
        if (this.state === 'aim') {
          this.pullPower = clamp(power, 0.15, 1);
          this.handlePullRelease(this.pullPower);
        }
      },
      setReducedMotion: (v) => {
        this.reducedMotion = v;
        this.cameraRig.setReducedMotion(v);
        this.shake.scale = v ? 0.25 : 1;
        this.meta.save.settings.reducedMotion = v;
      },
      seed: (n) => {
        this.runSeedBase = n >>> 0 || 1;
      },
    };
    window.__THREE_GAME_TEST_HOOKS__ = hooks;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      get state() {
        return window.__THREE_GAME_TEST_HOOKS__?.getState();
      },
      renderer: this.renderer.renderer.info,
    };
  }

  // геттеры для UI
  get currentSession(): RunSession | null {
    return this.session;
  }

  get currentResults(): RunResults | null {
    return this.results;
  }

  get currentTrack(): Track {
    return this.track;
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.renderer.dispose();
  }
}
