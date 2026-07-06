/**
 * Generate hall_v5.tmx with real tile layer using procedural tiles.
 * Layout: Chinese hall with floor, walls, trim, and shadow tiles.
 */
const fs = require('fs')
const zlib = require('zlib')

const MAP_W = 104
const MAP_H = 58
const TILE = 16

// Tile IDs (from tileset, GID = 1-based)
const T = {
  FLOOR_1: 1,   // floor-wood-1
  FLOOR_2: 2,   // floor-wood-2
  FLOOR_3: 3,   // floor-wood-3
  FLOOR_D1: 4,  // floor-dark-1
  FLOOR_D2: 5,  // floor-dark-2
  FLOOR_EDGE: 6,
  WALL_S1: 7,   // wall-stone-1
  WALL_S2: 8,   // wall-stone-2
  WALL_B1: 9,   // wall-brick-1
  WALL_B2: 10,  // wall-brick-2
  TRIM: 11,     // floor-trim
  WALL_TOP: 12, // wall-top
  SHADOW: 13,   // shadow-corner
  EMPTY: 0,     // transparent
}

// Simple seeded random
let seed = 42
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const randInt = (n) => Math.floor(rng() * n)

// Pick a random floor tile
const floorTile = () => {
  const choices = [T.FLOOR_1, T.FLOOR_2, T.FLOOR_3, T.FLOOR_1, T.FLOOR_2, T.FLOOR_3, T.FLOOR_1, T.FLOOR_2, T.FLOOR_D1]
  return choices[randInt(choices.length)]
}

const wallTile = () => {
  const choices = [T.WALL_S1, T.WALL_S2, T.WALL_B1, T.WALL_B2, T.WALL_S1, T.WALL_S2]
  return choices[randInt(choices.length)]
}

// Chinese hall layout description:
// - Outer walls: columns 0-2, 101-103; rows 0-3, 54-57
// - Inner floor area: roughly 3..101, 4..53
// - Pillars: at specific positions
// - Entry gate: bottom center (cols 45-59, rows 52-57)
const grid = Array.from({ length: MAP_H }, () => new Uint32Array(MAP_W))

// Simplified pillar positions (approximate from original)
const pillars = [
  { cx: 38, cy: 30, w: 5, h: 5 },  // left pillar area
  { cx: 65, cy: 30, w: 5, h: 5 },  // right pillar area  
  { cx: 52, cy: 42, w: 4, h: 4 },  // center back
]

const isPillar = (x, y) => pillars.some(p => x >= p.cx && x < p.cx + p.w && y >= p.cy && y < p.cy + p.h)

// Wall boundaries
const WALL_LEFT = 2
const WALL_RIGHT = 101
const WALL_TOP = 3
const WALL_BOTTOM = 54

for (let y = 0; y < MAP_H; y++) {
  for (let x = 0; x < MAP_W; x++) {
    const isOuter = x <= WALL_LEFT || x >= WALL_RIGHT || y <= WALL_TOP || y >= WALL_BOTTOM

    if (isOuter) {
      // Gate area (bottom center entrance)
      if (y >= 52 && x >= 46 && x <= 58) {
        grid[y][x] = floorTile()
      } else if (y === WALL_TOP + 1 && x > WALL_LEFT && x < WALL_RIGHT) {
        grid[y][x] = T.WALL_TOP
      } else {
        grid[y][x] = wallTile()
      }
    } else if (isPillar(x, y)) {
      // Pillar block
      const px = pillars.find(p => x >= p.cx && x < p.cx + p.w && y >= p.cy && y < p.cy + p.h)
      const isEdge = x === px.cx || x === px.cx + px.w - 1 || y === px.cy || y === px.cy + px.h - 1
      grid[y][x] = isEdge ? T.TRIM : T.WALL_B1
    } else if (x === WALL_LEFT + 1 || x === WALL_RIGHT - 1 || y === WALL_TOP + 1 || y === WALL_BOTTOM - 1) {
      // Inner trim
      const chooseTrim = [T.TRIM, T.FLOOR_D1, T.FLOOR_D2, T.TRIM]
      grid[y][x] = chooseTrim[randInt(chooseTrim.length)]
    } else if ((x === WALL_LEFT + 2 || x === WALL_RIGHT - 2 || y === WALL_TOP + 2 || y === WALL_BOTTOM - 2) && rng() < 0.7) {
      // Shadow ring
      grid[y][x] = T.TRIM
    } else {
      grid[y][x] = floorTile()
    }
  }
}

// Encode data as base64 uint32 LE
const dataBuf = Buffer.alloc(MAP_W * MAP_H * 4)
for (let i = 0; i < MAP_W * MAP_H; i++) {
  const gid = grid[Math.floor(i / MAP_W)][i % MAP_W]
  dataBuf.writeUInt32LE(gid, i * 4)
}
const b64 = dataBuf.toString('base64')

// --- Count tile usage ---
const usage = {}
for (let i = 0; i < MAP_W * MAP_H; i++) {
  const gid = grid[Math.floor(i / MAP_W)][i % MAP_W]
  usage[gid] = (usage[gid] || 0) + 1
}
console.log('Tile usage:')
const names = { 0: 'empty', 1: 'floor-1', 2: 'floor-2', 3: 'floor-3', 4: 'floor-d1', 5: 'floor-d2', 6: 'floor-edge', 7: 'wall-s1', 8: 'wall-s2', 9: 'wall-b1', 10: 'wall-b2', 11: 'trim', 12: 'wall-top', 13: 'shadow' }
Object.entries(usage).sort((a, b) => b[1] - a[1]).forEach(([gid, cnt]) => {
  console.log('  ' + (names[gid] || '?').padEnd(14) + 'GID ' + gid + ': ' + cnt + ' tiles (' + (cnt / (MAP_W * MAP_H) * 100).toFixed(1) + '%)')
})

// --- Build TMX XML ---
const tmx = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.12.2" orientation="orthogonal" renderorder="right-down" width="${MAP_W}" height="${MAP_H}" tilewidth="${TILE}" tileheight="${TILE}" infinite="0" nextlayerid="15" nextobjectid="90">
 <properties>
  <property name="minZoom" type="float" value="1"/>
  <property name="maxZoom" type="float" value="3.3"/>
  <property name="description" value="聚义厅 v5 - procedural tilemap"/>
 </properties>
 <tileset firstgid="1" name="hall-tileset" tilewidth="${TILE}" tileheight="${TILE}" tilecount="14" columns="7">
  <image source="tiles/hall-tileset.png" width="112" height="32"/>
 </tileset>
 <layer id="1" name="background" width="${MAP_W}" height="${MAP_H}" locked="1">
  <data encoding="base64">
   ${b64}
  </data>
 </layer>
</map>
`

fs.writeFileSync('public/juyiting/hall_v5.tmx', tmx)
console.log('\nGenerated public/juyiting/hall_v5.tmx (' + Buffer.byteLength(tmx, 'utf-8') + ' bytes)')
