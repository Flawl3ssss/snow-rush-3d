/**
 * camera-probe — численная приёмка W5 (§1, гейт 6.6) без браузера.
 * Инстанцирует CameraRig и прогоняет update() с синтетической телеметрией,
 * замеряя fov и крен. WebGL не нужен: вся логика — чистая математика.
 *
 * Запуск: npx tsx scripts/camera-probe.ts
 */
import * as THREE from 'three';
import { CameraRig } from '../src/systems/CameraRig';
import { CAMERA } from '../src/config';

const DT = 1 / 60;
const RAD2DEG = 180 / Math.PI;

function makeRig(aspect: number) {
  const cam = new THREE.PerspectiveCamera(55, aspect, 0.1, 1000);
  return { cam, rig: new CameraRig(cam) };
}

/** Прогон N секунд с постоянными параметрами; возвращает историю сэмплов. */
function run(
  rig: CameraRig,
  cam: THREE.PerspectiveCamera,
  opts: { seconds: number; vx: number; speed: number; airborne: boolean },
) {
  const pos = new THREE.Vector3();
  const samples: { t: number; fov: number; rollDeg: number }[] = [];
  const steps = Math.round(opts.seconds / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    pos.z -= opts.speed * DT;
    rig.update(DT, t, pos, opts.vx, opts.speed, 0, opts.airborne);
    samples.push({ t, fov: cam.fov, rollDeg: rig.rollRad * RAD2DEG });
  }
  return samples;
}

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => {
  results.push({ name, pass, detail });
};

// --- 1. FOV на крейсерской скорости (landscape, base 55) ---
{
  const { cam, rig } = makeRig(16 / 9);
  rig.mode = 'run';
  const s = run(rig, cam, { seconds: 4, vx: 0, speed: 33, airborne: false });
  const fov = s[s.length - 1].fov;
  const expected =
    cam.aspect < 1 ? CAMERA.fovPortrait : CAMERA.fovLandscape;
  const kick = Math.min((33 - CAMERA.fovSpeedStart) * CAMERA.fovSpeedMul, CAMERA.fovSpeedMax);
  check(
    'FOV @33 м/с (landscape)',
    Math.abs(fov - (expected + kick)) < 0.3,
    `fov=${fov.toFixed(2)}° (base ${expected} + kick ${kick.toFixed(2)})`,
  );
}

// --- 2. FOV в портрете (мобильный вьюпорт) ---
{
  const { cam, rig } = makeRig(9 / 16);
  rig.mode = 'run';
  const s = run(rig, cam, { seconds: 4, vx: 0, speed: 33, airborne: false });
  const fov = s[s.length - 1].fov;
  check('FOV @33 м/с (portrait)', fov > 68 && fov < 76, `fov=${fov.toFixed(2)}° (целевой коридор 70–75)`);
}

// --- 3. Плавность FOV: без рывков между кадрами ---
{
  const { cam, rig } = makeRig(16 / 9);
  rig.mode = 'run';
  // разгон 0→34 м/с за 6 с — темп, достижимый в игре (a ≈ 5.7 м/с²)
  const pos = new THREE.Vector3();
  const s: { t: number; fov: number; rollDeg: number }[] = [];
  for (let i = 0; i < Math.round(6 / DT); i++) {
    const t = i * DT;
    const v = Math.min(34, t * 5.7);
    pos.z -= v * DT;
    rig.update(DT, t, pos, 0, v, 0, false);
    s.push({ t, fov: cam.fov, rollDeg: rig.rollRad * RAD2DEG });
  }
  let maxJump = 0;
  for (let i = 1; i < s.length; i++) maxJump = Math.max(maxJump, Math.abs(s[i].fov - s[i - 1].fov));
  check('Плавность FOV (Δ/кадр < 0.5°)', maxJump < 0.5, `max Δfov=${maxJump.toFixed(3)}°/кадр`);
}

// --- 4. Air-бонус к FOV ---
{
  const ground = (() => {
    const { cam, rig } = makeRig(16 / 9);
    rig.mode = 'run';
    return run(rig, cam, { seconds: 4, vx: 0, speed: 30, airborne: false }).pop()!.fov;
  })();
  const air = (() => {
    const { cam, rig } = makeRig(16 / 9);
    rig.mode = 'run';
    return run(rig, cam, { seconds: 4, vx: 0, speed: 30, airborne: true }).pop()!.fov;
  })();
  const d = air - ground;
  check(
    'Air FOV-бонус',
    Math.abs(d - CAMERA.airFovBonus) < 0.3,
    `Δ=${d.toFixed(2)}° (ожидание ${CAMERA.airFovBonus}°)`,
  );
}

