#!/usr/bin/env node
/** Generate the E9A machine-readable RLE ownership proof. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { atomicWriteUtf8Batch } from './lib/atomic-write.mjs'
import {
  REPORT_PATH,
  SPEC_PATH,
  analyzeOwnership,
  buildOwnershipReport,
  computeGenerationId,
  decodeCanonicalOwnership,
} from './lib/fragment-ownership-v2.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

function main() {
  const spec = JSON.parse(readFileSync(join(REPO_ROOT, SPEC_PATH), 'utf8'))
  const expectedGenerationId = computeGenerationId(spec)
  if (expectedGenerationId !== spec.generationId) {
    throw new Error(`Spec generationId mismatch: expected ${expectedGenerationId}, got ${spec.generationId}`)
  }
  const canonicalBytes = readFileSync(join(REPO_ROOT, spec.sourceProvenance.path))
  const decoded = decodeCanonicalOwnership(canonicalBytes)
  const analysis = analyzeOwnership(spec, decoded)
  const report = buildOwnershipReport(spec, decoded, analysis)
  const output = `${JSON.stringify(report, null, 2)}\n`
  if (process.argv.includes('--update')) {
    atomicWriteUtf8Batch([{ path: join(REPO_ROOT, REPORT_PATH), content: output, label: 'E9A ownership report' }], 'E9A ownership report update')
    console.error(`Ownership report atomically written to ${REPORT_PATH}`)
  }
  console.error(`Passed: ${analysis.passed}; opaque=${analysis.opaqueOwned}/${analysis.totalOpaquePixels}; cuts=${analysis.opaqueCutEdgeCount}`)
  process.stdout.write(output)
  if (!analysis.passed) process.exitCode = 1
}

main()
