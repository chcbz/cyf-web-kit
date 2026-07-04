# Juyiting Modular Layer Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and wire a new modular 2.5D Juyiting hall core asset pack without cutting from the existing hall background.

**Architecture:** New generated PNG assets live under `public/juyiting/images/modular/` and are described by a separate manifest in `src/game/hallModularLayers.js`. Tests validate file existence, alpha transparency for props, manifest shape, and non-overlap with the existing extracted-layer workflow.

**Tech Stack:** Vue/Vite project, melonJS asset conventions, Mocha/Chai tests, built-in image generation tool, PNG parsing with Node buffers.

---

## File Structure

- Create: `public/juyiting/images/modular/`
  - Stores generated project-ready PNG assets.
- Create: `src/game/hallModularLayers.js`
  - Declares modular layer metadata and resources without replacing `hallSceneLayers.js`.
- Create: `tests/juyiting-modular-layer-assets.test.js`
  - Verifies generated assets and manifest.
- Create: `docs/juyiting/modular-layer-prompts.md`
  - Records final prompts and confirms assets were generated, not cropped.
- Create: `public/juyiting/images/modular/preview.html`
  - Quick visual QA composition using the manifest defaults.

## Non-Negotiable Generation Rules

- Do not use `scripts/generate-juyiting-layer-assets.mjs` for this work.
- Do not crop, mask, or copy pixels from `public/juyiting/images/liangshan-hall-bg-v2.png`.
- Use image generation for the nine new assets.
- Use the available built-in image generation capability. If the tool does not expose a selectable model identifier, do not claim a specific model ID in code or docs; describe it as the image generation model used by Codex.
- Props must be standalone transparent PNGs after chroma-key removal.

## Asset Prompt Set

Use these exact prompt bases. For prop assets, append the chroma-key instruction block.

Shared style block:

```text
Use case: stylized-concept
Asset type: modular 2.5D game scene asset for a Water Margin / Liangshan gathering hall
Style/medium: polished painterly game environment art, Chinese Song dynasty mountain stronghold hall, hand-painted but clean enough for UI/game use
Composition/framing: fixed 2.5D stage perspective, front-facing with a slight top-down angle, consistent camera across all assets
Lighting/mood: warm lantern-lit interior, heroic but practical hall atmosphere
Color palette: aged dark wood, muted red lacquer, worn gold accents, deep teal shadow notes, stone gray floor tones
Constraints: no people, no modern objects, no watermark, no logo, no readable text, no UI elements
Avoid: photorealistic photography, anime character focus, extreme fisheye perspective, heavy blur, random Chinese characters
```

Chroma-key block for props:

```text
Create the subject on a perfectly flat solid #00ff00 chroma-key background for background removal.
The background must be one uniform color with no shadows, gradients, texture, reflections, floor plane, or lighting variation.
Keep the subject fully separated from the background with crisp edges and generous padding.
Do not use #00ff00 anywhere in the subject.
No cast shadow, no contact shadow, no reflection, no watermark, and no text.
```

Asset-specific prompts:

```text
hall-wall-back-v1.png
Primary request: a modular back wall and rear hall backdrop for a Liangshan gathering hall, including timber wall sections, high beams, a central leadership alcove, side architectural details, and empty space for independently movable props.
Scene/backdrop: rectangular full-width rear wall layer, no floor foreground.
Composition/framing: wide 1672:520-style scene layer, front-facing 2.5D perspective.
```

```text
hall-floor-v1.png
Primary request: a modular empty hall floor for character placement, stone and worn wood floor surfaces suitable for a Liangshan gathering hall.
Scene/backdrop: rectangular full-width floor plane with subtle perspective lines and no furniture.
Composition/framing: wide 1672:520-style lower scene layer, front-facing 2.5D perspective.
```

```text
hall-pillars-v1.png
Primary request: structural pillars and overhead beams for a Liangshan gathering hall, designed as an overlay layer with left, center, and right vertical supports.
Scene/backdrop: standalone structural layer with transparent-friendly empty negative space between pillars.
Composition/framing: wide 1672:941-style overlay layer, front-facing 2.5D perspective.
```

```text
prop-main-seat-v1.png
Primary request: a commander's main wooden seat and raised platform for the leader of a Liangshan hall, ornate but rugged, dark carved wood with muted red and gold accents.
Subject: one standalone main seat prop.
Composition/framing: centered object, full object visible.
```

```text
prop-table-desk-v1.png
Primary request: a central command table or desk for a Liangshan hall, heavy aged wood, scrolls and map-like blank papers without readable text, practical for strategy discussion.
Subject: one standalone desk prop.
Composition/framing: centered object, full object visible.
```

