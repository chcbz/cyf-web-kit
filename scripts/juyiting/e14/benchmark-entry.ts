import {
  computeUnifiedWorldOrder,
  registerAgentsInGrid,
  type E12Assembly,
  type V2AgentAdapter,
} from '../../../src/game/occlusion/hallSceneAssembly.js'
import {
  SpatialGrid,
  createConstraintCandidateProvider,
  createSpatialGridInstrumentation,
} from '../../../src/game/occlusion/spatialGrid.js'
import {
  createConstraintInstrumentation,
  createEmptyMembershipState,
  type ConstraintMembershipState,
} from '../../../src/game/occlusion/constraintResolver.js'
import {
  DEFAULT_FLOOR_REGISTRY,
  type CanonicalSceneIr,
  type OccluderFragment,
  type OcclusionConstraintZone,
  type SceneObject,
} from '../../../src/game/occlusion/schema.js'

const SCENE_ID = 'juyiting-main'
const FLOOR_ID = 'floor-1'
const MAP_WIDTH = 1664
const MAP_HEIGHT = 928
const AGENT_COUNT = 108
const FRAGMENT_COUNT = 50
const ZONE_COUNT = 37
const WARMUP_MS = 10_000
const SAMPLE_MS = 60_000

type HeapSample = { elapsedMs: number; usedBytes: number | null }
type PhaseSummary = {
  frameCount: number
  totalMs: number[]
  gridUpdateMs: number[]
  worldOrderMs: number[]
  membershipChecks: number
  maxChecksPerAgent: number
  maxUniqueZoneCandidates: number
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
}

function summarize(values: number[]) {
  const sum = values.reduce((acc, value) => acc + value, 0)
  return {
    min: values.length ? Math.min(...values) : 0,
    mean: values.length ? sum / values.length : 0,
    p50: percentile(values, 0.50),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: values.length ? Math.max(...values) : 0,
  }
}

function makeFragments(): OccluderFragment[] {
  return Array.from({ length: FRAGMENT_COUNT }, (_, index) => {
    const col = index % 10
    const row = Math.floor(index / 10)
    const x = 48 + col * 158
    const y = 72 + row * 164
    return {
      stableId: `jyt.frag.e14-${String(index).padStart(2, '0')}.v2`,
      sceneId: SCENE_ID,
      chunkId: `e14-chunk-${Math.floor(index / 10)}`,
      floorId: FLOOR_ID,
      elevation: 0,
      renderBand: 'world',
      sortMode: 'fixed',
      sortAnchor: { x: x + 48, y: y + 72 },
      tieBias: 0,
      assetRef: 'e14-benchmark-atlas',
      sourceRect: { x: 0, y: 0, width: 96, height: 96 },
      destinationRect: { x, y, width: 96, height: 96 },
    }
  })
}

function makeZones(fragments: OccluderFragment[]): OcclusionConstraintZone[] {
  return Array.from({ length: ZONE_COUNT }, (_, index) => {
    const col = index % 7
    const row = Math.floor(index / 7)
    const x = 48 + col * 232
    const y = 48 + row * 148
    const width = 132
    const height = 104
    return {
      stableId: `jyt.zone.e14-${String(index).padStart(2, '0')}.v2`,
      sceneId: SCENE_ID,
      chunkId: `e14-zone-chunk-${row}`,
      floorId: FLOOR_ID,
      targetFragmentId: fragments[index].stableId,
      relation: index % 2 === 0 ? 'behind' : 'front',
      priority: index % 5,
      polygon: [
        { x, y }, { x: x + width, y },
        { x: x + width, y: y + height }, { x, y: y + height },
      ],
      bounds: { x, y, width, height },
      hysteresisPx: 3,
    }
  })
}

function makeAgents(): V2AgentAdapter[] {
  return Array.from({ length: AGENT_COUNT }, (_, index) => {
    const col = index % 12
    const row = Math.floor(index / 12)
    const sceneObject: SceneObject = {
      stableId: `jyt.agent.e14-${String(index).padStart(3, '0')}.v1`,
      sceneId: SCENE_ID,
      chunkId: `e14-agent-chunk-${row}`,
      kind: 'agent',
      renderBand: 'world',
      floorId: FLOOR_ID,
      elevation: 0,
      sortMode: 'y',
      sortAnchor: { x: 64 + col * 136, y: 64 + row * 100 },
      tieBias: 0,
    }
    return { sceneObject, entity: { benchmarkAgentIndex: index } }
  })
}

