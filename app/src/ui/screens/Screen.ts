/** Базовый класс DOM-экрана. */
export abstract class Screen {
  readonly el: HTMLDivElement;

  constructor(root: HTMLElement, className: string) {
    this.el = document.createElement('div');
    this.el.className = `screen ${className}`;
    root.appendChild(this.el);
    this.setVisible(false);
  }

  setVisible(v: boolean): void {
    const was = this.visible;
    this.el.classList.toggle('screen--visible', v);
    if (v && !was) this.onShow();
    if (!v && was) this.onHide();
  }

  get visible(): boolean {
    return this.el.classList.contains('screen--visible');
  }

  /** Хуки входа/выхода (входные анимации, refresh). */
  protected onShow(): void {}
  protected onHide(): void {}

  update(_delta: number): void {}
}

/** Иконка с graceful fallback: ассет появится позже (манифест design.md §9). */
export function iconImg(src: string, className: string, alt = ''): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  img.className = className;
  img.draggable = false;
  img.onerror = () => {
    // fallback: скрыть img, layout держится на CSS-заглушке (фон/мин.размеры)
    img.style.display = 'none';
    img.parentElement?.classList.add('img-missing');
  };
  return img;
}

/** Короткий хелпер создания элементов. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Кнопка-иконка chunky (btn--icon) с onerror-fallback иконки. */
export function iconButton(
  icon: string,
  className: string,
  onClick: () => void,
  label = '',
): HTMLButtonElement {
  const btn = el('button', `btn btn--icon ${className}`);
  btn.type = 'button';
  if (label) btn.setAttribute('aria-label', label);
  btn.appendChild(iconImg(icon, 'btn-icon-img'));
  btn.onclick = onClick;
  return btn;
}

const countUpFrames = new WeakMap<HTMLElement, number>();

/**
 * Count-up числа за `durationMs` + панч контейнера (design.md §6.2).
 * Повторный вызов отменяет предыдущую анимацию того же элемента.
 */
export function countUp(
  target: HTMLElement,
  to: number,
  format: (n: number) => string,
  durationMs = 500,
): void {
  const prev = countUpFrames.get(target);
  if (prev !== undefined) cancelAnimationFrame(prev);
  const fromText = target.dataset.countValue;
  const from = fromText !== undefined ? Number(fromText) : 0;
  target.dataset.countValue = String(to);
  if (from === to || durationMs <= 0) {
    target.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    target.textContent = format(Math.round(from + (to - from) * eased));
    if (t < 1) countUpFrames.set(target, requestAnimationFrame(step));
    else countUpFrames.delete(target);
  };
  countUpFrames.set(target, requestAnimationFrame(step));
  // панч контейнера
  const punchTarget = (target.closest('.currency-chip') as HTMLElement | null) ?? target;
  punchTarget.animate(
    [{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }],
    { duration: 150, easing: 'ease-out' },
  );
}
