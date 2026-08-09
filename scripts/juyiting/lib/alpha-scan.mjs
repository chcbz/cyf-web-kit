#!/usr/bin/env node
/**
 * E8A Alpha Scan — deterministic PNG alpha-channel analysis.
 *
 * Reads a PNG, returns per-row opaque-pixel counts, spans, and min/max X.
 * All output is purely numeric; no heuristics, no interpretation.
 *
 * Usage:
 *   import { alphaScan, lastSpanRow, findTransitions, scanReport } from './lib/alpha-scan.mjs'
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'

/**
 * Result for a single image row.
 * @typedef {{ y: number, count: number, span: number, minX: number|null, maxX: number|null }} RowResult
 */

/**
 * Full scan result.
 * @typedef {{ width: number, height: number, rows: RowResult[], sha256: string }} ScanResult
 */

/**
 * Deterministic alpha scan of a PNG file.
 * @param {string} filePath - path to PNG
 * @returns {ScanResult}
 */
export function alphaScan(filePath) {
  const buf = readFileSync(filePath)
  // SHA-256 of raw bytes for provenance
  const sha256 = createHash('sha256').update(buf).digest('hex')

  const png = PNG.sync.read(buf)
  const { width, height, data } = png
  const rows = []

  for (let y = 0; y < height; y++) {
    let count = 0, minX = width, maxX = -1
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
    const span = count > 0 ? maxX - minX + 1 : 0
    rows.push({
      y,
      count,
      span,
      minX: count > 0 ? minX : null,
      maxX: count > 0 ? maxX : null
    })
  }

  const opaqueRows = rows.filter(row => row.count > 0)
  if (opaqueRows.length === 0) throw new Error(`PNG has no alpha pixels: ${filePath}`)
  const alphaAabb = {
    minX: Math.min(...opaqueRows.map(row => row.minX)),
    minY: opaqueRows[0].y,
    maxX: Math.max(...opaqueRows.map(row => row.maxX)) + 1,
    maxY: opaqueRows[opaqueRows.length - 1].y + 1
  }
  alphaAabb.width = alphaAabb.maxX - alphaAabb.minX
  alphaAabb.height = alphaAabb.maxY - alphaAabb.minY
  alphaAabb.opaquePixels = rows.reduce((sum, row) => sum + row.count, 0)
  return { width, height, rows, sha256, alphaAabb }
}

/**
 * Find the last row (from bottom) with span ≥ threshold.
 * @param {ScanResult} scan
 * @param {number} threshold - minimum contiguous span
 * @returns {number} row index, or -1 if none found
 */
export function lastSpanRow(scan, threshold) {
  for (let y = scan.height - 1; y >= 0; y--) {
    if (scan.rows[y].span >= threshold) return y
  }
  return -1
}

/**
 * Find structural transitions (span drops ≥ spanDropMin or minX jumps ≥ minXJumpMin).
 * Returns array of transition objects.
 */
export function findTransitions(scan, spanDropMin = 15, minXJumpMin = 10) {
  const transitions = []
  for (let y = 1; y < scan.height; y++) {
    const prev = scan.rows[y - 1], curr = scan.rows[y]
    if (prev.count === 0 && curr.count === 0) continue
    if (prev.count === 0) {
      transitions.push({ y, type: 'start', currSpan: curr.span, currMinX: curr.minX })
      continue
    }
    if (curr.count === 0) {
      transitions.push({ y, type: 'end', prevSpan: prev.span, prevMinX: prev.minX })
      continue
    }
    const spanDrop = prev.span - curr.span
    const minXJump = curr.minX !== null && prev.minX !== null
      ? Math.abs(curr.minX - prev.minX)
      : 0
    if (spanDrop >= spanDropMin || minXJump >= minXJumpMin) {
      transitions.push({
        y, spanDrop, minXJump,
        prevSpan: prev.span, currSpan: curr.span,
        prevMinX: prev.minX, currMinX: curr.minX
      })
    }
  }
  return transitions
}

/**
 * Produce a deterministic, machine-readable report string for a scan.
 * Format is stable; suitable for embedding in spec rationales.
 */
export function scanReport(scan) {
  const h = scan.height
  const lr10 = lastSpanRow(scan, 10)
  const bottomRow = scan.rows[h - 1]
  const transitions = findTransitions(scan)

  let report = ''
  report += `Alpha scan (pngjs): ${h} rows. `
  report += `Last row with span≥10: row ${lr10}`
  if (lr10 >= 0) {
    report += ` (count=${scan.rows[lr10].count}, span=${scan.rows[lr10].span}, x=[${scan.rows[lr10].minX},${scan.rows[lr10].maxX}])`
  }
  report += '. '

  if (bottomRow.count > 0) {
    report += `Bottom row ${h - 1}: ${bottomRow.count}px, span=${bottomRow.span}, x=[${bottomRow.minX},${bottomRow.maxX}]. `
  } else {
    report += `Bottom row ${h - 1} fully transparent. `
  }

  if (transitions.length > 0) {
    report += 'Transitions: '
    for (const t of transitions) {
      if (t.type === 'start') {
        report += `row ${t.y} start (span=${t.currSpan}); `
      } else if (t.type === 'end') {
        report += `row ${t.y} end; `
      } else {
        report += `row ${t.y} (span ${t.prevSpan}→${t.currSpan}, minX ${t.prevMinX}→${t.currMinX}); `
      }
    }
  }

  return report.trimEnd()
}
