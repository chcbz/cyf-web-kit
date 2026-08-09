#!/usr/bin/env node

/**
 * E10A: Generate 37-mask migration ledger
 *
 * Freezes every legacy mask (TMX id 48-84) into a machine-readable
 * migration spec: polygon, AABB, nine-grid region, home chunk,
 * target fragment stableId(s), sort parameters, behind/boundary/front
 * probes, recalibration decisions, and constraint decisions.
 *
 * Inputs (frozen):
 *   - tests/fixtures/juyiting/occlusion-v0/inventory.json (E1)
 *   - tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json (E9A)
 *   - tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json (E8A)
 *   - tests/fixtures/juyiting/occlusion-v2-atlases/atlas-manifest.json (E9B)
 *
 * Output:
 *   - tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

// ── Frozen provenance ──────────────────────────────────────────────
const PROVENANCE = {
  generationId: 'e10a-20260809-37mask-ledger-v1',
  taskId: 'E10A',
  baseCommit: 'b8adb0988cd17f777e44064cf79c376cd9254b92',
  tmxSha256: '291a38cc66ebd60c8577500a5afc18ce5398570fe4c35ca66d9eebe818826a97',
  e9aGenerationId: '7f8bbdd8f3ca49952d0bcfceadf60a50ad998fc7033e370cbef665ee331f3d3b',
  e9bCommit: 'b8adb0988cd17f777e44064cf79c376cd9254b92',
  e8aGenerationId: '4a47753cf81ef0219f6e1914ff818be291158bc100d4d2c639cb0c23a8a0f8c6',
  e1BaselineCommit: '2424f51f375814f403ca70a9a6e9948728e595b1',
}

// ── Nine-grid region definitions (from E1 inventory regions) ──────
const NINE_GRID = {
  northwest:     { xMin: 0,   xMax: 555,  yMin: 0,   yMax: 309 },
  north_center:  { xMin: 555, xMax: 1110, yMin: 0,   yMax: 309 },
  northeast:     { xMin: 1110,xMax: 1664, yMin: 0,   yMax: 309 },
  west_center:   { xMin: 0,   xMax: 555,  yMin: 309, yMax: 618 },
  center:        { xMin: 555, xMax: 1110, yMin: 309, yMax: 618 },
  east_center:   { xMin: 1110,xMax: 1664, yMin: 309, yMax: 618 },
  southwest:     { xMin: 0,   xMax: 555,  yMin: 618, yMax: 928 },
  south_center:  { xMin: 555, xMax: 1110, yMin: 618, yMax: 928 },
  southeast:     { xMin: 1110,xMax: 1664, yMin: 618, yMax: 928 },
}

// ── Six atlas region definitions (from E9A regionPartition) ───────
const SIX_REGIONS = {
  'west-upper':  { xRange: [0, 721],     yRange: [0, 580],   chunkId: 'west-upper' },
  'center':      { xRange: [721, 1130],   yRange: [0, 580],   chunkId: 'center' },
  'east-upper':  { xRange: [1130, 1664],  yRange: [0, 580],   chunkId: 'east-upper' },
  'west-lower':  { xRange: [0, 721],     yRange: [580, 928],  chunkId: 'west-lower' },
  'entrance':    { xRange: [721, 1130],   yRange: [580, 928],  chunkId: 'entrance' },
  'east-lower':  { xRange: [1130, 1664],  yRange: [580, 928],  chunkId: 'east-lower' },
}

// ── Probe defaults ─────────────────────────────────────────────────
const PROBE_DEFAULTS = {
  sceneId: 'juyiting-main',
  floorId: 'floor-1',
  elevation: 0,
  renderBand: 'world',
  sortMode: 'fixed-point-y',
  tieBias: 0,
}

// ── Load inputs ────────────────────────────────────────────────────
function loadJson(relPath) {
  return JSON.parse(readFileSync(join(repoRoot, relPath), 'utf-8'))
}

const inventory = loadJson('tests/fixtures/juyiting/occlusion-v0/inventory.json')
const fragSpec = loadJson('tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json')
const propSpec = loadJson('tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json')

// Build fragment lookup by stableId
const fragMap = new Map()
for (const f of fragSpec.fragments) {
  fragMap.set(f.stableId, f)
}

// Build prop lookup
const propMap = new Map()
for (const p of propSpec.props) {
  propMap.set(p.stableId, p)
}

// ── Geometry helpers ───────────────────────────────────────────────
function rectOverlapArea(a, b) {
  const dx = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
  const dy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY))
  return dx * dy
}

function centroidInRegion(cx, cy, region) {
  const r = SIX_REGIONS[region]
  if (!r) return false
  return cx >= r.xRange[0] && cx < r.xRange[1] && cy >= r.yRange[0] && cy < r.yRange[1]
}

function determineHomeChunk(cx, cy, declaredNineGrid) {
  // First try: map nine-grid to six-region
  const ngToSix = {
    'northwest': 'west-upper',
    'north_center': cx < 721 ? 'west-upper' : (cx < 1130 ? 'center' : 'east-upper'),
    'northeast': 'east-upper',
    'west_center': 'west-lower',
    'center': cx < 721 ? 'west-lower' : (cx < 1130 ? 'entrance' : 'east-lower'),
    'east_center': 'east-lower',
    'southwest': 'west-lower',
    'south_center': 'entrance',
    'southeast': 'east-lower',
  }
  const candidate = ngToSix[declaredNineGrid] || 'center'

  // Verify centroid actually falls in the candidate region
  if (centroidInRegion(cx, cy, candidate)) {
    return candidate
  }

  // Fallback: find actual region containing centroid
  for (const [name, rdef] of Object.entries(SIX_REGIONS)) {
    if (cx >= rdef.xRange[0] && cx < rdef.xRange[1] &&
        cy >= rdef.yRange[0] && cy < rdef.yRange[1]) {
      return name
    }
  }
  return candidate
}

function computeGeometricNineGrid(cx, cy) {
  for (const [name, bounds] of Object.entries(NINE_GRID)) {
    if (cx >= bounds.xMin && cx < bounds.xMax && cy >= bounds.yMin && cy < bounds.yMax) {
      return name
    }
  }
  return 'center' // fallback
}

function pointInPolygon(px, py, poly) {
  let inside = false
  const n = poly.length
  let j = n - 1
  for (let i = 0; i < n; i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    if ((yi > py) !== (yj > py) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
    j = i
  }
  return inside
}

// ── Fragment overlap computation ───────────────────────────────────
function findFragmentOverlaps(mask) {
  const maskAabb = mask.aabb
  const maskPoly = mask.polygon
  const candidates = []

  for (const frag of fragSpec.fragments) {
    const sr = frag.sourceRect
    const fragAabb = {
      minX: sr.x, minY: sr.y,
      maxX: sr.x + sr.width, maxY: sr.y + sr.height,
      width: sr.width, height: sr.height,
    }
    const area = rectOverlapArea(maskAabb, fragAabb)
    if (area <= 0) continue

    const maskArea = maskAabb.width * maskAabb.height
    const fragArea = sr.width * sr.height
    const pctOfMask = maskArea > 0 ? area / maskArea * 100 : 0
    const pctOfFrag = fragArea > 0 ? area / fragArea * 100 : 0

    // Verify polygon actually overlaps fragment (sample intersection)
    const inter = {
      minX: Math.max(maskAabb.minX, fragAabb.minX),
      minY: Math.max(maskAabb.minY, fragAabb.minY),
      maxX: Math.min(maskAabb.maxX, fragAabb.maxX),
      maxY: Math.min(maskAabb.maxY, fragAabb.maxY),
    }
    // Sample 4 corners and center of intersection
    const samples = [
      { x: inter.minX + 1, y: inter.minY + 1 },
      { x: inter.maxX - 1, y: inter.minY + 1 },
      { x: inter.minX + 1, y: inter.maxY - 1 },
      { x: inter.maxX - 1, y: inter.maxY - 1 },
      { x: (inter.minX + inter.maxX) / 2, y: (inter.minY + inter.maxY) / 2 },
    ]
    const polyHits = samples.filter(s => pointInPolygon(s.x, s.y, maskPoly)).length

    candidates.push({
      stableId: frag.stableId,
      semanticType: frag.semanticType,
      region: frag.region,
      overlapArea: area,
      pctOfMask: Math.round(pctOfMask * 10) / 10,
      pctOfFrag: Math.round(pctOfFrag * 10) / 10,
      polySampleHits: polyHits,
      fragmentSourceRect: {
        x: sr.x, y: sr.y, width: sr.width, height: sr.height,
      },
      fragmentHomeRegion: frag.homeRegion || frag.region,
    })
  }

  candidates.sort((a, b) => b.overlapArea - a.overlapArea)
  return candidates
}

// ── Probe generation ───────────────────────────────────────────────
function findPointInsidePolygonAtY(polygon, targetY, aabb, preferCenterX) {
  // Sample x positions at the given y to find a point inside the polygon
  const minX = Math.floor(aabb.minX)
  const maxX = Math.ceil(aabb.maxX)

  // Try center X first if provided
  if (preferCenterX !== undefined) {
    const cx = Math.round(preferCenterX)
    if (cx >= minX && cx <= maxX && pointInPolygon(cx, targetY, polygon)) {
      return cx
    }
  }

  // Scan from center outward
  const centerX = Math.round((minX + maxX) / 2)
  for (let offset = 0; offset <= (maxX - minX) / 2 + 1; offset++) {
    for (const dir of [1, -1]) {
      const x = centerX + dir * offset
      if (x >= minX && x <= maxX && pointInPolygon(x, targetY, polygon)) {
        return x
      }
    }
  }
  return null
}

function generateProbes(mask, targetFragment, relationDecision) {
  const aabb = mask.aabb
  const cx = mask.centroid.x
  const cy = mask.centroid.y
  const polygon = mask.polygon

  // Fragment sourceRect center
  const sr = targetFragment.fragmentSourceRect
  const fragCenterY = sr.y + sr.height / 2

  // Determine probe Y positions based on the mask extent and fragment
  const minY = aabb.minY
  const maxY = aabb.maxY
  const height = maxY - minY
  const midY = (minY + maxY) / 2

  // Clamp probes to mask polygon extents
  // behind probe: near top of mask (furthest from camera in isometric view)
  const behindY = Math.round(minY + height * 0.2)
  // front probe: near bottom of mask (closest to camera)
  const frontY = Math.round(maxY - height * 0.2)
  // boundary probe: near fragment's sort-relevant Y, clamped to mask
  const boundaryY = Math.round(Math.max(minY + 1, Math.min(maxY - 1, fragCenterY)))

  // Find valid X positions inside polygon at each probe Y
  const behindX = findPointInsidePolygonAtY(polygon, behindY, aabb, cx)
  const boundaryX = findPointInsidePolygonAtY(polygon, boundaryY, aabb, cx)
  const frontX = findPointInsidePolygonAtY(polygon, frontY, aabb, cx)

  if (behindX === null || boundaryX === null || frontX === null) {
    throw new Error(`Mask ${mask.tmxId}: cannot place probes inside polygon at y levels behind=${behindY} boundary=${boundaryY} front=${frontY}`)
  }

  const probes = {
    behind: {
      probeId: `mask-${mask.tmxId}-behind`,
      footPoint: { x: behindX, y: behindY },
      description: `Agent foot at upper portion of mask polygon (lower Y = further from camera)`,
      expectedRelation: 'behind',
      expectedAgentDrawOrder: 'agent behind fragment',
      rationale: 'Agent at lower Y (further from camera) should render behind the wall-mounted/building fragment',
      validatedNavigable: false, // E10B validates with runtime nav
      validatedNotInObstacle: false,
    },
    boundary: {
      probeId: `mask-${mask.tmxId}-boundary`,
      footPoint: { x: boundaryX, y: boundaryY },
      description: `Agent foot near fragment visual center Y`,
      expectedRelation: 'boundary',
      expectedAgentDrawOrder: 'agent at same Y as fragment — tieBias decides',
      rationale: 'At the same Y as the visual structure center, tieBias determines draw order',
      validatedNavigable: false,
      validatedNotInObstacle: false,
    },
    front: {
      probeId: `mask-${mask.tmxId}-front`,
      footPoint: { x: frontX, y: frontY },
      description: `Agent foot at lower portion of mask polygon (higher Y = closer to camera)`,
      expectedRelation: 'front',
      expectedAgentDrawOrder: 'agent in front of fragment',
      rationale: 'Agent at higher Y (closer to camera) should render in front of the wall-mounted/building fragment',
      validatedNavigable: false,
      validatedNotInObstacle: false,
    },
  }

  // Validate probes are within mask polygon
  for (const [key, probe] of Object.entries(probes)) {
    probe.insideMaskPolygon = pointInPolygon(probe.footPoint.x, probe.footPoint.y, mask.polygon)
    // Validate against collision/nav obstacles
    probe.insideAnyCollision = false // E10B validates
    probe.insideAnyNavObstacle = false // E10B validates
  }

  return probes
}

// ── Per-mask mapping decisions ─────────────────────────────────────
// These are determined by overlap analysis + visual structure semantics
// Each entry: { tmxId, targetFragmentStableIds[], decisionRationale, recalibrationDecision, constraintDecision }

function buildMaskMapping(mask, overlaps) {
  const tmxId = mask.tmxId
  const idx = mask.index
  const cx = mask.centroid.x
  const cy = mask.centroid.y
  const declaredRegion = mask.region
  const regionMatch = mask.regionMatch
  const geometricRegion = computeGeometricNineGrid(cx, cy)
  const homeChunkRaw = determineHomeChunk(cx, cy, declaredRegion)

  let targetFragmentStableIds = []
  let recalibrationDecision = 'none'
  let constraintDecision = null
  let visualStructureDescription = ''
  let oneToManyRationale = null

  // Primary fragment is the one with highest overlap
  const primary = overlaps.length > 0 ? overlaps[0] : null

  // ── Mask-specific mapping ─────────────────────────────────────
  // These are informed by the overlap analysis + visual structure understanding
  const MAPPING = {
    // West-upper area
    48: {
      targets: ['jyt.occ.west-upper.lantern-table-frame-01.v2'],
      visual: 'Lantern table frame in northwest upper area',
      recalibrate: 'none',
      constraint: null,
    },
    // West-lower - long table
    49: {
      targets: ['jyt.occ.west-lower.long-table-frame-01.v2'],
      visual: 'Long table frame in west area; centroid falls at y=647.8 crossing nine-grid boundary',
      recalibrate: { action: 'recalibrate', nineGridRegion: geometricRegion, homeChunk: determineHomeChunk(cx, cy, geometricRegion), reason: 'Centroid at y=647.8 falls in southwest row, not west_center; geometric nine-grid is southwest; home chunk west-lower' },
      constraint: null,
    },
    // Southwest - railing
    50: {
      targets: ['jyt.occ.west-lower.railing-02.v2'],
      visual: 'Lower railing in southwest corner',
      recalibrate: 'none',
      constraint: null,
    },
    // Southwest - large wall panel covering many sub-fragments
    51: {
      targets: [
        { stableId: 'jyt.occ.west-lower.wall-panel-assembly-01.v2', reason: 'Primary: 90.5% of mask area, wall panel assembly dominates' },
        { stableId: 'jyt.occ.west-lower.long-table-frame-01.v2', reason: 'Secondary: 11.9% mask area, long table frame fully enclosed' },
        { stableId: 'jyt.occ.west-lower.railing-02.v2', reason: 'Tertiary: 5.6% mask area, railing border fully enclosed' },
        { stableId: 'jyt.occ.west-lower.wall-lantern-01.v2', reason: 'Quaternary: 1.3% mask area, wall lantern partially enclosed' },
      ],
      visual: 'Large southwest wall panel assembly enveloping multiple architectural fragments',
      recalibrate: 'none',
      constraint: {
        type: 'one-to-many',
        decision: 'fragment-behind-agent-global',
        targets: ['jyt.occ.west-lower.wall-panel-assembly-01.v2', 'jyt.occ.west-lower.long-table-frame-01.v2', 'jyt.occ.west-lower.railing-02.v2'],
        relation: 'behind',
        priority: 'mandatory',
        scope: 'mask-polygon',
        rationale: 'Legacy mask 51 was designed as a large behind zone. All enclosed fragments are wall/floor-mounted structures that agents walk in front of. Wall-lantern excluded from constraint as it is decorative edge detail.',
      },
    },
    // West-upper - large wall panel
    52: {
      targets: ['jyt.occ.west-upper.wall-panel-assembly-01.v2'],
      visual: 'Large west-upper wall panel assembly',
      recalibrate: 'none',
      constraint: null,
    },
    // West-upper - small region inside wall panel
    53: {
      targets: ['jyt.occ.west-upper.wall-panel-assembly-01.v2'],
      visual: 'Small inset within west-upper wall panel assembly',
      recalibrate: 'none',
      constraint: null,
    },
    // West pillar
    54: {
      targets: ['jyt.occ.west-upper.pillar-01.v2'],
      visual: 'West pillar (vertical structural column)',
      recalibrate: { action: 'recalibrate', nineGridRegion: geometricRegion, homeChunk: determineHomeChunk(cx, cy, geometricRegion), reason: 'Centroid at x=562.8 crosses into center nine-grid column; pillar is firmly in west-upper atlas region' },
      constraint: null,
    },
    // Diagonal brace center-west
    55: {
      targets: ['jyt.occ.west-upper.diagonal-brace-01.v2'],
      visual: 'Diagonal wooden brace near center-west boundary',
      recalibrate: 'none',
      constraint: null,
    },
    // Diagonal brace east
    56: {
      targets: ['jyt.occ.east-upper.diagonal-brace-01.v2'],
      visual: 'Diagonal wooden brace near center-east boundary',
      recalibrate: 'none',
      constraint: null,
    },
    // East pillar upper
    57: {
      targets: ['jyt.occ.east-upper.pillar-01.v2'],
      visual: 'East pillar (vertical structural column, upper portion)',
      recalibrate: { action: 'recalibrate', nineGridRegion: geometricRegion, homeChunk: determineHomeChunk(cx, cy, geometricRegion), reason: 'Centroid at y=347.2 falls in middle nine-grid row (east_center), not north row (northeast); home chunk remains east-upper as pillar anchors there' },
      constraint: null,
    },
    // ═══════ MASK 58: THE CONTROVERSIAL ONE ═══════
    58: {
      targets: ['jyt.occ.east-upper.wall-panel-upper-01.v2'],
      visual: 'Upper east wall panel — this is NOT the bounty-board desk/table. The desk is prop TMX 92 (bounty-board). Legacy mask 58 covers the architectural wall panel at y=342-458 which is ABOVE the desk area (y≈573+). The occlusion relationship: the wall panel is always behind agents; the desk/table (prop) relationship is governed by world-order Y sorting with tieBias=-4.',
      recalibrate: 'none',
      constraint: {
        type: 'fragment-behind-agent-always',
        decision: 'wall-panel-always-behind',
        targets: ['jyt.occ.east-upper.wall-panel-upper-01.v2'],
        relation: 'behind',
        priority: 'mandatory',
        scope: 'mask-polygon',
        rationale: 'The wall panel is a background architectural element that must always render behind agents. This is NOT a desk occlusion rule — the desk (bounty-board prop TMX 92) uses Y-based world-order with tieBias=-4. User-confirmed fact: Lu Junyi below the desk (higher Y) should appear in front of the desk — this is handled by world order, not mask depth. Hu Sanniang was never incorrectly occluded by the desk because her foot Y was above the critical boundary.',
      },
    },
    // Worktable area (actual desk)
    59: {
      targets: ['jyt.occ.east-lower.worktable-01.v2'],
      visual: 'East-lower worktable — this IS the desk/workbench area at y=574-673. This fragment covers the actual work surface.',
      recalibrate: 'none',
      constraint: null,
    },
    // Lantern southeast
    60: {
      targets: ['jyt.occ.east-lower.lantern-01.v2'],
      visual: 'Hanging lantern in southeast corner',
      recalibrate: 'none',
      constraint: null,
    },
    // Entrance lantern posts
    61: {
      targets: ['jyt.occ.entrance.lantern-post-01.v2'],
      visual: 'Right lantern post at entrance/south-center',
      recalibrate: 'none',
      constraint: null,
    },
    62: {
      targets: ['jyt.occ.entrance.lantern-post-02.v2'],
      visual: 'Left lantern post at entrance/south-center',
      recalibrate: 'none',
      constraint: null,
    },
    // Hanging banners
    63: {
      targets: ['jyt.occ.entrance.hanging-banner-02.v2'],
      visual: 'Right hanging banner at entrance',
      recalibrate: 'none',
      constraint: null,
    },
    64: {
      targets: ['jyt.occ.entrance.hanging-banner-01.v2'],
      visual: 'Left hanging banner at entrance',
      recalibrate: 'none',
      constraint: null,
    },
    // Wall bracket
    65: {
      targets: ['jyt.occ.west-lower.wall-bracket-01.v2'],
      visual: 'Wall bracket fixture at west-lower / south-center boundary',
      recalibrate: 'none',
      constraint: null,
    },
    // Railing west
    66: {
      targets: [
        { stableId: 'jyt.occ.west-lower.railing-01.v2', reason: 'Primary: 95.5% mask area, railing dominates' },
      ],
      visual: 'West-lower railing spanning south-center area',
      recalibrate: 'none',
      constraint: null,
    },
    // Floor lantern
    67: {
      targets: ['jyt.occ.west-lower.floor-lantern-01.v2'],
      visual: 'Floor lantern in southwest corner',
      recalibrate: 'none',
      constraint: null,
    },
    // Wall lantern
    68: {
      targets: ['jyt.occ.west-lower.wall-lantern-01.v2'],
      visual: 'Wall-mounted lantern at southwest edge',
      recalibrate: 'none',
      constraint: null,
    },
    // Wall sconce west
    69: {
      targets: [
        { stableId: 'jyt.occ.west-upper.wall-sconce-02.v2', reason: 'Primary: 91.2% fragment coverage; mask polygon directly covers wall sconce' },
      ],
      visual: 'Wall sconce in west-upper area',
      recalibrate: 'none',
      constraint: null,
    },
    // Lantern northwest
    70: {
      targets: ['jyt.occ.west-upper.lantern-01.v2'],
      visual: 'Hanging lantern in northwest upper area',
      recalibrate: 'none',
      constraint: null,
    },
    // Wall sconce north
    71: {
      targets: ['jyt.occ.west-upper.wall-sconce-01.v2'],
      visual: 'Small wall sconce near north-center boundary',
      recalibrate: 'none',
      constraint: null,
    },
    // Wall sconce center
    72: {
      targets: ['jyt.occ.center.wall-sconce-01.v2'],
      visual: 'Small wall sconce in center-north area',
      recalibrate: 'none',
      constraint: null,
    },
    // Scroll table front
    73: {
      targets: ['jyt.occ.east-upper.scroll-table-front-01.v2'],
      visual: 'Decorative scroll table front panel in east-upper',
      recalibrate: 'none',
      constraint: null,
    },
    // Small worktable corner
    74: {
      targets: ['jyt.occ.east-lower.worktable-01.v2'],
      visual: 'Small corner of worktable at southeast; tiny mask (20x26) at worktable edge',
      recalibrate: { action: 'recalibrate', nineGridRegion: geometricRegion, homeChunk: determineHomeChunk(cx, cy, geometricRegion), reason: 'Centroid at y=683 falls in southeast nine-grid row, not east_center; home chunk east-lower' },
      constraint: null,
    },
    // Fabric rack
    75: {
      targets: ['jyt.occ.east-lower.fabric-rack-01.v2'],
      visual: 'Fabric/textile rack in southeast corner',
      recalibrate: 'none',
      constraint: null,
    },
    // Large diagonal brace east
    76: {
      targets: [
        { stableId: 'jyt.occ.east-lower.diagonal-brace-01.v2', reason: 'Primary: 84.6% mask area, large diagonal brace dominates' },
        { stableId: 'jyt.occ.east-lower.diagonal-brace-02.v2', reason: 'Secondary: 3.7% mask area, small brace fully enclosed (100% fragment coverage)' },
        { stableId: 'jyt.occ.east-lower.worktable-01.v2', reason: 'Tertiary: 4.2% mask area, worktable edge overlap' },
      ],
      visual: 'Large diagonal brace structure in east-lower, extending into both east-lower and southeast regions',
      recalibrate: { action: 'recalibrate', nineGridRegion: geometricRegion, homeChunk: determineHomeChunk(cx, cy, geometricRegion), reason: 'Centroid at y=684.2 falls in southeast nine-grid row; home chunk east-lower; the brace is a railing-like diagonal structural element' },
      constraint: {
        type: 'one-to-many',
        decision: 'fragment-behind-agent-global',
        targets: ['jyt.occ.east-lower.diagonal-brace-01.v2', 'jyt.occ.east-lower.diagonal-brace-02.v2'],
        relation: 'behind',
        priority: 'mandatory',
        scope: 'mask-polygon',
        rationale: 'Diagonal braces are railing-like structural elements that agents pass in front of. Worktable fragment excluded — its relationship is Y-sorted.',
      },
    },
    // East pillar lower
    77: {
      targets: ['jyt.occ.east-upper.pillar-02.v2'],
      visual: 'East pillar (lower portion, vertical structural column)',
      recalibrate: 'none',
      constraint: null,
    },
    // Wall panel lower east
    78: {
      targets: ['jyt.occ.east-upper.wall-panel-lower-01.v2'],
      visual: 'Lower wall panel in east-upper area',
      recalibrate: 'none',
      constraint: null,
    },
    // Diagonal brace fragment
    79: {
      targets: ['jyt.occ.east-lower.diagonal-brace-01.v2'],
      visual: 'Small region within the large east diagonal brace',
      recalibrate: 'none',
      constraint: null,
    },
    // Pillar lower extension
    80: {
      targets: ['jyt.occ.east-upper.pillar-02.v2'],
      visual: 'Pillar lower extension crossing into southeast region',
      recalibrate: { action: 'recalibrate', nineGridRegion: geometricRegion, homeChunk: determineHomeChunk(cx, cy, geometricRegion), reason: 'Centroid at y=641.2 falls in southeast nine-grid row; home chunk remains east-upper as pillar-02 anchors there' },
      constraint: null,
    },
    // Railing post
    81: {
      targets: ['jyt.occ.east-lower.railing-post-01.v2'],
      visual: 'Narrow railing post in southeast area',
      recalibrate: 'none',
      constraint: null,
    },
    // Small diagonal brace
    82: {
      targets: ['jyt.occ.east-lower.diagonal-brace-02.v2'],
      visual: 'Small diagonal brace segment in southeast',
      recalibrate: 'none',
      constraint: null,
    },
    // Diagonal brace west
    83: {
      targets: ['jyt.occ.west-lower.diagonal-brace-02.v2'],
      visual: 'Diagonal brace in west-lower area',
      recalibrate: { action: 'recalibrate', nineGridRegion: geometricRegion, homeChunk: determineHomeChunk(cx, cy, geometricRegion), reason: 'Centroid at y=693.6 falls in southwest nine-grid row; home chunk west-lower' },
      constraint: null,
    },
    // Small wall panel region
    84: {
      targets: ['jyt.occ.west-lower.wall-panel-assembly-01.v2'],
      visual: 'Small inset within west-lower wall panel assembly',
      recalibrate: 'none',
      constraint: null,
    },
  }

  const map = MAPPING[tmxId]
  if (!map) {
    // Fallback: use primary overlap
    targetFragmentStableIds = primary ? [primary.stableId] : []
    visualStructureDescription = primary ? `${primary.semanticType} (auto-mapped by overlap)` : 'TBD — no fragment overlap found'
  } else {
    targetFragmentStableIds = map.targets.map(t => typeof t === 'string' ? t : t.stableId)
    visualStructureDescription = map.visual
    recalibrationDecision = map.recalibrate
    constraintDecision = map.constraint
    oneToManyRationale = map.targets.some(t => typeof t !== 'string') ? map.targets.filter(t => typeof t !== 'string').map(t => ({ stableId: t.stableId, reason: t.reason })) : null
  }

  // Build target fragment details
  const targetFragments = targetFragmentStableIds.map(sid => {
    const frag = fragMap.get(sid)
    if (!frag) return { stableId: sid, found: false }
    return {
      stableId: sid,
      found: true,
      semanticType: frag.semanticType,
      region: frag.region,
      homeRegion: frag.homeRegion || frag.region,
      chunkId: frag.chunkId,
      sourceRect: frag.sourceRect,
    }
  })

  // Re-determine home chunk based on target fragment
  const primaryTarget = targetFragments[0]
  const homeChunk = primaryTarget && primaryTarget.found ? primaryTarget.chunkId : homeChunkRaw

  // Generate probes against primary target
  const probes = primaryTarget && primaryTarget.found
    ? generateProbes(mask, { fragmentSourceRect: primaryTarget.sourceRect }, null)
    : { behind: null, boundary: null, front: null }

  // Determine future occluder stableId
  const futureOccluderStableId = targetFragmentStableIds.map(sid => {
    // Convert fragment stableId to occluder stableId
    return sid.replace('jyt.occ.', 'jyt.occluder.').replace('.v2', '.v1')
  })

  // Compute sort parameters
  const sortAnchor = {
    x: Math.round(primaryTarget && primaryTarget.found ? primaryTarget.sourceRect.x + primaryTarget.sourceRect.width / 2 : cx),
    y: Math.round(primaryTarget && primaryTarget.found ? primaryTarget.sourceRect.y + primaryTarget.sourceRect.height / 2 : cy),
  }

  return {
    // Identity
    legacyIndex: idx,
    legacyTmxId: tmxId,
    legacyTmxName: mask.name || `mask-${tmxId}`,

    // Geometry
    polygon: mask.polygon,
    polygonVertexCount: mask.polygon.length,
    aabb: mask.aabb,
    centroid: mask.centroid,

    // Region
    nineGridRegionDeclared: declaredRegion,
    nineGridRegionGeometric: geometricRegion,
    nineGridRegionMatch: regionMatch,
    homeChunk,
    sceneId: 'juyiting-main',
    floorId: 'floor-1',

    // Visual structure
    targetVisualStructure: visualStructureDescription,
    targetFragmentStableIds,
    targetFragmentCount: targetFragmentStableIds.length,
    targetFragments,
    oneToManyRationale,

    // Future occluder
    futureOccluderStableIds: futureOccluderStableId,

    // Sort parameters
    elevation: 0,
    renderBand: 'world',
    sortMode: 'fixed-point-y',
    sortAnchor,
    tieBias: 0,

    // Probes
    probes,

    // Decisions
    recalibrationDecision,
    constraintDecision,

    // Evidence
    fragmentOverlapEvidence: overlaps.slice(0, 5).map(o => ({
      stableId: o.stableId,
      overlapArea: o.overlapArea,
      pctOfMask: o.pctOfMask,
      pctOfFrag: o.pctOfFrag,
      polySampleHits: o.polySampleHits,
    })),
  }
}

// ── Main ───────────────────────────────────────────────────────────
function main() {
  const entries = []

  for (const mask of inventory.masks) {
    const overlaps = findFragmentOverlaps(mask)
    const entry = buildMaskMapping(mask, overlaps)
    entries.push(entry)
  }

  // Verify count
  if (entries.length !== 37) {
    throw new Error(`Expected 37 masks, got ${entries.length}`)
  }

  // Verify all TMX IDs 48-84 present
  const tmxIds = new Set(entries.map(e => e.legacyTmxId))
  for (let id = 48; id <= 84; id++) {
    if (!tmxIds.has(id)) {
      throw new Error(`Missing mask TMX id ${id}`)
    }
  }

  // Verify no duplicate TMX IDs
  if (tmxIds.size !== 37) {
    throw new Error(`Duplicate TMX IDs detected: ${entries.length} entries, ${tmxIds.size} unique`)
  }

  // Count recalibrations and constraints
  const recalCount = entries.filter(e => e.recalibrationDecision && e.recalibrationDecision !== 'none').length
  const constraintCount = entries.filter(e => e.constraintDecision !== null).length
  const oneToManyCount = entries.filter(e => e.targetFragmentCount > 1).length

  // Build ledger
  const ledger = {
    $schema: 'juyiting-occlusion-v2-mask-migration-ledger-v1',
    schemaVersion: 1,
    taskId: 'E10A',
    baseCommit: PROVENANCE.baseCommit,
    generationId: PROVENANCE.generationId,
    generatedAt: "2026-08-09T00:00:00.000Z",

    provenance: {
      tmxSha256: PROVENANCE.tmxSha256,
      e9aGenerationId: PROVENANCE.e9aGenerationId,
      e9bCommit: PROVENANCE.e9bCommit,
      e8aGenerationId: PROVENANCE.e8aGenerationId,
      e1BaselineCommit: PROVENANCE.e1BaselineCommit,
      inputFiles: [
        'tests/fixtures/juyiting/occlusion-v0/inventory.json',
        'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json',
        'tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json',
        'tests/fixtures/juyiting/occlusion-v2-atlases/atlas-manifest.json',
      ],
    },

    summary: {
      totalMasks: 37,
      tmxIdRange: [48, 84],
      recalibrationCount: recalCount,
      constraintCount,
      oneToManyCount,
      regionMismatchCount: entries.filter(e => !e.nineGridRegionMatch).length,
    },

    nineGridMap: NINE_GRID,
    sixRegionMap: Object.fromEntries(
      Object.entries(SIX_REGIONS).map(([name, def]) => [name, { xRange: def.xRange, yRange: def.yRange, chunkId: def.chunkId }])
    ),

    entries,
  }

  // Compute content hash for determinism
  const contentJson = JSON.stringify(ledger, null, 2)
  const contentHash = createHash('sha256').update(contentJson).digest('hex')
  ledger.contentSha256 = contentHash

  // Validate all entries have required fields
  const requiredFields = [
    'legacyIndex', 'legacyTmxId', 'polygon', 'aabb', 'centroid',
    'nineGridRegionDeclared', 'homeChunk', 'targetVisualStructure',
    'targetFragmentStableIds', 'targetFragments', 'probes',
    'recalibrationDecision', 'constraintDecision',
  ]
  for (const entry of entries) {
    for (const field of requiredFields) {
      if (entry[field] === undefined) {
        throw new Error(`Mask ${entry.legacyTmxId}: missing required field "${field}"`)
      }
    }
    // Verify all target fragments exist
    for (const tf of entry.targetFragments) {
      if (!tf.found) {
        throw new Error(`Mask ${entry.legacyTmxId}: target fragment "${tf.stableId}" not found in fragment spec`)
      }
    }
    // Verify probes exist
    for (const [key, probe] of Object.entries(entry.probes)) {
      if (!probe) {
        throw new Error(`Mask ${entry.legacyTmxId}: missing ${key} probe`)
      }
    }
  }

  // Write output
  const outPath = join(repoRoot, 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json')
  const finalJson = JSON.stringify(ledger, null, 2)
  writeFileSync(outPath, finalJson, 'utf-8')

  console.log(`Generated ${entries.length}/37 mask migration ledger → ${outPath}`)
  console.log(`  Content SHA-256: ${contentHash}`)
  console.log(`  Recalibrations: ${recalCount}`)
  console.log(`  Constraints: ${constraintCount}`)
  console.log(`  One-to-many: ${oneToManyCount}`)
  console.log(`  Region mismatches: ${entries.filter(e => !e.nineGridRegionMatch).length}`)

  // Print mask 58 details
  const mask58 = entries.find(e => e.legacyTmxId === 58)
  if (mask58) {
    console.log('\n── Mask 58 Summary ──')
    console.log(`  Visual: ${mask58.targetVisualStructure}`)
    console.log(`  Target: ${mask58.targetFragmentStableIds.join(', ')}`)
    console.log(`  Constraint: ${mask58.constraintDecision ? mask58.constraintDecision.decision : 'none'}`)
    console.log(`  Recalibrate: ${JSON.stringify(mask58.recalibrationDecision)}`)
  }
}

main()
