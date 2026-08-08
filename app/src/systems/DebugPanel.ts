import GUI from 'lil-gui';
import { PHYSICS, CAMERA, TRACK } from '@/config';
import type { Game } from '@/game/Game';

/**
 * DebugPanel — lil-gui тюнинг (gdd §10). Только при ?debug=1.
 * Не отгружается игрокам.
 */
export class DebugPanel {
  private readonly gui: GUI;
  private readonly stats: Record<string, string | number>;
  private acc = 0;
  private frames = 0;

  constructor(game: Game) {
    this.gui = new GUI({ title: 'SNOW RUSH debug' });
    this.stats = { fps: 0, state: '', v: 0, kmh: 0, theta: 0, mu: 0, steer: 0, seed: 0 };

    const fStats = this.gui.addFolder('stats');
    for (const key of Object.keys(this.stats)) {
      fStats.add(this.stats, key as keyof typeof this.stats).listen();
    }

    const fPhys = this.gui.addFolder('physics');
    fPhys.add(PHYSICS, 'kDrag', 0, 0.005, 0.0001);
    fPhys.add(PHYSICS, 'steerBrakeK', 0, 2, 0.05);
    fPhys.add(PHYSICS, 'gripSnow', 0.5, 8, 0.1);
    fPhys.add(PHYSICS, 'gripIce', 0.5, 8, 0.1);
    fPhys.add(PHYSICS, 'maxVx', 1, 20, 0.5);

    const fCam = this.gui.addFolder('camera');
    fCam.add(CAMERA, 'posLag', 1, 15, 0.5);
    fCam.add(CAMERA, 'lookLag', 1, 15, 0.5);
    fCam.add(CAMERA, 'fovSpeedMul', 0, 1.5, 0.05);

    const fTrack = this.gui.addFolder('track');
    fTrack.add(TRACK, 'slopeRampPer100m', 0, 2, 0.05);

    this.gui.add(game as unknown as Record<string, unknown>, 'hitstop');
  }

  update(delta: number, game: Game): void {
    this.acc += delta;
    this.frames += 1;
    if (this.acc >= 0.5) {
      this.stats.fps = Math.round(this.frames / this.acc);
      this.acc = 0;
      this.frames = 0;
      const s = game.currentSession;
      this.stats.state = game.state;
      this.stats.v = +(s?.v.toFixed(1) ?? 0);
      this.stats.kmh = Math.round((s?.v ?? 0) * 3.6);
      this.stats.steer = +(s?.steer.toFixed(2) ?? 0);
      this.stats.seed = s?.seed ?? 0;
      this.stats.theta = s ? +game.currentTrack.slopeDegAt(s.s).toFixed(1) : 0;
      this.stats.mu = s ? +PHYSICS.muBase(game.meta.getUpgradeLevel('sled')).toFixed(3) : 0;
    }
  }
}
