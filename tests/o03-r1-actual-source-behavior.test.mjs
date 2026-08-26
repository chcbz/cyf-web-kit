import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const root = resolve(process.cwd())
assert.ok(existsSync(resolve(root, 'src/components/juyiting/HallStage.vue')), `O03 selector must run from the current worktree: ${root}`)
const sha = value => createHash('sha256').update(value).digest('hex')
const plain = value => value == null ? value : JSON.parse(JSON.stringify(value))
const flushMicrotasks = async (turns = 4) => { for (let turn = 0; turn < turns; turn += 1) await Promise.resolve() }
const sourcePath = rel => `${root}/${rel}`
const complete = rel => readFileSync(sourcePath(rel), 'utf8')
const scriptSetup = (text, label) => {
  const open = '<script setup>'
  const first = text.indexOf(open)
  assert.ok(first >= 0, `${label}: missing script setup`)
  assert.equal(text.indexOf(open, first + open.length), -1, `${label}: duplicate script setup`)
  const start = first + open.length
  const end = text.indexOf('</script>', start)
  assert.ok(end >= 0, `${label}: missing script end`)
  assert.equal(text.indexOf('</script>', end + 1), -1, `${label}: duplicate script end`)
  return text.slice(start, end)
}

const hallStageSource = complete('src/components/juyiting/HallStage.vue')
const juyiHallSource = complete('src/components/world/JuyiHall.vue')
const gameSource = complete('src/game/JuyitingGame.js')
const hallSceneSource = complete('src/game/scenes/HallScene.js')
const hallStageScript = scriptSetup(hallStageSource, 'HallStage')
const juyiHallScript = scriptSetup(juyiHallSource, 'JuyiHall')
const stageSuffix = `\nexport const __O03_TEST__ = Object.freeze({ handleSceneReady, settleFinalViewport, finalizeSceneReady, consumeLandscapeEntryTarget, mountScene, captureMapSnapshot, cancelStageWork, failSceneMount, isCurrentMountAttempt, isRunningGeneration, setContainer: value => { melonContainerRef.value = value }, patchProps: value => Object.assign(props, value), setLifecycle: value => { if ('sceneMountAttempt' in value) sceneMountAttempt = value.sceneMountAttempt; if ('activeMapGeneration' in value) activeMapGeneration = value.activeMapGeneration; if ('mapLifecycleState' in value) mapLifecycleState.value = value.mapLifecycleState; if ('isUnmounted' in value) isUnmounted = value.isUnmounted; if ('settledViewportGeneration' in value) settledViewportGeneration = value.settledViewportGeneration; if ('consumedLandscapeTargetGeneration' in value) consumedLandscapeTargetGeneration = value.consumedLandscapeTargetGeneration }, snapshot: () => ({ sceneMountAttempt, activeMapGeneration, mapLifecycleState: mapLifecycleState.value, settledViewportGeneration, consumedLandscapeTargetGeneration, melonReady: melonReady.value, isSceneMounting: isSceneMounting.value, sceneError: sceneError.value, currentGameDestroyed }) })\n`
const hallSuffix = `\nexport const __O03_TEST__ = Object.freeze({ setLandscapeEntryTarget, handleLandscapeTargetConsumed, stagePortraitHotspotTarget, handlePortraitAgentSelect, requestPortraitLandscape, handlePortraitTaskOpen, handlePortraitQuickAction, landscapeEntryTarget, selectedAgent, selectedTask, mapAgents, sceneHotspots, getTargetGeneration: () => landscapeEntryTargetGeneration })\n`
const stageTransformed = `${hallStageScript}${stageSuffix}`
const hallTransformed = `${juyiHallScript}${hallSuffix}`
assert.equal(stageTransformed.slice(0, hallStageScript.length), hallStageScript)
assert.equal(stageTransformed.length, hallStageScript.length + stageSuffix.length)
assert.equal(hallTransformed.slice(0, juyiHallScript.length), juyiHallScript)
assert.equal(hallTransformed.length, juyiHallScript.length + hallSuffix.length)

