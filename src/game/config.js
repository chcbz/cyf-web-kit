/**
 * 聚义厅 scene configuration
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
export const HALL_SCENE_WIDTH = 1672
export const HALL_SCENE_HEIGHT = 941

/** Character atlas grid */
export const ATLAS_COLS = 4
export const ATLAS_ROWS = 3

/** Character visual definitions (column/row in atlas) */
export const CHAR_VISUALS = {
  songjiang:  { col: 0, row: 0, scale: 0.62 },
  wuyong:     { col: 1, row: 0, scale: 0.6 },
  linchong:   { col: 2, row: 0, scale: 0.62 },
  lujunyi:    { col: 3, row: 0, scale: 0.61 },
  husanniang: { col: 1, row: 1, scale: 0.6 },
  likui:      { col: 2, row: 1, scale: 0.66 },
  default:    { col: 0, row: 0, scale: 0.61 }
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
