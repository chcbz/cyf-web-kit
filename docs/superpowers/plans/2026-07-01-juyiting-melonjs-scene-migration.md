# Juyiting melonJS Scene Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Juyiting scene body fully into melonJS canvas while keeping Vue/DOM business UI.

**Architecture:** `HallStage.vue` becomes a Vue shell with one canvas container and failure state. `JuyitingGame` remains the Vue-to-melonJS facade. `HallScene` owns rendering, hotspots, agent routing, pan, zoom, and coordinate conversion.

**Tech Stack:** Vue 3, melonJS 15, Vite, Mocha/Chai, existing CYF deployment script.

---

## File Structure

- Create `src/game/sceneTransform.js`: pure helpers for clamping, percent mapping, pan and zoom state, and pointer-to-world conversion.
- Modify `src/game/scenes/HallScene.js`: use transform helpers, own pointer drag/wheel/keyboard behavior, keep all scene hit testing in melonJS.
- Modify `src/game/JuyitingGame.js`: expose transform operations if needed and forward mount options cleanly.
- Modify `src/components/juyiting/HallStage.vue`: remove DOM scene body and old map transform logic; keep header, canvas container, failure state, and data watchers.
- Modify `tests/juyiting-melon-hall-scene.test.js`: verify canvas-owned hotspots, agent routing, and transform behavior.
- Create `tests/juyiting-scene-transform.test.js`: verify pure transform helpers.
- Modify `tests/juyiting-public-beta-ui-smoke.mjs`: assert melonJS canvas exists and old DOM scene selectors are absent.

---

### Task 1: Scene Transform Helpers

**Files:**
- Create: `src/game/sceneTransform.js`
- Test: `tests/juyiting-scene-transform.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { expect } from 'chai'

import {
  clamp,
  clampSceneTransform,
  percentRectToViewport,
  screenToWorldPoint
} from '../src/game/sceneTransform.js'

describe('Juyiting scene transform helpers', () => {
  it('maps percent rectangles into viewport rectangles', () => {
    expect(percentRectToViewport({ x: 50, y: 40, w: 20, h: 10 }, { width: 1000, height: 600 })).to.deep.equal({
      x: 400,
      y: 210,
      width: 200,
      height: 60,
      centerX: 500,
      centerY: 240
    })
  })

  it('clamps pan and zoom to viewport bounds', () => {
    expect(clamp(5, 1, 3)).to.equal(3)
    expect(clampSceneTransform({
      offsetX: 900,
      offsetY: -900,
      zoom: 9
    }, {
      viewportWidth: 960,
      viewportHeight: 640,
      minZoom: 0.75,
      maxZoom: 3.3
    })).to.deep.equal({
      offsetX: 960,
      offsetY: -640,
      zoom: 3.3
    })
  })

  it('converts screen points into transformed world coordinates', () => {
    expect(screenToWorldPoint({
      x: 580,
      y: 340,
      viewportWidth: 960,
      viewportHeight: 640,
      offsetX: 100,
      offsetY: -20,
      zoom: 2
    })).to.deep.equal({ x: 480, y: 350 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha --config .mocharc.json tests/juyiting-scene-transform.test.js`

Expected: FAIL with module or export not found.

- [ ] **Step 3: Implement the helper module**

Create `src/game/sceneTransform.js` with:

