# Juyiting Phase 1 Backend Scene State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tenant-scoped Juyiting scene snapshots, resumable SSE deltas, semantic state persistence, and idempotent arrived/blocked phase reporting without storing coordinates or paths.

**Architecture:** A dedicated `AgentSceneService` contract keeps scene state separate from the existing broad `AgentService`. Core owns DTOs/entities/constants, mapper owns scoped persistence, service owns versioning/idempotency and Reactor broadcasting, and the controller exposes REST/SSE under `/agent/scenes`.

**Tech Stack:** Java 17, Spring Boot, Reactor Flux/Sinks, MyBatis-style DAO/mapper, MySQL, JUnit 5, Mockito, Gradle.

---

## File map

- Create `jia-agent-api/.../AgentSceneService.java`.
- Create core DTOs/entities/constants for snapshot, state, event and phase report.
- Create mapper interfaces/implementations for scene state, event and phase report.
- Modify `db/schema.sql` and `AgentSchemaInitializer` tests.
- Create `AgentSceneEventBroker`, `AgentSceneServiceImpl`, and `AgentSceneController`.
- Modify domain operations in `AgentServiceImpl` to write semantic state through the scene service, not through the controller.

### Task 1: Define API contracts and core models

**Files:**
- Modify: `api/agent/jia-agent-api/build.gradle`
- Modify: `api/agent/jia-agent-service/build.gradle`
- Create: `api/agent/jia-agent-api/src/main/java/cn/jia/agent/service/AgentSceneService.java`
- Create: `api/agent/jia-agent-core/src/main/java/cn/jia/agent/common/AgentSceneConstants.java`
- Create: `api/agent/jia-agent-core/src/main/java/cn/jia/agent/entity/AgentSceneStateDTO.java`
- Create: `api/agent/jia-agent-core/src/main/java/cn/jia/agent/entity/AgentSceneSnapshotDTO.java`
- Create: `api/agent/jia-agent-core/src/main/java/cn/jia/agent/entity/AgentSceneEventDTO.java`
- Create: `api/agent/jia-agent-core/src/main/java/cn/jia/agent/entity/AgentScenePhaseReportDTO.java`
- Create: `api/agent/jia-agent-core/src/main/java/cn/jia/agent/entity/AgentScenePhaseResultDTO.java`
- Test: `api/agent/jia-agent-service/src/test/java/cn/jia/agent/service/AgentSceneContractTest.java`

- [ ] **Step 1: Write failing reflection/serialization tests**

```java
@Test
void snapshotContractContainsSemanticStateOnly() {
    AgentSceneStateDTO state = new AgentSceneStateDTO();
    state.setAgentId("agent-songjiang");
    state.setTargetRegionId("council-table");
    assertFalse(Arrays.stream(state.getClass().getDeclaredFields())
            .map(Field::getName).anyMatch(name -> Set.of("x", "y", "path", "frame").contains(name)));
}

@Test
void phaseContractAcceptsOnlyArrivedAndBlocked() {
    assertEquals(Set.of("arrived", "blocked"), AgentSceneConstants.PHASES);
}
```

- [ ] **Step 2: Verify failure**

Run: `./gradlew :agent:jia-agent-service:test --tests cn.jia.agent.service.AgentSceneContractTest`

Expected: compilation fails because scene contracts do not exist.

- [ ] **Step 3: Implement exact service contract**

Add Reactor dependencies managed by the repository dependency platform:

```gradle
// jia-agent-api/build.gradle
api 'io.projectreactor:reactor-core'

// jia-agent-service/build.gradle
testImplementation 'io.projectreactor:reactor-test'
```

```java
public interface AgentSceneService {
    AgentSceneSnapshotDTO snapshot(String sceneId);
    Flux<AgentSceneEventDTO> events(String sceneId, long sinceVersion);
    AgentScenePhaseResultDTO reportPhase(String sceneId, AgentScenePhaseReportDTO request);
    AgentSceneStateDTO upsertState(String sceneId, AgentSceneStateDTO state);
}
```

Use `SCENE_JUYITING_MAIN = "juyiting-main"`, `PHASES = Set.of("arrived", "blocked")`, and result values `accepted`, `ignored_stale`, `ignored_duplicate`. State fields are exactly `agentId`, `personaCode`, `behavior`, `originRegionId`, `targetRegionId`, `relatedType`, `relatedId`, `phase`, `stateVersion`, `startedAt`, `expectedArrivalAt`, and `expiresAt`. Snapshot adds `sceneId`, `sceneVersion`, `generatedAt`, `agents`, and `states`.

