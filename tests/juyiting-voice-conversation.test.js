import { expect } from 'chai'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'
import { createHallVoiceReplyCorrelation } from '../src/composables/juyiting/hallVoiceReplyCorrelation.js'
import {
  HALL_VOICE_MAX_AUDIO_BYTES,
  captureHallVoiceSnapshot,
  useHallVoiceConversation
} from '../src/composables/juyiting/useHallVoiceConversation.js'
import { useHallConversation } from '../src/composables/juyiting/useHallConversation.js'
import { identityCleanupHandlerCount, stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Vue.nextTick() }
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const vueImportToVar = (_line, names) => {
  const bindings = names.split(',').map(part => {
    const [name, alias] = part.trim().split(/\s+as\s+/)
    return alias ? `${name}: ${alias}` : name
  }).join(', ')
  return `var { ${bindings} } = Vue`
}

const loadSfc = (relativePath, children = {}) => {
  const filename = new URL(relativePath, import.meta.url).pathname
  const { descriptor } = parse(requireSource(relativePath), { filename })
  const body = compileScript(descriptor, { id: `voice-${relativePath}`, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+(\w+)\s+from\s+['"].+['"];?\s*$/gm, (_line, name) => `var ${name} = children.${name}`)
    .replace('export default', 'return')
  return new Function('Vue', 'children', body)(Vue, children)
}

const loadActualJuyiHall = mocks => {
  const relativePath = '../src/components/world/JuyiHall.vue'
  const filename = new URL(relativePath, import.meta.url).pathname
  const { descriptor } = parse(requireSource(relativePath), { filename })
  const body = compileScript(descriptor, { id: 'voice-timeout-actual-hall', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, imports) => `var { ${imports} } = mocks`)
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, name) => `var ${name} = mocks.${name}`)
    .replace(/import\.meta\.env/g, 'mocks.env')
    .replace('export default', 'return')
  return new Function('Vue', 'mocks', body)(Vue, mocks)
}
const requireSource = relativePath => {
  const { readFileSync } = globalThis.__voiceFs
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const validContext = (overrides = {}) => ({
  conversationId: '',
  conversationScopeType: 'public',
  conversationScopeKey: 'public',
  mode: 'public',
  targetAgentIds: [],
  targetAgentId: '',
  participantAgentIds: [],
  mentionAgentIds: [],
  selectedAgentId: null,
  selectedTaskId: null,
  taskId: null,
  outgoingMetadata: {},
  targetLabel: '众好汉',
  ...overrides
})

class FakeRecorder {
  static instances = []
  static isTypeSupported = type => type.startsWith('audio/webm')
  constructor (stream, options) {
    this.stream = stream
    this.mimeType = options.mimeType
    this.state = 'inactive'
    FakeRecorder.instances.push(this)
  }
  start () { this.state = 'recording' }
  stop () {
    this.state = 'inactive'
    const callback = this.onstop
    queueMicrotask(() => callback?.())
  }
}

const browserHarness = ({ permission, AudioClass, fetchImpl } = {}) => {
  const listeners = new Map()
  const documentListeners = new Map()
  const revoked = []
  const tracks = []
  const makeStream = () => {
    const track = { stopped: false, onended: null, stop () { this.stopped = true } }
    tracks.push(track)
    return { getTracks: () => [track] }
  }
  const browser = {
    navigator: { mediaDevices: { getUserMedia: permission || (async () => makeStream()) } },
    MediaRecorder: FakeRecorder,
    Audio: AudioClass || class { play = async () => {}; pause () {} },
    URL: { createObjectURL: () => 'blob:voice', revokeObjectURL: value => revoked.push(value) },
    fetch: fetchImpl || (async () => { throw new Error('unexpected fetch') }),
    crypto: { randomUUID: () => 'voice-request-id-1234' },
    window: {
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name)
    },
    document: {
      hidden: false,
      addEventListener: (name, callback) => documentListeners.set(name, callback),
      removeEventListener: name => documentListeners.delete(name)
    }
  }
  return { browser, documentListeners, listeners, makeStream, revoked, tracks }
}

const createVoice = ({ enabled = true, browser, chatCreate, onSendVoice, onReplyTurnTerminal, showToast = () => {}, draft = '', revision = 0, context = validContext(), replyBusy = false, captureEvents = [] } = {}) => {
  let currentDraft = draft
  let currentRevision = revision
  let currentContext = context
  const voice = useHallVoiceConversation({
    apiStore: { token: async () => 'token' },
    chatApi: { create: chatCreate || (async () => ({ data: { data: { text: '林教头请看榜文' } } })) },
    enabled,
    getContext: () => currentContext,
    getDraft: () => currentDraft,
    getDraftRevision: () => currentRevision,
    isReplyBusy: () => replyBusy,
    onOpenReview: () => {},
    onSendVoice: onSendVoice || (async () => true),
    onCaptureStateChange: value => captureEvents.push(value),
    onReplyTurnTerminal,
    showToast,
    browser
  })
  return { voice, setDraft: value => { currentDraft = value; currentRevision += 1 }, setContext: value => { currentContext = value } }
}

const transcribeToReview = async voice => {
  expect(await voice.startRecording(), `voice recording start failed from ${voice.state}: ${voice.error}`).to.equal(true)
  const recorder = FakeRecorder.instances.at(-1)
  expect(recorder, 'active MediaRecorder instance').to.exist
  recorder.ondataavailable({ data: new Blob(['voice']) })
  voice.stopRecording()
  await flush()
  expect(voice.state).to.equal('review')
  expect(voice.voiceInteractionLocked).to.equal(true)
}

const createActualHallVoiceMocks = ({
  chatApi,
  conversationRef,
  correlationRef,
  selectedAgentFixture = null,
  SelectedAgentCardComponent,
  HallPortraitHomeComponent,
  DiscussionPanelComponent,
  HallVoiceHudComponent,
  experienceMode = 'landscape-map',
  requestLandscape,
  voiceRef
}) => {
  const noop = () => {}
  const asyncNoop = async () => {}
  const list = Vue.ref([])
  const agentList = Vue.ref(selectedAgentFixture ? [selectedAgentFixture] : [])
  const text = Vue.ref('')
  const EmptyPanel = Vue.defineComponent({ inheritAttrs: false, setup: (_props, { attrs }) => () => Vue.h('section', attrs) })
  const HallStage = Vue.defineComponent({
    props: { interactionLocked: { type: Boolean, default: false } },
    setup: (props, { slots }) => () => Vue.h('section', { class: 'hall-stage-probe', 'data-interaction-locked': String(props.interactionLocked) }, slots.default?.())
  })
  const hallData = {
    applySceneEvent: noop, applySceneSnapshot: noop, agentFilter: text, agents: agentList, bindPersona: asyncNoop, canAssign: () => true,
    filteredAgents: agentList, hiddenAgentCount: Vue.ref(0), loadAgents: asyncNoop, loadTasks: asyncNoop, loadTaskRecommendations: asyncNoop,
    mapAgents: agentList, personaCatalog: list, recommendedAgents: list, setAgentFilter: asyncNoop, setTaskStatusFilter: asyncNoop,
    taskAbilityFilter: text, taskAbilityOptions: list, taskKeyword: text, tasks: list, taskStatusCount: Vue.ref({}), taskStatusFilter: text,
    unbindPersona: asyncNoop, visibleAgents: agentList
  }
  return {
    env: { VITE_JUYITING_VOICE_ENABLED: 'true' },
    capturePanelReturnTarget: () => null, focusHallPanel: noop, isCurrentPanelGeneration: () => true, isSafePanelFocusTarget: () => false,
    resolvePanelReturnTarget: () => null, restorePanelFocus: noop, trapPanelFocus: noop,
    useGlobalStore: () => ({ getJiacn: 'hero', user: { name: 'Tester' }, setTitle: noop, setShowBack: noop, setShowAppBar: noop, setShowMore: noop }),
    useApiStore: () => ({ token: async () => 'token' }), agentApi: {}, chatApi, log: { warn: noop, error: noop }, juyitingGame: {},
    roleDialogues: { default: [''] }, statusFilters: [], taskStatusFilters: [],
    useHallData: ({ selectedAgent }) => { selectedAgent.value = selectedAgentFixture; return hallData },
    useHallExperienceMode: () => ({ experienceMode: Vue.ref(experienceMode), isMobileCoarse: Vue.ref(false), orientationHint: text, orientationRequestPending: Vue.ref(false), requestLandscape: requestLandscape || asyncNoop }),
    useHallPanels: () => ({ panelLayout: Vue.ref('center-modal') }),
    useHallSceneState: () => ({ setMapRuntime: noop, reset: noop, forwardPhaseEvents: asyncNoop }),
    useHallCommandQueue: () => ({ ready: Vue.ref(false), setSimulation: noop }),
    useHallBackendSceneState: () => ({ start: asyncNoop, stop: noop, dispose: noop, reportPhase: noop }),
    useHallSceneDebugBridge: () => ({ republish: noop, stop: noop }),
    useHallSound: () => ({ playAgentSelect: noop, playError: noop, playPanelOpen: noop, playRefresh: noop, playSend: noop, playSuccess: noop, playTap: noop, setSoundEnabled: noop, setSoundSuppressed: noop, soundEnabled: Vue.ref(false) }),
    useHallChatContext: () => ({
      chatContext: Vue.ref(validContext()), chatMentionAgentIds: list, chatMentionAgents: agentList, chatMode: Vue.ref('public'), chatTargetText: Vue.ref('众好汉'),
      enterBountyDiscussion: noop, enterPrivateConversation: noop, resetToPublic: noop, setMentionAgent: noop
    }),
    useHallScene: () => ({ markAgentSpeaking: noop, markDiscussionStarted: noop, markLibraryCitation: noop, markLibrarySearching: noop, markRecommendedAgents: noop, markTaskArchived: noop, markTaskAssigned: noop, markTaskAutoAssigned: noop, markTaskCreated: noop, resetSceneFeedback: noop, sceneAgents: agentList, sceneAgentStyle: () => ({}), sceneHotspots: list, syncAfterPersonaChanged: noop }),
    useHallTaskActions: () => ({ archiveTask: asyncNoop, autoAssignTask: asyncNoop, assignTask: asyncNoop, createTask: asyncNoop }),
    useHallConversation: options => {
      conversationRef.value = useHallConversation(options)
      return conversationRef.value
    },
    useHallVoiceConversation: options => {
      voiceRef.value = useHallVoiceConversation(options)
      return voiceRef.value
    },
    createHallVoiceReplyCorrelation: options => {
      correlationRef.value = createHallVoiceReplyCorrelation(options)
      return correlationRef.value
    },
    useHallLibrary: () => ({ citeLibraryItem: noop, libraryErrorMessage: text, libraryHasSearched: Vue.ref(false), libraryKeyword: text, libraryLoading: Vue.ref(false), libraryResults: list, librarySourceType: text, searchLibrary: asyncNoop }),
    useTaskWorkspace: () => null, createDisabledTaskWorkspaceBinding: () => ({ selectExplicitActor: noop, clearExplicitActor: noop, dispose: noop }),
    isTaskWorkspaceBuildEnabled: () => false, useTaskWorkspaceView: () => ({ subject: Vue.ref(null), workspace: Vue.ref(null), connectionState: text, error: Vue.ref(null), retry: noop }), useTaskWorkspaceBinding: () => ({ selectExplicitActor: noop, clearExplicitActor: noop }),
    portraitName: () => '', portraitRole: () => ({ slug: 'default' }), portraitShortName: agent => agent?.name || '', portraitStyle: () => ({}), roleClass: () => '',
    HallPortraitHome: HallPortraitHomeComponent || EmptyPanel, HallStage, HallVoiceHud: HallVoiceHudComponent || EmptyPanel, LibraryPanel: EmptyPanel, AgentPanel: EmptyPanel, BountyDiscussionPanel: DiscussionPanelComponent || EmptyPanel,
    BountyPanel: EmptyPanel, TaskWorkspacePanel: EmptyPanel, PersonaCatalogPanel: EmptyPanel, PrivateDiscussionPanel: DiscussionPanelComponent || EmptyPanel, PublicDiscussionPanel: DiscussionPanelComponent || EmptyPanel, SelectedAgentCard: SelectedAgentCardComponent || EmptyPanel
  }
}

before(async () => {
  globalThis.__voiceFs = await import('node:fs')
  global.SVGElement = global.window?.SVGElement
  global.Element = global.window?.Element
})

describe('Juyi Hall voice mounted facade', () => {
  it('keeps text chat usable with flag off and renders correct controls with flag on', async () => {
    const HallVoiceControls = loadSfc('../src/components/juyiting/HallVoiceControls.vue')
    const HallChatComposer = loadSfc('../src/components/juyiting/HallChatComposer.vue', { HallVoiceControls })
    const offHarness = browserHarness()
    const offVoice = createVoice({ enabled: false, browser: offHarness.browser }).voice
    const off = mount(HallChatComposer, { props: { draft: '文字仍可发送', mentionLabel: () => '', voice: offVoice }, global: { stubs: { 'var-icon': true } } })
    expect(offVoice.supported).to.equal(false)
    expect(offVoice.voiceInteractionLocked).to.equal(false)
    expect(off.find('textarea').attributes('disabled')).to.equal(undefined)
    expect(off.find('.composer-send').attributes('disabled')).to.equal(undefined)
    expect(off.find('.hall-voice-controls').exists()).to.equal(false)
    off.unmount()

    const onHarness = browserHarness()
    const onVoice = createVoice({ enabled: true, browser: onHarness.browser }).voice
    const on = mount(HallChatComposer, { props: { draft: '', mentionLabel: () => '', voice: onVoice }, global: { stubs: { 'var-icon': true } } })
    expect(onVoice.supported).to.equal(true)
    expect(onVoice.canRecord).to.equal(true)
    expect(on.find('.hall-voice-controls').exists()).to.equal(true)
    expect(on.find('form .hall-voice-controls').exists()).to.equal(false)
    expect(on.find('textarea').attributes('disabled')).to.equal(undefined)
    await on.find('input[type="checkbox"]').setValue(true)
    expect(onVoice.autoSendEnabled).to.equal(true)
    on.unmount()
  })
})

describe('Juyi Hall voice lifecycle', () => {
  it('fences late permission and uniformly stops capture resources on cancel and 5MiB overflow', async () => {
    FakeRecorder.instances = []
    const permission = deferred()
    const harness = browserHarness({ permission: () => permission.promise })
    const captureEvents = []
    const { voice } = createVoice({ browser: harness.browser, captureEvents })
    const starting = voice.startRecording()
    expect(voice.state).to.equal('requesting_permission')
    expect(voice.voiceInteractionLocked).to.equal(true)
    voice.cancel()
    const lateStream = harness.makeStream()
    permission.resolve(lateStream)
    expect(await starting).to.equal(false)
    expect(lateStream.getTracks()[0].stopped).to.equal(true)
    expect(voice.state).to.equal('idle')
    expect(voice.voiceInteractionLocked).to.equal(false)

    await voice.startRecording()
    expect(voice.state).to.equal('recording')
    expect(voice.voiceInteractionLocked).to.equal(true)
    const recorder = FakeRecorder.instances.at(-1)
    recorder.ondataavailable({ data: { size: HALL_VOICE_MAX_AUDIO_BYTES + 1 } })
    expect(voice.state).to.equal('error')
    expect(voice.voiceInteractionLocked).to.equal(false)
    expect(harness.tracks.at(-1).stopped).to.equal(true)
    expect(captureEvents).to.deep.equal([true, false, true, false])
  })

  it('aborts hidden transcribing and locks pending-send conflict review', async () => {
    FakeRecorder.instances = []
    const upload = deferred()
    let uploadSignal
    let uploadCount = 0
    const harness = browserHarness()
    const { voice } = createVoice({
      browser: harness.browser,
      chatCreate: async (_path, _body, options) => {
        uploadCount += 1
        if (uploadCount === 1) { uploadSignal = options.signal; return upload.promise }
        return { data: { data: { text: '林教头请看榜文' } } }
      }
    })
    await voice.startRecording()
    const recorder = FakeRecorder.instances.at(-1)
    recorder.ondataavailable({ data: new Blob(['voice']) })
    voice.stopRecording()
    expect(voice.state).to.equal('stopping')
    expect(voice.voiceInteractionLocked).to.equal(true)
    await flush()
    expect(voice.state).to.equal('transcribing')
    expect(voice.voiceInteractionLocked).to.equal(true)
    harness.browser.document.hidden = true
    harness.documentListeners.get('visibilitychange')()
    expect(uploadSignal.aborted).to.equal(true)
    expect(voice.state).to.equal('idle')
    upload.resolve({ data: { data: { text: 'late' } } })
    await flush()
    expect(voice.transcript).to.equal('')

    voice.setAutoSendEnabled(true)
    await voice.startRecording()
    const nextRecorder = FakeRecorder.instances.at(-1)
    nextRecorder.ondataavailable({ data: new Blob(['voice']) })
    voice.stopRecording()
    await flush()
    expect(voice.state).to.equal('pending_send')
    expect(voice.voiceInteractionLocked).to.equal(true)
    voice.cancel({ preserveReview: true })
    expect(voice.state).to.equal('conflict')
    expect(voice.voiceInteractionLocked).to.equal(true)
    expect(voice.transcript).to.equal('林教头请看榜文')
  })

  it('clears waiting turns on cancel while waiting/TTS/speaking never lock Composer or map', async () => {
    FakeRecorder.instances = []
    const harness = browserHarness()
    const { voice } = createVoice({ browser: harness.browser })
    await transcribeToReview(voice)
    const sending = voice.sendTranscript()
    await sending
    expect(voice.state).to.equal('waiting_reply')
    expect(voice.voiceTurnActive).to.equal(true)
    expect(voice.voiceInteractionLocked).to.equal(false)
    voice.cancel()
    expect(voice.state).to.equal('idle')
    expect(voice.voiceTurnActive).to.equal(false)
  })
})

describe('Juyi Hall voice current-generation abort recovery', () => {
  it('terminally recovers from direct STT and TTS AbortError failures', async () => {
    FakeRecorder.instances = []
    const sttHarness = browserHarness()
    const sttVoice = createVoice({
      browser: sttHarness.browser,
      chatCreate: async () => { throw new DOMException('transcription aborted', 'AbortError') }
    }).voice
    await sttVoice.startRecording()
    const recorder = FakeRecorder.instances.at(-1)
    recorder.ondataavailable({ data: new Blob(['voice']) })
    sttVoice.stopRecording()
    await flush()
    expect(sttVoice.state).to.equal('error')
    expect(sttVoice.error).to.equal('语音转写已中止，仍可使用文字传令')
    expect(sttVoice.voiceInteractionLocked).to.equal(false)
    expect(sttVoice.canRecord).to.equal(true)
    sttVoice.dispose()

    const ttsHarness = browserHarness({
      fetchImpl: async () => { throw new DOMException('synthesis aborted', 'AbortError') }
    })
    const terminals = []
    const ttsVoice = createVoice({ browser: ttsHarness.browser, onReplyTurnTerminal: payload => terminals.push(payload) }).voice
    ttsVoice.setReplyVoiceEnabled(true)
    await transcribeToReview(ttsVoice)
    await ttsVoice.sendTranscript()
    expect(await ttsVoice.completeReply({ content: '回话' })).to.equal(false)
    expect(ttsVoice.state).to.equal('error')
    expect(ttsVoice.error).to.equal('语音回答已中止，文字已保留')
    expect(ttsVoice.voiceTurnActive).to.equal(false)
    expect(terminals).to.have.length(1)
    expect(terminals[0].turnId).to.be.a('string').and.not.equal('')
    expect(ttsVoice.canRecord).to.equal(true)
    ttsVoice.dispose()
  })
})

describe('Juyi Hall voice identity and capture controls', () => {
  it('fails closed on identity cleanup across permission, capture, transcription, reply, and TTS late callbacks', async () => {
    FakeRecorder.instances = []
    const permission = deferred()
    const permissionHarness = browserHarness({ permission: () => permission.promise })
    const permissionVoice = createVoice({ browser: permissionHarness.browser }).voice
    const requesting = permissionVoice.startRecording()
    expect(permissionVoice.state).to.equal('requesting_permission')
    stopIdentityBoundWork()
    expect(permissionVoice.state).to.equal('idle')
    const latePermissionStream = permissionHarness.makeStream()
    permission.resolve(latePermissionStream)
    expect(await requesting).to.equal(false)
    expect(latePermissionStream.getTracks()[0].stopped).to.equal(true)
    permissionVoice.dispose()

    let uploads = 0
    const stoppingHarness = browserHarness()
    const stoppingVoice = createVoice({
      browser: stoppingHarness.browser,
      chatCreate: async () => { uploads += 1; return { data: { data: { text: '不应上传' } } } }
    }).voice
    await stoppingVoice.startRecording()
    const stoppingRecorder = FakeRecorder.instances.at(-1)
    stoppingRecorder.ondataavailable({ data: new Blob(['voice']) })
    stoppingVoice.stopRecording()
    expect(stoppingVoice.state).to.equal('stopping')
    stopIdentityBoundWork()
    await flush()
    expect(stoppingVoice.state).to.equal('idle')
    expect(stoppingHarness.tracks.at(-1).stopped).to.equal(true)
    expect(uploads).to.equal(0)
    stoppingVoice.dispose()

    const transcription = deferred()
    let transcriptionSignal
    const transcriptionHarness = browserHarness()
    const transcriptionVoice = createVoice({
      browser: transcriptionHarness.browser,
      chatCreate: async (_path, _body, options) => {
        transcriptionSignal = options.signal
        return transcription.promise
      }
    }).voice
    await transcriptionVoice.startRecording()
    const transcriptionRecorder = FakeRecorder.instances.at(-1)
    transcriptionRecorder.ondataavailable({ data: new Blob(['voice']) })
    transcriptionVoice.stopRecording()
    await flush()
    expect(transcriptionVoice.state).to.equal('transcribing')
    stopIdentityBoundWork()
    expect(transcriptionSignal.aborted).to.equal(true)
    expect(transcriptionVoice.state).to.equal('idle')
    transcription.resolve({ data: { data: { text: '迟到转写' } } })
    await flush()
    expect(transcriptionVoice.transcript).to.equal('')
    transcriptionVoice.dispose()

    const tts = deferred()
    let ttsSignal
    const replyHarness = browserHarness({ fetchImpl: async (_url, options) => {
      ttsSignal = options.signal
      return tts.promise
    } })
    const replyVoice = createVoice({ browser: replyHarness.browser }).voice
    replyVoice.setReplyVoiceEnabled(true)
    await transcribeToReview(replyVoice)
    await replyVoice.sendTranscript()
    const synthesizing = replyVoice.completeReply({ content: '回话' })
    await flush()
    expect(replyVoice.state).to.equal('synthesizing')
    stopIdentityBoundWork()
    expect(ttsSignal.aborted).to.equal(true)
    expect(replyVoice.state).to.equal('idle')
    expect(replyVoice.transcript).to.equal('')
    expect(replyVoice.voiceTurnActive).to.equal(false)
    tts.resolve({
      ok: true,
      headers: new Headers({ 'content-type': 'audio/mpeg', 'content-length': '3' }),
      body: new ReadableStream({ start (controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close() } })
    })
    expect(await synthesizing).to.equal(false)
    expect(replyVoice.state).to.equal('idle')
    replyVoice.dispose()
  })

  it('keeps cancel-and-discard reachable through every capture phase, with stop and cancel during recording', async () => {
    const HallVoiceControls = loadSfc('../src/components/juyiting/HallVoiceControls.vue')
    for (const state of ['requesting_permission', 'recording', 'stopping', 'transcribing']) {
      let cancelled = 0
      let stopped = 0
      const voice = Vue.reactive({
        supported: true,
        state,
        recording: state === 'recording',
        canRecord: false,
        elapsedMs: 1_000,
        autoSendEnabled: false,
        replyVoiceEnabled: false,
        targetLabel: '众好汉',
        startRecording: () => {},
        stopRecording: () => { stopped += 1 },
        cancel: () => { cancelled += 1 },
        setAutoSendEnabled: () => {},
        setReplyVoiceEnabled: () => {}
      })
      const wrapper = mount(HallVoiceControls, { props: { voice }, global: { stubs: { 'var-icon': true } } })
      expect(wrapper.get('.voice-cancel').attributes('aria-label')).to.equal('取消并丢弃录音')
      await wrapper.get('.voice-cancel').trigger('click')
      expect(cancelled).to.equal(1)
      if (state === 'recording') {
        expect(wrapper.get('.is-recording').attributes('aria-label')).to.equal('停止录音并转写')
        await wrapper.get('.is-recording').trigger('click')
        expect(stopped).to.equal(1)
      }
      wrapper.unmount()
    }

    let uploads = 0
    const harness = browserHarness()
    const voice = createVoice({
      browser: harness.browser,
      chatCreate: async () => { uploads += 1; return { data: { data: { text: '不应上传' } } } }
    }).voice
    await voice.startRecording()
    const recorder = FakeRecorder.instances.at(-1)
    recorder.ondataavailable({ data: new Blob(['voice']) })
    const wrapper = mount(HallVoiceControls, { props: { voice }, global: { stubs: { 'var-icon': true } } })
    await wrapper.get('.voice-cancel').trigger('click')
    await flush()
    expect(voice.state).to.equal('idle')
    expect(uploads).to.equal(0)
    wrapper.unmount()
    voice.dispose()
  })
  it('balances dispose registration and identity-cleans countdown, reply timers, and speaking playback', async () => {
    const handlersBefore = identityCleanupHandlerCount()
    const disposable = createVoice({ browser: browserHarness().browser }).voice
    expect(identityCleanupHandlerCount()).to.equal(handlersBefore + 1)
    disposable.dispose()
    disposable.dispose()
    expect(identityCleanupHandlerCount()).to.equal(handlersBefore)

    const countdownIntervals = []
    const countdownHarness = browserHarness()
    countdownHarness.browser.window.setInterval = (callback, delay) => {
      const timer = { callback, delay, cleared: false }
      countdownIntervals.push(timer)
      return timer
    }
    countdownHarness.browser.window.clearInterval = timer => { if (timer) timer.cleared = true }
    const countdownVoice = createVoice({ browser: countdownHarness.browser }).voice
    countdownVoice.setAutoSendEnabled(true)
    await countdownVoice.startRecording()
    let recorder = FakeRecorder.instances.at(-1)
    recorder.ondataavailable({ data: new Blob(['voice']) })
    countdownVoice.stopRecording()
    await flush()
    expect(countdownVoice.state).to.equal('pending_send')
    const countdownTimer = countdownIntervals.find(timer => timer.delay === 50 && !timer.cleared)
    expect(countdownTimer, 'active auto-send countdown').to.exist

    const replyTimers = []
    const replyHarness = browserHarness()
    replyHarness.browser.window.setTimeout = (callback, delay) => {
      const timer = { callback, delay, cleared: false }
      replyTimers.push(timer)
      return timer
    }
    replyHarness.browser.window.clearTimeout = timer => { if (timer) timer.cleared = true }
    const replyVoice = createVoice({ browser: replyHarness.browser }).voice
    await transcribeToReview(replyVoice)
    await replyVoice.sendTranscript()
    const replyTimer = replyTimers.find(timer => timer.delay === 120_000 && !timer.cleared)
    expect(replyTimer, 'active reply watchdog').to.exist

    class SpeakingAudio {
      constructor () { SpeakingAudio.instance = this; this.paused = false }
      play = async () => {}
      pause () { this.paused = true }
    }
    const speakingHarness = browserHarness({
      AudioClass: SpeakingAudio,
      fetchImpl: async () => ({
        ok: true,
        headers: new Headers({ 'content-type': 'audio/mpeg', 'content-length': '3' }),
        body: new ReadableStream({ start (controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close() } })
      })
    })
    const speakingVoice = createVoice({ browser: speakingHarness.browser }).voice
    speakingVoice.setReplyVoiceEnabled(true)
    await transcribeToReview(speakingVoice)
    await speakingVoice.sendTranscript()
    await speakingVoice.completeReply({ content: '回话' })
    expect(speakingVoice.state).to.equal('speaking')

    stopIdentityBoundWork()
    expect(countdownTimer.cleared).to.equal(true)
    expect(countdownVoice.countdownMs).to.equal(0)
    expect(countdownVoice.state).to.equal('idle')
    expect(replyTimer.cleared).to.equal(true)
    expect(replyVoice.voiceTurnActive).to.equal(false)
    expect(replyVoice.state).to.equal('idle')
    expect(SpeakingAudio.instance.paused).to.equal(true)
    expect(speakingHarness.revoked).to.deep.equal(['blob:voice'])
    expect(speakingVoice.state).to.equal('idle')

    countdownVoice.dispose()
    replyVoice.dispose()
    speakingVoice.dispose()
  })
})

describe('Juyi Hall portrait voice lock', () => {
  it('keeps cancellation reachable and rejects panel/context changes while capture is locked', async () => {
    FakeRecorder.instances = []
    const originalMediaRecorder = globalThis.MediaRecorder
    const originalMediaDevices = globalThis.navigator.mediaDevices
    const permission = deferred()
    const streams = []
    let permissionRequests = 0
    let landscapeRequests = 0
    let uploadSignal
    const upload = deferred()
    const selectedAgentFixture = { agentId: 'wuyong', name: '吴用', status: 'idle', boundToMe: true, canOperate: true, systemAgent: false }
    const alternateAgent = { agentId: 'linchong', name: '林冲', status: 'idle', boundToMe: true, canOperate: true, systemAgent: false }
    const makeStream = () => {
      const track = { stopped: false, onended: null, stop () { this.stopped = true } }
      const stream = { getTracks: () => [track] }
      streams.push(stream)
      return stream
    }
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => {
        permissionRequests += 1
        if (permissionRequests === 1) return permission.promise
        return makeStream()
      } }
    })
    globalThis.MediaRecorder = FakeRecorder

    const HallVoiceControls = loadSfc('../src/components/juyiting/HallVoiceControls.vue')
    const HallVoiceHud = loadSfc('../src/components/juyiting/HallVoiceHud.vue', { HallVoiceControls })
    const HallPortraitHome = Vue.defineComponent({
      inheritAttrs: false,
      props: { selectedAgent: { type: Object, default: null }, selectedTask: { type: Object, default: null } },
      emits: ['open-task', 'quick-action', 'request-landscape', 'select-agent'],
      setup: (props, { attrs, emit }) => () => Vue.h('main', { ...attrs, class: 'portrait-home-probe', 'data-selected-agent': props.selectedAgent?.agentId || '', 'data-selected-task': props.selectedTask?.id || '' }, [
        Vue.h('button', { class: 'portrait-open-chat', onClick: () => emit('quick-action', 'discussion') }, 'chat'),
        Vue.h('button', { class: 'portrait-switch-panel', onClick: () => emit('quick-action', 'agents') }, 'agents'),
        Vue.h('button', { class: 'portrait-select-agent', onClick: () => emit('select-agent', alternateAgent) }, 'select'),
        Vue.h('button', { class: 'portrait-open-task', onClick: () => emit('open-task', { id: 'task-late', title: '迟到榜文' }) }, 'task'),
        Vue.h('button', { class: 'portrait-landscape', onClick: () => emit('request-landscape') }, 'landscape')
      ])
    })
    const DiscussionPanel = Vue.defineComponent({
      props: { voice: { type: Object, default: null } },
      setup: props => () => Vue.h('section', { class: 'discussion-probe' }, [Vue.h(HallVoiceControls, { voice: props.voice })])
    })
    const conversationRef = { value: null }
    const correlationRef = { value: null }
    const voiceRef = { value: null }
    const chatApi = {
      create: async (path, _body, options) => {
        expect(path).to.equal('/speech/transcriptions')
        uploadSignal = options.signal
        return upload.promise
      },
      list: async () => {},
      getById: async () => {}
    }
    const JuyiHall = loadActualJuyiHall(createActualHallVoiceMocks({
      chatApi,
      conversationRef,
      correlationRef,
      selectedAgentFixture,
      HallPortraitHomeComponent: HallPortraitHome,
      DiscussionPanelComponent: DiscussionPanel,
      HallVoiceHudComponent: HallVoiceHud,
      experienceMode: 'portrait-command',
      requestLandscape: async () => { landscapeRequests += 1 },
      voiceRef
    }))
    const wrapper = mount(JuyiHall, { attachTo: document.body, global: { stubs: { 'var-icon': true, transition: true } } })
    try {
      await flush()
      await wrapper.get('.portrait-open-chat').trigger('click')
      await flush()
      expect(wrapper.find('.panel-chat').exists()).to.equal(true)

      const requesting = voiceRef.value.startRecording()
      expect(voiceRef.value.state).to.equal('requesting_permission')
      await flush()
      expect(wrapper.get('.panel-close').attributes('disabled')).to.equal('')
      expect(wrapper.get('.portrait-home-probe').attributes('inert')).to.equal('')
      expect(wrapper.find('.panel-chat .voice-cancel').exists()).to.equal(true)
      await wrapper.get('.panel-close').trigger('click')
      await wrapper.get('.panel-overlay').trigger('pointerdown')
      await wrapper.get('.floating-panel').trigger('keydown', { key: 'Escape' })
      await wrapper.get('.portrait-switch-panel').trigger('click')
      await wrapper.get('.portrait-select-agent').trigger('click')
      await wrapper.get('.portrait-open-task').trigger('click')
      await wrapper.get('.portrait-landscape').trigger('click')
      expect(wrapper.find('.panel-chat').exists()).to.equal(true)
      expect(wrapper.get('.portrait-home-probe').attributes('data-selected-agent')).to.equal('wuyong')
      expect(wrapper.get('.portrait-home-probe').attributes('data-selected-task')).to.equal('')
      expect(landscapeRequests).to.equal(0)

      await wrapper.get('.panel-chat .voice-cancel').trigger('click')
      const lateStream = makeStream()
      permission.resolve(lateStream)
      expect(await requesting).to.equal(false)
      expect(lateStream.getTracks()[0].stopped).to.equal(true)
      expect(wrapper.find('.panel-overlay').exists()).to.equal(true)

      await voiceRef.value.startRecording()
      const recorder = FakeRecorder.instances.at(-1)
      recorder.ondataavailable({ data: new Blob(['voice']) })
      voiceRef.value.stopRecording()
      await flush()
      expect(voiceRef.value.state).to.equal('transcribing')
      expect(wrapper.get('.panel-close').attributes('disabled')).to.equal('')
      expect(wrapper.find('.panel-chat .voice-cancel').exists()).to.equal(true)
      await wrapper.get('.panel-overlay').trigger('pointerdown')
      await wrapper.get('.floating-panel').trigger('keydown', { key: 'Escape' })
      expect(wrapper.find('.panel-chat').exists()).to.equal(true)
      await wrapper.get('.panel-chat .voice-cancel').trigger('click')
      expect(uploadSignal.aborted).to.equal(true)
      upload.resolve({ data: { data: { text: '迟到转写' } } })
      await flush()
      expect(voiceRef.value.state).to.equal('idle')
      expect(voiceRef.value.transcript).to.equal('')

      await wrapper.get('.panel-close').trigger('click')
      await flush()
      expect(wrapper.find('.panel-overlay').exists()).to.equal(false)
      await voiceRef.value.startRecording()
      await flush()
      expect(wrapper.find('.hall-voice-hud .voice-cancel').exists()).to.equal(true)
      expect(wrapper.get('.portrait-home-probe').attributes('inert')).to.equal('')
      await wrapper.get('.hall-voice-hud .voice-cancel').trigger('click')
      expect(voiceRef.value.state).to.equal('idle')
    } finally {
      wrapper.unmount()
      Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices })
      globalThis.MediaRecorder = originalMediaRecorder
    }
  })
})