```js
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const percentRectToViewport = (rect, viewport) => {
  const width = (rect.w / 100) * viewport.width
  const height = (rect.h / 100) * viewport.height
  const centerX = (rect.x / 100) * viewport.width
  const centerY = (rect.y / 100) * viewport.height
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    centerX,
    centerY
  }
}

export const scenePanBounds = ({ viewportWidth, viewportHeight, zoom }) => ({
  x: Math.max(0, (viewportWidth * zoom - viewportWidth) / 2),
  y: Math.max(0, (viewportHeight * zoom - viewportHeight) / 2)
})

export const clampSceneTransform = (transform, bounds) => {
  const zoom = Number(clamp(transform.zoom, bounds.minZoom, bounds.maxZoom).toFixed(2))
  const pan = scenePanBounds({
    viewportWidth: bounds.viewportWidth,
    viewportHeight: bounds.viewportHeight,
    zoom
  })
  return {
    offsetX: clamp(transform.offsetX, -pan.x, pan.x),
    offsetY: clamp(transform.offsetY, -pan.y, pan.y),
    zoom
  }
}

export const screenToWorldPoint = ({
  x,
  y,
  viewportWidth,
  viewportHeight,
  offsetX,
  offsetY,
  zoom
}) => ({
  x: Number(((x - viewportWidth / 2 - offsetX) / zoom + viewportWidth / 2).toFixed(3)),
  y: Number(((y - viewportHeight / 2 - offsetY) / zoom + viewportHeight / 2).toFixed(3))
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx mocha --config .mocharc.json tests/juyiting-scene-transform.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/sceneTransform.js tests/juyiting-scene-transform.test.js
git commit -m "test: cover juyiting scene transforms"
```

---

### Task 2: Move Pan, Zoom, And Canvas Input Into HallScene

**Files:**
- Modify: `src/game/scenes/HallScene.js`
- Modify: `src/game/JuyitingGame.js`
- Test: `tests/juyiting-melon-hall-scene.test.js`

- [ ] **Step 1: Write the failing tests**

Extend `tests/juyiting-melon-hall-scene.test.js` with:

```js
it('keeps transform state inside the melonJS scene', () => {
  const me = createFakeMelon()
  const HallScene = createHallSceneClass(me, class {})
  const scene = new HallScene()

  scene.onResetEvent()
  scene.panBy(120, -80)
  scene.zoomBy(0.5)

  expect(scene.getTransform()).to.include({ offsetX: 120, offsetY: -80, zoom: 1.5 })

  scene.resetTransform()
  expect(scene.getTransform()).to.deep.equal({ offsetX: 0, offsetY: 0, zoom: 1 })
})
```

Add fake melon input hooks if missing:

```js
input: {
  KEY: { PLUS: '+', NUMPAD_PLUS: 'numpad+', MINUS: '-', NUMPAD_MINUS: 'numpad-', ZERO: '0' },
  registerPointerEvent: (type, region, callback) => registered.push({ type, region, callback }),
  releaseAllPointerEvents: () => {},
  bindKey: () => {},
  unbindKey: () => {},
  isKeyPressed: () => false
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha --config .mocharc.json tests/juyiting-melon-hall-scene.test.js`

Expected: FAIL because `panBy`, `zoomBy`, `resetTransform`, or `getTransform` is not defined.

- [ ] **Step 3: Implement transform state in `HallScene`**

Import helpers:

```js
import { clampSceneTransform, screenToWorldPoint } from '../sceneTransform.js'
```

Add constructor state:

```js
this._transform = { offsetX: 0, offsetY: 0, zoom: 1 }
this._minZoom = 0.75
this._maxZoom = 3.3
this._dragState = { active: false, pointerId: null, startX: 0, startY: 0, originX: 0, originY: 0, dragging: false }
```

Add public methods:

```js
getTransform() {
  return { ...this._transform }
}

_clampTransform(next) {
  const vp = me.game.viewport
  this._transform = clampSceneTransform(next, {
    viewportWidth: vp.width,
    viewportHeight: vp.height,
    minZoom: this._minZoom,
    maxZoom: this._maxZoom
  })
}

panBy(dx, dy) {
  this._clampTransform({
    ...this._transform,
    offsetX: this._transform.offsetX + dx,
    offsetY: this._transform.offsetY + dy
  })
}

zoomBy(delta) {
  this._clampTransform({
    ...this._transform,
    zoom: this._transform.zoom + delta
  })
}

resetTransform() {
  this._transform = { offsetX: 0, offsetY: 0, zoom: 1 }
}
```

