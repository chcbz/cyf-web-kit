/**
 * E13 world model — authoritative, machine-checkable evidence plan.
 *
 * Sources (all committed, reproducible):
 *  - public/juyiting/hall.tmx                      → prop/fragment sort anchors, tieBias
 *  - tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json → fragment stableIds/sourceRects
 *  - tests/fixtures/juyiting/hall-map.snapshot.json → map pixel dimensions
 *  - src/constants/juyitingScene.js (HALL_FEATURED_HEROES) → the six personas
 *
 * The 九宫 (3×3) cells below are explicit semantic boxes derived from the
 * fragment regionPartition and the E1 mask-based region contract in
 * docs/juyiting-occlusion-system-execution-plan.md. Every cell contains at
 * least one committed target object (prop or occluder fragment) whose sort
 * anchor falls inside the cell, so each relation shot's agent position is
 * inside the declared cell by construction.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')

export const MAP = Object.freeze({ width: 1664, height: 928 })

// E13 handoff base commit (fixed by docs/juyiting-occlusion-system-execution-plan.md E13).
export const E13_BASE_COMMIT = '5308d7cda5c6dc72ab1403bcf4c9d8dadffdf916'

// ── Personas (fixed by E13 handoff: 宋江、卢俊义、扈三娘、李逵、林冲、吴用) ──
export const PERSONAS = Object.freeze([
  { personaCode: 'songjiang',  name: '宋江',   agentId: 'songjiang' },
  { personaCode: 'lujunyi',    name: '卢俊义', agentId: 'lujunyi' },
  { personaCode: 'husanniang', name: '扈三娘', agentId: 'husanniang' },
  { personaCode: 'likui',      name: '李逵',   agentId: 'likui' },
  { personaCode: 'linchong',   name: '林冲',   agentId: 'linchong' },
  { personaCode: 'wuyong',     name: '吴用',   agentId: 'wuyong' },
])

// ── Relations (dy offsets in world pixels vs target sortAnchor.y) ──
// Sort key is fixedPointY = round(sortAnchor.y * 256); a 34px offset is far
// beyond hysteresis (3px) so the ordering is deterministic.
export const RELATIONS = Object.freeze({
  behind:   { dy: -34, expected: 'agent_behind_target',  expectedDepth: 'agent < target' },
  boundary: { dy: 0,   expected: 'tie',                 expectedDepth: 'tie (tieBias/stableId)' },
  front:    { dy: +34, expected: 'agent_in_front',      expectedDepth: 'agent > target' },
})

// ── 九宫 cells (semantic boxes; anchor-bearing target per cell) ──
export const REGIONS = Object.freeze([
  { id: 'northwest',     zh: '西北', bounds: { x: 0, y: 0, width: 554, height: 420 } },
  { id: 'north_center',  zh: '北中', bounds: { x: 554, y: 0, width: 555, height: 420 } },
  { id: 'northeast',     zh: '东北', bounds: { x: 1109, y: 0, width: 555, height: 420 } },
  { id: 'west_center',   zh: '西中', bounds: { x: 0, y: 420, width: 554, height: 240 } },
  { id: 'center',        zh: '中央', bounds: { x: 554, y: 420, width: 555, height: 240 } },
  { id: 'east_center',   zh: '东中', bounds: { x: 1109, y: 420, width: 555, height: 240 } },
  { id: 'southwest',     zh: '西南', bounds: { x: 0, y: 660, width: 554, height: 268 } },
  { id: 'south_center',  zh: '南中', bounds: { x: 554, y: 660, width: 555, height: 268 } },
  { id: 'southeast',     zh: '东南', bounds: { x: 1109, y: 660, width: 555, height: 268 } },
])

// ── Target objects (props + key occluder fragments) with committed anchors ──
// anchor/tieBias copied from TMX (props) / TMX fragment properties; rect from
// TMX. `focus` marks the five E13 focus areas: 右上悬赏桌/栏杆/柱子/书架/前门.
export const TARGETS = Object.freeze([
  // cell primary targets
  { stableId: 'jyt.occ.west-upper.lantern-01.v2',          kind: 'fragment', cell: 'northwest',    focus: false, anchor: { x: 484, y: 240 }, tieBias: -1, rect: { x: 461, y: 165, width: 45, height: 75 } },
  { stableId: 'jyt.prop.center-north.main-seat.v1',        kind: 'prop',     cell: 'north_center', focus: false, anchor: { x: 872, y: 268 }, tieBias: 0,  rect: { x: 818, y: 175, width: 109, height: 93 } },
  { stableId: 'jyt.prop.northeast.bounty-board.v1',        kind: 'prop',     cell: 'northeast',    focus: true,  anchor: { x: 1446, y: 379 }, tieBias: -4, rect: { x: 1360, y: 255, width: 172, height: 124 } },
  { stableId: 'jyt.occ.west-upper.wall-sconce-02.v2',      kind: 'fragment', cell: 'west_center',  focus: false, anchor: { x: 515, y: 585 }, tieBias: -1, rect: { x: 492, y: 471, width: 45, height: 114 } },
  { stableId: 'jyt.occ.west-upper.diagonal-brace-01.v2',   kind: 'fragment', cell: 'center',       focus: false, anchor: { x: 608, y: 489 }, tieBias: -1, rect: { x: 600, y: 432, width: 16, height: 57 } },
  { stableId: 'jyt.occ.east-upper.pillar-01.v2',           kind: 'fragment', cell: 'east_center',  focus: true,  anchor: { x: 1181, y: 464 }, tieBias: -1, rect: { x: 1158, y: 305, width: 46, height: 159 } },
  { stableId: 'jyt.occ.west-lower.railing-02.v2',          kind: 'fragment', cell: 'southwest',    focus: true,  anchor: { x: 155, y: 824 }, tieBias: -1, rect: { x: 66, y: 787, width: 178, height: 37 } },
  { stableId: 'jyt.occ.entrance.hanging-banner-01.v2',     kind: 'fragment', cell: 'south_center', focus: true,  anchor: { x: 791, y: 794 }, tieBias: -1, rect: { x: 767, y: 722, width: 48, height: 72 } },
  { stableId: 'jyt.prop.southeast.library-shelf.v1',       kind: 'prop',     cell: 'southeast',    focus: true,  anchor: { x: 1558, y: 719 }, tieBias: 0,  rect: { x: 1497, y: 578, width: 123, height: 141 } },
  // additional focus targets (右上桌 front / 栏杆 / 柱子 / 前门灯柱 / 右桌)
  { stableId: 'jyt.occ.east-upper.scroll-table-front-01.v2', kind: 'fragment', cell: 'northeast',    focus: true, anchor: { x: 1432, y: 284 }, tieBias: -1, rect: { x: 1384, y: 255, width: 95, height: 29 } },
  { stableId: 'jyt.occ.west-lower.railing-01.v2',            kind: 'fragment', cell: 'south_center', focus: true, anchor: { x: 593, y: 778 }, tieBias: -1, rect: { x: 506, y: 675, width: 174, height: 103 } },
  { stableId: 'jyt.occ.east-lower.railing-post-01.v2',       kind: 'fragment', cell: 'southeast',    focus: true, anchor: { x: 1247, y: 775 }, tieBias: -1, rect: { x: 1242, y: 707, width: 10, height: 68 } },
  { stableId: 'jyt.occ.east-upper.pillar-02.v2',             kind: 'fragment', cell: 'southeast',    focus: true, anchor: { x: 1227, y: 703 }, tieBias: -1, rect: { x: 1202, y: 478, width: 50, height: 225 } },
  { stableId: 'jyt.occ.entrance.lantern-post-01.v2',         kind: 'fragment', cell: 'south_center', focus: true, anchor: { x: 1073, y: 778 }, tieBias: -1, rect: { x: 1052, y: 674, width: 41, height: 104 } },
  { stableId: 'jyt.occ.east-lower.worktable-01.v2',          kind: 'fragment', cell: 'southeast',    focus: true, anchor: { x: 1559, y: 701 }, tieBias: -1, rect: { x: 1499, y: 574, width: 120, height: 127 } },
])

// ── Camera regression / interaction / lighting plan (single persona 卢俊义) ──
export const CAMERA_CASES = Object.freeze([
  { id: 'desktop-default',  label: 'desktop default zoom 0.84',  viewport: { width: 1280, height: 800 }, zoom: 0.84 },
  { id: 'desktop-zoom-in',  label: 'desktop zoom-in 1.5',        viewport: { width: 1280, height: 800 }, zoom: 1.5 },
  { id: 'desktop-zoom-out', label: 'desktop zoom-out 0.6',       viewport: { width: 1280, height: 800 }, zoom: 0.6 },
  { id: 'desktop-pan-east', label: 'desktop pan east +120px',    viewport: { width: 1280, height: 800 }, zoom: 0.84, panDx: 120 },
  { id: 'desktop-pan-west', label: 'desktop pan west -120px',    viewport: { width: 1280, height: 800 }, zoom: 0.84, panDx: -120 },
  { id: 'tablet-landscape', label: 'tablet landscape 1024×768',  viewport: { width: 1024, height: 768 }, zoom: 0.92 },
  { id: 'mobile-portrait',  label: 'mobile portrait 390×844',    viewport: { width: 390, height: 844 }, zoom: 1.25 },
  { id: 'mobile-landscape', label: 'mobile landscape 844×390',   viewport: { width: 844, height: 390 }, zoom: 1.05 },
  { id: 'mobile-pinch-in',  label: 'mobile pinch zoom-in',       viewport: { width: 390, height: 844 }, zoom: 1.25, pinch: { start: 60, end: 220 } },
  { id: 'mobile-pinch-out', label: 'mobile pinch zoom-out',      viewport: { width: 390, height: 844 }, zoom: 1.25, pinch: { start: 220, end: 60 } },
])

export const INTERACTION_CASES = Object.freeze([
  { id: 'agent-pointer',        label: 'agent pointer: 点击宋江 → 选中高亮+名牌' },
  { id: 'hotspot-bounty-board', label: 'hotspot pointer: 点击右上悬赏桌 → 面板' },
  { id: 'hotspot-library-shelf',label: 'hotspot pointer: 点击书架 → 面板' },
  { id: 'hotspot-main-seat',    label: 'hotspot pointer: 点击主位 → 面板' },
  { id: 'labels-bubbles',       label: 'labels/bubbles: 名牌+气泡 (world-ui)' },
  { id: 'lighting-fullmap',     label: 'lighting: 全图 lighting-overlay' },
  { id: 'lighting-closeup',     label: 'lighting: 东北近景 lighting-overlay' },
])

export const MOVEMENT_CASES = Object.freeze([
  { id: 'movement-bounty-board', label: 'movement: 卢俊义沿路网走向右上悬赏桌', target: 'jyt.prop.northeast.bounty-board.v1' },
  { id: 'movement-front-door',   label: 'movement: 李逵沿路网走向前门', target: 'jyt.occ.entrance.hanging-banner-01.v2' },
])

// ── Derivation helpers ──

export function readTmxFragments (tmxText) {
  const group = /<objectgroup[^>]*name="v2-fragments-occluders"[^>]*>([\s\S]*?)<\/objectgroup>/.exec(tmxText)
  if (!group) throw new Error('TMX v2-fragments-occluders objectgroup missing')
  const rows = []
  for (const obj of group[1].matchAll(/<object\b[^>]*>([\s\S]*?)<\/object>/g)) {
    const tag = obj[0]; const body = obj[1]
    const get = attr => { const m = tag.match(new RegExp(`${attr}="([^"]*)"`)); return m ? m[1] : null }
    const props = {}
    for (const pm of body.matchAll(/<property name="([^"]+)"[^>]*value="([^"]*)"/g)) props[pm[1]] = pm[2]
    rows.push({
      stableId: props.stableId, kind: 'fragment',
      x: Number(get('x')), y: Number(get('y')), width: Number(get('width')), height: Number(get('height')),
      anchorX: Number(props.sortAnchorX), anchorY: Number(props.sortAnchorY), tieBias: Number(props.tieBias),
    })
  }
  return rows
}

export function readTmxProps (tmxText) {
  const rows = []
  for (const obj of tmxText.matchAll(/<object\b[^>]*>([\s\S]*?)<\/object>/g)) {
    const tag = obj[0]; const body = obj[1]
    if (!body.includes('stableId') || !body.includes('kind') || !body.includes('prop')) continue
    const get = attr => { const m = tag.match(new RegExp(`${attr}="([^"]*)"`)); return m ? m[1] : null }
    const props = {}
    for (const pm of body.matchAll(/<property name="([^"]+)"[^>]*value="([^"]*)"/g)) props[pm[1]] = pm[2]
    if (props.kind !== 'prop') continue
    rows.push({
      stableId: props.stableId, kind: 'prop',
      x: Number(get('x')), y: Number(get('y')), width: Number(get('width')), height: Number(get('height')),
      anchorX: Number(props.sortAnchorX), anchorY: Number(props.sortAnchorY), tieBias: Number(props.tieBias),
    })
  }
  return rows
}

export function pointInRect (point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height
}

export function cellForPoint (point) {
  return REGIONS.find(region => pointInRect(point, region.bounds)) || null
}

export function sha256Text (text) {
  return createHash('sha256').update(text).digest('hex')
}

export function loadSourceFacts () {
  const tmxPath = join(REPO_ROOT, 'public/juyiting/hall.tmx')
  const specPath = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v2-fragments/fragment-ownership-spec.json')
  const snapshotPath = join(REPO_ROOT, 'tests/fixtures/juyiting/hall-map.snapshot.json')
  const tmx = readFileSync(tmxPath, 'utf8')
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  const tmxFragments = readTmxFragments(tmx)
  const tmxProps = readTmxProps(tmx)
  return {
    tmxSha256: sha256Text(tmx),
    specSha256: sha256Text(readFileSync(specPath, 'utf8')),
    snapshotSha256: sha256Text(readFileSync(snapshotPath, 'utf8')),
    map: { width: snapshot.width, height: snapshot.height },
    spec,
    tmxFragments,
    tmxProps,
  }
}

/** Cross-check every committed target against the TMX source anchors (≤1px tolerance). */
export function validateTargetsAgainstTmx (facts, targets = TARGETS) {
  const byStable = new Map([...facts.tmxFragments, ...facts.tmxProps].map(t => [t.stableId, t]))
  const errors = []
  for (const target of targets) {
    const src = byStable.get(target.stableId)
    if (!src) { errors.push(`target ${target.stableId} not found in TMX`); continue }
    if (Math.abs(src.anchorX - target.anchor.x) > 1 || Math.abs(src.anchorY - target.anchor.y) > 1) {
      errors.push(`target ${target.stableId} anchor mismatch TMX(${src.anchorX},${src.anchorY}) model(${target.anchor.x},${target.anchor.y})`)
    }
    if (src.tieBias !== target.tieBias) {
      errors.push(`target ${target.stableId} tieBias mismatch TMX(${src.tieBias}) model(${target.tieBias})`)
    }
  }
  return errors
}

