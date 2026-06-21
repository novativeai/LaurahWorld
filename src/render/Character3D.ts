import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const CANVAS_W = 256;
const CANVAS_H = 512;

/**
 * Orthographic half-height in world units.
 * 2 * ORTHO_H is the visible vertical extent of the camera frustum.
 */
const ORTHO_H = 1.1;

const IDLE_MIN_MS = 6000;
const IDLE_MAX_MS = 8000;

/**
 * Animation clip indices (NlaTrack order confirmed by Blender export):
 *   0 = NlaTrack      = foldArms
 *   1 = NlaTrack.001  = idle
 *   2 = NlaTrack.002  = run
 *   3 = NlaTrack.003  = walk
 */
const CLIP = { foldArms: 0, idle: 1, run: 2, walk: 3 } as const;

/**
 * Offscreen Three.js renderer for Laurah.
 *
 * The KEY fix vs the DragonsLand version: Three.js renders to its own WebGL
 * canvas (renderer.domElement) and every frame we blit that into a separate
 * 2D canvas (this.canvas). Phaser's addCanvas() wraps the 2D canvas — passing
 * a WebGL canvas directly causes the texture read to silently fail on some
 * drivers because Phaser uses texImage2D expecting a 2D-painted source.
 *
 * Camera: orthographic at (4, 5, 7) lookAt (0, 0.9, 0) — iso elevation
 * arctan(TILE_H / TILE_W) ≈ 26.5°, matching the board's parallel projection.
 *
 * Lighting: sunset from NW — warm DirectionalLight key, dusk HemisphereLight,
 * orange rim from SE-low.
 *
 * Idle: alternates idle ↔ foldArms every 6–8 s with 0.5 s crossfade.
 */
export class Character3D {
  /** 2D bridge canvas — pass this to Phaser's textures.addCanvas(). */
  readonly canvas: HTMLCanvasElement;

  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;

  private mixer: THREE.AnimationMixer | null = null;
  private clips: THREE.AnimationClip[] = [];
  private currentAction: THREE.AnimationAction | null = null;
  private model: THREE.Object3D | null = null;

  private idleMode = false;
  private idleTimer = 0;
  private idleFlipMs = IDLE_MIN_MS;
  private idleVariant = 0; // 0 = idle, 1 = foldArms

  // Smooth facing rotation (radians)
  private currentFacing = THREE.MathUtils.degToRad(210);
  private targetFacing  = THREE.MathUtils.degToRad(210);

  constructor() {
    // Three.js renders into its own offscreen WebGL canvas.
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setSize(CANVAS_W, CANVAS_H, false);
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // 2D bridge — blitted each frame from the WebGL canvas for Phaser.
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('[Character3D] 2D context unavailable');
    this.ctx2d = ctx;

    this.scene = new THREE.Scene();

    const aspect = CANVAS_W / CANVAS_H; // 0.5 (portrait)
    this.camera = new THREE.OrthographicCamera(
      -ORTHO_H * aspect, ORTHO_H * aspect,
       ORTHO_H, -ORTHO_H,
      -100, 100,
    );
    // NE + above: elevation ≈ arctan(TILE_H / TILE_W) = arctan(0.5) ≈ 26.5°
    this.camera.position.set(4, 5, 7);
    this.camera.lookAt(0, 0.9, 0);

    this.setupLighting();
    this.loadCharacter();
  }

  private setupLighting(): void {
    // Base ambient so the model is always legible on a white background
    const ambient = new THREE.AmbientLight(0xfff8f0, 0.9);
    this.scene.add(ambient);

    // Key: warm sunset sun from NW
    const sun = new THREE.DirectionalLight(0xffb060, 2.8);
    sun.position.set(-3, 2, -3);
    this.scene.add(sun);

    // Fill: dusk sky (purple-blue) + warm ground bounce
    const hemi = new THREE.HemisphereLight(0x9070d0, 0x603020, 1.2);
    this.scene.add(hemi);

    // Rim: orange from SE-low (opposite of key)
    const rim = new THREE.DirectionalLight(0xff7030, 1.2);
    rim.position.set(1, -0.5, 2);
    this.scene.add(rim);
  }