Update `draw()` calls in custom renderables and pointer routing to use transformed world points. Keep the implementation minimal: first land transform state and keep visuals passing, then wire pointer events in Task 3 if needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx mocha --config .mocharc.json tests/juyiting-melon-hall-scene.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/scenes/HallScene.js src/game/JuyitingGame.js tests/juyiting-melon-hall-scene.test.js
git commit -m "feat: move hall scene transform state into melonjs"
```

---

### Task 3: Strip DOM Scene Body From HallStage

**Files:**
- Modify: `src/components/juyiting/HallStage.vue`
- Test: `tests/juyiting-component-behavior.test.js`

- [ ] **Step 1: Write the failing test**

Add a component test that mounts `HallStage` and verifies it renders only the melonJS container for the scene body:

```js
it('renders the hall scene body as a melonJS canvas shell without DOM room or agent layers', () => {
  const wrapper = mount(HallStage, {
    props: makeHallStageProps()
  })

  expect(wrapper.find('.melon-layer').exists()).to.equal(true)
  expect(wrapper.find('.map-world').exists()).to.equal(false)
  expect(wrapper.find('.hall-room').exists()).to.equal(false)
  expect(wrapper.findComponent(AgentToken).exists()).to.equal(false)
})
```

If `makeHallStageProps` does not exist, create a local helper with required function props returning stable strings and arrays.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha --config .mocharc.json tests/juyiting-component-behavior.test.js`

Expected: FAIL because `.map-world`, `.hall-room`, or `AgentToken` still exists.

- [ ] **Step 3: Simplify the HallStage template**

Replace the board body with:

```vue
<div
  ref="hallBoardRef"
  class="hall-board"
  :class="{ 'is-melon-ready': melonReady, 'has-scene-error': Boolean(sceneError) }"
  tabindex="0"
  aria-label="聚义厅地图，可拖拽平移，滚轮或双指缩放，键盘加减号缩放，0 复位"
  @keydown="handleSceneKeydown"
>
  <div ref="melonContainerRef" class="melon-layer" aria-hidden="true"></div>
  <div v-if="sceneError" class="scene-error" role="status">
    <span>聚义厅场景暂不可用</span>
    <button type="button" class="tool-action" @click="retryScene">重试</button>
  </div>
</div>
```

Remove imports and code for `AgentToken`, `hallBackground`, `hallObjectAtlas`, `hallPlaque`, `hallArchiveDesk`, `roomPropsAtlas`, `hallPhysicalScene`, `hallRoomPropVisuals`, `mapWorldRef`, CSS transform state, object hitboxes, DOM route click, and CSS-only object styles.