const createScheduler = () => {
  let next = 0
  const raf = new Map(); const timers = new Map(); const cancelled = []
  return {
    requestAnimationFrame(callback) { const id = ++next; raf.set(id, callback); return id },
    cancelAnimationFrame(id) { raf.delete(id) },
    setTimeout(callback, delay) { const id = ++next; timers.set(id, { callback, delay, cancelled: false }); return id },
    clearTimeout(id) { const timer = timers.get(id); if (timer) { timer.cancelled = true; cancelled.push(id) } },
    runNextRaf() { const item = raf.entries().next().value; if (!item) return false; raf.delete(item[0]); item[1](0); return true },
    runRafs(count) { for (let i = 0; i < count; i += 1) assert.equal(this.runNextRaf(), true, 'expected queued RAF') },
    advanceTimers(ms) { for (const timer of timers.values()) if (!timer.cancelled && timer.delay <= ms) timer.callback() },
    get cancelled() { return cancelled.slice() },
    get rafCount() { return raf.size }
  }
}

class ManualResizeObserver {
  static instances = []
  constructor(callback) { this.callback = callback; this.observed = null; this.disconnects = 0; ManualResizeObserver.instances.push(this) }
  observe(element) { this.observed = element }
  disconnect() { this.disconnects += 1 }
  trigger(contentRect = {}) { this.callback([{ target: this.observed, contentRect }]) }
}

