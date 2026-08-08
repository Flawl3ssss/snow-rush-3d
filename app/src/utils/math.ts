export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent damping factor: lerp coefficient per second. */
export const damp = (ratePerSec: number, dt: number): number => 1 - Math.exp(-ratePerSec * dt);

/** Экспоненциальное сближение cur → target с постоянной lambda (1/с). */
export const dampTo = (cur: number, target: number, lambda: number, dt: number): number =>
  cur + (target - cur) * (1 - Math.exp(-lambda * dt));

/** easeOutBack (overshoot s=1.70158) — поп-анимации (подбор монет, спавн). */
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
};

export const degToRad = (d: number): number => (d * Math.PI) / 180;

export const msToKmh = (v: number): number => v * 3.6;

/** Формат числа валюты: ≥1 000 000 → «1.2M» (ui.md §1.4). */
export function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 100_000) return `${Math.round(n / 1000)}K`;
  return String(Math.floor(n));
}
