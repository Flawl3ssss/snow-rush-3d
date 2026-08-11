/**
 * postfx-probe (W6 §3.1) — проверка каскада отказа без WebGL.
 *
 * Настоящий WebGLRenderer в Node не создаётся (нет canvas/GL), поэтому
 * скармливаем PostFX минимальный мок рендерера. Задача теста — убедиться,
 * что при неудачной сборке composer'а класс выставляет degraded=true и не
 * бросает наружу: иначе Renderer.render() уронил бы игру на устройствах,
 * где postprocessing недоступен.
 *
 * Запуск: npx tsx scripts/postfx-probe.ts
 */
import * as THREE from 'three';
import { PostFX } from '../src/systems/PostFX';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });

// --- 1. Битый рендерер → degraded, без исключения наружу ---
{
  const broken = {
    getSize: () => {
      throw new Error('no GL context');
    },
  } as unknown as THREE.WebGLRenderer;
  let threw = false;
  let degraded = false;
  try {
    degraded = new PostFX(broken, scene, camera).degraded;
  } catch {
    threw = true;
  }
  check('Сбой composer → degraded, без throw', !threw && degraded, `threw=${threw}, degraded=${degraded}`);
}

// --- 2. render() в degraded-режиме безопасен (caller рендерит сам) ---
{
  const broken = {
    getSize: () => {
      throw new Error('no GL context');
    },
  } as unknown as THREE.WebGLRenderer;
  const fx = new PostFX(broken, scene, camera);
  let threw = false;
  try {
    fx.render();
    fx.setSpeed(0.9);
    fx.setSize(800, 600);
  } catch {
    threw = true;
  }
  check('degraded: render/setSpeed/setSize no-op', !threw, `threw=${threw}`);
}

console.log('\n=== POSTFX-PROBE (W6 §3.1) ===\n');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(38)} ${r.detail}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n=== ИТОГ: ${results.length - failed}/${results.length} ${failed === 0 ? 'PASS' : `— ${failed} FAIL`} ===\n`);
process.exit(failed === 0 ? 0 : 1);
