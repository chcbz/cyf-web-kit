#!/usr/bin/env node
/**
 * E9A V2 fragment ownership generator.
 *
 * Decodes the immutable canonical WebP, computes full-image 8-connected alpha
 * components, maps them through the reviewed semantic catalog, emits exact
 * per-pixel RLE ownership, and atomically updates spec/report/contact evidence.
 * No atlas image is produced.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { atomicWriteUtf8Batch } from './lib/atomic-write.mjs'
import {
  CANONICAL_EXPECTED_SHA256,
  CANONICAL_PATH,
  CONTACT_SHEET_PATH,
  REPORT_PATH,
  SPEC_PATH,
  analyzeOwnership,
  buildOwnershipReport,
  buildSpec,
  decodeCanonicalOwnership,
  stableStringify,
} from './lib/fragment-ownership-v2.mjs'
import { renderContactSheetSvg } from './render-fragment-contact-sheet.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

function main() {
  const canonicalBytes = readFileSync(join(REPO_ROOT, CANONICAL_PATH))
  const decoded = decodeCanonicalOwnership(canonicalBytes)
  if (decoded.sourceSha256 !== CANONICAL_EXPECTED_SHA256) {
    throw new Error(`Canonical hash mismatch: ${decoded.sourceSha256}`)
  }

  const spec = buildSpec(decoded)
  const analysis = analyzeOwnership(spec, decoded)
  if (!analysis.passed) {
    throw new Error(`Generated ownership is invalid: ${stableStringify({
      opaqueUnowned: analysis.opaqueUnowned,
      overlapPixels: analysis.overlapPixels,
      transparentOwned: analysis.transparentOwned,
      opaqueCutEdgeCount: analysis.opaqueCutEdgeCount,
    })}`)
  }
  const report = buildOwnershipReport(spec, decoded, analysis)
  const specJson = `${JSON.stringify(spec, null, 2)}\n`
  const reportJson = `${JSON.stringify(report, null, 2)}\n`
  const contactSheetSvg = renderContactSheetSvg(spec, canonicalBytes, report)

  if (process.argv.includes('--update')) {
    atomicWriteUtf8Batch([
      { path: join(REPO_ROOT, SPEC_PATH), content: specJson, label: 'E9A ownership spec' },
      { path: join(REPO_ROOT, REPORT_PATH), content: reportJson, label: 'E9A ownership report' },
      { path: join(REPO_ROOT, CONTACT_SHEET_PATH), content: contactSheetSvg, label: 'E9A contact sheet' },
    ], 'E9A V2 ownership evidence update')
    console.error(`Atomically updated ${SPEC_PATH}, ${REPORT_PATH}, and ${CONTACT_SHEET_PATH}`)
  }

  console.error(`Canonical components: ${decoded.components.length}`)
  console.error(`Semantic owners: ${spec.fragments.length}`)
  console.error(`Opaque pixels: ${analysis.opaqueOwned}/${analysis.totalOpaquePixels}`)
  console.error(`Opaque cut edges: ${analysis.opaqueCutEdgeCount}`)
  console.error(`GenerationId: ${spec.generationId}`)
  process.stdout.write(specJson)
}

main()
