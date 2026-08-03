/**
 * E1: Juyiting map machine inventory + 37-mask migration ledger.
 *
 * CLI contract:
 *   no args      -> verify committed fixture matches a fresh parse
 *   --update     -> atomically rewrite committed fixture
 *   --stdout     -> print the JSON to stdout (no fixture comparison)
 *
 * Outputs:
 *   tests/fixtures/juyiting/occlusion-v0/inventory.json
 *   tests/fixtures/juyiting/occlusion-v0/mask-ledger.md
 *
 * The ledger records machine-observable facts only (TMX id, polygon, AABB,
 * centroid, authoritative region from docs/juyiting-occlusion-system-design.md
 * §9, geometric region cross-check). Visual structure / stableId are
 * deliberately left "TBD_E10A" — E1 does not guess visual semantics.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseTmxStructure,
  resolveWorldPolygon,
  polygonAabb,
  polygonCentroid,
  rectAabb,
  sha256Bytes,
} from './lib/tmx-structure.mjs'

// Authoritative region mapping from docs/juyiting-occlusion-system-design.md §9.
// This is the frozen design contract for the 37 legacy masks.
const AUTHORITATIVE_REGIONS = {
  northwest: [48, 70],
  north_center: [54, 71],
  northeast: [57, 72, 73],
  west_center: [49, 52, 53, 69, 83, 84],
  center: [55],
  east_center: [56, 58, 59, 74, 76, 77, 78, 79, 80],
  southwest: [50, 51, 67, 68],
  south_center: [61, 62, 63, 64, 65, 66],
  southeast: [60, 75, 81, 82],
}

// Design doc §10 initial prop sortAnchor.y candidates (informational; E8A freezes final).
const PROP_SORT_ANCHOR_CANDIDATES = {
  'main-seat-rect': 268,
  'agent-roster-rect': 737,
  'bounty-board-rect': 379,
  'library-shelf-rect': 719,
  'roster-book-rect': 384,
}

const tmxPath = process.env.JIA_JUYITING_TMX_PATH
  ?? fileURLToPath(new URL('../../public/juyiting/hall.tmx', import.meta.url))
const fixtureDir = process.env.JIA_JUYITING_OCCLUSION_FIXTURE_DIR
  ?? fileURLToPath(new URL('../../tests/fixtures/juyiting/occlusion-v0/', import.meta.url))
const inventoryPath = resolve(fixtureDir, 'inventory.json')
const ledgerPath = resolve(fixtureDir, 'mask-ledger.md')

export function buildInventory(tmxText, options = {}) {
  const { tmxPath: sourcePath = 'public/juyiting/hall.tmx', fixtureCommit = null } = options
  const structure = parseTmxStructure(tmxText)
  const { map, tilesets, layers, groups } = structure
  const tmxSha256 = sha256Bytes(Buffer.from(tmxText, 'utf8'))

  const imageLayers = layers.filter(layer => layer.kind === 'imagelayer')

  const masks = groups.mask
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((object, index) => {
      const polygon = resolveWorldPolygon(object)
      const aabb = polygonAabb(polygon)
      const centroid = polygonCentroid(polygon)
      const authoritativeRegion = regionForMask(object.id)
      return {
        index: index + 1,
        tmxId: object.id,
        polygon,
        aabb,
        centroid,
        region: authoritativeRegion,
        regionGeometric: geometricRegion(centroid, map.width * map.tileWidth, map.height * map.tileHeight),
        regionMatch: authoritativeRegion === geometricRegion(centroid, map.width * map.tileWidth, map.height * map.tileHeight),
        targetVisualStructure: 'TBD_E10A',
        stableId: 'TBD_E10B',
        status: 'baseline_present',
      }
    })

  const hallPropsTileset = tilesets.find(tileset => tileset.name === 'hall-props')
  const props = groups.hotspots
    .filter(object => object.gid !== undefined)
    .slice()
    .sort((a, b) => a.id - b.id)
    .map(object => {
      const tileIndex = hallPropsTileset ? object.gid - hallPropsTileset.firstGid : null
      const tile = hallPropsTileset?.tiles.find(candidate => candidate.id === tileIndex)
      return {
        tmxId: object.id,
        name: object.name,
        type: object.type,
        gid: object.gid,
        tileIndex,
        asset: tile?.image ?? null,
        rect: rectAabb(object),
        sortAnchorYCandidate: PROP_SORT_ANCHOR_CANDIDATES[object.name] ?? null,
        sortAnchorYCandidateNote: 'design-doc initial candidate; E8A freezes final contact point',
        status: 'baseline_present',
      }
    })

  const collision = groups.collision.slice().sort((a, b) => a.id - b.id).map(object => ({
    tmxId: object.id,
    polygon: resolveWorldPolygon(object),
    aabb: polygonAabb(resolveWorldPolygon(object)),
  }))
  const navObstacles = groups.nav_obstacles.slice().sort((a, b) => a.id - b.id).map(object => ({
    tmxId: object.id,
    stableId: object.properties.stableId ?? null,
    sourceCollisionObjectId: object.properties.sourceCollisionObjectId ?? null,
    polygon: resolveWorldPolygon(object),
    aabb: polygonAabb(resolveWorldPolygon(object)),
  }))
  const hotspots = groups.hotspots
    .filter(object => object.gid === undefined)
    .slice()
    .sort((a, b) => a.id - b.id)
    .map(object => ({
      tmxId: object.id,
      name: object.name,
      type: object.type,
      polygon: object.polygon ? resolveWorldPolygon(object) : null,
      aabb: object.polygon ? polygonAabb(resolveWorldPolygon(object)) : rectAabb(object),
    }))
  const regions = groups.regions.slice().sort((a, b) => a.id - b.id).map(object => ({
    tmxId: object.id,
    stableId: object.properties.stableId ?? null,
    regionId: object.properties.regionId ?? null,
    label: object.properties.label ?? null,
    capacity: object.properties.capacity ?? null,
    protected: object.properties.protected ?? null,
    riskLevel: object.properties.riskLevel ?? null,
    rect: rectAabb(object),
  }))
  const navNodes = groups.nav_nodes.slice().sort((a, b) => a.id - b.id).map(object => ({
    tmxId: object.id,
    stableId: object.properties.stableId ?? null,
    kind: object.properties.kind ?? 'normal',
    channelWidth: object.properties.channelWidth ?? null,
    point: { x: object.x + object.width / 2, y: object.y + object.height / 2 },
  }))
  const navEdges = groups.nav_edges.slice().sort((a, b) => a.id - b.id).map(object => ({
    tmxId: object.id,
    stableId: object.properties.stableId ?? null,
    from: object.properties.from ?? null,
    to: object.properties.to ?? null,
    bidirectional: object.properties.bidirectional ?? false,
    points: object.polyline ? object.polyline.map(([x, y]) => ({ x: object.x + x, y: object.y + y })) : [],
  }))
  const patrolRoutes = groups.patrol_routes.slice().sort((a, b) => a.id - b.id).map(object => ({
    tmxId: object.id,
    stableId: object.properties.stableId ?? null,
    routeId: object.properties.routeId ?? null,
    personaCode: object.properties.personaCode ?? null,
    loop: object.properties.loop ?? false,
    points: object.polyline ? object.polyline.map(([x, y]) => ({ x: object.x + x, y: object.y + y })) : [],
  }))

  const counts = {
    masks: masks.length,
    props: props.length,
    imageLayers: imageLayers.length,
    collision: collision.length,
    navObstacles: navObstacles.length,
    hotspots: hotspots.length,
    propRects: props.length,
    regions: regions.length,
    navNodes: navNodes.length,
    navEdges: navEdges.length,
    patrolRoutes: patrolRoutes.length,
    parkingSlots: groups.parking_slots.length,
    queueSlots: groups.queue_slots.length,
    homeSlots: groups.home_slots.length,
  }

  return {
    schemaVersion: 1,
    generatedBy: 'scripts/juyiting/inventory-juyiting-map.mjs',
    tmxSha256,
    commit: fixtureCommit,
    map: {
      width: map.width,
      height: map.height,
      tileWidth: map.tileWidth,
      tileHeight: map.tileHeight,
      worldWidth: map.width * map.tileWidth,
      worldHeight: map.height * map.tileHeight,
      sceneId: map.properties.sceneId ?? null,
      movementSchemaVersion: map.properties.movementSchemaVersion ?? null,
      navGraphVersion: map.properties.navGraphVersion ?? null,
    },
    counts,
    imageLayers: imageLayers.map(layer => ({
      tmxId: layer.id,
      name: layer.name,
      source: layer.source,
      width: layer.width,
      height: layer.height,
      opacity: layer.opacity,
    })),
    masks,
    props,
    collision,
    navObstacles,
    hotspots,
    regions,
    navNodes,
    navEdges,
    patrolRoutes,
  }
}

export function serializeInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`
}

export function renderMaskLedgerMarkdown(inventory) {
  const lines = []
  lines.push('# Juyiting 37-mask migration ledger (E1 baseline)')
  lines.push('')
  lines.push(`- TMX: \`public/juyiting/hall.tmx\``)
  lines.push(`- TMX SHA-256: \`${inventory.tmxSha256}\``)
  lines.push(`- Commit: ${inventory.commit ?? 'unknown'}`)
  lines.push('')
  lines.push('| # | TMX id | region | regionGeometric | AABB (minX,minY,w×h) | vertices | targetVisualStructure | stableId | status |')
  lines.push('|---:|---:|---|---|---|---|---|---|---|')
  for (const mask of inventory.masks) {
    const aabb = mask.aabb
    const match = mask.regionMatch ? '✓' : '✗'
    lines.push(
      `| ${mask.index} | ${mask.tmxId} | ${mask.region}${match} | ${mask.regionGeometric} | ${aabb.minX},${aabb.minY} ${aabb.width}×${aabb.height} | ${mask.polygon.length} | ${mask.targetVisualStructure} | ${mask.stableId} | ${mask.status} |`,
    )
  }
  lines.push('')
  lines.push(`Total masks: ${inventory.counts.masks}`)
  lines.push('')
  lines.push('> visual structure and stableId are assigned in E10A/E10B, not guessed in E1.')
  return `${lines.join('\n')}\n`
}

export function runInventory(args = process.argv.slice(2), environment = process.env) {
  const mode = parseArguments(args)
  const tmxText = readRequiredFile(tmxPath, 'Juyiting TMX source')
  const fixtureCommit = currentCommit()
  const inventory = buildInventory(tmxText, { tmxPath, fixtureCommit })
  const json = serializeInventory(inventory)
  const markdown = renderMaskLedgerMarkdown(inventory)

  if (mode === 'stdout') {
    process.stdout.write(json)
    return inventory
  }
  if (mode === 'update') {
    mkdirSync(fixtureDir, { recursive: true })
    writeFileSync(inventoryPath, json, 'utf8')
    writeFileSync(ledgerPath, markdown, 'utf8')
    console.log(`Juyiting occlusion inventory updated: ${inventoryPath}`)
    console.log(`Juyiting mask ledger updated: ${ledgerPath}`)
    return inventory
  }
  const committedJson = readRequiredFile(inventoryPath, 'Juyiting occlusion inventory fixture')
  const committedMarkdown = readRequiredFile(ledgerPath, 'Juyiting mask ledger fixture')
  if (committedJson !== json) {
    throw new Error('Juyiting occlusion inventory mismatch. Review the TMX change, then run npm run inventory:juyiting-map -- --update.')
  }
  if (committedMarkdown !== markdown) {
    throw new Error('Juyiting mask ledger mismatch. Review the TMX change, then run npm run inventory:juyiting-map -- --update.')
  }
  console.log('Juyiting occlusion inventory valid')
  return inventory
}

function parseArguments(args) {
  if (args.length === 0) return 'verify'
  if (args.length === 1 && args[0] === '--update') return 'update'
  if (args.length === 1 && args[0] === '--stdout') return 'stdout'
  throw new Error(`Unknown arguments: ${args.join(' ')}`)
}

function regionForMask(tmxId) {
  for (const [region, ids] of Object.entries(AUTHORITATIVE_REGIONS)) {
    if (ids.includes(tmxId)) return region
  }
  return 'unknown'
}

function geometricRegion(centroid, mapWidth, mapHeight) {
  const column = centroid.x < mapWidth / 3 ? 'west'
    : centroid.x < (mapWidth * 2) / 3 ? 'center'
      : 'east'
  const row = centroid.y < mapHeight / 3 ? 'north'
    : centroid.y < (mapHeight * 2) / 3 ? 'center'
      : 'south'
  if (row === 'north' && column === 'west') return 'northwest'
  if (row === 'north' && column === 'center') return 'north_center'
  if (row === 'north' && column === 'east') return 'northeast'
  if (row === 'center' && column === 'west') return 'west_center'
  if (row === 'center' && column === 'center') return 'center'
  if (row === 'center' && column === 'east') return 'east_center'
  if (row === 'south' && column === 'west') return 'southwest'
  if (row === 'south' && column === 'center') return 'south_center'
  return 'southeast'
}

function currentCommit() {
  try {
    const { execSync } = requireChildProcess()
    const value = execSync('git rev-parse HEAD', { cwd: tmxDir(), encoding: 'utf8' }).trim()
    return /^[0-9a-f]{40}$/.test(value) ? value : null
  } catch {
    return null
  }
}

function tmxDir() {
  return dirname(tmxPath)
}

function readRequiredFile(path, label) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} is missing: ${path}`)
    throw new Error(`Unable to read ${label} at ${path}: ${error?.code ?? error}`)
  }
}

function requireChildProcess() {
  return { execSync: execSyncImpl }
}

import { execSync as nodeExecSync } from 'node:child_process'
function execSyncImpl(command, options) {
  return nodeExecSync(command, options)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runInventory()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
