/**
 * ������ scene configuration
 */

/** Scene depth layers */
export const DEPTH_LAYERS = {
  BACKGROUND: 0,
  HOTSPOTS: 1,
  AGENTS: 3,
  FOREGROUND: 5,
  BUBBLES: 10
}

/** Character atlas grid */
export const ATLAS_COLS = 4
export const ATLAS_ROWS = 3

/** Character visual definitions (column/row in atlas) */
export const CHAR_VISUALS = {
  songjiang:  { col: 0, row: 0, scale: 1.06 },
  wuyong:     { col: 1, row: 0, scale: 1.03 },
  linchong:   { col: 2, row: 0, scale: 1.06 },
  lujunyi:    { col: 3, row: 0, scale: 1.05 },
  husanniang: { col: 1, row: 1, scale: 1.04 },
  likui:      { col: 2, row: 1, scale: 1.10 },
  default:    { col: 0, row: 0, scale: 1.04 }
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
    width: 960,
    height: 640,
    scale: 'auto',
    doubleBuffering: true,
    antiAlias: true
  }
}