Keep `openPublicDiscussion` behavior through melonJS hotspot callbacks: when hotspot panel is `chat`, emit `open-panel`, `chat`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx mocha --config .mocharc.json tests/juyiting-component-behavior.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/juyiting/HallStage.vue tests/juyiting-component-behavior.test.js
git commit -m "feat: render juyiting stage body with melonjs shell"
```

---

### Task 4: Complete melonJS Hotspots, Agents, And Failure State

**Files:**
- Modify: `src/game/scenes/HallScene.js`
- Modify: `src/components/juyiting/HallStage.vue`
- Test: `tests/juyiting-melon-hall-scene.test.js`
- Test: `tests/juyiting-component-behavior.test.js`

- [ ] **Step 1: Write failing behavior tests**

Add tests that verify:

```js
it('routes hotspot clicks through melonJS after DOM rooms are removed', () => {
  const me = createFakeMelon()
  const HallScene = createHallSceneClass(me, class {})
  const scene = new HallScene()
  const clicked = []

  scene.onHotspotClick(item => clicked.push(item))
  scene.onResetEvent()

  const hotspotRegistration = me.registered.find(item => item.region.data?.id === 'bountyBoard')
  hotspotRegistration.callback({ gameX: 730, gameY: 300 })

  expect(clicked[0]).to.deep.equal({ id: 'bountyBoard', panel: 'tasks' })
})
```

And a component test for mount failure:

```js
it('shows a retryable scene error when melonJS mount fails', async () => {
  juyitingGame.mount = async () => { throw new Error('boom') }
  const wrapper = mount(HallStage, { props: makeHallStageProps() })
  await flushPromises()

  expect(wrapper.find('.scene-error').text()).to.contain('聚义厅场景暂不可用')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx mocha --config .mocharc.json tests/juyiting-melon-hall-scene.test.js tests/juyiting-component-behavior.test.js
```

Expected: FAIL on missing failure state or incomplete melonJS routing.

- [ ] **Step 3: Implement missing routing and failure state**

In `HallStage.vue`, add:

```js
const sceneError = ref('')

const mountScene = async () => {
  sceneError.value = ''
  const container = melonContainerRef.value
  if (!container) return
  try {
    await juyitingGame.mount(container, {
      onAgentClick: handleAgentClick,
      onHotspotClick: handleHotspotClick,
      onReady: handleSceneReady
    })
    juyitingGame.start()
  } catch (err) {
    sceneError.value = err?.message || 'melonJS unavailable'
    console.warn('[HallStage] melonJS:', sceneError.value)
  }
}

const retryScene = async () => {
  juyitingGame.destroy()
  await mountScene()
}
```

In `HallScene.js`, keep hotspot markers as melonJS renderables and ensure agent pointer routing uses transformed world coordinates before `containsPoint`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx mocha --config .mocharc.json tests/juyiting-melon-hall-scene.test.js tests/juyiting-component-behavior.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/scenes/HallScene.js src/components/juyiting/HallStage.vue tests/juyiting-melon-hall-scene.test.js tests/juyiting-component-behavior.test.js
git commit -m "feat: complete canvas-owned juyiting scene routing"
```

---

### Task 5: Smoke Test And Deployment Verification

**Files:**
- Modify: `tests/juyiting-public-beta-ui-smoke.mjs`

- [ ] **Step 1: Update smoke assertions**

Add browser-side checks after the Juyiting page loads:

```js
const sceneState = await cdp.send('Runtime.evaluate', {
  expression: `(() => {
    const stage = document.querySelector('.hall-stage')
    return {
      hasStage: Boolean(stage),
      hasCanvas: Boolean(document.querySelector('.melon-layer canvas')),
      hasMapWorld: Boolean(document.querySelector('.map-world')),
      hasHallRoom: Boolean(document.querySelector('.hall-room')),
      hasAgentToken: Boolean(document.querySelector('.agent-token'))
    }
  })()`,
  returnByValue: true
})

const value = sceneState.result?.value || {}
if (!value.hasStage || !value.hasCanvas || value.hasMapWorld || value.hasHallRoom || value.hasAgentToken) {
  throw new Error(`Unexpected Juyiting scene DOM state: ${JSON.stringify(value)}`)
}
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
npx mocha --config .mocharc.json tests/juyiting-scene-transform.test.js tests/juyiting-melon-hall-scene.test.js tests/juyiting-component-behavior.test.js
```

Expected: PASS.

- [ ] **Step 3: Run full unit suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: Vite build succeeds.

- [ ] **Step 5: Deploy**

Run: `bash /home/isp/bin/cyf_web_kit_start.sh`

Expected: script pulls, installs, builds, backs up old deploy, copies `dist`, and exits successfully.

- [ ] **Step 6: Public smoke checks**

Run:

```bash
curl -k -sS -o /tmp/cyf-kit-index.html -w '%{http_code} %{size_download}\n' https://kit.chaoyoufan.cn/
/home/isp/apps/nginx/sbin/nginx -t
```

Expected: public curl returns HTTP `200` and nginx config test succeeds.

- [ ] **Step 7: Commit and push**

```bash
git status --short --branch
git add tests/juyiting-public-beta-ui-smoke.mjs
git commit -m "test: assert juyiting melonjs scene shell"
git push origin develop
```

Expected: `develop` pushed to `origin/develop`.
