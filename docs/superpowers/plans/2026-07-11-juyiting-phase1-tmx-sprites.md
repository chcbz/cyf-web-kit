# Juyiting Phase 1 TMX and Sprite Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `hall.tmx` the validated source of movement regions, graph and slots, and deliver an approved Songjiang spritesheet with a release-blocking manifest pipeline that degrades safely at runtime.

**Architecture:** Typed parsers normalize raw TMX into `MapRuntimeData`; pure validators produce structured fatal/warning errors; snapshot and preview scripts derive review artifacts without participating in runtime. Sprite manifests are typed data with required/optional validation and no default-persona substitution.

**Tech Stack:** TypeScript, TMX/XML, Node scripts, Mocha/Chai, melonJS loader, PNG assets.

---

## File map

- Create `src/game/map/{movementSchema,tmxMovementParser,mapValidation,tmxEditOps,tmxSnapshot,tmxPreviewRenderer}.ts`.
- Modify `src/game/tiledMap.js` to compose the typed movement parser.
- Modify `public/juyiting/hall.tmx` with map properties and movement object groups.
- Create `scripts/juyiting/{validate-map,render-map-preview,validate-sprites}.mjs`.
- Create `src/game/sprites/{personaSpriteManifest,spriteValidation,spriteLoader,animationResolver}.ts`.
- Create `public/juyiting/sprites/persona-sheets-v1/songjiang.png` and review samples under `docs/assets/juyiting/songjiang-style-review/`.
- Create generated snapshots/previews under `tests/fixtures/juyiting/` and `docs/assets/juyiting/map-preview/`.

### Task 1: Define movement schema and parser

**Files:**
- Create: `src/game/map/movementSchema.ts`
- Create: `src/game/map/tmxMovementParser.ts`
- Test: `tests/game/map/tmx-movement-parser.test.ts`

- [ ] **Step 1: Write failing parser tests**

```ts
it('separates stableId from business regionId', () => {
  const map = parseMovementTmx(fixtureXml)
  expect(map.regions[0]).to.include({ stableId: 'region-council-table-v1', regionId: 'council-table' })
})

it('normalizes a node ellipse to its center world point', () => {
  const map = parseMovementTmx(fixtureXml)
  expect(map.nodes[0].point).to.deep.equal({ x: 108, y: 208 })
})
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "movement TMX"`

Expected: FAIL because map types and parser do not exist.

- [ ] **Step 3: Add exact runtime types**

```ts
export type MapPoint = { x: number; y: number }
export type MapPolygon = { points: MapPoint[] }
export type Region = { stableId: string; regionId: string; label: string; capacity: number; protected: boolean; riskLevel: string; polygon: MapPolygon }
export type NavNode = { stableId: string; kind: 'normal' | 'junction' | 'doorway' | 'narrow'; channelWidth: number; point: MapPoint }
export type NavEdge = { stableId: string; from: string; to: string; bidirectional: boolean; costMultiplier: number; points: MapPoint[] }
export type Slot = { stableId: string; slotId: string; regionId: string; personaCode?: string; point: MapPoint; kind: 'parking' | 'queue' | 'home' }
export type MapRuntimeData = {
  sceneId: string
  movementSchemaVersion: string
  navGraphVersion: string
  spriteManifestVersion: string
  width: number
  height: number
  regions: Region[]
  nodes: NavNode[]
  edges: NavEdge[]
  slots: Slot[]
  obstacles: MapPolygon[]
}
```

`parseMovementTmx(input)` accepts raw XML or melonJS parsed objects, supports rectangle/polygon/ellipse regions, uses native pixel coordinates, and accepts legacy hyphenated visual layer names only for existing layers.

- [ ] **Step 4: Run tests and typecheck**

Run:

```powershell
npm run test:game -- --grep "movement TMX"
npm run typecheck:game
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/game/map/movementSchema.ts src/game/map/tmxMovementParser.ts tests/game/map/tmx-movement-parser.test.ts
git commit -m "feat: parse Juyiting movement TMX"
```

### Task 2: Add validator with structured scene errors

**Files:**
- Create: `src/game/map/mapValidation.ts`
- Test: `tests/game/map/map-validation.test.ts`

- [ ] **Step 1: Write failing validation tests**

```ts
it('rejects duplicate regionId and disconnected core regions', () => {
  const result = validateMapRuntime(invalidMap)
  expect(result.errors.map(error => error.code)).to.include.members([
    'MOVEMENT_SCHEMA_INVALID',
    'NAV_GRAPH_DISCONNECTED',
    'CORE_REGION_UNREACHABLE'
  ])
})

it('requires every region to have a reachable slot', () => {
  expect(validateMapRuntime(mapWithoutSlots).errors[0].technicalMessage)
    .to.include('council-table')
})
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "map validation"`

