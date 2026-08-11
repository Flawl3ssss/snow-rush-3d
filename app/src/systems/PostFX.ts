/**
 * PostFX — пост-обработка (W6 §3.1): bloom + радиальная виньетка/скоростное
 * размытие. Через EffectComposer (HalfFloat+4x MSAA в WebGL2).
 *
 * Каскад отказа: если composer не собрался (старый WebGL / SwiftShader-сбой /
 * падение шейдера) — автоматически катимся к прямому renderer.render(caller-сам).
 * Важно: в песочнице нет реального WebGL, поэтому вся логика построена так,
 * чтобы при сбое конструирования we gracefully degraded, не роняя игру.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BLOOM, SPEED_FX } from '@/config';

/** Свой шейдер: виньетка + лёгкое радиальное размытие по скорости (cheap, 4 taps). */
const SpeedVignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.12 },
    uSpeed: { value: 0.0 }, // 0..1 — нормированная скорость (вкл размытие от SPEED_FX.start)
    uAspect: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uSpeed;
    uniform float uAspect;
    varying vec2 vUv;
    void main() {
      vec2 toC = vUv - 0.5;
      toC.x *= uAspect;
      float r = length(toC);
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (uSpeed > 0.0) {
        // 4-выборочное радиальное размытие, амплитуда растёт со скоростью
        float amt = uSpeed * 0.012;
        vec2 dir = toC * amt;
        col += texture2D(tDiffuse, vUv + dir).rgb;
        col += texture2D(tDiffuse, vUv - dir).rgb;
        col += texture2D(tDiffuse, vUv + dir * 0.5).rgb;
        col += texture2D(tDiffuse, vUv - dir * 0.5).rgb;
        col *= 0.2;
      }
      // виньетка: затемнение к углам (~uVignette), ближе к центру — 1
      float vig = smoothstep(0.85, 0.25, r);
      col *= mix(1.0, vig, uVignette * 4.0);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  private composer: EffectComposer | null = null;
  private speedPass: ShaderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  /** Если true — caller должен звать renderer.render напрямую (каскад отказа). */
  readonly degraded: boolean;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    let ok = false;
    try {
      // WebGL2 нужен для HalfFloat-таргета + MSAA-сэмплов в композере
      const size = renderer.getSize(new THREE.Vector2());
      const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, {
        type: THREE.HalfFloatType,
        samples: 4,
      }));
      composer.addPass(new RenderPass(scene, camera));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        BLOOM.strength,
        BLOOM.radius,
        BLOOM.threshold,
      );
      composer.addPass(bloom);
      const speedPass = new ShaderPass(SpeedVignetteShader);
      composer.addPass(speedPass);
      composer.addPass(new OutputPass());
      this.composer = composer;
      this.bloom = bloom;
      this.speedPass = speedPass;
      ok = true;
    } catch (err) {
      console.warn('[PostFX] composer не собрался — прямой render', err);
      ok = false;
    }
    this.degraded = !ok;
  }

  setSpeed(normSpeed: number): void {
    if (this.speedPass) {
      const t = THREE.MathUtils.clamp(normSpeed, 0, 1);
      // вкл плавно от SPEED_FX.start
      this.speedPass.uniforms.uSpeed.value = THREE.MathUtils.clamp(
        (t - SPEED_FX.start) / (1 - SPEED_FX.start),
        0,
        1,
      );
    }
  }

  setSize(w: number, h: number): void {
    if (this.composer) this.composer.setSize(w, h);
    if (this.speedPass) this.speedPass.uniforms.uAspect.value = w / Math.max(1, h);
    if (this.bloom) this.bloom.setSize(w, h);
  }

  /** Кадр. Если degraded — ничего не делает (caller сам рендерит). */
  render(): void {
    this.composer?.render();
  }
}
