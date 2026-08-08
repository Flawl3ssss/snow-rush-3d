import type { EventBus, GameEvents } from '@/utils/events';
import { SaveSystem } from '@/core/SaveSystem';
import { createRng, type Rng } from '@/utils/random';

/** События звуковой матрицы (design.md §8). Ключи = имена sfx-файлов. */
export type AudioEventName =
  | 'ui_click'
  | 'ui_buy'
  | 'sling_stretch'
  | 'sling_release'
  | 'wind_loop'
  | 'snow_carve'
  | 'coin'
  | 'crystal'
  | 'diamond'
  | 'hit_snow'
  | 'hit_rock'
  | 'jump'
  | 'land'
  | 'boost_start'
  | 'finish'
  | 'record'
  | 'chest_open'
  | 'task_done'
  | 'level_up'
  | 'music_menu'
  | 'music_run';

type MusicTrack = 'menu' | 'run';
type LoopName = 'wind_loop' | 'snow_carve' | 'boost_start';

/** Базовые громкости SFX (0..1) относительно sfx-шины. */
const SFX_GAIN: Partial<Record<AudioEventName, number>> = {
  wind_loop: 0.5,
  snow_carve: 0.3,
  boost_start: 0.6,
  ui_click: 0.8,
  hit_snow: 0.9,
  hit_rock: 1,
};

/** Pitch-вариация ±N (design.md §8) — через seeded RNG. */
const PITCH_VAR: Partial<Record<AudioEventName, number>> = {
  ui_click: 0.06,
  sling_release: 0.06,
  coin: 0.08,
  crystal: 0.05,
  hit_snow: 0.06,
  hit_rock: 0.06,
  land: 0.06,
};

const CROSSFADE_SEC = 0.5;
const COMBO_WINDOW_SEC = 1.5;
const COMBO_STEP = 0.02; // +2% pitch за монету в серии
const COMBO_MAX = 12;

interface PlayingLoop {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * AudioSystem — Web Audio API (design.md §8).
 * Единый AudioContext (lazy init + resume на первый жест — autoplay policy),
 * gain-матрица Master → Music / SFX, буферы из public/sfx|music/*.mp3,
 * pitch-вариация через seeded RNG, duck музыки, mute-переключатели
 * (settings.music/sfx через SaveSystem). Отсутствующий файл = пропуск
 * звука, без исключений наружу.
 */
export class AudioSystem {
  private musicEnabled = true;
  private sfxEnabled = true;
  private currentMusic: MusicTrack | null = null;
  /** Текущая карта для биомной музыки заезда (промт §5). */
  private runMapId: string | null = null;
  private readonly bus: EventBus;
  private readonly save = new SaveSystem();
  private readonly rng: Rng = createRng('snow-rush-audio');

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private duckValue = 1;

  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>();

  private musicLoop: PlayingLoop | null = null;
  private readonly loops = new Map<LoopName, PlayingLoop>();

  private comboCount = 0;
  private lastCoinAt = -Infinity;
  private lastLaunchSpeed = 0;
  private lastStretchAt = -Infinity;