const ref = value => ({ value })
const fn = () => undefined
const asyncFn = async () => undefined
const makeContext = ({ scheduler, props, emits, game, hallData } = {}) => {
  const lifecycle = { mounted: [], beforeUnmount: [], unmounted: [], watchers: [] }
  const vue = {
    ref,
    computed: getter => ({ get value() { return getter() } }),
    watch: (source, callback, options = {}) => { lifecycle.watchers.push({ source, callback, options }); if (options.immediate) callback(typeof source === 'function' ? source() : source?.value); return fn },
    onMounted: callback => lifecycle.mounted.push(callback), onBeforeUnmount: callback => lifecycle.beforeUnmount.push(callback), onUnmounted: callback => lifecycle.unmounted.push(callback),
    nextTick: callback => callback ? Promise.resolve().then(callback) : Promise.resolve()
  }
  const no = () => ({})
  const data = hallData || {
    agentFilter: ref(''), agents: ref([]), mapAgents: ref([{ agentId: 'agent-A' }]), tasks: ref([{ id: 'task-7', assignedAgentIds: ['agent-A'] }]),
    personaCatalog: ref([]), recommendedAgents: ref([]), taskAbilityFilter: ref(''), taskAbilityOptions: ref([]), taskKeyword: ref(''), taskStatusCount: ref({}), taskStatusFilter: ref(''), visibleAgents: ref([]), hiddenAgentCount: ref(0), filteredAgents: ref([]), canAssign: () => true,
    applySceneEvent: fn, applySceneSnapshot: fn, bindPersona: asyncFn, loadAgents: asyncFn, loadTasks: asyncFn, loadTaskRecommendations: asyncFn, setAgentFilter: fn, setTaskStatusFilter: fn, unbindPersona: asyncFn
  }
  const scene = { sceneAgents: ref([{ agentId: 'agent-A' }]), sceneHotspots: ref([{ id: 'bountyBoard' }, { id: 'agentRoster' }, { id: 'mainSeat' }, { id: 'personaCatalog' }, { id: 'libraryShelf' }]), markAgentSpeaking: fn, markDiscussionStarted: fn, markLibraryCitation: fn, markLibrarySearching: fn, markRecommendedAgents: fn, markTaskArchived: fn, markTaskAssigned: fn, markTaskAutoAssigned: fn, markTaskCreated: fn, resetSceneFeedback: fn, sceneAgentStyle: () => ({}), syncAfterPersonaChanged: fn }
  const context = vm.createContext({ console, URLSearchParams, Promise, Object, Array, Set, Map, Number, String, Boolean, Math, Date, JSON, Error, TypeError, globalThis: null })
  context.globalThis = context
  context.window = { requestAnimationFrame: scheduler?.requestAnimationFrame.bind(scheduler) || fn, cancelAnimationFrame: scheduler?.cancelAnimationFrame.bind(scheduler) || fn, setTimeout: scheduler?.setTimeout.bind(scheduler) || fn, clearTimeout: scheduler?.clearTimeout.bind(scheduler) || fn, setInterval: fn, clearInterval: fn, innerWidth: 844, innerHeight: 390, visualViewport: { height: 390, addEventListener: fn, removeEventListener: fn }, addEventListener: fn, removeEventListener: fn, location: { search: '' }, ResizeObserver: ManualResizeObserver }
  context.document = { activeElement: null, documentElement: { style: { setProperty: fn } } }
  context.ResizeObserver = ManualResizeObserver
  context.defineProps = () => props || {}
  context.defineEmits = () => (...args) => emits.push(args)
  const bindings = {
    vue,
    '@/game/index.js': { juyitingGame: game },
    '@/game/camera/resizePolicy.js': { classifyViewportResize: () => 'layout' },
    '@/stores/global': { useGlobalStore: () => ({ setTitle: fn, setAppBarVisible: fn }) }, '@/stores/api': { useApiStore: () => ({}) }, '@/composables/useHttp': { agentApi: {}, chatApi: {} },
    '@/composables/juyiting/useHallExperienceMode': { useHallExperienceMode: () => ({ experienceMode: ref('portrait-command'), isMobileCoarse: ref(true), orientationHint: ref(''), orientationRequestPending: ref(false), requestLandscape: () => 'orientation-request' }) },
    '@/composables/juyiting/useHallData': { useHallData: () => data }, '@/composables/juyiting/useHallScene': { useHallScene: () => scene },
    '@/composables/juyiting/useHallChatContext': { useHallChatContext: () => ({ chatContext: ref({}), chatMentionAgents: ref([]), chatMode: ref('public'), chatTargetText: ref(''), enterBountyDiscussion: fn, enterPrivateConversation: fn, resetToPublic: fn, setMentionAgent: fn }) },
    '@/composables/juyiting/useHallBackendSceneState': { useHallBackendSceneState: () => ({ start: asyncFn, stop: fn, reportPhase: fn }) }, '@/composables/juyiting/useHallCommandQueue': { useHallCommandQueue: () => ({ ready: ref(false), setSimulation: fn }) }, '@/composables/juyiting/useHallSceneState': { useHallSceneState: () => ({ setMapRuntime: fn, reset: fn, forwardPhaseEvents: asyncFn }) }, '@/composables/juyiting/useHallSceneDebugBridge': { useHallSceneDebugBridge: () => ({ republish: fn }) },
    '@/composables/juyiting/useHallSound': { useHallSound: () => ({ playAgentSelect: fn, playError: fn, playPanelOpen: fn, playRefresh: fn, playSend: fn, playSuccess: fn, playTap: fn, setSoundEnabled: fn, soundEnabled: ref(true) }) },
    '@/composables/juyiting/useHallPanels': { focusHallPanel: fn, restorePanelFocus: fn, trapPanelFocus: fn, useHallPanels: () => ({ panelLayout: ref('desktop') }) },
    '@/composables/juyiting/useTaskWorkspace': { useTaskWorkspace: () => ({}) }, '@/composables/juyiting/taskWorkspaceFeature': { isTaskWorkspaceBuildEnabled: () => false, createDisabledTaskWorkspaceBinding: () => ({ selectExplicitActor: fn, clearExplicitActor: fn, dispose: fn }) }, '@/composables/juyiting/useTaskWorkspaceView': { useTaskWorkspaceView: () => ({ subject: ref(null), workspace: ref(null), connectionState: ref(''), error: ref(''), retry: asyncFn }) }, '@/composables/juyiting/useTaskWorkspaceBinding': { useTaskWorkspaceBinding: () => ({ selectExplicitActor: fn, clearExplicitActor: fn, dispose: fn }) },
    '@/composables/juyiting/useHallTaskActions': { useHallTaskActions: () => ({ archiveTask: asyncFn, autoAssignTask: asyncFn, assignTask: async () => false, createTask: asyncFn }) },
    '@/composables/juyiting/useHallConversation': { useHallConversation: () => ({ chatConnectionStatus: ref(''), conversationId: ref(''), draft: ref(''), eventStreamRecovering: ref(false), insertAgentMention: fn, isAwaitingReply: ref(false), isStreaming: ref(false), loadHallMessages: asyncFn, mentionAgent: fn, messages: ref([]), newHallConversation: fn, pendingAgentName: ref(''), sendHallMessage: asyncFn, senderText: ref(''), disposeHallConversation: fn, stopHallEventStream: fn, stopHallReplyPolling: fn, stopHallReplyStreaming: fn }) },
    '@/composables/juyiting/useHallLibrary': { useHallLibrary: () => ({ citeLibraryItem: fn, libraryErrorMessage: ref(''), libraryHasSearched: ref(false), libraryKeyword: ref(''), libraryLoading: ref(false), libraryResults: ref([]), librarySourceType: ref(''), searchLibrary: asyncFn }) },
    '@/composables/juyiting/useWaterMarginRoles': { portraitName: fn, portraitRole: () => ({ slug: 'default' }), portraitShortName: fn, portraitStyle: fn, roleClass: fn }, '@/constants/juyiting': { roleDialogues: { default: [''] }, statusFilters: [], taskStatusFilters: [] }, '@/utils/logger': { log: { warn: fn, error: fn, info: fn } }
  }
  for (const path of ['TaskWorkspacePanel.vue', 'AgentPanel.vue', 'BountyDiscussionPanel.vue', 'BountyPanel.vue', 'HallPortraitHome.vue', 'HallStage.vue', 'LibraryPanel.vue', 'PersonaCatalogPanel.vue', 'PrivateDiscussionPanel.vue', 'PublicDiscussionPanel.vue', 'SelectedAgentCard.vue']) bindings[`@/components/juyiting/${path}`] = { default: {} }
  return { context, bindings, lifecycle, data, scene }
}

