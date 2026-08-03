/**
 * E1 / V0-CS07: reproducible geometry-layer previews for the Juyiting map.
 *
 * Emits four deterministic SVGs (committed fixtures):
 *   tests/fixtures/juyiting/occlusion-v0/layers/
 *     occlusion-mask-only.svg            -> 37 mask polygons + AABB, ID labels
 *     occlusion-collision-nav-only.svg   -> collision + nav_obstacles + nav_area
 *     occlusion-routes-nodes-only.svg    -> nav_nodes + nav_edges + patrol routes
 *     occlusion-combined.svg             -> all of the above + legend
 *
 * Every SVG embeds:
 *   data-generation-id  = sha256(svg with placeholder id)  (same approach as render-map-preview.mjs)
 *   data-tmx-sha256     = sha256 of hall.tmx
 *   data-commit         = current git HEAD (when available)
 *   data-counts         = machine inventory counts
 *   a legend block, ID labels, and <title> tooltips bound to TMX object ids.
 *
 * CLI contract: no args verifies committed fixtures; --update rewrites them.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseTmxStructure,
  resolveWorldPolygon,
  polygonAabb,
  sha256Bytes,
} from './lib/tmx-structure.mjs'

const tmxPath = process.env.JIA_JUYITING_TMX_PATH
  ?? fileURLToPath(new URL('../../public/juyiting/hall.tmx', import.meta.url))
const layerDir = process.env.JIA_JUYITING_LAYER_DIR
  ?? fileURLToPath(new URL('../../tests/fixtures/juyiting/occlusion-v0/layers/', import.meta.url))
const inventoryPath = process.env.JIA_JUYITING_OCCLUSION_INVENTORY_PATH
  ?? fileURLToPath(new URL('../../tests/fixtures/juyiting/occlusion-v0/inventory.json', import.meta.url))

const COLOR = {
  mask: '#ff9d3c',
  maskAabb: '#ffd6a1',
  collision: '#ff4567',
  navObstacle: '#b26bff',
  navArea: '#57d7ff',
  node: '#87e7ff',
  edge: '#57d7ff',
  patrol: '#ffd166',
  background: '#141d26',
  grid: '#23303c',
  label: '#f4f4f0',
}

const LAYER_DEFS = {
  'occlusion-mask-only': { title: 'Juyiting geometry: mask-only', layers: ['mask'] },
  'occlusion-collision-nav-only': { title: 'Juyiting geometry: collision + nav', layers: ['collision', 'nav'] },
  'occlusion-routes-nodes-only': { title: 'Juyiting geometry: routes + nodes', layers: ['routes'] },
  'occlusion-combined': { title: 'Juyiting geometry: combined', layers: ['mask', 'collision', 'nav', 'routes'] },
}

export function buildLayerSvg(name, structure, options = {}) {
  const { tmxSha256, commit = null, inventory = null } = options
  const { map, groups } = structure
  const worldWidth = map.width * map.tileWidth
  const worldHeight = map.height * map.tileHeight
  const def = LAYER_DEFS[name]
  if (!def) throw new Error(`Unknown layer: ${name}`)

  const provisionalId = '0'.repeat(64)
  const body = renderBody(name, def, structure, inventory)
  const provisionalSvg = wrapSvg(name, def.title, worldWidth, worldHeight, tmxSha256, commit, provisionalId, inventory, body)
  const generationId = createHash('sha256').update(provisionalSvg).digest('hex')
  return wrapSvg(name, def.title, worldWidth, worldHeight, tmxSha256, commit, generationId, inventory, body)
}

export function runRenderLayers(args = process.argv.slice(2), environment = process.env) {
  const mode = parseArguments(args)
  const tmxText = readRequiredFile(tmxPath, 'Juyiting TMX source')
  const structure = parseTmxStructure(tmxText)
  const tmxSha256 = sha256Bytes(Buffer.from(tmxText, 'utf8'))
  const commit = currentCommit()
  const inventory = readInventory()

  const outputs = new Map()
  for (const name of Object.keys(LAYER_DEFS)) {
    const svg = buildLayerSvg(name, structure, { tmxSha256, commit, inventory })
    outputs.set(`${name}.svg`, svg)
  }

  if (mode === 'update') {
    mkdirSync(layerDir, { recursive: true })
    for (const [filename, svg] of outputs) {
      writeFileSync(resolve(layerDir, filename), svg, 'utf8')
    }
    console.log(`Juyiting occlusion layers updated: ${layerDir}`)
    return
  }
  for (const [filename, svg] of outputs) {
    const committed = readRequiredFile(resolve(layerDir, filename), filename)
    if (committed !== svg) {
      throw new Error(`Juyiting layer mismatch: ${filename}. Run npm run preview:juyiting-occlusion-layers -- --update.`)
    }
  }
  console.log('Juyiting occlusion layers valid')
}

function renderBody(name, def, structure, inventory) {
  const { map, groups } = structure
  const lines = []
  const maskOnly = def.layers.includes('mask')
  const collisionNav = def.layers.includes('collision') || def.layers.includes('nav')
  const routes = def.layers.includes('routes')

  if (maskOnly) {
    lines.push('    <g class="layer-mask" data-layer="mask">')
    for (const object of groups.mask.slice().sort((a, b) => a.id - b.id)) {
      const polygon = resolveWorldPolygon(object)
      const aabb = polygonAabb(polygon)
      lines.push(`      <polygon class="mask-poly" data-tmx-id="${object.id}" points="${pointsAttr(polygon)}"><title>mask tmx:${object.id} · ${polygon.length} verts</title></polygon>`)
      lines.push(`      <rect class="mask-aabb" data-tmx-id="${object.id}" x="${aabb.minX}" y="${aabb.minY}" width="${aabb.width}" height="${aabb.height}"><title>mask tmx:${object.id} AABB</title></rect>`)
      const centroid = polygonCentroidForLabel(polygon)
      lines.push(`      <text class="label mask-label" x="${centroid.x}" y="${centroid.y}">M${object.id}</text>`)
    }
    lines.push('    </g>')
  }

  if (collisionNav) {
    lines.push('    <g class="layer-collision" data-layer="collision">')
    for (const object of groups.collision.slice().sort((a, b) => a.id - b.id)) {
      const polygon = resolveWorldPolygon(object)
      lines.push(`      <polygon class="collision-poly" data-tmx-id="${object.id}" points="${pointsAttr(polygon)}"><title>collision tmx:${object.id}</title></polygon>`)
    }
    lines.push('    </g>')
    lines.push('    <g class="layer-nav-obstacle" data-layer="nav_obstacles">')
    for (const object of groups.nav_obstacles.slice().sort((a, b) => a.id - b.id)) {
      const polygon = resolveWorldPolygon(object)
      const stableId = object.properties.stableId ?? `tmx:${object.id}`
      lines.push(`      <polygon class="nav-obstacle-poly" data-tmx-id="${object.id}" data-stable-id="${escapeXml(stableId)}" points="${pointsAttr(polygon)}"><title>nav_obstacle ${stableId}</title></polygon>`)
    }
    lines.push('    </g>')
    for (const object of groups.nav_area) {
      lines.push(`    <rect class="nav-area" data-tmx-id="${object.id}" x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height}"><title>nav_area ${object.properties.stableId ?? ''}</title></rect>`)
    }
  }

  if (routes) {
    lines.push('    <g class="layer-nav-node" data-layer="nav_nodes">')
    for (const object of groups.nav_nodes.slice().sort((a, b) => a.id - b.id)) {
      const cx = object.x + object.width / 2
      const cy = object.y + object.height / 2
      const stableId = object.properties.stableId ?? `tmx:${object.id}`
      lines.push(`      <circle class="nav-node" data-tmx-id="${object.id}" data-stable-id="${escapeXml(stableId)}" cx="${cx}" cy="${cy}" r="8"><title>node ${stableId}</title></circle>`)
      lines.push(`      <text class="label node-label" x="${cx + 11}" y="${cy + 4}">${stableId}</text>`)
    }
    lines.push('    </g>')
    lines.push('    <g class="layer-nav-edge" data-layer="nav_edges">')
    for (const object of groups.nav_edges.slice().sort((a, b) => a.id - b.id)) {
      const points = object.polyline ? object.polyline.map(([x, y]) => ({ x: object.x + x, y: object.y + y })) : []
      if (points.length >= 2) {
        const stableId = object.properties.stableId ?? `tmx:${object.id}`
        lines.push(`      <polyline class="nav-edge" data-tmx-id="${object.id}" data-stable-id="${escapeXml(stableId)}" points="${pointsAttr(points)}"><title>edge ${stableId}</title></polyline>`)
      }
    }
    lines.push('    </g>')
    lines.push('    <g class="layer-patrol" data-layer="patrol_routes">')
    for (const object of groups.patrol_routes.slice().sort((a, b) => a.id - b.id)) {
      const points = object.polyline ? object.polyline.map(([x, y]) => ({ x: object.x + x, y: object.y + y })) : []
      if (points.length >= 2) {
        const stableId = object.properties.stableId ?? `tmx:${object.id}`
        lines.push(`      <polyline class="patrol-route" data-tmx-id="${object.id}" data-stable-id="${escapeXml(stableId)}" points="${pointsAttr(points)}"><title>patrol ${stableId}</title></polyline>`)
      }
    }
    lines.push('    </g>')
  }

  return lines.join('\n')
}

function wrapSvg(name, title, width, height, tmxSha256, commit, generationId, inventory, body) {
  const legend = legendLines(name, inventory)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-generation-id="${generationId}" data-tmx-sha256="${tmxSha256}" data-commit="${escapeXml(commit ?? '')}" data-layer="${name}" role="img" aria-labelledby="layer-title">`,
    `  <title id="layer-title">${escapeXml(title)}</title>`,
    '  <defs>',
    '    <style>',
    `      .mask-poly{fill:${COLOR.mask};fill-opacity:.22;stroke:${COLOR.mask};stroke-width:2;vector-effect:non-scaling-stroke}`,
    `      .mask-aabb{fill:none;stroke:${COLOR.maskAabb};stroke-width:1;stroke-dasharray:6 4;vector-effect:non-scaling-stroke}`,
    `      .collision-poly{fill:${COLOR.collision};fill-opacity:.18;stroke:${COLOR.collision};stroke-width:1.5;vector-effect:non-scaling-stroke}`,
    `      .nav-obstacle-poly{fill:${COLOR.navObstacle};fill-opacity:.14;stroke:${COLOR.navObstacle};stroke-width:1.5;vector-effect:non-scaling-stroke}`,
    `      .nav-area{fill:${COLOR.navArea};fill-opacity:.05;stroke:${COLOR.navArea};stroke-width:2;stroke-dasharray:8 6;vector-effect:non-scaling-stroke}`,
    `      .nav-node{fill:#061c29;stroke:${COLOR.node};stroke-width:2.5;vector-effect:non-scaling-stroke}`,
    `      .nav-edge{fill:none;stroke:${COLOR.edge};stroke-width:3;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}`,
    `      .patrol-route{fill:none;stroke:${COLOR.patrol};stroke-width:3;stroke-dasharray:10 6;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}`,
    `      .label{font:600 13px ui-monospace,monospace;fill:${COLOR.label};paint-order:stroke;stroke:#0a1118;stroke-width:3;stroke-linejoin:round}`,
    `      .node-label{font-size:11px}`,
    `      .legend-title{font:700 16px system-ui,sans-serif;fill:#fff}`,
    `      .legend-row{font:500 12px ui-monospace,monospace;fill:#d8dde3}`,
    `      .swatch{stroke:#0a1118;stroke-width:1}`,
    '    </style>',
    '  </defs>',
    `  <rect width="${width}" height="${height}" fill="${COLOR.background}"/>`,
    ...gridLines(width, height),
    body,
    ...legend,
    '</svg>',
    '',
  ].join('\n')
}

function gridLines(width, height) {
  const lines = []
  const step = 64
  for (let x = 0; x <= width; x += step) {
    lines.push(`  <line class="grid" x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${COLOR.grid}" stroke-width="1"/>`)
  }
  for (let y = 0; y <= height; y += step) {
    lines.push(`  <line class="grid" x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${COLOR.grid}" stroke-width="1"/>`)
  }
  return lines
}

function legendLines(name, inventory) {
  const counts = inventory?.counts
  const rows = [
    ['mask', `mask polygons`, counts?.masks],
    ['collision', `collision polygons`, counts?.collision],
    ['nav', `nav_obstacles`, counts?.navObstacles],
    ['nodes', `nav_nodes`, counts?.navNodes],
    ['edges', `nav_edges`, counts?.navEdges],
    ['patrol', `patrol_routes`, counts?.patrolRoutes],
  ]
  const lines = [
    '  <g class="legend" transform="translate(16,16)">',
    '    <rect width="380" height="250" rx="8" fill="#0a1118" fill-opacity="0.82" stroke="#2a3a4a"/>',
    '    <text class="legend-title" x="14" y="26">Legend</text>',
  ]
  let y = 50
  for (const [key, label, count] of rows) {
    const show = layerHas(name, key)
    if (!show) continue
    lines.push(`    <rect class="swatch" x="14" y="${y - 12}" width="18" height="10" fill="${swatchColor(key)}"/>`)
    lines.push(`    <text class="legend-row" x="40" y="${y}">${label}: ${count ?? '?'}</text>`)
    y += 22
  }
  if (name === 'occlusion-mask-only') {
    lines.push('    <text class="legend-row" x="40" y="240">solid = mask polygon · dashed = AABB</text>')
  }
  lines.push('  </g>')
  return lines
}

function layerHas(name, key) {
  if (name === 'occlusion-mask-only') return key === 'mask'
  if (name === 'occlusion-collision-nav-only') return key === 'collision' || key === 'nav'
  if (name === 'occlusion-routes-nodes-only') return key === 'nodes' || key === 'edges' || key === 'patrol'
  return true
}

function swatchColor(key) {
  return {
    mask: COLOR.mask,
    collision: COLOR.collision,
    nav: COLOR.navObstacle,
    nodes: COLOR.node,
    edges: COLOR.edge,
    patrol: COLOR.patrol,
  }[key] ?? '#ffffff'
}

function pointsAttr(points) {
  return points.map(point => `${Number(point.x.toFixed(3))},${Number(point.y.toFixed(3))}`).join(' ')
}

function polygonCentroidForLabel(points) {
  let x = 0
  let y = 0
  for (const point of points) {
    x += point.x
    y += point.y
  }
  return { x: Number((x / points.length).toFixed(1)), y: Number((y / points.length).toFixed(1)) }
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function parseArguments(args) {
  if (args.length === 0) return 'verify'
  if (args.length === 1 && args[0] === '--update') return 'update'
  throw new Error(`Unknown arguments: ${args.join(' ')}`)
}

function currentCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function readInventory() {
  try {
    const parsed = JSON.parse(readRequiredFile(inventoryPath, 'Juyiting occlusion inventory fixture'))
    if (!parsed?.counts) throw new Error('inventory fixture missing counts')
    return parsed
  } catch (error) {
    throw new Error(`Cannot load inventory for legend counts: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function readRequiredFile(path, label) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} is missing: ${path}`)
    throw new Error(`Unable to read ${label} at ${path}: ${error?.code ?? error}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runRenderLayers()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