/** Build the full matrix shot plan: targets × personas × relations (+ camera/interaction/movement). */
export function buildShotPlan () {
  const shots = []
  let seq = 0
  const push = (shot) => {
    seq += 1
    shots.push({ id: `E13-${String(seq).padStart(3, '0')}`, ...shot })
  }
  for (const target of TARGETS) {
    for (const persona of PERSONAS) {
      for (const [relation, def] of Object.entries(RELATIONS)) {
        const world = { x: target.anchor.x, y: target.anchor.y + def.dy }
        push({
          kind: 'matrix',
          cell: target.cell,
          targetStableId: target.stableId,
          targetKind: target.kind,
          focus: target.focus,
          persona: persona.personaCode,
          personaName: persona.name,
          relation,
          world,
          expectedRelation: def.expected,
          expectedDepth: def.expectedDepth,
          viewport: { width: 1280, height: 800 },
          camera: { center: { x: target.anchor.x, y: target.anchor.y }, zoom: 1.1 },
        })
      }
    }
  }
  for (const cameraCase of CAMERA_CASES) {
    push({
      kind: 'camera',
      cameraCase: cameraCase.id,
      cameraLabel: cameraCase.label,
      persona: 'lujunyi',
      personaName: '卢俊义',
      targetStableId: 'jyt.prop.northeast.bounty-board.v1',
      relation: 'front',
      viewport: cameraCase.viewport,
      camera: { center: { x: 1446, y: 413 }, zoom: cameraCase.zoom, panDx: cameraCase.panDx, pinch: cameraCase.pinch },
    })
  }
  for (const interactionCase of INTERACTION_CASES) {
    push({ kind: 'interaction', interactionCase: interactionCase.id, interactionLabel: interactionCase.label })
  }
  for (const movementCase of MOVEMENT_CASES) {
    push({ kind: 'movement', movementCase: movementCase.id, movementLabel: movementCase.label, targetStableId: movementCase.target })
  }
  return shots
}

