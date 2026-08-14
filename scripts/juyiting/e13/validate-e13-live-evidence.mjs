#!/usr/bin/env node
/**
 * E13 live-browser evidence validator (fail-closed).
 *
 * Validates a merged live evidence dir produced by merge-e13-live-evidence.mjs
 * against the CURRENT committed world-model.json / shot-plan.json:
 *   - world-model / shot-plan hashes match the live index
 *   - exactly 19/19 live shots E13-271..E13-289 (no missing, no duplicates)
 *   - every shot PNG hash-matches its index record
 *   - every shot ran in rendererMode=v2
 *   - browserViewport matches the plan (camera shots bind plan viewport;
 *     interaction/movement use the 1280x800 default browser viewport)
 *   - camera shots: expectedZoom / expectedPan / expectedZoomDirection from
 *     the plan's cameraExpectations; pinch compares against the plan's
 *     initial camera zoom
 *   - interaction shots: 281 selects songjiang; 282/283/284 open the planned
 *     panel class with interactionLocked; 285 keeps bubbles on
 *     宋江/卢俊义/吴用; 286/287 keep lighting present+attached at depth 300
 *   - movement shots: movementSnapshot non-empty, finite coordinates,
 *     bound to the planned actor
 *   - the three contact sheets (camera/interaction/movement) exist
 *
 * Writes live/validation.json and exits 0 only when every check passes.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const FIXTURE_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-e13')
const DEFAULT_LIVE_DIR = join(FIXTURE_DIR, 'live')
const WORLD_MODEL_PATH = join(FIXTURE_DIR, 'world-model.json')
const SHOT_PLAN_PATH = join(FIXTURE_DIR, 'shot-plan.json')

const LIVE_IDS = Object.freeze([
  'E13-271', 'E13-272', 'E13-273', 'E13-274', 'E13-275',
  'E13-276', 'E13-277', 'E13-278', 'E13-279', 'E13-280',
  'E13-281', 'E13-282', 'E13-283', 'E13-284', 'E13-285',
  'E13-286', 'E13-287', 'E13-288', 'E13-289',
])
const LIVE_ID_SET = new Set(LIVE_IDS)

const DEFAULT_BROWSER_VIEWPORT = Object.freeze({ width: 1280, height: 800 })
const ZOOM_TOLERANCE = 0.02
const PAN_TOLERANCE = 4

const PANEL_CLASS = Object.freeze({
  'E13-282': 'panel-tasks',      // hotspot-bounty-board
  'E13-283': 'panel-library',    // hotspot-library-shelf
  'E13-284': 'panel-chat',       // hotspot-main-seat
})
const MOVEMENT_ACTOR = Object.freeze({
  'E13-288': 'lujunyi',          // movement-bounty-board
  'E13-289': 'likui',            // movement-front-door
})

const sha256Buffer = buffer => createHash('sha256').update(buffer).digest('hex')
const pngDimensions = buffer => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

const results = []
const check = (name, ok, detail = '') => results.push({ check: name, ok: Boolean(ok), detail: String(detail) })

function readJson (path, label) {
  if (!existsSync(path)) throw new Error(`${label} missing: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

const finiteNumber = value => typeof value === 'number' && Number.isFinite(value)

function main () {
  const args = process.argv.slice(2)
  const arg = name => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : null
  }
  const liveDir = resolve(arg('--live-dir') || DEFAULT_LIVE_DIR)

  const worldModel = readJson(WORLD_MODEL_PATH, 'world model')
  const plan = readJson(SHOT_PLAN_PATH, 'shot plan')
  const worldModelSha256 = sha256Buffer(readFileSync(WORLD_MODEL_PATH))
  const shotPlanSha256 = sha256Buffer(readFileSync(SHOT_PLAN_PATH))
  const planById = new Map(plan.shots.map(shot => [shot.id, shot]))

  const indexPath = join(liveDir, 'index.json')
  const index = readJson(indexPath, 'live index')
  const shots = Array.isArray(index.shots) ? index.shots : []

  // ── hash binding ──
  check('live index worldModelSha256 binds current world-model.json', index.worldModelSha256 === worldModelSha256,
    `${index.worldModelSha256} vs ${worldModelSha256}`)
  check('live index shotPlanSha256 binds current shot-plan.json', index.shotPlanSha256 === shotPlanSha256,
    `${index.shotPlanSha256} vs ${shotPlanSha256}`)

  // ── 19/19 exact set ──
  const ids = shots.map(shot => shot?.id)
  const idSet = new Set(ids)
  const missing = LIVE_IDS.filter(id => !idSet.has(id))
  const duplicates = LIVE_IDS.filter(id => ids.filter(value => value === id).length > 1)
  const extras = ids.filter(id => typeof id === 'string' && !LIVE_ID_SET.has(id))
  check('live evidence has exactly 19 shots', shots.length === 19, `got ${shots.length}`)
  check('19/19 live shot ids present, none missing', missing.length === 0, missing.join(', '))
  check('no duplicate live shot ids', duplicates.length === 0, duplicates.join(', '))
  check('no live shot ids outside E13-271..E13-289', extras.length === 0, extras.join(', '))
  const shotsDir = join(liveDir, 'shots')
  const diskPngs = existsSync(shotsDir) ? readdirSync(shotsDir).filter(file => file.endsWith('.png')).sort() : []
  const expectedPngs = LIVE_IDS.map(id => `${id}.png`).sort()
  check('live/shots contains exactly the 19 planned PNG files',
    JSON.stringify(diskPngs) === JSON.stringify(expectedPngs),
    `got ${diskPngs.join(', ')}`)
  check('live shot kinds are camera/interaction/movement only',
    shots.every(shot => ['camera', 'interaction', 'movement'].includes(shot?.kind)),
    shots.filter(shot => !['camera', 'interaction', 'movement'].includes(shot?.kind)).map(shot => shot?.id).join(','))

  const byId = new Map(shots.map(shot => [shot.id, shot]))

  // ── per-shot file hash + runtime fact checks ──
  const fileBad = []
  const dimensionBad = []
  const rendererBad = []
  const viewportBad = []
  const cameraBad = []
  const interactionBad = []
  const movementBad = []
  const movementSequenceBad = []
  const movementVisualBad = []

  for (const id of LIVE_IDS) {
    const record = byId.get(id)
    if (!record) continue
    const file = typeof record.file === 'string' ? record.file : `shots/${id}.png`
    const filePath = join(liveDir, file)
    if (!existsSync(filePath)) {
      fileBad.push(`${id}:missing`)
      continue
    }
    const png = readFileSync(filePath)
    if (sha256Buffer(png) !== record.sha256) {
      fileBad.push(`${id}:hash`)
      continue
    }
    const expectedDimensions = planById.get(id)?.kind === 'camera' ? planById.get(id).viewport : DEFAULT_BROWSER_VIEWPORT
    const dimensions = pngDimensions(png)
    if (!dimensions || dimensions.width !== expectedDimensions.width || dimensions.height !== expectedDimensions.height) {
      dimensionBad.push(`${id}:${dimensions ? `${dimensions.width}x${dimensions.height}` : 'invalid-png'} != ${expectedDimensions.width}x${expectedDimensions.height}`)
    }
    const facts = record.runtimeFacts && typeof record.runtimeFacts === 'object' ? record.runtimeFacts : {}
    const planShot = planById.get(id)

    if (record.kind === 'movement') {
      const sequence = Array.isArray(record.movementSequence) ? record.movementSequence : []
      if (sequence.length !== 3 || sequence.map(frame => frame?.stage).join(',') !== 'before,mid,after') {
        movementSequenceBad.push(`${id}:sequence-shape`)
      } else {
        const frameHashes = sequence.map(frame => frame?.sha256)
        if (frameHashes.some(hash => typeof hash !== 'string') || new Set(frameHashes).size !== 3) {
          movementSequenceBad.push(`${id}:before-mid-after frames must have three distinct hashes`)
        }
        for (const frame of sequence) {
          const expectedFile = `movement-sequences/${id}-${frame.stage}.png`
          const framePath = join(liveDir, frame.file || '')
          if (frame.file !== expectedFile || !existsSync(framePath)) {
            movementSequenceBad.push(`${id}:${frame.stage}:missing-or-path`)
            continue
          }
          const framePng = readFileSync(framePath)
          const frameDimensions = pngDimensions(framePng)
          if (sha256Buffer(framePng) !== frame.sha256 || !frameDimensions || frameDimensions.width !== 1280 || frameDimensions.height !== 800) {
            movementSequenceBad.push(`${id}:${frame.stage}:hash-or-dimensions`)
          }
        }
      }
    }

    if (facts.rendererMode !== 'v2') rendererBad.push(id)

    // browser viewport: camera binds plan viewport, others bind the 1280x800 default
    const expectedViewport = planShot?.kind === 'camera' ? planShot.viewport : DEFAULT_BROWSER_VIEWPORT
    const actualViewport = facts.browserViewport
    if (!actualViewport || actualViewport.width !== expectedViewport.width || actualViewport.height !== expectedViewport.height) {
      viewportBad.push(`${id}:${actualViewport ? `${actualViewport.width}x${actualViewport.height}` : 'none'} != ${expectedViewport.width}x${expectedViewport.height}`)
    }

    if (id === 'E13-271' || id === 'E13-272' || id === 'E13-273' ||
        id === 'E13-274' || id === 'E13-275' || id === 'E13-276' ||
        id === 'E13-277' || id === 'E13-278' || id === 'E13-279' || id === 'E13-280') {
      cameraBad.push(...validateCamera(id, record, facts, planShot))
    } else if (id >= 'E13-281' && id <= 'E13-287') {
      interactionBad.push(...validateInteraction(id, record, facts))
    } else if (id === 'E13-288' || id === 'E13-289') {
      const movementFailures = validateMovement(id, record, facts)
      movementBad.push(...movementFailures)
      movementVisualBad.push(...movementFailures.filter(failure => failure.includes('visual')))
    }
  }

  check('19/19 live shot PNGs exist and hash-match the index', fileBad.length === 0, fileBad.join(', '))
  check('19/19 live shot PNG dimensions match their planned viewport', dimensionBad.length === 0, dimensionBad.join(', '))
  check('19/19 live shots ran in rendererMode=v2', rendererBad.length === 0, rendererBad.join(', '))
  check('browserViewport matches plan for every shot', viewportBad.length === 0, viewportBad.slice(0, 12).join('; '))
  check('camera shots satisfy plan expectedZoom/expectedPan/expectedZoomDirection', cameraBad.length === 0, cameraBad.slice(0, 12).join('; '))
  check('interaction shots satisfy selection/panel/bubble/lighting contracts', interactionBad.length === 0, interactionBad.slice(0, 12).join('; '))
  check('movement shots carry hash-bound 1280x800 before/mid/after sequences', movementSequenceBad.length === 0, movementSequenceBad.slice(0, 12).join('; '))
  check('movement shots prove actor-bound displacement toward the planned region', movementBad.length === 0, movementBad.slice(0, 12).join('; '))
  check('movement engine snapshots and rendered actor positions agree at every captured frame', movementVisualBad.length === 0, movementVisualBad.slice(0, 12).join('; '))

  // ── contact sheets exist ──
  const contactDir = join(liveDir, 'contact-sheets')
  const missingSheets = []
  for (const sheet of ['camera.png', 'interaction.png', 'movement.png']) {
    const path = join(contactDir, sheet)
    if (!existsSync(path)) {
      missingSheets.push(`${sheet}:missing`)
      continue
    }
    const buffer = readFileSync(path)
    if (buffer.length === 0) {
      missingSheets.push(`${sheet}:empty`)
    } else if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      missingSheets.push(`${sheet}:not-png`)
    }
  }
  check('camera/interaction/movement contact sheets exist as PNGs', missingSheets.length === 0, missingSheets.join(', '))

  const pass = results.every(result => result.ok)
  const validationPath = join(liveDir, 'validation.json')
  const stableValidation = {
    $schema: 'juyiting-occlusion-e13-live-validation-v1',
    schemaVersion: 1,
    taskId: 'E13',
    pass,
    liveDir: relative(REPO_ROOT, liveDir).replaceAll('\\', '/'),
    worldModelSha256,
    shotPlanSha256,
    shotCount: shots.length,
    cameraShots: shots.filter(shot => shot.kind === 'camera').length,
    interactionShots: shots.filter(shot => shot.kind === 'interaction').length,
    movementShots: shots.filter(shot => shot.kind === 'movement').length,
    passedChecks: results.filter(result => result.ok).length,
    totalChecks: results.length,
    failures: results.filter(result => !result.ok).map(result => ({ check: result.check, detail: result.detail })),
    checks: results,
  }
  let checkedAt = new Date().toISOString()
  if (existsSync(validationPath)) {
    try {
      const previous = JSON.parse(readFileSync(validationPath, 'utf8'))
      const { checkedAt: previousCheckedAt, ...previousStable } = previous
      if (typeof previousCheckedAt === 'string' && JSON.stringify(previousStable) === JSON.stringify(stableValidation)) {
        checkedAt = previousCheckedAt
      }
    } catch {
      // Invalid prior output is replaced by the new fail-closed report.
    }
  }
  const validation = {
    $schema: stableValidation.$schema,
    schemaVersion: stableValidation.schemaVersion,
    taskId: stableValidation.taskId,
    pass: stableValidation.pass,
    checkedAt,
    liveDir: stableValidation.liveDir,
    worldModelSha256: stableValidation.worldModelSha256,
    shotPlanSha256: stableValidation.shotPlanSha256,
    shotCount: stableValidation.shotCount,
    cameraShots: stableValidation.cameraShots,
    interactionShots: stableValidation.interactionShots,
    movementShots: stableValidation.movementShots,
    passedChecks: stableValidation.passedChecks,
    totalChecks: stableValidation.totalChecks,
    failures: stableValidation.failures,
    checks: stableValidation.checks,
  }
  writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`)

  console.log(`[validate-e13-live] ${pass ? 'PASS' : 'FAIL'} ${validation.passedChecks}/${validation.totalChecks} checks (${liveDir})`)
  for (const failure of validation.failures) {
    console.error(`[validate-e13-live] FAILED ${failure.check}: ${failure.detail}`)
  }
  process.exit(pass ? 0 : 1)
}

function validateCamera (id, record, facts, planShot) {
  const failures = []
  const transform = facts.camera?.transform
  const zoom = transform?.zoom
  if (!transform || !finiteNumber(zoom) || !finiteNumber(transform.offsetX) || !finiteNumber(transform.offsetY)) {
    failures.push(`${id}:camera-transform-invalid`)
    return failures
  }
  const expectations = planShot?.cameraExpectations || {}
  const expectedZoom = expectations.expectedZoom
  if (expectedZoom != null) {
    if (Math.abs(zoom - expectedZoom) > ZOOM_TOLERANCE) {
      failures.push(`${id}:zoom ${zoom} != expected ${expectedZoom}`)
    }
  }
  const expectedPan = expectations.expectedPan
  if (expectedPan) {
    // HallScene camera transform is based on its internal world viewport
    // (1664x928 for the desktop preset), not the browser CSS viewport.
    const viewport = facts.camera?.viewport
    if (!viewport || !finiteNumber(viewport.width) || !finiteNumber(viewport.height)) {
      failures.push(`${id}:camera viewport invalid for pan validation`)
      return failures
    }
    const camera = planShot?.camera || {}
    const center = camera.center || { x: 0, y: 0 }
    const plannedZoom = finiteNumber(camera.zoom) ? camera.zoom : zoom
    const baselineOffsetX = -(center.x - viewport.width / 2) * plannedZoom
    const panDx = finiteNumber(camera.panDx) ? camera.panDx : 0
    const expectedOffsetX = baselineOffsetX + panDx
    if (Math.abs(transform.offsetX - expectedOffsetX) > PAN_TOLERANCE) {
      failures.push(`${id}:pan offsetX ${transform.offsetX} != expected ${expectedOffsetX} (${expectedPan})`)
    }
    if (expectedPan === 'positive-x' && !(transform.offsetX > baselineOffsetX)) {
      failures.push(`${id}:pan direction not positive-x (offsetX ${transform.offsetX} <= baseline ${baselineOffsetX})`)
    }
    if (expectedPan === 'negative-x' && !(transform.offsetX < baselineOffsetX)) {
      failures.push(`${id}:pan direction not negative-x (offsetX ${transform.offsetX} >= baseline ${baselineOffsetX})`)
    }
    // pan shots are defined "from centered zoom <planned zoom>"; keep the zoom binding
    if (finiteNumber(camera.zoom) && Math.abs(zoom - camera.zoom) > ZOOM_TOLERANCE) {
      failures.push(`${id}:pan zoom ${zoom} != planned ${camera.zoom}`)
    }
  }
  const expectedDirection = expectations.expectedZoomDirection
  if (expectedDirection) {
    const initialZoom = finiteNumber(planShot?.camera?.zoom) ? planShot.camera.zoom : 1
    if (expectedDirection === 'increase' && !(zoom > initialZoom + ZOOM_TOLERANCE)) {
      failures.push(`${id}:pinch zoom ${zoom} did not increase from initial ${initialZoom}`)
    }
    if (expectedDirection === 'decrease' && !(zoom < initialZoom - ZOOM_TOLERANCE)) {
      failures.push(`${id}:pinch zoom ${zoom} did not decrease from initial ${initialZoom}`)
    }
  }
  return failures
}

function validateInteraction (id, record, facts) {
  const failures = []
  if (id === 'E13-281') {
    const selected = Array.isArray(facts.selectedAgents) ? facts.selectedAgents : []
    const visuals = Array.isArray(facts.agentVisuals) ? facts.agentVisuals : []
    const songjiang = visuals.find(visual => visual?.id === 'songjiang')
    if (!selected.includes('songjiang')) failures.push(`${id}:songjiang not in selectedAgents`)
    if (songjiang?.selected !== true) failures.push(`${id}:agentVisuals songjiang.selected != true`)
  } else if (PANEL_CLASS[id]) {
    const expectedClass = PANEL_CLASS[id]
    const openPanelClass = facts.openPanelClass || ''
    if (!String(openPanelClass).split(/\s+/).includes(expectedClass)) {
      failures.push(`${id}:openPanelClass ${JSON.stringify(openPanelClass)} missing ${expectedClass}`)
    }
    if (facts.input?.interactionLocked !== true) {
      failures.push(`${id}:interactionLocked != true (${JSON.stringify(facts.input)})`)
    }
  } else if (id === 'E13-285') {
    if (facts.openPanelClass != null) failures.push(`${id}:unexpected floating panel ${JSON.stringify(facts.openPanelClass)}`)
    const visuals = Array.isArray(facts.agentVisuals) ? facts.agentVisuals : []
    for (const persona of ['songjiang', 'lujunyi', 'wuyong']) {
      const visual = visuals.find(item => item?.id === persona)
      const bubbleText = visual?.bubbleText
      if (typeof bubbleText !== 'string' || bubbleText.trim().length === 0) {
        failures.push(`${id}:${persona} bubbleText empty/missing`)
      }
    }
  } else if (id === 'E13-286' || id === 'E13-287') {
    if (facts.openPanelClass != null) failures.push(`${id}:unexpected floating panel ${JSON.stringify(facts.openPanelClass)}`)
    const lighting = facts.lighting || {}
    if (lighting.present !== true) failures.push(`${id}:lighting.present != true`)
    if (lighting.attached !== true) failures.push(`${id}:lighting.attached != true`)
    if (lighting.depth !== 300) failures.push(`${id}:lighting.depth ${JSON.stringify(lighting.depth)} != 300`)
  }
  return failures
}

function validateMovement (id, record, facts) {
  const failures = []
  const snapshot = facts.movementSnapshot
  const actor = MOVEMENT_ACTOR[id]
  if (!snapshot || typeof snapshot !== 'object') {
    failures.push(`${id}:movementSnapshot missing`)
    return failures
  }
  if (snapshot.agentId !== actor) failures.push(`${id}:movementSnapshot.agentId ${JSON.stringify(snapshot.agentId)} != ${actor}`)
  if (!finiteNumber(snapshot.x) || !finiteNumber(snapshot.y)) {
    failures.push(`${id}:movementSnapshot coordinates not finite (${JSON.stringify(snapshot.x)}, ${JSON.stringify(snapshot.y)})`)
  }
  if (snapshot.stateVersion !== 2) failures.push(`${id}:movementSnapshot.stateVersion ${JSON.stringify(snapshot.stateVersion)} != 2`)
  if (snapshot.behavior !== 'moving_to_region') failures.push(`${id}:movementSnapshot.behavior ${JSON.stringify(snapshot.behavior)} != moving_to_region`)
  if (!['moving', 'arrived'].includes(snapshot.phase)) failures.push(`${id}:movementSnapshot.phase ${JSON.stringify(snapshot.phase)} is not moving/arrived`)
  const expectedRegion = id === 'E13-288' ? 'bounty-board' : 'gate'
  const probe = facts.movementProbe
  if (!probe || probe.actor !== actor || probe.targetRegionId !== expectedRegion) {
    failures.push(`${id}:movementProbe actor/target mismatch`)
  } else {
    const frames = [probe.before, probe.mid, probe.after]
    if (frames.some(frame => !frame || frame.agentId !== actor || !finiteNumber(frame.x) || !finiteNumber(frame.y))) {
      failures.push(`${id}:movementProbe before/mid/after invalid`)
    } else {
      const total = Math.hypot(probe.after.x - probe.before.x, probe.after.y - probe.before.y)
      const firstLeg = Math.hypot(probe.mid.x - probe.before.x, probe.mid.y - probe.before.y)
      if (!(total > 10)) failures.push(`${id}:total displacement ${total.toFixed(3)} <= 10`)
      if (!(firstLeg > 0.5)) failures.push(`${id}:before-to-mid displacement ${firstLeg.toFixed(3)} <= 0.5`)
      const visuals = probe.visuals
      for (const stage of ['before', 'mid', 'after']) {
        const engine = probe[stage]
        const visual = visuals?.[stage]
        if (!visual || !finiteNumber(visual.x) || !finiteNumber(visual.y)) {
          failures.push(`${id}:${stage} visual position missing`)
          continue
        }
        const drift = Math.hypot(visual.x - engine.x, visual.y - engine.y)
        if (drift > 0.5) failures.push(`${id}:${stage} visual drift ${drift.toFixed(3)} > 0.5`)
      }
    }
  }
  const finalVisual = Array.isArray(facts.agentVisuals) ? facts.agentVisuals.find(item => item?.id === actor) : null
  if (!finalVisual || !finiteNumber(finalVisual.x) || !finiteNumber(finalVisual.y)) {
    failures.push(`${id}:final visual actor missing`)
  } else if (finiteNumber(snapshot.x) && finiteNumber(snapshot.y)) {
    const finalDrift = Math.hypot(finalVisual.x - snapshot.x, finalVisual.y - snapshot.y)
    if (finalDrift > 0.5) failures.push(`${id}:final visual drift ${finalDrift.toFixed(3)} > 0.5`)
  }
  if (snapshot.phase === 'moving' && snapshot.targetRegionId !== expectedRegion) {
    failures.push(`${id}:moving targetRegionId ${JSON.stringify(snapshot.targetRegionId)} != ${expectedRegion}`)
  }
  if (snapshot.phase === 'arrived' && snapshot.regionId !== expectedRegion) {
    failures.push(`${id}:arrived regionId ${JSON.stringify(snapshot.regionId)} != ${expectedRegion}`)
  }
  return failures
}

try {
  main()
} catch (error) {
  console.error(`[validate-e13-live] FAIL: ${error.message}`)
  process.exit(1)
}
