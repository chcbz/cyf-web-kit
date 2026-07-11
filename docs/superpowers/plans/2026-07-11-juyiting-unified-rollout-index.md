# Juyiting Unified Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Juyiting map interaction and agent simulation design as two independently releasable phases.

**Architecture:** Phase 1 is a vertical slice that establishes typed map/camera/input boundaries, validated TMX and sprite assets, tenant-scoped REST/SSE scene state, one-agent A* simulation, recovery, reporting, and stable debug acceptance. Phase 2 extends only the simulation and asset layers for 24 visible agents, collision, reservation, queueing, replanning, and measured Android performance.

**Tech Stack:** Vue 3, JavaScript composables, TypeScript game logic, melonJS 15, Mocha/Chai, Vite, Spring Boot, Reactor, MyBatis, Gradle/JUnit 5/Mockito.

---

## Plan set and dependency order

| Order | Plan | Deliverable | Depends on |
| --- | --- | --- | --- |
| 1 | `2026-07-11-juyiting-phase1-camera-input.md` | Camera/Input modules, responsive panels, retry lifecycle | none |
| 2 | `2026-07-11-juyiting-phase1-tmx-sprites.md` | TMX movement runtime data, validators/previews, Songjiang manifest | plan 1 tooling task |
| 3 | `2026-07-11-juyiting-phase1-backend-scene-state.md` | tenant-scoped snapshot, SSE, phase report | none; may run parallel with plans 1–2 |
| 4 | `2026-07-11-juyiting-phase1-simulation-integration.md` | A*, command queue, recovery, REST/SSE integration, sceneDebug | plans 1–3 |
| 5 | `2026-07-11-juyiting-phase2-multiplayer-performance.md` | six final personas, collision/reservation/queue/replan and performance gate | phase 1 accepted |

## Locked ownership boundaries

- `src/game/camera/`: transform, presets, focus preservation, resize policy.
- `src/game/input/`: gesture classification, hit priority, interaction lock, DOM listener lifecycle.
- `src/game/map/`: TMX parsing, movement schema, validation, snapshots and preview derivation.
- `src/game/sprites/`: persona manifests, required/optional validation, loading and animation resolution.
- `src/game/simulation/`: commands, paths, slots, movement and phase events; no HTTP calls.
- `src/composables/juyiting/`: REST/SSE lifecycle and mapping semantic state into simulation commands.
- `src/game/debug/`: read-only aggregation with no credentials or raw responses.
- Backend `jia-agent-api/core/service/mapper`: contracts, data, orchestration/SSE, and persistence respectively.

## Specification coverage matrix

| Unified specification area | Owning plan/tasks |
| --- | --- |
| Architecture, initialization and module boundaries | Camera/Input Tasks 1–5; TMX/Sprites Tasks 1–2; Simulation Tasks 6–8 |
| REST snapshot, SSE, versions, scope and phase report | Backend Tasks 1–8; Simulation Tasks 5–6 |
| Business IDs versus TMX stable IDs | TMX/Sprites Tasks 1–4; Backend Task 1 |
| TMX layers, regions, graph, obstacles and slots | TMX/Sprites Tasks 1–4 |
| Songjiang review, manifest, required asset gate and runtime degradation | TMX/Sprites Tasks 5–8 |
| Single-agent A*, command priority, recovery and arrived/blocked | Simulation Tasks 1–7 |
| Camera presets, focal zoom, resize/orientation, keyboard and return button | Camera/Input Tasks 2–7 |
| Click/drag/pinch/wheel/keyboard and hit priority | Camera/Input Tasks 4–5 |
| Portrait/landscape/PC panels and interaction lock | Camera/Input Task 6 |
| Loading timeout, retry, generation cleanup and local failures | Camera/Input Task 6; Simulation Tasks 7–9 |
| Error model, feature flags and safe sceneDebug | TMX/Sprites Tasks 2 and 8; Backend Task 8; Simulation Tasks 5, 7 and 8 |
| Unit, integration, UI smoke, preflight and manual acceptance | all plan final tasks; rollout Tasks 1–2 |
| Six personas, 24 visible, 12 moving, collision, reservation, queue and replan | Multiplayer Tasks 1–7 |
| Android baseline, 30 FPS and long-task evidence | Multiplayer Tasks 8–10 |

