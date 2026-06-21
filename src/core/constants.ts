/** Isometric tile half-width in pixels (matches DragonsLand geometry). */
export const HALF_W = 128;
/** Isometric tile half-height in pixels. */
export const HALF_H = 64;

/** Phaser world pixel dimensions (large enough for the full logical world). */
export const WORLD_W = 8000;
export const WORLD_H = 5000;

/** Phaser pixel position that maps to logical world (0, 0). */
export const ISO_ORIGIN_X = 4000;
export const ISO_ORIGIN_Y = 500;

/** Logical world boundary — valid coords are 0..WORLD_MAX. */
export const WORLD_MAX = 30;

/** Laurah starting logical position (centre of the world). */
export const LAURAH_START_WX = 15;
export const LAURAH_START_WY = 15;

/** Test house logical position. */
export const HOUSE_WX = 17;
export const HOUSE_WY = 13;

/** Test crystal logical position. */
export const CRYSTAL_WX = 13;
export const CRYSTAL_WY = 17;

/** Walk speed in logical world units per millisecond (~1.5 u/s). */
export const WALK_SPEED = 0.0015;
/** Run speed in logical world units per millisecond (~3.5 u/s). */
export const RUN_SPEED = 0.0035;

/** Manhattan distance threshold above which Laurah runs instead of walks. */
export const RUN_DIST_THRESHOLD = 6;

/** Snap-to-target radius in world units. */
export const ARRIVAL_DIST = 0.08;
