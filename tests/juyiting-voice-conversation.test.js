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

const createVoice = ({ enabled = true, browser, chatCreate, onSendVoice, draft = '', revision = 0, context = validContext(), replyBusy = false, captureEvents = [] } = {}) => {
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
    showToast: () => {},
    browser
  })
  return { voice, setDraft: value => { currentDraft = value; currentRevision += 1 }, setContext: value => { currentContext = value } }
}

const transcribeToReview = async voice => {
  await voice.startRecording()
  const recorder = FakeRecorder.instances.at(-1)
  recorder.ondataavailable({ data: new Blob(['voice']) })
  voice.stopRecording()
  await flush()
  expect(voice.state).to.equal('review')
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
    const recorder = FakeRecorder.instances.at(-1)
    recorder.ondataavailable({ data: { size: HALL_VOICE_MAX_AUDIO_BYTES + 1 } })
    expect(voice.state).to.equal('error')
    expect(voice.voiceInteractionLocked).to.equal(false)
    expect(harness.tracks.at(-1).stopped).to.equal(true)
    expect(captureEvents).to.deep.equal([true, false, true, false])
  })

  it('aborts transcribing on hidden visibility and leaves countdown review unlocked', async () => {
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
    await flush()
    expect(voice.state).to.equal('transcribing')
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
    voice.cancel({ preserveReview: true })
    expect(voice.state).to.equal('conflict')
    expect(voice.voiceInteractionLocked).to.equal(false)
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

  it('accepts exactly one new correlated final across built-in/external ordering and rejects replay', () => {
    const spoken = new Set(['already-spoken'])
    const accepted = []
    const tracker = createHallVoiceReplyCorrelation({ spokenMessageIds: spoken, onReply: (_message, turn, payload) => accepted.push({ turn, payload }) })
    expect(tracker.start({ turnId: 'turn-1', baselineSequence: 7, messages: [{ localId: 'old-1' }], conversationIdBeforeSend: '' })).to.equal(true)
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

  it('stops speaking playback when a new recording starts', async () => {
    class PlayingAudio { constructor () { PlayingAudio.instance = this; this.paused = false } play = async () => {}; pause () { this.paused = true } }
    const harness = browserHarness({ AudioClass: PlayingAudio, fetchImpl: async () => audioResponse() })
    const { voice } = createVoice({ browser: harness.browser })
    voice.setReplyVoiceEnabled(true)
    await transcribeToReview(voice)
    await voice.sendTranscript()
    await voice.completeReply({ content: 'reply' })
    expect(voice.state).to.equal('speaking')
    await voice.startRecording()
    expect(PlayingAudio.instance.paused).to.equal(true)
    expect(harness.revoked).to.deep.equal(['blob:voice'])
    expect(voice.state).to.equal('recording')
    voice.cancel()
  })
})
