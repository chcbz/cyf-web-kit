# Juyiting Phase 2 Multiplayer Simulation and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the accepted vertical slice to six approved personas and a strict 24-visible/12-moving simulation with collision, reservation, queueing, bounded replanning, and verified 30 FPS Android performance.

**Architecture:** Add spatial partitioning and time-bounded reservation on top of the Phase 1 path/slot interfaces. Behavior scheduling limits start rate and concurrent movement; performance instrumentation measures rather than weakening collision correctness.

**Tech Stack:** TypeScript simulation, melonJS rendering, Mocha/Chai, browser performance APIs, Node smoke harness, PNG sprite assets.

---

## File map

- Extend `personaSpriteManifest.ts` and add five approved sheets alongside Songjiang.
- Create `src/game/simulation/{collisionWorld,reservationSystem,behaviorQueue,replanPolicy,simulationConfig}.ts`.
- Modify `movementEngine`, `slotAllocator`, `graphPathfinder`, debug aggregation and smoke tests.
- Create `tests/juyiting-performance-harness.mjs` and `docs/juyiting-performance-report.md`.

### Task 1: Deliver six approved persona sheets

**Files:**
- Create: `public/juyiting/sprites/persona-sheets-v1/wuyong.png`
- Create: `public/juyiting/sprites/persona-sheets-v1/linchong.png`
- Create: `public/juyiting/sprites/persona-sheets-v1/lujunyi.png`
- Create: `public/juyiting/sprites/persona-sheets-v1/husanniang.png`
- Create: `public/juyiting/sprites/persona-sheets-v1/likui.png`
- Modify: `src/game/sprites/personaSpriteManifest.ts`
- Modify: `tests/game/sprites/sprite-validation.test.ts`
- Modify: `docs/assets/juyiting/songjiang-style-review/review.md`

- [ ] **Step 1: Add failing manifest expectations**

```ts
expect(Object.keys(PERSONA_SPRITE_MANIFEST.personas).sort()).to.deep.equal([
  'husanniang', 'likui', 'linchong', 'lujunyi', 'songjiang', 'wuyong'
])
expect(validateSpriteManifest(PERSONA_SPRITE_MANIFEST).requiredMissingCount).to.equal(0)
expect(validateSpriteManifest(PERSONA_SPRITE_MANIFEST).placeholderCount).to.equal(0)
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "six personas"`

Expected: FAIL because five definitions/assets are absent.

- [ ] **Step 3: Produce assets from the approved direction**

Use the approved Songjiang sample's palette, line weight, perspective, frame dimensions, anchor convention and idle/walk row layout. Each persona must have a distinct silhouette and costume; no persona may reuse Songjiang pixels or resolve through a default definition.

- [ ] **Step 4: Validate and review at game scale**

Run: `npm run validate:juyiting-sprites`

Expected: manifest version matches; six required personas available; required/optional missing and substitution counts are zero. Record reviewer and timestamp for all five additions in the existing art review document.

- [ ] **Step 5: Commit**

```powershell
git add public/juyiting/sprites/persona-sheets-v1 src/game/sprites/personaSpriteManifest.ts tests/game/sprites/sprite-validation.test.ts docs/assets/juyiting/songjiang-style-review/review.md
git commit -m "art: deliver core Juyiting persona sheets"
```

### Task 2: Centralize multiplayer simulation limits

**Files:**
- Create: `src/game/simulation/simulationConfig.ts`
- Test: `tests/game/simulation/simulation-config.test.ts`

- [ ] **Step 1: Write failing configuration test**

```ts
expect(SIMULATION_CONFIG).to.deep.include({
  maxVisibleAgents: 24,
  maxMovingAgents: 12,
  noProgressDurationMs: 1500,
  minimumProgressWorldPx: 4,
  slotWaitBeforeReplanMs: 2000,
  maxConsecutiveReplans: 3,
  maxPathStartsPerFrame: 2
})
expect(SIMULATION_CONFIG.departureIntervalMs).to.be.within(150, 250)
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "simulation config"`

Expected: FAIL because config is absent.

- [ ] **Step 3: Add immutable configuration**

```ts
export const SIMULATION_CONFIG = Object.freeze({
  maxVisibleAgents: 24,
  maxMovingAgents: 12,
  departureIntervalMs: 200,
  noProgressDurationMs: 1500,
  minimumProgressWorldPx: 4,
  slotWaitBeforeReplanMs: 2000,
  maxConsecutiveReplans: 3,
  maxPathStartsPerFrame: 2,
  movingUpdateHz: 25,
  idleUpdateHz: 3,
  spatialCellSize: 96
})
```