- [ ] **Step 4: Run contract tests**

Run: `./gradlew :agent:jia-agent-service:test --tests cn.jia.agent.service.AgentSceneContractTest`

Expected: PASS.

- [ ] **Step 5: Commit in the backend repository**

```powershell
cd D:\workspace\chcbz\project\jia\api
git add agent/jia-agent-api agent/jia-agent-core agent/jia-agent-service/src/test/java/cn/jia/agent/service/AgentSceneContractTest.java
git commit -m "feat: define agent scene state contracts"
```

### Task 2: Add scoped persistence schema and mapper layer

**Files:**
- Create: `api/agent/jia-agent-core/src/main/java/cn/jia/agent/entity/AgentSceneStateEntity.java`
- Create: `api/agent/jia-agent-core/src/main/java/cn/jia/agent/entity/AgentSceneEventEntity.java`
- Create: `api/agent/jia-agent-core/src/main/java/cn/jia/agent/entity/AgentScenePhaseReportEntity.java`
- Create: `api/agent/jia-agent-mapper/src/main/java/cn/jia/agent/mapper/AgentSceneStateMapper.java`
- Create: `api/agent/jia-agent-mapper/src/main/java/cn/jia/agent/mapper/AgentSceneEventMapper.java`
- Create: `api/agent/jia-agent-mapper/src/main/java/cn/jia/agent/mapper/AgentScenePhaseReportMapper.java`
- Create: `api/agent/jia-agent-mapper/src/main/java/cn/jia/agent/dao/AgentSceneStateDao.java`
- Create: `api/agent/jia-agent-mapper/src/main/java/cn/jia/agent/dao/AgentSceneEventDao.java`
- Create: `api/agent/jia-agent-mapper/src/main/java/cn/jia/agent/dao/AgentScenePhaseReportDao.java`
- Create corresponding `dao/impl/*DaoImpl.java`
- Modify: `api/agent/jia-agent-mapper/src/main/resources/db/schema.sql`
- Modify: `api/agent/jia-agent-service/src/main/java/cn/jia/agent/config/AgentSchemaInitializer.java`
- Modify: `api/agent/jia-agent-service/src/test/java/cn/jia/agent/config/AgentSchemaInitializerTest.java`

- [ ] **Step 1: Add failing schema assertions**

```java
assertTrue(schema.contains("CREATE TABLE IF NOT EXISTS agent_scene_state"));
assertTrue(schema.contains("UNIQUE KEY uk_agent_scene_state_scope_agent"));
assertTrue(schema.contains("CREATE TABLE IF NOT EXISTS agent_scene_event"));
assertTrue(schema.contains("CREATE TABLE IF NOT EXISTS agent_scene_phase_report"));
assertFalse(schema.matches("(?s).*agent_scene_state.*\\b(x|y|path|frame_index)\\b.*"));
```

- [ ] **Step 2: Verify failure**

Run: `./gradlew :agent:jia-agent-service:test --tests cn.jia.agent.config.AgentSchemaInitializerTest`

Expected: FAIL because tables are absent.

- [ ] **Step 3: Add tables with tenant scope and versions**