// --- 5. Крен пропорционален vx во всём диапазоне руления (maxVx=9) ---
{
  const measure = (vx: number) => {
    const { cam, rig } = makeRig(16 / 9);
    rig.mode = 'run';
    return Math.abs(run(rig, cam, { seconds: 3, vx, speed: 30, airborne: false }).pop()!.rollDeg);
  };
  const r3 = measure(3);
  const r6 = measure(6);
  const r9 = measure(9);
  // умеренный вираж должен читаться, но заметно отличаться от предельного
  const monotone = r3 < r6 - 0.5 && r6 < r9 - 0.5;
  const inRange = r3 >= 1 && r9 >= 6 && r9 <= CAMERA.rollMaxDeg + 0.1;
  check(
    'Крен пропорционален vx (3/6/9)',
    monotone && inRange,
    `vx=3 → ${r3.toFixed(2)}°, vx=6 → ${r6.toFixed(2)}°, vx=9 → ${r9.toFixed(2)}°`,
  );
}

// --- 6. Знак крена: камера кренится внутрь поворота (противознак vx) ---
{
  const { cam, rig } = makeRig(16 / 9);
  rig.mode = 'run';
  const right = run(rig, cam, { seconds: 3, vx: 6, speed: 30, airborne: false }).pop()!.rollDeg;
  const { cam: c2, rig: r2 } = makeRig(16 / 9);
  r2.mode = 'run';
  const left = run(r2, c2, { seconds: 3, vx: -6, speed: 30, airborne: false }).pop()!.rollDeg;
  check(
    'Знак крена зеркален по vx',
    Math.sign(right) === -Math.sign(left) && Math.sign(right) !== 0,
    `vx+6 → ${right.toFixed(2)}°, vx−6 → ${left.toFixed(2)}°`,
  );
}

// --- 7. Ограничение крена на экстремальном vx ---
{
  const { cam, rig } = makeRig(16 / 9);
  rig.mode = 'run';
  const s = run(rig, cam, { seconds: 4, vx: 40, speed: 34, airborne: false });
  const roll = Math.abs(s[s.length - 1].rollDeg);
  check('Кламп крена ≤ rollMaxDeg', roll <= CAMERA.rollMaxDeg + 0.01, `|roll|=${roll.toFixed(2)}° (max ${CAMERA.rollMaxDeg}°)`);
}

// --- 8. Меню/прицел: нулевой крен и базовый FOV ---
for (const mode of ['menu', 'aim', 'finish'] as const) {
  const { cam, rig } = makeRig(16 / 9);
  rig.mode = mode;
  const s = run(rig, cam, { seconds: 3, vx: 8, speed: 30, airborne: false });
  const last = s[s.length - 1];
  const fovOk = mode === 'finish' ? last.fov < CAMERA.fovLandscape + 0.01 : Math.abs(last.fov - CAMERA.fovLandscape) < 0.01;
  check(
    `${mode}: крен 0 и без speed-FOV`,
    Math.abs(last.rollDeg) < 0.1 && fovOk,
    `roll=${last.rollDeg.toFixed(3)}°, fov=${last.fov.toFixed(2)}°`,
  );
}

// --- 9. Возврат крена к нулю после виража ---
{
  const { cam, rig } = makeRig(16 / 9);
  rig.mode = 'run';
  run(rig, cam, { seconds: 2, vx: 8, speed: 30, airborne: false });
  const after = run(rig, cam, { seconds: 2, vx: 0, speed: 30, airborne: false }).pop()!;
  check('Крен возвращается к 0', Math.abs(after.rollDeg) < 0.2, `roll=${after.rollDeg.toFixed(3)}° через 2 с`);
}

// --- 10. FOV спадает при торможении ---
{
  const { cam, rig } = makeRig(16 / 9);
  rig.mode = 'run';
  const fast = run(rig, cam, { seconds: 3, vx: 0, speed: 33, airborne: false }).pop()!.fov;
  const slow = run(rig, cam, { seconds: 3, vx: 0, speed: 10, airborne: false }).pop()!.fov;
  check(
    'FOV спадает на низкой скорости',
    slow < fast - 5 && Math.abs(slow - CAMERA.fovLandscape) < 0.5,
    `33 м/с → ${fast.toFixed(2)}°, 10 м/с → ${slow.toFixed(2)}°`,
  );
}

// --- отчёт ---
console.log('\n=== CAMERA-PROBE (W5, §1 гейт 6.6) ===\n');
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(34)} ${r.detail}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(
  `\n=== ИТОГ: ${results.length - failed}/${results.length} ${failed === 0 ? 'PASS' : `— ${failed} FAIL`} ===\n`,
);
process.exit(failed === 0 ? 0 : 1);