const synthetic = (context, values, identifier) => new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value) }, { context, identifier })
const instantiate = async ({ script, suffix, label, scheduler, props, emits = [], game, hallData }) => {
  const fixture = makeContext({ scheduler, props, emits, game, hallData })
  const module = new vm.SourceTextModule(`${script}${suffix}`, { context: fixture.context, identifier: label, initializeImportMeta(meta) { meta.env = Object.freeze({ VITE_JUYITING_TASK_WORKSPACE_ENABLED: 'false', VITE_JUYITING_SIMULATION_ENABLED: 'false' }) } })
  const linked = []
  await module.link((specifier) => { const values = fixture.bindings[specifier]; assert.ok(values, `${label}: unknown import ${specifier}`); linked.push(specifier); return synthetic(fixture.context, values, specifier) })
  await module.evaluate()
  return { api: module.namespace.__O03_TEST__, fixture, linked }
}
const loadGame = async () => {
  const context = vm.createContext({ console, Promise, Object, Array, Set, Map, Number, String, Boolean, Math, Date, JSON, Error, globalThis: null, setTimeout, clearTimeout })
  context.globalThis = context
  const modules = {
    './config.js': { createGameConfig: () => ({}) }, './resources.js': { HALL_BOOT_RESOURCES: [], HALL_MAP_RESOURCE: {}, buildHallMapResources: () => [], buildPersonaSpriteResource: () => ({}), personaSpriteResourceName: () => '' }, './tiledMap.js': { parseJuyiHallTmx: () => ({}) }, './scenes/HallScene.js': { createHallSceneClass: () => class {} }, './entities/HallAgent.js': { createHallAgentClass: () => class {} }, './sprites/spriteLoader.js': { loadPersonaSprites: async () => ({ available: new Set(), assets: new Map(), errors: [], degraded: false }) }, './sprites/personaSpriteManifest.js': { PERSONA_SPRITE_MANIFEST: [] }, './simulation/movementEngine.js': { createMovementEngine: () => ({}) }, './debug/sceneDebugAggregator.js': { aggregateSceneDebug: () => ({}) }
  }
  const module = new vm.SourceTextModule(gameSource, { context, identifier: 'JuyitingGame.js' })
  await module.link(specifier => { assert.ok(modules[specifier], `game: unknown import ${specifier}`); return synthetic(context, modules[specifier], specifier) })
  await module.evaluate()
  return module.namespace.JuyitingGame
}

