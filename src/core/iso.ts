import { HALF_H, HALF_W, ISO_ORIGIN_X, ISO_ORIGIN_Y } from './constants';

/** Convert logical world coords → Phaser world pixel position. */
export function worldToPhaser(wx: number, wy: number): { x: number; y: number } {
  return {
    x: ISO_ORIGIN_X + (wx - wy) * HALF_W,
    y: ISO_ORIGIN_Y + (wx + wy) * HALF_H,
  };
}

/** Convert Phaser world pixel position → logical world coords. */
export function phaserToWorld(px: number, py: number): { wx: number; wy: number } {
  const rx = px - ISO_ORIGIN_X;
  const ry = py - ISO_ORIGIN_Y;
  return {
    wx: rx / (2 * HALF_W) + ry / (2 * HALF_H),
    wy: ry / (2 * HALF_H) - rx / (2 * HALF_W),
  };
}