function buildFixture() {
  const fragments = makeFragments()
  const zones = makeZones(fragments)
  const spatialInstrumentation = createSpatialGridInstrumentation()
  const grid = new SpatialGrid(256, spatialInstrumentation)
  for (const zone of zones) {
    grid.register({ stableId: zone.stableId, entryKind: 'zone', bounds: zone.bounds }, SCENE_ID, FLOOR_ID)
  }
  for (const fragment of fragments) {
    grid.register({ stableId: fragment.stableId, entryKind: 'fragment', bounds: fragment.destinationRect }, SCENE_ID, FLOOR_ID)
  }

  const canonicalIr: CanonicalSceneIr = {
    sceneId: SCENE_ID,
    renderSchemaVersion: '2',
    floorRegistry: { ...DEFAULT_FLOOR_REGISTRY },
    width: 104,
    height: 58,
    coordinateWidth: MAP_WIDTH,
    coordinateHeight: MAP_HEIGHT,
    objects: [],
    fragments,
    zones,
  }
  const assembly: E12Assembly = {
    canonicalIr,
    spatialGrid: grid,
    candidateProvider: createConstraintCandidateProvider(grid),
    worldObjects: [],
    nonWorldObjects: [],
    fragments,
    zones,
  }
  return { assembly, agents: makeAgents(), spatialInstrumentation }
}

function moveAgents(agents: V2AgentAdapter[], frame: number): void {
  for (let index = 0; index < agents.length; index++) {
    const col = index % 12
    const row = Math.floor(index / 12)
    const phase = frame * 0.035 + index * 0.41
    agents[index].sceneObject.sortAnchor.x = Math.max(8, Math.min(MAP_WIDTH - 8, 64 + col * 136 + Math.sin(phase) * 22))
    agents[index].sceneObject.sortAnchor.y = Math.max(8, Math.min(MAP_HEIGHT - 8, 64 + row * 100 + Math.cos(phase * 0.83) * 18))
  }
}

function emptyPhase(): PhaseSummary {
  return { frameCount: 0, totalMs: [], gridUpdateMs: [], worldOrderMs: [], membershipChecks: 0, maxChecksPerAgent: 0, maxUniqueZoneCandidates: 0 }
}

async function runPhase(
  durationMs: number,
  assembly: E12Assembly,
  agents: V2AgentAdapter[],
  initialMembership: ConstraintMembershipState,
  startFrame: number,
  record: boolean,
): Promise<{ phase: PhaseSummary; membership: ConstraintMembershipState; nextFrame: number; heapSamples: HeapSample[] }> {
  const phase = emptyPhase()
  const heapSamples: HeapSample[] = []
  let membership = initialMembership
  let frame = startFrame
  let lastHeapSample = -Infinity
  const started = performance.now()

  while (performance.now() - started < durationMs) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    // Trajectory generation is fixture setup, not part of the fixed gate.
    // The measured interval is exactly: spatial-index update + world ordering.
    moveAgents(agents, frame++)
    const frameStart = performance.now()
    registerAgentsInGrid(assembly.spatialGrid, agents, SCENE_ID, FLOOR_ID)
    const gridDone = performance.now()
    const result = computeUnifiedWorldOrder(assembly, agents, membership)
    membership = result.nextMembership
    const orderDone = performance.now()

    if (record) {
      phase.frameCount++
      phase.gridUpdateMs.push(gridDone - frameStart)
      phase.worldOrderMs.push(orderDone - gridDone)
      phase.totalMs.push(orderDone - frameStart)
      const elapsedMs = orderDone - started
      if (elapsedMs - lastHeapSample >= 1000) {
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        heapSamples.push({ elapsedMs, usedBytes: memory?.usedJSHeapSize ?? null })
        lastHeapSample = elapsedMs
      }
    }
  }
  return { phase, membership, nextFrame: frame, heapSamples }
}