  private loadCharacter(): void {
    const base = (import.meta.env?.BASE_URL ?? './').replace(/\/?$/, '/');
    const primary  = `${base}3d-characters/Laurah-game.glb`;
    const fallback = `${base}3d-characters/Laurah-rigged.glb`;

    const loader = new GLTFLoader();

    const tryLoad = (url: string, isFallback: boolean): void => {
      loader.load(
        url,
        (gltf) => {
          const model = gltf.scene;
          const box   = new THREE.Box3().setFromObject(model);
          const size  = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());

          // Place feet at Y=0, center on XZ
          model.position.set(-center.x, -box.min.y, -center.z);

          // Scale to 1.8m world-unit height so ORTHO_H frames her correctly
          if (size.y > 0) model.scale.setScalar(1.8 / size.y);

          // Initial facing — will be overridden by setFacingFromMovement each frame
          model.rotation.y = this.currentFacing;

          this.model = model;
          this.scene.add(model);
          this.mixer = new THREE.AnimationMixer(model);
          this.clips = gltf.animations;

          if (this.clips.length === 0) {
            console.warn('[Character3D] No animations in', url);
          }

          this.play('idle');
          console.log('[Character3D] Loaded', url, this.clips.length, 'clips');
        },
        undefined,
        (err) => {
          if (!isFallback) {
            console.warn('[Character3D] Optimised GLB missing, trying fallback');
            tryLoad(fallback, true);
          } else {
            console.error('[Character3D] Failed to load Laurah:', err);
          }
        },
      );
    };

    tryLoad(primary, false);
  }

  private crossFadeTo(clipIdx: number, dur: number): void {
    if (!this.mixer || clipIdx >= this.clips.length) return;
    const clip = this.clips[clipIdx];
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    if (next === this.currentAction) return;
    next.reset().play();
    if (this.currentAction) next.crossFadeFrom(this.currentAction, dur, true);
    this.currentAction = next;
  }

  /**
   * Set the target facing direction from a movement vector in iso world space.
   *
   * Camera at (4,5,7) lookAt (0,0.9,0) gives cam_right=(0.8682,0,-0.4961)
   * and cam_up_xz=(-0.2249,0,-0.3939) in XZ world space.
   *
   * The Laurah GLB's local forward is −X (not Three.js default +Z), so
   * world_forward = (−cosθ, 0, sinθ) at rotation.y=θ. Solving
   * [[Rx,Rz],[Ux,Uz]] · [−cosθ, sinθ]ᵀ = [sx, sy_up] and inverting via
   * Cramer's rule gives the formula below, which maps any screen-space
   * movement direction to the rotation.y that makes Laurah appear to face
   * that exact direction. Cardinals: N→300°, E→210°, S→120°, W→30°.
   */
  setFacingFromMovement(dwx: number, dwy: number): void {
    if (dwx === 0 && dwy === 0) return;
    this.targetFacing = Math.atan2(
      26.78 * dwx + 84.36 * dwy,
      -82.17 * dwx + 18.67 * dwy,
    ) + Math.PI;
  }

  /** Start a named animation (crossfade 0.3 s). */
  play(name: 'idle' | 'walk' | 'run'): void {
    this.idleMode = name === 'idle';
    if (this.idleMode) {
      this.idleTimer  = 0;
      this.idleVariant = 0;
      this.idleFlipMs = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
    }
    this.crossFadeTo(CLIP[name], 0.3);
  }

  /**
   * Advance the mixer, render to the WebGL canvas, then blit into the 2D
   * bridge canvas so Phaser can read the pixels via texImage2D.
   */
  render(dtMs: number): void {
    if (this.mixer) {
      this.mixer.update(dtMs / 1000);

      if (this.idleMode && this.clips.length > CLIP.foldArms) {
        this.idleTimer += dtMs;
        if (this.idleTimer >= this.idleFlipMs) {
          this.idleTimer   = 0;
          this.idleFlipMs  = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
          this.idleVariant = 1 - this.idleVariant;
          this.crossFadeTo(this.idleVariant === 0 ? CLIP.idle : CLIP.foldArms, 0.5);
        }
      }
    }

    // Smooth rotation toward target facing (8 rad/s max)
    if (this.model) {
      const diff = ((this.targetFacing - this.currentFacing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const maxStep = 8 * dtMs / 1000;
      this.currentFacing += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
      this.model.rotation.y = this.currentFacing;
    }

    this.renderer.render(this.scene, this.camera);

    // Blit WebGL frame → 2D bridge canvas (the one Phaser holds a texture ref to).
    this.ctx2d.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.ctx2d.drawImage(this.renderer.domElement, 0, 0);
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m: THREE.Material) => m.dispose());
      }
    });
    this.renderer.dispose();
  }
}
