#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')

const SPEC_PATH = join(REPO_ROOT, 'tests/fixtures/juyiting/occlusion-v1-props/prop-sort-spec.json')
let spec
try {
  spec = JSON.parse(readFileSync(SPEC_PATH, 'utf-8'))
} catch (e) {
  console.error('FATAL: cannot read prop-sort-spec.json:', e.message)
  process.exit(1)
}

let failures = 0
function fail(msg) { console.error('FAIL:', msg); failures++ }
function pass(msg) { console.error('PASS:', msg) }

// 1. Structural integrity
if (spec.propCount !== 5) fail('propCount must be 5, got ' + spec.propCount)
else pass('propCount = 5')

if (!Array.isArray(spec.props) || spec.props.length !== 5) fail('props array must have exactly 5 entries')
else pass('props array length = 5')

if (spec.sceneId !== 'juyiting-main') fail('sceneId must be juyiting-main')
else pass('sceneId = juyiting-main')

if (spec.specVersion !== 1) fail('specVersion must be 1')
else pass('specVersion = 1')

if (spec.baseCommit !== '7144d9260b3905ce0335d037d3b1a3589d3a88a1') fail('baseCommit mismatch')
else pass('baseCommit verified')

// 2. Per-prop validation
const seenIds = new Set()
const seenStableIds = new Set()
const stableIdPattern = /^[a-z0-9][a-z0-9._-]{2,95}$/

for (const prop of spec.props) {
  const label = prop.semanticName + ' (tmxId=' + prop.tmxId + ')'

  if (seenIds.has(prop.tmxId)) fail(label + ': duplicate tmxId')
  else seenIds.add(prop.tmxId)

  if (seenStableIds.has(prop.stableId)) fail(label + ': duplicate stableId')
  else seenStableIds.add(prop.stableId)

  if (!stableIdPattern.test(prop.stableId)) fail(label + ': invalid stableId: ' + prop.stableId)
  else pass(label + ': stableId pattern OK')

  const required = ['semanticName','tmxId','tmxName','stableId','sceneId','chunkId','floorId','elevation','renderBand','sortMode','tieBias','asset','tmxRect','sortAnchor','fixedPointY','probes']
  for (const f of required) {
    if (prop[f] === undefined || prop[f] === null) fail(label + ': missing ' + f)
  }

  if (prop.sceneId !== 'juyiting-main') fail(label + ': sceneId mismatch')
  if (prop.floorId !== 'floor-1') fail(label + ': floorId mismatch')
  if (prop.elevation !== 0) fail(label + ': elevation must be 0')
  if (prop.renderBand !== 'world') fail(label + ': renderBand must be world')
  if (prop.sortMode !== 'fixed') fail(label + ': sortMode must be fixed')
  if (prop.tieBias !== 0) fail(label + ': tieBias must be 0')

  const sa = prop.sortAnchor
  if (typeof sa?.x !== 'number' || typeof sa?.y !== 'number') fail(label + ': sortAnchor missing')
  else {
    if (sa.x < 0 || sa.x > 1664) fail(label + ': sortAnchor.x out of bounds')
    if (sa.y < 0 || sa.y > 928) fail(label + ': sortAnchor.y out of bounds')
  }

  const expectedFp = Math.round((sa?.y ?? 0) * 256)
  if (prop.fixedPointY !== expectedFp) fail(label + ': fixedPointY ' + prop.fixedPointY + ' != ' + expectedFp)
  else pass(label + ': fixedPointY consistent')

  if (!prop.asset?.path || !prop.asset?.sha256) fail(label + ': asset missing path/sha256')
  else {
    try {
      const buf = readFileSync(join(REPO_ROOT, prop.asset.path))
      const actualSha = createHash('sha256').update(buf).digest('hex')
      if (actualSha !== prop.asset.sha256) fail(label + ': asset sha mismatch')
      else pass(label + ': asset sha verified')
    } catch (e) {
      fail(label + ': asset read error: ' + e.message)
    }
  }

  const r = prop.tmxRect
  if (r) {
    if (r.x + r.width !== r.maxX) fail(label + ': tmxRect maxX inconsistent')
    if (r.y + r.height !== r.maxY) fail(label + ': tmxRect maxY inconsistent')
  }

  if (!prop.probes) fail(label + ': missing probes')
  else {
    for (const dir of ['north','south','west','east']) {
      const probe = prop.probes[dir]
      if (!probe) { fail(label + ': missing probe ' + dir); continue }
      if (!probe.agentFootPoint) fail(label + ': probe ' + dir + ' missing agentFootPoint')
      if (!probe.expectedRelation) fail(label + ': probe ' + dir + ' missing expectedRelation')
      if ((dir === 'north' || dir === 'south') && !['agent<prop','prop<agent'].includes(probe.expectedRelation)) {
        fail(label + ': ' + dir + ' probe must be sort assertion')
      }
    }
  }

  if (prop.tmxId === 92) {
    const m = prop.bountyBoardMatrix
    if (!m) fail(label + ': missing bountyBoardMatrix')
    else {
      if (!m.matrixCells?.north || !m.matrixCells?.south) fail(label + ': matrix missing N/S cells')
      if (!m.behindBoundaryFront?.behind || !m.behindBoundaryFront?.boundary || !m.behindBoundaryFront?.front) fail(label + ': matrix missing b/b/f')
      if (!m.mask58CrossReference || m.mask58CrossReference.maskId !== 58) fail(label + ': missing mask58 xref')
      else pass(label + ': bountyBoardMatrix complete')
    }
  }
}

