#!/usr/bin/env node
/** Direct production-TS oracle for all authoritative E13 matrix shots. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCanonicalIrFromXml } from '../../../src/game/occlusion/canonicalIr.ts'
import { computeWorldSortKey, compareWorldSortKeys } from '../../../src/game/occlusion/worldOrder.ts'
import { DEFAULT_FLOOR_REGISTRY } from '../../../src/game/occlusion/schema.ts'
import { createEmptyMembershipState } from '../../../src/game/occlusion/constraintResolver.ts'
import { computeUnifiedWorldOrder, registerAgentsInGrid } from '../../../src/game/occlusion/hallSceneAssembly.ts'
import { SpatialGrid, createConstraintCandidateProvider } from '../../../src/game/occlusion/spatialGrid.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')
const args = process.argv.slice(2)
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }
const evidence = resolve(arg('--evidence-dir') || join(repo, 'tests/fixtures/juyiting/occlusion-e13'))
const output = resolve(arg('--output') || join(evidence, 'oracle-report.json'))

function keyArray (key) {
  return [key.renderBandOrder, key.floorOrder, key.elevation, key.fixedPointY, key.tieBias, key.stableId]
}
function ordering (cmp) {
  return cmp < 0 ? 'agent_behind_target' : cmp > 0 ? 'agent_in_front' : 'tie'
}
function projectedTmx (text) {
  return text.replace('<properties>', '<properties>\n  <property name="renderSchemaVersion" value="2"/>')
}
function main () {
  const indexPath = join(evidence, 'index.json')
  const planPath = join(repo, 'tests/fixtures/juyiting/occlusion-e13/shot-plan.json')
  if (!existsSync(indexPath)) throw new Error(`missing index: ${indexPath}`)
  const indexBytes = readFileSync(indexPath)
  const index = JSON.parse(indexBytes)
  const matrix = JSON.parse(readFileSync(planPath)).shots.filter(s => s.kind === 'matrix')
  const tmxBytes = readFileSync(join(repo, 'public/juyiting/hall.tmx'))
  const ir = parseCanonicalIrFromXml(projectedTmx(tmxBytes.toString('utf8')))
  const staticObjects = [...ir.objects.filter(o => o.renderBand === 'world'), ...ir.fragments.filter(f => f.renderBand === 'world')]
  const byId = new Map(staticObjects.map(o => [o.stableId, o]))
  const failures = []
  let checks = 0
  if (matrix.length !== 270 || index.shots.length !== 270) failures.push(`matrix/index count ${matrix.length}/${index.shots.length}`)

  for (let i = 0; i < matrix.length; i++) {
    const plan = matrix[i], shot = index.shots[i]
    if (!shot || shot.id !== plan.id) { failures.push(`${plan.id}: index order/id mismatch`); continue }
    const target = byId.get(plan.targetStableId)
    if (!target) { failures.push(`${plan.id}: target absent from canonical IR`); continue }
    const agent = {
      stableId: `agent.${plan.persona}`, sceneId: ir.sceneId, chunkId: 'agents', kind: 'agent',
      renderBand: 'world', floorId: 'floor-1', elevation: 0, sortMode: 'fixed',
      sortAnchor: { ...plan.world }, tieBias: 0,
      render: { type: 'procedural', rendererKey: 'hall-agent' },
    }
    const ak = computeWorldSortKey(agent, ir.floorRegistry || DEFAULT_FLOOR_REGISTRY)
    const tk = computeWorldSortKey(target, ir.floorRegistry || DEFAULT_FLOOR_REGISTRY)
    checks += 2
    if (JSON.stringify(keyArray(ak)) !== JSON.stringify(shot.runtimeFacts.agentSortKey)) failures.push(`${plan.id}: agent key mismatch`)
    if (JSON.stringify(keyArray(tk)) !== JSON.stringify(shot.runtimeFacts.targetSortKey)) failures.push(`${plan.id}: target key mismatch`)

    // Exercise the production HallScene assembly world-order entry point, not
    // a copied formula or oracle-only sort implementation. The production map
    // has no constraint zones, but the real resolver/Kahn path still runs.
    const grid = new SpatialGrid(256)
    const assembly = {
      canonicalIr: ir, spatialGrid: grid, candidateProvider: createConstraintCandidateProvider(grid),
      worldObjects: ir.objects.filter(o => o.renderBand === 'world'), nonWorldObjects: ir.objects.filter(o => o.renderBand !== 'world'),
      fragments: ir.fragments, zones: ir.zones,
    }
    const adapters = [{ sceneObject: agent, entity: null }]
    registerAgentsInGrid(grid, adapters, ir.sceneId, agent.floorId)
    const resolved = computeUnifiedWorldOrder(assembly, adapters, createEmptyMembershipState())
    const depth = resolved.depths
    const actual = ordering(depth[agent.stableId] - depth[target.stableId])
    const keyExpected = ordering(compareWorldSortKeys(ak, tk))
    checks += 4
    if (actual !== keyExpected) failures.push(`${plan.id}: production resolver/key order mismatch ${actual}/${keyExpected}`)
    if (actual !== shot.resolvedExpectedOrdering) failures.push(`${plan.id}: resolvedExpectedOrdering mismatch`)
    if (actual !== shot.runtimeFacts.ordering) failures.push(`${plan.id}: Python ordering mismatch`)
    if (shot.runtimeFacts.actualDepth !== depth[agent.stableId] || shot.runtimeFacts.targetDepth !== depth[target.stableId]) failures.push(`${plan.id}: depth mismatch`)
  }
  const report = {
    $schema: 'juyiting-occlusion-e13-oracle-v2', taskId: 'E13', pass: failures.length === 0,
    matrixShots: matrix.length, checks, failures: failures.length, failureDetails: failures.slice(0, 100),
    methodology: 'Direct imports of production canonicalIr.ts, worldOrder.ts, schema.ts, constraintResolver.ts, and spatialGrid.ts via node --import tsx; all 270 authoritative matrix shots checked.',
    productionImports: ['src/game/occlusion/canonicalIr.ts', 'src/game/occlusion/worldOrder.ts', 'src/game/occlusion/schema.ts', 'src/game/occlusion/constraintResolver.ts', 'src/game/occlusion/hallSceneAssembly.ts', 'src/game/occlusion/spatialGrid.ts'],
    tmxSha256: createHash('sha256').update(tmxBytes).digest('hex'), indexSha256: createHash('sha256').update(indexBytes).digest('hex'),
  }
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`[oracle] ${checks} production checks across ${matrix.length} shots; ${failures.length} failures`)
  if (failures.length) process.exit(1)
}
main()
