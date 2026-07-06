/**
 * Procedural tile generator — no external dependencies.
 * Creates a tileset PNG with Chinese-hall-style floor, wall, and edge tiles.
 * Output: public/juyiting/tiles/hall-tileset.png (tiles arranged in a row)
 */

const fs = require('fs')
const zlib = require('zlib')
const crypto = require('crypto')

const TILE = 16
const OUT = 'public/juyiting/tiles/hall-tileset.png'

// --- Tile definitions ---
const TILES = [
  // Floor tiles (id 1-6): warm brown wood floor with subtle grain
  { id: 1, name: 'floor-wood-1', draw: woodFloor(0.3) },
  { id: 2, name: 'floor-wood-2', draw: woodFloor(0.5) },
  { id: 3, name: 'floor-wood-3', draw: woodFloor(0.7) },
  { id: 4, name: 'floor-dark-1',  draw: woodFloorDark() },
  { id: 5, name: 'floor-dark-2',  draw: woodFloorDark(0.6) },
  { id: 6, name: 'floor-edge',    draw: floorEdge() },
  // Wall tiles (id 7-10): dark stone/brick wall
  { id: 7,  name: 'wall-stone-1', draw: stoneWall(0.4) },
  { id: 8,  name: 'wall-stone-2', draw: stoneWall(0.6) },
  { id: 9,  name: 'wall-brick-1', draw: brickWall('#5c3a2e') },
  { id: 10, name: 'wall-brick-2', draw: brickWall('#4a2c1e') },
  // Accent tiles (id 11-14)
  { id: 11, name: 'floor-trim',    draw: floorTrim() },
  { id: 12, name: 'wall-top',      draw: wallTop() },
  { id: 13, name: 'shadow-corner', draw: shadowCorner() },
  { id: 14, name: 'empty-checker', draw: checkerTile() },
]

// --- Drawing functions ---

function woodFloor(variation = 0.5) {
  return (x, y, rng) => {
    const base = [180, 140, 100] // warm brown
    const plankH = 4 + rng(3)
    const plank = Math.floor(y / plankH)
    const level = (plank % 3) * 10
    // Horizontal grain lines
    const grain = Math.sin(y * 1.5 + x * 0.3) * 8
    const gap = (y % plankH === 0 || y % plankH === plankH - 1) ? -15 : 0
    const noise = rng(12) - 6
    return [
      clamp(base[0] + level + grain + noise + gap, 0, 255),
      clamp(base[1] + grain * 0.6 + noise * 0.5 + gap, 0, 255),
      clamp(base[2] + grain * 0.3 + noise * 0.3 + gap, 0, 255),
      255
    ]
  }
}

function woodFloorDark(v = 0.4) {
  return (x, y, rng) => {
    const base = [120, 80, 50]
    const plankH = 4 + (Math.floor(x / 4) % 3)
    const grain = Math.sin(y * 2 + x * 0.4) * 6
    const noise = rng(8) - 4
    return [
      clamp(base[0] + grain + noise, 0, 255),
      clamp(base[1] + grain * 0.5 + noise * 0.5, 0, 255),
      clamp(base[2] + grain * 0.2, 0, 255),
      255
    ]
  }
}

function floorEdge() {
  return (x, y, rng) => {
    const isBorder = x < 2 || x > 13 || y < 2 || y > 13
    return isBorder
      ? [40, 25, 15, 255]
      : woodFloor(0.5)(x, y, rng)
  }
}

function floorTrim() {
  return (x, y, rng) => {
    const base = [160, 100, 40]
    // Horizontal plank with a groove
    const groove = (y >= 6 && y <= 9) ? -40 : 0
    const grain = Math.sin(x * 0.8) * 5
    return [
      clamp(base[0] + groove + grain, 0, 255),
      clamp(base[1] + groove * 0.7 + grain * 0.5, 0, 255),
      clamp(base[2] + groove * 0.5, 0, 255),
      255
    ]
  }
}

function stoneWall(variation = 0.5) {
  return (x, y, rng) => {
    const base = [110, 100, 90]
    // Stone block pattern
    const bx = Math.floor(x / 5)
    const by = Math.floor(y / 5)
    const offset = (by % 2) * 2
    const edgeX = x % 5 === 0 || x % 5 === 4
    const edgeY = y % 5 === 0 || y % 5 === 4
    const edge = (edgeX || edgeY) ? -20 : 0
    const stone = ((bx + by * 3) % 5) * 5
    const noise = rng(10) - 5
    return [
      clamp(base[0] + edge + stone + noise, 0, 255),
      clamp(base[1] + edge * 0.8 + stone * 0.7 + noise * 0.8, 0, 255),
      clamp(base[2] + edge * 0.6 + stone * 0.5 + noise * 0.6, 0, 255),
      255
    ]
  }
}

