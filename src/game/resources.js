/** * melonJS resource manifest for ����义厅 */

import { HALL_SCENE_LAYER_RESOURCES } from './hallSceneLayers.js'

export const HALL_PROP_CROPPED_RESOURCES = [
  { name: "hall-prop-main-seat-cropped", type: "image", src: "/juyiting/images/props/liangshan-hall-prop-main-seat-cropped.png" },
  { name: "hall-prop-agent-roster-cropped", type: "image", src: "/juyiting/images/props/liangshan-hall-prop-agent-roster-cropped.png" },
  { name: "hall-prop-bounty-board-cropped", type: "image", src: "/juyiting/images/props/liangshan-hall-prop-bounty-board-cropped.png" },
  { name: "hall-prop-library-shelf-cropped", type: "image", src: "/juyiting/images/props/liangshan-hall-prop-library-shelf-cropped.png" },
  { name: "hall-prop-roster-book-cropped", type: "image", src: "/juyiting/images/props/liangshan-hall-prop-roster-book-cropped.png" },
]

export const HALL_MAP_RESOURCE = { name: 'juyiting-hall', type: 'tmx', src: '/juyiting/hall_v4.tmx' }

export const HALL_RESOURCES = [
  HALL_MAP_RESOURCE,
  { name: "hall-tileset", type: "image", src: "/juyiting/tiles/hall-tileset.png" },
  ...HALL_SCENE_LAYER_RESOURCES,
  ...HALL_PROP_CROPPED_RESOURCES,
  { name: 'character-atlas', type: 'image', src: '/juyiting/liangshan-character-walksheet-v1.png' }
]

