#!/usr/bin/env node
/** Render the self-contained GPT V2 fragment ownership evidence sheet. */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { atomicWriteUtf8Batch } from './lib/atomic-write.mjs'
import {
  CONTACT_SHEET_PATH,
  REGION_ORDER,
  SPEC_PATH,
  runPixelCount,
} from './lib/fragment-ownership-v2.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

export const REGION_COLORS = {
  'west-upper': '#48a9ff',
  center: '#ffb627',
  'east-upper': '#bd7cff',
  'west-lower': '#78d64b',
  entrance: '#ff6b6b',
  'east-lower': '#2dd4bf',
}

const SEAM_INSETS = [
  { title: 'A · west wall crosses y=580 intact', x: 0, y: 520, width: 570, height: 150 },
  { title: 'B · east pillar crosses y=580 intact', x: 1170, y: 520, width: 120, height: 170 },
  { title: 'C · east diagonal crosses y=580 intact', x: 1270, y: 530, width: 285, height: 260 },
  { title: 'D · east railing crosses y=580 intact', x: 1470, y: 540, width: 194, height: 190 },
  { title: 'E · former broad west rect: owner pixels only', x: 0, y: 330, width: 570, height: 410 },
  { title: 'F · merged east railing corner 21+25', x: 1475, y: 550, width: 165, height: 180 },
  { title: 'G · merged southwest assembly 28+30/29+39', x: 0, y: 680, width: 430, height: 248 },
  { title: 'H · center object is wall-sconce, not pillar', x: 1080, y: 205, width: 90, height: 110 },
]

function esc(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character])
}

function runPath(runs) {
  return runs.map(([y, xStart, xEnd]) => `M${xStart} ${y}h${xEnd - xStart}v1h-${xEnd - xStart}z`).join('')
}

function rectText(rect) {
  return `(${rect.x},${rect.y},${rect.width}×${rect.height})`
}

function intersects(rect, inset) {
  return rect.x < inset.x + inset.width && rect.x + rect.width > inset.x &&
    rect.y < inset.y + inset.height && rect.y + rect.height > inset.y
}

