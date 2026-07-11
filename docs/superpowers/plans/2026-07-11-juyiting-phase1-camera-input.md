# Juyiting Phase 1 Camera and Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace HallScene-owned camera and gesture behavior with tested TypeScript modules while preserving user focus through resize/orientation, locking input behind responsive panels, and making mount retry deterministic.

**Architecture:** Pure TypeScript modules calculate transforms and classify input; a small controller applies those results to melonJS. Vue remains JavaScript and only supplies viewport/panel lifecycle signals through the JuyitingGame facade.

**Tech Stack:** TypeScript, tsx, typescript-eslint, Mocha/Chai, Vue 3, melonJS, Vite.

---

## File map

- Create `tsconfig.game.json`: scoped type checking for game logic and typed tests.
- Create `src/game/camera/{cameraTransform,cameraController,viewPresets,resizePolicy}.ts`.
- Create `src/game/input/{pointerGesture,inputController,hitTest,interactionLock}.ts`.
- Modify `src/game/scenes/HallScene.js`: delegate camera/input and keep rendering only.
- Modify `src/game/JuyitingGame.js`: expose resize, transform, reset animation and lock facade methods.
- Modify `src/components/juyiting/HallStage.vue`: lifecycle, timeout, keyboard and focus-preserving viewport updates.
- Modify `src/components/world/JuyiHall.vue`: responsive panel classes and map lock prop.
- Create typed tests under `tests/game/camera/` and `tests/game/input/`; extend component behavior tests.

### Task 1: Add scoped TypeScript test and lint tooling

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.mocharc.json`
- Modify: `eslint.config.js`
- Create: `tsconfig.game.json`
- Test: `tests/game/tooling-smoke.test.ts`

- [ ] **Step 1: Install the toolchain**

Run:

```powershell
npm install --save-dev typescript tsx typescript-eslint @types/node @types/mocha
```

Expected: dependencies are added to `package.json` and lockfile without changing production dependencies.

- [ ] **Step 2: Add a failing typed import test**

```ts
import { expect } from 'chai'
import { MAIN_HALL_PRESETS } from '../../src/game/camera/viewPresets.ts'

describe('typed game tooling', () => {
  it('loads TypeScript game modules', () => {
    expect(MAIN_HALL_PRESETS.mobilePortrait.zoom).to.equal(1.25)
  })
})
```

- [ ] **Step 3: Verify the test cannot load yet**

Run: `node --import tsx ./node_modules/mocha/bin/mocha.js tests/game/tooling-smoke.test.ts`

Expected: FAIL because `viewPresets.ts` does not exist.

- [ ] **Step 4: Add scripts/config and the minimal preset**

Replace the three non-watch test scripts and add the typed scripts:

```json
"test": "node --import tsx ./node_modules/mocha/bin/mocha.js --config .mocharc.json",
"test:run": "node --import tsx ./node_modules/mocha/bin/mocha.js --config .mocharc.json",
"test:watch": "node --import tsx ./node_modules/mocha/bin/mocha.js --config .mocharc.json --watch",
"test:game": "node --import tsx ./node_modules/mocha/bin/mocha.js --require ./tests/setup.js \"tests/game/**/*.test.ts\"",
"typecheck:game": "tsc -p tsconfig.game.json --noEmit"
```

Create `tsconfig.game.json`:

```json
{
  "extends": "./jsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "noEmit": true,
    "strict": true,
    "types": ["node", "mocha"]
  },
  "include": ["src/game/**/*.ts", "tests/game/**/*.ts"]
}
```

Create `viewPresets.ts`:

```ts
export const MAIN_HALL_FOCUS = { x: 832, y: 390 } as const
export const MAIN_HALL_PRESETS = {
  mobilePortrait: { id: 'main-hall-mobile', zoom: 1.25, focus: MAIN_HALL_FOCUS },
  mobileLandscape: { id: 'main-hall-mobile-landscape', zoom: 1.05, focus: MAIN_HALL_FOCUS },
  tabletLandscape: { id: 'main-hall-tablet-landscape', zoom: 0.92, focus: MAIN_HALL_FOCUS },
  desktop: { id: 'main-hall-desktop', zoom: 0.84, focus: MAIN_HALL_FOCUS }
} as const
```

Extend ESLint with `typescript-eslint.configs.recommended` for `src/game/**/*.ts` and `tests/game/**/*.ts`. In `.mocharc.json`, set `"extension": ["js", "ts"]` and append `"./tests/game/**/*.test.ts"` to `spec`, retaining both existing JS patterns.

- [ ] **Step 5: Verify tooling passes**

Run:

```powershell
npm run test:game
npm run typecheck:game
```

Expected: both exit `0`; one typed smoke test passes.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json .mocharc.json eslint.config.js tsconfig.game.json tests/game/tooling-smoke.test.ts src/game/camera/viewPresets.ts
git commit -m "build: add typed Juyiting game tooling"
```