export function validateShotPlan (shots = buildShotPlan(), facts = loadSourceFacts()) {
  const errors = []
  const ids = new Set()
  for (const shot of shots) {
    if (ids.has(shot.id)) errors.push(`duplicate shot id ${shot.id}`)
    ids.add(shot.id)
    if (shot.kind === 'matrix') {
      const target = TARGETS.find(t => t.stableId === shot.targetStableId)
      if (!target) { errors.push(`${shot.id}: unknown target ${shot.targetStableId}`); continue }
      if (target.cell !== shot.cell) errors.push(`${shot.id}: cell mismatch`)
      const cell = REGIONS.find(r => r.id === shot.cell)
      if (cell && !pointInRect(shot.world, cell.bounds)) {
        errors.push(`${shot.id}: agent world (${shot.world.x},${shot.world.y}) outside cell ${shot.cell} ${JSON.stringify(cell.bounds)}`)
      }
      if (!PERSONAS.some(p => p.personaCode === shot.persona)) errors.push(`${shot.id}: unknown persona ${shot.persona}`)
      if (!RELATIONS[shot.relation]) errors.push(`${shot.id}: unknown relation ${shot.relation}`)
    }
  }
  // Coverage: every cell, persona, relation, target present
  for (const region of REGIONS) {
    if (!TARGETS.some(t => t.cell === region.id)) errors.push(`cell ${region.id} has no target`)
    if (!shots.some(s => s.kind === 'matrix' && s.cell === region.id)) errors.push(`cell ${region.id} has no matrix shots`)
  }
  for (const persona of PERSONAS) {
    if (!shots.some(s => s.kind === 'matrix' && s.persona === persona.personaCode)) {
      errors.push(`persona ${persona.personaCode} missing from matrix`)
    }
  }
  for (const relation of Object.keys(RELATIONS)) {
    if (!shots.some(s => s.kind === 'matrix' && s.relation === relation)) errors.push(`relation ${relation} missing from matrix`)
  }
  for (const target of TARGETS) {
    const targetShots = shots.filter(s => s.kind === 'matrix' && s.targetStableId === target.stableId)
    if (targetShots.length !== PERSONAS.length * Object.keys(RELATIONS).length) {
      errors.push(`target ${target.stableId} has ${targetShots.length} matrix shots, expected ${PERSONAS.length * 3}`)
    }
  }
  for (const cameraCase of CAMERA_CASES) {
    if (!shots.some(s => s.kind === 'camera' && s.cameraCase === cameraCase.id)) errors.push(`camera case ${cameraCase.id} missing`)
  }
  return errors
}

