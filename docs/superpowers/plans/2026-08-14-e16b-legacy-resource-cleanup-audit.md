# E16B Legacy Resource/Reference Cleanup — Audit Record

**Task:** E16B mechanical cleanup of the signed legacy resource candidates below.
**Result:** No deletions. All candidates are retained because each is locked by the E1
fail-closed public-tree provenance gate (or has live runtime references). Deleting any of
them would require rewriting the frozen baseline / canonical-SHA / TMX contract, which is
prohibited for this task ("don't update historical baseline fixtures to mask deletions").

## Reference closure (git grep/rg, TMX parser, tests, asset scripts, build)

### Candidate 1 — `public/juyiting/images/modular/` (preview.html + 8 superseded *-v1.png)
- No runtime loader reference (asset report category `dev-preview-modular`).
- References that block deletion:
  - E1 frozen public tree (commit `2424f51f…`, 27-file gate): all 9 files are members.
    `assertCurrentPublicTreeVsE1('public', …)` in `tests/juyiting-occlusion-baseline.test.js`
    runs against the live tree and fails closed on any missing baseline file.
  - `tests/juyiting-modular-layer-assets.test.js` reads `preview.html` and asserts content.
  - `tests/juyiting-occlusion-baseline.test.js` uses `preview.html` as the frozen-file
    deletion/drift probe (deleting it must fail the gate).
  - `scripts/juyiting/asset-report-juyiting.mjs` ASSET_CATEGORY_RULES and the committed
    `tests/fixtures/juyiting/occlusion-v0/asset-report.json` classify/list these files.

### Candidate 2 — `public/juyiting/tiles/hall-tileset.json` + `hall-tileset.png`
- No runtime loader reference (asset report category `unreferenced-legacy`).
- References that block deletion:
  - E1 frozen public tree (both files are members of the 27-file gate).
  - `tests/juyiting-occlusion-baseline.test.js:1294` asserts the files exist and are
    classified `unreferenced-legacy` with `runtimeReferenced=false`.
  - `scripts/juyiting/asset-report-juyiting.mjs` ASSET_CATEGORY_RULES +
    `tests/fixtures/juyiting/occlusion-v0/asset-report.json`.
  - Generation scripts still reference them: `scripts/generate-hall-layout.cjs`
    (emits `<tileset name="hall-tileset">` + `tiles/hall-tileset.png`) and
    `scripts/generate-procedural-tiles.cjs` (writes `hall-tileset.png/json`).

### Candidate 3 — `public/juyiting/images/liangshan-hall-foreground-occluders-v3.webp`
- Byte-identical duplicate of `liangshan-hall-mid-occluders-v3.webp` (same md5/git blob),
  but it is a **live production asset**, not deletable:
  - `public/juyiting/hall.tmx` imagelayer id=10 `foreground-occluders` (TMX SHA is locked
    by `E8B_LIVE_TMX_SHA256` in `scripts/juyiting/lib/baseline-provenance.mjs`).
  - Runtime depth band: `src/game/scenes/HallScene.js` (`foreground-occluders`: 5) and
    `src/game/occlusion/hallSceneDepthBands.js` `HALL_SCENE_LEGACY_OCCLUDER_LAYERS`.
  - Canonical SHA gate: `scripts/juyiting/hash-juyiting-sources.mjs` reads it and records it
    in `source-hashes.json` as `duplicate-occluder`.
  - E13 offline evidence: `scripts/juyiting/e13/lib/contact-sheets.mjs` foreground layer.
  - Error-state stack + runtime tests: `tests/juyiting-hall-assets.test.js`,
    `tests/juyiting-hall-scene-runtime.test.js`, `tests/juyiting-melon-hall-scene.test.js`,
    `tests/game/map/tmx-snapshot.test.ts`, `tests/game/occlusion/hallscene-e15.test.ts`,
    and the occlusion-v0 fixtures.
- Verdict per task: cannot safely sync-clean declarations without breaking the E8B TMX
  lock, canonical SHA gates, E13 evidence, and fixed error-state integrity → retained.

## Verification performed on HEAD `928e30a` (clean tree)

- `tests/juyiting-modular-layer-assets.test.js` — 2 passing.
- `tests/juyiting-tiled-map.test.js` + `tests/juyiting-hall-assets.test.js` — 13 passing.
- `tests/juyiting-melon-hall-scene.test.js` — 37 passing.
- `tests/juyiting-hall-scene-runtime.test.js` — 14 passing.
- `npm run validate:juyiting-map` — valid. `npm run validate:juyiting-sprites` — valid.
- `npm run build` (vite) — success.
- dist 404 checklist — all 21 unique paths referenced by hall.tmx (9 image sources +
  37 assetRef occluder fragments) and the 6 sprite-manifest srcs exist under `dist/`; 0 missing.
- Note: `tests/juyiting-occlusion-baseline.test.js` and the git-based verifiers
  (`inventory/hash/asset`) cannot execute in this sandbox (node→git spawn is blocked with
  EPERM; headless Chromium is unavailable for the E9A/E9B raster gates). Their static
  contract is unambiguous: every candidate is a member of the frozen E1 tree, and the
  fail-closed gate throws on any baseline-file deletion.

## Conclusion

Deleted files: none. Retained: all 12 signed candidate files, with the rationale above.
