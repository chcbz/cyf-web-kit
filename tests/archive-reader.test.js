import { expect } from 'chai'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'
import * as HallPanelHelpers from '../src/composables/juyiting/useHallPanels.js'
import {
  isCanonicalDecimal,
  mutationHeaders,
  useArchiveReader,
  utf8ByteLength
} from '../src/composables/juyiting/useArchiveReader.js'

global.Element = global.window?.Element
global.SVGElement = global.window?.SVGElement
global.Node = global.window?.Node

const editionId = 'shuihuzhuan-zh-120-v1'
const manifestSha256 = 'b'.repeat(64)
const response = data => ({ data: { data, status: 200 } })
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}
const settle = async () => {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve()
    await Vue.nextTick()
  }
}
const waitFor = async (predicate, timeout = 1000) => {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeout) throw new Error('Timed out waiting for archive reader state')
    await new Promise(resolve => setTimeout(resolve, 5))
    await settle()
  }
}

const paragraph = (blockId, ordinal, text, hashCharacter) => ({
  paragraphId: `${blockId}-p${String(ordinal).padStart(4, '0')}`,
  ordinal,
  sha256: hashCharacter.repeat(64),
  text,
  utf8ByteLength: utf8ByteLength(text)
})
const blockSummary = (blockType, blockId, number, title) => ({
  blockId,
  blockType,
  number,
  paragraphCount: 2,
  title
})

const prefaceSummary = blockSummary('PREFACE', `${editionId}-preface`, null, '引首')
const c1Summary = blockSummary('CHAPTER', `${editionId}-c001`, 1, '第一回')
const c81Summary = blockSummary('CHAPTER', `${editionId}-c081`, 81, '第八十一回')
const c119Summary = blockSummary('CHAPTER', `${editionId}-c119`, 119, '第一百十九回')
const c120Summary = blockSummary('CHAPTER', `${editionId}-c120`, 120, '第一百二十回')
const preface = {
  ...prefaceSummary,
  editionId,
  manifestSha256,
  paragraphs: [
    paragraph(prefaceSummary.blockId, 1, '引首第一段', '1'),
    paragraph(prefaceSummary.blockId, 2, '引首第二段', '2')
  ]
}
const chapterOne = {
  ...c1Summary,
  editionId,
  manifestSha256,
  paragraphs: [
    paragraph(c1Summary.blockId, 1, '第一段正文', '3'),
    paragraph(c1Summary.blockId, 2, '第二段正文', '4')
  ]
}
const longText = '水'.repeat(3236)
const chapterEightyOne = {
  ...c81Summary,
  editionId,
  manifestSha256,
  paragraphs: [paragraph(c81Summary.blockId, 2, longText, '8')]
}
const chapterOneHundredNineteen = {
  ...c119Summary,
  editionId,
  manifestSha256,
  paragraphs: [
    paragraph(c119Summary.blockId, 1, '第一百十九回首段', '9'),
    paragraph(c119Summary.blockId, 2, '第一百十九回末段', 'a')
  ]
}
const chapterOneHundredTwenty = {
  ...c120Summary,
  editionId,
  manifestSha256,
  paragraphs: [
    paragraph(c120Summary.blockId, 1, '第一百二十回首段', 'c'),
    paragraph(c120Summary.blockId, 2, '第一百二十回末段', 'd')
  ]
}
const catalog = {
  activeEdition: {
    chapters: [c1Summary, c81Summary, c119Summary, c120Summary],
    editionId,
    manifestSha256,
    preface: prefaceSummary
  },
  title: '水滸傳',
  workId: 'shuihuzhuan'
}
const blocksById = new Map([
  [preface.blockId, preface],
  [chapterOne.blockId, chapterOne],
  [chapterEightyOne.blockId, chapterEightyOne],
  [chapterOneHundredNineteen.blockId, chapterOneHundredNineteen],
  [chapterOneHundredTwenty.blockId, chapterOneHundredTwenty]
])
const point = (block, paragraphItem, byteOffset = 0) => ({
  blockId: block.blockId,
  blockType: block.blockType,
  byteOffset,
  editionManifestSha256: manifestSha256,
  paragraphId: paragraphItem.paragraphId,
  paragraphSha256: paragraphItem.sha256
})

const makeApi = ({
  bookmarks = [],
  deleteHandler,
  getBlock,
  getCatalog,
  notesByBlock = {},
  progress = null,
  progressEnvelope,
  putHandler
} = {}) => {
  const calls = []
  const progressVersions = ['1', '2', '3', '4']
  return {
    calls,
    delete: async (path, options) => {
      const call = { method: 'delete', options, path }
      calls.push(call)
      if (deleteHandler) return deleteHandler(call)
      return response({ state: 'DELETED', version: '2' })
    },
    get: async (path, params, options = {}) => {
      const call = { method: 'get', options, params, path }
      calls.push(call)
      if (path === '/catalog') return getCatalog ? getCatalog(call) : response(catalog)
      if (path.startsWith('/me/progress/')) return progressEnvelope ?? response(progress)
      if (path === '/me/bookmarks') return response({ items: bookmarks, nextCursor: null })
      if (path === '/me/notes') {
        return response({ items: notesByBlock[params.chapterId] || [], nextCursor: null })
      }
      const blockId = path.endsWith('/preface')
        ? preface.blockId
        : [...blocksById.keys()].find(id => path.endsWith(`/chapters/${id}`))
      if (!blockId) throw new Error(`Unexpected GET ${path}`)
      if (getBlock) return getBlock(blockId, call)
      return response(blocksById.get(blockId))
    },
    put: async (path, body, options) => {
      const call = { body, method: 'put', options, path }
      calls.push(call)
      if (putHandler) return putHandler(call)
      if (path.startsWith('/me/progress/')) {
        return response({
          editionId,
          location: body.location,
          state: body.markCompleted ? 'COMPLETED' : 'IN_PROGRESS',
          version: progressVersions.shift() || '4'
        })
      }
      if (path.startsWith('/me/bookmarks/')) {
        return response({
          bookmarkId: path.split('/').at(-1),
          location: body.location,
          state: 'ACTIVE',
          version: '1'
        })
      }
      if (path.startsWith('/me/notes/')) {
        return response({
          anchor: body.anchor,
          noteId: path.split('/').at(-1),
          state: 'ACTIVE',
          text: body.text,
          version: body.expectedVersion === '0' ? '1' : '2'
        })
      }
      throw new Error(`Unexpected PUT ${path}`)
    }
  }
}

const mountReader = (api, options = {}) => {
  let reader
  const Harness = Vue.defineComponent({
    setup () {
      reader = useArchiveReader({
        api,
        autoInitialize: options.autoInitialize ?? false,
        saveDelay: options.saveDelay ?? 1
      })
      return () => null
    }
  })
  const wrapper = mount(Harness)
  return {
    get reader () { return reader },
    wrapper
  }
}

const vueImportToVar = (_line, imports) => {
  const bindings = imports.split(',').map((part) => {
    const [name, alias] = part.trim().split(/\s+as\s+/)
    return alias ? `${name}: ${alias}` : name
  }).join(', ')
  return `var { ${bindings} } = Vue`
}

const loadArchiveReaderSfc = (archiveModule) => {
  const relativePath = '../src/components/juyiting/archive/ArchiveReader.vue'
  const filename = new URL(relativePath, import.meta.url).pathname
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    .replace(
      '</script>',
      `defineExpose({
        __switchEditorTargetForTest: (note, text) => {
          editingNote.value = note
          noteText.value = text
          editorRevision += 1
        }
      })
      </script>`
    )
  const { descriptor } = parse(source, { filename })
  const script = compileScript(descriptor, {
    id: 'archive-reader-dom-test',
    inlineTemplate: true
  }).content
  const body = script
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(
      /^import\s+\{\s*useArchiveReader,\s*utf8ByteLength\s*\}\s+from\s+['"]@\/composables\/juyiting\/useArchiveReader['"];?\s*$/gm,
      'var { useArchiveReader, utf8ByteLength } = archiveModule'
    )
    .replace('export default', 'return')
  return new Function('Vue', 'archiveModule', body)(Vue, archiveModule)
}


const loadActualHallForIntegration = (mocks, id) => {
  const relativePath = '../src/components/world/JuyiHall.vue'
  const filename = new URL(relativePath, import.meta.url).pathname
  const { descriptor } = parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), { filename })
  const body = compileScript(descriptor, { id, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, imports) => `var { ${imports} } = mocks`)
    .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_line, name) => `var ${name} = mocks.${name}`)
    .replace(/import\.meta\.env/g, 'mocks.env')
    .replace('export default', 'return')
  return new Function('Vue', 'mocks', body)(Vue, mocks)
}

