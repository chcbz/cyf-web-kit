# Juyiting Modular Layer Prompts

## Provenance

These assets were generated as new independent 2.5D scene assets for the Juyiting hall using image generation. They were not cropped, masked, or copied from `public/juyiting/images/liangshan-hall-bg-v2.png`. The `scripts/generate-juyiting-layer-assets.mjs` script was not used for this work.

The built-in image generation tool was used to generate each asset from standalone prompts. Props were generated on a flat chroma-key (#00ff00) background and converted locally to alpha-transparent PNGs with the chroma-key removal helper.

## Output Directory

`public/juyiting/images/modular/`

## Asset List

| File | Dimensions | Type |
|------|-----------|------|
| `hall-wall-back-v1.png` | 1672x941 | RGB environment |
| `hall-floor-v1.png` | 1672x941 | RGB environment |
| `hall-pillars-v1.png` | 1672x941 | RGB environment |
| `prop-main-seat-v1.png` | 1536x1024 | RGBA prop |
| `prop-table-desk-v1.png` | 1536x1024 | RGBA prop |
| `prop-bounty-board-v1.png` | 1536x1024 | RGBA prop |
| `prop-library-shelf-v1.png` | 1536x1024 | RGBA prop |
| `prop-roster-book-v1.png` | 1535x1024 | RGBA prop |

## Shared Prompt

```
Use case: stylized-concept
Asset type: modular 2.5D game scene asset for a Water Margin / Liangshan gathering hall
Style/medium: polished painterly game environment art, Chinese Song dynasty mountain stronghold hall, hand-painted but clean enough for UI/game use
Composition/framing: fixed 2.5D stage perspective, front-facing with a slight top-down angle, consistent camera across all assets
Lighting/mood: warm lantern-lit interior, heroic but practical hall atmosphere
Color palette: aged dark wood, muted red lacquer, worn gold accents, deep teal shadow notes, stone gray floor tones
Constraints: no people, no modern objects, no watermark, no logo, no readable text, no UI elements
Avoid: photorealistic photography, anime character focus, extreme fisheye perspective, heavy blur, random Chinese characters
```

## Per-Asset Prompts

### hall-wall-back-v1.png
```
Primary request: a modular back wall and rear hall backdrop for a Liangshan gathering hall, including timber wall sections, high beams, a central leadership alcove, side architectural details, and empty space where movable props can be placed later.
Scene/backdrop: rectangular full-width rear wall layer, no floor foreground.
Composition/framing: wide 1672:941 scene layer, front-facing 2.5D perspective.
```

### hall-floor-v1.png
```
Primary request: a modular empty hall floor for character placement, stone and worn wood floor surfaces suitable for a Liangshan gathering hall.
Scene/backdrop: rectangular full-width floor plane with subtle perspective lines and no furniture.
Composition/framing: wide 1672:941 lower scene layer, front-facing 2.5D perspective.
```

### hall-pillars-v1.png
```
Primary request: structural pillars and overhead beams for a Liangshan gathering hall, designed as an overlay layer with left, center, and right vertical supports.
Scene/backdrop: standalone structural layer with transparent-friendly empty negative space between pillars.
Composition/framing: wide 1672:941 overlay layer, front-facing 2.5D perspective.
```

### prop-main-seat-v1.png
```
Primary request: a commander's main wooden seat and raised platform for the leader of a Liangshan hall, ornate but rugged, dark carved wood with muted red and gold accents.
Subject: one standalone main seat prop.
Composition/framing: centered object, full object visible.
Chroma-key: flat solid #00ff00 background for removal.
```

### prop-table-desk-v1.png
```
Primary request: a central command table or desk for a Liangshan hall, heavy aged wood, scrolls and map-like blank papers without readable text, practical for strategy discussion.
Subject: one standalone desk prop.
Composition/framing: centered object, full object visible.
Chroma-key: flat solid #00ff00 background for removal.
```

### prop-bounty-board-v1.png
```
Primary request: a freestanding bounty and task board for a Liangshan hall, wooden frame, pinned blank parchment shapes with no readable text.
Subject: one standalone board prop.
Composition/framing: centered object, full object visible.
Chroma-key: flat solid #00ff00 background for removal.
```

### prop-library-shelf-v1.png
```
Primary request: an archive shelf and document cabinet for a Liangshan hall, aged wooden shelves, scroll tubes, bundled documents, no readable text.
Subject: one standalone shelf prop.
Composition/framing: centered object, full object visible.
Chroma-key: flat solid #00ff00 background for removal.
```

### prop-roster-book-v1.png
```
Primary request: an oversized agent roster book on a small lectern, suitable for a Liangshan hall, open blank pages with no readable text.
Subject: one standalone roster book and lectern prop.
Composition/framing: centered object, full object visible.
Chroma-key: flat solid #00ff00 background for removal.
```


## Transparency Workflow

Prop assets were generated on a flat chroma-key (#00ff00) background and converted to alpha PNGs with:

```
remove_chroma_key.py --input <source> --out <final.png> --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
```

## Current Runtime Contract

`hall.tmx` is the runtime source of truth for map images, tile layers, and prop tile images. The removed gate prop is no longer generated, loaded, or rendered. Do not add map-layer manifests in JS; add or remove scene art in TMX instead.