Expected: FAIL with missing validator.

- [ ] **Step 3: Implement validation result and rules**

```ts
export type SceneError = {
  code: string
  severity: 'fatal' | 'degraded' | 'warning'
  retryable: boolean
  userMessage: string
  technicalMessage?: string
  source: 'map' | 'camera' | 'input' | 'sprites' | 'simulation' | 'backend'
}

export type MapValidationResult = { valid: boolean; errors: SceneError[]; warnings: SceneError[] }
```

Validate supported schema `1`, scene `juyiting-main`, unique stable IDs and region IDs, existing edge endpoints, positive edge costs/channel widths, graph reachability, obstacle-safe edges, at least one reachable slot per region, unique Songjiang home slot, and collider-compatible channels. Fatal failures block map/simulation initialization.

- [ ] **Step 4: Run tests**

Run: `npm run test:game -- --grep "map validation"`

Expected: PASS with deterministic error ordering by code then technical message.

- [ ] **Step 5: Commit**

```powershell
git add src/game/map/mapValidation.ts tests/game/map/map-validation.test.ts
git commit -m "feat: validate Juyiting movement map"
```

### Task 3: Author movement data in hall.tmx through edit operations

**Files:**
- Create: `src/game/map/tmxEditOps.ts`
- Create: `scripts/juyiting/apply-map-ops.mjs`
- Create: `tests/fixtures/juyiting/hall-movement-ops.json`
- Modify: `public/juyiting/hall.tmx`
- Test: `tests/game/map/tmx-edit-ops.test.ts`

- [ ] **Step 1: Write a failing idempotence test**

```ts
const once = applyTmxEditOps(sourceXml, operations)
const twice = applyTmxEditOps(once, operations)
expect(twice).to.equal(once)
expect(parseMovementTmx(once).regions.map(region => region.regionId)).to.include('council-table')
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "TMX edit operations"`

Expected: FAIL because edit operations are absent.

- [ ] **Step 3: Implement operations and fixed map metadata**

Support operations `set-map-property`, `upsert-object-group`, and `upsert-object-by-stable-id`. Apply these required map properties:

```json
{
  "movementSchemaVersion": "1",
  "navGraphVersion": "juyiting-main-v1",
  "spriteManifestVersion": "persona-sheets-v1",
  "sceneId": "juyiting-main"
}
```

Create groups `nav_area`, `nav_obstacles`, `regions`, `nav_nodes`, `nav_edges`, `parking_slots`, `queue_slots`, `home_slots`, and `debug_labels`. Include business regions `main-seat`, `council-table`, `bounty-board`, `agent-roster`, and `library-shelf`; create a connected graph and a Songjiang home slot. Preserve the existing 1664×928, 16×16, 104×58 map dimensions and existing art/hotspot groups.

- [ ] **Step 4: Apply and validate**

Run:

```powershell
node scripts/juyiting/apply-map-ops.mjs public/juyiting/hall.tmx tests/fixtures/juyiting/hall-movement-ops.json
npm run test:game -- --grep "TMX edit operations|movement TMX|map validation"
npm run test:run -- --grep "Tiled map parser"
```

Expected: all pass; a second operation run produces no diff.

- [ ] **Step 5: Commit**

```powershell
git add public/juyiting/hall.tmx src/game/map/tmxEditOps.ts scripts/juyiting/apply-map-ops.mjs tests/fixtures/juyiting/hall-movement-ops.json tests/game/map/tmx-edit-ops.test.ts
git commit -m "feat: author Juyiting movement graph"
```

### Task 4: Generate deterministic snapshot and clean/debug previews

**Files:**
- Create: `src/game/map/tmxSnapshot.ts`
- Create: `src/game/map/tmxPreviewRenderer.ts`
- Create: `scripts/juyiting/validate-map.mjs`
- Create: `scripts/juyiting/render-map-preview.mjs`
- Create: `tests/fixtures/juyiting/hall-map.snapshot.json`
- Create: `docs/assets/juyiting/map-preview/hall-clean.svg`
- Create: `docs/assets/juyiting/map-preview/hall-debug.svg`
- Test: `tests/game/map/tmx-snapshot.test.ts`

- [ ] **Step 1: Write failing determinism tests**

```ts
expect(createMapSnapshot(parseMovementTmx(xml))).to.deep.equal(expectedSnapshot)
expect(renderMapPreview(runtime, { debug: false })).not.to.include('nav-edge')
expect(renderMapPreview(runtime, { debug: true })).to.include('nav-edge')
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "map snapshot"`

Expected: FAIL with missing snapshot/renderer.

