# Juyiting Phase 1 Single-Agent Simulation and Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run one Songjiang agent through TMX A* paths from REST/SSE semantic state, recover approximate progress after refresh, report arrived/blocked, and expose stable sceneDebug acceptance without coupling simulation to HTTP or Vue.

**Architecture:** Pure TypeScript simulation consumes `MapRuntimeData` and `MovementCommand`, owns positions and phase events, and emits immutable `AgentSnapshot[]`. JavaScript composables adapt backend snapshots/SSE to commands and forward phase reports; HallScene renders snapshots without computing paths.

**Tech Stack:** TypeScript, Vue composables, fetch streaming SSE, melonJS, Mocha/Chai, UI smoke scripts.

---

## File map

- Create `src/game/simulation/{graphPathfinder,slotAllocator,movementCommandQueue,backendSceneStateAdapter,movementEngine}.ts`.
- Create `src/composables/juyiting/{useHallBackendSceneState,useHallCommandQueue,useHallSceneState}.js`.
- Create `src/game/debug/{sceneDebugTypes,sceneDebugAggregator}.ts`.
- Modify `JuyitingGame`, `HallScene`, `HallAgent`, `HallStage`, `JuyiHall` and `useHallData` integration points.
- Add unit/integration/UI smoke tests for the complete vertical slice.

### Task 1: Implement replaceable A* graph pathfinding

**Files:**
- Create: `src/game/simulation/graphPathfinder.ts`
- Test: `tests/game/simulation/graph-pathfinder.test.ts`

- [ ] **Step 1: Write failing A* tests**

```ts
it('selects the lowest distance times multiplier path', () => {
  const result = findGraphPath(graph, { x: 0, y: 0 }, { x: 100, y: 0 }, { colliderWidth: 36 })
  expect(result.nodeIds).to.deep.equal(['a', 'c', 'd'])
})

it('rejects edges narrower than the collider', () => {
  expect(findGraphPath(narrowGraph, start, end, { colliderWidth: 36 }).status).to.equal('blocked')
})
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "graph pathfinder"`

Expected: FAIL because pathfinder is absent.

- [ ] **Step 3: Implement the interface**

```ts
export type PathResult =
  | { status: 'found'; points: MapPoint[]; nodeIds: string[]; cost: number }
  | { status: 'blocked'; reason: 'no-nearest-node' | 'disconnected' | 'channel-too-narrow' }

export type PathFinder = {
  find(start: MapPoint, end: MapPoint, options: { colliderWidth: number }): PathResult
}
```

Project start/end to nearest reachable nodes, compute cost as polyline length times `costMultiplier`, support bidirectional edges, exclude obstacle-crossing or too-narrow edges, and return world-pixel points including exact start/end. Use deterministic stable-ID tie breaking.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm run test:game -- --grep "graph pathfinder"
npm run typecheck:game
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/game/simulation/graphPathfinder.ts tests/game/simulation/graph-pathfinder.test.ts
git commit -m "feat: add Juyiting graph pathfinder"
```

### Task 2: Implement home/parking slot allocation and command ordering

**Files:**
- Create: `src/game/simulation/slotAllocator.ts`
- Create: `src/game/simulation/movementCommandQueue.ts`
- Test: `tests/game/simulation/slot-allocator.test.ts`
- Test: `tests/game/simulation/movement-command-queue.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
expect(allocator.homeFor('songjiang')?.regionId).to.equal('main-seat')
expect(allocator.reserve('council-table', command).kind).to.equal('parking')
expect(queue.push(newerStateCommand).accepted).to.equal(true)
expect(queue.push(olderStateCommand).accepted).to.equal(false)
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "slot allocator|movement command queue"`

Expected: FAIL because modules are absent.

- [ ] **Step 3: Implement contracts**

```ts
export type MovementCommand = {
  commandId: string
  agentId: string
  personaCode: string
  source: 'backend' | 'local' | 'user'
  type: 'MOVE_TO_REGION' | 'RETURN_HOME'
  targetRegionId: string
  priority: number
  stateVersion: number
  startedAt: string
  expectedArrivalAt?: string
  expiresAt?: string
}
```

The queue rejects duplicate command IDs and non-increasing state versions per agent. In Phase 1 the allocator reserves one parking/home slot but keeps ownership APIs (`reserve`, `release`, `occupant`) compatible with Phase 2.

- [ ] **Step 4: Run tests**

Run: `npm run test:game -- --grep "slot allocator|movement command queue"`

Expected: PASS for priority ordering, state version replacement, reservation and release.

- [ ] **Step 5: Commit**

```powershell
git add src/game/simulation/slotAllocator.ts src/game/simulation/movementCommandQueue.ts tests/game/simulation
git commit -m "feat: queue Juyiting movement commands"
```

### Task 3: Adapt backend semantic state and recover time progress

**Files:**
- Create: `src/game/simulation/backendSceneStateAdapter.ts`
- Test: `tests/game/simulation/backend-scene-state-adapter.test.ts`

- [ ] **Step 1: Write failing recovery tests**

```ts
const recovery = recoverMovementProgress(state, path, Date.parse('2026-07-11T10:00:00+08:00'))
expect(recovery.progress).to.equal(0.5)
expect(recovery.point.x).to.equal(50)

