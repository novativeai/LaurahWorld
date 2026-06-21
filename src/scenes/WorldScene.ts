import Phaser from 'phaser';
import { Character3D } from '../render/Character3D';
import {
  ARRIVAL_DIST,
  CRYSTAL_WX, CRYSTAL_WY,
  HALF_H, HALF_W,
  HOUSE_WX, HOUSE_WY,
  LAURAH_START_WX, LAURAH_START_WY,
  RUN_DIST_THRESHOLD, RUN_SPEED,
  WALK_SPEED, WORLD_H, WORLD_MAX, WORLD_W,
} from '../core/constants';
import { phaserToWorld, worldToPhaser } from '../core/iso';

export class WorldScene extends Phaser.Scene {
  // Three.js character
  private character3d!: Character3D;
  private laurahTex!: Phaser.Textures.CanvasTexture;
  private laurahSprite!: Phaser.GameObjects.Image;

  // Test objects
  private houseSprite!: Phaser.GameObjects.Image;
  private crystalSprite!: Phaser.GameObjects.Image;

  // Movement state
  private wx = LAURAH_START_WX;
  private wy = LAURAH_START_WY;
  private targetWX = LAURAH_START_WX;
  private targetWY = LAURAH_START_WY;
  private moving = false;
  private pointerHeld = false;
  private pointerDownTime = 0;
  private laurahState: 'idle' | 'walking' | 'running' = 'idle';

  // UI
  private statusText!: Phaser.GameObjects.Text;
  private statusTimer = 0;

  constructor() {
    super('WorldScene');
  }

