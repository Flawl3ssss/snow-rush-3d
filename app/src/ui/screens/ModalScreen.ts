import { Screen, el, iconImg } from './Screen';

/**
 * ModalScreen — базовый класс панели-модалки (ui.md §2.3):
 * оверлей-затемнение, белая панель с ленточкой-заголовком, закрытие
 * по ✕ / тапу на затемнение / Esc. Контент — в this.content.
 */
export abstract class ModalScreen extends Screen {
  protected readonly panel: HTMLDivElement;
  protected readonly content: HTMLDivElement;
  protected readonly ribbon: HTMLDivElement;
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.visible) {
      e.stopPropagation();
      this.setVisible(false);
    }
  };

  constructor(root: HTMLElement, className: string, title: string, wide = false) {
    super(root, `screen-modal ${className}`);
    const dim = el('div', 'overlay-dim');
    dim.onclick = () => this.setVisible(false);

    this.panel = el('div', `panel ${wide ? 'panel--wide' : ''}`);
    this.panel.setAttribute('role', 'dialog');

    // ленточка-заголовок (ui-panel-ribbon.png с CSS-fallback на градиент)
    this.ribbon = el('div', 'panel-ribbon text-outline');
    const ribbonImg = iconImg('/ui-panel-ribbon.png', 'panel-ribbon__img');
    const ribbonText = el('span', 'panel-ribbon__text', title);
    this.ribbon.append(ribbonImg, ribbonText);

    const close = el('button', 'btn btn--icon panel-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть');
    close.onclick = () => this.setVisible(false);

    this.content = el('div', 'panel-content');
    this.panel.append(this.ribbon, close, this.content);
    this.el.append(dim, this.panel);
  }

  override setVisible(v: boolean): void {
    super.setVisible(v);
    if (v) window.addEventListener('keydown', this.onKeyDown, true);
    else window.removeEventListener('keydown', this.onKeyDown, true);
  }

  protected setRibbonTitle(title: string): void {
    const span = this.ribbon.querySelector('.panel-ribbon__text');
    if (span) span.textContent = title;
  }
}