- [ ] **Step 3: Implement stable derivation**

Sort all arrays by `stableId`, round coordinates to three decimals, include scene/schema/graph/manifest versions and counts, and render SVG at native map dimensions. Clean preview contains map art plus business-region labels; debug preview adds nodes, directed edges, obstacles, slot kinds, stable IDs, and channel widths.

- [ ] **Step 4: Add scripts and package commands**

```json
"validate:juyiting-map": "node --import tsx scripts/juyiting/validate-map.mjs",
"preview:juyiting-map": "node --import tsx scripts/juyiting/render-map-preview.mjs"
```

Run both commands. Expected: validator prints `Juyiting map valid`; generated files match committed snapshot/previews byte-for-byte.

- [ ] **Step 5: Commit**

```powershell
git add package.json src/game/map/tmxSnapshot.ts src/game/map/tmxPreviewRenderer.ts scripts/juyiting tests/fixtures/juyiting/hall-map.snapshot.json docs/assets/juyiting/map-preview tests/game/map/tmx-snapshot.test.ts
git commit -m "test: add Juyiting map validation previews"
```

### Task 5: Review Songjiang style samples before final asset production

**Files:**
- Create: `docs/assets/juyiting/songjiang-style-review/sample-a.png`
- Create: `docs/assets/juyiting/songjiang-style-review/sample-b.png`
- Create: `docs/assets/juyiting/songjiang-style-review/sample-c.png`
- Create: `docs/assets/juyiting/songjiang-style-review/review.md`

- [ ] **Step 1: Produce three comparable samples**

Each sample must show the same Songjiang pose, transparent background, game-scale rendering, Water Margin clothing, and the same camera angle. Samples vary only in line treatment, palette and level of detail; none may be CSS geometry or a final bulk persona sheet.

- [ ] **Step 2: Record the human review decision**

Use this exact review table and replace each score cell with an integer from 1 to 5 during the review:

```markdown
| Criterion | A | B | C |
| --- | ---: | ---: | ---: |
| Reads at game scale | 1–5 | 1–5 | 1–5 |
| Matches hall palette | 1–5 | 1–5 | 1–5 |
| Silhouette identifies Songjiang | 1–5 | 1–5 | 1–5 |
| Animation-ready costume detail | 1–5 | 1–5 | 1–5 |
```

Immediately below the table, record three real values: `Decision` must be `Sample A`, `Sample B`, or `Sample C`; `Approved by` must identify the actual reviewer; `Approved at` must be the actual ISO-8601 review time. Implementation cannot proceed to the final sheet while any value is blank or outside those formats.

- [ ] **Step 3: Commit approved review evidence**

```powershell
git add docs/assets/juyiting/songjiang-style-review
git commit -m "art: approve Songjiang sprite direction"
```

### Task 6: Define and validate the sprite manifest

**Files:**
- Create: `src/game/sprites/personaSpriteManifest.ts`
- Create: `src/game/sprites/spriteValidation.ts`
- Create: `src/game/sprites/animationResolver.ts`
- Create: `scripts/juyiting/validate-sprites.mjs`
- Test: `tests/game/sprites/sprite-validation.test.ts`

- [ ] **Step 1: Write failing manifest tests**

```ts
it('requires Songjiang and never resolves an unknown persona to Songjiang', () => {
  expect(validateSpriteManifest(manifest).requiredMissingCount).to.equal(0)
  expect(resolvePersonaSprite('unknown-persona', manifest)).to.equal(null)
})

it('requires idle and walk animations with valid frame bounds', () => {
  expect(validateSpriteManifest(invalidManifest).errors.map(error => error.code))
    .to.include('REQUIRED_SPRITE_LOAD_FAILED')
})
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "sprite manifest"`

Expected: FAIL because sprite modules do not exist.

- [ ] **Step 3: Implement manifest contract**

```ts
export type PersonaSpriteDefinition = {
  personaCode: string
  required: boolean
  src: string
  image: { width: number; height: number }
  frame: { width: number; height: number; columns: number; rows: number }
  anchor: { x: number; y: number }
  collider: { width: number; height: number; offsetX: number; offsetY: number }
  scale: number
  baseSpeed: number
  animations: Record<'idle' | 'walk', { frames: number[]; frameMs: number }>
}

export const PERSONA_SPRITE_MANIFEST = {
  version: 'persona-sheets-v1',
  personas: {
    songjiang: {
      personaCode: 'songjiang', required: true,
      src: '/juyiting/sprites/persona-sheets-v1/songjiang.png',
      image: { width: 1024, height: 256 },
      frame: { width: 128, height: 128, columns: 8, rows: 2 },
      anchor: { x: 0.5, y: 0.86 },
      collider: { width: 36, height: 20, offsetX: 0, offsetY: -10 },
      scale: 0.52, baseSpeed: 96,
      animations: {
        idle: { frames: [0, 1, 2, 3], frameMs: 180 },
        walk: { frames: [8, 9, 10, 11, 12, 13, 14, 15], frameMs: 90 }
      }
    }
  }
} as const
```