const createHallIntegrationMocks = ({ mode, LibraryPanel, TaskWorkspacePanel, workspaceState = null, counters }) => {
  const noop = () => {}
  const asyncNoop = async () => {}
  const list = Vue.ref([])
  const text = Vue.ref('')
  const EmptyPanel = Vue.defineComponent({ setup: () => () => Vue.h('section') })
  const HallPortraitHome = Vue.defineComponent({
    emits: ['quick-action'],
    setup (_props, { attrs, emit }) {
      return () => Vue.h('main', { ...attrs, class: 'portrait-shell' }, ['agents', 'tasks', 'discussion', 'catalog', 'library'].map(action =>
        Vue.h('button', { type: 'button', 'data-portrait-action': action, onClick: () => emit('quick-action', action) }, action)))
    }
  })
  const HallStage = Vue.defineComponent({ setup: (_props, { attrs }) => () => Vue.h('section', { ...attrs, class: 'hall-board', tabindex: 0 }) })
  const hallData = {
    applySceneEvent: noop, applySceneSnapshot: noop, agentFilter: Vue.ref('online'), agents: list, bindPersona: asyncNoop,
    canAssign: () => true, filteredAgents: list, hiddenAgentCount: Vue.ref(0), loadAgents: async () => { counters.hallLoads += 1 },
    loadTasks: async () => { counters.hallLoads += 1 }, loadTaskRecommendations: asyncNoop, mapAgents: list, personaCatalog: list,
    recommendedAgents: list, setAgentFilter: asyncNoop, setTaskStatusFilter: asyncNoop, taskAbilityFilter: Vue.ref('ability-o04'),
    taskAbilityOptions: list, taskKeyword: Vue.ref('task-filter-o04'), tasks: list, taskStatusCount: Vue.ref({}), taskStatusFilter: Vue.ref('open'),
    unbindPersona: asyncNoop, visibleAgents: list
  }
  const taskWorkspace = workspaceState || null
  return {
    ...HallPanelHelpers,
    env: { VITE_JUYITING_TASK_WORKSPACE_ENABLED: workspaceState ? 'true' : undefined },
    useGlobalStore: () => ({ setTitle: noop, setShowBack: noop, setShowAppBar: noop, setShowMore: noop }), useApiStore: () => ({}),
    agentApi: {}, chatApi: {}, log: { warn: noop }, juyitingGame: {}, roleDialogues: { default: [''] }, statusFilters: [], taskStatusFilters: [],
    useHallData: () => hallData,
    useHallExperienceMode: () => ({ experienceMode: mode, isMobileCoarse: Vue.ref(true), orientationHint: text, orientationRequestPending: Vue.ref(false), requestLandscape: asyncNoop }),
    useHallPanels: HallPanelHelpers.useHallPanels,
    useHallSceneState: () => ({ setMapRuntime: noop, reset: noop, forwardPhaseEvents: asyncNoop }),
    useHallCommandQueue: () => ({ ready: Vue.ref(false), setSimulation: noop }),
    useHallBackendSceneState: () => ({ start: asyncNoop, stop: noop, dispose: noop, reportPhase: noop }),
    useHallSceneDebugBridge: () => ({ sentinel: 'debug-o04', republish: noop, stop: noop }),
    useHallSound: () => ({ playAgentSelect: noop, playError: noop, playPanelOpen: noop, playRefresh: noop, playSend: noop, playSuccess: noop, playTap: noop, setSoundEnabled: noop, setSoundSuppressed: noop, soundEnabled: Vue.ref(false) }),
    useHallChatContext: () => ({ chatContext: Vue.ref({ conversationScopeKey: 'scope-o04' }), chatMentionAgentIds: Vue.ref([]), chatMentionAgents: list, chatMode: Vue.ref('public'), chatTargetText: text, enterBountyDiscussion: noop, enterPrivateConversation: noop, resetToPublic: noop, setMentionAgent: noop }),
    useHallScene: () => ({ markAgentSpeaking: noop, markDiscussionStarted: noop, markLibraryCitation: noop, markLibrarySearching: noop, markRecommendedAgents: noop, markTaskArchived: noop, markTaskAssigned: noop, markTaskAutoAssigned: noop, markTaskCreated: noop, resetSceneFeedback: noop, sceneAgents: list, sceneAgentStyle: () => ({}), sceneHotspots: list, syncAfterPersonaChanged: noop }),
    useHallTaskActions: () => ({ archiveTask: asyncNoop, autoAssignTask: asyncNoop, assignTask: async () => true, createTask: asyncNoop }),
    useHallConversation: () => ({ chatConnectionStatus: text, conversationId: Vue.ref('conversation-o04'), draft: Vue.ref('draft-o04'), draftRevision: Vue.ref(0), eventStreamRecovering: Vue.ref(false), insertAgentMention: noop, isAwaitingReply: Vue.ref(false), isStreaming: Vue.ref(false), loadHallMessages: asyncNoop, mentionAgent: noop, messages: Vue.ref([{ id: 'message-o04' }]), newHallConversation: noop, pendingAgentName: text, replyEventSequence: Vue.ref(0), sendHallMessage: asyncNoop, senderText: text, setDraft: noop, disposeHallConversation: noop, stopHallEventStream: noop, stopHallReplyPolling: noop, stopHallReplyStreaming: noop }),
    useHallVoiceConversation: () => ({ supported: false, voiceInteractionLocked: false, cancel: noop, dispose: noop, applyTranscript: noop }),
    createHallVoiceReplyCorrelation: () => ({ start: () => true, observe: noop, resolveConversation: () => true, close: noop }),
    useHallLibrary: () => ({ citeLibraryItem: noop, libraryErrorMessage: text, libraryHasSearched: Vue.ref(false), libraryKeyword: Vue.ref('library-filter-o04'), libraryLoading: Vue.ref(false), libraryResults: list, librarySourceType: Vue.ref('project'), searchLibrary: asyncNoop }),
    useTaskWorkspace: () => taskWorkspace,
    createDisabledTaskWorkspaceBinding: () => ({ selectExplicitActor: noop, clearExplicitActor: noop, dispose: noop }),
    isTaskWorkspaceBuildEnabled: () => Boolean(workspaceState),
    useTaskWorkspaceView: () => workspaceState ? ({ subject: workspaceState.subject, workspace: workspaceState.workspace, connectionState: workspaceState.connectionState, error: workspaceState.error, retry: workspaceState.retry }) : ({ subject: Vue.ref(null), workspace: Vue.ref(null), connectionState: text, error: Vue.ref(null), retry: noop }),
    useTaskWorkspaceBinding: () => ({ selectExplicitActor: noop, clearExplicitActor: noop, dispose: noop }),
    portraitName: () => '', portraitRole: () => ({ slug: 'default' }), portraitShortName: () => '', portraitStyle: () => ({}), roleClass: () => '',
    HallPortraitHome, HallStage, HallVoiceHud: EmptyPanel, LibraryPanel: LibraryPanel || EmptyPanel, TaskWorkspacePanel: TaskWorkspacePanel || EmptyPanel,
    AgentPanel: EmptyPanel, BountyDiscussionPanel: EmptyPanel, BountyPanel: EmptyPanel, PersonaCatalogPanel: EmptyPanel, PrivateDiscussionPanel: EmptyPanel, PublicDiscussionPanel: EmptyPanel, SelectedAgentCard: EmptyPanel
  }
}


