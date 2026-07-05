/**
 * melonJS resource manifest for 鉴毃涔夊巺
 * Background/foreground loaded as named images, .tmx for future Tiled integration
 */

import { HALL_SCENE_LAYER_RESOURCES } from './hallSceneLayers.js'
import { HALL_MODULAR_LAYER_RESOURCES } from './hallModularLayers.js'

export const HALL_MAP_RESOURCE = { name: 'juyiting-hall', type: 'tmx', src: '/juyiting/hall.tmx' }

export const HALL_RESOURCES = [
  HALL_MAP_RESOURCE,
  { name: 'liangshan-hall-bg', type: 'image', src: '/juyiting/images/liangshan-hall-bg-v2.png' },
  { name: 'liangshan-hall-fg', type: 'image', src: '/juyiting/images/liangshan-hall-foreground-extracted-v1.png' },
  ...HALL_SCENE_LAYER_RESOURCES,
  ...HALL_MODULAR_LAYER_RESOURCES,
  { name: 'character-atlas', type: 'image', src: '/juyiting/liangshan-character-walksheet-v1.png' }
]

/** Fallback hotspot definitions when Tiled data is unavailable. */
export const FALLBACK_HALL_HOTSPOTS = [
  { id: 'mainSeat', panel: 'chat', x: 50, y: 36, w: 18, h: 11 },
  { id: 'agentRoster', panel: 'agents', x: 35, y: 56, w: 13, h: 13 },
  { id: 'bountyBoard', panel: 'tasks', x: 65, y: 56, w: 13, h: 13 },
  { id: 'personaCatalog', panel: 'catalog', x: 36, y: 75, w: 13, h: 13 },
  { id: 'libraryShelf', panel: 'library', x: 50, y: 63, w: 24, h: 18 }
]