### Task 2: Implement focal camera transforms and focus-preserving resize

**Files:**
- Create: `src/game/camera/cameraTransform.ts`
- Create: `src/game/camera/resizePolicy.ts`
- Test: `tests/game/camera/camera-transform.test.ts`
- Test: `tests/game/camera/resize-policy.test.ts`

- [ ] **Step 1: Write failing transform tests**

```ts
import { expect } from 'chai'
import { screenToWorld, zoomAt, preserveFocus } from '../../../src/game/camera/cameraTransform.ts'

it('keeps the focal world point within two CSS pixels', () => {
  const before = { zoom: 1, offsetX: 0, offsetY: 0 }
  const after = zoomAt(before, { x: 240, y: 320 }, 1.5, { width: 390, height: 720 })
  expect(screenToWorld({ x: 240, y: 320 }, before, { width: 390, height: 720 }).x)
    .to.be.closeTo(screenToWorld({ x: 240, y: 320 }, after, { width: 390, height: 720 }).x, 2)
})

it('preserves the old center world point after orientation change', () => {
  const next = preserveFocus({ zoom: 1.25, offsetX: 30, offsetY: -20 }, { width: 390, height: 720 }, { width: 720, height: 390 })
  expect(screenToWorld({ x: 360, y: 195 }, next, { width: 720, height: 390 }))
    .to.deep.equal(screenToWorld({ x: 195, y: 360 }, { zoom: 1.25, offsetX: 30, offsetY: -20 }, { width: 390, height: 720 }))
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:game -- --grep "focal|orientation"`

Expected: FAIL with missing exports from `cameraTransform.ts`.

- [ ] **Step 3: Implement the pure transform contract**

```ts
export type Point = { x: number; y: number }
export type Viewport = { width: number; height: number }
export type CameraTransform = { zoom: number; offsetX: number; offsetY: number }

export const screenToWorld = (p: Point, t: CameraTransform, v: Viewport): Point => ({
  x: (p.x - v.width / 2 - t.offsetX) / t.zoom + v.width / 2,
  y: (p.y - v.height / 2 - t.offsetY) / t.zoom + v.height / 2
})

export const transformForFocus = (world: Point, screen: Point, zoom: number, v: Viewport): CameraTransform => ({
  zoom,
  offsetX: screen.x - v.width / 2 - (world.x - v.width / 2) * zoom,
  offsetY: screen.y - v.height / 2 - (world.y - v.height / 2) * zoom
})

export const zoomAt = (t: CameraTransform, screen: Point, zoom: number, v: Viewport) =>
  transformForFocus(screenToWorld(screen, t, v), screen, zoom, v)

export const preserveFocus = (t: CameraTransform, oldV: Viewport, newV: Viewport) =>
  transformForFocus(screenToWorld({ x: oldV.width / 2, y: oldV.height / 2 }, t, oldV), { x: newV.width / 2, y: newV.height / 2 }, t.zoom, newV)
```

In `resizePolicy.ts`, export `classifyViewportResize` returning `'keyboard' | 'orientation' | 'layout'`; classify as keyboard when width changes by at most 2 CSS px, visual viewport height changes by at least 120 px, and an editable element is focused.

- [ ] **Step 4: Verify tests and types**

Run:

```powershell
npm run test:game
npm run typecheck:game
```

Expected: PASS; focal drift assertions are within 2 CSS px.

- [ ] **Step 5: Commit**

```powershell
git add src/game/camera/cameraTransform.ts src/game/camera/resizePolicy.ts tests/game/camera
git commit -m "feat: add focal Juyiting camera transforms"
```

### Task 3: Add camera controller, presets, clamp and reset animation

**Files:**
- Create: `src/game/camera/cameraController.ts`
- Modify: `src/game/camera/viewPresets.ts`
- Test: `tests/game/camera/camera-controller.test.ts`

- [ ] **Step 1: Write failing controller tests**

```ts
it('cancels reset animation when the user starts a gesture', () => {
  const controller = createCameraController(fakeAdapter, bounds)
  controller.resetTo('mobilePortrait', 200)
  controller.beginUserGesture()
  expect(controller.snapshot().animation).to.equal(null)
})

it('shows reset affordance outside the approved tolerance', () => {
  const controller = createCameraController(fakeAdapter, bounds)
  controller.panBy(49, 0)
  expect(controller.isAwayFromPreset()).to.equal(true)
})
```

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:game -- --grep "reset animation|affordance"`

Expected: FAIL because `createCameraController` is missing.

- [ ] **Step 3: Implement controller API**

```ts
export type CameraAdapter = {
  viewport(): Viewport
  apply(transform: CameraTransform): void
  requestFrame(callback: (now: number) => void): number
  cancelFrame(id: number): void
}