export function renderContactSheetSvg(spec, canonicalBytes, report) {
  const sourceWidth = spec.sourceProvenance.width
  const sourceHeight = spec.sourceProvenance.height
  const sourceData = `data:image/webp;base64,${canonicalBytes.toString('base64')}`
  const sheetWidth = 2400
  const mainLegendWidth = sheetWidth - sourceWidth
  const seamTop = sourceHeight + 72
  const seamCellWidth = 590
  const seamCellHeight = 250
  const cropTop = seamTop + seamCellHeight * 2 + 70
  const cropColumns = 3
  const cropCellWidth = 790
  const cropCellHeight = 270
  const cropRows = Math.ceil(spec.fragments.length / cropColumns)
  const sheetHeight = cropTop + cropRows * cropCellHeight + 70
  const actualCounts = Object.fromEntries(REGION_ORDER.map(region => [
    region,
    spec.fragments.filter(fragment => fragment.homeRegion === region).length,
  ]))

  const lines = [`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${sheetWidth}" height="${sheetHeight}" viewBox="0 0 ${sheetWidth} ${sheetHeight}"
  data-generation-id="${esc(spec.generationId)}"
  data-fragment-count="${spec.fragments.length}"
  data-opaque-pixels="${report.ownershipResult.totalOpaquePixels}"
  data-opaque-cut-edge-count="${report.ownershipResult.opaqueCutEdgeCount}"
  role="img" aria-labelledby="title desc">
<title id="title">E9A Fragment Ownership GPT V2 Follow-up Contact Sheet</title>
<desc id="desc">${spec.fragments.length} semantic owners, ${report.ownershipResult.totalOpaquePixels} opaque pixels, zero opaque owner cut edges. Full source, six atlas home-region guides, exact RLE ownership overlay, eight seam insets, and complete per-fragment crop/index grid.</desc>
<defs>
  <pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#171b20"/><path d="M0 0h8v8H0zM8 8h8v8H8z" fill="#252b32"/></pattern>
  <filter id="shadow"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.95"/></filter>
  <image id="canonical-image" href="${sourceData}" x="0" y="0" width="${sourceWidth}" height="${sourceHeight}"/>
  <style>
    .title{font:700 24px system-ui,sans-serif;fill:#fff}.heading{font:700 18px system-ui,sans-serif;fill:#fff}.body{font:13px system-ui,sans-serif;fill:#d8dee9}.mono{font:12px ui-monospace,monospace;fill:#d8dee9}.small{font:10px ui-monospace,monospace;fill:#c6ccd5}.index{font:700 13px ui-monospace,monospace;fill:#fff;text-anchor:middle;dominant-baseline:central;filter:url(#shadow)}
    .region{fill:none;stroke-width:3;stroke-dasharray:12 7}.fragment-rect{fill:none;stroke-width:1.5;stroke-dasharray:5 3}.panel{fill:#11161c;stroke:#3b4653;stroke-width:1}.callout{fill:#090d12;stroke:#64748b;stroke-width:1.5}
  </style>
`]

  for (let index = 0; index < spec.fragments.length; index++) {
    lines.push(`<path id="owner-${index}" d="${runPath(spec.fragments[index].ownershipRuns)}"/>`)
  }
  for (let index = 0; index < SEAM_INSETS.length; index++) {
    lines.push(`<clipPath id="seam-clip-${index}"><rect x="0" y="0" width="550" height="185" rx="3"/></clipPath>`)
  }
  for (let index = 0; index < spec.fragments.length; index++) {
    lines.push(`<clipPath id="crop-clip-${index}"><rect x="0" y="0" width="300" height="190" rx="3"/></clipPath>`)
  }
  lines.push(`</defs><rect width="100%" height="100%" fill="#080b0f"/>
<rect x="0" y="0" width="${sourceWidth}" height="${sourceHeight}" fill="url(#checker)"/>
<use href="#canonical-image" opacity="0.72"/>
<!-- Exact per-pixel RLE owner visualization. Rectangles are only crop bounds. -->`)

  for (let index = 0; index < spec.fragments.length; index++) {
    const fragment = spec.fragments[index]
    const color = REGION_COLORS[fragment.homeRegion]
    lines.push(`<use href="#owner-${index}" fill="${color}" fill-opacity="0.36" data-owner-index="${index}" data-stable-id="${esc(fragment.stableId)}"/>`)
  }

  for (const region of REGION_ORDER) {
    const def = spec.regionPartition.regions[region]
    const color = REGION_COLORS[region]
    const x = def.xRange[0], y = def.yRange[0]
    const width = def.xRange[1] - x, height = def.yRange[1] - y
    lines.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" class="region" stroke="${color}" opacity="0.8"/>`)
    lines.push(`<text x="${x + 10}" y="${y + 24}" class="heading" fill="${color}" filter="url(#shadow)">${esc(region)} · home chunk guide</text>`)
  }

  for (let index = 0; index < spec.fragments.length; index++) {
    const fragment = spec.fragments[index]
    const rect = fragment.sourceRect
    const color = REGION_COLORS[fragment.homeRegion]
    const labelX = Math.max(14, Math.min(sourceWidth - 14, rect.x + rect.width / 2))
    const labelY = Math.max(14, Math.min(sourceHeight - 14, rect.y + rect.height / 2))
    lines.push(`<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" class="fragment-rect" stroke="${color}" opacity="0.82"/>`)
    lines.push(`<circle cx="${labelX}" cy="${labelY}" r="11" fill="#05080c" stroke="${color}" stroke-width="2"/><text x="${labelX}" y="${labelY}" class="index">${index}</text>`)
  }

  const legendX = sourceWidth + 18
  lines.push(`<rect x="${sourceWidth}" y="0" width="${mainLegendWidth}" height="${sourceHeight}" class="panel"/>
<text x="${legendX}" y="34" class="title">E9A V2 ownership follow-up</text>
<text x="${legendX}" y="62" class="body">Regions are atlas home/chunk guides — never alpha clip lines.</text>
<text x="${legendX}" y="84" class="mono">generationId ${esc(spec.generationId)}</text>
<text x="${legendX}" y="106" class="mono">owners ${spec.fragments.length} · opaque ${report.ownershipResult.totalOpaquePixels}</text>
<text x="${legendX}" y="128" class="mono">unowned ${report.ownershipResult.opaqueUnowned} · overlap ${report.ownershipResult.overlapPixels}</text>
<text x="${legendX}" y="150" class="mono">transparent-owned ${report.ownershipResult.transparentOwned} · cut edges ${report.ownershipResult.opaqueCutEdgeCount}</text>
<text x="${legendX}" y="184" class="heading">Dynamic region counts</text>`)
  let y = 210
  for (const region of REGION_ORDER) {
    lines.push(`<rect x="${legendX}" y="${y - 13}" width="13" height="13" fill="${REGION_COLORS[region]}"/><text x="${legendX + 22}" y="${y - 2}" class="mono">${region}: ${actualCounts[region]}</text>`)
    y += 24
  }
  lines.push(`<text x="${legendX}" y="${y + 12}" class="heading">Complete index → stableId</text>`)
  const listStartY = y + 38
  const listColumns = 2
  const rowsPerColumn = Math.ceil(spec.fragments.length / listColumns)
  const listColumnWidth = 355
  for (let index = 0; index < spec.fragments.length; index++) {
    const column = Math.floor(index / rowsPerColumn)
    const row = index % rowsPerColumn
    const fragment = spec.fragments[index]
    const itemX = legendX + column * listColumnWidth
    const itemY = listStartY + row * 26
    lines.push(`<g data-legend-index="${index}" data-stable-id="${esc(fragment.stableId)}"><circle cx="${itemX + 10}" cy="${itemY - 4}" r="9" fill="${REGION_COLORS[fragment.homeRegion]}"/><text x="${itemX + 10}" y="${itemY - 4}" class="index" font-size="10">${index}</text><text x="${itemX + 24}" y="${itemY}" class="small">${esc(fragment.stableId.replace('jyt.occ.', ''))}</text></g>`)
  }
  lines.push(`<text x="${legendX}" y="${sourceHeight - 78}" class="heading">E9B evidence requirement</text>
<text x="${legendX}" y="${sourceHeight - 54}" class="mono">zoom: 0.75 / 1 / 1.25 / 1.5 / 2</text>
<text x="${legendX}" y="${sourceHeight - 32}" class="small">RGBA exact reconstruction; inspect all four y=580 crossings.</text>
<text x="${legendX}" y="${sourceHeight - 12}" class="small">E10A dependency: map 37 legacy masks to accepted stableIds.</text>`)

  lines.push(`<text x="20" y="${seamTop - 24}" class="title">Seam and semantic blocker insets</text>`)
  for (let index = 0; index < SEAM_INSETS.length; index++) {
    const inset = SEAM_INSETS[index]
    const column = index % 4, row = Math.floor(index / 4)
    const cellX = 15 + column * seamCellWidth
    const cellY = seamTop + row * seamCellHeight
    const viewportWidth = 550, viewportHeight = 185
    const scale = Math.min(viewportWidth / inset.width, viewportHeight / inset.height)
    const imageX = (viewportWidth - inset.width * scale) / 2 - inset.x * scale
    const imageY = (viewportHeight - inset.height * scale) / 2 - inset.y * scale
    lines.push(`<g data-seam-index="${index}"><rect x="${cellX}" y="${cellY}" width="570" height="230" rx="5" class="callout"/><text x="${cellX + 10}" y="${cellY + 24}" class="heading">${esc(inset.title)}</text><g transform="translate(${cellX + 10},${cellY + 34})" clip-path="url(#seam-clip-${index})"><rect width="550" height="185" fill="url(#checker)"/><g transform="translate(${imageX},${imageY}) scale(${scale})"><use href="#canonical-image" opacity="0.82"/>`)
    for (let fragmentIndex = 0; fragmentIndex < spec.fragments.length; fragmentIndex++) {
      const fragment = spec.fragments[fragmentIndex]
      if (!intersects(fragment.sourceRect, inset)) continue
      lines.push(`<use href="#owner-${fragmentIndex}" fill="${REGION_COLORS[fragment.homeRegion]}" fill-opacity="0.43"/><rect x="${fragment.sourceRect.x}" y="${fragment.sourceRect.y}" width="${fragment.sourceRect.width}" height="${fragment.sourceRect.height}" fill="none" stroke="${REGION_COLORS[fragment.homeRegion]}" stroke-width="${1 / scale}"/>`)
    }
    lines.push(`<line x1="0" y1="580" x2="${sourceWidth}" y2="580" stroke="#fff" stroke-width="${1.5 / scale}" stroke-dasharray="${6 / scale} ${4 / scale}" opacity="0.9"/></g></g></g>`)
  }

  lines.push(`<text x="20" y="${cropTop - 25}" class="title">Complete fragment crop grid · canonical + exact owner pixels</text>`)
  for (let index = 0; index < spec.fragments.length; index++) {
    const fragment = spec.fragments[index]
    const rect = fragment.sourceRect
    const column = index % cropColumns, row = Math.floor(index / cropColumns)
    const cellX = 15 + column * cropCellWidth
    const cellY = cropTop + row * cropCellHeight
    const viewportWidth = 300, viewportHeight = 190
    const scale = Math.min(viewportWidth / rect.width, viewportHeight / rect.height, 5)
    const imageX = (viewportWidth - rect.width * scale) / 2 - rect.x * scale
    const imageY = (viewportHeight - rect.height * scale) / 2 - rect.y * scale
    const color = REGION_COLORS[fragment.homeRegion]
    lines.push(`<g data-fragment-index="${index}" data-stable-id="${esc(fragment.stableId)}"><rect x="${cellX}" y="${cellY}" width="770" height="250" rx="5" class="panel"/><circle cx="${cellX + 24}" cy="${cellY + 25}" r="14" fill="${color}"/><text x="${cellX + 24}" y="${cellY + 25}" class="index">${index}</text><text x="${cellX + 48}" y="${cellY + 20}" class="heading">${esc(fragment.stableId)}</text><text x="${cellX + 48}" y="${cellY + 40}" class="body">${esc(fragment.observableDescription)}</text><g transform="translate(${cellX + 12},${cellY + 52})" clip-path="url(#crop-clip-${index})"><rect width="300" height="190" fill="url(#checker)"/><g transform="translate(${imageX},${imageY}) scale(${scale})"><use href="#canonical-image" opacity="0.75"/><use href="#owner-${index}" fill="${color}" fill-opacity="0.58"/><rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="none" stroke="${color}" stroke-width="${1.5 / scale}"/></g></g><text x="${cellX + 330}" y="${cellY + 78}" class="mono">homeRegion/chunk: ${fragment.homeRegion}</text><text x="${cellX + 330}" y="${cellY + 102}" class="mono">sourceRect: ${rectText(rect)}</text><text x="${cellX + 330}" y="${cellY + 126}" class="mono">destinationRect: ${rectText(fragment.destinationRect)}</text><text x="${cellX + 330}" y="${cellY + 150}" class="mono">owned opaque: ${runPixelCount(fragment.ownershipRuns)}</text><text x="${cellX + 330}" y="${cellY + 174}" class="small">type: ${esc(fragment.semanticType)} · ${esc(fragment.semanticOwnership.componentPolicy)}</text><text x="${cellX + 330}" y="${cellY + 198}" class="small">components: ${esc(fragment.semanticOwnership.canonicalComponentIds.join(', '))}</text><text x="${cellX + 330}" y="${cellY + 222}" class="small">mapping: 1:1 source coordinates · sampling none</text></g>`)
  }

  lines.push(`<text x="20" y="${sheetHeight - 25}" class="small">Canonical SHA-256 ${esc(spec.sourceProvenance.sha256)} · E8B TMX ${esc(spec.inputProvenance.tmxAnchor.sha256)} · generationId ${esc(spec.generationId)}</text></svg>\n`)
  return lines.join('\n')
}

function main() {
  const spec = JSON.parse(readFileSync(join(REPO_ROOT, SPEC_PATH), 'utf8'))
  const canonicalBytes = readFileSync(join(REPO_ROOT, spec.sourceProvenance.path))
  const report = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-fragments/ownership-report.json'), 'utf8'))
  const svg = renderContactSheetSvg(spec, canonicalBytes, report)
  if (process.argv.includes('--update')) {
    atomicWriteUtf8Batch([{ path: join(REPO_ROOT, CONTACT_SHEET_PATH), content: svg, label: 'E9A contact sheet' }], 'E9A contact sheet update')
    console.error(`Contact sheet atomically written to ${CONTACT_SHEET_PATH}`)
  }
  process.stdout.write(svg)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
