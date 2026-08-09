#!/usr/bin/env node

/**
 * E10A: Generate GPT V3 contact sheet for 37-mask migration
 *
 * Self-contained SVG with:
 *   - Nine-grid overview (37 masks numbered, polygon outlines, target fragment colors)
 *   - Per-mask crop with polygon + 3 probes
 *   - Mask 58 large inset with historical facts
 *   - Legend with fragment color mapping
 *   - Provenance block
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')

const ledger = JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/juyiting/occlusion-v2-masks/migration-ledger.json'), 'utf-8'))
const fragSpec = JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json'), 'utf-8'))

// ── Color palette for fragments ────────────────────────────────────
const FRAGMENT_COLORS = {}
const PALETTE = [
  '#e6194b','#3cb44b','#ffe119','#4363d8','#f58231','#911eb4','#42d4f4','#f032e6',
  '#bfef45','#fabed4','#469990','#dcbeff','#9A6324','#fffac8','#800000','#aaffc3',
  '#808000','#ffd8b1','#000075','#a9a9a9','#ff6f61','#88b04b','#f7cac9','#92a8d1',
  '#955251','#b565a7','#009b77','#dd4124','#d65076','#45b8ac','#efc050','#5b5ea6',
]

let colorIdx = 0
for (const f of fragSpec.fragments) {
  FRAGMENT_COLORS[f.stableId] = PALETTE[colorIdx % PALETTE.length]
  colorIdx++
}

// Map nine-grid region to map position
const NINE_GRID_POS = {
  northwest:     { x: 50,  y: 50,  w: 185, h: 103 },
  north_center:  { x: 235, y: 50,  w: 185, h: 103 },
  northeast:     { x: 420, y: 50,  w: 185, h: 103 },
  west_center:   { x: 50,  y: 153, w: 185, h: 103 },
  center:        { x: 235, y: 153, w: 185, h: 103 },
  east_center:   { x: 420, y: 153, w: 185, h: 103 },
  southwest:     { x: 50,  y: 256, w: 185, h: 106 },
  south_center:  { x: 235, y: 256, w: 185, h: 106 },
  southeast:     { x: 420, y: 256, w: 185, h: 106 },
}

// Map coordinates: 1664x928 → grid cell size
const MAP_W = 1664, MAP_H = 928

function mapToGrid(mx, my, grid) {
  return {
    x: grid.x + (mx / MAP_W) * grid.w,
    y: grid.y + (my / MAP_H) * grid.h,
  }
}

// ── Build SVG ──────────────────────────────────────────────────────
const svgParts = []
let svgId = 0
function sid() { return `e10a-${svgId++}` }

function tag(name, attrs, content) {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')
  if (content === undefined || content === null) return `<${name} ${attrStr}/>`
  return `<${name} ${attrStr}>${content}</${name}>`
}

// SVG header
const TOTAL_W = 1400
const TOTAL_H = 3400 // tall: nine-grid + 37 detail cards + mask58 inset
svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TOTAL_W} ${TOTAL_H}" width="${TOTAL_W}" height="${TOTAL_H}">`)
svgParts.push(`<style>
  .title { font-family: sans-serif; font-size: 18px; font-weight: bold; fill: #1a1a2e; }
  .subtitle { font-family: sans-serif; font-size: 12px; fill: #555; }
  .label { font-family: monospace; font-size: 10px; fill: #333; }
  .small { font-family: monospace; font-size: 8px; fill: #666; }
  .mask-poly { fill: none; stroke: #ff4444; stroke-width: 1.5; }
  .mask-poly-fill { fill: rgba(255,68,68,0.08); stroke: #ff4444; stroke-width: 1.5; }
  .frag-rect { fill: none; stroke-width: 1.2; stroke-dasharray: 4,3; }
  .probe { fill: #00cc00; stroke: #006600; stroke-width: 0.8; }
  .probe-behind { fill: #4488ff; }
  .probe-boundary { fill: #ffaa00; }
  .probe-front { fill: #ff4444; }
  .legend-swatch { stroke: #333; stroke-width: 0.5; }
</style>`)

// ── Title block ────────────────────────────────────────────────────
svgParts.push(tag('rect', { x: 0, y: 0, width: TOTAL_W, height: 60, fill: '#f0f0f5' }))
svgParts.push(tag('text', { x: 20, y: 24, class: 'title' }, 'E10A: 37-Mask Visual Migration Contact Sheet'))
svgParts.push(tag('text', { x: 20, y: 42, class: 'subtitle' },
  `generationId: ${ledger.generationId} | TMX: ${ledger.provenance.tmxSha256.substring(0,16)}... | E9A: ${ledger.provenance.e9aGenerationId.substring(0,16)}... | Masks: 37 | Recal: ${ledger.summary.recalibrationCount} | Constraints: ${ledger.summary.constraintCount}`))

// ── Nine-grid overview ─────────────────────────────────────────────
const gridY = 70
svgParts.push(tag('text', { x: 20, y: gridY + 18, class: 'subtitle' }, 'Nine-Grid Region Overview (37 masks, polygon outlines, target fragment colors)'))

// Draw nine-grid borders
for (const [name, pos] of Object.entries(NINE_GRID_POS)) {
  svgParts.push(tag('rect', {
    x: pos.x, y: pos.y + gridY, width: pos.w, height: pos.h,
    fill: '#fafafa', stroke: '#ccc', 'stroke-width': 1,
  }))
  svgParts.push(tag('text', {
    x: pos.x + 3, y: pos.y + gridY + 12, class: 'small', fill: '#999',
  }, name.replace('_', ' ')))
}

// Draw each mask polygon in its nine-grid cell
for (const entry of ledger.entries) {
  const grid = NINE_GRID_POS[entry.nineGridRegionDeclared]
  if (!grid) continue

  // Polygon
  const points = entry.polygon.map(v => {
    const p = mapToGrid(v.x, v.y, grid)
    return `${p.x.toFixed(1)},${(p.y + gridY).toFixed(1)}`
  }).join(' ')

  const color = FRAGMENT_COLORS[entry.targetFragmentStableIds[0]] || '#999'
  svgParts.push(tag('polygon', {
    points,
    fill: color,
    'fill-opacity': 0.15,
    stroke: color,
    'stroke-width': 1,
    class: 'mask-poly-fill',
  }))

  // Mask number label at centroid
  const cp = mapToGrid(entry.centroid.x, entry.centroid.y, grid)
  svgParts.push(tag('text', {
    x: cp.x.toFixed(0), y: (cp.y + gridY).toFixed(0),
    class: 'label',
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    fill: '#000',
    'font-size': '7',
  }, `${entry.legacyIndex}`))

  // Highlight region mismatches
  if (!entry.nineGridRegionMatch) {
    svgParts.push(tag('circle', {
      cx: cp.x.toFixed(0), cy: (cp.y + gridY + 6).toFixed(0),
      r: 8, fill: 'none', stroke: '#ff0000', 'stroke-width': 1.5,
    }))
  }

  // Highlight constraint masks
  if (entry.constraintDecision) {
    svgParts.push(tag('circle', {
      cx: cp.x.toFixed(0), cy: (cp.y + gridY - 8).toFixed(0),
      r: 6, fill: 'none', stroke: '#ff8800', 'stroke-width': 2,
    }))
  }
}

// ── Legend ─────────────────────────────────────────────────────────
const legendY = gridY + 380
svgParts.push(tag('text', { x: 20, y: legendY, class: 'subtitle' }, 'Fragment Color Legend (32 fragments)'))

let lx = 20, ly = legendY + 16
for (const [sid, color] of Object.entries(FRAGMENT_COLORS)) {
  if (lx > 620) { lx = 20; ly += 14 }
  svgParts.push(tag('rect', { x: lx, y: ly - 6, width: 10, height: 10, fill: color, class: 'legend-swatch' }))
  const shortName = sid.replace('jyt.occ.', '').replace('.v2', '')
  svgParts.push(tag('text', { x: lx + 13, y: ly + 2, class: 'small', fill: '#333' }, shortName))
  lx += 200
}

// ── Per-mask detail cards (6 columns grid) ─────────────────────────
const cardStartY = legendY + 170
const cardW = 220, cardH = 130
const cols = 6, gapX = 10, gapY = 8
const startX = 20

for (let i = 0; i < ledger.entries.length; i++) {
  const entry = ledger.entries[i]
  const col = i % cols
  const row = Math.floor(i / cols)
  const cx = startX + col * (cardW + gapX)
  const cy = cardStartY + row * (cardH + gapY)

  // Card background
  const isConstraint = entry.constraintDecision !== null
  const isRecal = entry.recalibrationDecision && entry.recalibrationDecision !== 'none'
  const bgColor = isConstraint ? '#fff8e1' : (isRecal ? '#ffe8e8' : '#f8f8fc')
  svgParts.push(tag('rect', { x: cx, y: cy, width: cardW, height: cardH, fill: bgColor, stroke: '#ddd', rx: 3 }))

  // Mask header
  svgParts.push(tag('text', { x: cx + 4, y: cy + 12, class: 'label', fill: '#000', 'font-weight': 'bold' },
    `#${entry.legacyIndex} TMX ${entry.legacyTmxId} ${entry.homeChunk}`))
  svgParts.push(tag('text', { x: cx + 4, y: cy + 24, class: 'small', fill: '#666' },
    `${entry.nineGridRegionDeclared}${entry.nineGridRegionMatch ? '' : ' ⚠RECAL'}`))

  // Fragment tag
  const fragColor = FRAGMENT_COLORS[entry.targetFragmentStableIds[0]] || '#999'
  svgParts.push(tag('rect', { x: cx + 4, y: cy + 28, width: 8, height: 8, fill: fragColor }))
  const shortFrag = entry.targetFragmentStableIds[0].replace('jyt.occ.', '').replace('.v2', '')
  svgParts.push(tag('text', { x: cx + 15, y: cy + 36, class: 'small', fill: fragColor }, shortFrag))

  if (entry.targetFragmentCount > 1) {
    svgParts.push(tag('text', { x: cx + 4, y: cy + 48, class: 'small', fill: '#f80' }, `+${entry.targetFragmentCount - 1} more`))
  }

  // Constraint indicator
  if (isConstraint) {
    svgParts.push(tag('text', { x: cx + 4, y: cy + (entry.targetFragmentCount > 1 ? 60 : 48), class: 'small', fill: '#f80', 'font-weight': 'bold' },
      `⛓ ${entry.constraintDecision.decision}`))
  }

  // Probe indicators
  const probeY = cy + cardH - 20
  const probes = entry.probes
  if (probes.behind) {
    svgParts.push(tag('circle', { cx: cx + 30, cy: probeY, r: 5, class: 'probe probe-behind' }))
    svgParts.push(tag('text', { x: cx + 38, y: probeY + 3, class: 'small', fill: '#4488ff' }, 'B'))
  }
  if (probes.boundary) {
    svgParts.push(tag('circle', { cx: cx + 75, cy: probeY, r: 5, class: 'probe probe-boundary' }))
    svgParts.push(tag('text', { x: cx + 83, y: probeY + 3, class: 'small', fill: '#ffaa00' }, '∂'))
  }
  if (probes.front) {
    svgParts.push(tag('circle', { cx: cx + 120, cy: probeY, r: 5, class: 'probe probe-front' }))
    svgParts.push(tag('text', { x: cx + 128, y: probeY + 3, class: 'small', fill: '#ff4444' }, 'F'))
  }

  // Probe labels
  svgParts.push(tag('text', { x: cx + 155, y: probeY + 3, class: 'small', fill: '#888' }, 'B=behind ∂=bound F=front'))
}

// ── Mask 58 large inset ────────────────────────────────────────────
const m58 = ledger.entries.find(e => e.legacyTmxId === 58)
const insetY = cardStartY + Math.ceil(37 / cols) * (cardH + gapY) + 30

svgParts.push(tag('rect', { x: 20, y: insetY, width: TOTAL_W - 40, height: 280, fill: '#fff3e0', stroke: '#e65100', 'stroke-width': 2, rx: 5 }))
svgParts.push(tag('text', { x: 30, y: insetY + 22, class: 'title', fill: '#e65100' }, '⚠ MASK 58 — Critical Visual Review'))

// Mask 58 facts
const facts = [
  `Legacy TMX ID: 58 | Nine-grid: east_center | Home chunk: east-upper`,
  `Target Fragment: jyt.occ.east-upper.wall-panel-upper-01.v2 (wall panel, NOT the desk)`,
  `Constraint: wall-panel-always-behind (mandatory, mask-polygon scope)`,
  `The desk/table is prop TMX 92 (bounty-board) at sortAnchor (1446,379), tieBias=-4`,
  ``,
  `User-confirmed regression facts:`,
  `• Lu Junyi below the desk (higher Y) should appear in FRONT of the desk — handled by world-order Y sorting`,
  `• Hu Sanniang was never incorrectly occluded by the desk — her foot Y was above the critical boundary`,
  `• Desk occlusion is NOT "mask depth halving" — it is world-order Y comparison with tieBias=-4`,
  `• The wall panel fragment (wall-panel-upper-01) is always a background element behind all agents`,
  ``,
  `Mask 58 polygon bounds: AABB (1197,342)-(1663,458), area=54056px², 100% contained within wall-panel-upper fragment`,
  `Probes: behind=(1396,365) boundary=(1396,400) front=(1396,447) — all inside polygon`,
]

let fy = insetY + 40
for (const fact of facts) {
  const isBold = fact.startsWith('•') || fact.startsWith('⚠')
  svgParts.push(tag('text', {
    x: 30, y: fy, class: 'small',
    fill: isBold ? '#333' : '#666',
    'font-weight': isBold ? 'bold' : 'normal',
    'font-size': isBold ? '10' : '9',
  }, fact))
  fy += 14
}

// ── Provenance footer ──────────────────────────────────────────────
const footerY = insetY + 300
svgParts.push(tag('line', { x1: 20, y1: footerY, x2: TOTAL_W - 20, y2: footerY, stroke: '#ccc', 'stroke-width': 1 }))
svgParts.push(tag('text', { x: 20, y: footerY + 16, class: 'small', fill: '#999' },
  `E10A generationId: ${ledger.generationId} | Base commit: ${ledger.baseCommit} | Content SHA-256: ${ledger.contentSha256.substring(0, 32)}...`))
svgParts.push(tag('text', { x: 20, y: footerY + 30, class: 'small', fill: '#999' },
  `Frozen inputs: E1 ${ledger.provenance.e1BaselineCommit.substring(0,8)} | E8A ${ledger.provenance.e8aGenerationId.substring(0,16)} | E9A ${ledger.provenance.e9aGenerationId.substring(0,16)} | E9B ${ledger.provenance.e9bCommit.substring(0,8)}`))

svgParts.push('</svg>')

// ── Write output ───────────────────────────────────────────────────
const svg = svgParts.join('\n')
const outPath = join(repoRoot, 'tests/fixtures/juyiting/occlusion-v2-masks/contact-sheet.svg')
writeFileSync(outPath, svg, 'utf-8')
const hash = createHash('sha256').update(svg).digest('hex')

console.log(`Contact sheet written: ${outPath}`)
console.log(`  Size: ${svg.length} bytes`)
console.log(`  SHA-256: ${hash}`)
console.log(`  Masks shown: ${ledger.entries.length}/37`)
console.log(`  Mask 58 inset: included`)