const loadLibraryPanelSfc = (ArchiveReader) => {
  const relativePath = '../src/components/juyiting/LibraryPanel.vue'
  const filename = new URL(relativePath, import.meta.url).pathname
  const { descriptor } = parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), { filename })
  const body = compileScript(descriptor, { id: 'archive-library-integration', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+ArchiveReader\s+from\s+['"].\/archive\/ArchiveReader\.vue['"];?\s*$/gm, 'var ArchiveReader = arguments[1]')
    .replace('export default', 'return')
  return new Function('Vue', 'ArchiveReader', body)(Vue, ArchiveReader)
}

const mountArchiveReader = (api, options = {}) => {
  let readerState
  const component = loadArchiveReaderSfc({
    useArchiveReader: () => {
      readerState = useArchiveReader({ api, saveDelay: options.saveDelay ?? 1 })
      return readerState
    },
    utf8ByteLength
  })
  const wrapper = mount(component, { attachTo: document.body })
  wrapper.readerState = readerState
  return wrapper
}

const primeReader = (reader, block = chapterOne, progressValue = null) => {
  reader.catalog.value = catalog
  reader.chapter.value = block
  reader.currentLocation.value = point(block, block.paragraphs[0])
  reader.progress.value = progressValue
}

const questionId = '123e4567-e89b-42d3-a456-426614174000'
const questionSelectedText = '第'
const questionAnchor = (block = chapterOne, selectedText = questionSelectedText) => ({
  blockId: block.blockId,
  blockType: block.blockType,
  editionManifestSha256: manifestSha256,
  segments: [{ paragraphId: block.paragraphs[0].paragraphId, startByte: 0, endByte: utf8ByteLength(selectedText), paragraphSha256: block.paragraphs[0].sha256 }],
  selectionSha256: createHash('sha256').update(selectedText).digest('hex')
})
const questionSnapshot = (overrides = {}) => ({
  answer: '', anchor: questionAnchor(), completedAt: null, createdAt: '2026-08-23T00:00:00Z', currentSequence: '1',
  lastErrorCode: null, question: '何意？', questionId, responder: { id: 'archive-clerk-v1', displayName: '案卷书吏', mode: 'fallback' },
  retryCount: 0, selectedText: questionSelectedText, status: 'QUEUED', updatedAt: '2026-08-23T00:00:00Z', version: '1', ...overrides
})
const questionEvent = (sequence, type, payload) => ({
  schemaVersion: 1, questionId, sequence, type, occurredAt: '2026-08-23T00:00:01Z', payload
})
const makeQuestionApi = ({
  createSnapshot = questionSnapshot(),
  createSelectedText = questionSelectedText,
  getHandler,
  postHandler,
  putHandler,
  snapshots = []
} = {}) => {
  const base = makeApi()
  const calls = base.calls
  const sessions = []
  const baseGet = base.get
  const basePut = base.put
  return {
    ...base,
    calls,
    sessions,
    get: async (path, params, options) => {
      if (path.startsWith('/me/questions/')) {
        const call = { method: 'get', options, params, path }
        calls.push(call)
        if (getHandler) return getHandler(call)
        return response({ ...(snapshots.shift() || createSnapshot), questionId: path.split('/')[3] })
      }
      return baseGet(path, params, options)
    },
    put: async (path, body, options) => {
      if (path.startsWith('/me/questions/')) {
        const call = { body, method: 'put', options, path }
        calls.push(call)
        if (putHandler) return putHandler(call)
        return response({
          ...createSnapshot,
          anchor: body.anchor,
          questionId: path.split('/').at(-1),
          selectedText: createSelectedText
        })
      }
      return basePut(path, body, options)
    },
    post: async (path, body, options) => {
      const call = { body, method: 'post', options, path }
      calls.push(call)
      if (postHandler) return postHandler(call)
      return response({ ...(snapshots.shift() || createSnapshot), questionId: path.split('/')[3] })
    },
    execute: (options) => {
      const session = { cancelled: false, options }
      sessions.push(session)
      options.onStreamOpen?.({ cancel: () => { session.cancelled = true } })
      options.signal?.addEventListener('abort', () => { session.cancelled = true }, { once: true })
      return new Promise(resolve => options.signal?.addEventListener('abort', resolve, { once: true }))
    },
    emit: (index, event, name = event.type, id = event.sequence) => {
      const session = sessions[index]
      const eventQuestionId = session.options.url.split('/')[3]
      const idLine = id === null ? '' : `id: ${id}\n`
      session.options.onStream(`event: ${name}\n${idLine}data: ${JSON.stringify({ ...event, questionId: eventQuestionId })}\n\n`)
    },
    chunk: (index, value) => sessions[index].options.onStream(value),
    end: index => sessions[index].options.onStreamEnd(),
    heartbeat: (index) => sessions[index].options.onStream(': heartbeat\n\n')
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('archive reader contract behavior', () => {
  it('preserves JsonResult data:null and saves first progress with expectedVersion 0', async () => {
    const api = makeApi({ progress: null })
    const mounted = mountReader(api)
    await mounted.reader.initialize()
    expect(mounted.reader.progress.value).to.equal(null)

    await mounted.reader.saveProgress()
    const save = api.calls.find(call => call.method === 'put' && call.path.startsWith('/me/progress/'))
    expect(save.body.expectedVersion).to.equal('0')
    expect(mounted.reader.saveState.value).to.equal('saved')

    mounted.reader.progress.value = { version: '01' }
    let failure
    try {
      await mounted.reader.saveProgress()
    } catch (error) {
      failure = error
    }
    expect(failure?.message).to.include('canonical decimal string')
    expect(mounted.reader.saveState.value).to.equal('error')
    expect(mounted.reader.errorMessage.value).to.include('暂未保存')
    mounted.wrapper.unmount()
  })

  it('treats a successful JsonResult with omitted data as null and initializes the first save', async () => {
    const progressEnvelope = { data: { status: 200, code: 'E0', msg: 'ok' } }
    const api = makeApi({ progressEnvelope })
    const mounted = mountReader(api)
    await mounted.reader.initialize()

    expect(mounted.reader.progress.value).to.equal(null)
    expect(mounted.reader.chapter.value.blockId).to.equal(preface.blockId)
    expect(mounted.reader.chapter.value.paragraphs[0].text).to.equal('引首第一段')

    await mounted.reader.saveProgress()
    const save = api.calls.find(call => call.method === 'put' && call.path.startsWith('/me/progress/'))
    expect(save.body.expectedVersion).to.equal('0')
    mounted.wrapper.unmount()
  })

  it('continues to a non-first paragraph and focuses it after real DOM rendering', async () => {
    const target = point(chapterOne, chapterOne.paragraphs[1], 3)
    const api = makeApi({ progress: { editionId, location: target, version: '7' } })
    const wrapper = mountArchiveReader(api, { saveDelay: 5 })
    await waitFor(() => wrapper.find(`#${target.paragraphId}`).exists())
    await settle()

    expect(document.activeElement?.id).to.equal(target.paragraphId)
    expect(wrapper.text()).to.include('第二段正文')
    await wrapper.get('.bookmark-create').trigger('click')
    await waitFor(() => api.calls.some(call => call.path.startsWith('/me/bookmarks/')))
    const bookmarkCall = api.calls.find(call => call.path.startsWith('/me/bookmarks/'))
    expect(bookmarkCall.body.location).to.deep.equal(target)
    wrapper.unmount()
  })

  it('suppresses scrollIntoView scroll events without overwriting the restored byte offset', async () => {
    const target = point(chapterOne, chapterOne.paragraphs[1], 6)
    const api = makeApi({ progress: { editionId, location: target, version: '7' } })
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () {
      const content = this.closest('.reader-content')
      const paragraphs = [...content.querySelectorAll('.reader-paragraph')]
      content.getBoundingClientRect = () => ({ bottom: 100, top: 0 })
      paragraphs[0].getBoundingClientRect = () => ({ bottom: -5, top: -80 })
      this.getBoundingClientRect = () => ({ bottom: 90, top: 10 })
      Object.defineProperty(content, 'clientHeight', { configurable: true, value: 100 })
      Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 300 })
      Object.defineProperty(content, 'scrollTop', { configurable: true, value: 100, writable: true })
      content.dispatchEvent(new window.Event('scroll'))
    }

    let wrapper
    try {
      wrapper = mountArchiveReader(api, { saveDelay: 1 })
      await waitFor(() => wrapper.find(`#${target.paragraphId}`).exists())
      await new Promise(resolve => setTimeout(resolve, 380))
      const { readerState } = wrapper
      expect(readerState.currentLocation.value).to.deep.equal(target)
      await readerState.saveProgress()

      const saves = api.calls.filter(call => call.method === 'put' && call.path.startsWith('/me/progress/'))
      expect(saves).to.have.length(1)
      expect(saves[0].body.location.byteOffset).to.equal(target.byteOffset)
    } finally {
      wrapper?.unmount()
      Element.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('derives progress from the truly visible paragraph after scroll settles', async () => {
    const initial = point(chapterOne, chapterOne.paragraphs[0])
    const api = makeApi({ progress: { editionId, location: initial, version: '4' } })
    const wrapper = mountArchiveReader(api, { saveDelay: 1 })
    await waitFor(() => wrapper.findAll('.reader-paragraph').length === 2)
    const content = wrapper.get('.reader-content')
    const [first, second] = wrapper.findAll('.reader-paragraph')
    content.element.getBoundingClientRect = () => ({ bottom: 100, top: 0 })
    first.element.getBoundingClientRect = () => ({ bottom: -5, top: -80 })
    second.element.getBoundingClientRect = () => ({ bottom: 90, top: 10 })
    Object.defineProperty(content.element, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(content.element, 'scrollHeight', { configurable: true, value: 300 })
    Object.defineProperty(content.element, 'scrollTop', { configurable: true, value: 100, writable: true })

    await content.trigger('scroll')
    await new Promise(resolve => setTimeout(resolve, 210))
    await waitFor(() => api.calls.some(call => call.method === 'put' && call.path.startsWith('/me/progress/')))
    const saves = api.calls.filter(call => call.method === 'put' && call.path.startsWith('/me/progress/'))
    expect(saves.at(-1).body.location.paragraphId).to.equal(chapterOne.paragraphs[1].paragraphId)
    expect(saves.at(-1).body.location.byteOffset).to.equal(0)
    wrapper.unmount()
  })

  it('anchors and reloads the real 9708-byte multibyte paragraph with a valid bounded slice', async () => {
    expect(chapterEightyOne.paragraphs[0].utf8ByteLength).to.equal(9708)
    const target = point(chapterEightyOne, chapterEightyOne.paragraphs[0])
    const notesByBlock = {}
    const api = makeApi({
      notesByBlock,
      progress: { editionId, location: target, version: '8' },
      putHandler: (call) => {
        if (!call.path.startsWith('/me/notes/')) {
          return response({ editionId, location: call.body.location, version: '9' })
        }
        const note = {
          anchor: call.body.anchor,
          noteId: call.path.split('/').at(-1),
          state: 'ACTIVE',
          text: call.body.text,
          version: '1'
        }
        notesByBlock[call.body.anchor.blockId] = [note]
        return response(note)
      }
    })
    const wrapper = mountArchiveReader(api)
    await waitFor(() => wrapper.findAll('.reader-paragraph').length === 1)
    await wrapper.get('textarea').setValue('长段手札')
    await wrapper.get('.note-save').trigger('click')
    await waitFor(() => api.calls.some(call => call.path.startsWith('/me/notes/')))

    const noteCall = api.calls.find(call => call.path.startsWith('/me/notes/'))
    const anchor = noteCall.body.anchor
    const segment = anchor.segments[0]
    const selectionBytes = new TextEncoder().encode(longText).slice(segment.startByte, segment.endByte)
    expect(anchor).not.to.equal(null)
    expect(anchor.blockId).to.equal(chapterEightyOne.blockId)
    expect(segment.paragraphId).to.equal(chapterEightyOne.paragraphs[0].paragraphId)
    expect(segment.paragraphSha256).to.equal(chapterEightyOne.paragraphs[0].sha256)
    expect(segment.endByte).to.equal(8190)
    expect(segment.endByte).to.be.at.most(8192)
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(selectionBytes)).not.to.throw()
    expect(anchor.selectionSha256).to.equal(createHash('sha256').update(selectionBytes).digest('hex'))
    expect(wrapper.text()).to.include('长段前缀选文锚点')

    notesByBlock[chapterEightyOne.blockId][0].text = '服务端重载长段手札'
    const noteGetsBeforeReload = api.calls.filter(call => call.path === '/me/notes').length
    const chapterButton = wrapper.findAll('.reader-catalog button')
      .find(button => button.text().includes('第81回'))
    await chapterButton.trigger('click')
    await waitFor(() => api.calls.filter(call => call.path === '/me/notes').length > noteGetsBeforeReload)
    await waitFor(() => wrapper.text().includes('服务端重载长段手札'))
    wrapper.unmount()
  })

  it('commits only the latest block and notes when chapter requests resolve out of order', async () => {
    const requests = new Map([
      [chapterOne.blockId, deferred()],
      [chapterEightyOne.blockId, deferred()]
    ])
    const noteOne = { noteId: 'note-one', state: 'ACTIVE', text: '旧章手札', version: '1' }
    const noteEightyOne = { noteId: 'note-eighty-one', state: 'ACTIVE', text: '新章手札', version: '1' }
    const api = makeApi({
      getBlock: blockId => requests.get(blockId).promise,
      notesByBlock: {
        [chapterOne.blockId]: [noteOne],
        [chapterEightyOne.blockId]: [noteEightyOne]
      }
    })
    const mounted = mountReader(api)
    mounted.reader.catalog.value = catalog
    const older = mounted.reader.loadBlock(c1Summary)
    const latest = mounted.reader.loadBlock(c81Summary)
    requests.get(chapterEightyOne.blockId).resolve(response(chapterEightyOne))
    await latest
    requests.get(chapterOne.blockId).resolve(response(chapterOne))
    await older

    expect(mounted.reader.chapter.value.blockId).to.equal(chapterEightyOne.blockId)
    expect(mounted.reader.currentLocation.value.blockId).to.equal(chapterEightyOne.blockId)
    expect(mounted.reader.notes.value.map(note => note.noteId)).to.deep.equal(['note-eighty-one'])
    mounted.wrapper.unmount()
  })

  it('replays ambiguous bookmark and note writes with the same resource ID, body, and key', async () => {
    const attempts = new Map()
    const api = makeApi({
      putHandler: (call) => {
        if (!call.path.startsWith('/me/bookmarks/') && !call.path.startsWith('/me/notes/')) {
          return response({ editionId, location: call.body.location, version: '1' })
        }
        const count = (attempts.get(call.path) || 0) + 1
        attempts.set(call.path, count)
        if (count === 1) throw new Error('response lost')
        if (call.path.startsWith('/me/bookmarks/')) {
          return response({
            bookmarkId: call.path.split('/').at(-1),
            location: call.body.location,
            state: 'ACTIVE',
            version: '1'
          })
        }
        return response({
          anchor: call.body.anchor,
          noteId: call.path.split('/').at(-1),
          state: 'ACTIVE',
          text: call.body.text,
          version: '1'
        })
      }
    })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    await mounted.reader.createBookmark()
    await mounted.reader.saveNote({ text: '重放手札', version: '0' })

    for (const prefix of ['/me/bookmarks/', '/me/notes/']) {
      const writes = api.calls.filter(call => call.method === 'put' && call.path.startsWith(prefix))
      expect(writes).to.have.length(2)
      expect(writes[0].path).to.equal(writes[1].path)
      expect(writes[0].body).to.deep.equal(writes[1].body)
      expect(writes[0].options.headers['Idempotency-Key'])
        .to.equal(writes[1].options.headers['Idempotency-Key'])
    }
    expect(mutationHeaders({ 'Idempotency-Key': 'fixed-key' }, 'replacement')['Idempotency-Key'])
      .to.equal('fixed-key')
    mounted.wrapper.unmount()
  })

  it('confirms an ambiguous new-note operation without clearing a newer UI draft', async () => {
    const confirmation = deferred()
    let attempt = 0
    const api = makeApi({
      progress: {
        editionId,
        location: point(chapterOne, chapterOne.paragraphs[0]),
        version: '3'
      },
      putHandler: (call) => {
        if (!call.path.startsWith('/me/notes/')) {
          return response({ editionId, location: call.body.location, version: '4' })
        }
        attempt += 1
        if (attempt <= 2) throw new Error('note response remains ambiguous')
        if (attempt === 3) return confirmation.promise
        return response({
          anchor: call.body.anchor,
          noteId: call.path.split('/').at(-1),
          state: 'ACTIVE',
          text: call.body.text,
          version: '2'
        })
      }
    })
    const wrapper = mountArchiveReader(api)
    await waitFor(() => wrapper.findAll('.reader-paragraph').length === 2)
    await wrapper.get('textarea').setValue('未确认旧稿')
    await wrapper.get('.note-save').trigger('click')
    await waitFor(() => api.calls.filter(call => call.path.startsWith('/me/notes/')).length === 2)
    await waitFor(() => wrapper.get('.note-save').attributes('disabled') === undefined)

    await wrapper.get('textarea').setValue('确认点击时新稿 A')
    await wrapper.get('.note-save').trigger('click')
    await waitFor(() => api.calls.filter(call => call.path.startsWith('/me/notes/')).length === 3)
    await waitFor(() => wrapper.text().includes('正在确认上次保存'))
    expect(wrapper.get('textarea').element.value).to.equal('确认点击时新稿 A')
    await wrapper.get('textarea').setValue('等待确认期间继续编辑的新稿 B')
    const confirmationCall = api.calls.filter(call => call.path.startsWith('/me/notes/')).at(-1)
    confirmation.resolve(response({
      anchor: confirmationCall.body.anchor,
      noteId: confirmationCall.path.split('/').at(-1),
      state: 'ACTIVE',
      text: confirmationCall.body.text,
      version: '1'
    }))
    await waitFor(() => wrapper.text().includes('新稿仍保留'))
    expect(wrapper.get('textarea').element.value).to.equal('等待确认期间继续编辑的新稿 B')

    const confirmedWrites = api.calls.filter(call => call.path.startsWith('/me/notes/'))
    expect(confirmedWrites.slice(0, 3).map(call => call.path)).to.deep.equal([
      confirmedWrites[0].path,
      confirmedWrites[0].path,
      confirmedWrites[0].path
    ])
    expect(confirmedWrites.slice(0, 3).map(call => call.body.text)).to.deep.equal([
      '未确认旧稿',
      '未确认旧稿',
      '未确认旧稿'
    ])
    expect(confirmedWrites.slice(0, 3).map(call => call.options.headers['Idempotency-Key']))
      .to.deep.equal(Array(3).fill(confirmedWrites[0].options.headers['Idempotency-Key']))

    await wrapper.get('.note-save').trigger('click')
    await waitFor(() => api.calls.filter(call => call.path.startsWith('/me/notes/')).length === 4)
    await waitFor(() => wrapper.get('textarea').element.value === '')
    const finalWrite = api.calls.filter(call => call.path.startsWith('/me/notes/')).at(-1)
    expect(finalWrite.path).to.equal(confirmedWrites[0].path)
    expect(finalWrite.body.text).to.equal('等待确认期间继续编辑的新稿 B')
    expect(finalWrite.body.expectedVersion).to.equal('1')
    expect(finalWrite.options.headers['Idempotency-Key'])
      .not.to.equal(confirmedWrites[0].options.headers['Idempotency-Key'])
    expect(wrapper.text()).to.include('等待确认期间继续编辑的新稿 B')
    expect(wrapper.text()).not.to.include('新稿仍保留')
    wrapper.unmount()
  })

  it('applies the same ambiguous confirmation flow when editing an existing note', async () => {
    const confirmation = deferred()
    const existingNote = {
      anchor: null,
      noteId: 'existing-ambiguous-note',
      state: 'ACTIVE',
      text: '原手札',
      version: '5'
    }
    let attempt = 0
    const api = makeApi({
      notesByBlock: { [chapterOne.blockId]: [existingNote] },
      progress: {
        editionId,
        location: point(chapterOne, chapterOne.paragraphs[0]),
        version: '3'
      },
      putHandler: (call) => {
        if (!call.path.startsWith('/me/notes/')) {
          return response({ editionId, location: call.body.location, version: '4' })
        }
        attempt += 1
        if (attempt <= 2) throw new Error('existing note response remains ambiguous')
        if (attempt === 3) return confirmation.promise
        return response({
          anchor: call.body.anchor,
          noteId: existingNote.noteId,
          state: 'ACTIVE',
          text: call.body.text,
          version: '7'
        })
      }
    })
    const wrapper = mountArchiveReader(api)
    await waitFor(() => wrapper.find('.note-edit').exists())
    await wrapper.get('.note-edit').trigger('click')
    await wrapper.get('textarea').setValue('未确认旧改稿')
    await wrapper.get('.note-save').trigger('click')
    await waitFor(() => api.calls.filter(call => call.path.startsWith('/me/notes/')).length === 2)
    await waitFor(() => wrapper.get('.note-save').attributes('disabled') === undefined)

    await wrapper.get('textarea').setValue('确认点击时新改稿 A')
    await wrapper.get('.note-save').trigger('click')
    await waitFor(() => api.calls.filter(call => call.path.startsWith('/me/notes/')).length === 3)
    await waitFor(() => wrapper.text().includes('正在确认上次保存'))
    await wrapper.get('textarea').setValue('等待确认期间继续编辑的新改稿 B')
    const confirmationCall = api.calls.filter(call => call.path.startsWith('/me/notes/')).at(-1)
    confirmation.resolve(response({
      anchor: confirmationCall.body.anchor,
      noteId: existingNote.noteId,
      state: 'ACTIVE',
      text: confirmationCall.body.text,
      version: '6'
    }))
    await waitFor(() => wrapper.text().includes('新稿仍保留'))
    expect(wrapper.get('textarea').element.value).to.equal('等待确认期间继续编辑的新改稿 B')

    const confirmedWrites = api.calls.filter(call => call.path.startsWith('/me/notes/'))
    expect(confirmedWrites.slice(0, 3).map(call => call.body.text))
      .to.deep.equal(['未确认旧改稿', '未确认旧改稿', '未确认旧改稿'])
    expect(confirmedWrites.slice(0, 3).map(call => call.options.headers['Idempotency-Key']))
      .to.deep.equal(Array(3).fill(confirmedWrites[0].options.headers['Idempotency-Key']))

    await wrapper.get('.note-save').trigger('click')
    await waitFor(() => api.calls.filter(call => call.path.startsWith('/me/notes/')).length === 4)
    await waitFor(() => wrapper.get('textarea').element.value === '')
    const finalWrite = api.calls.filter(call => call.path.startsWith('/me/notes/')).at(-1)
    expect(finalWrite.path).to.equal(`/me/notes/${existingNote.noteId}`)
    expect(finalWrite.body.text).to.equal('等待确认期间继续编辑的新改稿 B')
    expect(finalWrite.body.expectedVersion).to.equal('6')
    expect(finalWrite.options.headers['Idempotency-Key'])
      .not.to.equal(confirmedWrites[0].options.headers['Idempotency-Key'])
    expect(wrapper.text()).to.include('等待确认期间继续编辑的新改稿 B')
    wrapper.unmount()
  })

  it('does not retarget a pending new-note confirmation onto another active note', async () => {
    const confirmation = deferred()
    const noteB = {
      anchor: null,
      noteId: 'target-note-b',
      state: 'ACTIVE',
      text: 'B 原稿',
      version: '9'
    }
    let newNotePath
    let newNoteAttempt = 0
    const api = makeApi({
      notesByBlock: { [chapterOne.blockId]: [noteB] },
      progress: {
        editionId,
        location: point(chapterOne, chapterOne.paragraphs[0]),
        version: '3'
      },
      putHandler: (call) => {
        if (!call.path.startsWith('/me/notes/')) {
          return response({ editionId, location: call.body.location, version: '4' })
        }
        if (!newNotePath) newNotePath = call.path
        if (call.path === newNotePath) {
          newNoteAttempt += 1
          if (newNoteAttempt <= 2) throw new Error('new note confirmation remains ambiguous')
          return confirmation.promise
        }
        return response({
          anchor: call.body.anchor,
          noteId: noteB.noteId,
          state: 'ACTIVE',
          text: call.body.text,
          version: '10'
        })
      }
    })
    const wrapper = mountArchiveReader(api)
    await waitFor(() => wrapper.find('.note-edit').exists())
    await wrapper.get('textarea').setValue('未确认的新手札')
    await wrapper.get('.note-save').trigger('click')
    await waitFor(() => api.calls.filter(call => call.path.startsWith('/me/notes/')).length === 2)
    await waitFor(() => wrapper.get('.note-save').attributes('disabled') === undefined)

    await wrapper.get('textarea').setValue('确认点击时的新手札 A')
    await wrapper.get('.note-save').trigger('click')
    await waitFor(() => api.calls.filter(call => call.path.startsWith('/me/notes/')).length === 3)
    await waitFor(() => wrapper.text().includes('正在确认上次保存'))
    expect(wrapper.get('.note-edit').attributes('disabled')).not.to.equal(undefined)
    expect(wrapper.get('.note-delete').attributes('disabled')).not.to.equal(undefined)

    wrapper.vm.__switchEditorTargetForTest(noteB, '等待期间编辑的 B 正文')
    await settle()
    const confirmationCall = api.calls.filter(call => call.path.startsWith('/me/notes/')).at(-1)
    confirmation.resolve(response({
      anchor: confirmationCall.body.anchor,
      noteId: confirmationCall.path.split('/').at(-1),
      state: 'ACTIVE',
      text: confirmationCall.body.text,
      version: '1'
    }))
    await waitFor(() => wrapper.get('.note-save').attributes('disabled') === undefined)
    expect(wrapper.get('textarea').element.value).to.equal('等待期间编辑的 B 正文')

    await wrapper.get('.note-save').trigger('click')
    await waitFor(() => api.calls.filter(call => call.path.startsWith('/me/notes/')).length === 4)
    const finalWrite = api.calls.filter(call => call.path.startsWith('/me/notes/')).at(-1)
    expect(finalWrite.path).to.equal(`/me/notes/${noteB.noteId}`)
    expect(finalWrite.body.expectedVersion).to.equal(noteB.version)
    expect(finalWrite.body.text).to.equal('等待期间编辑的 B 正文')
    expect(finalWrite.options.headers['Idempotency-Key'])
      .not.to.equal(confirmationCall.options.headers['Idempotency-Key'])
    expect(api.calls.filter(call => call.path === newNotePath)).to.have.length(3)
    wrapper.unmount()
  })

  it('coalesces rapid new-note submits behind one pending logical mutation', async () => {
    const noteResponse = deferred()
    const api = makeApi({
      putHandler: (call) => {
        if (!call.path.startsWith('/me/notes/')) throw new Error('unexpected mutation')
        return noteResponse.promise
      }
    })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    const first = mounted.reader.saveNote({ text: '只应提交一次', version: '0' })
    const second = mounted.reader.saveNote({ text: '只应提交一次', version: '0' })
    expect(first).to.equal(second)
    await waitFor(() => api.calls.some(call => call.path.startsWith('/me/notes/')))
    expect(api.calls.filter(call => call.path.startsWith('/me/notes/'))).to.have.length(1)
    const call = api.calls.find(item => item.path.startsWith('/me/notes/'))
    noteResponse.resolve(response({
      anchor: call.body.anchor,
      noteId: call.path.split('/').at(-1),
      state: 'ACTIVE',
      text: call.body.text,
      version: '1'
    }))
    await first
    mounted.wrapper.unmount()
  })

  it('snapshots completion at queue time instead of consulting a later chapter', async () => {
    const api = makeApi()
    const mounted = mountReader(api, { saveDelay: 30 })
    const finalParagraph = chapterOneHundredTwenty.paragraphs.at(-1)
    const finalLocation = point(
      chapterOneHundredTwenty,
      finalParagraph,
      finalParagraph.utf8ByteLength
    )
    primeReader(mounted.reader, chapterOneHundredTwenty, {
      editionId,
      location: point(chapterOneHundredTwenty, chapterOneHundredTwenty.paragraphs[0]),
      version: '5'
    })

    mounted.reader.scheduleProgressSave(finalLocation)
    mounted.reader.chapter.value = chapterOneHundredNineteen
    await waitFor(() => api.calls.filter(call => call.path.startsWith('/me/progress/')).length === 1)

    const firstSave = api.calls.find(call => call.path.startsWith('/me/progress/'))
    expect(firstSave.body.location).to.deep.equal(finalLocation)
    expect(firstSave.body.markCompleted).to.equal(true)

    mounted.reader.chapter.value = chapterOneHundredTwenty
    const nonFinalLocation = point(chapterOneHundredTwenty, finalParagraph, 0)
    mounted.reader.scheduleProgressSave(nonFinalLocation)
    mounted.reader.chapter.value = chapterOneHundredNineteen
    await waitFor(() => api.calls.filter(call => call.path.startsWith('/me/progress/')).length === 2)

    const saves = api.calls.filter(call => call.path.startsWith('/me/progress/'))
    expect(saves[1].body.location).to.deep.equal(nonFinalLocation)
    expect(saves[1].body.markCompleted).to.equal(false)
    mounted.wrapper.unmount()
  })

  it('replays a lost progress response with the identical body and idempotency key', async () => {
    let attempt = 0
    const api = makeApi({
      putHandler: (call) => {
        if (!call.path.startsWith('/me/progress/')) throw new Error('unexpected mutation')
        attempt += 1
        if (attempt === 1) throw new Error('response lost')
        return response({ editionId, location: call.body.location, version: '1' })
      }
    })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    await mounted.reader.saveProgress()

    const writes = api.calls.filter(call => call.path.startsWith('/me/progress/'))
    expect(writes).to.have.length(2)
    expect(writes[0].body).to.deep.equal(writes[1].body)
    expect(writes[0].options.headers['Idempotency-Key'])
      .to.equal(writes[1].options.headers['Idempotency-Key'])
    mounted.wrapper.unmount()
  })

  it('serializes and coalesces progress saves before using the confirmed next version', async () => {
    const firstResponse = deferred()
    let active = 0
    let maxActive = 0
    const api = makeApi({
      putHandler: async (call) => {
        if (!call.path.startsWith('/me/progress/')) throw new Error('unexpected mutation')
        active += 1
        maxActive = Math.max(maxActive, active)
        if (call.body.expectedVersion === '0') await firstResponse.promise
        active -= 1
        return response({
          editionId,
          location: call.body.location,
          version: call.body.expectedVersion === '0' ? '1' : '2'
        })
      }
    })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    const first = mounted.reader.saveProgress(point(chapterOne, chapterOne.paragraphs[0]))
    await settle()
    const second = mounted.reader.saveProgress(point(chapterOne, chapterOne.paragraphs[1]))
    expect(api.calls.filter(call => call.path.startsWith('/me/progress/'))).to.have.length(1)
    firstResponse.resolve()
    await Promise.all([first, second])

    const writes = api.calls.filter(call => call.path.startsWith('/me/progress/'))
    expect(writes).to.have.length(2)
    expect(writes[0].body.expectedVersion).to.equal('0')
    expect(writes[1].body.expectedVersion).to.equal('1')
    expect(writes[1].body.location.paragraphId).to.equal(chapterOne.paragraphs[1].paragraphId)
    expect(maxActive).to.equal(1)
    expect(mounted.reader.saveState.value).to.equal('saved')
    mounted.wrapper.unmount()
  })

  it('runs bookmark and note CRUD through real DOM actions without leaked rejections', async () => {
    const target = point(chapterOne, chapterOne.paragraphs[0])
    const api = makeApi({ progress: { editionId, location: target, version: '1' } })
    const wrapper = mountArchiveReader(api)
    await waitFor(() => wrapper.find('.bookmark-create').exists() && wrapper.get('.bookmark-create').attributes('disabled') === undefined)

    await wrapper.get('.bookmark-create').trigger('click')
    await waitFor(() => wrapper.find('.bookmark-delete').exists())
    await wrapper.get('.bookmark-delete').trigger('click')
    await waitFor(() => !wrapper.find('.bookmark-delete').exists())

    await wrapper.get('textarea').setValue('初稿')
    await wrapper.get('.note-save').trigger('click')
    await waitFor(() => wrapper.find('.note-edit').exists())
    await wrapper.get('.note-edit').trigger('click')
    await wrapper.get('textarea').setValue('改稿')
    await wrapper.get('.note-save').trigger('click')
    await waitFor(() => wrapper.text().includes('改稿'))
    await wrapper.get('.note-delete').trigger('click')
    await waitFor(() => !wrapper.find('.note-delete').exists())

    const writes = api.calls.filter(call => ['put', 'delete'].includes(call.method))
    expect(writes.every(call => !call.path.includes('?'))).to.equal(true)
    const deletes = writes.filter(call => call.method === 'delete')
    expect(deletes.map(call => call.options.headers['If-Match'])).to.deep.equal(['"v1"', '"v2"'])
    wrapper.unmount()
  })

  it('catches rejected DOM actions and exposes a user-readable state', async () => {
    const target = point(chapterOne, chapterOne.paragraphs[0])
    const failure = Object.assign(new Error('service unavailable'), { status: 503 })
    const api = makeApi({
      progress: { editionId, location: target, version: '1' },
      putHandler: (call) => {
        if (call.path.startsWith('/me/bookmarks/')) throw failure
        return response({ editionId, location: call.body.location, version: '2' })
      }
    })
    const wrapper = mountArchiveReader(api)
    await waitFor(() => wrapper.find('.bookmark-create').exists() && wrapper.get('.bookmark-create').attributes('disabled') === undefined)
    await wrapper.get('.bookmark-create').trigger('click')
    await waitFor(() => wrapper.text().includes('书签暂未保存'))
    expect(wrapper.get('[role="alert"]').text()).to.include('书签暂未保存')
    wrapper.unmount()
  })

  it('clears stale progress, bookmark, and note errors after confirmed success paths', async () => {
    const failure = Object.assign(new Error('temporary failure'), { status: 503 })
    const attempts = { bookmark: 0, note: 0, progress: 0 }
    const api = makeApi({
      putHandler: (call) => {
        if (call.path.startsWith('/me/progress/')) {
          attempts.progress += 1
          if (attempts.progress === 1) throw failure
          return response({ editionId, location: call.body.location, version: '2' })
        }
        if (call.path.startsWith('/me/bookmarks/')) {
          attempts.bookmark += 1
          if (attempts.bookmark === 1) throw failure
          return response({
            bookmarkId: call.path.split('/').at(-1),
            location: call.body.location,
            state: 'ACTIVE',
            version: '1'
          })
        }
        attempts.note += 1
        if (attempts.note === 1) throw failure
        return response({
          anchor: call.body.anchor,
          noteId: call.path.split('/').at(-1),
          state: 'ACTIVE',
          text: call.body.text,
          version: call.body.expectedVersion === '0' ? '1' : '2'
        })
      }
    })
    const mounted = mountReader(api)
    primeReader(mounted.reader, chapterOne, {
      editionId,
      location: point(chapterOne, chapterOne.paragraphs[0]),
      version: '1'
    })

    await mounted.reader.saveProgress().catch(error => error)
    expect(mounted.reader.errorMessage.value).to.equal('阅读进度暂未保存。')
    await mounted.reader.saveProgress()
    expect(mounted.reader.saveState.value).to.equal('saved')
    expect(mounted.reader.errorMessage.value).to.equal('')

    await mounted.reader.createBookmark().catch(error => error)
    expect(mounted.reader.errorMessage.value).to.include('书签暂未保存')
    const bookmark = await mounted.reader.createBookmark()
    expect(mounted.reader.errorMessage.value).to.equal('')
    mounted.reader.errorMessage.value = '书签暂未删除，请重试。'
    await mounted.reader.deleteBookmark(bookmark)
    expect(mounted.reader.errorMessage.value).to.equal('')

    await mounted.reader.saveNote({ text: '失败手札', version: '0' }).catch(error => error)
    expect(mounted.reader.errorMessage.value).to.include('手札暂未保存')
    const created = await mounted.reader.saveNote({ text: '成功手札', version: '0' })
    expect(mounted.reader.errorMessage.value).to.equal('')
    mounted.reader.errorMessage.value = '手札暂未保存，请重试。'
    const edited = await mounted.reader.saveNote({
      noteId: created.note.noteId,
      text: '成功改稿',
      anchor: created.note.anchor,
      version: created.note.version
    })
    expect(mounted.reader.errorMessage.value).to.equal('')
    mounted.reader.errorMessage.value = '手札暂未删除，请重试。'
    await mounted.reader.deleteNote(edited.note)
    expect(mounted.reader.errorMessage.value).to.equal('')
    mounted.wrapper.unmount()
  })

  it('flushes pending progress best-effort on pagehide', async () => {
    const api = makeApi()
    const mounted = mountReader(api, { saveDelay: 1000 })
    primeReader(mounted.reader)
    mounted.reader.scheduleProgressSave(point(chapterOne, chapterOne.paragraphs[1]))
    window.dispatchEvent(new window.Event('pagehide'))
    await waitFor(() => api.calls.some(call => call.path.startsWith('/me/progress/')))
    const save = api.calls.find(call => call.path.startsWith('/me/progress/'))
    expect(save.body.location.paragraphId).to.equal(chapterOne.paragraphs[1].paragraphId)
    mounted.wrapper.unmount()
  })

  it('stops initialization after a deferred catalog resolves following unmount', async () => {
    const catalogResponse = deferred()
    let catalogSignal
    const api = makeApi({
      getCatalog: (call) => {
        catalogSignal = call.options.signal
        return catalogResponse.promise
      }
    })
    const mounted = mountReader(api)
    const pending = mounted.reader.initialize()
    await waitFor(() => api.calls.length === 1)
    expect(api.calls[0].path).to.equal('/catalog')

    mounted.wrapper.unmount()
    expect(catalogSignal.aborted).to.equal(true)
    catalogResponse.resolve(response(catalog))
    expect(await pending).to.equal(null)
    await settle()
    expect(api.calls.map(call => call.path)).to.deep.equal(['/catalog'])
  })

  it('aborts stale block work and clears pending DOM scroll saves on unmount', async () => {
    const blockResponse = deferred()
    let blockSignal
    const api = makeApi({
      getBlock: (_blockId, call) => {
        blockSignal = call.options.signal
        return blockResponse.promise
      },
      progress: { editionId, location: point(chapterOne, chapterOne.paragraphs[0]), version: '1' }
    })
    const mounted = mountReader(api)
    mounted.reader.catalog.value = catalog
    const pending = mounted.reader.loadBlock(c1Summary)
    mounted.wrapper.unmount()
    expect(blockSignal.aborted).to.equal(true)
    blockResponse.resolve(response(chapterOne))
    expect(await pending).to.equal(null)

    const domApi = makeApi({
      progress: { editionId, location: point(chapterOne, chapterOne.paragraphs[0]), version: '1' }
    })
    const wrapper = mountArchiveReader(domApi, { saveDelay: 1 })
    await waitFor(() => wrapper.findAll('.reader-paragraph').length === 2)
    const content = wrapper.get('.reader-content')
    const [first] = wrapper.findAll('.reader-paragraph')
    content.element.getBoundingClientRect = () => ({ bottom: 100, top: 0 })
    first.element.getBoundingClientRect = () => ({ bottom: 80, top: 10 })
    await content.trigger('scroll')
    wrapper.unmount()
    await new Promise(resolve => setTimeout(resolve, 220))
    expect(domApi.calls.some(call => call.method === 'put' && call.path.startsWith('/me/progress/')))
      .to.equal(false)
  })

  it('creates a UTF-8 multi-paragraph question anchor without any routing fields', async () => {
    const api = makeQuestionApi({ createSelectedText: '水😀乙\n\n第二' })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    chapterOne.paragraphs[0].text = '甲水😀乙'
    chapterOne.paragraphs[0].utf8ByteLength = utf8ByteLength(chapterOne.paragraphs[0].text)
    try {
      await mounted.reader.createQuestion({
        question: '此处何意？',
        selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 1, endParagraphId: chapterOne.paragraphs[1].paragraphId, endOffset: 2 }
      })
      const call = api.calls.find(item => item.method === 'put' && item.path.startsWith('/me/questions/'))
      expect(call.body).to.have.all.keys(['anchor', 'question'])
      expect(call.body).not.to.have.any.keys(['targetAgentId', 'agentId', 'role', 'responder'])
      expect(call.body.anchor.segments.map(segment => [segment.startByte, segment.endByte])).to.deep.equal([[3, 13], [0, 6]])
      expect(call.body.anchor.selectionSha256).to.equal(createHash('sha256').update('水😀乙\n\n第二').digest('hex'))
    } finally {
      chapterOne.paragraphs[0].text = '第一段正文'
      chapterOne.paragraphs[0].utf8ByteLength = utf8ByteLength(chapterOne.paragraphs[0].text)
      mounted.wrapper.unmount()
    }
  })

  it('rejects a cross-paragraph DOM selection when an intermediate rendered paragraph is not authoritative', async () => {
    const extra = paragraph(preface.blockId, 3, '引首第三段', '5')
    preface.paragraphs.push(extra)
    const api = makeQuestionApi()
    let wrapper
    try {
      wrapper = mountArchiveReader(api)
      await waitFor(() => wrapper.findAll('.reader-paragraph').length === 3)
      const rendered = wrapper.findAll('.reader-paragraph')
      rendered[1].element.textContent = '被篡改的中段'
      const range = document.createRange()
      range.setStart(rendered[0].element.firstChild, 0)
      range.setEnd(rendered[2].element.firstChild, 1)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      await wrapper.get('.archive-question textarea').setValue('中段是否可信？')
      await wrapper.get('.question-create').trigger('click')
      await settle()
      expect(wrapper.text()).to.include('当前正文与权威段落不一致')
      expect(api.calls.some(call => call.method === 'put' && call.path.startsWith('/me/questions/'))).to.equal(false)
    } finally {
      wrapper?.unmount()
      preface.paragraphs.pop()
    }
  })

  it('fails closed for invalid selection, responder, sequences and resync before replacing a snapshot', async () => {
    const replacement = questionSnapshot({ currentSequence: '2', status: 'RUNNING', updatedAt: '2026-08-23T00:00:01Z', version: '2' })
    const api = makeQuestionApi({ snapshots: [replacement, replacement] })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    chapterOne.paragraphs[0].text = '甲😀乙'
    try {
      await mounted.reader.createQuestion({ question: '问', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 2, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 3 } }).catch(error => error)
      expect(api.calls.some(item => item.method === 'put' && item.path.startsWith('/me/questions/'))).to.equal(false)
      chapterOne.paragraphs[0].text = '第一段正文'
      await mounted.reader.createQuestion({ question: '问', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
      expect(api.sessions).to.have.length(1)
      api.emit(0, questionEvent('3', 'ANSWER_DELTA', { delta: '跳号' }))
      await waitFor(() => mounted.reader.question.value?.currentSequence === '2')
      expect(mounted.reader.question.value.answer).to.equal('')
      expect(api.sessions[0].cancelled).to.equal(true)
      api.emit(1, { schemaVersion: 1, questionId, type: 'resync_required' }, 'resync_required')
      await settle()
      expect(api.sessions[1].cancelled).to.equal(true)
    } finally {
      chapterOne.paragraphs[0].text = '第一段正文'
      mounted.wrapper.unmount()
    }
  })

  it('fails closed for a non-clerk snapshot and invalid or overflowing event cursors', async () => {
    const badApi = makeQuestionApi({ createSnapshot: questionSnapshot({ responder: { id: 'agent-wuyong', displayName: '吴用', mode: 'agent' } }) })
    const bad = mountReader(badApi)
    primeReader(bad.reader)
    await bad.reader.createQuestion({ question: '问', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } }).catch(error => error)
    expect(bad.reader.question.value).to.equal(null)
    expect(badApi.sessions).to.have.length(0)
    bad.wrapper.unmount()

    const api = makeQuestionApi({ snapshots: [questionSnapshot({ currentSequence: '9223372036854775807', version: '2' })] })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    await mounted.reader.createQuestion({ question: '问', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    api.emit(0, questionEvent('01', 'ANSWER_DELTA', { delta: '非法' }))
    await waitFor(() => api.sessions[0].cancelled)
    await waitFor(() => mounted.reader.question.value?.currentSequence === '9223372036854775807')
    api.emit(1, questionEvent('9223372036854775808', 'ANSWER_DELTA', { delta: '溢出' }))
    await settle()
    expect(api.sessions[1].cancelled).to.equal(true)
    mounted.wrapper.unmount()
  })

  it('applies only exact-next events, ignores duplicates, and replaces terminal state authoritatively', async () => {
    const succeeded = questionSnapshot({
      answer: '答',
      completedAt: '2026-08-23T00:00:02Z',
      currentSequence: '3',
      status: 'SUCCEEDED',
      updatedAt: '2026-08-23T00:00:02Z',
      version: '3'
    })
    const api = makeQuestionApi({ snapshots: [succeeded] })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    await mounted.reader.createQuestion({ question: '问', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    api.emit(0, questionEvent('2', 'ANSWER_DELTA', { delta: '答' }))
    api.emit(0, questionEvent('2', 'ANSWER_DELTA', { delta: '重复' }))
    expect(mounted.reader.question.value.answer).to.equal('答')
    api.emit(0, questionEvent('3', 'QUESTION_SUCCEEDED', { status: 'SUCCEEDED' }))
    expect(api.sessions[0].cancelled).to.equal(true)
    await waitFor(() => mounted.reader.question.value?.version === '3')
    expect(mounted.reader.question.value).to.include({ answer: '答', status: 'SUCCEEDED' })
    expect(api.sessions).to.have.length(1)
    mounted.wrapper.unmount()
  })

  it('replaces FAILED_RETRYABLE from the real event path and retries with its authoritative version and stable mutation', async () => {
    const failed = questionSnapshot({
      currentSequence: '3',
      lastErrorCode: 'QUESTION_PROVIDER_UNAVAILABLE',
      status: 'FAILED_RETRYABLE',
      updatedAt: '2026-08-23T00:00:02Z',
      version: '3'
    })
    const queued = questionSnapshot({
      currentSequence: '4',
      status: 'QUEUED',
      updatedAt: '2026-08-23T00:00:03Z',
      version: '4'
    })
    let postAttempts = 0
    const api = makeQuestionApi({
      snapshots: [failed],
      postHandler: (call) => {
        postAttempts += 1
        if (postAttempts === 1) throw new Error('ambiguous network failure')
        return response({ ...queued, questionId: call.path.split('/')[3] })
      }
    })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    await mounted.reader.createQuestion({ question: '问', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    api.emit(0, questionEvent('2', 'QUESTION_RUNNING', { attempt: 1, retryCount: 0, status: 'RUNNING' }))
    expect(mounted.reader.question.value.version).to.equal('1')
    api.emit(0, questionEvent('3', 'QUESTION_FAILED_RETRYABLE', {
      lastErrorCode: 'QUESTION_PROVIDER_UNAVAILABLE', retryCount: 0, status: 'FAILED_RETRYABLE'
    }))
    expect(api.sessions[0].cancelled).to.equal(true)
    expect(mounted.reader.questionPending.value).to.equal(true)
    await waitFor(() => mounted.reader.question.value?.version === '3' && !mounted.reader.questionPending.value)
    expect(mounted.reader.question.value.status).to.equal('FAILED_RETRYABLE')
    expect(api.sessions).to.have.length(1)

    await mounted.reader.retryQuestion()
    const retries = api.calls.filter(call => call.method === 'post')
    expect(retries).to.have.length(2)
    expect(retries.map(call => call.body)).to.deep.equal([{ expectedVersion: '3' }, { expectedVersion: '3' }])
    expect(retries[0].options.headers['Idempotency-Key']).to.equal(retries[1].options.headers['Idempotency-Key'])
    expect(mounted.reader.question.value).to.include({ currentSequence: '4', status: 'QUEUED', version: '4' })
    mounted.wrapper.unmount()
  })

  it('shows one coherent DOM message after retry 409 refreshes the authoritative snapshot', async () => {
    const prefaceQuestionAnchor = questionAnchor(preface, '引')
    const failed = questionSnapshot({
      anchor: prefaceQuestionAnchor, currentSequence: '3', lastErrorCode: 'QUESTION_PROVIDER_UNAVAILABLE', selectedText: '引', status: 'FAILED_RETRYABLE',
      updatedAt: '2026-08-23T00:00:02Z', version: '3'
    })
    const refreshed = questionSnapshot({
      anchor: prefaceQuestionAnchor, currentSequence: '4', lastErrorCode: 'QUESTION_PROVIDER_UNAVAILABLE', selectedText: '引', status: 'FAILED_RETRYABLE',
      updatedAt: '2026-08-23T00:00:03Z', version: '4'
    })
    const api = makeQuestionApi({
      createSelectedText: '引',
      snapshots: [failed, refreshed],
      postHandler: () => {
        const error = new Error('conflict')
        error.status = 409
        throw error
      }
    })
    const wrapper = mountArchiveReader(api)
    await waitFor(() => wrapper.findAll('.reader-paragraph').length === 2)
    await wrapper.readerState.createQuestion({ question: '问', selection: { startParagraphId: preface.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: preface.paragraphs[0].paragraphId, endOffset: 1 } })
    api.emit(0, questionEvent('2', 'QUESTION_RUNNING', { attempt: 1, retryCount: 0, status: 'RUNNING' }))
    api.emit(0, questionEvent('3', 'QUESTION_FAILED_RETRYABLE', {
      lastErrorCode: 'QUESTION_PROVIDER_UNAVAILABLE', retryCount: 0, status: 'FAILED_RETRYABLE'
    }))
    await waitFor(() => wrapper.readerState.question.value?.version === '3' && !wrapper.readerState.questionPending.value)
    await wrapper.get('.question-retry').trigger('click')
    await waitFor(() => wrapper.readerState.question.value?.version === '4' && !wrapper.readerState.questionPending.value)
    expect(wrapper.text()).to.include('问题版本已更新，已刷新案卷书吏状态。')
    expect(wrapper.text()).not.to.include('案卷书吏重试失败。')
    wrapper.unmount()
  })

  it('refreshes the authoritative snapshot after retry 409 and derives the next CAS request from it', async () => {
    const failedV3 = questionSnapshot({
      currentSequence: '3', lastErrorCode: 'QUESTION_PROVIDER_UNAVAILABLE', status: 'FAILED_RETRYABLE',
      updatedAt: '2026-08-23T00:00:02Z', version: '3'
    })
    const failedV4 = questionSnapshot({
      currentSequence: '4', lastErrorCode: 'QUESTION_PROVIDER_UNAVAILABLE', status: 'FAILED_RETRYABLE',
      updatedAt: '2026-08-23T00:00:03Z', version: '4'
    })
    const queuedV5 = questionSnapshot({ currentSequence: '5', status: 'QUEUED', updatedAt: '2026-08-23T00:00:04Z', version: '5' })
    let postAttempts = 0
    const api = makeQuestionApi({
      snapshots: [failedV3, failedV4],
      postHandler: (call) => {
        postAttempts += 1
        if (postAttempts === 1) {
          const error = new Error('conflict')
          error.status = 409
          throw error
        }
        return response({ ...queuedV5, questionId: call.path.split('/')[3] })
      }
    })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    await mounted.reader.createQuestion({ question: '问', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    api.emit(0, questionEvent('2', 'QUESTION_RUNNING', { attempt: 1, retryCount: 0, status: 'RUNNING' }))
    api.emit(0, questionEvent('3', 'QUESTION_FAILED_RETRYABLE', {
      lastErrorCode: 'QUESTION_PROVIDER_UNAVAILABLE', retryCount: 0, status: 'FAILED_RETRYABLE'
    }))
    await waitFor(() => mounted.reader.question.value?.version === '3' && !mounted.reader.questionPending.value)
    await mounted.reader.retryQuestion().catch(error => error)
    await waitFor(() => mounted.reader.question.value?.version === '4' && !mounted.reader.questionPending.value)
    await mounted.reader.retryQuestion()
    const retries = api.calls.filter(call => call.method === 'post')
    expect(retries.map(call => call.body.expectedVersion)).to.deep.equal(['3', '4'])
    expect(retries[0].options.headers['Idempotency-Key']).not.to.equal(retries[1].options.headers['Idempotency-Key'])
    mounted.wrapper.unmount()
  })

  it('aborts deferred create, retry, and recovery requests so late responses cannot revive stale questions', async () => {
    const createResponse = deferred()
    let createCall
    const createApi = makeQuestionApi({ putHandler: (call) => { createCall = call; return createResponse.promise } })
    const creating = mountReader(createApi)
    primeReader(creating.reader)
    const pendingCreate = creating.reader.createQuestion({ question: '迟到创建', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    await waitFor(() => createCall)
    await creating.reader.loadBlock(c81Summary)
    expect(createCall.options.signal.aborted).to.equal(true)
    createResponse.resolve(response({
      ...questionSnapshot(), anchor: createCall.body.anchor, questionId: createCall.path.split('/').at(-1)
    }))
    expect(await pendingCreate).to.equal(null)
    expect(creating.reader.question.value).to.equal(null)
    expect(createApi.sessions).to.have.length(0)
    creating.wrapper.unmount()

    const rejectedResponse = deferred()
    let rejectedCall
    const rejectedApi = makeQuestionApi({ putHandler: (call) => { rejectedCall = call; return rejectedResponse.promise } })
    const rejected = mountReader(rejectedApi)
    primeReader(rejected.reader)
    const pendingRejected = rejected.reader.createQuestion({ question: '迟到拒绝', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    await waitFor(() => rejectedCall)
    rejected.reader.closeQuestion()
    rejectedResponse.reject(new Error('late failure'))
    expect(await pendingRejected).to.equal(null)
    expect(rejected.reader.questionError.value).to.equal('')
    rejected.wrapper.unmount()

    const failed = questionSnapshot({
      currentSequence: '3', lastErrorCode: 'QUESTION_PROVIDER_UNAVAILABLE', status: 'FAILED_RETRYABLE',
      updatedAt: '2026-08-23T00:00:02Z', version: '3'
    })
    const retryResponse = deferred()
    let retryCall
    const retryApi = makeQuestionApi({ snapshots: [failed], postHandler: (call) => { retryCall = call; return retryResponse.promise } })
    const retrying = mountReader(retryApi)
    primeReader(retrying.reader)
    await retrying.reader.createQuestion({ question: '迟到重试', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    retryApi.emit(0, questionEvent('2', 'QUESTION_RUNNING', { attempt: 1, retryCount: 0, status: 'RUNNING' }))
    retryApi.emit(0, questionEvent('3', 'QUESTION_FAILED_RETRYABLE', {
      lastErrorCode: 'QUESTION_PROVIDER_UNAVAILABLE', retryCount: 0, status: 'FAILED_RETRYABLE'
    }))
    await waitFor(() => retrying.reader.question.value?.version === '3' && !retrying.reader.questionPending.value)
    const pendingRetry = retrying.reader.retryQuestion()
    await waitFor(() => retryCall)
    retrying.wrapper.unmount()
    expect(retryCall.options.signal.aborted).to.equal(true)
    retryResponse.resolve(response({ ...questionSnapshot({ currentSequence: '4', version: '4' }), questionId: retryCall.path.split('/')[3] }))
    expect(await pendingRetry).to.equal(null)
    expect(retryApi.sessions).to.have.length(1)

    const recoveryResponse = deferred()
    let recoveryCall
    const recoveryApi = makeQuestionApi({ getHandler: (call) => { recoveryCall = call; return recoveryResponse.promise } })
    const recovering = mountReader(recoveryApi)
    primeReader(recovering.reader)
    await recovering.reader.createQuestion({ question: '迟到恢复', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    recoveryApi.emit(0, questionEvent('3', 'ANSWER_DELTA', { delta: 'gap' }))
    await waitFor(() => recoveryCall)
    recovering.reader.closeQuestion()
    expect(recoveryCall.options.signal.aborted).to.equal(true)
    recoveryResponse.resolve(response({ ...questionSnapshot({ currentSequence: '2', status: 'RUNNING', version: '2' }), questionId: recoveryCall.path.split('/')[3] }))
    await settle()
    expect(recovering.reader.question.value).to.equal(null)
    expect(recoveryApi.sessions).to.have.length(1)
    recovering.wrapper.unmount()
  })

  it('enforces anchor segment and selected-byte limits before PUT', async () => {
    const api = makeQuestionApi()
    const mounted = mountReader(api)
    const manyParagraphs = {
      ...chapterOne,
      blockId: `${editionId}-c001-many`,
      paragraphs: Array.from({ length: 17 }, (_, index) => paragraph(`${editionId}-c001-many`, index + 1, `段${index + 1}`, 'f'))
    }
    primeReader(mounted.reader, manyParagraphs)
    await mounted.reader.createQuestion({
      question: '过多段落',
      selection: { startParagraphId: manyParagraphs.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: manyParagraphs.paragraphs[16].paragraphId, endOffset: 1 }
    }).catch(error => error)
    expect(api.calls.some(call => call.method === 'put' && call.path.startsWith('/me/questions/'))).to.equal(false)

    primeReader(mounted.reader, chapterEightyOne)
    await mounted.reader.createQuestion({
      question: '过长选文',
      selection: { startParagraphId: chapterEightyOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterEightyOne.paragraphs[0].paragraphId, endOffset: chapterEightyOne.paragraphs[0].text.length }
    }).catch(error => error)
    expect(api.calls.some(call => call.method === 'put' && call.path.startsWith('/me/questions/'))).to.equal(false)
    mounted.wrapper.unmount()
  })

  it('accepts exactly 16 segments and exactly 8192 UTF-8 selected bytes', async () => {
    const block = {
      ...chapterOne,
      blockId: `${editionId}-c001-exact-limits`,
      paragraphs: Array.from({ length: 16 }, (_, index) => paragraph(
        `${editionId}-c001-exact-limits`,
        index + 1,
        'x'.repeat(index === 15 ? 512 : 510),
        'e'
      ))
    }
    const selectedText = block.paragraphs.map(item => item.text).join('\n\n')
    expect(utf8ByteLength(selectedText)).to.equal(8192)
    const api = makeQuestionApi({ createSelectedText: selectedText })
    const mounted = mountReader(api)
    primeReader(mounted.reader, block)
    await mounted.reader.createQuestion({
      question: '边界选文',
      selection: {
        startParagraphId: block.paragraphs[0].paragraphId,
        startOffset: 0,
        endParagraphId: block.paragraphs.at(-1).paragraphId,
        endOffset: block.paragraphs.at(-1).text.length
      }
    })
    const call = api.calls.find(item => item.method === 'put' && item.path.startsWith('/me/questions/'))
    expect(call.body.anchor.segments).to.have.length(16)
    expect(call.body.anchor.segments.reduce((total, segment) => total + segment.endByte - segment.startByte, 30)).to.equal(8192)
    mounted.wrapper.unmount()
  })

  it('requires persisted SSE name/id parity, ignores heartbeat comments, and rejects IDs on resync', async () => {
    const api = makeQuestionApi({ snapshots: [questionSnapshot(), questionSnapshot(), questionSnapshot()] })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    await mounted.reader.createQuestion({ question: '问', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    api.heartbeat(0)
    await settle()
    expect(api.sessions[0].cancelled).to.equal(false)
    expect(api.calls.filter(call => call.method === 'get' && call.path.startsWith('/me/questions/'))).to.have.length(0)

    api.emit(0, questionEvent('2', 'QUESTION_RUNNING', { attempt: 1, retryCount: 0, status: 'RUNNING' }), 'ANSWER_DELTA')
    await waitFor(() => api.sessions.length === 2)
    expect(api.sessions[0].cancelled).to.equal(true)
    api.emit(1, questionEvent('2', 'QUESTION_RUNNING', { attempt: 1, retryCount: 0, status: 'RUNNING' }), 'QUESTION_RUNNING', null)
    await waitFor(() => api.sessions.length === 3)
    expect(api.sessions[1].cancelled).to.equal(true)
    api.emit(2, { schemaVersion: 1, questionId, type: 'resync_required' }, 'resync_required', '2')
    await waitFor(() => api.sessions[2].cancelled)
    mounted.wrapper.unmount()
  })

  it('fails closed on duplicate event fields including event: message and parses CRLF split across chunks', async () => {
    const replacement = questionSnapshot({ currentSequence: '1', status: 'RUNNING', updatedAt: '2026-08-23T00:00:01Z', version: '2' })
    const api = makeQuestionApi({ snapshots: [replacement] })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    await mounted.reader.createQuestion({ question: '问', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    const running = questionEvent('2', 'QUESTION_RUNNING', { attempt: 1, retryCount: 0, status: 'RUNNING' })
    api.chunk(0, `event: message\nevent: ${running.type}\nid: ${running.sequence}\ndata: ${JSON.stringify(running)}\n\n`)
    await waitFor(() => api.sessions.length === 2)
    expect(api.sessions[0].cancelled).to.equal(true)

    const delta = { ...questionEvent('2', 'ANSWER_DELTA', { delta: '跨块 CRLF' }), questionId: mounted.reader.question.value.questionId }
    api.chunk(1, `event: ${delta.type}\r`)
    api.chunk(1, `\nid: ${delta.sequence}\r`)
    api.chunk(1, `\ndata: ${JSON.stringify(delta)}\r`)
    api.chunk(1, '\n\r')
    api.chunk(1, '\n')
    await settle()
    expect(mounted.reader.question.value).to.include({ currentSequence: '2', status: 'RUNNING' })
    expect(mounted.reader.question.value.answer).to.equal('跨块 CRLF')
    expect(api.sessions).to.have.length(2)
    expect(api.sessions[1].cancelled).to.equal(false)
    mounted.wrapper.unmount()
  })

  it('ignores a delayed callback from a replaced same-question stream', async () => {
    const replacement = questionSnapshot({ currentSequence: '1', status: 'RUNNING', updatedAt: '2026-08-23T00:00:01Z', version: '2' })
    const api = makeQuestionApi({ snapshots: [replacement] })
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    await mounted.reader.createQuestion({ question: '问', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    api.emit(0, questionEvent('3', 'ANSWER_DELTA', { delta: '触发恢复' }))
    await waitFor(() => api.sessions.length === 2)
    api.emit(0, questionEvent('2', 'ANSWER_DELTA', { delta: '旧流迟到' }))
    await settle()
    expect(mounted.reader.question.value.answer).to.equal('')
    expect(api.sessions).to.have.length(2)
    expect(api.sessions[1].cancelled).to.equal(false)
    api.emit(1, questionEvent('2', 'ANSWER_DELTA', { delta: '新流有效' }))
    expect(mounted.reader.question.value.answer).to.equal('新流有效')
    mounted.wrapper.unmount()
  })

  it('rejects adversarial snapshots without replacing the current question or opening a new stream', async () => {
    const corruptions = [
      snapshot => ({ ...snapshot, anchor: { ...snapshot.anchor, selectionSha256: '0'.repeat(64) } }),
      snapshot => ({
        ...snapshot,
        anchor: { ...snapshot.anchor, segments: [{ ...snapshot.anchor.segments[0], endByte: 0 }] }
      }),
      snapshot => ({ ...snapshot, question: 'x'.repeat(8193) }),
      snapshot => ({ ...snapshot, agentId: 'forbidden-extra-field' }),
      snapshot => ({ ...snapshot, updatedAt: 'not-an-instant' }),
      snapshot => ({ ...snapshot, completedAt: '2026-08-23T00:00:02Z', lastErrorCode: 'QUESTION_PROVIDER_UNAVAILABLE', status: 'FAILED_RETRYABLE' }),
      snapshot => ({ ...snapshot, answer: '', completedAt: '2026-08-23T00:00:02Z', status: 'SUCCEEDED' })
    ]
    for (const corrupt of corruptions) {
      const api = makeQuestionApi({ snapshots: [corrupt(questionSnapshot({ currentSequence: '2', version: '2' }))] })
      const mounted = mountReader(api)
      primeReader(mounted.reader)
      await mounted.reader.createQuestion({ question: '问', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
      api.emit(0, questionEvent('3', 'ANSWER_DELTA', { delta: 'gap' }))
      await waitFor(() => mounted.reader.questionError.value.includes('状态暂无法恢复'))
      expect(mounted.reader.question.value).to.include({ currentSequence: '1', status: 'QUEUED', version: '1' })
      expect(api.sessions).to.have.length(1)
      mounted.reader.closeQuestion()
      mounted.wrapper.unmount()
    }
  })

  it('cleans question readers on switch and unmount and rejects stale callbacks', async () => {
    const api = makeQuestionApi()
    const mounted = mountReader(api)
    primeReader(mounted.reader)
    await mounted.reader.createQuestion({ question: '问一', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    mounted.reader.closeQuestion()
    await mounted.reader.createQuestion({ question: '问二', selection: { startParagraphId: chapterOne.paragraphs[0].paragraphId, startOffset: 0, endParagraphId: chapterOne.paragraphs[0].paragraphId, endOffset: 1 } })
    api.emit(0, questionEvent('2', 'ANSWER_DELTA', { delta: '旧流' }))
    expect(mounted.reader.question.value.answer).to.equal('')
    mounted.wrapper.unmount()
    expect(api.sessions[1].cancelled).to.equal(true)
  })

  it('keeps decimal strings and archive isolation explicit', () => {
    const source = readFileSync(
      new URL('../src/composables/juyiting/useArchiveReader.js', import.meta.url),
      'utf8'
    )
    expect(isCanonicalDecimal('9223372036854775807')).to.equal(true)
    expect(isCanonicalDecimal('01')).to.equal(false)
    expect(isCanonicalDecimal(9)).to.equal(false)
    expect(source).to.include("createApi('/archive/v1')")
    expect(source).not.to.include('selectedAgent')
    expect(source).not.to.include('/agent/active')
  })

  it('keeps actual JuyiHall, LibraryPanel, and ArchiveReader identity/state across five cycles', async () => {
    const api = makeApi()
    let readerState
    let readerMounts = 0
    let readerUnmounts = 0
    const ArchiveReader = loadArchiveReaderSfc({
      useArchiveReader: () => {
        readerMounts += 1
        readerState = useArchiveReader({ api, autoInitialize: false, saveDelay: 1 })
        primeReader(readerState, chapterEightyOne, { version: '9223372036854775807' })
        Vue.onUnmounted(() => { readerUnmounts += 1 })
        return readerState
      },
      utf8ByteLength
    })
    const LibraryPanel = loadLibraryPanelSfc(ArchiveReader)
    const mode = Vue.ref('portrait-command')
    const counters = { hallLoads: 0 }
    const JuyiHall = loadActualHallForIntegration(createHallIntegrationMocks({ mode, LibraryPanel, counters }), 'archive-actual-juyi-hall')
    const wrapper = mount(JuyiHall, { attachTo: document.body, global: { stubs: { 'var-icon': true } } })
    try {
      await settle()
      await wrapper.find('[data-portrait-action="library"]').trigger('click')
      await settle()
      const floating = wrapper.find('.floating-panel').element
      const library = wrapper.findComponent(LibraryPanel)
      const reader = wrapper.findComponent(ArchiveReader)
      const switchEditorTarget = reader.vm.__switchEditorTargetForTest || reader.vm.$?.exposed?.__switchEditorTargetForTest
      expect(switchEditorTarget).to.be.a('function')
      switchEditorTarget({ noteId: 'note-o04', version: '7' }, '五轮旋转仍须保留的批注')
      await Vue.nextTick()
      const location = readerState.currentLocation.value
      const progress = readerState.progress.value
      const loadCount = api.calls.length
      for (let cycle = 0; cycle < 5; cycle += 1) {
        mode.value = 'landscape-map'; await Vue.nextTick()
        mode.value = 'portrait-command'; await Vue.nextTick()
        expect(wrapper.find('.floating-panel').element).to.equal(floating)
        expect(wrapper.findComponent(LibraryPanel).vm).to.equal(library.vm)
        expect(wrapper.findComponent(ArchiveReader).vm).to.equal(reader.vm)
        expect(readerState.currentLocation.value).to.equal(location)
        expect(readerState.progress.value).to.equal(progress)
        expect(wrapper.find('textarea').element.value).to.equal('五轮旋转仍须保留的批注')
        expect(api.calls).to.have.length(loadCount)
        expect(readerMounts).to.equal(1)
        expect(readerUnmounts).to.equal(0)
      }
    } finally {
      wrapper.unmount()
    }
    expect(readerUnmounts).to.equal(1)
  })

})