```sql
CREATE TABLE IF NOT EXISTS agent_scene_state (
  id BIGINT NOT NULL AUTO_INCREMENT,
  scene_id VARCHAR(100) NOT NULL,
  agent_id VARCHAR(100) NOT NULL,
  persona_code VARCHAR(50) NOT NULL,
  behavior VARCHAR(50) NOT NULL,
  origin_region_id VARCHAR(100) DEFAULT NULL,
  target_region_id VARCHAR(100) NOT NULL,
  related_type VARCHAR(50) DEFAULT NULL,
  related_id VARCHAR(100) DEFAULT NULL,
  phase VARCHAR(20) NOT NULL,
  state_version BIGINT NOT NULL,
  started_at BIGINT NOT NULL,
  expected_arrival_at BIGINT DEFAULT NULL,
  expires_at BIGINT DEFAULT NULL,
  tenant_id VARCHAR(50) NOT NULL,
  client_id VARCHAR(50) NOT NULL,
  create_time BIGINT DEFAULT NULL,
  update_time BIGINT DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_agent_scene_state_scope_agent (tenant_id, client_id, scene_id, agent_id),
  KEY idx_agent_scene_state_scope_version (tenant_id, client_id, scene_id, state_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`agent_scene_event` has a unique `(tenant_id, client_id, scene_id, scene_version)` and stores safe event JSON; `agent_scene_phase_report` has unique `(tenant_id, client_id, scene_id, report_id)` and stores phase/result/version/timestamps. DAO methods always require tenant ID and client ID parameters.

- [ ] **Step 4: Run schema and layering tests**

Run:

```powershell
.\gradlew :agent:jia-agent-service:test --tests cn.jia.agent.config.AgentSchemaInitializerTest
.\gradlew validateLayering
```

Expected: both successful.

- [ ] **Step 5: Commit**

```powershell
git add agent/jia-agent-core agent/jia-agent-mapper agent/jia-agent-service/src/main/java/cn/jia/agent/config/AgentSchemaInitializer.java agent/jia-agent-service/src/test/java/cn/jia/agent/config/AgentSchemaInitializerTest.java
git commit -m "feat: persist scoped agent scene state"
```

### Task 3: Implement monotonic state and scene versions

**Files:**
- Create: `api/agent/jia-agent-service/src/main/java/cn/jia/agent/service/impl/AgentSceneServiceImpl.java`
- Test: `api/agent/jia-agent-service/src/test/java/cn/jia/agent/service/impl/AgentSceneServiceImplTest.java`

- [ ] **Step 1: Write failing version and scope tests**

```java
@Test
void upsertIncrementsStateAndSceneVersionsWithinCurrentScope() {
    when(stateDao.findByAgent("tenant-a", "client-a", "juyiting-main", "agent-songjiang"))
            .thenReturn(existingState(16L));
    when(eventDao.nextSceneVersion("tenant-a", "client-a", "juyiting-main")).thenReturn(129L);
    AgentSceneStateDTO result = service.upsertState("juyiting-main", request());
    assertEquals(17L, result.getStateVersion());
    verify(stateDao).save(argThat(entity -> entity.getStateVersion() == 17L));
    verify(eventDao).insert(argThat(entity -> entity.getSceneVersion() == 129L));
}
```

Also test another tenant's state is never returned and a persona already bound to a different real agent is rejected.

- [ ] **Step 2: Verify failure**

Run: `./gradlew :agent:jia-agent-service:test --tests cn.jia.agent.service.impl.AgentSceneServiceImplTest`

Expected: FAIL because service implementation is absent.

- [ ] **Step 3: Implement transactional upsert/snapshot**

Resolve `tenantId` from `EsContext.jiacn` and `clientId` from `EsContext.clientId`, rejecting blank scope rather than defaulting across tenants. In one transaction: lock current state, assign next state version, assign next scene version, upsert state, insert safe event, and publish only after persistence succeeds. `snapshot()` returns current visible agents and nonexpired semantic states ordered by agent ID.

- [ ] **Step 4: Run service tests**

Run: `./gradlew :agent:jia-agent-service:test --tests cn.jia.agent.service.impl.AgentSceneServiceImplTest`

Expected: PASS for monotonic versions, single current state, persona uniqueness, expiry, and tenant isolation.

- [ ] **Step 5: Commit**

```powershell
git add agent/jia-agent-service/src/main/java/cn/jia/agent/service/impl/AgentSceneServiceImpl.java agent/jia-agent-service/src/test/java/cn/jia/agent/service/impl/AgentSceneServiceImplTest.java
git commit -m "feat: manage versioned agent scene state"
```

### Task 4: Add resumable SSE broker

**Files:**
- Create: `api/agent/jia-agent-service/src/main/java/cn/jia/agent/service/AgentSceneEventBroker.java`
- Test: `api/agent/jia-agent-service/src/test/java/cn/jia/agent/service/AgentSceneEventBrokerTest.java`
- Modify: `api/agent/jia-agent-service/src/main/java/cn/jia/agent/service/impl/AgentSceneServiceImpl.java`

- [ ] **Step 1: Write failing broker tests**

```java
StepVerifier.create(broker.stream(scope, 128L).take(1))
        .then(() -> broker.publish(scope, event(129L)))
        .assertNext(event -> assertEquals(129L, event.getSceneVersion()))
        .verifyComplete();

assertTrue(service.events("juyiting-main", 120L).collectList().block()
        .stream().allMatch(event -> event.getSceneVersion() > 120L));