const loadActualHallScene = async () => {
  const context = vm.createContext({ console, Promise, Object, Array, Set, Map, WeakMap, Number, String, Boolean, Math, Date, JSON, Error, TypeError, globalThis: null })
  context.globalThis = context
  const fn = () => undefined
  const modules = {
    '../config.js': { DEPTH_LAYERS: {}, HALL_SCENE_HEIGHT: 780, HALL_SCENE_WIDTH: 1664 },
    '../camera/cameraController.js': { createCameraController: fn }, '../camera/resizePolicy.js': { classifyViewportResize: () => 'orientation' }, '../camera/cameraTransform.js': { screenToWorld: fn },
    '../input/inputController.js': { createInputController: fn }, '../input/interactionLock.js': { createInteractionLock: fn }, '../viewportTransform.js': { clientToViewport: fn },
    '../occlusion/shadowRenderer.js': { createShadowRenderer: fn, parseOcclusionDebugFlag: fn },
    '../occlusion/hallSceneAssembly.js': { hasV2ActivationEnvelope: fn, assembleV2Scene: fn, computeUnifiedWorldOrder: fn, buildHitTestTargets: fn, hitTestPoint: fn, buildFrameProposal: fn, createEmptyMembershipState: () => ({}), registerAgentsInGrid: fn, unregisterAgentFromGrid: fn, createSceneActivationController: fn, projectActivationEnvelope: fn },
    '../occlusion/runtimeAgentAdapter.js': { createRuntimeAgentAdapter: fn, defaultSpawnResolver: fn, defaultChunkResolver: fn }, '../occlusion/debugOverlay.js': { createDebugOverlay: fn },
    '../occlusion/hallSceneDepthBands.js': { HALL_SCENE_DEPTH_BANDS: {}, HALL_SCENE_LEGACY_OCCLUDER_LAYERS: [], hallV2WorldDepth: fn }, '../occlusion/sourceIdentity.js': { isValidSourceEntityId: () => true }
  }
  const module = new vm.SourceTextModule(hallSceneSource, { context, identifier: sourcePath('src/game/scenes/HallScene.js') })
  await module.link(specifier => { assert.ok(modules[specifier], `HallScene: unknown import ${specifier}`); return synthetic(context, modules[specifier], specifier) })
  await module.evaluate()
  return module.namespace.createHallSceneClass
}

const defaultProps = () => ({ experienceMode: 'landscape-map', simulationEnabled: false, mapResumeSnapshot: null, landscapeEntryTarget: null, sceneAgents: [{ agentId: 'agent-A' }], sceneHotspots: [{ id: 'bountyBoard' }], tasks: [{ id: 'task-7', assignedAgentIds: ['agent-A'] }], selectedAgent: { agentId: 'agent-A' }, interactionLocked: false, agentBubbles: {}, agentKey: fn, agentStyle: fn, hiddenAgentCount: 0, orientationHint: '', orientationRequestPending: false, portraitName: fn, portraitShortName: fn, portraitStyle: fn, refreshing: false, roleClass: fn, soundEnabled: true, statusClass: fn, statusText: fn, tasksTotal: 1, visibleAgents: [] })
const container = (rect) => ({ getBoundingClientRect: () => ({ ...rect }), querySelector: () => null })

let selectorPasses = 0

test('successful ready cancels the terminal timeout before async finalization', async () => {
  const scheduler = createScheduler(); const calls = []; const props = defaultProps(); let ready
  const game = { beginMapGeneration: () => 1, setInteractionLocked: fn, mount: async (_container, options) => { ready = options.onReady }, start: fn, destroy: () => calls.push('destroy'), getMovementRuntime: fn, syncAgents: fn, syncHotspots: fn, setSelectedAgent: fn, commitViewport: () => Promise.resolve(), restoreResumeSnapshot: fn, captureResumeSnapshot: fn, setInteractionLocked: fn }
  const stage = await instantiate({ script: hallStageScript, suffix: stageSuffix, label: 'HallStage-ready', scheduler, props, game })
  stage.api.setContainer(container({ width: 844, height: 390 })); const mounting = stage.api.mountScene(); await mounting
  ready(); assert.equal(scheduler.cancelled.length, 1); scheduler.advanceTimers(15000); assert.deepEqual(calls, [])
  selectorPasses += 1
})

test('portrait producer publishes exact latest payload; stale ack/cancel/once are enforced', async () => {
  const scheduler = createScheduler(); const events = []; const game = { resetToMainHall: fn, focusAgent: () => true, focusHotspot: () => true }
  const hall = await instantiate({ script: juyiHallScript, suffix: hallSuffix, label: 'JuyiHall-target', scheduler, game, emits: events })
  hall.api.selectedAgent.value = { agentId: 'agent-A' }; hall.api.selectedTask.value = { id: 'task-7', assignedAgentIds: ['agent-A'] }
  assert.equal(hall.api.requestPortraitLandscape(), 'orientation-request'); const taskEntry = plain(hall.api.landscapeEntryTarget.value)
  assert.deepEqual(taskEntry.target, { kind: 'task', taskId: 'task-7', agentId: 'agent-A' })
  hall.api.handlePortraitAgentSelect({ agentId: 'agent-A' }); const agentEntry = plain(hall.api.landscapeEntryTarget.value); assert.ok(agentEntry.generation > taskEntry.generation)
  hall.api.stagePortraitHotspotTarget('tasks'); const hotEntry = plain(hall.api.landscapeEntryTarget.value); assert.deepEqual(hotEntry.target, { kind: 'hotspot', hotspotId: 'bountyBoard' })
  hall.api.handleLandscapeTargetConsumed(agentEntry.generation); assert.deepEqual(plain(hall.api.landscapeEntryTarget.value), hotEntry)
  const stageProps = defaultProps(); stageProps.landscapeEntryTarget = hotEntry; const stage = await instantiate({ script: hallStageScript, suffix: stageSuffix, label: 'HallStage-target', scheduler, props: stageProps, game, emits: events })
  stage.api.setLifecycle({ sceneMountAttempt: 1, mapLifecycleState: 'running' }); assert.equal(stage.api.consumeLandscapeEntryTarget(1), true); assert.equal(stage.api.consumeLandscapeEntryTarget(1), false)
  hall.api.handleLandscapeTargetConsumed(hotEntry.generation); assert.equal(hall.api.landscapeEntryTarget.value, null); hall.api.setLandscapeEntryTarget(null); assert.equal(hall.api.landscapeEntryTarget.value, null)
  selectorPasses += 1
})