  create(): void {
    // ── World ────────────────────────────────────────────────────────────────
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBackgroundColor(0xffffff);

    // ── Placeholder textures ─────────────────────────────────────────────────
    this.buildHouseTexture();
    this.buildCrystalTexture();

    // ── Test objects ─────────────────────────────────────────────────────────
    const hp = worldToPhaser(HOUSE_WX, HOUSE_WY);
    this.houseSprite = this.add.image(hp.x, hp.y, 'obj_house')
      .setOrigin(0.5, 0.97)
      .setDepth(hp.y)
      .setInteractive({ cursor: 'pointer' });
    this.houseSprite.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      this.onObjectClick('house');
    });
    this.houseSprite.on('pointerover', () => this.houseSprite.setTint(0xddddff));
    this.houseSprite.on('pointerout',  () => this.houseSprite.clearTint());

    const cp = worldToPhaser(CRYSTAL_WX, CRYSTAL_WY);
    this.crystalSprite = this.add.image(cp.x, cp.y, 'obj_crystal')
      .setOrigin(0.5, 0.94)
      .setDepth(cp.y)
      .setInteractive({ cursor: 'pointer' });
    this.crystalSprite.on('pointerdown', (p: Phaser.Input.Pointer) => {
      p.event.stopPropagation();
      this.onObjectClick('emerald crystal');
    });
    this.crystalSprite.on('pointerover', () => this.crystalSprite.setTint(0xaaffaa));
    this.crystalSprite.on('pointerout',  () => this.crystalSprite.clearTint());

    // ── Laurah ───────────────────────────────────────────────────────────────
    this.initLaurah();

    // ── Camera: follow Laurah, clamped to world bounds ────────────────────────
    this.cameras.main.startFollow(this.laurahSprite, false, 1, 1);

    // ── Input: ground click → move; hold (>200 ms) → run continuously toward cursor ─
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.pointerHeld = true;
      this.pointerDownTime = this.time.now;
      this.onGroundClick(p);
    });
    this.input.on('pointerup', () => { this.pointerHeld = false; });

    // ── Status text (screen-fixed) ────────────────────────────────────────────
    this.statusText = this.add
      .text(this.scale.width / 2, 20, '', {
        fontSize: '17px',
        color: '#111111',
        backgroundColor: '#ffffffdd',
        padding: { x: 14, y: 7 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(99999)
      .setVisible(false);

    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      this.statusText.setPosition(size.width / 2, 20);
    });

    // ── Hint on start ─────────────────────────────────────────────────────────
    this.showStatus('Click to move · hold to run · click an object to interact');
  }

  // ── Laurah init ────────────────────────────────────────────────────────────

  private initLaurah(): void {
    this.character3d = new Character3D();

    // addCanvas wraps the 2D bridge canvas as a Phaser texture; refresh() re-
    // uploads it each frame after Three.js blits into it.
    const tex = this.textures.addCanvas('laurah3d', this.character3d.canvas);
    if (!tex) {
      console.error('[WorldScene] textures.addCanvas failed');
      return;
    }
    this.laurahTex = tex;

    const pos = worldToPhaser(this.wx, this.wy);
    this.laurahSprite = this.add
      .image(pos.x, pos.y, 'laurah3d')
      .setOrigin(0.5, 0.88)
      .setScale(0.5)
      .setDepth(pos.y + 0.5);
  }

  // ── Input handlers ─────────────────────────────────────────────────────────

  private onGroundClick(pointer: Phaser.Input.Pointer): void {
    const { wx, wy } = phaserToWorld(pointer.worldX, pointer.worldY);
    const cx = Math.max(0, Math.min(WORLD_MAX, wx));
    const cy = Math.max(0, Math.min(WORLD_MAX, wy));
    this.moveTo(cx, cy);
  }

  private onObjectClick(name: string): void {
    this.showStatus(`✨ Laurah interacts with the ${name}!`);
    console.log(`[WorldScene] Interaction: Laurah → ${name}`);
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  private moveTo(wx: number, wy: number): void {
    this.targetWX = wx;
    this.targetWY = wy;
    const dx = wx - this.wx;
    const dy = wy - this.wy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this.setLaurahState(dist >= RUN_DIST_THRESHOLD ? 'running' : 'walking');
    this.moving = true;
  }

  private setLaurahState(state: 'idle' | 'walking' | 'running'): void {
    if (state === this.laurahState) return;
    this.laurahState = state;
    const clip = state === 'running' ? 'run' : state === 'walking' ? 'walk' : 'idle';
    this.character3d?.play(clip as 'idle' | 'walk' | 'run');
  }

  // ── Status text ────────────────────────────────────────────────────────────

  private showStatus(msg: string): void {
    this.statusText.setText(msg).setVisible(true);
    this.statusTimer = 3000;
  }

  // ── Game loop ──────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    this.updateMovement(delta);
    this.updateLaurah(delta);
    this.updateStatus(delta);
  }

  private static readonly HOLD_THRESHOLD_MS = 200;

  private updateMovement(delta: number): void {
    // After 200 ms of holding, continuously chase the cursor at run speed
    if (this.pointerHeld && this.time.now - this.pointerDownTime >= WorldScene.HOLD_THRESHOLD_MS) {
      const p = this.input.activePointer;
      const { wx, wy } = phaserToWorld(p.worldX, p.worldY);
      this.targetWX = Math.max(0, Math.min(WORLD_MAX, wx));
      this.targetWY = Math.max(0, Math.min(WORLD_MAX, wy));
      this.moving = true;
      this.setLaurahState('running');
    }

    if (!this.moving) return;
    const dx = this.targetWX - this.wx;
    const dy = this.targetWY - this.wy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= ARRIVAL_DIST) {
      if (!this.pointerHeld) {
        this.wx = this.targetWX;
        this.wy = this.targetWY;
        this.moving = false;
        this.setLaurahState('idle');
      }
      return;
    }
    // Update facing direction toward movement target
    this.character3d?.setFacingFromMovement(dx / dist, dy / dist);
    const speed = this.laurahState === 'running' ? RUN_SPEED : WALK_SPEED;
    const step = Math.min(speed * delta, dist);
    this.wx += (dx / dist) * step;
    this.wy += (dy / dist) * step;
  }

  private updateLaurah(delta: number): void {
    if (!this.character3d || !this.laurahTex || !this.laurahSprite) return;

    this.character3d.render(delta);
    this.laurahTex.refresh();

    const pos = worldToPhaser(this.wx, this.wy);
    this.laurahSprite.setPosition(pos.x, pos.y);
    this.laurahSprite.setDepth(pos.y + 0.5);

  }

  private updateStatus(delta: number): void {
    if (this.statusTimer <= 0) return;
    this.statusTimer -= delta;
    if (this.statusTimer <= 0) {
      this.statusTimer = 0;
      this.statusText.setVisible(false);
    }
  }

  // ── Placeholder texture builders ───────────────────────────────────────────

  private buildHouseTexture(): void {
    const KEY = 'obj_house';
    if (this.textures.exists(KEY)) return;

    // Canvas dimensions large enough for the iso box + roof clearance
    const W = 280;
    const H = 300;
    const tex = this.textures.createCanvas(KEY, W, H);
    if (!tex) return;
    const ctx = tex.context;

    const cx = W / 2; // 140

    // Diamond geometry (same as game: HALF_W=128, HALF_H=64).
    // Front corner placed near canvas bottom so anchor (0.5, 0.97) aligns with ground.
    const fy  = H - 8;          // front y
    const lx  = cx - HALF_W;   // left x  = 12
    const rx  = cx + HALF_W;   // right x = 268
    const ly  = fy - HALF_H;   // left/right y = 228
    const by  = fy - HALF_H * 2; // back y = 164

    const WALL = 110; // wall pixel height

    // ── Walls (drawn back-to-front for correct overlap) ──────────────────────

    // Left wall (NW face — in shade)
    ctx.fillStyle = '#6B4C28';
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(cx, fy);
    ctx.lineTo(cx, fy - WALL);
    ctx.lineTo(lx, ly - WALL);
    ctx.closePath();
    ctx.fill();

    // Right wall (SW face — in light)
    ctx.fillStyle = '#A07848';
    ctx.beginPath();
    ctx.moveTo(cx, fy);
    ctx.lineTo(rx, ly);
    ctx.lineTo(rx, ly - WALL);
    ctx.lineTo(cx, fy - WALL);
    ctx.closePath();
    ctx.fill();

    // ── Flat roof (top face of the iso box) ─────────────────────────────────
    ctx.fillStyle = '#4A3020';
    ctx.beginPath();
    ctx.moveTo(lx, ly - WALL);   // left top
    ctx.lineTo(cx, by - WALL);   // back top
    ctx.lineTo(rx, ly - WALL);   // right top
    ctx.lineTo(cx, fy - WALL);   // front top
    ctx.closePath();
    ctx.fill();

    // Roof outline
    ctx.strokeStyle = '#2A1408';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lx, ly - WALL);
    ctx.lineTo(cx, by - WALL);
    ctx.lineTo(rx, ly - WALL);
    ctx.lineTo(cx, fy - WALL);
    ctx.closePath();
    ctx.stroke();

    // ── Wall edge strokes ────────────────────────────────────────────────────
    ctx.strokeStyle = '#3A2010';
    ctx.lineWidth = 1.5;
    // Left wall outline
    ctx.beginPath();
    ctx.moveTo(lx, ly);       ctx.lineTo(cx, fy);
    ctx.moveTo(lx, ly - WALL); ctx.lineTo(cx, fy - WALL);
    ctx.moveTo(lx, ly);       ctx.lineTo(lx, ly - WALL);
    ctx.moveTo(cx, fy);       ctx.lineTo(cx, fy - WALL);
    ctx.stroke();
    // Right wall outline
    ctx.beginPath();
    ctx.moveTo(cx, fy);  ctx.lineTo(rx, ly);
    ctx.moveTo(cx, fy - WALL); ctx.lineTo(rx, ly - WALL);
    ctx.moveTo(rx, ly);  ctx.lineTo(rx, ly - WALL);
    ctx.stroke();

    // ── Door on right face ────────────────────────────────────────────────────
    // The right face goes from (cx, fy) to (rx, ly) in x and WALL px up.
    // Direction vector along bottom edge: (rx-cx, ly-fy) = (128, -64)
    const faceW = Math.sqrt(HALF_W * HALF_W + HALF_H * HALF_H); // ≈143
    const dirX  = (rx - cx) / faceW;
    const dirY  = (ly - fy) / faceW;
    // Door centre: 60% along the bottom edge, at 0% height (just above base)
    const dbx = cx + dirX * faceW * 0.38;
    const dby = fy + dirY * faceW * 0.38;
    const dw  = 20; const dh = 52;
    ctx.fillStyle = '#3A2010';
    ctx.beginPath();
    ctx.moveTo(dbx - dirX * dw, dby - dirY * dw);
    ctx.lineTo(dbx + dirX * dw, dby + dirY * dw);
    ctx.lineTo(dbx + dirX * dw - 0, dby + dirY * dw - dh);
    ctx.lineTo(dbx - dirX * dw - 0, dby - dirY * dw - dh);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1A0A00';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── Window on left face ───────────────────────────────────────────────────
    const lfaceW = Math.sqrt(HALF_W * HALF_W + HALF_H * HALF_H);
    const ldirX  = (cx - lx) / lfaceW;
    const ldirY  = (fy - ly) / lfaceW;
    const wbx = lx + ldirX * lfaceW * 0.55;
    const wby = ly + ldirY * lfaceW * 0.55 - WALL * 0.5;
    const ww  = 16; const wh = 22;
    ctx.fillStyle = '#90B8D0';
    ctx.beginPath();
    ctx.moveTo(wbx - ldirX * ww, wby - ldirY * ww);
    ctx.lineTo(wbx + ldirX * ww, wby + ldirY * ww);
    ctx.lineTo(wbx + ldirX * ww, wby + ldirY * ww - wh);
    ctx.lineTo(wbx - ldirX * ww, wby - ldirY * ww - wh);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3A2010';
    ctx.lineWidth = 1;
    ctx.stroke();

    tex.refresh();
  }

  private buildCrystalTexture(): void {
    const KEY = 'obj_crystal';
    if (this.textures.exists(KEY)) return;

    const W = 72;
    const H = 156;
    const tex = this.textures.createCanvas(KEY, W, H);
    if (!tex) return;
    const ctx = tex.context;

    const cx = W / 2; // 36

    // Main body (elongated hexagon — emerald shape)
    ctx.fillStyle = '#00B856';
    ctx.beginPath();
    ctx.moveTo(cx, 4);         // top tip
    ctx.lineTo(cx + 28, 36);  // upper-right shoulder
    ctx.lineTo(cx + 28, 108); // lower-right shoulder
    ctx.lineTo(cx, 148);      // bottom tip
    ctx.lineTo(cx - 28, 108); // lower-left shoulder
    ctx.lineTo(cx - 28, 36);  // upper-left shoulder
    ctx.closePath();
    ctx.fill();

    // Left face (in shade)
    ctx.fillStyle = '#007840';
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.lineTo(cx - 28, 36);
    ctx.lineTo(cx - 28, 108);
    ctx.lineTo(cx, 148);
    ctx.lineTo(cx, 80);       // inner fold point
    ctx.closePath();
    ctx.fill();

    // Highlight — internal facet
    ctx.fillStyle = '#60EFA0';
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.lineTo(cx + 14, 28);
    ctx.lineTo(cx + 12, 76);
    ctx.lineTo(cx, 90);
    ctx.lineTo(cx - 10, 50);
    ctx.closePath();
    ctx.fill();

    // Inner horizontal line (facet edge)
    ctx.strokeStyle = '#004A28';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 28, 72);
    ctx.lineTo(cx + 28, 72);
    ctx.stroke();

    // Outline
    ctx.strokeStyle = '#004A28';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.lineTo(cx + 28, 36);
    ctx.lineTo(cx + 28, 108);
    ctx.lineTo(cx, 148);
    ctx.lineTo(cx - 28, 108);
    ctx.lineTo(cx - 28, 36);
    ctx.closePath();
    ctx.stroke();

    tex.refresh();
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  shutdown(): void {
    this.character3d?.dispose();
  }
}
