# Songjiang Sprite Direction Human Review

## Official review gate mapping

The required A/B/C review gate uses one locked character drawing and geometry:

- **Official Sample A** = exploration **Sample H**, the selected semi-realistic hand-painted Q-version direction.
- **Official Sample B** = a raster style transformation derived from official Sample A: cool muted traditional ink/wash treatment, softer and broken edge treatment, and reduced detail.
- **Official Sample C** = a raster style transformation derived from official Sample A: high-contrast clean animation/cel treatment, flatter palette, and simplified detail.

Official Samples B and C preserve Sample A's exact dimensions, pose, silhouette, body and costume geometry, camera, framing, and alpha-mask footprint. Exploration Samples J and K remain separate supplemental alternatives and are no longer mapped to official B or C. The remaining exploration files are also retained as supplemental review evidence.

## Scores

| Criterion | A | B | C |
| --- | ---: | ---: | ---: |
| Reads at game scale | 5 | 5 | 5 |
| Matches hall palette | 5 | 4 | 3 |
| Silhouette identifies Songjiang | 5 | 5 | 4 |
| Animation-ready costume detail | 5 | 4 | 5 |
Decision: Sample A
Approved by: Richow
Approved at: 2026-07-15T00:26:32+08:00

Sample A remains the approved H direction: semi-realistic hand-painted Q-version. Final production should strengthen the outline and simplify small details for approximately 66x66 CSS px presentation.

These images are review samples, not a final sprite sheet.

## Generation method

Sample A was created with built-in image generation followed by chroma-key removal to transparent PNG. Official Samples B and C were derived deterministically from Sample A through local raster color, tone, texture, edge, and detail transformations; no new character generation was used, and Sample A's alpha channel was preserved byte-for-byte.