### Task 1: Establish execution checkpoints

**Files:**
- Reference: `docs/superpowers/specs/2026-07-11-juyiting-unified-map-and-agent-simulation-design.md`
- Reference: all five plans listed above

- [ ] **Step 1: Record clean baselines before implementation**

Run:

```powershell
git -C D:\workspace\chcbz\project\jia\web\jia-web-kit status --short --branch
git -C D:\workspace\chcbz\project\jia\api status --short --branch
```

Expected: each command identifies its own repository; unrelated local changes are recorded and left untouched.

- [ ] **Step 2: Execute plans in dependency order**

Run the Camera/Input and backend plans independently, then TMX/Sprites, then Simulation/Integration. Do not start the multiplayer plan until every Phase 1 completion check below passes.

- [ ] **Step 3: Run the Phase 1 release gate**

Run:

```powershell
cd D:\workspace\chcbz\project\jia\api
.\gradlew :agent:jia-agent-service:test validateLayering
cd D:\workspace\chcbz\project\jia\web\jia-web-kit
npm run typecheck:game
npm run lint
npm run test:run
npm run build
npm run test:juyiting:preflight
```

Expected: Gradle reports `BUILD SUCCESSFUL`; npm commands exit `0`; preflight reports `聚义厅公测 preflight 验证通过` and validates `sceneDebug` rather than DOM text for Songjiang.

- [ ] **Step 4: Complete manual Phase 1 device acceptance**

Record device model, OS, browser version, orientation, and result for Android Chrome, Android WeChat, iPhone Safari, iOS WeChat, and desktop Chrome/Edge. Verify focal zoom, drag thresholds, panel lock, keyboard stability, orientation focus preservation, SSE reconnect, required-sprite degradation, and retry cleanup.

- [ ] **Step 5: Commit the Phase 1 acceptance record**

```powershell
git add docs/juyiting-feature-guide.md docs/juyiting-public-beta-readiness.md
git commit -m "docs: record Juyiting phase one acceptance"
```

Expected: one documentation commit in `web/jia-web-kit`; no root-directory commit.

### Task 2: Gate Phase 2 on measurable acceptance

**Files:**
- Modify: `docs/juyiting-feature-guide.md`
- Modify: `docs/juyiting-public-beta-readiness.md`
- Create: `docs/juyiting-performance-report.md`

- [ ] **Step 1: Confirm the phase transition conditions**

Required evidence:

```text
Phase 1 automated gate: pass
TMX validator: zero fatal errors
Songjiang art review: approved
REST + SSE + phase report: pass
Refresh recovery: pass
Required sprite network failure: map remains usable
Retry lifecycle: one canvas and one listener set
```

- [ ] **Step 2: Execute the multiplayer plan**

Follow `2026-07-11-juyiting-phase2-multiplayer-performance.md` task-by-task, retaining strict collision and never substituting pass-through behavior for frame rate.

- [ ] **Step 3: Run the final release gate**

Run the Phase 1 commands again plus the performance harness defined by the Phase 2 plan. Expected: 24 visible agents, at most 12 moving, steady FPS at least 30 on the baseline Android class, no recurring task over 50 ms, no penetration, and no agent exceeding three consecutive replans.

- [ ] **Step 4: Commit the final acceptance record**

```powershell
git add docs/juyiting-feature-guide.md docs/juyiting-public-beta-readiness.md docs/juyiting-performance-report.md
git commit -m "docs: record Juyiting multiplayer acceptance"
```

Expected: final documentation commit contains device evidence and no credentials, API keys, chat content, or raw backend response bodies.
