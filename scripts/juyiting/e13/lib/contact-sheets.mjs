/**
 * E13 contact-sheet renderer (static layout basemaps).
 *
 * These SVGs are SELF-CONTAINED static layout basemaps built from the committed
 * map artwork (public/juyiting/images/*.webp) plus the machine-checked shot plan
 * geometry (agent world positions, target rects/anchors, relation offsets).
 *
 * IMPORTANT: they are NOT runtime screenshots. They exist so the E13 GPT visual
 * review still has a numbered, per-cell, geometry-annotated input even on hosts
 * where a real browser cannot run (see runtime-env-probes.json). Runtime
 * screenshot evidence is produced separately by generate-e13-evidence.mjs.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')

export const MAP = Object.freeze({ width: 1664, height: 928 })

export const LAYERS = Object.freeze({
  base: { file: 'liangshan-hall-base-clean-v3.webp', label: 'base' },
  mid: { file: 'liangshan-hall-mid-occluders-v3.webp', label: 'mid-occluders' },
  foreground: { file: 'liangshan-hall-foreground-occluders-v3.webp', label: 'foreground-occluders' },
  lighting: { file: 'liangshan-hall-lighting-overlay-v3.webp', label: 'lighting-overlay' },
})

export const RELATION_COLORS = Object.freeze({
  behind: '#7aa2f7',
  boundary: '#e0af68',
  front: '#9ece6a',
})

const RELATION_LABEL = Object.freeze({
  behind: 'behind (agent above target)',
  boundary: 'boundary (dy=0)',
  front: 'front (agent below target)',
})

export const FOCUS_GROUPS = Object.freeze([
  { group: 'right-upper-table', zh: '右上悬赏桌', stableIds: ['jyt.prop.northeast.bounty-board.v1', 'jyt.occ.east-upper.scroll-table-front-01.v2'] },
  { group: 'pillars', zh: '柱子', stableIds: ['jyt.occ.east-upper.pillar-01.v2', 'jyt.occ.east-upper.pillar-02.v2'] },
  { group: 'railings', zh: '栏杆', stableIds: ['jyt.occ.west-lower.railing-01.v2', 'jyt.occ.west-lower.railing-02.v2', 'jyt.occ.east-lower.railing-post-01.v2'] },
  { group: 'library-shelf', zh: '书架', stableIds: ['jyt.prop.southeast.library-shelf.v1'] },
  { group: 'front-door', zh: '前门', stableIds: ['jyt.occ.entrance.hanging-banner-01.v2', 'jyt.occ.entrance.lantern-post-01.v2'] },
  { group: 'right-worktable', zh: '右工作台', stableIds: ['jyt.occ.east-lower.worktable-01.v2'] },
])

export function esc (value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character])
}

export function loadLayerDataUris (publicDir = join(REPO_ROOT, 'public/juyiting/images')) {
  const out = {}
  for (const [key, layer] of Object.entries(LAYERS)) {
    const bytes = readFileSync(join(publicDir, layer.file))
    out[key] = `data:image/webp;base64,${bytes.toString('base64')}`
  }
  return out
}

export function round (value, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function pointInRect (point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height
}

export function buildMapImageGroup (layers, keys, x, y, width, height, opacityByKey = {}) {
  return keys.map(key => {
    const opacity = opacityByKey[key] ?? 1
    return `<image href="${layers[key]}" x="${x}" y="${y}" width="${width}" height="${height}"${opacity < 1 ? ` opacity="${opacity}"` : ''} preserveAspectRatio="none"/>`
  }).join('\n')
}

export function buildGridOverlay (x, y, scale, regions, highlightCell) {
  const lines = []
  for (const region of regions) {
    const rx = x + region.bounds.x * scale
    const ry = y + region.bounds.y * scale
    const rw = region.bounds.width * scale
    const rh = region.bounds.height * scale
    const isHighlight = region.id === highlightCell
    lines.push(`<rect x="${round(rx)}" y="${round(ry)}" width="${round(rw)}" height="${round(rh)}" class="${isHighlight ? 'cell-hi' : 'cell'}"${isHighlight ? ` data-cell="${esc(region.id)}"` : ''}/>`)
  }
  return lines.join('\n')
}

function markerForShot (shot, sx, sy, scale) {
  const world = shot.world
  const px = round(sx + world.x * scale)
  const py = round(sy + world.y * scale)
  const color = RELATION_COLORS[shot.relation] || '#ffffff'
  // relation leader line toward target anchor is drawn by the caller (needs target anchor)
  return `<g class="marker" data-shot-id="${esc(shot.id)}" data-persona="${esc(shot.persona)}" data-relation="${esc(shot.relation)}" data-world-x="${world.x}" data-world-y="${world.y}" data-expected="${esc(shot.expectedRelation)}">
  <circle cx="${px}" cy="${py}" r="4.5" fill="${color}" stroke="#0b0f14" stroke-width="1"/>
  <text x="${px + 7}" y="${py + 3}" class="marker-label">${esc(shot.id)}</text>
</g>`
}

export function buildShotMarkers (shots, sx, sy, scale, targetByStableId) {
  return shots.map(shot => {
    const world = shot.world
    const px = round(sx + world.x * scale)
    const py = round(sy + world.y * scale)
    const target = targetByStableId.get(shot.targetStableId)
    let leader = ''
    if (target) {
      const ax = round(sx + target.anchor.x * scale)
      const ay = round(sy + target.anchor.y * scale)
      const color = RELATION_COLORS[shot.relation] || '#ffffff'
      leader = `<line x1="${px}" y1="${py}" x2="${ax}" y2="${ay}" class="leader" stroke="${color}"/>`
    }
    return leader + markerForShot(shot, sx, sy, scale)
  }).join('\n')
}

export function buildTargetRects (targets, sx, sy, scale, focusOnly = false) {
  return targets.map(target => {
    if (focusOnly && !target.focus) return ''
    const rx = round(sx + target.rect.x * scale)
    const ry = round(sy + target.rect.y * scale)
    const rw = round(target.rect.width * scale)
    const rh = round(target.rect.height * scale)
    const ax = round(sx + target.anchor.x * scale)
    const ay = round(sy + target.anchor.y * scale)
    return `<g class="target" data-target="${esc(target.stableId)}" data-cell="${esc(target.cell)}" data-focus="${target.focus}">
  <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" class="target-rect${target.focus ? ' focus' : ''}"/>
  <line x1="${ax - 6}" y1="${ay}" x2="${ax + 6}" y2="${ay}" class="anchor"/>
  <line x1="${ax}" y1="${ay - 6}" x2="${ax}" y2="${ay + 6}" class="anchor"/>
  <text x="${rx}" y="${ry - 6}" class="target-label">${esc(target.stableId)}${target.focus ? ' ★' : ''}</text>
</g>`
  }).join('\n')
}

export function buildLegendRows (shots, x, y, colWidth, rowHeight, columns = 1) {
  const lines = []
  const perColumn = Math.ceil(shots.length / columns)
  shots.forEach((shot, index) => {
    const col = Math.floor(index / perColumn)
    const row = index % perColumn
    const lx = x + col * colWidth
    const ly = y + row * rowHeight
    const color = RELATION_COLORS[shot.relation] || '#ffffff'
    const label = `${shot.id} ${shot.personaName}(${shot.persona}) ${shot.relation}@(${shot.world.x},${shot.world.y}) → ${shot.targetStableId} [${shot.expectedRelation}]`
    lines.push(`<g data-shot-id="${esc(shot.id)}">
  <circle cx="${lx + 4}" cy="${ly - 4}" r="3" fill="${color}"/>
  <text x="${lx + 12}" y="${ly}" class="legend">${esc(label)}</text>
</g>`)
  })
  return { lines: lines.join('\n'), rows: perColumn }
}

export function cellSheetHeader (cell, worldModel, shotCount) {
  const region = worldModel.regions.find(r => r.id === cell)
  const targets = worldModel.targets.filter(t => t.cell === cell)
  return `E13 九宫接触板 · ${region ? region.zh : cell} (${cell}) · ${shotCount} 张矩阵图 · 静态布局审核底图（非运行截图）`
}

export function buildStyle () {
  return `<style>
  .title{font:700 26px system-ui,sans-serif;fill:#fff}
  .subtitle{font:13px system-ui,sans-serif;fill:#aab4c3}
  .heading{font:700 17px system-ui,sans-serif;fill:#fff}
  .body{font:12px system-ui,sans-serif;fill:#c6ccd5}
  .legend{font:11px ui-monospace,monospace;fill:#d8dee9}
  .marker-label{font:10px ui-monospace,monospace;fill:#fff;stroke:#0b0f14;stroke-width:0.4}
  .target-label{font:10px ui-monospace,monospace;fill:#ffd7a1}
  .target-rect{fill:none;stroke:#ff6b6b;stroke-width:1.5;stroke-dasharray:5 3}
  .target-rect.focus{stroke:#ffb627;stroke-width:2.5;stroke-dasharray:7 3}
  .anchor{stroke:#ffd7a1;stroke-width:1.5}
  .leader{stroke-width:1;stroke-opacity:0.75}
  .cell{fill:none;stroke:#3b4653;stroke-width:1;stroke-dasharray:10 6}
  .cell-hi{fill:rgba(255,182,39,0.08);stroke:#ffb627;stroke-width:2.5}
  .panel{fill:#11161c;stroke:#3b4653;stroke-width:1}
  .note{font:11px system-ui,sans-serif;fill:#8b96a5;font-style:italic}
  .group-title{font:700 15px system-ui,sans-serif;fill:#ffd7a1}
</style>`
}