test('zero container cannot settle; observed positive geometry needs two stable RAFs', async () => {
  ManualResizeObserver.instances.length = 0
  const scheduler = createScheduler(); const stage = await instantiate({ script: hallStageScript, suffix: stageSuffix, label: 'HallStage-settle', scheduler, props: defaultProps(), game: {} })
  const rect = { width: 0, height: 0 }; stage.api.setContainer(container(rect)); stage.api.setLifecycle({ sceneMountAttempt: 3, mapLifecycleState: 'mounting' })
  let settled = false; const pending = stage.api.settleFinalViewport(3); void pending.then(value => { settled = plain(value) }); const observer = ManualResizeObserver.instances.at(-1)
  observer.trigger({ width: 0, height: 0 }); scheduler.runRafs(3); await flushMicrotasks(); assert.equal(settled, false)
  rect.width = 844; rect.height = 390; observer.trigger({ width: 844, height: 390 }); scheduler.runRafs(1); await flushMicrotasks(); assert.equal(settled, false); scheduler.runRafs(1); assert.deepEqual(plain(await pending), { width: 844, height: 390 }); assert.equal(observer.disconnects, 1)
  selectorPasses += 1
})

test('restore uses committed backing/display/visible viewport truth in the real HallScene and preserves world center', async () => {
  const scheduler = createScheduler(); let resolveCommit; const calls = []; const props = defaultProps(); props.mapResumeSnapshot = { cameraSnapshot: { transform: { zoom: 2.1, offsetX: 180, offsetY: -95 } }, sourceViewport: { width: 1664, height: 928 }, mapGeneration: 1 }
  const game = { commitViewport: () => new Promise(resolve => { calls.push('commit'); resolveCommit = resolve }), restoreResumeSnapshot: (_snapshot, viewport) => { calls.push(['restore', viewport]); return true }, syncAgents: fn, syncHotspots: fn, setSelectedAgent: fn, setInteractionLocked: fn }
  const stage = await instantiate({ script: hallStageScript, suffix: stageSuffix, label: 'HallStage-restore', scheduler, props, game, emits: [] })
  stage.api.setContainer(container({ width: 844, height: 390 })); stage.api.setLifecycle({ sceneMountAttempt: 1, mapLifecycleState: 'mounting' }); const finalizing = stage.api.finalizeSceneReady(1); ManualResizeObserver.instances.at(-1).trigger(); scheduler.runRafs(2); await flushMicrotasks(); assert.deepEqual(plain(calls), ['commit']); resolveCommit(); await finalizing; assert.deepEqual(plain(calls[1]), ['restore', { width: 844, height: 390 }])

  const createHallSceneClass = await loadActualHallScene()
  const me = { Stage: class {}, game: { viewport: { width: 1664, height: 928 } } }
  const Scene = createHallSceneClass(me, class {})
  const scene = new Scene()
  let transform = { zoom: 2.1, offsetX: 180, offsetY: -95 }
  let cameraViewport = { width: 1664, height: 928 }
  scene.getCameraSnapshot = () => ({ transform: { ...transform } })
  scene.restoreCameraSnapshot = (snapshot, viewport) => { transform = { ...snapshot.transform }; cameraViewport = { ...viewport }; scene._currentViewport = { ...viewport }; return scene.getCameraSnapshot() }
  scene._cameraController = { resize: next => {
    const center = { x: ((cameraViewport.width / 2 - cameraViewport.width / 2 - transform.offsetX) / transform.zoom) + cameraViewport.width / 2, y: ((cameraViewport.height / 2 - cameraViewport.height / 2 - transform.offsetY) / transform.zoom) + cameraViewport.height / 2 }
    cameraViewport = { ...next }
    transform = { ...transform, offsetX: (next.width / 2 - center.x) * transform.zoom, offsetY: (next.height / 2 - center.y) * transform.zoom }
    return transform
  } }
  const Game = await loadGame(); const actual = new Game()
  actual._me = { game: { viewport: { width: 1664, height: 928 } } }
  actual._container = { getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0, right: 390, bottom: 844 }) }
  actual._canvas = { getBoundingClientRect: () => ({ width: 470.692, height: 844, left: -40.346, top: 0, right: 430.346, bottom: 844 }) }
  actual._hallScene = scene; actual._markSceneDebugDirty = fn
  const snapshot = actual.captureResumeSnapshot()
  const oldCenter = { x: ((1664 / 2 - 1664 / 2 - snapshot.cameraSnapshot.transform.offsetX) / 2.1) + 1664 / 2, y: ((928 / 2 - 928 / 2 - snapshot.cameraSnapshot.transform.offsetY) / 2.1) + 928 / 2 }
  actual._me.game.viewport = { width: 928, height: 1664 }
  assert.ok(actual.restoreResumeSnapshot(snapshot, { width: 390, height: 844 }))
  assert.deepEqual(plain(scene._currentViewport), { width: 928, height: 1664 })
  assert.deepEqual(plain(scene._displayViewport), { width: 390, height: 844 })
  assert.ok(scene._visibleViewport.width < 928 && scene._visibleViewport.height === 1664, 'real HallScene must retain backing-world visible geometry')
  const finalCenter = { x: ((928 / 2 - 928 / 2 - transform.offsetX) / 2.1) + 928 / 2, y: ((1664 / 2 - 1664 / 2 - transform.offsetY) / 2.1) + 1664 / 2 }
  assert.ok(Math.abs(oldCenter.x - finalCenter.x) <= 1e-6 && Math.abs(oldCenter.y - finalCenter.y) <= 1e-6)
  selectorPasses += 1
})

