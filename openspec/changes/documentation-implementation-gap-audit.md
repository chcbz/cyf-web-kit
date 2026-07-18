# Documentation Implementation Gap Audit

Date: 2026-07-18

This change document replaces legacy planning documents as the single backlog entry for features that were described in old documentation but are not fully implemented or not yet proven by code and tests.

## Audit Scope

- `docs/`
- `api/docs/`
- `web/jia-web-kit/docs/`

Root `docs/` is not a Git repository and the currently recovered files are not reliable audit sources: several Markdown files contain literal `\n` text instead of normal line breaks, and two original legacy plan files are missing. Items below rely on current source, tests, and Git-tracked documentation under `api/` and `web/jia-web-kit/`.

## Gaps

### API GraalVM Native Image Support

Status: partial.

Implemented evidence:

- GraalVM-safe utility paths exist in `api/common/jia-common-core/src/main/java/cn/jia/core/util/ClassUtil.java`.
- Native image resource files exist under `api/common/jia-common-starter/src/main/resources/META-INF/native-image/`.
- Some runtime reflection-sensitive code has been adjusted, for example `BaseDaoImpl` and `PayOrderParse`.

Remaining change:

- Add and verify the Gradle native build task/plugin.
- Run `nativeCompile` or equivalent native image build.
- Run the native executable and verify REST, WebSocket, database CRUD, and startup behavior.
- Generate and reconcile native-image-agent configuration if native coverage is still incomplete.

### Juyiting Autonomous Social World

Status: not implemented as designed.

Implemented evidence:

- Hall action intent metadata exists in chat/agent paths, including `HallActionIntent`, `HallActionDispatcher`, and `AgentActionIntentDTO`.
- Agent scene state APIs and tests exist for snapshot, events, and phase reporting.

Remaining change:

- Implement explicit world/social/autonomy/governance services if still required:
  `HallWorldService`, `HallSocialService`, `HallAutonomyService`, `HallCoordinationService`, and `SongjiangGovernanceService`.
- Add endpoints for `/juyiting/world/*`, `/juyiting/social/*`, `/juyiting/autonomy/*`, and `/juyiting/governance/*`, or formally retire those contracts.
- Add persisted relationship/event/action models if autonomous social behavior remains in scope.

### API Optimization Backlog

Status: mixed.

Implemented evidence:

- Sensitive response protection exists via `SensitiveDataSanitizer`, `SensitiveResponseBodyAdvice`, `AllowSensitiveOutput`, `SensitiveField`, and `JsonUtil.toSafeJson(...)`.
- Chat/WebSocket output has targeted safe JSON usage and tests.

Remaining change:

- Reassess broad optimization items as concrete tickets instead of preserving the old optimization document.
- Confirm whether interface-level permissions, data-scope permissions, audit logging, service-call standards, distributed transaction strategy, and multi-tenant strategy are still product requirements.

### Juyiting Multiplayer And Performance

Status: partial.

Implemented evidence:

- Movement engine metrics expose `queuedCommandCount` and `replanningCount`.
- Scene debug aggregation and bridge tests exist.
- Camera, input, TMX map, sprite, backend scene-state, and simulation integration tests exist.

Remaining change:

- Add a dedicated performance harness if multiplayer/performance guarantees are still required.
- Define measurable budgets for agent count, frame time, queue latency, and resync behavior.
- Add repeatable browser-level performance verification instead of relying only on unit/debug metrics.

### Songjiang Sprite Review Provenance

Status: partial cleanup.

Implemented evidence:

- Runtime sprite manifest and `public/juyiting/sprites/persona-sheets-v1/songjiang.png` exist.
- Sprite loader and validation tests cover manifest and image contracts.

Remaining change:

- Decide whether the old human-review image provenance is still needed.
- If retained, move it out of `docs`; otherwise delete it with the legacy documentation cleanup.

## Implemented Legacy Documentation Candidates

The following legacy documentation categories can be removed after dependency cleanup and focused verification:

- Web Juyiting camera/input, melonJS scene, TMX map, sprite pipeline, backend scene-state integration, and simulation plans.
- Web Juyiting public beta readiness/runbook text checks, after preflight no longer reads documentation content.
- API module/interface specs for modules where source controllers/services/tests already define the behavior.
- Superpowers plans/specs, except for the gap items consolidated above.

## Verification Required Before Deleting Legacy Docs

- `cd web/jia-web-kit && npm run validate:juyiting-map`
- `cd web/jia-web-kit && npm run validate:juyiting-sprites`
- `cd web/jia-web-kit && npm run test:run -- tests/juyiting-preflight-config.test.js tests/game/map/tmx-snapshot.test.ts`
- Focused API tests for sensitive response protection and Agent scene state.
- `git diff --check` in affected Git repositories.
