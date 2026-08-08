/**
 * Headless smoke-test симуляции (НЕ часть билда): трасса + контент + заезд
 * с ботом (стеринг к безопасной линии не моделируем — просто центр).
 * Запуск: npx vite-node scripts/smoke-run.ts
 */
import { Track } from '../src/entities/Track';
import { TrackBuilder } from '../src/systems/TrackBuilder';
import { RunSession } from '../src/game/RunSession';
import { MetaProgression } from '../src/game/meta/MetaProgression';
import { EventBus } from '../src/utils/events';
import { createDefaultSave } from '../src/core/SaveSystem';
import { ECONOMY, PHYSICS, SLINGSHOT } from '../src/config';

const bus = new EventBus();
let coins = 0;
let crashes = 0;
bus.on('coin_collected', () => (coins += 1));
bus.on('crash', () => (crashes += 1));
bus.on('collision', (p) => {
  if (p.kind === 'light') crashes += 0; // учитываются в статистике ниже
});

const meta = new MetaProgression(createDefaultSave());
const track = new Track(meta.finishDistance, 42);
console.log('track: finishDistance =', track.finishDistance, 'length =', track.length.toFixed(0));
console.log('slope@0 =', track.slopeDegAt(0).toFixed(1), 'slope@300 =', track.slopeDegAt(300).toFixed(1), 'slope@900 =', track.slopeDegAt(900).toFixed(1));
console.log('h(0,0) =', track.heightAt(0, 0).toFixed(2), 'h(0,100) =', track.heightAt(0, 100).toFixed(2), '(должно падать)');
console.log('surface(0) =', track.surfaceAt(0), 'surface(5) =', track.surfaceAt(5), 'surface(8.5) =', track.surfaceAt(8.5));

const content = new TrackBuilder().build(track, 42);
console.log(
  'content: obstacles =', content.obstacles.length,
  'pickups =', content.pickups.length,
  'ramps =', content.ramps.length,
  'pads =', content.pads.length,
  'icePatches =', content.icePatches.length,
);
const firstObstacleS = Math.min(...content.obstacles.map((o) => o.s));
console.log('first obstacle at', firstObstacleS.toFixed(0), 'm (контракт: 60–80)');

// --- заезд: полный запуск, руление к центру ---
const session = new RunSession(
  42,
  track,
  content,
  meta,
  bus,
);
session.onPickupCollected = (p) => p.playPop({ tween: (_d, _u, _e, c) => c?.(), update: () => {}, clear: () => {} });
const vLaunch = SLINGSHOT.launchSpeed(1, meta.getUpgradeLevel('slingshot'));
console.log('v_launch (L1, 100%) =', vLaunch.toFixed(1), 'м/с (контракт ~28)');
session.launch(vLaunch);

const dt = PHYSICS.fixedDt;
let t = 0;
let maxV = 0;
while (!session.endReason && t < 300) {
  // бот с уклонением: целевая x — центр самого широкого свободного окна в 8–35 м впереди
  const horizon = [8, 35];
  const blocked: Array<[number, number]> = [];
  for (const o of content.obstacles) {
    if (!o.active) continue;
    if (o.s > session.s + horizon[0] && o.s < session.s + horizon[1]) {
      blocked.push([o.x - o.radius - 1.2, o.x + o.radius + 1.2]);
    }
  }
  blocked.sort((a, b) => a[0] - b[0]);
  let bestStart = -8;
  let bestW = 0;
  let cursor = -8;
  for (const [a, b] of blocked) {
    if (a - cursor > bestW) { bestW = a - cursor; bestStart = cursor; }
    cursor = Math.max(cursor, b);
  }
  if (8 - cursor > bestW) { bestW = 8 - cursor; bestStart = cursor; }
  const targetX = bestStart + bestW / 2;
  const err = targetX - session.x;
  const steer = Math.max(-1, Math.min(1, err * 0.35));
  session.step(dt, steer);
  t += dt;
  maxV = Math.max(maxV, session.v);
}
console.log(
  'run: t =', t.toFixed(1), 's, distance =', session.distance.toFixed(0),
  'm, end =', session.endReason, ', maxV =', maxV.toFixed(1),
  ', coins =', coins, ', crashFree =', session.crashFree,
);
console.log('progress =', (session.progress * 100).toFixed(0) + '%');

// --- экономика ---
console.log('upgradeCost slingshot L1 =', ECONOMY.upgradeCost('slingshot', 1), '(100)');
console.log('upgradeCost slingshot L5 =', ECONOMY.upgradeCost('slingshot', 5), '(~290)');
console.log('upgradeCost income L1 =', ECONOMY.upgradeCost('income', 1), '(150)');
console.log('incomeMult L12 =', ECONOMY.incomeMult(12), '(4.4)');
console.log('xpNeed(1) =', ECONOMY.xpNeed(1), '(320)');
console.log('D_finish(5) =', ECONOMY.finishDistance(5), '(980)');
console.log('muBase(1) =', PHYSICS.muBase(1), 'muBase(30) =', PHYSICS.muBase(30).toFixed(3));
