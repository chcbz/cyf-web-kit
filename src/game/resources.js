/**
 * melonJS resource manifest for ������
 * Background/foreground loaded as named images, .tmx for future Tiled integration
 */

export const HALL_RESOURCES = [
  { name: "liangshan-hall-bg", type: "image", src: "/juyiting/images/liangshan-hall-bg-v2.png" },
  { name: "liangshan-hall-fg", type: "image", src: "/juyiting/images/liangshan-hall-foreground-v1.png" },
  { name: "character-atlas",  type: "image", src: "/juyiting/liangshan-character-atlas-v2.png" },
]

/** Hotspot definitions (from .tmx data) */
export const HALL_HOTSPOTS = [
  { id: "mainSeat", panel: "chat",    x: 50, y: 36, w: 18, h: 11 },
  { id: "agentRoster", panel: "agents",  x: 21, y: 35, w: 18, h: 15 },
  { id: "bountyBoard", panel: "tasks",   x: 76, y: 47, w: 19, h: 18 },
  { id: "personaCatalog", panel: "catalog", x: 13, y: 77, w: 17, h: 15 },
  { id: "libraryShelf", panel: "library", x: 82, y: 76, w: 22, h: 18 },
]