export type CameraController = {
  panBy(dx: number, dy: number): CameraTransform
  zoomAt(point: Point, factor: number): CameraTransform
  resize(next: Viewport, kind: 'keyboard' | 'orientation' | 'layout'): CameraTransform
  resetTo(preset: keyof typeof MAIN_HALL_PRESETS, durationMs?: number): void
  beginUserGesture(): void
  isAwayFromPreset(): boolean
  snapshot(): { transform: CameraTransform; preset: string; animation: null | { startedAt: number } }
}
```

Clamp zoom to the active preset minimum and `3.3`; clamp offsets so no map-edge blank exceeds 2 CSS px. Use 200 ms ease-out for reset, with the accepted 150–250 ms range represented by the single configured value `200`.

- [ ] **Step 4: Run tests**

Run: `npm run test:game -- --grep "camera controller"`

Expected: PASS, including clamping, preset selection, resize preservation and gesture cancellation.

- [ ] **Step 5: Commit**

```powershell
git add src/game/camera tests/game/camera
git commit -m "feat: add Juyiting camera controller"
```

### Task 4: Implement gesture classification, hit priority and interaction lock

**Files:**
- Create: `src/game/input/pointerGesture.ts`
- Create: `src/game/input/hitTest.ts`
- Create: `src/game/input/interactionLock.ts`
- Create: `src/game/input/inputController.ts`
- Test: `tests/game/input/pointer-gesture.test.ts`
- Test: `tests/game/input/input-controller.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('cancels click after mouse drag exceeds six pixels', () => {
  const gesture = createPointerGesture({ mouseThreshold: 6, touchThreshold: 11 })
  gesture.down({ id: 1, type: 'mouse', x: 10, y: 10 })
  expect(gesture.move({ id: 1, type: 'mouse', x: 17, y: 10 }).kind).to.equal('drag')
  expect(gesture.up({ id: 1, type: 'mouse', x: 17, y: 10 }).kind).to.equal('none')
})

it('prioritizes agent, then hotspot, then blank map', () => {
  expect(resolveHit(point, [agentHit], [hotspotHit]).kind).to.equal('agent')
  expect(resolveHit(point, [], [hotspotHit]).kind).to.equal('hotspot')
  expect(resolveHit(point, [], []).kind).to.equal('blank')
})
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:game -- --grep "click after|prioritizes"`

Expected: FAIL because input modules do not exist.

- [ ] **Step 3: Implement exact input contracts**

```ts
export type GestureResult =
  | { kind: 'none' }
  | { kind: 'click'; point: Point }
  | { kind: 'drag'; dx: number; dy: number }
  | { kind: 'pinch'; center: Point; scale: number }

export type InteractionLock = {
  lock(reason: string): void
  unlock(reason: string): void
  isLocked(): boolean
  reasons(): readonly string[]
}

export type HitResult =
  | { kind: 'agent'; id: string }
  | { kind: 'hotspot'; id: string }
  | { kind: 'blank' }
