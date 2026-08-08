import type { Game } from '@/game/Game';
import { createSeededRandom } from '@/utils/random';
import { el, iconImg } from './Screen';
import { ModalScreen } from './ModalScreen';

export interface LevelUpReward {
  level: number;
  coins: number;
  crystals: number;
  diamonds: number;
  rockets: number;
}

const CONFETTI_COLORS = ['#FF5A5A', '#38B6FF', '#FFC93C', '#4CD964', '#FF6FB5', '#5FE3FF'];

/**
 * LEVEL UP (ui.md §3.11): полноэкранный оверлей с вращающимися лучами,
 * drop-in «LEVEL N», конфетти (60 DOM-частиц), список наград, «ОТЛИЧНО!».
 */
export class LevelUpScreen extends ModalScreen {
  private readonly game: Game;
  private readonly title: HTMLDivElement;
  private readonly rewards: HTMLDivElement;
  private readonly confettiLayer: HTMLDivElement;

  constructor(root: HTMLElement, game: Game) {
    super(root, 'screen-levelup', 'LEVEL UP');
    this.game = game;

    const rays = el('div', 'levelup-rays');
    this.el.insertBefore(rays, this.el.firstChild);

    this.title = el('div', 'levelup-title text-outline--big', 'LEVEL 2');
    this.confettiLayer = el('div', 'levelup-confetti');
    this.rewards = el('div', 'levelup-rewards');

    const ok = el('button', 'btn btn--green btn--xl', 'ОТЛИЧНО!');
    ok.type = 'button';
    ok.onclick = () => {
      this.game.audio.play('ui_click');
      this.setVisible(false);
    };
    this.content.append(this.title, this.rewards, ok);
    this.el.appendChild(this.confettiLayer);
  }

  showLevel(reward: LevelUpReward): void {
    this.title.textContent = `LEVEL ${reward.level}`;
    // награды со stagger 100 мс
    this.rewards.replaceChildren();
    const rows: Array<{ icon: string; text: string }> = [];
    if (reward.coins > 0) rows.push({ icon: '/icon-coin.png', text: `+${reward.coins}` });
    if (reward.crystals > 0) rows.push({ icon: '/icon-crystal.png', text: `+${reward.crystals}` });
    if (reward.diamonds > 0) rows.push({ icon: '/icon-diamond.png', text: `+${reward.diamonds}` });
    if (reward.rockets > 0) rows.push({ icon: '/icon-rocket.png', text: `+${reward.rockets}` });
    rows.forEach((row, i) => {
      const chip = el('div', 'levelup-reward');
      chip.style.animationDelay = `${i * 100}ms`;
      chip.append(iconImg(row.icon, 'levelup-reward__icon'), el('span', 'text-outline', row.text));
      this.rewards.appendChild(chip);
    });
    this.spawnConfetti();
    this.setVisible(true);
  }

  /** 60 DOM-частиц конфетти (seeded RNG — Math.random запрещён). */
  private spawnConfetti(): void {
    this.confettiLayer.replaceChildren();
    const rng = createSeededRandom(`confetti:${Date.now()}`);
    for (let i = 0; i < 60; i += 1) {
      const p = el('div', 'confetti');
      p.style.left = `${rng() * 100}%`;
      p.style.background = CONFETTI_COLORS[Math.floor(rng() * CONFETTI_COLORS.length)];
      p.style.animationDelay = `${rng() * 0.6}s`;
      p.style.animationDuration = `${1.4 + rng() * 1.2}s`;
      p.style.transform = `rotate(${rng() * 360}deg)`;
      const size = 6 + Math.floor(rng() * 6);
      p.style.width = `${size}px`;
      p.style.height = `${size * (rng() > 0.5 ? 1 : 1.6)}px`;
      this.confettiLayer.appendChild(p);
    }
  }
}