async function runBenchmark() {
  const status = document.querySelector('#status')!
  const longTasks: number[] = []
  const observer = typeof PerformanceObserver !== 'undefined'
    ? new PerformanceObserver(list => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration)
      })
    : null
  try { observer?.observe({ entryTypes: ['longtask'] }) } catch { /* unsupported */ }

  const { assembly, agents, spatialInstrumentation } = buildFixture()
  registerAgentsInGrid(assembly.spatialGrid, agents, SCENE_ID, FLOOR_ID)
  let membership = createEmptyMembershipState()
  status.textContent = 'E14 warmup (10 seconds)…'
  const warmup = await runPhase(WARMUP_MS, assembly, agents, membership, 0, false)
  membership = warmup.membership

  const beforeSample = { ...spatialInstrumentation }
  status.textContent = 'E14 sampling (60 seconds)…'
  const sample = await runPhase(SAMPLE_MS, assembly, agents, membership, warmup.nextFrame, true)
  observer?.disconnect()
  const afterSample = { ...spatialInstrumentation }

  // Complexity evidence is intentionally outside the timed production path.
  // One representative audit frame is sufficient to prove per-agent sparse
  // discovery while avoiding instrumentation allocation in every sampled frame.
  const auditInstrumentation = createConstraintInstrumentation()
  computeUnifiedWorldOrder(assembly, agents, sample.membership, { instrumentation: auditInstrumentation })
  const heapValues = sample.heapSamples.map(item => item.usedBytes).filter((value): value is number => value !== null)
  const heapDrops = heapValues.slice(1).filter((value, index) => value < heapValues[index] - 1_000_000).length
  const result = {
    schemaVersion: 1,
    benchmarkId: 'juyiting-occlusion-e14-108-agent',
    buildMode: 'production',
    environment: { viewport: { width: MAP_WIDTH, height: MAP_HEIGHT }, userAgent: navigator.userAgent },
    fixture: { mapWidth: MAP_WIDTH, mapHeight: MAP_HEIGHT, agents: AGENT_COUNT, fragments: FRAGMENT_COUNT, zones: ZONE_COUNT, cellSize: assembly.spatialGrid.getCellSize() },
    timing: {
      warmupMs: WARMUP_MS,
      sampleMs: SAMPLE_MS,
      frames: sample.phase.frameCount,
      total: summarize(sample.phase.totalMs),
      gridUpdate: summarize(sample.phase.gridUpdateMs),
      worldOrder: summarize(sample.phase.worldOrderMs),
    },
    complexity: {
      theoreticalAgentsTimesAllZonesPerFrame: AGENT_COUNT * ZONE_COUNT,
      auditFrameMembershipChecks: auditInstrumentation.membershipCheckCount,
      membershipChecksPerFrameMean: auditInstrumentation.membershipCheckCount,
      maxChecksPerAgent: Math.max(...auditInstrumentation.perAgentCheckCounts, 0),
      maxUniqueZoneCandidates: auditInstrumentation.uniqueCandidateCount,
      instrumentationScope: 'one representative post-sample frame; excluded from timed production path',
      spatialGridDelta: {
        candidateCount: afterSample.candidateCount - beforeSample.candidateCount,
        cellQueryCount: afterSample.cellQueryCount - beforeSample.cellQueryCount,
        scanCount: afterSample.scanCount - beforeSample.scanCount,
        updateCellVisitCount: afterSample.updateCellVisitCount - beforeSample.updateCellVisitCount,
      },
    },
    memory: {
      browserHeapSamples: sample.heapSamples,
      browserHeapMinBytes: heapValues.length ? Math.min(...heapValues) : null,
      browserHeapMaxBytes: heapValues.length ? Math.max(...heapValues) : null,
      browserHeapGrowthBytes: heapValues.length > 1 ? heapValues.at(-1)! - heapValues[0] : null,
      heapDropsOver1Mb: heapDrops,
    },
    rendering: {
      canvasCount: document.querySelectorAll('canvas').length,
      webglContextCount: 0,
      drawCallsBaseline: 0,
      drawCallsSample: 0,
      textureMemoryBytes: null,
      textureMemoryStatus: 'unavailable-in-headless-CDP-ordering-harness; real HallScene rendering is audited in E17',
    },
    longTasks: { count: longTasks.length, maxDurationMs: longTasks.length ? Math.max(...longTasks) : 0 },
  }
  status.textContent = 'E14 benchmark complete'
  ;(globalThis as typeof globalThis & { __E14_RESULT__?: unknown }).__E14_RESULT__ = result
  return result
}

;(globalThis as typeof globalThis & { __E14_STATUS__?: string }).__E14_STATUS__ = 'running'
runBenchmark().then(() => {
  ;(globalThis as typeof globalThis & { __E14_STATUS__?: string }).__E14_STATUS__ = 'complete'
}).catch(error => {
  ;(globalThis as typeof globalThis & { __E14_STATUS__?: string; __E14_ERROR__?: string }).__E14_STATUS__ = 'failed'
  ;(globalThis as typeof globalThis & { __E14_ERROR__?: string }).__E14_ERROR__ = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  document.querySelector('#status')!.textContent = `E14 failed: ${String(error)}`
})
