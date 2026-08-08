import { SLINGSHOT } from '@/config';
import { clamp } from '@/utils/math';

export type InputMode = 'menu' | 'aim' | 'run' | 'ui';

export interface InputHandlers {
  /** tap/клик в режиме menu (TAP TO PLAY) или confirm */
  onTap?: () => void;
  /** отпускание натяжения в AIM (power 0..1 при drag; null = hold-режим, power возьмёт Game) */
  onPullRelease?: (power: number | null) => void;
  onBoost?: () => void;
  onPause?: () => void;
  onRestart?: () => void;
  onBack?: () => void;
  onConfirm?: () => void;
}

/**
 * InputController — клавиатура (стрелки/A-D, Space, Shift, Esc/P, R, Enter)
 * + pointer (drag-стеринг в нижних 70% экрана, pull-to-launch drag) → интенты.
 * Тач и клавиатура эмитят одинаковые интенты (gdd §8).
 */
export class InputController {
  mode: InputMode = 'menu';
  handlers: InputHandlers = {};

  /** Целевой стеринг −1..1 (сырой; сглаживание — в симуляции) */
  steerTarget = 0;
  /** Hold-натяжение (Space/LMB без вертикального drag) */
  pullHeld = false;
  /** Drag-натяжение: 0..1 или null, если не тянут */
  pullDragPower: number | null = null;

  private readonly keys = new Set<string>();
  private pointerId: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private isDragPull = false;
  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    el.style.touchAction = 'none';
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerCancel);
    el.addEventListener('lostpointercapture', this.onPointerCancel);
    window.addEventListener('blur', this.resetAll);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  // ---------- keyboard ----------
  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    this.updateSteerFromKeys();
    switch (k) {
      case ' ':
        if (this.mode === 'aim') {
          this.pullHeld = true;
          e.preventDefault();
        } else if (this.mode === 'menu') this.handlers.onTap?.();
        else this.handlers.onConfirm?.();
        break;
      case 'enter':
        if (this.mode === 'menu') this.handlers.onTap?.();
        else this.handlers.onConfirm?.();
        break;
      case 'shift':
        this.handlers.onBoost?.();
        break;
      case 'escape':
      case 'p':
        if (this.mode === 'aim') this.handlers.onBack?.();
        else this.handlers.onPause?.();
        break;
      case 'r':
        this.handlers.onRestart?.();
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    this.keys.delete(k);
    this.updateSteerFromKeys();
    if (k === ' ' && this.pullHeld) {
      this.pullHeld = false;
      if (this.mode === 'aim') this.handlers.onPullRelease?.(null);
    }
  };

  private updateSteerFromKeys(): void {
    if (this.pointerId !== null && this.mode === 'run') return; // drag приоритетнее
    const left = this.keys.has('a') || this.keys.has('arrowleft');
    const right = this.keys.has('d') || this.keys.has('arrowright');
    this.steerTarget = (left ? -1 : 0) + (right ? 1 : 0);
  }

  // ---------- pointer ----------
  private onPointerDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.isDragPull = false;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (this.mode === 'aim') {
      this.pullHeld = true; // может стать drag-pull при движении вниз
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    if (this.mode === 'run') {
      // виртуальный руль: ±60 px → ±1.0 (gdd §8.2)
      this.steerTarget = clamp(dx / 60, -1, 1);
    } else if (this.mode === 'aim') {
      if (dy > 8) this.isDragPull = true;
      if (this.isDragPull) {
        this.pullDragPower = clamp(dy / SLINGSHOT.dragPx, 0, 1);
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    const wasDragPull = this.isDragPull;
    const power = this.pullDragPower;
    this.isDragPull = false;
    this.pullDragPower = null;
    this.pullHeld = false;
    if (this.mode === 'aim') {
      this.handlers.onPullRelease?.(wasDragPull ? (power ?? 0) : null);
    } else if (this.mode === 'menu') {
      this.handlers.onTap?.();
    }
    if (this.mode === 'run') this.updateSteerFromKeys();
  };

  private onPointerCancel = (): void => {
    this.pointerId = null;
    this.isDragPull = false;
    this.pullDragPower = null;
    this.pullHeld = false;
    this.steerTarget = 0;
  };

  private onVisibility = (): void => {
    if (document.hidden) this.resetAll();
  };

  private resetAll = (): void => {
    this.keys.clear();
    this.steerTarget = 0;
    this.onPointerCancel();
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.resetAll);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    this.el.removeEventListener('pointermove', this.onPointerMove);
    this.el.removeEventListener('pointerup', this.onPointerUp);
    this.el.removeEventListener('pointercancel', this.onPointerCancel);
    this.el.removeEventListener('lostpointercapture', this.onPointerCancel);
  }
}