function brickWall(color = '#5c3a2e') {
  const r0 = parseInt(color.slice(1,3), 16)
  const g0 = parseInt(color.slice(3,5), 16)
  const b0 = parseInt(color.slice(5,7), 16)
  return (x, y, rng) => {
    const brickH = 4
    const brickW = 8
    const row = Math.floor(y / brickH)
    const col = Math.floor(x / brickW)
    const offset = (row % 2) * 4
    const localX = (x - offset + TILE) % TILE
    const inBrick = (localX % brickW) < brickW - 1 && (y % brickH) < brickH - 1
    const mortar = inBrick ? 0 : -30
    const noise = rng(8) - 4
    return [
      clamp(r0 + mortar + noise, 0, 255),
      clamp(g0 + mortar * 0.7 + noise * 0.7, 0, 255),
      clamp(b0 + mortar * 0.5 + noise * 0.5, 0, 255),
      255
    ]
  }
}

function wallTop() {
  return (x, y, rng) => {
    const top = y < 4
    if (top) return [60, 40, 20, 255]
    return stoneWall(0.5)(x, y, rng)
  }
}

function shadowCorner() {
  return (x, y, rng) => {
    const dist = Math.sqrt((x - 8) ** 2 + (y - 8) ** 2)
    const alpha = Math.max(0, Math.min(1, dist / 12)) * 180
    return [20, 12, 8, Math.floor(alpha)]
  }
}

function checkerTile() {
  return (x, y, rng) => {
    const c = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2) ? 200 : 80
    return [c, c, c, 255]
  }
}

// --- Helpers ---

function clamp(v, min, max) { return Math.max(min, Math.min(max, Math.round(v))) }

function makeRng(seed) {
  let s = seed
  return (range) => {
    s = (s * 16807 + 0) % 2147483647
    return Math.floor((s / 2147483647) * range)
  }
}

// --- PNG writer ---

function writePNG(pixels, width, height, path) {
  // RGBA raw data with filter byte 0 per row
  const bpp = 4
  const rawRows = []
  for (let y = 0; y < height; y++) {
    rawRows.push(Buffer.from([0])) // filter: none
    for (let x = 0; x < width; x++) {
      const off = (y * width + x) * 4
      rawRows[y] = Buffer.concat([rawRows[y], pixels.slice(off, off + 4)])
    }
  }

  const rawData = Buffer.concat(rawRows)
  const compressed = zlib.deflateSync(rawData)

  function chunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const typeB = Buffer.from(type, 'ascii')
    const crcData = Buffer.concat([typeB, data])
    const crc = crc32(crcData)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc, 0)
    return Buffer.concat([len, typeB, data, crcBuf])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type: RGBA
  ihdr[10] = 0  // compression
  ihdr[11] = 0  // filter
  ihdr[12] = 0  // interlace

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const out = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ])

  fs.mkdirSync(require('path').dirname(path), { recursive: true })
  fs.writeFileSync(path, out)
  return out.length
}

// CRC32 for PNG
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  crcTable[n] = c
}
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

// --- Generate tileset ---
const cols = 7 // tiles per row in tileset
const rows = Math.ceil(TILES.length / cols)
const tilesetW = cols * TILE
const tilesetH = rows * TILE
const allPixels = Buffer.alloc(tilesetW * tilesetH * 4)

console.log('Generating ' + TILES.length + ' procedural tiles...')
console.log('Tileset: ' + tilesetW + 'x' + tilesetH + ' (' + cols + 'x' + rows + ' grid)')

TILES.forEach((tile, idx) => {
  const tileCol = idx % cols
  const tileRow = Math.floor(idx / cols)
  const rng = makeRng(tile.id * 7919 + 1)
  const tileBuf = Buffer.alloc(TILE * TILE * 4)

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const [r, g, b, a] = tile.draw(x, y, rng)
      const off = (y * TILE + x) * 4
      tileBuf[off] = r
      tileBuf[off + 1] = g
      tileBuf[off + 2] = b
      tileBuf[off + 3] = a
    }
  }

  // Copy tile into tileset
  for (let y = 0; y < TILE; y++) {
    const srcRow = y * TILE * 4
    const dstRow = ((tileRow * TILE + y) * tilesetW + tileCol * TILE) * 4
    tileBuf.copy(allPixels, dstRow, srcRow, srcRow + TILE * 4)
  }

  console.log('  [' + tile.id + '] ' + tile.name.padEnd(18) + ' at col=' + tileCol + ' row=' + tileRow)
})

const size = writePNG(allPixels, tilesetW, tilesetH, OUT)
console.log('\nWrote ' + OUT + ' (' + size + ' bytes)')

// --- Generate tile JSON metadata ---
const meta = {
  tilewidth: TILE,
  tileheight: TILE,
  columns: cols,
  tilecount: TILES.length,
  tiles: TILES.map((t, i) => ({
    id: i + 1, // GID starts at 1
    name: t.name,
    col: i % cols,
    row: Math.floor(i / cols)
  }))
}

const metaPath = 'public/juyiting/tiles/hall-tileset.json'
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
console.log('Wrote ' + metaPath)

// --- Generate TMX tile layer as JSON (for the main script) ---
console.log('Done!')
