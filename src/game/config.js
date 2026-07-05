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

/** Character walk sheet grid: one character per row, eight gait frames per row. */
export const ATLAS_COLS = 8
export const ATLAS_ROWS = 6

/** Character visual definitions (column/row in atlas) */
export const CHAR_VISUALS = {
  songjiang:  { col: 0, row: 0, scale: 0.52 },
  wuyong:     { col: 0, row: 1, scale: 0.5 },
  linchong:   { col: 0, row: 2, scale: 0.52 },
  lujunyi:    { col: 0, row: 3, scale: 0.51 },
  husanniang: { col: 0, row: 4, scale: 0.5 },
  likui:      { col: 0, row: 5, scale: 0.56 },
  default:    { col: 0, row: 0, scale: 0.51 }
}

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