```

`inputController.ts` must bind pointer/wheel/keydown listeners once, prevent browser scroll while interacting, apply invisible touch hit slop only for agents/hotspots, cancel a gesture when a second pointer or orientation change arrives, and ignore all map input while the lock contains `panel` or `loading`.

- [ ] **Step 4: Run input tests**

Run: `npm run test:game -- --grep "gesture|input controller|hit"`

Expected: PASS for click/drag/pinch/wheel/keyboard, lock, cancellation and cleanup.

- [ ] **Step 5: Commit**

```powershell
git add src/game/input tests/game/input
git commit -m "feat: add Juyiting input controller"
```

### Task 5: Integrate Camera/Input into HallScene and game facade

**Files:**
- Modify: `src/game/scenes/HallScene.js`
- Modify: `src/game/JuyitingGame.js`
- Modify: `src/game/index.js`
- Modify: `tests/juyiting-hall-scene-runtime.test.js`
- Modify: `tests/juyiting-melon-hall-scene.test.js`

- [ ] **Step 1: Add failing facade tests**

```js
expect(game.getCameraSnapshot()).to.deep.include({ preset: 'main-hall-mobile' })
game.setInteractionLocked(true, 'panel')
expect(scene.inputSnapshot().interactionLocked).to.equal(true)
game.resizeViewport({ width: 720, height: 390, kind: 'orientation' })
expect(game.getCameraSnapshot().transform.zoom).to.equal(before.zoom)
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- --grep "camera snapshot|interaction locked|resize viewport"`

Expected: FAIL because facade methods are missing.

- [ ] **Step 3: Replace HallScene-owned gesture state**

Remove `_dragState`, `_touchPointers`, `_pinchState`, direct wheel/pointer calculations and direct fit-on-resize. Construct controllers during scene reset and destroy them during `onDestroyEvent`. Keep rendering/hit-area collection in HallScene and pass hit candidates to the input controller.

Add facade methods:

```js
resizeViewport(change) { return this._hallScene?.resizeViewport?.(change) }
setInteractionLocked(locked, reason = 'panel') { return this._hallScene?.setInteractionLocked?.(locked, reason) }
getCameraSnapshot() { return this._hallScene?.getCameraSnapshot?.() || null }
resetToMainHall() { return this._hallScene?.resetToMainHall?.() }
```

- [ ] **Step 4: Run regression tests**

Run:

```powershell
npm run test:run
npm run test:game
```

Expected: all existing HallScene tests and new controller tests pass; no direct gesture calculation remains in `HallScene.js`.

- [ ] **Step 5: Commit**

```powershell
git add src/game/JuyitingGame.js src/game/index.js src/game/scenes/HallScene.js tests/juyiting-hall-scene-runtime.test.js tests/juyiting-melon-hall-scene.test.js
git commit -m "refactor: delegate Juyiting camera and input"
```

### Task 6: Add responsive panels, map lock, loading timeout and safe resize behavior

**Files:**
- Create: `src/composables/juyiting/useHallPanels.js`
- Modify: `src/components/juyiting/HallStage.vue`
- Modify: `src/components/world/JuyiHall.vue`
- Modify: `tests/juyiting-component-behavior.test.js`

- [ ] **Step 1: Add failing component tests**

```js
expect(wrapper.find('.floating-panel').classes()).to.include('layout-bottom-drawer')
await wrapper.setProps({ interactionLocked: true })
expect(lockCalls.at(-1)).to.deep.equal([true, 'panel'])
visualViewport.height = 430
visualViewport.dispatchEvent(new Event('resize'))
expect(resizeCalls.at(-1).kind).to.equal('keyboard')
expect(fitCalls).to.have.length(0)
```

- [ ] **Step 2: Verify failure**

Run: `npm run test:run -- --grep "bottom drawer|keyboard|interaction lock|loading timeout"`

Expected: FAIL because layout classification, lock prop and timeout state are absent.

- [ ] **Step 3: Implement panel classification and lifecycle**

`useHallPanels.js` returns:

```js
export const classifyPanelLayout = ({ width, height, coarsePointer }) => {
  if (width >= 1024 && !coarsePointer) return 'center-modal'
  if (width > height) return 'right-drawer'
  return 'bottom-drawer'
}
```

Pass `:interaction-locked="Boolean(activePanel)"` to `HallStage`. Replace every resize-driven `fitToViewport()` call with `resizeViewport({ width, height, kind })`; keyboard changes only resize panel CSS variables. Add a 15-second mount timer that displays `地图加载超时，请重试`, locks input during loading, invalidates the old attempt on retry, and clears the timer/listeners on unmount.

Add a reset button with `aria-label="回主厅"`, hide it while a panel is active, and call `resetToMainHall()` without altering panel or selection state.

- [ ] **Step 4: Run UI tests and build**

Run:

```powershell
npm run test:run -- --grep "JuyiHall component behavior"
npm run lint
npm run build
```

Expected: PASS; portrait uses bottom drawer, landscape/tablet uses right drawer, PC uses centered modal, panel input does not reach the map, keyboard resize preserves transform.

- [ ] **Step 5: Commit**

```powershell
git add src/composables/juyiting/useHallPanels.js src/components/juyiting/HallStage.vue src/components/world/JuyiHall.vue tests/juyiting-component-behavior.test.js
git commit -m "feat: stabilize Juyiting responsive map interaction"
```

### Task 7: Final Camera/Input verification and documentation

**Files:**
- Modify: `docs/juyiting-development-guide.md`
- Modify: `docs/juyiting-feature-guide.md`

- [ ] **Step 1: Run the complete frontend gate**

Run:

```powershell
npm run typecheck:game
npm run lint
npm run test:run
npm run build
```

Expected: all exit `0`.

- [ ] **Step 2: Document stable APIs and device checks**

Document `resizeViewport`, `setInteractionLocked`, `getCameraSnapshot`, `resetToMainHall`, panel layouts, keyboard filter, the 15-second retry contract, and the exact commands above.

- [ ] **Step 3: Commit**

```powershell
git add docs/juyiting-development-guide.md docs/juyiting-feature-guide.md
git commit -m "docs: add Juyiting camera and input verification"
```