  constructor(bus: EventBus) {
    this.bus = bus;

    // Начальные настройки звука из сейва (settings.music / settings.sfx).
    try {
      const settings = this.save.load().settings;
      this.musicEnabled = settings.music;
      this.sfxEnabled = settings.sfx;
    } catch {
      /* default: всё включено */
    }

    // Autoplay policy: первый жест разблокирует AudioContext.
    if (typeof window !== 'undefined') {
      const onGesture = (): void => this.unlock();
      window.addEventListener('pointerdown', onGesture, { once: true });
      window.addEventListener('keydown', onGesture, { once: true });
    }

    // --- Матрица подписок на EventBus (design.md §8) ---
    bus.on('coin_collected', () => this.playCoin());
    bus.on('near_miss', () => this.play('coin', { pitch: 1.5, gain: 0.7 })); // свист риска (промт §4)
    bus.on('crystal_collected', () => this.play('crystal'));
    bus.on('diamond_collected', () => this.play('diamond'));
    bus.on('collision', (p) => {
      if (p.kind === 'wall') this.play('hit_rock');
      else if (p.kind === 'light') this.play('hit_snow');
    });
    bus.on('crash', () => this.play('hit_rock'));
    bus.on('finish', () => this.play('finish'));
    bus.on('new_best', () => this.play('record'));
    bus.on('jump', () => this.play('jump'));
    bus.on('land', () => this.play('land'));
    bus.on('boost_started', () => this.startLoop('boost_start', SFX_GAIN.boost_start ?? 0.6));
    bus.on('boost_ended', () => this.stopLoop('boost_start'));
    bus.on('launched', (p) => {
      this.lastLaunchSpeed = p.speed;
      this.play('sling_release');
    });
    bus.on('pull_changed', (p) => this.onPullChanged(p.power));
    bus.on('upgrade_purchased', () => this.play('ui_buy'));
    bus.on('level_up', () => this.play('level_up'));
    bus.on('settings_changed', (p) => {
      this.setMusicEnabled(p.music);
      this.setSfxEnabled(p.sfx);
    });
    bus.on('state_changed', (p) => this.onStateChanged(p.to));

    // События мета-слоя могут отсутствовать в типах GameEvents на этой
    // ветке — подписка защитная, по строковым именам.
    this.onAny('task_completed', () => this.play('task_done'));
    this.onAny('chest_opened', () => this.play('chest_open'));
  }

  /** Воспроизвести SFX. До unlock() (первый жест) звук молча пропускается. */
  play(event: AudioEventName, options?: { pitch?: number; gain?: number }): void {
    if (event === 'music_menu') {
      this.setMusic('menu');
      return;
    }
    if (event === 'music_run') {
      this.setMusic('run');
      return;
    }
    if (!this.sfxEnabled) return;
    const ctx = this.ctx;
    const sfxGain = this.sfxGain;
    if (!ctx || !sfxGain || ctx.state !== 'running') return;

    const name: LoopName | AudioEventName = event;
    if (name === 'wind_loop' || name === 'snow_carve' || name === 'boost_start') {
      // Петли управляются состоянием/событиями; разовый play перезапускает петлю.
      this.stopLoop(name);
      this.startLoop(name, options?.gain ?? SFX_GAIN[name] ?? 1);
      return;
    }

    const buffer = this.getBuffer(`sfx/${event}.mp3`);
    if (!buffer) return; // ещё грузится или отсутствует — пропускаем

    const variation = PITCH_VAR[event] ?? 0;
    const rate = options?.pitch ?? (variation > 0 ? this.rng.range(1 - variation, 1 + variation) : 1);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = options?.gain ?? SFX_GAIN[event] ?? 1;
    src.connect(gain).connect(sfxGain);
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
    };
    src.start();
  }

  /** Музыкальный луп состояния (music_menu / music_run), кроссфейд 500 мс. */
  setMusic(track: MusicTrack | null, mapId?: string): void {
    const nextMap = track === 'run' ? (mapId ?? null) : null;
    if (track === this.currentMusic && nextMap === this.runMapId) return;
    this.currentMusic = track;
    this.runMapId = nextMap;
    this.stopMusicLoop();
    if (!track) return;
    this.startMusicLoop(track);
  }

  get music(): MusicTrack | null {
    return this.musicEnabled ? this.currentMusic : null;
  }

  /** Duck музыки (hitstop → 0.6, пауза → 0.3). Плавный переход. */
  setDuck(value: number): void {
    this.duckValue = value;
    this.applyMusicGain();
  }

