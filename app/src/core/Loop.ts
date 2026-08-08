/**
 * Loop — requestAnimationFrame цикл с clamp delta ≤ 0.1 (gdd/design §10).
 * update получает (deltaSeconds, elapsedSeconds) реального времени.
 */
export class Loop {
  private rafId = 0;
  private last = 0;
  private elapsed = 0;
  private running = false;
  private readonly onUpdate: (delta: number, elapsed: number) => void;

  constructor(onUpdate: (delta: number, elapsed: number) => void) {
    this.onUpdate = onUpdate;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      const raw = (now - this.last) / 1000;
      this.last = now;
      const delta = Math.min(raw, 0.1); // clamp
      this.elapsed += delta;
      this.onUpdate(delta, this.elapsed);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  get time(): number {
    return this.elapsed;
  }
}
