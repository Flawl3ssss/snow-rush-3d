import * as THREE from 'three';
import { COLORS, LIGHTING } from '@/config';
import type { MapPalette } from '@/config';

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
  private readonly skyMesh: THREE.Mesh;
  private readonly container: HTMLElement;

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

    // --- Небо: градиентный canvas fallback (design.md §5.2) + подмена на
    // сгенерированную equirect-панораму /sky-panorama.png, когда ассет появится ---
    this.skyMesh = this.createSky();
    this.scene.add(this.skyMesh);
    this.tryUpgradeSkyPanorama();

    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  private createSky(): THREE.Mesh {
    const tex = this.makeSkyGradient(COLORS.skyZenith, COLORS.skyHorizon);
    const geo = new THREE.SphereGeometry(800, 24, 16);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -100;
    return mesh;
  }

  private makeSkyGradient(zenith: number, horizon: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, `#${zenith.toString(16).padStart(6, '0')}`);
    grad.addColorStop(1, `#${horizon.toString(16).padStart(6, '0')}`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Применить палитру биома (экономика v2): небо, туман, свет, экспозиция.
   * Для базовой долины сохраняется sky-panorama, если ассет загружен.
   */
  applyBiome(palette: MapPalette): void {
    this.renderer.setClearColor(palette.skyHorizon);
    (this.scene.fog as THREE.Fog).color.setHex(palette.fog);
    this.sun.intensity = LIGHTING.sunIntensity * palette.sunIntensityMul;
    this.hemi.intensity = LIGHTING.hemiIntensity * palette.hemiIntensityMul;
    this.renderer.toneMappingExposure = LIGHTING.toneExposure * palette.exposure;

    const mat = this.skyMesh.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.map = this.makeSkyGradient(palette.skyZenith, palette.skyHorizon);
    mat.needsUpdate = true;
    if (palette.skyZenith === COLORS.skyZenith) this.tryUpgradeSkyPanorama();
  }

  /** Подмена canvas-градиента на /sky-panorama.png (design §9.5), fallback сохраняется. */
  private tryUpgradeSkyPanorama(): void {
    new THREE.TextureLoader().load(
      '/sky-panorama.png',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        const mat = this.skyMesh.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.map = tex;
        mat.needsUpdate = true;
      },
      undefined,
      () => {
        /* ассет ещё не сгенерирован — остаётся градиент */
      },
    );
  }

  /** Солнце следует за игроком, чтобы тени работали на всей трассе. */
  followTarget(x: number, y: number, z: number): void {
    this.sun.position.set(x + LIGHTING.sunOffset.x, y + LIGHTING.sunOffset.y, z + LIGHTING.sunOffset.z);
    this.sun.target.position.set(x, y, z);
    this.skyMesh.position.set(x, 0, z);
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
  };

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