expect(adaptBackendState(expiredState, runtime, nowMs).command?.type).to.equal('RETURN_HOME')
expect(adaptBackendState(missingRegionState, runtime, nowMs).blockedReason).to.equal('unknown-region')
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "backend scene state adapter"`

Expected: FAIL because adapter is absent.

- [ ] **Step 3: Implement semantic mapping and path interpolation**

```ts
export const normalizedProgress = (startedAt: string, expectedArrivalAt: string | undefined, nowMs: number) => {
  if (!expectedArrivalAt) return 0
  const start = Date.parse(startedAt)
  const end = Date.parse(expectedArrivalAt)
  return Math.max(0, Math.min(1, (nowMs - start) / Math.max(1, end - start)))
}

export type AdaptedBackendState = {
  command?: MovementCommand
  blockedReason?: 'unknown-region' | 'no-path' | 'expired'
}

export type BackendAgentSceneState = {
  agentId: string
  personaCode: string
  behavior: string
  targetRegionId: string
  stateVersion: number
  startedAt: string
  expectedArrivalAt?: string
  expiresAt?: string
}

export const adaptBackendState = (
  state: BackendAgentSceneState,
  map: MapRuntimeData,
  nowMs: number
): AdaptedBackendState => {
  const expired = Boolean(state.expiresAt && Date.parse(state.expiresAt) <= nowMs)
  const home = map.slots.find(slot => slot.kind === 'home' && slot.personaCode === state.personaCode)
  const targetRegionId = expired ? home?.regionId : state.targetRegionId
  if (!targetRegionId || !map.regions.some(region => region.regionId === targetRegionId)) {
    return { blockedReason: 'unknown-region' }
  }
  return {
    command: {
      commandId: `${state.agentId}:${state.stateVersion}:${expired ? 'home' : 'target'}`,
      agentId: state.agentId,
      personaCode: state.personaCode,
      source: 'backend',
      type: expired ? 'RETURN_HOME' : 'MOVE_TO_REGION',
      targetRegionId,
      priority: 10,
      stateVersion: state.stateVersion,
      startedAt: state.startedAt,
      expectedArrivalAt: state.expectedArrivalAt,
      expiresAt: state.expiresAt
    }
  }
}
```

Interpolate by cumulative path length, not point index. Missing target region returns a blocked command and never substitutes an arbitrary region. Expired or completed semantic state emits `RETURN_HOME`. A newer backend state always supersedes an older one, except a committed arrival within the configured slot threshold finishes before the new command begins.

- [ ] **Step 4: Run tests**

Run: `npm run test:game -- --grep "backend scene state adapter"`

Expected: PASS for 0/50/100 percent, overdue placement at target, expiry, missing region and timestamp edge cases.

- [ ] **Step 5: Commit**

```powershell
git add src/game/simulation/backendSceneStateAdapter.ts tests/game/simulation/backend-scene-state-adapter.test.ts
git commit -m "feat: recover Juyiting movement progress"
```

### Task 4: Implement the one-agent movement engine and phase events

**Files:**
- Create: `src/game/simulation/movementEngine.ts`
- Test: `tests/game/simulation/movement-engine.test.ts`

- [ ] **Step 1: Write failing engine tests**

```ts
engine.enqueue(moveCommand)
engine.update(1000)
expect(engine.snapshots()[0]).to.include({ agentId: 'agent-songjiang', phase: 'moving' })