```text
prop-bounty-board-v1.png
Primary request: a freestanding bounty and task board for a Liangshan hall, wooden frame, pinned blank parchment shapes with no readable text.
Subject: one standalone board prop.
Composition/framing: centered object, full object visible.
```

```text
prop-library-shelf-v1.png
Primary request: an archive shelf and document cabinet for a Liangshan hall, aged wooden shelves, scroll tubes, bundled documents, no readable text.
Subject: one standalone shelf prop.
Composition/framing: centered object, full object visible.
```

```text
prop-roster-book-v1.png
Primary request: an oversized agent roster book on a small lectern, suitable for a Liangshan hall, open blank pages with no readable text.
Subject: one standalone roster book and lectern prop.
Composition/framing: centered object, full object visible.
```

```text
prop-gate-v1.png
Primary request: an entrance gate or doorway for a Liangshan gathering hall, heavy timber door frame, mountain stronghold style, open passage feel, no visible characters.
Subject: one standalone doorway prop.
Composition/framing: centered object, full object visible.
```

---

### Task 1: Generate Modular Assets

**Files:**
- Create directory: `public/juyiting/images/modular/`
- Create images:
  - `public/juyiting/images/modular/hall-wall-back-v1.png`
  - `public/juyiting/images/modular/hall-floor-v1.png`
  - `public/juyiting/images/modular/hall-pillars-v1.png`
  - `public/juyiting/images/modular/prop-main-seat-v1.png`
  - `public/juyiting/images/modular/prop-table-desk-v1.png`
  - `public/juyiting/images/modular/prop-bounty-board-v1.png`
  - `public/juyiting/images/modular/prop-library-shelf-v1.png`
  - `public/juyiting/images/modular/prop-roster-book-v1.png`
  - `public/juyiting/images/modular/prop-gate-v1.png`

- [ ] **Step 1: Generate the three environmental layers**

Use the built-in image generation tool once per environment asset with the shared style block plus the matching asset-specific prompt. Save the selected results into `public/juyiting/images/modular/` with the exact filenames listed above.

Expected result: the three environment files exist and are new generated images.

- [ ] **Step 2: Generate the six prop source images**

Use the built-in image generation tool once per prop with the shared style block, matching asset-specific prompt, and chroma-key block. Save the raw generated sources temporarily under `public/juyiting/images/modular/_source/` using:

```text
prop-main-seat-v1-source.png
prop-table-desk-v1-source.png
prop-bounty-board-v1-source.png
prop-library-shelf-v1-source.png
prop-roster-book-v1-source.png
prop-gate-v1-source.png
```

Expected result: each source has a flat green background and a complete centered prop.

- [ ] **Step 3: Remove chroma-key backgrounds**

Run the installed chroma-key helper for each prop source:

```powershell
python "$env:CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py" --input "public/juyiting/images/modular/_source/prop-main-seat-v1-source.png" --out "public/juyiting/images/modular/prop-main-seat-v1.png" --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
python "$env:CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py" --input "public/juyiting/images/modular/_source/prop-table-desk-v1-source.png" --out "public/juyiting/images/modular/prop-table-desk-v1.png" --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
python "$env:CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py" --input "public/juyiting/images/modular/_source/prop-bounty-board-v1-source.png" --out "public/juyiting/images/modular/prop-bounty-board-v1.png" --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
python "$env:CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py" --input "public/juyiting/images/modular/_source/prop-library-shelf-v1-source.png" --out "public/juyiting/images/modular/prop-library-shelf-v1.png" --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
python "$env:CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py" --input "public/juyiting/images/modular/_source/prop-roster-book-v1-source.png" --out "public/juyiting/images/modular/prop-roster-book-v1.png" --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
python "$env:CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py" --input "public/juyiting/images/modular/_source/prop-gate-v1-source.png" --out "public/juyiting/images/modular/prop-gate-v1.png" --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
```

Expected result: the six final prop PNGs have transparent corners and no visible green fringe.

- [ ] **Step 4: Commit generated assets**

```powershell
git add -- public/juyiting/images/modular
git commit -m "feat: add generated juyiting modular assets"
```

Expected result: a commit containing only the final modular image assets. Do not commit `public/juyiting/images/modular/_source/`; delete that temporary directory before committing.

---

### Task 2: Add Modular Layer Manifest

**Files:**
- Create: `src/game/hallModularLayers.js`
- Test: `tests/juyiting-modular-layer-assets.test.js`

- [ ] **Step 1: Write the failing manifest test**