describe('Juyi Hall voice CAS and reply correlation', () => {
  it('fails closed on non-string IDs and preserves null/empty/missing distinctions', () => {
    expect(captureHallVoiceSnapshot({ context: validContext({ targetAgentId: 12 }), draft: '', draftRevision: 0 })).to.equal(null)
    const nullId = captureHallVoiceSnapshot({ context: validContext({ taskId: null }), draft: '', draftRevision: 0 })
    const emptyId = captureHallVoiceSnapshot({ context: validContext({ taskId: '' }), draft: '', draftRevision: 0 })
    const missing = validContext(); delete missing.taskId
    const missingId = captureHallVoiceSnapshot({ context: missing, draft: '', draftRevision: 0 })
    expect(nullId.cas).not.to.equal(emptyId.cas)
    expect(nullId.cas).not.to.equal(missingId.cas)
  })

  it('requires a fresh CAS before applying review and supports explicit adoption under the current context', async () => {
    FakeRecorder.instances = []
    const harness = browserHarness()
    const current = createVoice({ browser: harness.browser })
    await transcribeToReview(current.voice)
    current.setContext(validContext({ conversationScopeKey: 'changed-scope' }))
    expect(current.voice.applyTranscript('replace')).to.equal(false)
    expect(current.voice.state).to.equal('conflict')
    expect(current.voice.detached).to.equal(true)
    expect(current.voice.adoptCurrentContext()).to.equal(true)
    expect(current.voice.applyTranscript('replace')).to.equal('林教头请看榜文')
    current.voice.discard()
  })

  it('queues a synchronous final until voice send acceptance reaches a terminal state', async () => {
    FakeRecorder.instances = []
    const harness = browserHarness()
    let voice
    ;({ voice } = createVoice({
      browser: harness.browser,
      onSendVoice: async () => {
        expect(voice.completeReply({ content: '同步完整回话' })).to.equal(true)
        return true
      }
    }))
    await transcribeToReview(voice)
    expect(await voice.sendTranscript()).to.equal(true)
    await flush()
    expect(voice.state).to.equal('idle')
    expect(voice.voiceTurnActive).to.equal(false)
    expect(voice.transcript).to.equal('')
  })

  it('keeps the frozen target label visible until the reply turn is terminal', async () => {
    FakeRecorder.instances = []
    const harness = browserHarness()
    const current = createVoice({ browser: harness.browser, context: validContext({ targetLabel: '冻结目标甲' }) })
    await transcribeToReview(current.voice)
    expect(await current.voice.sendTranscript()).to.equal(true)
    current.setContext(validContext({ targetLabel: '当前目标乙' }))
    expect(current.voice.state).to.equal('waiting_reply')
    expect(current.voice.targetLabel).to.equal('冻结目标甲')
    await current.voice.completeReply({ content: '完整回话' })
    expect(current.voice.state).to.equal('idle')
    expect(current.voice.targetLabel).to.equal('当前目标乙')
  })

  it('does not carry a synchronous final from a rejected send into a retry', async () => {
    FakeRecorder.instances = []
    const harness = browserHarness()
    let attempts = 0
    let voice
    ;({ voice } = createVoice({
      browser: harness.browser,
      onSendVoice: async () => {
        attempts += 1
        if (attempts === 1) {
          voice.completeReply({ content: '失败发送的旧回话' })
          return false
        }
        return true
      }
    }))
    await transcribeToReview(voice)
    expect(await voice.sendTranscript()).to.equal(false)
    expect(voice.state).to.equal('conflict')
    expect(voice.adoptCurrentContext()).to.equal(true)
    expect(await voice.sendTranscript()).to.equal(true)
    expect(voice.state).to.equal('waiting_reply')
    voice.cancel()
  })

  it('closes reply correlation at 120 seconds without TTS and permits the next turn', async () => {
    FakeRecorder.instances = []
    const timers = []
    let ttsFetches = 0
    const harness = browserHarness({ fetchImpl: async () => { ttsFetches += 1; throw new Error('late reply must not synthesize') } })
    harness.browser.window.setTimeout = (callback, delay) => {
      const timer = { callback, delay, cleared: false }
      timers.push(timer)
      return timer
    }
    harness.browser.window.clearTimeout = timer => { if (timer) timer.cleared = true }
    const terminals = []
    let sequence = 0
    let voice
    const tracker = createHallVoiceReplyCorrelation({
      onReply: message => voice.completeReply(message)
    })
    ;({ voice } = createVoice({
      browser: harness.browser,
      onSendVoice: async ({ turnId }) => {
        const started = tracker.start({
          turnId,
          baselineSequence: sequence,
          messages: [],
          conversationIdBeforeSend: 'conversation-timeout'
        })
        if (started) tracker.resolveConversation('conversation-timeout')
        return started
      },
      onReplyTurnTerminal: payload => {
        terminals.push(payload)
        tracker.close(payload.reason)
      }
    }))
    voice.setReplyVoiceEnabled(true)

    await transcribeToReview(voice)
    expect(await voice.sendTranscript()).to.equal(true)
    expect(voice.state).to.equal('waiting_reply')
    expect(tracker.hasActive()).to.equal(true)
    const timeout = timers.find(timer => timer.delay === 120_000 && !timer.cleared)
    expect(timeout, '120-second reply timeout').to.exist
    timeout.callback()

    expect(voice.state).to.equal('idle')
    expect(voice.voiceTurnActive).to.equal(false)
    expect(tracker.hasActive()).to.equal(false)
    expect(terminals.at(-1)?.reason).to.equal('reply_timeout')
    sequence += 1
    expect(tracker.observe({
      sequence,
      conversationId: 'conversation-timeout',
      messageId: 'late-final',
      source: 'stream_end',
      message: { content: '迟到回话' }
    })).to.equal(false)
    expect(ttsFetches).to.equal(0)

    await transcribeToReview(voice)
    expect(await voice.sendTranscript()).to.equal(true)
    expect(voice.state).to.equal('waiting_reply')
    expect(tracker.hasActive()).to.equal(true)
    voice.cancel()
  })

  it('keeps mounted Hall locked while sending and preserves turn B when timed-out turn A settles late', async () => {
    FakeRecorder.instances = []
    const originalMediaRecorder = globalThis.MediaRecorder
    const originalMediaDevices = globalThis.navigator.mediaDevices
    const originalAudio = globalThis.Audio
    const originalFetch = globalThis.fetch
    const originalSetTimeout = window.setTimeout
    const originalClearTimeout = window.clearTimeout
    const timers = []
    const streams = []
    const tracks = []
    let transcriptionCount = 0
    let ttsFetches = 0
    let audioPlays = 0
    let audioInstance
    const conversationRef = { value: null }
    const correlationRef = { value: null }
    const voiceRef = { value: null }
    const selectedAgentFixture = { agentId: 'wuyong', name: '吴用', status: 'idle', boundToMe: true, canOperate: true, systemAgent: false }
    const SelectedAgentCardComponent = loadSfc('../src/components/juyiting/SelectedAgentCard.vue')
    const chatApi = {
      create: async (path, _payload, options) => {
        if (path === '/speech/transcriptions') {
          transcriptionCount += 1
          return { data: { data: { text: transcriptionCount === 1 ? '甲轮传令' : '乙轮传令' } } }
        }
        expect(path).to.equal('/stream')
        const pending = deferred()
        const entry = { options, pending, cancelReason: null }
        streams.push(entry)
        options.onStreamOpen({ cancel: reason => { entry.cancelReason = reason } })
        return pending.promise
      },
      list: async () => {},
      getById: async () => {}
    }
    window.setTimeout = (callback, delay) => {
      const timer = { callback, delay, cleared: false }
      timers.push(timer)
      return timer
    }
    window.clearTimeout = timer => { if (timer) timer.cleared = true }
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => {
        const track = { stopped: false, onended: null, stop () { this.stopped = true } }
        tracks.push(track)
        return { getTracks: () => [track] }
      } }
    })
    globalThis.MediaRecorder = FakeRecorder
    globalThis.Audio = class {
      constructor () { audioInstance = this }
      play = async () => { audioPlays += 1 }
      pause () {}
    }
    globalThis.fetch = async url => {
      if (!String(url).includes('/chat/speech/synthesis')) return new Response(null, { status: 204 })
      ttsFetches += 1
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': '3' } })
    }
    const JuyiHall = loadActualJuyiHall(createActualHallVoiceMocks({
      chatApi, conversationRef, correlationRef, selectedAgentFixture, SelectedAgentCardComponent, voiceRef
    }))
    const wrapper = mount(JuyiHall, { attachTo: document.body, global: { stubs: { 'var-icon': true, transition: true } } })
    try {
      await flush()
      const voice = voiceRef.value
      const conversation = conversationRef.value
      const map = () => wrapper.get('.hall-stage-probe')
      const card = () => wrapper.get('.selected-agent-card')
      voice.setReplyVoiceEnabled(true)
      expect(voice.supported).to.equal(true)
      expect(voice.canRecord).to.equal(true)

      await transcribeToReview(voice)
      expect(wrapper.find('.panel-overlay').exists()).to.equal(false)
      const sendA = voice.sendTranscript()
      await flush()
      expect(streams).to.have.length(1)
      expect(voice.state).to.equal('sending')
      expect(voice.voiceInteractionLocked).to.equal(true)
      expect(map().attributes('data-interaction-locked')).to.equal('true')
      expect(card().attributes('inert')).to.equal('')
      card().findAll('button').forEach(button => expect(button.attributes('disabled')).to.equal(''))
      expect(streams[0].options.timeout).to.equal(1_800_000)
      const turnA = correlationRef.value.snapshot().turnId
      const watchdogA = timers.find(timer => timer.delay === 120_000 && !timer.cleared)
      expect(watchdogA, 'turn A watchdog must exist while send is pending').to.exist
      watchdogA.callback()
      await flush()

      expect(voice.state).to.equal('idle')
      expect(conversation.isStreaming.value).to.equal(false)
      expect(conversation.isAwaitingReply.value).to.equal(false)
      expect(correlationRef.value.hasActive()).to.equal(false)
      expect(streams[0].options.signal.aborted).to.equal(true)
      expect(streams[0].cancelReason?.name).to.equal('AbortError')
      expect(card().attributes('inert')).to.equal(undefined)

      await transcribeToReview(voice)
      expect(wrapper.find('.panel-overlay').exists()).to.equal(false)
      const sendB = voice.sendTranscript()
      await flush()
      expect(streams).to.have.length(2)
      expect(voice.state).to.equal('sending')
      expect(map().attributes('data-interaction-locked')).to.equal('true')
      expect(card().attributes('inert')).to.equal('')
      const turnB = correlationRef.value.snapshot().turnId
      expect(turnB).not.to.equal(turnA)

      streams[0].pending.resolve()
      expect(await sendA).to.equal(false)
      expect(correlationRef.value.snapshot().turnId).to.equal(turnB)
      expect(conversation.isStreaming.value).to.equal(true)
      expect(conversation.isAwaitingReply.value).to.equal(true)
      expect(ttsFetches).to.equal(0)

      const finalB = JSON.stringify({
        type: 'agent_message', conversationId: 'conversation-b', messageId: 'reply-b', agentId: 'wuyong',
        senderType: 'agent', senderName: '吴用', content: '乙轮完整回话', timestamp: 1788000000000
      })
      streams[1].options.onStream(finalB)
      streams[1].options.onStream(JSON.stringify({ conversationId: 'conversation-b' }))
      streams[1].options.onStreamEnd()
      streams[1].pending.resolve()
      expect(await sendB).to.equal(true)
      await flush()

      expect(conversation.replyEventSequence.value).to.equal(1)
      expect(correlationRef.value.hasActive()).to.equal(false)
      expect(ttsFetches).to.equal(1)
      expect(audioPlays).to.equal(1)
      expect(voice.state).to.equal('speaking')
      expect(voice.voiceInteractionLocked).to.equal(false)
      expect(card().attributes('inert')).to.equal(undefined)

      streams[1].options.onStream(finalB)
      streams[1].options.onStreamEnd()
      await flush()
      expect(conversation.replyEventSequence.value).to.equal(1)
      expect(ttsFetches).to.equal(1)
      expect(audioPlays).to.equal(1)
      audioInstance.onended()
      expect(voice.state).to.equal('idle')
    } finally {
      wrapper.unmount()
      window.setTimeout = originalSetTimeout
      window.clearTimeout = originalClearTimeout
      Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices })
      globalThis.MediaRecorder = originalMediaRecorder
      globalThis.Audio = originalAudio
      globalThis.fetch = originalFetch
    }
  })

  it('accepts exactly one new correlated final across built-in/external ordering and rejects replay', () => {
    const spoken = new Set(['already-spoken'])
    const accepted = []
    const tracker = createHallVoiceReplyCorrelation({ spokenMessageIds: spoken, onReply: (_message, turn, payload) => accepted.push({ turn, payload }) })
    expect(tracker.start({ turnId: 'turn-1', baselineSequence: 7, messages: [{ localId: 'old-1' }], conversationIdBeforeSend: '' })).to.equal('turn-1')
    expect(tracker.closeIfCurrent('stale-turn', 'late_send_failed')).to.equal(false)
    expect(tracker.resolveConversation('wrong-conversation', 'stale-turn')).to.equal(false)
    expect(tracker.snapshot().turnId).to.equal('turn-1')
    expect(tracker.observe({ sequence: 8, conversationId: 'c1', messageId: 'new-agent', source: 'agent_event', message: { content: 'too early' } })).to.equal(false)
    expect(tracker.resolveConversation('c1')).to.equal(true)
    expect(tracker.observe({ sequence: 9, conversationId: 'c1', messageId: 'old-1', source: 'poll_final', message: { content: 'old replay' } })).to.equal(false)
    expect(tracker.observe({ sequence: 10, conversationId: 'c1', messageId: 'new-agent', source: 'agent_event', message: { content: 'external final' } })).to.equal(true)
    expect(tracker.observe({ sequence: 11, conversationId: 'c1', messageId: 'built-in', source: 'stream_end', message: { content: 'late built-in' } })).to.equal(false)
    expect(accepted).to.have.length(1)
    expect(spoken.has('new-agent')).to.equal(true)
  })

  it('sends exact frozen context/metadata, falls back empty mentions to targets, and clears the original draft by revision', async () => {
    const payloads = []
    const outgoingMetadata = Vue.ref({ libraryCitationId: 'archive-1' })
    const conversation = useHallConversation({
      apiStore: { token: async () => '' },
      chatApi: { create: async (_path, payload, options) => { payloads.push(payload); options.onStream('{"conversationId":"frozen-conversation"}'); options.onStreamEnd() } },
      chatContext: Vue.ref(validContext()),
      chatMode: Vue.ref('private'),
      globalStore: { getJiacn: 'hero', user: { name: 'Tester' } },
      log: { warn: () => {}, error: () => {} }, openPanel: () => {}, outgoingMetadata,
      portraitShortName: () => '', selectedAgent: Vue.ref({ agentId: 'current-agent' }), selectedTask: Vue.ref({ id: 'current-task' }), showToast: () => {}
    })
    conversation.setDraft('original draft')
    const frozenRevision = conversation.draftRevision.value
    const frozen = captureHallVoiceSnapshot({
      context: validContext({
        conversationId: 'frozen-conversation', conversationScopeType: 'private', conversationScopeKey: 'agent:frozen-agent', mode: 'private',
        targetAgentIds: ['frozen-agent'], targetAgentId: 'frozen-agent', participantAgentIds: ['frozen-agent'], mentionAgentIds: [],
        selectedAgentId: 'frozen-agent', selectedTaskId: 'frozen-task', taskId: 'frozen-task', outgoingMetadata: { frozen: { z: 1 } }
      }),
      draft: 'original draft',
      draftRevision: frozenRevision
    })
    const accepted = await conversation.sendHallMessage({ content: 'original draft\nvoice text', contextSnapshot: frozen, source: 'voice', clearDraftRevision: frozenRevision })
    expect(accepted).to.equal(true)
    expect(payloads[0]).to.deep.include({ conversationId: 'frozen-conversation', conversationScopeKey: 'agent:frozen-agent', targetAgentId: 'frozen-agent', taskId: 'frozen-task' })
    expect(payloads[0].metadata).to.deep.include({ selectedAgentId: 'frozen-agent', selectedTaskId: 'frozen-task' })
    expect(payloads[0].metadata.mentionAgentIds).to.deep.equal(['frozen-agent'])
    expect(payloads[0].metadata.frozen).to.deep.equal({ z: 1 })
    expect(conversation.draft.value).to.equal('')
    conversation.disposeHallConversation()
  })
})