- [ ] **Step 4: Add release command**

Add `"validate:juyiting-sprites": "node --import tsx scripts/juyiting/validate-sprites.mjs"`. The script reads PNG dimensions/signature, validates required actions/frame indexes/manifest version, and exits non-zero for any required failure or nonzero substitution count.

- [ ] **Step 5: Run tests**

Run: `npm run test:game -- --grep "sprite manifest"`

Expected: tests pass with a fixture image; production validation remains failing until the final Songjiang PNG is added.

- [ ] **Step 6: Commit**

```powershell
git add package.json src/game/sprites scripts/juyiting/validate-sprites.mjs tests/game/sprites
git commit -m "feat: define Juyiting sprite manifest"
```

### Task 7: Add final Songjiang sheet and runtime degradation

**Files:**
- Create: `public/juyiting/sprites/persona-sheets-v1/songjiang.png`
- Create: `src/game/sprites/spriteLoader.ts`
- Modify: `src/game/resources.js`
- Modify: `src/game/entities/HallAgent.js`
- Modify: `src/game/config.js`
- Modify: `tests/juyiting-hall-agent.test.js`
- Test: `tests/game/sprites/sprite-loader.test.ts`

- [ ] **Step 1: Add failing loader/degradation tests**

```ts
const result = await loadPersonaSprites(failingLoader, PERSONA_SPRITE_MANIFEST)
expect(result.degraded).to.equal(true)
expect(result.available.has('songjiang')).to.equal(false)
expect(result.placeholderCount).to.equal(0)
expect(mapReady).to.equal(true)
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "sprite loader"`

Expected: FAIL with missing loader.

- [ ] **Step 3: Implement loader and migrate HallAgent**

Load sprites after base map readiness, validate dimensions before entity creation, omit a persona whose required image fails, and return a degraded `SceneError` without rejecting the map mount. Replace `character-atlas`, `ATLAS_ROWS`, `ATLAS_COLS`, and `CHAR_VISUALS` lookup with manifest definitions. Animation fallback may map business states to `idle` or `walk`, but persona fallback must return `null`.

- [ ] **Step 4: Run asset and agent gates**

Run:

```powershell
npm run validate:juyiting-sprites
npm run test:game -- --grep "sprite"
npm run test:run -- --grep "HallAgent"
npm run build
```

Expected: all pass; validation reports manifest `persona-sheets-v1`, required missing `0`, substitution count `0`.

- [ ] **Step 5: Commit**

```powershell
git add public/juyiting/sprites src/game/resources.js src/game/entities/HallAgent.js src/game/config.js src/game/sprites/spriteLoader.ts tests
git commit -m "feat: deliver Songjiang runtime sprite"
```

### Task 8: Integrate TMX validation into mount and preflight

**Files:**
- Modify: `src/game/JuyitingGame.js`
- Modify: `src/game/tiledMap.js`
- Modify: `tests/juyiting-tiled-map.test.js`
- Modify: `tests/juyiting-public-beta-preflight.mjs`
- Modify: `docs/juyiting-feature-guide.md`

- [ ] **Step 1: Add failing mount/preflight checks**

Assert valid TMX yields `movementReady: true`; unsupported schema yields fatal `MOVEMENT_SCHEMA_INVALID`; sprite failure yields `ready: true`, `degraded: true`, `requiredMissingCount: 1`, and no Songjiang entity.

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- --grep "movementReady|MOVEMENT_SCHEMA_INVALID|required sprite"`

Expected: FAIL because mount does not expose those outcomes.

- [ ] **Step 3: Integrate parser/validator and preflight scripts**

`_prepareMapData` must throw structured fatal map errors instead of swallowing them into `null`; sprite errors are collected as degraded state. Add `validate:juyiting-map` and `validate:juyiting-sprites` to preflight before network checks.

- [ ] **Step 4: Run full pipeline**

Run:

```powershell
npm run validate:juyiting-map
npm run validate:juyiting-sprites
npm run typecheck:game
npm run test:run
npm run build
```

Expected: all exit `0`.

- [ ] **Step 5: Commit**

```powershell
git add src/game/JuyitingGame.js src/game/tiledMap.js tests/juyiting-tiled-map.test.js tests/juyiting-public-beta-preflight.mjs docs/juyiting-feature-guide.md
git commit -m "feat: gate Juyiting map and sprite assets"
```
