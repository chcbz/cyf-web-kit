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

The original decision and score block above remains the traceable style-direction decision.

## Target-scale size-only confirmation

- **Preview:** [`target-scale-preview.png`](target-scale-preview.png)
- **Confirmation scope:** Size only
- **Confirmed by:** Richow
- **Confirmed at:** 2026-07-15T21:52:40+08:00
- **Confirmed display:** Planned approximately 66x66 CSS-pixel in-map frame scale
- **Camera-angle status:** Resolved by the separately approved native 55-degree gate below

Richow confirmed the planned approximately 66x66 CSS-pixel display size independently of the camera-angle decision.

## Native 2.5D camera-angle confirmation

- **Comparison preview:** [`sample-a-2_5d-45-55-hall-preview-v1.png`](sample-a-2_5d-45-55-hall-preview-v1.png)
- **Selected transparent source:** [`sample-a-2_5d-55-v1.png`](sample-a-2_5d-55-v1.png)
- **Retained comparison source:** [`sample-a-2_5d-45-v1.png`](sample-a-2_5d-45-v1.png)
- **Decision:** Native 55-degree elevated three-quarter top-down 2.5D view
- **Confirmation scope:** Single-frame camera-angle gate
- **Approved by:** Richow
- **Approved at:** 2026-07-15T23:17:22+08:00
- **Runtime transform policy:** Native sprite artwork; no CSS skew, perspective, rotation, or substitute transform

Richow selected the 55-degree sample after reviewing the exact 66x66 hall comparison against the 45-degree alternative. This resolves the camera-angle correction required after the earlier size-only review.

Task 5 now records three distinct approvals: style direction A, the planned approximately 66x66 CSS-pixel target size, and the native 55-degree single-frame camera angle. These approvals complete the review evidence only. The final animated sprite sheet remains future Task 7 work and is not represented as delivered or approved here.

## Generation method

See [`generation.md`](generation.md) for the verbatim available built-in generation prompts and provenance limits. Run [`derive_review_assets.py`](derive_review_assets.py) to regenerate official B/C and the original target-scale preview, and run [`derive_camera_angle_preview.py`](derive_camera_angle_preview.py) to regenerate the 45-degree versus 55-degree hall comparison without modifying either transparent source artwork.
