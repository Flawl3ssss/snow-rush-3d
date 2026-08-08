import type { Game } from '@/game/Game';
import { el, iconImg } from './Screen';
import { ModalScreen } from './ModalScreen';
import * as meta from '../meta-bridge';

/**
 * DAILY TASKS (ui.md §3.7): панель 460px, ленточка «ЗАДАНИЯ» + таймер
 * обновления, 3 карточки-строки с прогресс-барами, наградами и кнопкой
 * «ЗАБРАТЬ». Выполненное незабранное — зелёная обводка + покачивание кнопки.
 */
export class TasksScreen extends ModalScreen {
  private readonly game: Game;
  private readonly refreshTimer: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private lastTimerSec = -1;

  constructor(root: HTMLElement, game: Game) {
    super(root, 'screen-tasks', 'ЗАДАНИЯ', true);
    this.game = game;

    this.refreshTimer = el('div', 'tasks-refresh', 'ОБНОВЛЕНИЕ ЧЕРЕЗ 00:00:00');
    this.list = el('div', 'tasks-list');
    this.content.append(this.refreshTimer, this.list);

    // мгновенное обновление, когда мета эмитит события заданий
    meta.onMetaEvent(game.bus, 'task_completed', () => {
      if (this.visible) this.renderTasks();
    });
  }

  protected override onShow(): void {
    this.lastTimerSec = -1;
    this.renderTasks();
    this.tickTimer();
  }

  /** Секундный тик из ScreenManager.update. */
  override update(_delta: number): void {
    if (this.visible) this.tickTimer();
  }

  private tickTimer(): void {
    const sec = meta.secondsToMidnight();
    if (sec !== this.lastTimerSec) {
      this.lastTimerSec = sec;
      this.refreshTimer.textContent = `ОБНОВЛЕНИЕ ЧЕРЕЗ ${meta.formatTimerHms(sec)}`;
    }
  }

  private renderTasks(): void {
    this.list.replaceChildren();
    const tasks = meta.getDailyTasks(this.game);
    if (tasks.length === 0) {
      this.list.appendChild(
        el('div', 'tasks-empty', 'НОВЫЕ ЗАДАНИЯ ПОЯВЯТСЯ ЗАВТРА — ВОЗВРАЩАЙСЯ!'),
      );
      return;
    }
    for (const task of tasks) {
      this.list.appendChild(this.renderTask(task));
    }
  }

  private renderTask(task: meta.DailyTask): HTMLDivElement {
    const card = el('div', 'task-card');
    const ready = task.done && !task.claimed;
    card.classList.toggle('task-card--ready', ready);
    card.classList.toggle('task-card--claimed', task.claimed);

    card.appendChild(iconImg(this.taskIcon(task), 'task-card__icon'));

    const body = el('div', 'task-card__body');
    body.appendChild(el('div', 'task-card__title', task.title));
    const bar = el('div', 'task-card__bar');
    const fill = el('div', 'task-card__bar-fill');
    fill.style.width = `${Math.min(100, (task.progress / Math.max(1, task.target)) * 100)}%`;
    bar.appendChild(fill);
    const progress = el('div', 'task-card__progress', `${Math.min(task.progress, task.target)}/${task.target}`);
    body.append(bar, progress);

    const right = el('div', 'task-card__right');
    const reward = el('div', 'task-card__reward');
    if (task.reward.coins) reward.append(iconImg('/icon-coin.png', 'task-card__reward-icon'), el('span', '', `${task.reward.coins}`));
    if (task.reward.crystals) reward.append(iconImg('/icon-crystal.png', 'task-card__reward-icon'), el('span', '', `${task.reward.crystals}`));
    if (task.reward.diamonds) reward.append(iconImg('/icon-diamond.png', 'task-card__reward-icon'), el('span', '', `${task.reward.diamonds}`));

    if (task.claimed) {
      const done = el('div', 'task-card__done');
      done.appendChild(iconImg('/icon-check.png', 'task-card__check'));
      right.append(reward, done);
    } else if (ready) {
      const claim = el('button', 'btn btn--green btn--md task-card__claim');
      claim.type = 'button';
      claim.append(iconImg('/icon-check.png', 'btn-inline-icon'), document.createTextNode('ЗАБРАТЬ'));
      claim.onclick = () => {
        if (meta.claimTaskReward(this.game, task)) {
          this.game.audio.play('task_done');
          this.renderTasks();
        }
      };
      right.append(reward, claim);
    } else {
      right.append(reward, el('div', 'task-card__chip', `${Math.round((task.progress / Math.max(1, task.target)) * 100)}%`));
    }

    card.append(body, right);
    return card;
  }

  private taskIcon(task: meta.DailyTask): string {
    if (task.reward.diamonds) return '/icon-diamond.png';
    if (task.reward.crystals) return '/icon-crystal.png';
    return '/icon-coin.png';
  }
}
