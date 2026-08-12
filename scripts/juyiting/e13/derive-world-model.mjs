#!/usr/bin/env node
/**
 * E13: derive and write the machine-checked world model + shot plan.
 * Usage: node scripts/juyiting/e13/derive-world-model.mjs [--output <dir>]
 * Outputs world-model.json and shot-plan.json into the E13 evidence fixture dir.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWorldModelJson, buildShotPlan, REPO_ROOT } from './lib/world-model.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_OUT = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-e13')

function parseArgs (args) {
  const output = args[args.indexOf('--output') + 1] || DEFAULT_OUT
  return { output: resolve(output) }
}

const { output } = parseArgs(process.argv.slice(2))
mkdirSync(output, { recursive: true })
const model = buildWorldModelJson()
const plan = buildShotPlan()
writeFileSync(join(output, 'world-model.json'), `${JSON.stringify(model, null, 2)}\n`)
writeFileSync(join(output, 'shot-plan.json'), `${JSON.stringify({ $schema: 'juyiting-occlusion-e13-shot-plan-v1', taskId: 'E13', shotCount: plan.length, shots: plan }, null, 2)}\n`)
console.log(`E13 world model written to ${output}`)
console.log(JSON.stringify(model.shotCounts, null, 2))