Create `tests/juyiting-modular-layer-assets.test.js` with:

```js
import { expect } from 'chai'
import { existsSync, readFileSync } from 'fs'

import {
  HALL_MODULAR_ENVIRONMENT_LAYERS,
  HALL_MODULAR_PROP_LAYERS,
  HALL_MODULAR_RENDER_LAYERS,
  HALL_MODULAR_LAYER_RESOURCES
} from '../src/game/hallModularLayers.js'

const pngInfo = (path) => {
  const bytes = readFileSync(path)
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes.readUInt8(25)
  }
}

describe('Juyiting modular layer assets', () => {
  it('declares the generated modular environment layers', () => {
    expect(HALL_MODULAR_ENVIRONMENT_LAYERS.map(layer => layer.id)).to.deep.equal([
      'hall-wall-back',
      'hall-floor',
      'hall-pillars'
    ])

    HALL_MODULAR_ENVIRONMENT_LAYERS.forEach(layer => {
      expect(layer.kind).to.equal('environment')
      expect(layer.src).to.match(/^\/juyiting\/images\/modular\/.+\.png$/)
      expect(layer.defaultScale).to.be.a('number').and.greaterThan(0)
    })
  })

  it('declares the generated modular prop layers', () => {
    expect(HALL_MODULAR_PROP_LAYERS.map(layer => layer.id)).to.deep.equal([
      'prop-main-seat',
      'prop-table-desk',
      'prop-bounty-board',
      'prop-library-shelf',
      'prop-roster-book',
      'prop-gate'
    ])

    HALL_MODULAR_PROP_LAYERS.forEach(layer => {
      expect(layer.kind).to.equal('prop')
      expect(layer.src).to.match(/^\/juyiting\/images\/modular\/.+\.png$/)
      expect(layer.depth).to.be.a('number')
      expect(layer.defaultX).to.be.a('number')
      expect(layer.defaultY).to.be.a('number')
      expect(layer.defaultScale).to.be.a('number').and.greaterThan(0)
    })
  })

  it('sorts render layers by depth', () => {
    const depths = HALL_MODULAR_RENDER_LAYERS.map(layer => layer.depth)
    expect(depths).to.deep.equal([...depths].sort((a, b) => a - b))
  })

  it('exposes every modular layer as an image resource', () => {
    const layerResourceNames = HALL_MODULAR_RENDER_LAYERS.map(layer => layer.resourceName)
    expect(HALL_MODULAR_LAYER_RESOURCES.map(resource => resource.name)).to.deep.equal(layerResourceNames)
    HALL_MODULAR_LAYER_RESOURCES.forEach(resource => {
      expect(resource.type).to.equal('image')
      expect(resource.src).to.match(/^\/juyiting\/images\/modular\/.+\.png$/)
    })
  })

  it('points every manifest entry at an existing PNG', () => {
    HALL_MODULAR_RENDER_LAYERS.forEach(layer => {
      const filePath = layer.src.replace('/juyiting/', 'public/juyiting/')
      expect(existsSync(filePath), layer.id).to.equal(true)
      const info = pngInfo(filePath)
      expect(info.width, layer.id).to.be.greaterThan(64)
      expect(info.height, layer.id).to.be.greaterThan(64)
    })
  })

  it('keeps prop assets alpha-capable', () => {
    HALL_MODULAR_PROP_LAYERS.forEach(layer => {
      const filePath = layer.src.replace('/juyiting/', 'public/juyiting/')
      const info = pngInfo(filePath)
      expect([4, 6], layer.id).to.include(info.colorType)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --grep "Juyiting modular layer assets"
```

Expected: FAIL because `src/game/hallModularLayers.js` does not exist.

- [ ] **Step 3: Create manifest implementation**

Create `src/game/hallModularLayers.js` with:

```js
export const HALL_MODULAR_ENVIRONMENT_LAYERS = [
  {
    id: 'hall-wall-back',
    resourceName: 'juyiting-modular-hall-wall-back',
    src: '/juyiting/images/modular/hall-wall-back-v1.png',
    depth: 0,
    defaultX: 0,
    defaultY: 0,
    defaultScale: 1,
    kind: 'environment'
  },
  {
    id: 'hall-floor',
    resourceName: 'juyiting-modular-hall-floor',
    src: '/juyiting/images/modular/hall-floor-v1.png',
    depth: 1,
    defaultX: 0,
    defaultY: 420,
    defaultScale: 1,
    kind: 'environment'
  },
  {
    id: 'hall-pillars',
    resourceName: 'juyiting-modular-hall-pillars',
    src: '/juyiting/images/modular/hall-pillars-v1.png',
    depth: 6,
    defaultX: 0,
    defaultY: 0,
    defaultScale: 1,
    kind: 'environment'
  }
]

export const HALL_MODULAR_PROP_LAYERS = [
  {
    id: 'prop-main-seat',
    resourceName: 'juyiting-modular-prop-main-seat',
    src: '/juyiting/images/modular/prop-main-seat-v1.png',
    depth: 3,
    defaultX: 686,
    defaultY: 130,
    defaultScale: 1,
    kind: 'prop'
  },
  {
    id: 'prop-table-desk',
    resourceName: 'juyiting-modular-prop-table-desk',
    src: '/juyiting/images/modular/prop-table-desk-v1.png',
    depth: 4,
    defaultX: 690,
    defaultY: 455,
    defaultScale: 1,
    kind: 'prop'
  },
  {
    id: 'prop-bounty-board',
    resourceName: 'juyiting-modular-prop-bounty-board',
    src: '/juyiting/images/modular/prop-bounty-board-v1.png',
    depth: 3,
    defaultX: 1240,
    defaultY: 250,
    defaultScale: 1,
    kind: 'prop'
  },
  {
    id: 'prop-library-shelf',
    resourceName: 'juyiting-modular-prop-library-shelf',
    src: '/juyiting/images/modular/prop-library-shelf-v1.png',
    depth: 3,
    defaultX: 1220,
    defaultY: 455,
    defaultScale: 1,
    kind: 'prop'
  },
  {
    id: 'prop-roster-book',
    resourceName: 'juyiting-modular-prop-roster-book',
    src: '/juyiting/images/modular/prop-roster-book-v1.png',
    depth: 4,
    defaultX: 210,
    defaultY: 485,
    defaultScale: 1,
    kind: 'prop'
  },
  {
    id: 'prop-gate',
    resourceName: 'juyiting-modular-prop-gate',
    src: '/juyiting/images/modular/prop-gate-v1.png',
    depth: 2,
    defaultX: 688,
    defaultY: 650,
    defaultScale: 1,
    kind: 'prop'
  }
]

export const HALL_MODULAR_RENDER_LAYERS = HALL_MODULAR_ENVIRONMENT_LAYERS
  .concat(HALL_MODULAR_PROP_LAYERS)
  .slice()
  .sort((a, b) => a.depth - b.depth)

export const HALL_MODULAR_LAYER_RESOURCES = HALL_MODULAR_RENDER_LAYERS.map(layer => ({
  name: layer.resourceName,
  type: 'image',
  src: layer.src
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- --grep "Juyiting modular layer assets"
```

Expected: PASS.

- [ ] **Step 5: Commit manifest and tests**

```powershell
git add -- src/game/hallModularLayers.js tests/juyiting-modular-layer-assets.test.js
git commit -m "feat: add juyiting modular layer manifest"
```

Expected result: a commit containing only manifest and tests.

---

### Task 3: Document Prompts And Generation Provenance

**Files:**
- Create: `docs/juyiting/modular-layer-prompts.md`

- [ ] **Step 1: Create prompt provenance document**

Create `docs/juyiting/modular-layer-prompts.md` with:

```markdown
# Juyiting Modular Layer Prompts

## Provenance

These assets were generated as new modular images for the Juyiting hall. They were not cropped, masked, or copied from `public/juyiting/images/liangshan-hall-bg-v2.png`.

The image generation tool available in Codex was used for the asset generation step. The tool did not expose a selectable model identifier in the project code, so this document records the workflow rather than claiming a hard-coded model name.

## Output Directory

`public/juyiting/images/modular/`

## Asset List

- `hall-wall-back-v1.png`
- `hall-floor-v1.png`
- `hall-pillars-v1.png`
- `prop-main-seat-v1.png`
- `prop-table-desk-v1.png`
- `prop-bounty-board-v1.png`
- `prop-library-shelf-v1.png`
- `prop-roster-book-v1.png`
- `prop-gate-v1.png`

## Shared Prompt

Use case: stylized-concept
Asset type: modular 2.5D game scene asset for a Water Margin / Liangshan gathering hall
Style/medium: polished painterly game environment art, Chinese Song dynasty mountain stronghold hall, hand-painted but clean enough for UI/game use
Composition/framing: fixed 2.5D stage perspective, front-facing with a slight top-down angle, consistent camera across all assets
Lighting/mood: warm lantern-lit interior, heroic but practical hall atmosphere
Color palette: aged dark wood, muted red lacquer, worn gold accents, deep teal shadow notes, stone gray floor tones
Constraints: no people, no modern objects, no watermark, no logo, no readable text, no UI elements
Avoid: photorealistic photography, anime character focus, extreme fisheye perspective, heavy blur, random Chinese characters

## Transparency Workflow

Prop assets were generated on a flat chroma-key background and converted to alpha PNGs with the local chroma-key removal helper.
```