  /**
   * Басовый «вумп» крэша (W3): синтез на WebAudio — суб-синус 130→42 Гц
   * + шумовой удар через lowpass. Не требует sfx-файла. strength 0..1.
   */
  playCrashWhomp(strength = 0.8): void {
    if (!this.sfxEnabled || !this.ctx || !this.sfxGain) return;
    const ctx = this.ctx;
    const bus = this.sfxGain;
    const t0 = ctx.currentTime;
    const g = Math.min(1, 0.45 + strength * 0.65);
    // суб-басовый удар
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, t0);
    osc.frequency.exponentialRampToValueAtTime(42, t0 + 0.32);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9 * g, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42);
    osc.connect(og);
    og.connect(bus);
    osc.start(t0);
    osc.stop(t0 + 0.45);
    // шумовой «треск» поверх
    const dur = 0.25;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (this.rng() * 2 - 1) * (1 - i / data.length);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t0);
    lp.frequency.exponentialRampToValueAtTime(120, t0 + dur);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.7 * g, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(bus);
    src.start(t0);
  }

  setMusicEnabled(v: boolean): void {
    if (this.musicEnabled === v) return;
    this.musicEnabled = v;
    this.applyMusicGain();
    this.persistSettings();
  }

  setSfxEnabled(v: boolean): void {
    if (this.sfxEnabled === v) return;
    this.sfxEnabled = v;
    if (this.ctx && this.sfxGain) {
      this.sfxGain.gain.setTargetAtTime(v ? 1 : 0, this.ctx.currentTime, 0.05);
    }
    if (!v) {
      // глушим активные sfx-петли сразу
      for (const name of [...this.loops.keys()]) this.stopLoop(name);
    }
    this.persistSettings();
  }

  /** Первый звук — только после пользовательского жеста (autoplay policy). */
  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }
    // Prefetch критичных SFX.
    void this.loadBuffer('sfx/ui_click.mp3');
    void this.loadBuffer('sfx/coin.mp3');
    // Музыка, выставленная до жеста, стартует теперь.
    if (this.currentMusic && !this.musicLoop) {
      this.startMusicLoop(this.currentMusic);
    }
  }

  /** Пример типизированной подписки для справки audio-агента. */
  on<K extends keyof GameEvents>(event: K, handler: (p: GameEvents[K]) => void): void {
    this.bus.on(event, handler);
  }

  // ============================ внутреннее ============================

  /** Подписка на событие, которого может не быть в типах GameEvents. */
  private onAny(event: string, handler: () => void): void {
    (this.bus.on as (e: string, h: () => void) => unknown)(event, handler);
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;
    this.masterGain.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicEnabled ? this.duckValue : 0;
    this.musicGain.connect(this.masterGain);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxEnabled ? 1 : 0;
    this.sfxGain.connect(this.masterGain);
    return this.ctx;
  }

  /** Загрузка буфера: lazy + кэш. Отсутствующий файл → null, без throw. */
  private loadBuffer(url: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(url);
    if (cached) return Promise.resolve(cached);
    const existing = this.pending.get(url);
    if (existing) return existing;
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    const base = typeof import.meta !== 'undefined' ? import.meta.env.BASE_URL : './';
    const promise = fetch(`${base}${url}`)
      .then((res) => {
        if (!res.ok) throw new Error(`audio ${url}: HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        this.buffers.set(url, buffer);
        return buffer;
      })
      .catch(() => null) // файл отсутствует/не декодируется — пропускаем звук
      .finally(() => {
        this.pending.delete(url);
      });
    this.pending.set(url, promise);
    return promise;
  }

  /** Буфер из кэша; если нет — запускает lazy-загрузку и возвращает null. */
  private getBuffer(url: string): AudioBuffer | null {
    const cached = this.buffers.get(url);
    if (cached) return cached;
    void this.loadBuffer(url);
    return null;
  }

  // ---------- музыка ----------

  private startMusicLoop(track: MusicTrack): void {
    const ctx = this.ctx;
    const musicGain = this.musicGain;
    if (!ctx || !musicGain) return; // старт отложен до unlock()
    // биомная музыка заезда (промт §5): music/run-<map>.mp3, фолбэк run-loop
    const url =
      track === 'menu'
        ? 'music/menu-loop.mp3'
        : this.runMapId
          ? `music/run-${this.runMapId}.mp3`
          : 'music/run-loop.mp3';
    const fallback = track === 'run' && this.runMapId ? this.loadBuffer('music/run-loop.mp3') : null;
    void this.loadBuffer(url)
      .then((buffer) => (buffer ?? fallback))
      .then((buffer) => {
      if (!buffer) return;
      // за время загрузки трек мог смениться
      if (this.currentMusic !== track || !this.ctx || !this.musicGain) return;
      this.stopMusicLoop();
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(1, now + CROSSFADE_SEC);
      src.connect(gain).connect(this.musicGain);
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
      };
      src.start();
      this.musicLoop = { src, gain };
    });
  }

  private stopMusicLoop(): void {
    const loop = this.musicLoop;
    if (!loop || !this.ctx) {
      this.musicLoop = null;
      return;
    }
    this.musicLoop = null;
    const now = this.ctx.currentTime;
    try {
      loop.gain.gain.cancelScheduledValues(now);
      loop.gain.gain.setValueAtTime(Math.max(loop.gain.gain.value, 0.0001), now);
      loop.gain.gain.exponentialRampToValueAtTime(0.0001, now + CROSSFADE_SEC);
      loop.src.stop(now + CROSSFADE_SEC + 0.05);
    } catch {
      /* источник уже остановлен */
    }
  }

  private applyMusicGain(): void {
    if (!this.ctx || !this.musicGain) return;
    const target = this.musicEnabled ? this.duckValue : 0;
    this.musicGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  // ---------- sfx-петли (wind / carve / boost) ----------

  private startLoop(name: LoopName, gainValue: number): void {
    if (!this.sfxEnabled) return;
    const ctx = this.ctx;
    const sfxGain = this.sfxGain;
    if (!ctx || !sfxGain) return;
    if (this.loops.has(name)) return;
    const url = `sfx/${name}.mp3`;
    void this.loadBuffer(url).then((buffer) => {
      if (!buffer || !this.ctx || !this.sfxGain) return;
      if (this.loops.has(name)) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const gain = this.ctx.createGain();
      const now = this.ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(gainValue, 0.0001), now + 0.3);
      src.connect(gain).connect(this.sfxGain);
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
      };
      src.start();
      this.loops.set(name, { src, gain });
    });
  }

  private stopLoop(name: LoopName): void {
    const loop = this.loops.get(name);
    if (!loop || !this.ctx) {
      this.loops.delete(name);
      return;
    }
    this.loops.delete(name);
    const now = this.ctx.currentTime;
    try {
      loop.gain.gain.cancelScheduledValues(now);
      loop.gain.gain.setValueAtTime(Math.max(loop.gain.gain.value, 0.0001), now);
      loop.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      loop.src.stop(now + 0.35);
    } catch {
      /* источник уже остановлен */
    }
  }

  // ---------- обработчики событий ----------

  private onStateChanged(to: GameEvents['state_changed']['to']): void {
    if (to === 'run') {
      // ветер ∝ скорости запуска, шорох снега — фоном
      const windGain = Math.min(1, Math.max(0.2, this.lastLaunchSpeed / 30)) * 0.5;
      this.startLoop('wind_loop', windGain);
      this.startLoop('snow_carve', SFX_GAIN.snow_carve ?? 0.3);
    } else {
      this.stopLoop('wind_loop');
      this.stopLoop('snow_carve');
      this.stopLoop('boost_start');
      this.comboCount = 0;
    }
  }

  private onPullChanged(power: number): void {
    // скрип натяжения: pitch привязан к % натяжения, не чаще 2 раз/сек
    if (power <= 0.02) return;
    const now = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
    if (now - this.lastStretchAt < 0.5) return;
    this.lastStretchAt = now;
    this.play('sling_stretch', { pitch: 0.85 + 0.4 * power, gain: 0.5 });
  }

  /** Монета: pitch-лесенка +2% за комбо-серию, сброс через 1.5 с. */
  private playCoin(): void {
    const now = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
    if (now - this.lastCoinAt > COMBO_WINDOW_SEC) this.comboCount = 0;
    this.lastCoinAt = now;
    const step = Math.min(this.comboCount, COMBO_MAX);
    this.comboCount += 1;
    const variation = PITCH_VAR.coin ?? 0.08;
    const jitter = this.rng.range(1 - variation, 1 + variation);
    this.play('coin', { pitch: jitter * (1 + step * COMBO_STEP) });
  }

  private persistSettings(): void {
    try {
      const data = this.save.load();
      data.settings.music = this.musicEnabled;
      data.settings.sfx = this.sfxEnabled;
      this.save.save(data);
    } catch {
      /* localStorage недоступен — молча */
    }
  }
}