- [ ] **Step 4: Run test and commit**

Run: `npm run test:game -- --grep "simulation config"`

Expected: PASS.

```powershell
git add src/game/simulation/simulationConfig.ts tests/game/simulation/simulation-config.test.ts
git commit -m "feat: define Juyiting multiplayer limits"
```

### Task 3: Implement spatial collision world

**Files:**
- Create: `src/game/simulation/collisionWorld.ts`
- Test: `tests/game/simulation/collision-world.test.ts`

- [ ] **Step 1: Write failing collision tests**

```ts
world.upsert(collider('a', 100, 100, 18))
world.upsert(collider('b', 130, 100, 18))
expect(world.neighbors('a').map(item => item.id)).to.deep.equal(['b'])
expect(world.canOccupy('a', { x: 112, y: 100 })).to.equal(false)
expect(world.pairChecks()).to.be.lessThan(24 * 24)
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "collision world"`

Expected: FAIL because collision world is absent.

- [ ] **Step 3: Implement uniform spatial hashing**

```ts
export type AgentCollider = { id: string; x: number; y: number; radius: number; priority: number; moving: boolean }
export type CollisionWorld = {
  upsert(collider: AgentCollider): void
  remove(id: string): void
  neighbors(id: string): readonly AgentCollider[]
  canOccupy(id: string, point: MapPoint): boolean
  pairChecks(): number
}
```

Index colliders by 96-world-pixel cells, test only neighboring cells, use foot-position circles, and resolve overlaps without pass-through. Collision remains enabled in every performance mode.

- [ ] **Step 4: Run tests and commit**

Run: `npm run test:game -- --grep "collision world"`

Expected: PASS for add/move/remove, neighboring cells, no penetration and sub-quadratic checks.

```powershell
git add src/game/simulation/collisionWorld.ts tests/game/simulation/collision-world.test.ts
git commit -m "feat: add spatial Juyiting collision"
```

### Task 4: Implement path and slot reservation

**Files:**
- Create: `src/game/simulation/reservationSystem.ts`
- Modify: `src/game/simulation/slotAllocator.ts`
- Test: `tests/game/simulation/reservation-system.test.ts`

- [ ] **Step 1: Write failing reservation tests**

```ts
expect(reservations.reserveSlot('slot-1', 'a', 1000)).to.equal(true)
expect(reservations.reserveSlot('slot-1', 'b', 1000)).to.equal(false)
reservations.releaseAgent('a')
expect(reservations.reserveSlot('slot-1', 'b', 1000)).to.equal(true)
```

