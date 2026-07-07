/**
 * Generate hall.tmx from hall_v3.tmx by converting the background
 * imagelayer into a real <layer> (tile layer) with sequential GIDs.
 *
 * The tileset image IS the full painting. Each tile is a 16×16 slice.
 * GIDs are sequential: row * 104 + col + 1.
 *
 * Usage: node scripts/generate-tile-tmx.mjs
 */

import { readFileSync, writeFileSync } from 'fs'

const SRC = 'public/juyiting/hall_v3.tmx'
const DST = 'public/juyiting/hall.tmx'

const xml = readFileSync(SRC, 'utf-8')

// --- Generate tile layer data (base64, uncompressed, little-endian uint32) ---
const MAP_W = 104
const MAP_H = 58
const buf = Buffer.alloc(MAP_W * MAP_H * 4)
for (let i = 0; i < MAP_W * MAP_H; i++) {
  buf.writeUInt32LE(i + 1, i * 4) // GIDs start at 1
}
const b64 = buf.toString('base64')

const tileLayerXml = `<layer id="1" name="background" width="${MAP_W}" height="${MAP_H}" locked="1">
  <data encoding="base64">
   ${b64}
  </data>
 </layer>`

// --- Patch TMX: replace background imagelayer with tile layer ---
// The background imagelayer in v3:
//   <imagelayer id="2" name="background" locked="1"><image source="images/liangshan-hall-base-clean-v3.png" width="1664" height="928" /></imagelayer>
const bgImageLayerRe = /<imagelayer[^>]*\bname="background"[^>]*>.*?<\/imagelayer>/
const patched = xml.replace(bgImageLayerRe, tileLayerXml)

if (patched === xml) {
  console.error('ERROR: could not find background imagelayer in', SRC)
  process.exit(1)
}

writeFileSync(DST, patched, 'utf-8')
console.log(`Generated ${DST} (${Buffer.byteLength(patched, 'utf-8')} bytes)`)
console.log(`Tile layer: ${MAP_W}×${MAP_H} = ${MAP_W * MAP_H} tiles, base64 data size: ${b64.length} chars`)