engine.update(30000)
expect(engine.drainPhaseEvents()[0]).to.include({ phase: 'arrived', regionId: 'council-table' })

engine.enqueue(commandForMissingRegion)
expect(engine.drainPhaseEvents()[0].phase).to.equal('blocked')
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "movement engine"`

Expected: FAIL because engine is absent.

- [ ] **Step 3: Implement engine contracts**

```ts
export type AgentSnapshot = {
  agentId: string
  personaCode: string
  x: number
  y: number
  facing: 'left' | 'right'
  animation: 'idle' | 'walk'
  behavior: string
  phase: 'idle' | 'moving' | 'arrived' | 'blocked'
  regionId: string
  targetRegionId?: string
  stateVersion: number
}

export type SimulationPhaseEvent = {
  reportId: string
  agentId: string
  stateVersion: number
  phase: 'arrived' | 'blocked'
  regionId: string
  occurredAt: string
}
```

Use delta time and manifest base speed; map business movement to `walk` and stopped state to `idle`. Continue updating while the camera moves or panels are open. Emit each phase once per command and keep snapshots immutable.

- [ ] **Step 4: Run tests**

Run: `npm run test:game -- --grep "movement engine"`

Expected: PASS for path following, facing, arrival, block, replacement and return home.

- [ ] **Step 5: Commit**

```powershell
git add src/game/simulation/movementEngine.ts tests/game/simulation/movement-engine.test.ts
git commit -m "feat: simulate Songjiang movement"
```

### Task 5: Add REST snapshot and SSE lifecycle composable

**Files:**
- Create: `src/composables/juyiting/useHallBackendSceneState.js`
- Modify: `src/composables/useHttp.js`
- Test: `tests/juyiting-hall-backend-scene-state.test.js`
- Test: `tests/composables/useHttp.spec.js`

- [ ] **Step 1: Write failing REST/SSE tests**

```js
await state.start()
expect(calls[0]).to.include({ url: '/agent/scenes/juyiting-main/snapshot', method: 'GET' })
emitSse({ id: '129', event: 'agent-scene-state-updated', data: event129 })
emitSse({ id: '129', event: 'agent-scene-state-updated', data: event129 })
expect(state.sceneVersion.value).to.equal(129)
expect(appliedEvents).to.have.length(1)
```

Add a version-gap test that closes the stream and fetches a new snapshot.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- --grep "backend scene state"`

Expected: FAIL because composable is absent.

- [ ] **Step 3: Implement lifecycle API**

```js
export const useHallBackendSceneState = ({ agentApi, streamFactory, now = Date.now }) => ({
  snapshotReady,
  sceneVersion,
  sseConnected,
  lastEventAt,
  resyncCount,
  degraded,
  start,
  stop,
  retry,
  reportPhase
})
```

Use authenticated fetch streaming, parse complete SSE records (`id`, `event`, multiline `data`), send `sinceVersion`, ignore duplicates/stale states, resync on gaps or `resync-required`, reconnect after page focus, and cancel fetch/reader/timers on stop. With SSE disabled, poll snapshot every 15 seconds and once immediately on focus.

- [ ] **Step 4: Implement phase retry**

`reportPhase` retries at 1 second then 2 seconds, for at most three total attempts. Failure records `PHASE_REPORT_FAILED` warning and never stops animation.

- [ ] **Step 5: Run tests**

Run: `npm run test:run -- --grep "backend scene state|stream"`

Expected: PASS for auth-capable stream, deduplication, gap resync, focus recovery, polling fallback and teardown.

- [ ] **Step 6: Commit**

```powershell
git add src/composables/juyiting/useHallBackendSceneState.js src/composables/useHttp.js tests/juyiting-hall-backend-scene-state.test.js tests/composables/useHttp.spec.js
git commit -m "feat: sync Juyiting backend scene state"
```

