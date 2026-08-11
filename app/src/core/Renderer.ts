import * as THREE from 'three';
import { COLORS, LIGHTING } from '@/config';
import type { MapPalette } from '@/config';
import { PostFX } from '@/systems/PostFX';
import { SkyDome, lookForBiome } from '@/world/SkyDome';

/**
 * Renderer — WebGL renderer + сцена + свет/небо/туман по design.md §5.
 * ACES tone mapping, sRGB output, PCFSoft shadows.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sky: SkyDome;
  private readonly container: HTMLElement;
  /** W6 §3.1: пост-обработка. null — если не поддержана (прямой render). */
  private postFX: PostFX | null = null;
  private postEnabled = true;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = LIGHTING.toneExposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(COLORS.skyHorizon);
    const canvas = this.renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(COLORS.fog, LIGHTING.fogNearMenu, LIGHTING.fogFarMenu);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);

    // --- Свет (design.md §5.1) ---
    this.sun = new THREE.DirectionalLight(LIGHTING.sunColor, LIGHTING.sunIntensity);
    this.sun.position.set(LIGHTING.sunOffset.x, LIGHTING.sunOffset.y, LIGHTING.sunOffset.z);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(LIGHTING.shadowMapSize, LIGHTING.shadowMapSize);
    const sc = this.sun.shadow.camera;
    sc.left = -LIGHTING.shadowOrtho;
    sc.right = LIGHTING.shadowOrtho;
    sc.top = LIGHTING.shadowOrtho;
    sc.bottom = -LIGHTING.shadowOrtho;
    sc.near = 1;
    sc.far = 200;
    // world-graphics: защита от acne/peter-panning на flat-shaded low-poly
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(LIGHTING.hemiSky, LIGHTING.hemiGround, LIGHTING.hemiIntensity);
    this.scene.add(this.hemi);

    const fill = new THREE.DirectionalLight(LIGHTING.fillColor, LIGHTING.fillIntensity);
    fill.position.set(30, 25, 40); // справа-спереди
    this.scene.add(fill);

    // --- Небо (W6 §3.2): шейдерный купол по биому.
    // Панорама /sky-panorama.png больше не используется: она подходила только
    // долине, остальные 4 биома получали плоский двухцветный градиент. Плюс
    // её асинхронная загрузка гонялась с applyBiome — колбэк мог перезаписать
    // небо уже другой карты. ---
    this.sky = new SkyDome(
      new THREE.Vector3(LIGHTING.sunOffset.x, LIGHTING.sunOffset.y, LIGHTING.sunOffset.z),
      lookForBiome('valley', { skyHorizon: COLORS.skyHorizon, skyZenith: COLORS.skyZenith }),
    );
    this.scene.add(this.sky.mesh);

    window.addEventListener('resize', this.handleResize);
    this.handleResize();

    // W6 §3.1: composer собираем после первого resize — ему нужен реальный
    // размер канваса. degraded → остаётся прямой renderer.render().
    const fx = new PostFX(this.renderer, this.scene, this.camera);
    this.postFX = fx.degraded ? null : fx;
    if (this.postFX) {
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.postFX.setSize(w, h);
    }
  }

  /** Настройки: отключение пост-обработки (низкий FPS / reduced motion). */
  setPostEnabled(on: boolean): void {
    this.postEnabled = on;
  }

  /** W6 §3.1: нормированная скорость 0..1 для скоростной виньетки. */
  setSpeedFx(norm: number): void {
    this.postFX?.setSpeed(norm);
  }

  /**
   * Применить палитру биома (экономика v2): небо, туман, свет, экспозиция.
   * Небо переводится на палитру биома плавно (лерп 1 с внутри SkyDome).
   */
  applyBiome(palette: MapPalette, biome?: string): void {
    this.renderer.setClearColor(palette.skyHorizon);
    (this.scene.fog as THREE.Fog).color.setHex(palette.fog);
    this.sun.intensity = LIGHTING.sunIntensity * palette.sunIntensityMul;
    this.hemi.intensity = LIGHTING.hemiIntensity * palette.hemiIntensityMul;
    this.renderer.toneMappingExposure = LIGHTING.toneExposure * palette.exposure;

    this.sky.setBiome(lookForBiome(biome, palette));
  }

  /** Кадр неба: дрейф облаков и лерп палитры при смене биома. */
  updateSky(delta: number, time: number): void {
    this.sky.update(delta, time);
  }

  /** Солнце следует за игроком, чтобы тени работали на всей трассе. */
  followTarget(x: number, y: number, z: number): void {
    this.sun.position.set(x + LIGHTING.sunOffset.x, y + LIGHTING.sunOffset.y, z + LIGHTING.sunOffset.z);
    this.sun.target.position.set(x, y, z);
    this.sky.follow(x, z);
    this.sky.setSunDir(
      new THREE.Vector3(LIGHTING.sunOffset.x, LIGHTING.sunOffset.y, LIGHTING.sunOffset.z),
    );
  }

  setFogMode(mode: 'menu' | 'run'): void {
    const fog = this.scene.fog as THREE.Fog;
    if (mode === 'menu') {
      fog.near = LIGHTING.fogNearMenu;
      fog.far = LIGHTING.fogFarMenu;
    } else {
      fog.near = LIGHTING.fogNearRun;
      fog.far = LIGHTING.fogFarRun;
    }
  }

  get aspect(): number {
    return this.camera.aspect;
  }

  private handleResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.postFX?.setSize(w, h);
  };

  render(): void {
    if (this.postFX && this.postEnabled) {
      this.postFX.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose(): void {
    this.sky.dispose();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