- [ ] **Step 2: Commit prompt documentation**

```powershell
git add -- docs/juyiting/modular-layer-prompts.md
git commit -m "docs: record juyiting modular asset prompts"
```

Expected result: documentation commit created.

---

### Task 4: Build Visual QA Preview

**Files:**
- Create: `public/juyiting/images/modular/preview.html`

- [ ] **Step 1: Create preview HTML**

Create `public/juyiting/images/modular/preview.html` with:

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Juyiting Modular Layer Preview</title>
  <style>
    body {
      margin: 0;
      background: #17110d;
      color: #f6e7c2;
      font-family: system-ui, sans-serif;
    }

    .stage {
      position: relative;
      width: min(100vw, 1672px);
      aspect-ratio: 1672 / 941;
      margin: 0 auto;
      overflow: hidden;
      background: #20150f;
    }

    .layer {
      position: absolute;
      display: block;
      user-select: none;
      pointer-events: none;
    }

    .wall { left: 0; top: 0; width: 100%; z-index: 0; }
    .floor { left: 0; top: 44%; width: 100%; z-index: 1; }
    .gate { left: 41%; top: 69%; width: 18%; z-index: 2; }
    .seat { left: 41%; top: 14%; width: 20%; z-index: 3; }
    .board { left: 74%; top: 26%; width: 15%; z-index: 3; }
    .shelf { left: 73%; top: 48%; width: 18%; z-index: 3; }
    .book { left: 13%; top: 52%; width: 13%; z-index: 4; }
    .desk { left: 41%; top: 48%; width: 21%; z-index: 4; }
    .pillars { left: 0; top: 0; width: 100%; z-index: 6; }

    .caption {
      max-width: 1672px;
      margin: 12px auto;
      padding: 0 16px 24px;
      font-size: 14px;
      line-height: 1.5;
      color: #d8c596;
    }
  </style>
</head>
<body>
  <main>
    <div class="stage">
      <img class="layer wall" src="./hall-wall-back-v1.png" alt="">
      <img class="layer floor" src="./hall-floor-v1.png" alt="">
      <img class="layer gate" src="./prop-gate-v1.png" alt="">
      <img class="layer seat" src="./prop-main-seat-v1.png" alt="">
      <img class="layer board" src="./prop-bounty-board-v1.png" alt="">
      <img class="layer shelf" src="./prop-library-shelf-v1.png" alt="">
      <img class="layer book" src="./prop-roster-book-v1.png" alt="">
      <img class="layer desk" src="./prop-table-desk-v1.png" alt="">
      <img class="layer pillars" src="./hall-pillars-v1.png" alt="">
    </div>
    <p class="caption">Modular generated asset preview. This file is for visual QA only.</p>
  </main>
</body>
</html>
```

- [ ] **Step 2: Open preview locally**

Open:

```text
public/juyiting/images/modular/preview.html
```

Expected: the nine generated assets appear as an assembled hall preview. Props are independently positioned by CSS and can be adjusted.

- [ ] **Step 3: Commit preview**

```powershell
git add -- public/juyiting/images/modular/preview.html
git commit -m "test: add juyiting modular asset preview"
```

Expected result: preview file committed.

---

### Task 5: Run Final Verification

**Files:**
- Verify: `tests/juyiting-modular-layer-assets.test.js`
- Verify: `src/game/hallModularLayers.js`
- Verify: `public/juyiting/images/modular/`

- [ ] **Step 1: Run focused modular tests**

```powershell
npm test -- --grep "Juyiting modular layer assets"
```

Expected: PASS.

- [ ] **Step 2: Run related Juyiting hall asset tests**

```powershell
npm test -- --grep "Juyiting hall scene assets|Juyiting modular layer assets"
```

Expected: PASS.

- [ ] **Step 3: Check git status**

```powershell
git status --short
```

Expected: no uncommitted files from this modular asset implementation except unrelated pre-existing workspace changes.

- [ ] **Step 4: Report final paths**

Report these paths to the user:

```text
public/juyiting/images/modular/
src/game/hallModularLayers.js
tests/juyiting-modular-layer-assets.test.js
docs/juyiting/modular-layer-prompts.md
public/juyiting/images/modular/preview.html
```

Expected: the user can inspect the generated image pack and preview.
