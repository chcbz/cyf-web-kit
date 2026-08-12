#!/usr/bin/env node
/**
 * E13 machine gate — checks completeness & honesty of the committed evidence.
 *
 * Checks (all deterministic, no browser):
 *  1. world-model.json / shot-plan.json exist; shot plan re-validated against
 *     the live TMX (anchors ≤1px, tieBias) and the plan invariants (cells,
 *     personas, relations, targets, counts 270/10/7/2/289, unique ids).
 *  2. provenance sha256 in world-model.json matches the live sources.
 *  3. index.json: every E13-001..E13-289 present exactly once with the required
 *     binding (id/world/persona/targetStableId/expectedRelation); counts match;
 *     status is honest w.r.t. runtime-blocked.json and shots/.
 *  4. contact sheets: overview + 9 cell sheets + focus sheet exist, are well-formed
 *     XML, and their data-shot-ids partition the shot plan (each matrix shot in
 *     exactly one cell sheet; overview covers all; focus covers its subset).
 *  5. runtime-blocked.json (if present) reports screenshotsGenerated=0 and
 *     runtime-env-probes.json exists with a conclusion.
 *
 * Writes machines-gate.json and exits 0 when all checks pass, else 1.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REPO_ROOT as MODEL_ROOT, loadSourceFacts, validateTargetsAgainstTmx, validateShotPlan,
  REGIONS, PERSONAS, RELATIONS, TARGETS,
} from './lib/world-model.mjs'
import { REPO_ROOT, MAP } from './lib/contact-sheets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
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

function shotIdSet (shots) {
  return new Set(shots.map(s => s.id))
}

function main () {
  const planErrors = []
  const worldModelPath = join(EVIDENCE_DIR, 'world-model.json')
  const shotPlanPath = join(EVIDENCE_DIR, 'shot-plan.json')
  const indexPath = join(EVIDENCE_DIR, 'index.json')
  const blockedPath = join(EVIDENCE_DIR, 'runtime-blocked.json')
  const probesPath = join(EVIDENCE_DIR, 'runtime-env-probes.json')
  const gatePath = join(EVIDENCE_DIR, 'machines-gate.json')

  // ── 1. world model / shot plan ──
  const worldModelExists = existsSync(worldModelPath)
  const shotPlanExists = existsSync(shotPlanPath)
  check('world-model.json exists', worldModelExists)
  check('shot-plan.json exists', shotPlanExists)
  if (!worldModelExists || !shotPlanExists) {
    writeGate(gatePath, planErrors)
    process.exit(1)
  }

  const worldModel = readJson(worldModelPath)
  const shotPlan = readJson(shotPlanPath)
  const shots = shotPlan.shots
  const plan = shots

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
  check('total count = 289', plan.length === 289, `got ${plan.length}`)

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

  // ── 3. index.json ──
  const blocked = existsSync(blockedPath)
  const shotsInDir = existsSync(SHOTS_DIR) ? readdirSync(SHOTS_DIR).filter(f => f.endsWith('.png')) : []
  if (!existsSync(indexPath)) {
    check('index.json exists', false)
    writeGate(gatePath)
    process.exit(results.every(r => r.ok) ? 0 : 1)
  }
  const index = readJson(indexPath)
  const indexShots = index.shots || []
  const indexIds = new Set(indexShots.map(s => s.id))
  const planIds = new Set(plan.map(s => s.id))
  const missingInIndex = [...planIds].filter(id => !indexIds.has(id))
  const extraInIndex = [...indexIds].filter(id => !planIds.has(id))
  const dupInIndex = indexShots.length !== indexIds.size
  check('index has every planned shot id', missingInIndex.length === 0, `missing ${missingInIndex.join(',')}`)
  check('index has no extra/duplicate ids', extraInIndex.length === 0 && !dupInIndex, `extra ${extraInIndex.join(',')}`)
  check('index shotCount = 289', index.shotCount === 289, `got ${index.shotCount}`)

  // required binding fields per matrix shot
  const bindingMissing = []
  for (const shot of indexShots) {
    if (shot.kind === 'matrix') {
      for (const field of ['world', 'persona', 'targetStableId', 'expectedRelation']) {
        if (shot[field] === undefined || shot[field] === null) bindingMissing.push(`${shot.id}:${field}`)
      }
      if (!Array.isArray(shot.world) && (shot.world?.x === undefined || shot.world?.y === undefined)) bindingMissing.push(`${shot.id}:world.x/y`)
    }
  }
  check('index matrix shots carry id/world/persona/target/expected binding', bindingMissing.length === 0, bindingMissing.join(', '))

  // honesty: blocked → no screenshots, status BLOCKED
  if (blocked) {
    const blockedJson = readJson(blockedPath)
    check('runtime-blocked.json honest (screenshotsGenerated=0)', blockedJson.screenshotsGenerated === 0, `got ${blockedJson.screenshotsGenerated}`)
    check('index status = BLOCKED when blocked', index.status === 'BLOCKED', `got ${index.status}`)
    check('no PNG shots when blocked', shotsInDir.length === 0, `${shotsInDir.length} pngs present`)
    check('runtime-env-probes.json exists', existsSync(probesPath))
    if (existsSync(probesPath)) {
      const probes = readJson(probesPath)
      check('runtime-env-probes.json has conclusion', typeof probes.summary?.conclusion === 'string' && probes.summary.conclusion.length > 0)
    }
  } else {
    check('index status = GENERATED when screenshots exist', index.status === 'GENERATED', `got ${index.status}`)
    check('screenshots present', shotsInDir.length === 289, `got ${shotsInDir.length}`)
  }

  // ── 4. contact sheets ──
  const sheetDirOk = existsSync(CONTACT_DIR)
  check('contact-sheets dir exists', sheetDirOk)
  if (sheetDirOk) {
    const cellShots = new Map()
    for (const region of REGIONS) cellShots.set(region.id, plan.filter(s => s.kind === 'matrix' && s.cell === region.id))
    let xmlError = ''
    const sheetShotIds = {}
    for (const file of readdirSync(CONTACT_DIR).filter(f => f.endsWith('.svg'))) {
      const content = readFileSync(join(CONTACT_DIR, file), 'utf8')
      // well-formedness: starts with <?xml and closes with </svg>, balanced <svg>/</svg>
      if (!content.trimStart().startsWith('<?xml')) { xmlError = `${file}: missing xml declaration`; break }
      if (!content.trimEnd().endsWith('</svg>')) { xmlError = `${file}: missing closing </svg>`; break }
      if ((content.match(/<svg/g) || []).length !== (content.match(/<\/svg>/g) || []).length) {
        xmlError = `${file}: unbalanced svg tags`
        break
      }
      // extract root-tag attributes (our generated SVGs use plain quoted attrs)
      const rootMatch = /<svg\b([^>]*)>/.exec(content)
      if (!rootMatch) { xmlError = `${file}: svg root tag missing`; break }
      const attrText = rootMatch[1]
      const attrOf = name => {
        const m = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`).exec(attrText)
        return m ? m[2] : null
      }
      const sheet = attrOf('data-sheet') || file
      const ids = (attrOf('data-shot-ids') || '').split(',').filter(Boolean)
      sheetShotIds[file] = ids
    }
    check('all contact sheets well-formed XML', xmlError === '', xmlError)
    for (const region of REGIONS) {
      const file = `cell-${region.id}.svg`
      const expected = cellShots.get(region.id).map(s => s.id)
      const actual = sheetShotIds[file] || []
      const missing = expected.filter(id => !actual.includes(id))
      const extra = actual.filter(id => !expected.includes(id))
      check(`cell sheet ${region.id} contains exactly its ${expected.length} matrix shots`, missing.length === 0 && extra.length === 0,
        `missing ${missing.join(',')} extra ${extra.join(',')}`)
    }
    // every matrix shot in exactly one cell sheet
    const allCellIds = Object.entries(sheetShotIds)
      .filter(([file]) => file.startsWith('cell-'))
      .flatMap(([, ids]) => ids)
    const cellCounts = {}
    for (const id of allCellIds) cellCounts[id] = (cellCounts[id] || 0) + 1
    const dup = Object.entries(cellCounts).filter(([, n]) => n !== 1).map(([id, n]) => `${id}x${n}`)
    const matrixIds = matrix.map(s => s.id)
    const missingInSheets = matrixIds.filter(id => !(id in cellCounts))
    check('every matrix shot appears in exactly one cell sheet', dup.length === 0 && missingInSheets.length === 0,
      `dup ${dup.join(',')} missing ${missingInSheets.join(',')}`)
    // overview covers all
    check('overview sheet lists all 289 shots', (sheetShotIds['overview.svg'] || []).length === 289,
      `got ${(sheetShotIds['overview.svg'] || []).length}`)
    // focus sheet lists focus-target matrix shots only (180 = 10 focus targets × 18)
    const focusShotIds = new Set(matrix.filter(s => focusIds.has(s.targetStableId)).map(s => s.id))
    const focusListed = sheetShotIds['focus-targets.svg'] || []
    check('focus sheet lists exactly the focus-target matrix shots', focusListed.length === focusShotIds.size && focusListed.every(id => focusShotIds.has(id)),
      `got ${focusListed.length}, expected ${focusShotIds.size}`)
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

function writeGate (gatePath, extraErrors = []) {
  const gate = {
    $schema: 'juyiting-occlusion-e13-machines-gate-v1',
    taskId: 'E13',
    timestamp: new Date().toISOString(),
    generatedBy: 'validate-e13-evidence.mjs',
    pass: results.every(r => r.ok),
    passedChecks: results.filter(r => r.ok).length,
    totalChecks: results.length,
    failures: results.filter(r => !r.ok).map(r => ({ check: r.check, detail: r.detail })),
    extraErrors,
    checks: results,
  }
  writeFileSync(gatePath, `${JSON.stringify(gate, null, 2)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