export function buildWorldModelJson () {
  const facts = loadSourceFacts()
  const anchorErrors = validateTargetsAgainstTmx(facts)
  if (anchorErrors.length) {
    throw new Error(`world model anchor mismatch:\n${anchorErrors.join('\n')}`)
  }
  const plan = buildShotPlan()
  const planErrors = validateShotPlan(plan, facts)
  if (planErrors.length) {
    throw new Error(`shot plan invalid:\n${planErrors.join('\n')}`)
  }
  return {
    $schema: 'juyiting-occlusion-e13-world-model-v1',
    schemaVersion: 1,
    taskId: 'E13',
    baseCommit: process.env.GIT_E13_BASE_COMMIT || E13_BASE_COMMIT,
    generatedAt: new Date().toISOString(),
    map: MAP,
    provenance: {
      tmxSha256: facts.tmxSha256,
      fragmentSpecSha256: facts.specSha256,
      hallMapSnapshotSha256: facts.snapshotSha256,
    },
    personas: PERSONAS,
    relations: RELATIONS,
    regions: REGIONS,
    targets: TARGETS,
    cameraCases: CAMERA_CASES,
    interactionCases: INTERACTION_CASES,
    movementCases: MOVEMENT_CASES,
    shotCounts: {
      matrix: plan.filter(s => s.kind === 'matrix').length,
      camera: plan.filter(s => s.kind === 'camera').length,
      interaction: plan.filter(s => s.kind === 'interaction').length,
      movement: plan.filter(s => s.kind === 'movement').length,
      total: plan.length,
    },
    shotPlan: plan,
  }
}