test('commit rejection and restore false or throw enter fatal cleanup without consuming the snapshot', async () => {
  const cases = [
    { name: 'commit rejection', commitViewport: () => Promise.reject(new Error('commit failed')) },
    { name: 'restore false', commitViewport: () => Promise.resolve(), restoreResumeSnapshot: () => false },
    { name: 'restore throw', commitViewport: () => Promise.resolve(), restoreResumeSnapshot: () => { throw new Error('restore failed') } }
  ]
  for (const scenario of cases) {
    ManualResizeObserver.instances.length = 0
    const scheduler = createScheduler(); const events = []; const calls = []
    const props = defaultProps(); props.mapResumeSnapshot = { cameraSnapshot: { transform: {} }, sourceViewport: { width: 1664, height: 928 }, mapGeneration: 9 }
    const game = { commitViewport: scenario.commitViewport, restoreResumeSnapshot: scenario.restoreResumeSnapshot || (() => true), syncAgents: () => calls.push('sync'), syncHotspots: fn, setSelectedAgent: fn, setInteractionLocked: (locked, reason) => calls.push(['lock', locked, reason]), destroy: () => calls.push('destroy') }
    const stage = await instantiate({ script: hallStageScript, suffix: stageSuffix, label: `HallStage-fatal-${scenario.name}`, scheduler, props, game, emits: events })
    stage.api.setContainer(container({ width: 844, height: 390 })); stage.api.setLifecycle({ sceneMountAttempt: 1, mapLifecycleState: 'mounting' })
    const pending = stage.api.finalizeSceneReady(1); ManualResizeObserver.instances.at(-1).trigger(); scheduler.runRafs(2); await pending
    assert.equal(stage.api.snapshot().mapLifecycleState, 'unmounted', scenario.name)
    assert.equal(stage.api.snapshot().currentGameDestroyed, true, scenario.name)
    assert.equal(calls.filter(call => call === 'destroy').length, 1, scenario.name)
    assert.equal(calls.filter(call => Array.isArray(call) && call[0] === 'lock' && call[1] === false && call[2] === 'loading').length, 1, scenario.name)
    assert.equal(events.filter(([event]) => event === 'map-snapshot-clear').length, 0, scenario.name)
    assert.equal(calls.includes('sync'), false, scenario.name)
  }
  selectorPasses += 1
})