```

- [ ] **Step 2: Verify failure**

Run: `./gradlew :agent:jia-agent-service:test --tests cn.jia.agent.service.AgentSceneEventBrokerTest`

Expected: FAIL because broker is absent.

- [ ] **Step 3: Implement backlog plus live stream**

Use a `ConcurrentHashMap<SceneScope, EventSink>` and `Sinks.many().multicast().directBestEffort()`. `events(sceneId, sinceVersion)` first reads persisted events after `sinceVersion`, then concatenates the live scoped stream filtered to newer versions. If requested version is older than retained history, emit one `resync-required` event containing only the current scene version.

- [ ] **Step 4: Run broker tests**

Run: `./gradlew :agent:jia-agent-service:test --tests cn.jia.agent.service.AgentSceneEventBrokerTest`

Expected: PASS for backlog, live delivery, tenant isolation, subscriber cleanup and resync-required.

- [ ] **Step 5: Commit**

```powershell
git add agent/jia-agent-service/src/main/java/cn/jia/agent/service/AgentSceneEventBroker.java agent/jia-agent-service/src/main/java/cn/jia/agent/service/impl/AgentSceneServiceImpl.java agent/jia-agent-service/src/test/java/cn/jia/agent/service/AgentSceneEventBrokerTest.java
git commit -m "feat: stream resumable agent scene events"
```

### Task 5: Implement idempotent phase reporting

**Files:**
- Modify: `api/agent/jia-agent-service/src/main/java/cn/jia/agent/service/impl/AgentSceneServiceImpl.java`
- Modify: `api/agent/jia-agent-service/src/test/java/cn/jia/agent/service/impl/AgentSceneServiceImplTest.java`

- [ ] **Step 1: Add failing phase tests**

```java
assertEquals("accepted", service.reportPhase(sceneId, report("r1", 17L, "arrived")).getResult());
assertEquals("ignored_duplicate", service.reportPhase(sceneId, report("r1", 17L, "arrived")).getResult());
assertEquals("ignored_stale", service.reportPhase(sceneId, report("r2", 16L, "blocked")).getResult());
verify(stateDao, never()).overwriteNewerState(any());
```

- [ ] **Step 2: Verify failure**

Run: `./gradlew :agent:jia-agent-service:test --tests cn.jia.agent.service.impl.AgentSceneServiceImplTest`

Expected: FAIL because reporting is not implemented.

- [ ] **Step 3: Implement report rules**

Validate report ID, agent ID, state version, phase and region ID. Insert report under the unique scope key; duplicate key returns `ignored_duplicate`. Compare against current state version; older returns `ignored_stale`. Accepted reports update only the matching version's phase metadata and never replace a newer semantic state.

- [ ] **Step 4: Run tests**

Run: `./gradlew :agent:jia-agent-service:test --tests cn.jia.agent.service.impl.AgentSceneServiceImplTest`

Expected: PASS for accepted, stale, duplicate, invalid phase and cross-tenant attempts.

- [ ] **Step 5: Commit**

```powershell
git add agent/jia-agent-service/src/main/java/cn/jia/agent/service/impl/AgentSceneServiceImpl.java agent/jia-agent-service/src/test/java/cn/jia/agent/service/impl/AgentSceneServiceImplTest.java
git commit -m "feat: accept idempotent agent scene phases"
```

### Task 6: Expose snapshot, SSE and phase endpoints

**Files:**
- Create: `api/agent/jia-agent-service/src/main/java/cn/jia/agent/api/AgentSceneController.java`
- Create: `api/agent/jia-agent-service/src/test/java/cn/jia/agent/api/AgentSceneControllerTest.java`

- [ ] **Step 1: Write failing controller tests**

```java
assertEquals(MediaType.TEXT_EVENT_STREAM_VALUE,
        AgentSceneController.class.getMethod("events", String.class, long.class)
                .getAnnotation(GetMapping.class).produces()[0]);
assertTrue(controller.events("juyiting-main", 128L).blockFirst().contains("id: 129"));
assertTrue(controller.events("juyiting-main", 128L).blockFirst().contains("event: agent-scene-state-updated"));
```

- [ ] **Step 2: Verify failure**

Run: `./gradlew :agent:jia-agent-service:test --tests cn.jia.agent.api.AgentSceneControllerTest`

Expected: FAIL because controller is absent.

- [ ] **Step 3: Implement endpoint mappings**

```java
@RestController
@RequestMapping("/agent/scenes")
@RequiredArgsConstructor
public class AgentSceneController {
    private final AgentSceneService sceneService;

    @GetMapping("/{sceneId}/snapshot")
    public Object snapshot(@PathVariable String sceneId) {
        return JsonResult.success(sceneService.snapshot(sceneId));
    }

