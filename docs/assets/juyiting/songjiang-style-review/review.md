# Songjiang Sprite Direction Human Review

## Official review gate mapping

The required A/B/C review gate uses one locked character drawing and geometry:

- **Official Sample A** = the canonical committed copy of the selected exploration **Sample H** direction; the duplicate exploration binary is intentionally omitted from this release review directory.
- **Official Sample B** = a raster style transformation derived from official Sample A: cool muted traditional ink/wash treatment, softer and broken edge treatment, and reduced detail.
- **Official Sample C** = a raster style transformation derived from official Sample A: high-contrast clean animation/cel treatment, flatter palette, and simplified detail.

Official Samples B and C preserve Sample A's exact dimensions, pose, silhouette, body and costume geometry, camera, framing, and alpha-mask footprint. Superseded exploration binaries D-K are excluded from the release review directory so the official evidence set is unambiguous.

## Scores

| Criterion | A | B | C |
| --- | ---: | ---: | ---: |
| Reads at game scale | 5 | 5 | 5 |
| Matches hall palette | 5 | 4 | 3 |
| Silhouette identifies Songjiang | 5 | 5 | 4 |
| Animation-ready costume detail | 5 | 4 | 5 |
Decision: Sample A
Approved by: Richow
Approved at: 2026-07-15T06:37:59+08:00

This approval records Richow's explicit re-review of the revised official A/B/C; the selection and scores are unchanged.

Sample A remains the approved H direction: semi-realistic hand-painted Q-version. Final production should strengthen the outline and simplify small details for approximately 66x66 CSS px presentation.

These images are review samples, not a final sprite sheet.

## Target-scale evidence

[`target-scale-preview.png`](target-scale-preview.png) composites official A/B/C onto the actual `public/juyiting/images/liangshan-hall-base-clean-v3.png` hall artwork. It includes multiple static A placements, a side-by-side A/B/C comparison in exact 66x66 CSS-pixel review frames, and a clearly separated 3x nearest-neighbor inspection strip. The preview is static review evidence and does not represent or imply animation.

The original decision and score block above remains the traceable style-direction decision. **Final target-scale confirmation is pending Richow after this preview artifact is shown; this review does not claim final production readiness.**

## Generation method

See [`generation.md`](generation.md) for the verbatim available built-in generation prompt and provenance limits. Run [`derive_review_assets.py`](derive_review_assets.py) to deterministically regenerate official B/C and the target-scale preview from canonical Sample A and the committed hall image. The script preserves Sample A's alpha channel byte-for-byte for B/C and documents every resize/compositing rule.