Add edge-direction conflict and expiration tests.

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "reservation system"`

Expected: FAIL because reservation system is absent.

- [ ] **Step 3: Implement reservation API**

Track slot owner and edge time windows keyed by stable ID. Same-direction agents may share a wide edge with safe following distance; opposing directions on a narrow edge cannot overlap. Reservations expire, release on departure/cancel/destroy, and are observable through debug counts.

- [ ] **Step 4: Run tests and commit**

Run: `npm run test:game -- --grep "reservation system|slot allocator"`

Expected: PASS.

```powershell
git add src/game/simulation/reservationSystem.ts src/game/simulation/slotAllocator.ts tests/game/simulation/reservation-system.test.ts
git commit -m "feat: reserve Juyiting paths and slots"
```

### Task 5: Add behavior queue and staggered departure

**Files:**
- Create: `src/game/simulation/behaviorQueue.ts`
- Modify: `src/game/simulation/movementCommandQueue.ts`
- Test: `tests/game/simulation/behavior-queue.test.ts`

- [ ] **Step 1: Write failing scheduling tests**

```ts
queue.enqueueAll(commands(18))
expect(queue.startable(0, 0)).to.have.length(1)
expect(queue.startable(100, 1)).to.have.length(0)
expect(queue.startable(200, 1)).to.have.length(1)
expect(queue.startable(5000, 12)).to.have.length(0)
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "behavior queue"`

Expected: FAIL because scheduler is absent.

- [ ] **Step 3: Implement priority scheduler**

Order business movement before return-home, patrol and idle; lower numeric command priority wins; ties use path cost then command ID. Start at 200 ms intervals, no more than two A* calculations per rendered frame, and never exceed 12 moving agents. Excess commands remain visible in `queuedCommandCount`.

- [ ] **Step 4: Run tests and commit**

Run: `npm run test:game -- --grep "behavior queue|movement command queue"`

Expected: PASS.

```powershell
git add src/game/simulation/behaviorQueue.ts src/game/simulation/movementCommandQueue.ts tests/game/simulation/behavior-queue.test.ts
git commit -m "feat: schedule Juyiting agent departures"
```

### Task 6: Implement waiting, no-progress detection and bounded replanning

**Files:**
- Create: `src/game/simulation/replanPolicy.ts`
- Modify: `src/game/simulation/movementEngine.ts`
- Test: `tests/game/simulation/replan-policy.test.ts`
- Test: `tests/game/simulation/movement-engine-multiplayer.test.ts`

- [ ] **Step 1: Write failing policy tests**

```ts
expect(policy.observe(sample({ elapsedMs: 1499, progressPx: 0 })).action).to.equal('wait')
expect(policy.observe(sample({ elapsedMs: 1500, progressPx: 3 })).action).to.equal('replan')
policy.recordReplan('a'); policy.recordReplan('a'); policy.recordReplan('a')
expect(policy.nextAction('a')).to.equal('blocked')
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "replan policy|multiplayer movement"`

Expected: FAIL because policy is absent.

- [ ] **Step 3: Implement exact handling order**

Wait briefly → verify reservation → recalculate path → at most three consecutive replans → blocked. Queue-full agents recheck every two seconds; after three unavailable checks emit blocked. Lower-priority agents yield to higher-priority crossing/opposing traffic and may retreat to their last safe waiting point.

- [ ] **Step 4: Add waiting bubble state**

Expose `waiting` in snapshots and map it to a lightweight bubble/status indicator. If rendering the bubble fails, record `WAITING_BUBBLE_SKIPPED` without changing collision or movement.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:game -- --grep "replan policy|multiplayer movement"`

Expected: PASS; no scenario exceeds three consecutive replans.

```powershell
git add src/game/simulation/replanPolicy.ts src/game/simulation/movementEngine.ts tests/game/simulation
git commit -m "feat: bound Juyiting movement replanning"
```

### Task 7: Integrate 24 visible and 12 moving agents

**Files:**
- Modify: `src/game/simulation/movementEngine.ts`
- Modify: `src/game/scenes/HallScene.js`
- Modify: `src/game/entities/HallAgent.js`
- Modify: `src/game/debug/sceneDebugAggregator.ts`
- Modify: `tests/game/integration/map-simulation.test.ts`
- Modify: `tests/juyiting-hall-scene-runtime.test.js`

- [ ] **Step 1: Write failing capacity integration test**

```ts
engine.syncAgents(agentFixtures(30))
engine.enqueueAll(moveCommands(20))
engine.update(5000)
expect(engine.snapshots()).to.have.length(24)
expect(engine.snapshots().filter(agent => agent.phase === 'moving')).to.have.length.at.most(12)
expect(engine.debug().queuedCommandCount).to.equal(8)
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "capacity integration"`

Expected: FAIL until limits and systems are integrated.

- [ ] **Step 3: Integrate systems**

Update moving agents at 20–25 Hz and interpolate rendering on `requestAnimationFrame`; update idle agents at 3 Hz. HallScene draws only the 24 selected visible agents, prioritizing selected/core/business-active personas. Keep selection/highlight following the moving snapshot; camera never follows.

- [ ] **Step 4: Run integration tests and commit**

Run:

```powershell
npm run test:game -- --grep "capacity integration|map simulation"
npm run test:run -- --grep "HallScene"
```

Expected: PASS with no penetration and bounded queues.

```powershell
git add src/game/simulation/movementEngine.ts src/game/scenes/HallScene.js src/game/entities/HallAgent.js src/game/debug/sceneDebugAggregator.ts tests
git commit -m "feat: run Juyiting multiplayer simulation"
```

### Task 8: Add performance harness and debug metrics

**Files:**
- Create: `tests/juyiting-performance-harness.mjs`
- Modify: `tests/juyiting-public-beta-ui-smoke.mjs`
- Modify: `src/game/debug/sceneDebugTypes.ts`
- Modify: `src/game/debug/sceneDebugAggregator.ts`
- Create: `docs/juyiting-performance-report.md`

- [ ] **Step 1: Add failing performance smoke**

