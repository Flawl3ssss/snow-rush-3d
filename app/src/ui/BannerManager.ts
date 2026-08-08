import type { Game } from '@/game/Game';
import { el, iconImg } from './screens/Screen';
import { onMetaEvent } from './meta-bridge';

interface BannerItem {
  text: string;
  icons: string[];
  variant: 'success' | 'info' | 'reward';
}

/**
 * BannerManager (ui.md §2.4): top-center баннеры событий. FIFO-очередь,
 * максимум 1 видимый; drop-in translateY(−120%)→0 easeOutBack 450 мс,
 * жизнь 2.5 с, уход вверх 250 мс. Подписки на мета-события — защитные.
 */
export class BannerManager {
  private readonly root: HTMLDivElement;
  private readonly queue: BannerItem[] = [];
  private showing = false;

  constructor(container: HTMLElement, game: Game) {
    this.root = el('div', 'banner-layer');
    container.appendChild(this.root);

    // «DAILY TASK COMPLETED!» (ui.md §3.7) — пингвин + галочка
    onMetaEvent(game.bus, 'task_completed', () => {
      this.show({
        text: 'DAILY TASK COMPLETED!',
        icons: ['/menu-penguin.png', '/icon-check.png'],
        variant: 'success',
      });
    });
    onMetaEvent(game.bus, 'chest_ready', () => {
      this.show({ text: 'СУНДУК ГОТОВ!', icons: ['/icon-chest.png'], variant: 'reward' });
    });
    onMetaEvent(game.bus, 'rocket_purchased', () => {
      this.show({ text: 'РАКЕТА КУПЛЕНА!', icons: ['/icon-rocket.png'], variant: 'info' });
    });
  }

  show(item: BannerItem): void {
    this.queue.push(item);
    if (!this.showing) this.next();
  }

  private next(): void {
    const item = this.queue.shift();
    if (!item) {
      this.showing = false;
      return;
    }
    this.showing = true;
    const banner = el('div', `banner banner--${item.variant}`);
    for (const icon of item.icons) banner.appendChild(iconImg(icon, 'banner__icon'));
    banner.appendChild(el('span', 'banner__text text-outline', item.text));
    this.root.appendChild(banner);
    // жизнь 2.5 с → уход вверх 250 мс
    window.setTimeout(() => {
      banner.classList.add('banner--out');
      window.setTimeout(() => {
        banner.remove();
        this.next();
      }, 260);
    }, 2500);
  }
}