### Task 6: Bridge backend state into simulation without leaking path logic

**Files:**
- Create: `src/composables/juyiting/useHallCommandQueue.js`
- Create: `src/composables/juyiting/useHallSceneState.js`
- Modify: `src/composables/juyiting/useHallData.js`
- Modify: `src/composables/juyiting/useHallScene.js`
- Test: `tests/juyiting-hall-scene-state.test.js`

- [ ] **Step 1: Write failing integration tests**

```js
sceneState.applySnapshot(snapshot)
expect(enqueued[0]).to.include({ type: 'MOVE_TO_REGION', targetRegionId: 'council-table', stateVersion: 16 })
sceneState.applyEvent(event17)
expect(enqueued.at(-1).stateVersion).to.equal(17)
expect(enqueued.at(-1)).not.to.have.keys('x', 'y', 'path')
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- --grep "hall scene state"`

Expected: FAIL because bridge composables are absent.

- [ ] **Step 3: Implement command bridge**

The JS layer knows agent/task/discussion IDs and semantic regions only. It creates backend commands using `adaptBackendState`, buffers them until map and simulation are ready, and forwards simulation phase events to `reportPhase`. Keep `/agent/map` for display metadata; scene snapshot is authoritative for movement.

- [ ] **Step 4: Remove synthetic movement for Songjiang under the flag**

When `VITE_JUYITING_SIMULATION_ENABLED` is true, `useHallScene.js` must not assign random patrol routes/destinations to Songjiang. When false, preserve current static behavior for rollback without maintaining a second complete simulation implementation.

- [ ] **Step 5: Run tests**

Run: `npm run test:run -- --grep "hall scene state|hall data|hall scene"`

Expected: PASS; backend semantics contain no coordinates.

- [ ] **Step 6: Commit**

```powershell
git add src/composables/juyiting tests/juyiting-hall-scene-state.test.js
git commit -m "feat: bridge Juyiting state into simulation"
```

### Task 7: Integrate simulation lifecycle and snapshot rendering

**Files:**
- Modify: `src/game/JuyitingGame.js`
- Modify: `src/game/scenes/HallScene.js`
- Modify: `src/game/entities/HallAgent.js`
- Modify: `src/components/juyiting/HallStage.vue`
- Modify: `src/components/world/JuyiHall.vue`
- Modify: `tests/juyiting-hall-scene-runtime.test.js`
- Create: `tests/game/integration/map-simulation.test.ts`

- [ ] **Step 1: Write failing vertical-slice test**

```ts
const runtime = parseMovementTmx(hallXml)
expect(validateMapRuntime(runtime).valid).to.equal(true)
const engine = createMovementEngine(runtime, manifest)
const adapted = adaptBackendState(snapshot.states[0], runtime, now)
expect(adapted.command).to.exist
engine.enqueue(adapted.command!)
engine.update(1000)
expect(engine.snapshots()[0]).to.include({ personaCode: 'songjiang', animation: 'walk' })
```

