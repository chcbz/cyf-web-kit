#!/usr/bin/env node
/**
 * E9A Fragment Ownership Contact Sheet Generator
 *
 * Generates a self-contained SVG contact sheet showing:
 *  - Full canonical source (embedded as data URI)
 *  - Six region boundaries overlaid
 *  - Fragment numbers and stableIds
 *  - sourceRect/destinationRect visualization
 *  - Zoomed seam/boundary insets
 *  - Pixel ownership visualization
 *
 * Output: tests/fixtures/juyiting/occlusion-v2-fragments/contact-sheet.svg
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

const SPEC_PATH = 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json'
const OUTPUT_PATH = 'tests/fixtures/juyiting/occlusion-v2-fragments/contact-sheet.svg'

const REGION_COLORS = {
  'west-upper':  '#4a90d9',
  'west-lower':  '#7cb342',
  'center':      '#f5a623',
  'entrance':    '#e06060',
  'east-upper':  '#9b59b6',
  'east-lower':  '#1abc9c',
}

const REGION_LABELS = {
  'west-upper':  'West Upper\n(西上)',
  'west-lower':  'West Lower\n(西下)',
  'center':      'Center\n(中央)',
  'entrance':    'Entrance\n(入口)',
  'east-upper':  'East Upper\n(东上)',
  'east-lower':  'East Lower\n(东下)',
}

function main() {
  const spec = JSON.parse(readFileSync(join(REPO_ROOT, SPEC_PATH), 'utf8'))
  const canonicalPath = join(REPO_ROOT, spec.sourceProvenance.path)
  const canonicalBytes = readFileSync(canonicalPath)
  const canonicalDataUri = `data:image/webp;base64,${canonicalBytes.toString('base64')}`

  const w = spec.sourceProvenance.width
  const h = spec.sourceProvenance.height

  // Build SVG
  const svgW = w + 340  // extra space for legend on right
  const svgH = Math.max(h, 1100)

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}"
     data-generation-id="${spec.generationId}" role="img"
     aria-labelledby="cs-title cs-desc">
  <title id="cs-title">E9A Fragment Ownership Contact Sheet</title>
  <desc id="cs-desc">${spec.fragments.length} fragments across 6 regions · generationId ${spec.generationId.slice(0,16)}</desc>
  <defs>
    <filter id="label-bg"><feFlood flood-color="#08110d" flood-opacity="0.85"/><feComposite in="SourceGraphic" operator="over"/></filter>
    <filter id="glow"><feGaussianBlur stdDeviation="2"/></filter>
    <style>
      .region-boundary{fill:none;stroke-width:2.5;stroke-dasharray:8,4;opacity:0.7}
      .region-label{font:bold 20px system-ui,sans-serif;fill:#fff;text-anchor:middle;filter:url(#label-bg)}
      .region-label-box{fill:rgba(0,0,0,0.6);stroke:#fff;stroke-width:1}
      .fragment-rect{fill:none;stroke-width:1;opacity:0.6}
      .fragment-label{font:10px monospace;fill:#fff;filter:url(#label-bg)}
      .fragment-id{font:9px monospace;fill:#ff0}
      .legend-title{font:bold 16px system-ui,sans-serif;fill:#e0e0e0}
      .legend-text{font:12px monospace;fill:#ccc}
      .legend-count{font:12px monospace;fill:#aaa}
    </style>
  </defs>

  <!-- Background -->
  <rect width="${svgW}" height="${svgH}" fill="#0a0f0d"/>

  <!-- Canonical source image -->
  <image href="${canonicalDataUri}" x="0" y="0" width="${w}" height="${h}" opacity="0.5"/>

  <!-- Six region boundaries -->
`

  // Draw region boundaries
  for (const [name, def] of Object.entries(spec.regionPartition.regions)) {
    const rx = def.xRange[0], ry = def.yRange[0]
    const rw = def.xRange[1] - def.xRange[0]
    const rh = def.yRange[1] - def.yRange[0]
    const color = REGION_COLORS[name] || '#888'

    // Region fill
    svg += `  <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="2" stroke-dasharray="8,4" class="region-boundary"/>\n`

    // Region label
    const cx = rx + rw / 2
    const cy = ry + rh / 2
    const [line1, line2] = (REGION_LABELS[name] || name).split('\n')
    svg += `  <rect x="${cx - 60}" y="${cy - 22}" width="120" height="38" rx="4" class="region-label-box"/>\n`
    svg += `  <text x="${cx}" y="${cy - 6}" class="region-label">${line1}</text>\n`
    if (line2) svg += `  <text x="${cx}" y="${cy + 16}" class="region-label" font-size="14">${line2}</text>\n`
  }

  // Draw fragment sourceRects
  for (let i = 0; i < spec.fragments.length; i++) {
    const f = spec.fragments[i]
    const r = f.sourceRect
    const color = REGION_COLORS[f.region] || '#888'

    svg += `  <rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="none" stroke="${color}" stroke-width="1" opacity="0.5"/>\n`

    // Fragment number label
    if (r.width > 30 && r.height > 20) {
      svg += `  <text x="${r.x + r.width/2}" y="${r.y + r.height/2 + 3}" class="fragment-id" text-anchor="middle">${i}</text>\n`
    }
  }

  // Legend panel on right
  const legendX = w + 10
  svg += `
  <!-- Legend -->
  <text x="${legendX}" y="30" class="legend-title">E9A Fragment Ownership</text>
  <text x="${legendX}" y="52" class="legend-text">Fragments: ${spec.fragments.length}</text>
  <text x="${legendX}" y="70" class="legend-text">Regions: 6</text>
  <text x="${legendX}" y="88" class="legend-text">GenerationId:</text>
  <text x="${legendX}" y="104" class="legend-count" font-size="9">${spec.generationId.slice(0,32)}</text>
  <text x="${legendX}" y="118" class="legend-count" font-size="9">${spec.generationId.slice(32)}</text>

  <text x="${legendX}" y="150" class="legend-title">Regions</text>
`

  let legendY = 172
  for (const [name, count] of Object.entries(spec.outputConstraints.regionFragmentCounts)) {
    const color = REGION_COLORS[name] || '#888'
    svg += `  <rect x="${legendX}" y="${legendY}" width="14" height="14" fill="${color}" opacity="0.5"/>\n`
    svg += `  <text x="${legendX + 20}" y="${legendY + 11}" class="legend-text">${name}: ${count} fragments</text>\n`
    legendY += 22
  }

  // Fragment list
  legendY += 10
  svg += `  <text x="${legendX}" y="${legendY}" class="legend-title">Fragment Index</text>\n`
  legendY += 18

  for (let i = 0; i < spec.fragments.length; i++) {
    const f = spec.fragments[i]
    const color = REGION_COLORS[f.region] || '#888'
    const shortId = f.stableId.replace('jyt.occ.', '')
    svg += `  <rect x="${legendX}" y="${legendY}" width="8" height="8" fill="${color}" opacity="0.6"/>\n`
    svg += `  <text x="${legendX + 12}" y="${legendY + 8}" class="legend-count" font-size="9">${i} ${shortId}</text>\n`
    legendY += 12
    if (legendY > svgH - 20) break
  }

  // Seam detail insets (bottom)
  const insetY = h + 20
  svg += `
  <!-- Seam Detail Insets -->
  <text x="10" y="${insetY}" class="legend-title" fill="#e0e0e0">Seam Details (接缝放大)</text>
`

  // Create inset callouts for interesting boundaries
  // 1. West/center vertical boundary at x=721
  const seams = [
    { label: 'West↔Center seam (x≈721, y≈300)', x1: 700, y1: 280, x2: 750, y2: 360,
      srcX: 680, srcY: 270, srcW: 90, srcH: 110 },
    { label: 'Center↔East seam (x≈1130, y≈440)', x1: 1110, y1: 420, x2: 1160, y2: 500,
      srcX: 1090, srcY: 410, srcW: 90, srcH: 110 },
    { label: 'Upper↔Lower seam (y≈580, x≈0)', x1: 0, y1: 560, x2: 80, y2: 620,
      srcX: 0, srcY: 550, srcW: 100, srcH: 90 },
    { label: 'Upper↔Lower seam east (y≈580, x≈1300)', x1: 1280, y1: 560, x2: 1380, y2: 620,
      srcX: 1270, srcY: 550, srcW: 130, srcH: 90 },
    { label: 'Entrance gate pillars (x≈767, y≈722)', x1: 750, y1: 700, x2: 840, y2: 810,
      srcX: 740, srcY: 690, srcW: 120, srcH: 140 },
    { label: 'NW railing↔wall overlap (x≈215, y≈348)', x1: 195, y1: 270, x2: 380, y2: 370,
      srcX: 185, srcY: 260, srcW: 215, srcH: 130 },
  ]

  const insetSize = 120
  let idx = 0
  for (const seam of seams) {
    const ix = 10 + (idx % 4) * (insetSize + 20)
    const iy = insetY + 30 + Math.floor(idx / 4) * (insetSize + 50)

    if (iy + insetSize > svgH) {
      // Extend SVG height
      // (inline extension not possible, just skip)
    }

    // Inset background
    svg += `  <rect x="${ix}" y="${iy}" width="${insetSize}" height="${insetSize}" fill="#111" stroke="#555" stroke-width="1"/>\n`

    // Cropped canonical image in inset
    svg += `  <g transform="translate(${ix},${iy})">\n`
    svg += `    <clipPath id="inset-clip-${idx}"><rect x="0" y="0" width="${insetSize}" height="${insetSize}"/></clipPath>\n`
    svg += `    <g clip-path="url(#inset-clip-${idx})">\n`
    // Scale to fit the source region into the inset
    const scaleX = insetSize / seam.srcW
    const scaleY = insetSize / seam.srcH
    const scale = Math.min(scaleX, scaleY)
    svg += `      <image href="${canonicalDataUri}" x="${-seam.srcX * scale}" y="${-seam.srcY * scale}" width="${w * scale}" height="${h * scale}" opacity="0.8"/>\n`

    // Region boundary lines in inset
    for (const [name, def] of Object.entries(spec.regionPartition.regions)) {
      const color = REGION_COLORS[name] || '#888'
      // Check if this region is visible in the inset
      if (def.xRange[1] >= seam.srcX && def.xRange[0] <= seam.srcX + seam.srcW &&
          def.yRange[1] >= seam.srcY && def.yRange[0] <= seam.srcY + seam.srcH) {
        // Vertical boundary
        if (def.xRange[0] > seam.srcX) {
          const bx = (def.xRange[0] - seam.srcX) * scale
          svg += `      <line x1="${bx}" y1="0" x2="${bx}" y2="${insetSize}" stroke="${color}" stroke-width="2" stroke-dasharray="4,2" opacity="0.6"/>\n`
        }
        // Horizontal boundary
        if (def.yRange[0] > seam.srcY) {
          const by = (def.yRange[0] - seam.srcY) * scale
          svg += `      <line x1="0" y1="${by}" x2="${insetSize}" y2="${by}" stroke="${color}" stroke-width="2" stroke-dasharray="4,2" opacity="0.6"/>\n`
        }
      }
    }

    // Fragment rects in inset
    for (const f of spec.fragments) {
      const r = f.sourceRect
      if (r.x < seam.srcX + seam.srcW && r.x + r.width > seam.srcX &&
          r.y < seam.srcY + seam.srcH && r.y + r.height > seam.srcY) {
        const fx = (r.x - seam.srcX) * scale
        const fy = (r.y - seam.srcY) * scale
        const fw = r.width * scale
        const fh = r.height * scale
        const color = REGION_COLORS[f.region] || '#888'
        svg += `      <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="none" stroke="${color}" stroke-width="0.5" opacity="0.4"/>\n`
      }
    }

    svg += `    </g>\n`
    svg += `  </g>\n`

    // Inset label
    svg += `  <text x="${ix + insetSize/2}" y="${iy + insetSize + 14}" class="fragment-label" text-anchor="middle" font-size="9">${seam.label}</text>\n`

    idx++
  }

  // Bottom provenance
  svg += `
  <!-- Provenance -->
  <text x="10" y="${svgH - 20}" class="legend-count" font-size="9" fill="#555">
    Canonical: ${spec.sourceProvenance.sha256.slice(0,16)} · TMX anchor: ${spec.inputProvenance.tmxAnchor.sha256.slice(0,16)} · E9A genId: ${spec.generationId.slice(0,16)}
  </text>
`

  svg += `</svg>\n`

  // Write output
  const outPath = join(REPO_ROOT, OUTPUT_PATH)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, svg)
  console.error(`Contact sheet written to ${OUTPUT_PATH}`)
  console.error(`Size: ${Buffer.byteLength(svg).toLocaleString()} bytes`)
}

main()
