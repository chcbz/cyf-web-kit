#!/usr/bin/env node
/** Aggregate E13 reviewed-evidence gate. Mechanical rebuild is a separate gate. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256File } from './lib/evidence-files.mjs'
import { validateReviewedEvidenceBindings } from './lib/review-bindings.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const args = process.argv.slice(2)
const arg = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null }
const evidence = resolve(arg('--evidence-dir') || join(repo, 'tests/fixtures/juyiting/occlusion-e13'))
const reviewedArg = arg('--reviewed-evidence-dir')
if (!reviewedArg) {
  console.error('[validate-e13-evidence] FAIL: --reviewed-evidence-dir is required; aggregate review evidence must be consumed explicitly')
  process.exit(1)
}
const reviewed = resolve(reviewedArg)
const results = []
const check = (name, ok, detail = '') => results.push({ check: name, ok: Boolean(ok), detail: String(detail) })
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const hash = sha256File

function run (command, commandArgs, timeout, env = process.env) {
  return spawnSync(command, commandArgs, { cwd: repo, encoding: 'utf8', timeout, env })
}

function main () {
  const planPath = resolve(arg('--shot-plan') || join(evidence, 'shot-plan.json'))
  const matrixScript = join(here, 'validate-e13-matrix-evidence.mjs')
  const matrixResult = run(process.execPath, ['--import', 'tsx', matrixScript, '--evidence-dir', evidence, '--shot-plan', planPath], 300000)
  const matrixGatePath = join(evidence, 'matrix-gate.json')
  let matrixGate = null
  if (existsSync(matrixGatePath)) {
    try { matrixGate = read(matrixGatePath) } catch {}
  }
  if (matrixGate?.checks) results.push(...matrixGate.checks)
  check('mechanical 270-shot matrix gate passes independently',
    matrixResult.status === 0 && matrixGate?.pass === true && matrixGate?.matrixPass === true && matrixGate.passedChecks === matrixGate.totalChecks,
    `${matrixResult.stderr || matrixResult.stdout || ''}`.trim().slice(0, 2000) || `exit ${matrixResult.status}`)
  const matrixPass = matrixResult.status === 0 && matrixGate?.pass === true

  const visualV5Path = join(reviewed, 'visual-review-v5.json')
  if (!existsSync(visualV5Path)) {
    check('GPT V5 historical review exists', false, visualV5Path)
  } else {
    const visualV5 = read(visualV5Path)
    check('GPT V5 rejection is retained as historical provenance',
      visualV5.pass === false && visualV5.verdict === 'REJECT' && visualV5.highestSeverity === 'P1' &&
      visualV5.contactSheetsReviewed === 15 && visualV5.findings?.length === 5)
  }

  results.push(...validateReviewedEvidenceBindings({ repo, evidenceDir: evidence, reviewedEvidenceDir: reviewed }))

  const pythonReviewResult = run('python3', ['-m', 'offline_pixel_renderer.validate', '--repo-root', repo, '--evidence-dir', evidence, '--review-bindings-only', '--reviewed-evidence-dir', reviewed], 30000, { ...process.env, PYTHONPATH: join(repo, 'scripts/juyiting/e13') })
  check('Python validator independently enforces V6 reviewed-artifact SHA/set/PNG bindings', pythonReviewResult.status === 0,
    `${pythonReviewResult.stderr || pythonReviewResult.stdout || ''}`.trim().slice(0, 2000) || `exit ${pythonReviewResult.status}`)

  const mappingDir = join(reviewed, 'mask-structure-mapping')
  const mappingPath = join(mappingDir, 'mask-structure-mapping.json')
  const mappingSvgPath = join(mappingDir, 'mask-structure-mapping.svg')
  const mappingVerifyPath = join(mappingDir, 'mask-structure-mapping.verify.json')
  if (![mappingPath, mappingSvgPath, mappingVerifyPath].every(existsSync)) {
    check('reviewed 37-mask mapping artifacts all exist', false, mappingDir)
  } else {
    const mapping = read(mappingPath)
    const mappingVerify = read(mappingVerifyPath)
    check('37/37 mask to structure mappings cover TMX ids 48..84 without duplicates',
      mapping.maskCount === 37 && mapping.entries?.length === 37 &&
      new Set(mapping.entries.map(entry => entry.tmxId)).size === 37 &&
      mapping.entries.every((entry, index) => entry.tmxId === 48 + index))
    check('mask mapping binds current TMX and passes independent 16/16 verification',
      mapping.currentTmxSha256 === hash(join(repo, 'public/juyiting/hall.tmx')) &&
      mappingVerify.pass === true && mappingVerify.passedChecks === mappingVerify.totalChecks && mappingVerify.totalChecks === 16 &&
      mappingVerify.sourceHashes?.manifestSha256 === hash(mappingPath) &&
      mappingVerify.sourceHashes?.svgSha256 === hash(mappingSvgPath) &&
      mappingVerify.sourceHashes?.tmxSha256 === hash(join(repo, 'public/juyiting/hall.tmx')))
    check('mask mapping visualization hash matches the actual reviewed SVG',
      mapping.visualization?.sha256 === hash(mappingSvgPath))
  }

  const liveDir = join(reviewed, 'live')
  const liveValidator = join(here, 'validate-e13-live-evidence.mjs')
  const liveValidationResult = run(process.execPath, [liveValidator, '--live-dir', liveDir, '--no-write', '--world-model', join(evidence, 'world-model.json'), '--shot-plan', planPath], 120000)
  check('live Chromium validator reruns successfully against the reviewed bytes', liveValidationResult.status === 0,
    liveValidationResult.status === 0 ? '' : (`${liveValidationResult.stderr || liveValidationResult.stdout || ''}`.trim().slice(0, 2000) || `exit ${liveValidationResult.status}`))

  const liveIndexPath = join(liveDir, 'index.json')
  const liveValidationPath = join(liveDir, 'validation.json')
  const liveVisualPath = join(liveDir, 'visual-review.json')
  if (![liveIndexPath, liveValidationPath, liveVisualPath].every(existsSync)) {
    check('reviewed live index, validation and visual review all exist', false, liveDir)
  } else {
    const liveIndex = read(liveIndexPath)
    const liveValidation = read(liveValidationPath)
    const liveVisual = read(liveVisualPath)
    check('live Chromium evidence has exactly 10 camera, 7 interaction and 2 movement shots',
      liveIndex.status === 'MERGED' && liveIndex.shotCount === 19 && liveIndex.cameraShots === 10 && liveIndex.interactionShots === 7 && liveIndex.movementShots === 2)
    check('live Chromium validator passes every fail-closed check',
      liveValidation.pass === true && liveValidation.passedChecks === liveValidation.totalChecks && liveValidation.totalChecks >= 16 &&
      liveValidation.shotCount === 19 && liveValidation.cameraShots === 10 && liveValidation.interactionShots === 7 && liveValidation.movementShots === 2)
    check('live Chromium evidence binds the explicitly consumed world model and shot plan',
      liveIndex.worldModelSha256 === hash(join(evidence, 'world-model.json')) && liveIndex.shotPlanSha256 === hash(planPath) &&
      liveValidation.worldModelSha256 === liveIndex.worldModelSha256 && liveValidation.shotPlanSha256 === liveIndex.shotPlanSha256)
    check('GPT live visual audit passes camera, interaction and movement sequences',
      liveVisual.pass === true && liveVisual.verdict === 'PASS' && liveVisual.highestSeverity === 'S0' &&
      liveVisual.scope?.liveShotsReviewed === 19 && liveVisual.scope?.movementFramesReviewed === 6 &&
      liveVisual.sheetVerdicts?.length === 3 && liveVisual.sheetVerdicts.every(item => item.verdict === 'PASS') &&
      liveVisual.movementVerdicts?.length === 2 && liveVisual.movementVerdicts.every(item => item.verdict === 'PASS') &&
      liveVisual.additionalFindings?.length === 0)
    check('GPT live visual audit hashes bind the current live index, validation and exact contact sheets',
      liveVisual.sourceHashes?.liveIndexSha256 === hash(liveIndexPath) &&
      liveVisual.sourceHashes?.liveValidationSha256 === hash(liveValidationPath) &&
      liveVisual.sourceHashes?.cameraContactSheetSha256 === hash(join(liveDir, 'contact-sheets/camera.png')) &&
      liveVisual.sourceHashes?.interactionContactSheetSha256 === hash(join(liveDir, 'contact-sheets/interaction.png')) &&
      liveVisual.sourceHashes?.movementContactSheetSha256 === hash(join(liveDir, 'contact-sheets/movement.png')))
  }

  const liveChecks = results.filter(result => result.check.startsWith('live ') || result.check.startsWith('GPT live'))
  const livePass = liveChecks.length >= 6 && liveChecks.every(result => result.ok)
  const evidencePass = results.every(result => result.ok)
  const releasePass = false
  const gate = {
    $schema: 'juyiting-occlusion-e13-machines-gate-v6',
    taskId: 'E13',
    generatedBy: 'validate-e13-evidence.mjs',
    scope: 'aggregate-reviewed-evidence',
    evidenceDir: relative(repo, evidence).replaceAll('\\', '/'),
    reviewedEvidenceDir: relative(repo, reviewed).replaceAll('\\', '/'),
    pass: releasePass,
    matrixPass,
    livePass,
    evidencePass,
    releasePass,
    releaseBlockers: ['independent release_guard pending'],
    passedChecks: results.filter(result => result.ok).length,
    totalChecks: results.length,
    failures: results.filter(result => !result.ok).map(result => ({ check: result.check, detail: result.detail })),
    checks: results,
    sourceHashes: {
      matrixGateSha256: existsSync(matrixGatePath) ? hash(matrixGatePath) : null,
      shotPlanSha256: hash(planPath),
      indexSha256: hash(join(evidence, 'index.json')),
      oracleSha256: hash(join(evidence, 'oracle-report.json')),
      pixelRecomputeReportSha256: existsSync(join(evidence, 'pixel-recompute-report.json')) ? hash(join(evidence, 'pixel-recompute-report.json')) : null,
      visualReviewV5Sha256: existsSync(visualV5Path) ? hash(visualV5Path) : null,
      visualReviewV6Sha256: existsSync(join(reviewed, 'visual-review-v6.json')) ? hash(join(reviewed, 'visual-review-v6.json')) : null,
      maskStructureMappingSha256: existsSync(mappingPath) ? hash(mappingPath) : null,
      maskStructureMappingSvgSha256: existsSync(mappingSvgPath) ? hash(mappingSvgPath) : null,
      liveIndexSha256: existsSync(liveIndexPath) ? hash(liveIndexPath) : null,
      liveValidationSha256: existsSync(liveValidationPath) ? hash(liveValidationPath) : null,
      liveVisualReviewSha256: existsSync(liveVisualPath) ? hash(liveVisualPath) : null,
    },
  }
  writeFileSync(join(evidence, 'machines-gate.json'), `${JSON.stringify(gate, null, 2)}\n`)
  console.log(`E13 aggregate reviewed-evidence gate: ${evidencePass ? 'PASS' : 'FAIL'} ${gate.passedChecks}/${gate.totalChecks}; matrix=${matrixPass}; live=${livePass}; final release: DEFERRED (release_guard pending)`)
  process.exit(evidencePass ? 0 : 1)
}

try { main() } catch (error) {
  console.error(`[validate-e13-evidence] FAIL: ${error.message}`)
  process.exit(1)
}
