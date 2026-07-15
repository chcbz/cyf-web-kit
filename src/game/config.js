/**
 * 聚义�?scene configuration
 */

/** Scene depth layers */
export const DEPTH_LAYERS = {
  BACKGROUND: 0,
  HOTSPOTS: 1,
  AGENTS: 3,
  FOREGROUND: 5,
  BUBBLES: 10
}

/** Native hall background dimensions. Keep scene math aligned to the art asset. */
export const HALL_SCENE_WIDTH = 1664
export const HALL_SCENE_HEIGHT = 928

/** Animation states */
export const ANIM_STATES = {
  IDLE:    'idle',
  WALK:    'walk',
  TALK:    'talk',
  BUSY:    'busy',
  OFFLINE: 'offline',
  ERROR:   'error'
}

/** melonJS game config */
export function createGameConfig() {
  return {
    width: HALL_SCENE_WIDTH,
    height: HALL_SCENE_HEIGHT,
    scale: 'auto',
    doubleBuffering: true,
    antiAlias: true,
    transparent: true
  }
}
