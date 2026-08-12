#!/usr/bin/env node
/**
 * E13 machine gate — checks completeness & honesty of the committed evidence.
 *
 * Checks (all deterministic, no browser):
 *  1. world-model.json / shot-plan.json exist; shot plan re-validated against
 *     the live TMX (anchors ≤1px, tieBias) and the plan invariants (cells,
 *     personas, relations, targets, counts 270/10/7/2/289, unique ids).
 *  2. provenance sha256 in world-model.json matches the live sources.
 *  3. index.json: all 270 matrix shots present with runtimeFacts, GENERATED_OFFLINE
 *     status, camera/interaction/movement DEFERRED independently.
 *  4. Contact sheets: 15 PNG per-target sheets covering the matrix shots.
 *  5. 270 PNG evidence files exist in shots/.
 *
 * Writes machines-gate.json and exits 0 when all checks pass, else 1.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REPO_ROOT as MODEL_ROOT, loadSourceFacts, validateTargetsAgainstTmx, validateShotPlan,
  REGIONS, PERSONAS, RELATIONS, TARGETS,
} from './lib/world-model.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = MODEL_ROOT
const EVIDENCE_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-e13')
const CONTACT_DIR = join(EVIDENCE_DIR, 'contact-sheets')
const SHOTS_DIR = join(EVIDENCE_DIR, 'shots')

const sha256Text = text => createHash('sha256').update(text).digest('hex')

const results = []
function check (name, ok, detail = '') {
  results.push({ check: name, ok: Boolean(ok), detail })
  return Boolean(ok)
}

function readJson (path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function main () {
  const worldModelPath = join(EVIDENCE_DIR, 'world-model.json')
  const shotPlanPath = join(EVIDENCE_DIR, 'shot-plan.json')
  const indexPath = join(EVIDENCE_DIR, 'index.json')
  const gatePath = join(EVIDENCE_DIR, 'machines-gate.json')

  // ── 1. world model / shot plan ──
  const worldModelExists = existsSync(worldModelPath)
  const shotPlanExists = existsSync(shotPlanPath)
  check('world-model.json exists', worldModelExists)
  check('shot-plan.json exists', shotPlanExists)
  if (!worldModelExists || !shotPlanExists) {
    writeGate(gatePath)
    process.exit(1)
  }

  const worldModel = readJson(worldModelPath)
  const shotPlan = readJson(shotPlanPath)
  const plan = shotPlan.shots

  const facts = loadSourceFacts()
  const tmxErrors = validateTargetsAgainstTmx(facts, worldModel.targets || TARGETS)
  check('targets anchored to TMX (≤1px) + tieBias', tmxErrors.length === 0, tmxErrors.join('; '))
  const planChecks = validateShotPlan(plan, facts)
  check('shot plan invariants (cells/personas/relations/targets/ids)', planChecks.length === 0, planChecks.join('; '))

  const counts = { matrix: 0, camera: 0, interaction: 0, movement: 0 }
  for (const shot of plan) counts[shot.kind] = (counts[shot.kind] || 0) + 1
  check('matrix count = 270', counts.matrix === 270, `got ${counts.matrix}`)
  check('camera count = 10', counts.camera === 10, `got ${counts.camera}`)
  check('interaction count = 7', counts.interaction === 7, `got ${counts.interaction}`)
  check('movement count = 2', counts.movement === 2, `got ${counts.movement}`)
  check('total plan count = 289', plan.length === 289, `got ${plan.length}`)

  // coverage: every cell × persona × relation present in matrix
  const matrix = plan.filter(s => s.kind === 'matrix')
  const matrixKeys = new Set(matrix.map(s => `${s.cell}|${s.persona}|${s.relation}`))
  const missingCoverage = []
  for (const region of REGIONS) for (const persona of PERSONAS) for (const relation of Object.keys(RELATIONS)) {
    if (!matrixKeys.has(`${region.id}|${persona.personaCode}|${relation}`)) {
      missingCoverage.push(`${region.id}/${persona.personaCode}/${relation}`)
    }
  }
  check('matrix covers every cell×persona×relation', missingCoverage.length === 0, missingCoverage.join(', '))

  // focus groups all resolve to committed focus targets
  const targetByStable = new Map((worldModel.targets || TARGETS).map(t => [t.stableId, t]))
  const focusIds = new Set(TARGETS.filter(t => t.focus).map(t => t.stableId))
  const focusMissing = [...focusIds].filter(id => !targetByStable.has(id))
  check('all focus targets present in world model', focusMissing.length === 0, focusMissing.join(', '))

  // ── 2. provenance ──
  check('provenance tmx sha256 matches live TMX', worldModel.provenance?.tmxSha256 === facts.tmxSha256,
    `${worldModel.provenance?.tmxSha256} vs ${facts.tmxSha256}`)
  check('provenance fragment-spec sha256 matches', worldModel.provenance?.fragmentSpecSha256 === facts.specSha256)
  check('provenance map-snapshot sha256 matches', worldModel.provenance?.hallMapSnapshotSha256 === facts.snapshotSha256)

  // ── 3. index.json (GENERATED_OFFLINE) ──
  if (!existsSync(indexPath)) {
    check('index.json exists', false)
    writeGate(gatePath)
    process.exit(results.every(r => r.ok) ? 0 : 1)
  }
  const index = readJson(indexPath)
  const indexShots = index.shots || []

  // Detect evidence mode
  const isOffline = index.status === 'GENERATED_OFFLINE'
  check('index status is GENERATED_OFFLINE', isOffline, `got ${index.status}`)

  if (isOffline) {
    // Offline pixel renderer: 270 matrix shots, camera/interaction/movement DEFERRED
    check('index shotCount = 270', index.shotCount === 270, `got ${index.shotCount}`)
    check('index matrixShots = 270', index.matrixShots === 270, `got ${index.matrixShots}`)
    check('camera DEFERRED (0 shots)', index.cameraShots === 0, `got ${index.cameraShots}`)
    check('interaction DEFERRED (0 shots)', index.interactionShots === 0, `got ${index.interactionShots}`)
    check('movement DEFERRED (0 shots)', index.movementShots === 0, `got ${index.movementShots}`)
    check('notes.camera = DEFERRED', index.notes?.camera?.includes('DEFERRED') || false)
    check('notes.interaction = DEFERRED', index.notes?.interaction?.includes('DEFERRED') || false)
    check('notes.movement = DEFERRED', index.notes?.movement?.includes('DEFERRED') || false)

    // Every matrix shot id present in index
    const indexIds = new Set(indexShots.map(s => s.id))
    const matrixPlanIds = matrix.map(s => s.id)
    const missingInIndex = matrixPlanIds.filter(id => !indexIds.has(id))
    check('all 270 matrix shot ids in index', missingInIndex.length === 0, `missing ${missingInIndex.join(',')}`)

    // Binding and runtime facts
    const missingFacts = []
    for (const shot of indexShots) {
      if (!shot.runtimeFacts) { missingFacts.push(`${shot.id}:no runtimeFacts`); continue }
      const f = shot.runtimeFacts
      if (typeof f.actualDepth !== 'number') missingFacts.push(`${shot.id}:no actualDepth`)
      if (typeof f.targetDepth !== 'number') missingFacts.push(`${shot.id}:no targetDepth`)
      if (!f.ordering) missingFacts.push(`${shot.id}:no ordering`)
      if (f.depthMatch !== true) missingFacts.push(`${shot.id}:depthMatch=${f.depthMatch}`)
      if (!Array.isArray(f.agentSortKey)) missingFacts.push(`${shot.id}:no agentSortKey`)
      if (!shot.screenshotFile) missingFacts.push(`${shot.id}:no screenshotFile`)
      if (shot.worldX === undefined || shot.worldY === undefined) missingFacts.push(`${shot.id}:no worldX/worldY`)
    }
    check('all shots have runtimeFacts (depth, ordering, depthMatch, sortKey, screenshotFile, world)',
      missingFacts.length === 0, missingFacts.slice(0, 10).join('; '))

    // 100% depthMatch
    const depthFailures = indexShots.filter(s => s.runtimeFacts && !s.runtimeFacts.depthMatch)
    check('100% depthMatch (no tie-with-acceptable-ratio loophole)',
      depthFailures.length === 0, `${depthFailures.length} failures`)

    // Critical shots
    const luBehind = indexShots.find(
      s => s.persona === 'lujunyi' && s.relation === 'behind'
        && s.targetStableId === 'jyt.prop.northeast.bounty-board.v1'
    )
    check('卢俊义 behind bounty-board → agent_behind_target',
      luBehind && luBehind.runtimeFacts?.ordering === 'agent_behind_target',
      luBehind ? `got ${luBehind.runtimeFacts?.ordering}` : 'shot not found')

    const huBehind = indexShots.find(
      s => s.persona === 'husanniang' && s.relation === 'behind'
        && s.targetStableId === 'jyt.prop.northeast.bounty-board.v1'
    )
    check('扈三娘 behind bounty-board → agent_behind_target',
      huBehind && huBehind.runtimeFacts?.ordering === 'agent_behind_target',
      huBehind ? `got ${huBehind.runtimeFacts?.ordering}` : 'shot not found')
  } else {
    // Legacy: old GENERATED or BLOCKED mode
    check('index shotCount (legacy)', false, `unexpected status ${index.status}`)
  }

  // ── 4. shots/ PNG evidence ──
  const shotsInDir = existsSync(SHOTS_DIR) ? readdirSync(SHOTS_DIR).filter(f => f.endsWith('.png')) : []
  check('270 PNG evidence files in shots/', shotsInDir.length === 270, `got ${shotsInDir.length}`)
  const smallPngs = shotsInDir.filter(f => {
    try { return readFileSync(join(SHOTS_DIR, f)).length < 500 } catch { return true }
  })
  check('all PNGs > 500 bytes', smallPngs.length === 0, smallPngs.join(', '))

  // ── 5. contact sheets ──
  const sheetDirOk = existsSync(CONTACT_DIR)
  check('contact-sheets dir exists', sheetDirOk)
  if (sheetDirOk) {
    const files = readdirSync(CONTACT_DIR)
    const pngs = files.filter(f => f.endsWith('.png'))
    check('15 PNG contact sheets (per-target)', pngs.length === 15, `got ${pngs.length}`)
    const smallSheets = pngs.filter(f => {
      try { return readFileSync(join(CONTACT_DIR, f)).length < 500 } catch { return true }
    })
    check('all contact sheets > 500 bytes', smallSheets.length === 0, smallSheets.join(', '))
  }

  // ── write gate ──
  writeGate(gatePath)

  const passed = results.every(r => r.ok)
  console.log(`E13 machine gate: ${results.filter(r => r.ok).length}/${results.length} checks passed`)
  if (!passed) {
    for (const r of results.filter(r => !r.ok)) console.error(`  FAIL ${r.check}: ${r.detail}`)
  }
  process.exit(passed ? 0 : 1)
}

function writeGate (gatePath) {
  const gate = {
    $schema: 'juyiting-occlusion-e13-machines-gate-v2',
    taskId: 'E13',
    timestamp: new Date().toISOString(),
    generatedBy: 'validate-e13-evidence.mjs',
    pass: results.every(r => r.ok),
    passedChecks: results.filter(r => r.ok).length,
    totalChecks: results.length,
    failures: results.filter(r => !r.ok).map(r => ({ check: r.check, detail: r.detail })),
    checks: results,
  }
  writeFileSync(gatePath, `${JSON.stringify(gate, null, 2)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
