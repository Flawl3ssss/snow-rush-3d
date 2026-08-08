/**
 * sim-economy — headless-симуляция прогрессии экономики v2 (docs/ECONOMY.md).
 * Запуск: npx vite-node scripts/sim-economy.ts
 *
 * Проверяет жёсткое требование темпа: открытие каждой следующей карты —
 * не раньше 15-го заезда на текущей и в медиане в пределах 15–25 заездов.
 * Модель: три профиля игрока (casual ×0.8 / средний ×1.0 / skilled ×1.3),
 * жадная покупка самого дешёвого апгрейда, доходы — по формулам config.ts.
 * Exit 0 — все проверки зелёные, 1 — регрессия темпа.
 */
import { ECONOMY, MAPS } from '../src/config';

interface Profile {
  label: string;
  skill: number;
}

const PROFILES: Profile[] = [
  { label: 'casual ×0.8', skill: 0.8 },
  { label: 'средний ×1.0', skill: 1.0 },
  { label: 'skilled ×1.3', skill: 1.3 },
];

interface MapOpenLog {
  mapId: string;
  runsOnPrevMap: number;
  totalRuns: number;
  playerLevel: number;
}

function simulate(skill: number): { log: MapOpenLog[]; firstSessionUpgrades: number } {
  let coins = ECONOMY.start.coins;
  let crystals = ECONOMY.start.crystals;
  const upg = { slingshot: 1, sled: 1, income: 1 };
  let plvl = 1;
  let xp = 0;
  let mapIdx = 0;
  let runsTotal = 0;
  let runsOnMap = 0;
  let firstSessionUpgrades = 0;
  const log: MapOpenLog[] = [];

  for (let run = 0; run < 500 && mapIdx < MAPS.length; run += 1) {
    const map = MAPS[mapIdx];
    const fd = ECONOMY.finishDistance(plvl);
    const power = (upg.slingshot - 1) * 0.035 + (upg.sled - 1) * 0.04;
    const reach = Math.min(1, (0.45 + power + 0.02 * Math.sqrt(runsTotal)) * skill);
    const d = fd * Math.min(1, reach + 0.15 * skill);
    const finished = reach >= 0.93;
    const inc = ECONOMY.incomeMult(upg.income);

    coins += d * ECONOMY.distanceCoinRate * inc * map.coinMul;
    if (finished) coins += ECONOMY.finishCoinBonus * inc * map.coinMul;
    crystals += finished ? ECONOMY.finishCrystals * map.crystalMul : 0;
    crystals += (d > 0.8 * fd ? 2 : 0) * map.crystalMul * 0.5 + 0.8; // рекорды/задания усреднённо
    xp += (finished ? ECONOMY.finishXp : ECONOMY.crashFreeXp) + ECONOMY.xpPerMeter * d;

    runsTotal += 1;
    runsOnMap += 1;

    while (xp >= ECONOMY.xpNeed(plvl)) {
      xp -= ECONOMY.xpNeed(plvl);
      plvl += 1;
      coins += ECONOMY.levelUpCoins(plvl);
      crystals += ECONOMY.levelUpCrystals(plvl);
    }

    // жадная покупка самого дешёвого апгрейда
    for (;;) {
      const lines = ['slingshot', 'sled', 'income'] as const;
      let bestLine: (typeof lines)[number] | null = null;
      let bestCost = Infinity;
      for (const l of lines) {
        if (upg[l] >= ECONOMY.maxUpgradeLevel) continue;
        const c = ECONOMY.upgradeCost(l, upg[l]);
        if (c < bestCost) {
          bestCost = c;
          bestLine = l;
        }
      }
      if (bestLine === null || coins < bestCost) break;
      coins -= bestCost;
      upg[bestLine] += 1;
      if (runsTotal <= 10) firstSessionUpgrades += 1;
    }

    if (mapIdx < MAPS.length - 1) {
      const next = MAPS[mapIdx + 1];
      if (plvl >= next.unlockLevel && crystals >= next.unlockCrystals) {
        crystals -= next.unlockCrystals;
        mapIdx += 1;
        log.push({ mapId: next.id, runsOnPrevMap: runsOnMap, totalRuns: runsTotal, playerLevel: plvl });
        runsOnMap = 0;
      }
    }
  }
  return { log, firstSessionUpgrades };
}

let failed = false;
console.log('=== Симуляция экономики v2: темп открытия карт ===');
for (const p of PROFILES) {
  const { log, firstSessionUpgrades } = simulate(p.skill);
  const parts = log.map((l) => `${l.mapId}: ${l.runsOnPrevMap} заездов (Σ${l.totalRuns}, ур.${l.playerLevel})`);
  console.log(`[${p.label}] ${parts.join(' | ')}`);
  if (p.skill === 1.0) {
    console.log(`    апгрейдов за первые 10 заездов: ${firstSessionUpgrades}`);
    if (firstSessionUpgrades < 3) {
      console.error('    FAIL: первая сессия даёт < 3 апгрейдов');
      failed = true;
    }
  }
  for (const l of log) {
    if (l.runsOnPrevMap < 15) {
      console.error(`    FAIL: ${l.mapId} открыта за ${l.runsOnPrevMap} < 15 заездов (профиль ${p.label})`);
      failed = true;
    }
    if (p.skill === 1.0 && l.runsOnPrevMap > 25) {
      console.error(`    FAIL: ${l.mapId} открыта за ${l.runsOnPrevMap} > 25 заездов (медианный профиль)`);
      failed = true;
    }
  }
  if (log.length < MAPS.length - 1) {
    console.error(`    FAIL: профиль ${p.label} не дошёл до всех карт за 500 заездов`);
    failed = true;
  }
}
console.log(failed ? '=== SIM-ECONOMY: FAIL ===' : '=== SIM-ECONOMY: PASS (все карты 15–25 заездов) ===');
process.exit(failed ? 1 : 0);
