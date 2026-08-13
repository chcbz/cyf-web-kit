# E16B Legacy Resource/Reference Cleanup — Final Audit

**Task:** E16B mechanical cleanup of signed legacy resource candidates.

**Result:** deleted files = **0**. Production no longer references the duplicate foreground
WebP path; the frozen duplicate file remains only because it is part of the accepted E1
public-tree provenance. Historical E1/E8B/E10A anchors were not rewritten.

## Implemented production cleanup

- `public/juyiting/hall.tmx` keeps the `foreground-occluders` layer name and depth contract,
  but its image source now reuses the canonical
  `images/liangshan-hall-mid-occluders-v3.webp`.
- Current live TMX SHA-256:
  `885471a17ac080d4d766f3e86c69836bcac8ba66b9cab125a6ca3ac978d82d9f`.
- `src/game/occlusion/hallSceneAssembly.ts` and current/live provenance checks use this
  E16B hash. The historical E8B hash remains unchanged.
- The E10B mask manifest keeps its historical `baselineSha256` and records the E16B file
  in `currentSha256`; E11 current-state calibration evidence was regenerated against the
  final manifest, live TMX, and current contract hashes.
- Runtime TMX resource closure contains no reference to
  `liangshan-hall-foreground-occluders-v3.webp`.
- The `foreground-occluders` layer itself remains intentionally present for the V1/error-state
  fallback depth contract. During normal V2 operation both legacy full-map occluder layers are
  detached; retaining the named layer does not add a V2 draw.

## Retained frozen resources

### `public/juyiting/images/modular/` (preview + 8 `*-v1.png`)

No runtime loader reference, but all nine files are members of the accepted E1 27-file
public tree. Deletion would invalidate the historical fail-closed E1 provenance gate.

### `public/juyiting/tiles/hall-tileset.json` and `hall-tileset.png`

No runtime loader reference. Both remain E1 frozen-tree members and are also referenced by
legacy generation tooling. They are retained as provenance/tooling inputs, not production
runtime resources.

### `public/juyiting/images/liangshan-hall-foreground-occluders-v3.webp`

The file is byte-identical to the canonical mid occluder and remains an E1 frozen-tree
member. It is retained solely as historical provenance. Production `hall.tmx` no longer
references it. Historical V0/E13 evidence may continue naming it because those records
capture their accepted inputs; this does not place it in the current production resource
closure.

## Verification evidence

- Map validation: PASS; sprite manifest validation: PASS.
- E10B current manifest/navigation validation: PASS (37 bindings, 32 fragments, 111 probes).
- E11 calibration suite: 55 passing.
- Current TMX/asset/runtime/E13 targeted suites: 88 passing.
- HallScene E12/E15 integration and rollback suites: 131 passing.
- Production build: PASS; neither source nor built `hall.tmx` references the duplicate
  foreground WebP path.
- Restricted Chromium E14 gate: PASS, p95 1.5 ms, p99 1.8 ms, no full-grid scan.
- The Git-backed E1 baseline Mocha suite cannot complete inside the Codex sandbox because
  Node child-process calls receive a synthetic `EPERM` (and `git cat-file --batch` can
  hang) even when the child reports status 0. The equivalent frozen-tree comparison was
  therefore executed with shell-level Git/archive evidence; no result is reported as a
  Mocha pass.

## Exit-gate interpretation

E16B's safe cleanup boundary is:

1. do not delete or rewrite E1 frozen-tree members;
2. do not relabel historical E8B/E10A provenance as current;
3. remove the duplicate path from current production references;
4. maintain a separate current/live TMX anchor and regenerate current-state dependent
   manifests/reports.

This satisfies “production build does not reference duplicate resources” without hiding a
historical deletion by modifying accepted baseline fixtures.
