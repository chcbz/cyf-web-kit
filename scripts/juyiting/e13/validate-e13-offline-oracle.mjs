#!/usr/bin/env node
/**
 * E13 Production Oracle — cross-validates Python offline renderer sort keys
 * against production-equivalent Node.js computation.
 *
 * This is NOT self-certifying: it independently computes WorldSortKeys from
 * the committed TMX data using the same constants/algorithms as the production
 * TypeScript (worldOrder.ts, schema.ts), then compares against every shot's
 * Python-computed sort keys from index.json.
 *
 * Fail-closed: any mismatch → exit 1.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const EVIDENCE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'juyiting', 'occlusion-e13')
const TMX_PATH = join(REPO_ROOT, 'public', 'juyiting', 'hall.tmx')

// ── Production constants (from schema.ts) ──
const RENDER_BAND_ORDER = Object.freeze({
  background: 0,
  world: 100,
  overhead: 200,
  lighting: 300,
  'world-ui': 400,
  'screen-ui': 500,
})

const DEFAULT_FLOOR_REGISTRY = Object.freeze({ 'floor-1': 0 })

// ── Parse TMX objects (fragments + props) into Node-side sort objects ──
function parseTmxObjects (tmxText) {
  const objects = []

  // Parse objectgroups and their objects
  const objGroupRe = /<objectgroup[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/objectgroup>/g
  let groupMatch
  while ((groupMatch = objGroupRe.exec(tmxText)) !== null) {
    const groupName = groupMatch[1]
    const groupBody = groupMatch[2]

    const objRe = /<object\b[^>]*>([\s\S]*?)<\/object>/g
    let objMatch
    while ((objMatch = objRe.exec(groupBody)) !== null) {
      const tag = objMatch[0]
      const body = objMatch[1]

      // Extract attributes
      const getAttr = name => {
        const m = tag.match(new RegExp(`${name}="([^"]*)"`))
        return m ? m[1] : null
      }

      // Extract properties
      const props = {}
      const propRe = /<property name="([^"]+)"[^>]*value="([^"]*)"/g
      let propMatch
      while ((propMatch = propRe.exec(body)) !== null) {
        props[propMatch[1]] = propMatch[2]
      }

      const stableId = props.stableId
      if (!stableId) continue

      const kind = props.kind || ''
      const isFragment = groupName.startsWith('v2-fragments') || kind === 'occluder-fragment'
      const isProp = kind === 'prop'
      if (!isFragment && !isProp) continue

      objects.push({
        stableId,
        kind: isProp ? 'prop' : 'fragment',
        renderBand: props.renderBand || 'world',
        floorId: props.floorId || 'floor-1',
        elevation: parseInt(props.elevation || '0', 10),
        sortAnchorX: parseFloat(props.sortAnchorX || getAttr('x') || '0'),
        sortAnchorY: parseFloat(props.sortAnchorY || getAttr('y') || '0'),
        tieBias: parseInt(props.tieBias || '0', 10),
        destinationX: parseFloat(getAttr('x') || '0'),
        destinationY: parseFloat(getAttr('y') || '0'),
        destinationW: parseFloat(getAttr('width') || '0'),
        destinationH: parseFloat(getAttr('height') || '0'),
      })
    }
  }

  return objects
}

// ── WorldSortKey computation (production-equivalent) ──
function computeWorldSortKey (obj) {
  const renderBandOrder = RENDER_BAND_ORDER[obj.renderBand] ?? 100
  const floorOrder = DEFAULT_FLOOR_REGISTRY[obj.floorId] ?? 0
  const elevation = obj.elevation
  const fixedPointY = Math.round(obj.sortAnchorY * 256)
  const fixedPointYNorm = Object.is(fixedPointY, -0) ? 0 : fixedPointY
  const tieBias = obj.tieBias

  return {
    renderBandOrder,
    floorOrder,
    elevation,
    fixedPointY: fixedPointYNorm,
    tieBias,
    stableId: obj.stableId,
  }
}

// ── StableId comparison (ASCII byte order, NO localeCompare) ──
function compareStableId (a, b) {
  const minLen = Math.min(a.length, b.length)
  for (let i = 0; i < minLen; i++) {
    const ca = a.charCodeAt(i)
    const cb = b.charCodeAt(i)
    if (ca < cb) return -1
    if (ca > cb) return 1
  }
  if (a.length < b.length) return -1
  if (a.length > b.length) return 1
  return 0
}

// ── Sort key comparison ──
function compareWorldSortKeys (a, b) {
  if (a.renderBandOrder !== b.renderBandOrder) return a.renderBandOrder < b.renderBandOrder ? -1 : 1
  if (a.floorOrder !== b.floorOrder) return a.floorOrder < b.floorOrder ? -1 : 1
  if (a.elevation !== b.elevation) return a.elevation < b.elevation ? -1 : 1
  if (a.fixedPointY !== b.fixedPointY) return a.fixedPointY < b.fixedPointY ? -1 : 1
  if (a.tieBias !== b.tieBias) return a.tieBias < b.tieBias ? -1 : 1
  return compareStableId(a.stableId, b.stableId)
}

// ── Convert Python sort key list (from index.json) to Node format ──
function pyKeyToNodeKey (pyKey) {
  // Python key is [renderBandOrder, floorOrder, elevation, fixedPointY, tieBias, stableId]
  return {
    renderBandOrder: pyKey[0],
    floorOrder: pyKey[1],
    elevation: pyKey[2],
    fixedPointY: pyKey[3],
    tieBias: pyKey[4],
    stableId: pyKey[5],
  }
}

// ── Main ──
function main () {
  const index = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'index.json'), 'utf8'))
  const tmx = readFileSync(TMX_PATH, 'utf8')
  const tmxObjects = parseTmxObjects(tmx)

  // Build lookup by stableId
  const tmxById = new Map()
  for (const o of tmxObjects) {
    tmxById.set(o.stableId, o)
  }

  console.log(`[oracle] TMX objects parsed: ${tmxObjects.length}`)
  console.log(`[oracle] Index shots: ${index.shots.length}`)

  const failures = []
  let checks = 0

  for (const shot of index.shots) {
    if (shot.kind !== 'matrix') continue
    const facts = shot.runtimeFacts
    if (!facts) {
      failures.push(`${shot.id}: missing runtimeFacts`)
      continue
    }

    // Validate agent sort key
    const pyAgentKey = facts.agentSortKey
    if (!pyAgentKey || pyAgentKey.length !== 6) {
      failures.push(`${shot.id}: invalid agentSortKey`)
      continue
    }

    // Build agent sort key independently
    const agentObj = {
      stableId: `agent.${shot.persona}`,
      kind: 'agent',
      renderBand: 'world',
      floorId: 'floor-1',
      elevation: 0,
      sortAnchorX: shot.worldX,
      sortAnchorY: shot.worldY,
      tieBias: 0,
    }
    const nodeAgentKey = computeWorldSortKey(agentObj)
    checks++

    // Compare field by field
    if (nodeAgentKey.renderBandOrder !== pyAgentKey[0]) {
      failures.push(`${shot.id}: agent renderBandOrder mismatch Node=${nodeAgentKey.renderBandOrder} Py=${pyAgentKey[0]}`)
    }
    if (nodeAgentKey.floorOrder !== pyAgentKey[1]) {
      failures.push(`${shot.id}: agent floorOrder mismatch Node=${nodeAgentKey.floorOrder} Py=${pyAgentKey[1]}`)
    }
    if (nodeAgentKey.elevation !== pyAgentKey[2]) {
      failures.push(`${shot.id}: agent elevation mismatch Node=${nodeAgentKey.elevation} Py=${pyAgentKey[2]}`)
    }
    if (nodeAgentKey.fixedPointY !== pyAgentKey[3]) {
      failures.push(`${shot.id}: agent fixedPointY mismatch Node=${nodeAgentKey.fixedPointY} Py=${pyAgentKey[3]}`)
    }
    if (nodeAgentKey.tieBias !== pyAgentKey[4]) {
      failures.push(`${shot.id}: agent tieBias mismatch Node=${nodeAgentKey.tieBias} Py=${pyAgentKey[4]}`)
    }
    if (nodeAgentKey.stableId !== pyAgentKey[5]) {
      failures.push(`${shot.id}: agent stableId mismatch Node=${nodeAgentKey.stableId} Py=${pyAgentKey[5]}`)
    }

    // Validate target sort key
    const pyTargetKey = facts.targetSortKey
    if (!pyTargetKey) {
      failures.push(`${shot.id}: missing targetSortKey for ${shot.targetStableId}`)
      continue
    }

    const targetObj = tmxById.get(shot.targetStableId)
    if (!targetObj) {
      failures.push(`${shot.id}: target ${shot.targetStableId} not found in TMX`)
      continue
    }
    const nodeTargetKey = computeWorldSortKey(targetObj)
    checks++

    if (nodeTargetKey.renderBandOrder !== pyTargetKey[0]) {
      failures.push(`${shot.id}: target renderBandOrder mismatch Node=${nodeTargetKey.renderBandOrder} Py=${pyTargetKey[0]}`)
    }
    if (nodeTargetKey.floorOrder !== pyTargetKey[1]) {
      failures.push(`${shot.id}: target floorOrder mismatch Node=${nodeTargetKey.floorOrder} Py=${pyTargetKey[1]}`)
    }
    if (nodeTargetKey.elevation !== pyTargetKey[2]) {
      failures.push(`${shot.id}: target elevation mismatch Node=${nodeTargetKey.elevation} Py=${pyTargetKey[2]}`)
    }
    if (nodeTargetKey.fixedPointY !== pyTargetKey[3]) {
      failures.push(`${shot.id}: target fixedPointY mismatch Node=${nodeTargetKey.fixedPointY} Py=${pyTargetKey[3]}`)
    }
    if (nodeTargetKey.tieBias !== pyTargetKey[4]) {
      failures.push(`${shot.id}: target tieBias mismatch Node=${nodeTargetKey.tieBias} Py=${pyTargetKey[4]}`)
    }
    if (nodeTargetKey.stableId !== pyTargetKey[5]) {
      failures.push(`${shot.id}: target stableId mismatch Node=${nodeTargetKey.stableId} Py=${pyTargetKey[5]}`)
    }

    // Validate ordering matches sort key comparison
    const nodeOrdering = compareWorldSortKeys(nodeAgentKey, nodeTargetKey)
    const resolvedOrdering = nodeOrdering < 0 ? 'agent_behind_target'
      : nodeOrdering > 0 ? 'agent_in_front'
      : 'tie'

    if (resolvedOrdering !== facts.ordering) {
      failures.push(`${shot.id}: ordering mismatch Node=${resolvedOrdering} Py=${facts.ordering}`)
    }
    checks++

    // Validate depthMatch
    const depthMatch = resolvedOrdering === shot.expectedRelation
    if (depthMatch !== facts.depthMatch) {
      failures.push(`${shot.id}: depthMatch mismatch Node=${depthMatch} Py=${facts.depthMatch}`)
    }
    checks++

    // Validate expectedRelation matches resolved
    if (shot.expectedRelation !== resolvedOrdering) {
      failures.push(`${shot.id}: expectedRelation ${shot.expectedRelation} != resolved ${resolvedOrdering}`)
    }
    checks++
  }

  // Summary
  const passed = failures.length === 0
  console.log(`[oracle] ${checks} checks, ${failures.length} failures`)

  if (!passed) {
    console.error('[oracle] FAILURES:')
    for (const f of failures.slice(0, 20)) {
      console.error(`  ${f}`)
    }
    if (failures.length > 20) {
      console.error(`  ... and ${failures.length - 20} more`)
    }
  }

  // Write oracle report
  const report = {
    $schema: 'juyiting-occlusion-e13-oracle-v1',
    taskId: 'E13',
    pass: passed,
    checks,
    failures: failures.length,
    failureDetails: failures.slice(0, 100),
    methodology: 'Node.js independent computation of WorldSortKey from committed TMX, compared against Python index.json agentSortKey/targetSortKey/depthMatch fields',
    tmxSha256: createHash('sha256').update(tmx).digest('hex'),
    indexSha256: createHash('sha256').update(readFileSync(join(EVIDENCE_DIR, 'index.json'))).digest('hex'),
  }

  writeFileSync(
    join(EVIDENCE_DIR, 'oracle-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  )

  if (!passed) process.exit(1)
}

main()