The harness loads `/juyiting?performanceScenario=24x12`, waits 30 seconds after warmup, samples `requestAnimationFrame`, `PerformanceObserver` long tasks and sceneDebug counters, and fails unless:

```js
assert(metrics.visibleCount === 24)
assert(metrics.maxMovingCount <= 12)
assert(metrics.steadyFps >= 30)
assert(metrics.longTasksOver50Ms === 0)
assert(metrics.penetrationCount === 0)
assert(metrics.maxConsecutiveReplans <= 3)
```

- [ ] **Step 2: Verify the harness fails before scenario wiring**

Run: `node tests/juyiting-performance-harness.mjs`

Expected: FAIL because deterministic scenario/metrics are absent.

- [ ] **Step 3: Add deterministic scenario and metrics**

Expose only aggregate test metrics: frame samples, moving/visible/queued/replanning counts, pair checks, penetration count and max replan count. Do not expose user data or backend payloads. Keep debug overlay visually off by default.

- [ ] **Step 4: Run desktop harness**

Run: `node tests/juyiting-performance-harness.mjs`

Expected: PASS on the development machine; this is an early signal, not the Android acceptance record.

- [ ] **Step 5: Commit**

```powershell
git add tests/juyiting-performance-harness.mjs tests/juyiting-public-beta-ui-smoke.mjs src/game/debug docs/juyiting-performance-report.md
git commit -m "test: add Juyiting multiplayer performance gate"
```

### Task 9: Tune using allowed levers and record Android evidence

**Files:**
- Modify only as indicated by measured bottleneck: simulation config, renderer pooling, spatial cell size, animation cadence
- Modify: `docs/juyiting-performance-report.md`

- [ ] **Step 1: Capture baseline device evidence**

Use Android 13+, 6 GB RAM+, Snapdragon 778G/Dimensity 1080 equivalent, 1080p-class screen and supported stable Chrome. Record model, OS, browser, build commit, scenario, warmup, duration, median/5th-percentile FPS and long tasks.

- [ ] **Step 2: Profile before changing code**

Classify the dominant cost as pathfinding, collision, allocation/GC, rendering, image decode or debug instrumentation. Save the measured counter values in the report.

- [ ] **Step 3: Apply only correctness-preserving changes**

Allowed changes: object pooling, fewer allocations, cached path costs, adjusted spatial cell size, idle cadence between 2–5 Hz, moving cadence between 20–25 Hz, at most two path starts/frame, sprite batching/culling, disabled visual debug overlay. Forbidden changes: disabling collision, allowing overlap/pass-through, reducing required 24/12 load, or exceeding three replans.

- [ ] **Step 4: Re-run automated and device gates**

Run:

```powershell
npm run validate:juyiting-sprites
npm run typecheck:game
npm run lint
npm run test:run
npm run build
node tests/juyiting-performance-harness.mjs
```

Expected: all pass; device report shows steady FPS at least 30 and no recurring task over 50 ms.

- [ ] **Step 5: Commit tuning and evidence**

```powershell
git add src/game tests/juyiting-performance-harness.mjs docs/juyiting-performance-report.md
git commit -m "perf: meet Juyiting multiplayer budget"
```

### Task 10: Final Phase 2 release gate

**Files:**
- Modify: `docs/juyiting-feature-guide.md`
- Modify: `docs/juyiting-public-beta-readiness.md`

- [ ] **Step 1: Run full frontend gate**

```powershell
npm run validate:juyiting-map
npm run validate:juyiting-sprites
npm run typecheck:game
npm run lint
npm run test:run
npm run build
npm run test:juyiting:preflight
node tests/juyiting-performance-harness.mjs
```

Expected: all exit `0`.

- [ ] **Step 2: Verify manual multiplayer behavior**

Verify staggered departure, priority yielding, same-direction following, opposing narrow-passage exclusion, parking then queue allocation, waiting bubble, three-replan block, panel-open continued movement, orientation continued movement, click-without-pause, and camera no-follow.

- [ ] **Step 3: Update release documents and commit**

```powershell
git add docs/juyiting-feature-guide.md docs/juyiting-public-beta-readiness.md docs/juyiting-performance-report.md
git commit -m "docs: accept Juyiting multiplayer simulation"
```

- [ ] **Step 4: Confirm clean status**

Run: `git status --short --branch`

Expected: clean working tree with the intended branch ahead only by reviewed commits.