describe('Juyi Hall TTS cleanup', () => {
  const audioResponse = () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'audio/mpeg', 'content-length': '3' }),
    body: new ReadableStream({ start (controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close() } })
  })

  it('revokes object URLs on play rejection and media error', async () => {
    class RejectAudio { constructor () { RejectAudio.instance = this } play = async () => { throw new Error('autoplay denied') }; pause () {} }
    let harness = browserHarness({ AudioClass: RejectAudio, fetchImpl: async () => audioResponse() })
    let voice = createVoice({ browser: harness.browser }).voice
    voice.setReplyVoiceEnabled(true)
    await transcribeToReview(voice)
    await voice.sendTranscript()
    await voice.completeReply({ content: 'reply' })
    expect(voice.state).to.equal('error')
    expect(harness.revoked).to.deep.equal(['blob:voice'])

    class ErrorAudio { constructor () { ErrorAudio.instance = this } play = async () => {}; pause () {} }
    harness = browserHarness({ AudioClass: ErrorAudio, fetchImpl: async () => audioResponse() })
    voice = createVoice({ browser: harness.browser }).voice
    voice.setReplyVoiceEnabled(true)
    await transcribeToReview(voice)
    await voice.sendTranscript()
    await voice.completeReply({ content: 'reply' })
    expect(voice.state).to.equal('speaking')
    ErrorAudio.instance.onerror()
    expect(voice.state).to.equal('error')
    expect(harness.revoked).to.deep.equal(['blob:voice'])
  })

  it('routes a zero-byte successful TTS response through terminal error cleanup', async () => {
    const emptyResponse = {
      ok: true,
      headers: new Headers({ 'content-type': 'audio/mpeg', 'content-length': '0' }),
      body: new ReadableStream({ start (controller) { controller.close() } })
    }
    const harness = browserHarness({ fetchImpl: async () => emptyResponse })
    const voice = createVoice({ browser: harness.browser }).voice
    voice.setReplyVoiceEnabled(true)
    await transcribeToReview(voice)
    await voice.sendTranscript()
    expect(await voice.completeReply({ content: '回话' })).to.equal(false)
    expect(voice.state).to.equal('error')
    expect(voice.error).to.equal('语音回答为空，文字已保留')
    expect(voice.voiceTurnActive).to.equal(false)
    expect(voice.canRecord).to.equal(true)
    voice.dispose()
  })

  it('stops speaking playback when a new recording starts', async () => {
    class PlayingAudio { constructor () { PlayingAudio.instance = this; this.paused = false } play = async () => {}; pause () { this.paused = true } }
    const response = deferred()
    const harness = browserHarness({ AudioClass: PlayingAudio, fetchImpl: async () => response.promise })
    const { voice } = createVoice({ browser: harness.browser })
    voice.setReplyVoiceEnabled(true)
    await transcribeToReview(voice)
    await voice.sendTranscript()
    const completing = voice.completeReply({ content: 'reply' })
    await flush()
    expect(voice.state).to.equal('synthesizing')
    expect(voice.voiceInteractionLocked).to.equal(false)
    response.resolve(audioResponse())
    await completing
    expect(voice.state).to.equal('speaking')
    expect(voice.voiceInteractionLocked).to.equal(false)
    await voice.startRecording()
    expect(PlayingAudio.instance.paused).to.equal(true)
    expect(harness.revoked).to.deep.equal(['blob:voice'])
    expect(voice.state).to.equal('recording')
    voice.cancel()
  })
})