    @GetMapping(value = "/{sceneId}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> events(@PathVariable String sceneId,
            @RequestParam(defaultValue = "0") long sinceVersion) {
        return sceneService.events(sceneId, sinceVersion).map(AgentSceneController::formatSse);
    }

    @PostMapping("/{sceneId}/phases")
    public Object phase(@PathVariable String sceneId, @RequestBody AgentScenePhaseReportDTO request) {
        return JsonResult.success(sceneService.reportPhase(sceneId, request));
    }
}
```

`formatSse` emits `id`, `event`, and one safe JSON `data` line followed by two newlines. Never include tokens, API keys, stack traces, chat text or raw entity fields.

- [ ] **Step 4: Run controller tests**

Run: `./gradlew :agent:jia-agent-service:test --tests cn.jia.agent.api.AgentSceneControllerTest`

Expected: PASS with exact routes and content type.

- [ ] **Step 5: Commit**

```powershell
git add agent/jia-agent-service/src/main/java/cn/jia/agent/api/AgentSceneController.java agent/jia-agent-service/src/test/java/cn/jia/agent/api/AgentSceneControllerTest.java
git commit -m "feat: expose agent scene REST and SSE"
```

### Task 7: Write semantic scene state from existing business operations

**Files:**
- Modify: `api/agent/jia-agent-service/src/main/java/cn/jia/agent/service/impl/AgentServiceImpl.java`
- Modify: `api/agent/jia-agent-service/src/test/java/cn/jia/agent/service/impl/AgentServiceImplTest.java`

- [ ] **Step 1: Add failing domain integration tests**

```java
agentService.assignTask("task-001", assignRequest("agent-songjiang"));
verify(sceneService).upsertState(eq("juyiting-main"), argThat(state ->
        "moving_to_bounty".equals(state.getBehavior())
        && "bounty-board".equals(state.getTargetRegionId())
        && "task".equals(state.getRelatedType())
        && "task-001".equals(state.getRelatedId())));
```

Add corresponding tests for discussion/chat movement and return-home after completion/expiry.

- [ ] **Step 2: Verify failure**

Run: `./gradlew :agent:jia-agent-service:test --tests cn.jia.agent.service.impl.AgentServiceImplTest`

Expected: FAIL because scene service is not called.

- [ ] **Step 3: Inject and call AgentSceneService**

Use `ObjectProvider<AgentSceneService>` to preserve feature-flag rollout. Domain methods construct semantic state with ISO-compatible epoch timestamps, expected arrival, and expiry; they never set coordinates. Controller methods remain read/report-only and never synthesize business state.

- [ ] **Step 4: Run regression tests**

Run: `./gradlew :agent:jia-agent-service:test`

Expected: PASS for existing agent behavior and new semantic writes.

- [ ] **Step 5: Commit**

```powershell
git add agent/jia-agent-service/src/main/java/cn/jia/agent/service/impl/AgentServiceImpl.java agent/jia-agent-service/src/test/java/cn/jia/agent/service/impl/AgentServiceImplTest.java
git commit -m "feat: publish business agent scene state"
```

### Task 8: Add feature flags, full validation and API documentation

**Files:**
- Modify backend configuration files containing agent properties
- Create: `api/openspec/specs/interfaces/agent-scene-state-api.md`
- Modify: `web/jia-web-kit/docs/juyiting-feature-guide.md`

- [ ] **Step 1: Add flags with safe defaults**

```properties
juyiting.scene-state.enabled=false
juyiting.scene-events.enabled=false
```

When scene state is disabled, existing `/agent/map` behavior remains unchanged. When events are disabled, snapshot and phase endpoints remain available while SSE returns a controlled disabled response.

- [ ] **Step 2: Run backend gate**

Run:

```powershell
cd D:\workspace\chcbz\project\jia\api
.\gradlew :agent:jia-agent-service:test
.\gradlew validateLayering
.\gradlew test
```

Expected: `BUILD SUCCESSFUL` for all commands.

- [ ] **Step 3: Document exact wire contracts**

Document sample snapshot, SSE event, report request/result, tenant scope, version gap behavior, retention/resync, flags and curl examples without credentials.

- [ ] **Step 4: Commit backend docs and code**

```powershell
git add agent openspec/specs/interfaces/agent-scene-state-api.md
git commit -m "docs: specify agent scene state API"
```

- [ ] **Step 5: Commit frontend guide separately**

```powershell
cd D:\workspace\chcbz\project\jia\web\jia-web-kit
git add docs/juyiting-feature-guide.md
git commit -m "docs: link Juyiting scene state API"
```