test('destroy fences stale continuations and synchronously releases temporary observer and RAF handles', async () => {
  ManualResizeObserver.instances.length = 0
  const scheduler = createScheduler(); const calls = []; const stage = await instantiate({ script: hallStageScript, suffix: stageSuffix, label: 'HallStage-stale-cleanup', scheduler, props: defaultProps(), game: { destroy: () => calls.push('destroy'), setInteractionLocked: fn } })
  stage.api.setContainer(container({ width: 844, height: 390 })); stage.api.setLifecycle({ sceneMountAttempt: 4, mapLifecycleState: 'mounting' })
  const pending = stage.api.settleFinalViewport(4); const observer = ManualResizeObserver.instances.at(-1); assert.equal(scheduler.rafCount, 1)
  stage.api.cancelStageWork(); assert.equal(observer.disconnects, 1); assert.equal(scheduler.rafCount, 0); assert.equal(await pending, null)
  let rejectCommit; const staleGame = { commitViewport: () => new Promise((_resolve, reject) => { rejectCommit = reject }), syncAgents: () => calls.push('sync'), syncHotspots: fn, setSelectedAgent: fn, destroy: () => calls.push('destroy'), setInteractionLocked: fn }
  const stale = await instantiate({ script: hallStageScript, suffix: stageSuffix, label: 'HallStage-stale', scheduler, props: defaultProps(), game: staleGame })
  stale.api.setContainer(container({ width: 844, height: 390 })); stale.api.setLifecycle({ sceneMountAttempt: 5, mapLifecycleState: 'mounting' }); const finalizing = stale.api.finalizeSceneReady(5); ManualResizeObserver.instances.at(-1).trigger(); scheduler.runRafs(2); await flushMicrotasks(); stale.api.setLifecycle({ sceneMountAttempt: 6, mapLifecycleState: 'unmounted' }); rejectCommit(new Error('late rejection')); await finalizing
  assert.equal(calls.includes('destroy'), false); assert.equal(calls.includes('sync'), false); assert.equal(stale.api.snapshot().mapLifecycleState, 'unmounted')
  selectorPasses += 1
})

test('shared generation is monotonic across separate HallStage instances without breaking local fences', async () => {
  const Game = await loadGame(); const game = new Game(); game._me = { game: { viewport: { width: 844, height: 390 } } }; game._hallScene = { getCameraSnapshot: () => ({ transform: { zoom: 1, offsetX: 0, offsetY: 0 } }) }; game.mount = async () => {}; game.start = fn; game.setInteractionLocked = fn; game.getMovementRuntime = fn
  const schedulerA = createScheduler(); const schedulerB = createScheduler(); const a = await instantiate({ script: hallStageScript, suffix: stageSuffix, label: 'HallStage-A', scheduler: schedulerA, props: defaultProps(), game }); const b = await instantiate({ script: hallStageScript, suffix: stageSuffix, label: 'HallStage-B', scheduler: schedulerB, props: defaultProps(), game })
  a.api.setContainer(container({ width: 844, height: 390 })); b.api.setContainer(container({ width: 844, height: 390 })); await a.api.mountScene(); const snapA = game.captureResumeSnapshot(); await b.api.mountScene(); const snapB = game.captureResumeSnapshot(); assert.ok(snapB.mapGeneration > snapA.mapGeneration); b.api.setLifecycle({ sceneMountAttempt: 1, mapLifecycleState: 'running' }); assert.equal(b.api.isRunningGeneration(1), true)
  selectorPasses += 1
})

test.after(() => {
  assert.equal(selectorPasses, 7)
  console.log(JSON.stringify({ cwd: root, node: process.version, sources: { HallStage: sourcePath('src/components/juyiting/HallStage.vue'), JuyiHall: sourcePath('src/components/world/JuyiHall.vue'), JuyitingGame: sourcePath('src/game/JuyitingGame.js') }, hashes: { HallStage: sha(hallStageSource), HallStageScript: sha(hallStageScript), HallStageTransformed: sha(stageTransformed), JuyiHall: sha(juyiHallSource), JuyiHallScript: sha(juyiHallScript), JuyiHallTransformed: sha(hallTransformed), JuyitingGame: sha(gameSource), HallScene: sha(hallSceneSource) }, selectors: 7 }))
})