Add JS runtime assertions that `HallScene.syncAgentSnapshots()` updates entities and that destroy stops simulation frames.

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "map simulation"`

Expected: FAIL because lifecycle integration is absent.

- [ ] **Step 3: Implement initialization order**

Map parse/validation → camera/input → sprite load/validation → simulation → apply buffered snapshot → establish SSE → render snapshots. Add `syncAgentSnapshots`, `enqueueMovementCommands`, and `drainSimulationPhaseEvents` to the game facade. A failed backend/sprite module marks degraded but leaves map and panels ready; a map/nav/simulation initialization failure is fatal and retryable.

- [ ] **Step 4: Run integration/regression tests**

Run:

```powershell
npm run test:game -- --grep "map simulation"
npm run test:run -- --grep "HallScene|JuyiHall component behavior"
npm run build
```

Expected: PASS; panel/camera changes never pause movement and agent clicks do not move the camera.

- [ ] **Step 5: Commit**

```powershell
git add src/game src/components/juyiting/HallStage.vue src/components/world/JuyiHall.vue tests
git commit -m "feat: integrate Juyiting simulation runtime"
```

### Task 8: Add read-only sceneDebug aggregation

**Files:**
- Create: `src/game/debug/sceneDebugTypes.ts`
- Create: `src/game/debug/sceneDebugAggregator.ts`
- Modify: `src/game/JuyitingGame.js`
- Test: `tests/game/debug/scene-debug.test.ts`

- [ ] **Step 1: Write failing privacy/stability tests**

```ts
const debug = aggregateSceneDebug(inputs)
expect(debug).to.deep.include({ ready: true, degraded: false })
expect(debug.map.sceneId).to.equal('juyiting-main')
expect(debug.simulation.visibleCount).to.equal(1)
expect(JSON.stringify(debug)).not.to.match(/token|apiKey|chatContent|rawResponse|stack/i)
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "scene debug"`

Expected: FAIL because aggregator is absent.

- [ ] **Step 3: Implement debug snapshot**

Match the approved `window.__JYTING_SCENE_DEBUG__` shape exactly: `ready`, `degraded`, `fatalError`, `camera`, `input`, `map`, `sprites`, `backend`, `simulation`, `agents`, and `warnings`. Clone values into plain objects and expose only when `VITE_JUYITING_SCENE_DEBUG` is true or during tests. Remove the global on destroy.

- [ ] **Step 4: Run tests**

Run: `npm run test:game -- --grep "scene debug"`

Expected: PASS including privacy denylist and cleanup.

- [ ] **Step 5: Commit**

```powershell
git add src/game/debug src/game/JuyitingGame.js tests/game/debug
git commit -m "feat: expose safe Juyiting scene debug"
```

### Task 9: Upgrade UI smoke and preflight to the vertical slice

**Files:**
- Modify: `tests/juyiting-public-beta-ui-smoke.mjs`
- Modify: `tests/juyiting-public-beta-preflight.mjs`
- Modify: `docs/juyiting-public-beta-readiness.md`
- Modify: `docs/juyiting-feature-guide.md`

- [ ] **Step 1: Add failing smoke assertions**

Assert canvas and `.juyi-page` exist; debug ready, map movement and simulation are true; manifest version matches; missing/substitution counts are zero; Songjiang snapshot exists; wheel/drag changes transform; panel-open preserves transform; mocked orientation preserves focus; SSE update changes state version; refresh reconstructs nonzero progress.

- [ ] **Step 2: Verify failure against the old smoke**

Run: `npm run test:juyiting:ui-smoke`

Expected: FAIL until debug and integration are available. The test must not search DOM text for `宋江`.

- [ ] **Step 3: Implement deterministic smoke helpers**

Add polling helpers for debug readiness, transform snapshots, injected test SSE event, and network interception for required sprite failure. Required sprite failure must assert `ready === true`, `degraded === true`, and map transform remains operable.

- [ ] **Step 4: Run the Phase 1 frontend gate**

Run:

```powershell
npm run validate:juyiting-map
npm run validate:juyiting-sprites
npm run typecheck:game
npm run lint
npm run test:run
npm run build
npm run test:juyiting:preflight
```

Expected: all pass with local backend/frontend running for preflight.

- [ ] **Step 5: Commit**

```powershell
git add tests/juyiting-public-beta-ui-smoke.mjs tests/juyiting-public-beta-preflight.mjs docs/juyiting-public-beta-readiness.md docs/juyiting-feature-guide.md
git commit -m "test: gate Juyiting simulation vertical slice"
```

### Task 10: Cross-repository Phase 1 verification

**Files:**
- Verification only

- [ ] **Step 1: Run backend checks**

```powershell
cd D:\workspace\chcbz\project\jia\api
.\gradlew :agent:jia-agent-service:test validateLayering
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 2: Run frontend checks**

```powershell
cd D:\workspace\chcbz\project\jia\web\jia-web-kit
npm run typecheck:game
npm run lint
npm run test:run
npm run build
```

Expected: all exit `0`.

- [ ] **Step 3: Check repository cleanliness**

```powershell
git -C D:\workspace\chcbz\project\jia\api status --short --branch
git -C D:\workspace\chcbz\project\jia\web\jia-web-kit status --short --branch
```

Expected: only intentionally unpushed commits; no generated report directories or untracked credentials.
