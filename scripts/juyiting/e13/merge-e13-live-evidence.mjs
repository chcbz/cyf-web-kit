#!/usr/bin/env node
/**
 * E13 live-browser evidence merge tool.
 *
 * Consumes one or more per-batch output directories written by
 * generate-e13-evidence.mjs (batch dirs each contain index.json plus
 * shots/*.png). The merge tool is fail-closed:
 *   - every batch index must bind the CURRENT committed world-model.json
 *     and shot-plan.json (worldModelSha256 / shotPlanSha256)
 *   - every batch shot file must hash-match its index record
 *   - the merged set must be EXACTLY the 19 live shots E13-271..E13-289
 *     (10 camera / 7 interaction / 2 movement), no missing, no duplicates,
 *     no extras
 *
 * Output (default tests/fixtures/juyiting/occlusion-e13/live):
 *   live/shots/E13-<id>.png      copied verbatim from the batches
 *   live/index.json              merged index (records bound to plan)
 *   live/contact-sheets/camera.png | interaction.png | movement.png
 *                                 rendered by render-e13-live-contact-sheets.py
 *
 * No screenshot is ever fabricated: files are copied byte-for-byte from
 * real browser captures after hash verification.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const FIXTURE_DIR = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-e13')
const DEFAULT_LIVE_DIR = join(FIXTURE_DIR, 'live')

const WORLD_MODEL_PATH = join(FIXTURE_DIR, 'world-model.json')
const SHOT_PLAN_PATH = join(FIXTURE_DIR, 'shot-plan.json')

// The 19 live browser shots: 10 camera + 7 interaction + 2 movement.
const LIVE_IDS = Object.freeze([
  'E13-271', 'E13-272', 'E13-273', 'E13-274', 'E13-275',
  'E13-276', 'E13-277', 'E13-278', 'E13-279', 'E13-280',
  'E13-281', 'E13-282', 'E13-283', 'E13-284', 'E13-285',
  'E13-286', 'E13-287', 'E13-288', 'E13-289',
])
const LIVE_ID_SET = new Set(LIVE_IDS)

const sha256Buffer = buffer => createHash('sha256').update(buffer).digest('hex')
const sha256File = path => sha256Buffer(readFileSync(path))

function fail (message) {
  console.error(`[merge-e13-live] FAIL: ${message}`)
  process.exit(1)
}

function readJson (path, label) {
  if (!existsSync(path)) throw new Error(`${label} missing: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function main () {
  const args = process.argv.slice(2)
  const collect = name => {
    const values = []
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === name && args[i + 1]) values.push(args[i + 1])
    }
    return values
  }
  const value = name => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : null
  }
  const batchDirs = collect('--input').map(dir => resolve(dir))
  const liveDir = resolve(value('--output') || DEFAULT_LIVE_DIR)

  if (batchDirs.length === 0) fail('no --input <batchDir> provided (repeatable)')
  if (!existsSync(WORLD_MODEL_PATH)) fail(`world model missing: ${WORLD_MODEL_PATH}`)
  if (!existsSync(SHOT_PLAN_PATH)) fail(`shot plan missing: ${SHOT_PLAN_PATH}`)

  const worldModel = readJson(WORLD_MODEL_PATH, 'world model')
  const plan = readJson(SHOT_PLAN_PATH, 'shot plan')
  const currentWorldModelSha256 = sha256File(WORLD_MODEL_PATH)
  const currentShotPlanSha256 = sha256File(SHOT_PLAN_PATH)

  const planById = new Map(plan.shots.map(shot => [shot.id, shot]))

  // ── pass 1: validate every batch against the current hashes and file bytes ──
  const merged = new Map() // id -> { record, batchDir }
  const sourceBatches = []
  const batchIndexHashes = []

  for (const batchDir of batchDirs) {
    const indexPath = join(batchDir, 'index.json')
    let index
    try {
      index = readJson(indexPath, 'batch index')
    } catch (error) {
      fail(`batch ${batchDir}: ${error.message}`)
    }
    const indexSha256 = sha256File(indexPath)
    const batchLabel = basename(batchDir)
    batchIndexHashes.push({ batch: batchLabel, indexSha256 })
    if (index.worldModelSha256 !== currentWorldModelSha256) {
      fail(`batch ${batchDir}: worldModelSha256 ${index.worldModelSha256} does not match current ${currentWorldModelSha256}`)
    }
    if (index.shotPlanSha256 !== currentShotPlanSha256) {
      fail(`batch ${batchDir}: shotPlanSha256 ${index.shotPlanSha256} does not match current ${currentShotPlanSha256}`)
    }
    const records = Array.isArray(index.shots) ? index.shots : []
    if (records.length === 0) fail(`batch ${batchDir}: index.json has no shots`)
    for (const record of records) {
      const id = record?.id
      if (typeof id !== 'string' || !LIVE_ID_SET.has(id)) {
        fail(`batch ${batchDir}: record id ${JSON.stringify(id)} is not one of the 19 live shots E13-271..E13-289`)
      }
      if (typeof record.kind !== 'string') fail(`batch ${batchDir}: record ${id} missing kind`)
      if (!record.runtimeFacts || typeof record.runtimeFacts !== 'object') {
        fail(`batch ${batchDir}: record ${id} missing runtimeFacts`)
      }
      const file = typeof record.file === 'string' ? record.file : `shots/${id}.png`
      if (!/^shots\/[^/]+\.png$/.test(file)) fail(`batch ${batchDir}: record ${id} has unexpected file path ${file}`)
      const filePath = join(batchDir, file)
      if (!existsSync(filePath)) fail(`batch ${batchDir}: record ${id} file missing: ${filePath}`)
      const actual = sha256File(filePath)
      if (actual !== record.sha256) {
        fail(`batch ${batchDir}: record ${id} file hash mismatch: index ${record.sha256}, file ${actual}`)
      }
      if (record.kind === 'movement') {
        const sequence = Array.isArray(record.movementSequence) ? record.movementSequence : []
        if (sequence.length !== 3 || sequence.map(frame => frame?.stage).join(',') !== 'before,mid,after') {
          fail(`batch ${batchDir}: movement record ${id} must have before/mid/after sequence`)
        }
        for (const frame of sequence) {
          if (!new RegExp(`^movement-sequences/${id}-(before|mid|after)\\.png$`).test(frame.file || '')) {
            fail(`batch ${batchDir}: movement record ${id} has unexpected sequence file ${frame.file}`)
          }
          const framePath = join(batchDir, frame.file)
          if (!existsSync(framePath)) fail(`batch ${batchDir}: movement sequence file missing: ${framePath}`)
          const frameHash = sha256File(framePath)
          if (frameHash !== frame.sha256) fail(`batch ${batchDir}: movement sequence hash mismatch for ${frame.file}`)
        }
      }
      if (merged.has(id)) {
        fail(`duplicate live shot ${id}: present in ${merged.get(id).batchDir} and ${batchDir}`)
      }
      merged.set(id, { record, batchDir })
    }
    sourceBatches.push(batchLabel)
  }

  // ── pass 2: the merged set must be exactly the 19 live shots ──
  const missing = LIVE_IDS.filter(id => !merged.has(id))
  if (missing.length > 0) {
    fail(`merged live evidence missing ${missing.length} shot(s): ${missing.join(', ')}`)
  }
  if (merged.size !== LIVE_IDS.length) {
    fail(`merged live evidence has ${merged.size} shots, expected exactly ${LIVE_IDS.length}`)
  }

  // ── pass 3: copy verified PNG bytes, enrich camera records from the plan ──
  const shotsDir = join(liveDir, 'shots')
  const contactDir = join(liveDir, 'contact-sheets')
  const movementDir = join(liveDir, 'movement-sequences')
  mkdirSync(shotsDir, { recursive: true })
  mkdirSync(contactDir, { recursive: true })
  mkdirSync(movementDir, { recursive: true })

  const enriched = []
  for (const id of LIVE_IDS) {
    const { record } = merged.get(id)
    const file = typeof record.file === 'string' ? record.file : `shots/${id}.png`
    const sourcePath = join(merged.get(id).batchDir, file)
    const buffer = readFileSync(sourcePath)
    if (sha256Buffer(buffer) !== record.sha256) fail(`internal hash re-check failed for ${id}`)
    const destPath = join(shotsDir, `${id}.png`)
    writeFileSync(destPath, buffer)

    const planShot = planById.get(id)
    const next = { ...record, file: `shots/${id}.png` }
    if (planShot?.kind === 'camera') {
      next.viewport = planShot.viewport
      next.camera = planShot.camera
      next.cameraExpectations = planShot.cameraExpectations
    }
    if (record.kind === 'movement') {
      next.movementSequence = record.movementSequence.map(frame => {
        const sourceFrame = join(merged.get(id).batchDir, frame.file)
        const destFile = `movement-sequences/${id}-${frame.stage}.png`
        const frameBuffer = readFileSync(sourceFrame)
        if (sha256Buffer(frameBuffer) !== frame.sha256) fail(`internal sequence hash re-check failed for ${id}:${frame.stage}`)
        writeFileSync(join(liveDir, destFile), frameBuffer)
        return { stage: frame.stage, file: destFile, sha256: frame.sha256 }
      })
    }
    enriched.push(next)
  }
  enriched.sort((a, b) => a.id.localeCompare(b.id))

  const index = {
    $schema: 'juyiting-occlusion-e13-live-index-v1',
    schemaVersion: 1,
    taskId: 'E13',
    status: 'MERGED',
    generatedAt: new Date().toISOString(),
    worldModelSha256: currentWorldModelSha256,
    shotPlanSha256: currentShotPlanSha256,
    shotCount: enriched.length,
    cameraShots: enriched.filter(shot => shot.kind === 'camera').length,
    interactionShots: enriched.filter(shot => shot.kind === 'interaction').length,
    movementShots: enriched.filter(shot => shot.kind === 'movement').length,
    sourceBatches,
    batchIndexHashes,
    shots: enriched,
  }
  writeFileSync(join(liveDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)

  // ── pass 4: render the three contact sheets via the Python renderer ──
  const script = join(__dirname, 'render-e13-live-contact-sheets.py')
  const result = spawnSync('python3', [script, '--live-dir', liveDir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: __dirname },
    timeout: 600000,
  })
  if (result.status !== 0) {
    fail(`render-e13-live-contact-sheets.py failed\n${result.stderr || result.stdout || ''}`)
  }
  for (const sheet of ['camera.png', 'interaction.png', 'movement.png']) {
    if (!existsSync(join(contactDir, sheet))) fail(`contact sheet not produced: ${contactDir}/${sheet}`)
  }

  console.log(`[merge-e13-live] OK: merged ${enriched.length} live shots from ${batchDirs.length} batch(es) -> ${liveDir}`)
  console.log(`[merge-e13-live] contact sheets: ${join(contactDir, 'camera.png')}, ${join(contactDir, 'interaction.png')}, ${join(contactDir, 'movement.png')}`)
}

try {
  main()
} catch (error) {
  console.error(`[merge-e13-live] FAIL: ${error.message}`)
  process.exit(1)
}