// 3. TMX check
try {
  const tmxBuf = readFileSync(join(REPO_ROOT, spec.tmxSource.path))
  const tmxSha = createHash('sha256').update(tmxBuf).digest('hex')
  if (tmxSha !== spec.tmxSource.sha256) fail('TMX sha256 mismatch')
  else pass('TMX sha256 verified')

  const tmxStr = tmxBuf.toString('utf-8')
  for (const prop of spec.props) {
    const search = 'object id="' + prop.tmxId + '"'
    if (!tmxStr.includes(search)) fail(prop.semanticName + ': tmxId not found in TMX string')
    else pass(prop.semanticName + ': found in TMX')
  }
} catch (e) {
  fail('TMX check error: ' + e.message)
}

// 4. Sort order determinism
function sortByKey(props) {
  return [...props].sort((a, b) => {
    if (a.fixedPointY !== b.fixedPointY) return a.fixedPointY - b.fixedPointY
    const sa = a.stableId, sb = b.stableId
    for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
      if (sa.charCodeAt(i) !== sb.charCodeAt(i)) return sa.charCodeAt(i) - sb.charCodeAt(i)
    }
    return sa.length - sb.length
  })
}

const computedOrder = sortByKey(spec.props).map(p => p.stableId)
const declaredOrder = spec.globalConstraints.fivePropSortOrder.order
let orderMatch = true
for (let i = 0; i < declaredOrder.length; i++) {
  if (declaredOrder[i] !== computedOrder[i]) {
    fail('Sort order[' + i + ']: declared ' + declaredOrder[i] + ' vs computed ' + computedOrder[i])
    orderMatch = false
  }
}
if (orderMatch) pass('Sort order matches')

// Shuffle test
function shuffle(arr, seed) {
  const a = [...arr]
  let s = seed
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const baseResult = computedOrder.join('|')
for (let seed = 0; seed < 10; seed++) {
  const result = sortByKey(shuffle(spec.props, seed)).map(p => p.stableId).join('|')
  if (result !== baseResult) fail('Shuffle seed ' + seed + ' non-deterministic: ' + result)
}
pass('10-shuffle determinism')

console.error('')
if (failures === 0) {
  console.error('ALL VERIFICATIONS PASSED')
  process.exit(0)
} else {
  console.error(failures + ' VERIFICATION FAILURES')
  process.exit(1)
}
