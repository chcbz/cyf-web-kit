# Juyiting Modular Layer Assets Design

## Goal

Create a new modular asset pack for the Juyiting hall scene so the hall layout can be freely repositioned and rearranged in melonJS. The new pack is not a crop of `liangshan-hall-bg-v2.png`; it is a newly generated set of independent 2.5D stage-perspective PNG assets.

## Confirmed Direction

- Scope: core scene pack only.
- Visual style: a fully rebuilt modular Water Margin / Liangshan gathering hall.
- Perspective: fixed 2.5D stage view, front-facing with a slight top-down angle.
- Size target: project-ready dimensions based on the current hall scene proportions.
- Storage: add new versioned assets without replacing existing generated or extracted layers.

## Asset Set

The first version contains nine assets:

| Asset | Purpose |
| --- | --- |
| `hall-wall-back-v1.png` | Back wall and main hall backdrop layer |
| `hall-floor-v1.png` | Floor layer for character placement |
| `hall-pillars-v1.png` | Structural pillars and beams |
| `prop-main-seat-v1.png` | Main leader seat |
| `prop-table-desk-v1.png` | Central table or command desk |
| `prop-bounty-board-v1.png` | Bounty/task board |
| `prop-library-shelf-v1.png` | Archive shelf / document cabinet |
| `prop-roster-book-v1.png` | Agent roster / roll book prop |
| `prop-gate-v1.png` | Entrance gate or doorway |

## Output Location

Generated project assets go under:

```text
public/juyiting/images/modular/
```

The existing files under `public/juyiting/images/` and `public/juyiting/images/props/` stay untouched. The modular pack can be tested in parallel with the current layer extraction workflow.

## Image Generation Workflow

Use the built-in image generation path for each asset. Each generated prop should be prompted as a standalone game scene object with a flat chroma-key background, then converted locally to a transparent PNG.

For large environmental layers such as the wall and floor, generation may use a flat removable background when possible, but these layers can also remain rectangular scene layers if transparency is not useful. Props must have alpha transparency.

Constraints for all generated assets:

- Same 2.5D camera angle.
- Same warm interior hall lighting.
- No text, watermark, logo, or modern objects.
- No embedded characters.
- No cast shadow baked onto the chroma-key background for props.
- Generous padding around standalone props before alpha cleanup.

## Manifest Design

Add a manifest module after assets are generated:

```text
src/game/hallModularLayers.js
```

The manifest should describe each layer with stable metadata:

```js
{
  id: 'prop-main-seat',
  src: '/juyiting/images/modular/prop-main-seat-v1.png',
  depth: 4,
  defaultX: 0,
  defaultY: 0,
  defaultScale: 1,
  kind: 'prop'
}
```

Initial `defaultX`, `defaultY`, and `defaultScale` values should be tuned after visual inspection against the current scene dimensions.

## Integration Boundary

This design does not replace the current `hallSceneLayers.js` path immediately. The modular pack should be introduced as a separate asset set so the project can compare:

- current extracted-mask layers
- new modular generated assets

A later implementation can add a feature flag or scene mode switch if both need to remain available at runtime.

## Testing And Validation

Validation should cover:

- Every generated PNG exists in `public/juyiting/images/modular/`.
- Prop PNGs contain alpha transparency.
- Asset dimensions are plausible for the current hall coordinate space.
- Manifest paths resolve to existing files.
- No existing hall assets are overwritten.

Visual QA should include a quick assembled preview of the nine assets using the planned default positions before wiring them into runtime behavior.

## Open Decisions Deferred To Implementation

- Exact pixel dimensions per asset.
- Final default positions and scales.
- Whether rectangular wall and floor layers should use transparency or remain full-frame images.
- Whether a runtime toggle is needed immediately or only after visual QA.
