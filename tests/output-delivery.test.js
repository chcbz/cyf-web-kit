import { expect } from 'chai'
import { afterEach, before } from 'mocha'
import { readFileSync } from 'fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'
import { useHttp } from '../src/composables/useHttp.js'
import {
  normalizeOutputError,
  outputPageMatchesSource,
  parseOutputResourceQuery,
  outputSource,
  outputVersionPageMatches,
  useOutputs
} from '../src/composables/useOutputs.js'
import { contentDispositionFilename, safeOutputFilename } from '../src/utils/outputDownload.js'
import { stopIdentityBoundWork } from '../src/utils/identityLifecycle.js'

const wrappers = new Set()
const originalFetch = globalThis.fetch
const originalImage = globalThis.Image
const originalCreateObjectURL = globalThis.URL.createObjectURL
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const flush = async (passes = 5) => {
  for (let index = 0; index < passes; index += 1) {
    await Promise.resolve()
    await nextTick()
  }
}
const page = (source, items, nextCursor = null, snapshotAt = '100') => ({
  data: { data: { items: items.map(item => ({ source, state: 'AVAILABLE', canDownload: true, previewKind: 'NONE', publicationKind: source.type === 'TASK' ? 'OWNER_SHARE' : 'CONVERSATION_OUTPUT', createdAt: '1', ...item })), nextCursor, snapshotAt } }
})
const item = (overrides = {}) => ({
  source: { type: 'CONVERSATION', id: 'conversation-a' },
  outputId: 'report',
  version: '2',
  title: '执行报告',
  name: 'report.md',
  mime: 'text/markdown',
  size: '2048',
  createdAt: '1',
  state: 'AVAILABLE',
  publicationKind: 'CONVERSATION_OUTPUT',
  previewKind: 'NONE',
  canDownload: true,
  ...overrides
})

const vueImportToVar = (_line, names) => {
  const bindings = names.split(',').map(part => {
    const [name, alias] = part.trim().split(/\s+as\s+/)
    return alias ? `${name}: ${alias}` : name
  }).join(', ')
  return `var { ${bindings} } = Vue`
}
const compileSfc = (relativePath, replacements = []) => {
  const filename = new URL(relativePath, import.meta.url).pathname
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  let body = compileScript(descriptor, { id: relativePath.replace(/\W/g, '-'), inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
  for (const [pattern, replacement] of replacements) body = body.replace(pattern, replacement)
  body = body.replace('export default', 'return')
  return new Function('Vue', ...replacements.map((_, index) => `dependency${index}`), body)(Vue, ...replacements.map(entry => entry[2]))
}
const loadOutputComponents = () => {
  const OutputCard = compileSfc('../src/components/outputs/OutputCard.vue')
  const OutputPreview = compileSfc('../src/components/outputs/OutputPreview.vue')
  const OutputList = compileSfc('../src/components/outputs/OutputList.vue', [
    [/^import\s+OutputCard.*$/gm, 'var OutputCard = dependency0', OutputCard],
    [/^import\s+OutputPreview.*$/gm, 'var OutputPreview = dependency1', OutputPreview]
  ])
  return { OutputCard, OutputPreview, OutputList }
}
const mountOutputs = (source, options) => {
  let outputs
  const Harness = defineComponent({
    setup () {
      outputs = useOutputs(source, options)
      return () => h('div')
    }
  })
  const wrapper = mount(Harness)
  wrappers.add(wrapper)
  return { outputs, wrapper }
}
const findButton = (wrapper, text) => wrapper.findAll('button').find(button => button.text().includes(text))

class FakeTimer {
  constructor () {
    this.tasks = []
    this.nextId = 0
  }

  setTimeout = (callback, delay) => {
    const task = { id: ++this.nextId, callback, delay }
    this.tasks.push(task)
    return task.id
  }

  clearTimeout = id => {
    this.tasks = this.tasks.filter(task => task.id !== id)
  }

  async runNext () {
    const task = this.tasks.shift()
    task?.callback()
    await flush()
    return task
  }
}

class VisibilityDocument {
  hidden = false
  listeners = new Set()

  addEventListener = (_type, listener) => this.listeners.add(listener)
  removeEventListener = (_type, listener) => this.listeners.delete(listener)
  dispatch = () => [...this.listeners].forEach(listener => listener())
}

before(() => {
  for (const key of ['SVGElement', 'Element', 'Node']) {
    if (!globalThis[key]) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] })
  }
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.clear()
  globalThis.fetch = originalFetch
  globalThis.Image = originalImage
  globalThis.URL.createObjectURL = originalCreateObjectURL
  globalThis.URL.revokeObjectURL = originalRevokeObjectURL
  document.body.innerHTML = ''
  window.history.replaceState({}, '', '/')
})

describe('OD05 shared output retrieval', () => {
  it('keeps binary download responses out of the JSON parser and retains declared errors', async () => {
    globalThis.fetch = async url => {
      if (String(url).includes('download')) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/octet-stream' } })
      }
      return new Response(JSON.stringify({ code: 'OUTPUT_BUSY', message: '稍后重试', retryable: false, requestId: 'request-1' }), { status: 503 })
    }
    const binary = await useHttp().get('/outputs/example/download', undefined, { needAuth: false, responseType: 'blob' })
    expect([...new Uint8Array(await binary.data.arrayBuffer())]).to.deep.equal([1, 2, 3])
    let failure
    try { await useHttp().get('/outputs/example', undefined, { needAuth: false }) } catch (error) { failure = error }
    expect(failure).to.include({ status: 503, code: 'OUTPUT_BUSY', retryable: false, requestId: 'request-1' })
    expect(normalizeOutputError(failure).retryable).to.equal(false)
  })

  it('uses exact source literals and strict version page matching', async () => {
    const id = ref('9007199254740993')
    const source = outputSource('CONVERSATION', () => id.value)
    expect(source.value).to.deep.equal({ type: 'CONVERSATION', id: '9007199254740993' })
    id.value = ''
    await nextTick()
    expect(source.value).to.equal(null)
    expect(outputSource('CONVERSATION', () => Number('9007199254740993')).value).to.equal(null)

    const current = { type: 'CONVERSATION', id: '9007199254740993' }
    const valid = { items: [{ outputId: 'a', version: '1', source: current }] }
    expect(outputPageMatchesSource(valid, current)).to.equal(true)
    expect(outputVersionPageMatches(valid, current, 'a')).to.equal(true)
    expect(outputVersionPageMatches(valid, current, 'b')).to.equal(false)
    expect(outputPageMatchesSource({ items: [{ ...valid.items[0], source: { type: 'CHAT', id: current.id } }] }, current)).to.equal(false)
  })

  it('mounts the real list with nested refs and exposes readable R1 controls', async () => {
    const { OutputList } = loadOutputComponents()
    const outputs = {
      source: ref({ type: 'TASK', id: 'task-1' }),
      lifecycleKey: ref(0),
      items: ref([item({ source: { type: 'TASK', id: 'task-1' }, publicationKind: 'OWNER_SHARE', size: '2048' })]),
      nextCursor: ref('next'),
      loading: ref(false),
      error: ref(null),
      versions: ref([]),
      versionTarget: ref(null),
      versionNextCursor: ref(null),
      versionsLoading: ref(false),
      versionsError: ref(null),
      refresh: () => {},
      loadMore: () => {},
      loadVersions: () => {},
      clearVersions: () => {},
      detail: () => {},
      downloadBlob: () => {},
      download: () => {},
      resourceRoute: () => 'https://example.test/'
    }
    const wrapper = mount(OutputList, { props: { outputs } })
    wrappers.add(wrapper)
    expect(wrapper.text()).to.include('执行报告')
    expect(wrapper.text()).to.include('已分享，未正式验收')
    expect(wrapper.text()).to.include('2.0 KiB')
    expect(wrapper.text()).to.include('可下载')
    expect(findButton(wrapper, '加载更多')).to.exist
    expect(wrapper.findAll('button').map(button => button.text())).not.to.include.members(['验收', '接受', '驳回'])
  })

  it('clears and aborts stale list, detail, and preview state across source and identity changes', async () => {
    const source = ref({ type: 'CONVERSATION', id: 'conversation-a' })
    const firstList = deferred()
    const detailRequest = deferred()
    const signals = []
    const http = {
      get: (url, _params, config = {}) => {
        signals.push({ url, signal: config.signal })
        if (url.endsWith('/versions/2')) return detailRequest.promise
        if (url.includes('conversation-a')) return firstList.promise
        return Promise.resolve(page({ type: 'CONVERSATION', id: 'conversation-b' }, [{ outputId: 'b', version: '1' }]))
      }
    }
    const { outputs } = mountOutputs(source, { http })
    await flush()
    source.value = { type: 'CONVERSATION', id: 'conversation-b' }
    await flush()
    firstList.resolve(page({ type: 'CONVERSATION', id: 'conversation-a' }, [{ outputId: 'stale', version: '1' }]))
    await flush()
    expect(outputs.items.value.map(value => value.outputId)).to.deep.equal(['b'])
    expect(signals[0].signal.aborted).to.equal(true)

    const detailItem = item({ source: { type: 'CONVERSATION', id: 'conversation-b' } })
    const pendingDetail = outputs.detail(detailItem).catch(error => error)
    await flush()
    const beforeCleanup = outputs.lifecycleKey.value
    stopIdentityBoundWork()
    expect(signals.at(-1).signal.aborted).to.equal(true)
    expect(outputs.items.value).to.deep.equal([])
    expect(outputs.lifecycleKey.value).to.equal(beforeCleanup + 1)
    detailRequest.resolve({ data: { data: { item: detailItem, content: 'stale' } } })
    expect((await pendingDetail).name).to.equal('AbortError')
  })

  it('rejects detail payloads with any mismatched source, output ID, or version', async () => {
    const source = ref({ type: 'CONVERSATION', id: 'conversation-a' })
    const responses = [
      item({ source: { type: 'TASK', id: 'conversation-a' } }),
      item({ outputId: 'other' }),
      item({ version: '3' })
    ]
    const http = {
      get: url => url.endsWith('/outputs')
        ? Promise.resolve(page(source.value, []))
        : Promise.resolve({ data: { data: { item: responses.shift(), content: 'x' } } })
    }
    const { outputs } = mountOutputs(source, { http })
    await flush()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let failure
      try { await outputs.detail(item()) } catch (error) { failure = error }
      expect(failure.message).to.equal('成果详情来源或版本不匹配')
    }
  })

  it('preserves loaded history on refresh and does not cancel a long download', async () => {
    const source = ref({ type: 'CONVERSATION', id: 'conversation-a' })
    const listResponses = [
      page(source.value, [{ outputId: 'newer', version: '2' }], 'cursor-1', '100'),
      page(source.value, [{ outputId: 'older', version: '1' }], null, '100'),
      page(source.value, [{ outputId: 'latest', version: '3' }, { outputId: 'newer', version: '2' }], 'cursor-2', '200'),
      page(source.value, [{ outputId: 'older', version: '1' }], null, '200')
    ]
    const http = { get: () => Promise.resolve(listResponses.shift()) }
    const longDownload = deferred()
    let downloadSignal
    const { outputs } = mountOutputs(source, {
      http,
      download: ({ signal }) => {
        downloadSignal = signal
        return longDownload.promise
      }
    })
    await flush()
    await outputs.loadMore()
    expect(outputs.items.value.map(value => value.outputId)).to.deep.equal(['newer', 'older'])
    const downloading = outputs.download(item()).catch(error => error)
    await flush()
    await outputs.refresh()
    expect(downloadSignal.aborted).to.equal(false)
    expect(outputs.items.value.map(value => value.outputId)).to.deep.equal(['latest', 'newer', 'older'])
    longDownload.resolve()
    expect(await downloading).to.equal(undefined)
  })

  it('does not create a Blob URL or save after identity cleanup wins the response race', async () => {
    const source = ref({ type: 'CONVERSATION', id: 'conversation-a' })
    const events = []
    globalThis.URL.createObjectURL = () => {
      events.push('create-old-blob-url')
      return 'blob:old-identity'
    }
    globalThis.URL.revokeObjectURL = () => {}
    const onClick = event => {
      if (event.target.tagName === 'A') {
        events.push('save-old-identity-file')
        event.preventDefault()
      }
    }
    document.addEventListener('click', onClick, true)
    globalThis.fetch = async url => {
      if (!String(url).endsWith('/download')) return new Response(JSON.stringify(page(source.value, []).data), { status: 200 })
      const response = new Response('old-identity-secret', { status: 200 })
      response.blob = async () => {
        queueMicrotask(() => queueMicrotask(() => {
          events.push('identity-cleared')
          stopIdentityBoundWork()
        }))
        return new Blob(['old-identity-secret'])
      }
      return response
    }
    const authStore = { token: async () => 'test-token', authorizationGeneration: 1 }
    const http = { get: (url, params, config) => useHttp().get(url, params, { ...config, authStore }) }
    const { outputs } = mountOutputs(source, { http })
    await flush()
    let failure
    try {
      failure = await outputs.download(item()).catch(error => error)
    } finally {
      document.removeEventListener('click', onClick, true)
    }
    expect(failure.name).to.equal('AbortError')
    expect(events).to.deep.equal(['identity-cleared'])
  })

  it('removes revoked rows when an authoritative refresh is empty', async () => {
    const source = ref({ type: 'CONVERSATION', id: 'conversation-a' })
    const responses = [
      page(source.value, [{ outputId: 'revoked-secret', version: '1' }]),
      page(source.value, [])
    ]
    const { outputs } = mountOutputs(source, { http: { get: () => Promise.resolve(responses.shift()) } })
    await flush()
    expect(outputs.items.value).to.have.length(1)
    await outputs.refresh()
    expect(outputs.items.value).to.deep.equal([])
    expect(outputs.nextCursor.value).to.equal(null)
  })

  it('paginates historical versions for one exact output ID', async () => {
    const source = ref({ type: 'CONVERSATION', id: 'conversation-a' })
    const responses = [
      page(source.value, [item()], null),
      page(source.value, [{ outputId: 'report', version: '2' }], 'versions-2'),
      page(source.value, [{ outputId: 'report', version: '1' }], null)
    ]
    const http = { get: () => Promise.resolve(responses.shift()) }
    const { outputs } = mountOutputs(source, { http })
    await flush()
    await outputs.loadVersions(item())
    await outputs.loadVersions(item(), { more: true })
    expect(outputs.versions.value.map(value => value.version)).to.deep.equal(['2', '1'])
    expect(outputs.versionNextCursor.value).to.equal(null)
  })

  it('ignores a cancelled historical-version response after another output is opened', async () => {
    const source = ref({ type: 'CONVERSATION', id: 'conversation-a' })
    const requestA = deferred()
    const requestB = deferred()
    const http = {
      get: url => {
        if (url.endsWith('/outputs')) return Promise.resolve(page(source.value, []))
        return url.includes('/a/versions') ? requestA.promise : requestB.promise
      }
    }
    const { outputs } = mountOutputs(source, { http })
    await flush()
    const itemA = item({ outputId: 'a' })
    const itemB = item({ outputId: 'b' })
    const pendingA = outputs.loadVersions(itemA)
    await flush()
    outputs.clearVersions()
    const pendingB = outputs.loadVersions(itemB)
    await flush()
    requestA.resolve(page(source.value, [itemA]))
    await pendingA
    expect(outputs.versionTarget.value.outputId).to.equal('b')
    expect(outputs.versions.value).to.deep.equal([])
    expect(outputs.versionsLoading.value).to.equal(true)
    requestB.resolve(page(source.value, [itemB]))
    await pendingB
    expect(outputs.versions.value.map(value => value.outputId)).to.deep.equal(['b'])
  })

  it('does not poll an explicitly non-retryable error while a source is syncing', async () => {
    const source = ref({ type: 'CONVERSATION', id: 'conversation-a' })
    const syncing = ref(true)
    const timer = new FakeTimer()
    const failure = Object.assign(new Error('无权读取成果'), { status: 403, retryable: false })
    const { outputs } = mountOutputs(source, { syncing, timer, document: new VisibilityDocument(), http: { get: () => Promise.reject(failure) } })
    await flush()
    expect(outputs.error.value).to.include({ status: 403, retryable: false })
    expect(timer.tasks).to.deep.equal([])
  })

  it('polls only while syncing or retryable, backs off, pauses hidden, and refreshes once on completion', async () => {
    const source = ref({ type: 'CONVERSATION', id: 'conversation-a' })
    const syncing = ref(false)
    const timer = new FakeTimer()
    const visibility = new VisibilityDocument()
    let requests = 0
    let fail = true
    const http = {
      get: () => {
        requests += 1
        if (fail) {
          const error = new Error('存储繁忙')
          error.status = 503
          error.retryable = true
          return Promise.reject(error)
        }
        return Promise.resolve(page(source.value, [{ outputId: 'ready', version: '1' }]))
      }
    }
    mountOutputs(source, { http, syncing, timer, document: visibility })
    await flush()
    expect(timer.tasks.map(task => task.delay)).to.deep.equal([5_000])
    await timer.runNext()
    expect(timer.tasks.map(task => task.delay)).to.deep.equal([10_000])
    await timer.runNext()
    expect(timer.tasks.map(task => task.delay)).to.deep.equal([20_000])
    await timer.runNext()
    expect(timer.tasks.map(task => task.delay)).to.deep.equal([30_000])

    visibility.hidden = true
    visibility.dispatch()
    expect(timer.tasks).to.have.length(0)
    fail = false
    visibility.hidden = false
    visibility.dispatch()
    await flush()
    expect(requests).to.equal(5)
    expect(timer.tasks).to.have.length(0)

    syncing.value = true
    await flush()
    expect(timer.tasks.map(task => task.delay)).to.deep.equal([5_000])
    syncing.value = false
    await flush()
    expect(requests).to.equal(6)
    expect(timer.tasks).to.have.length(0)
  })

  it('previews an octet-stream image using trusted item MIME and rejects decoded bounds', async () => {
    const { OutputPreview } = loadOutputComponents()
    const created = []
    const revoked = []
    globalThis.URL.createObjectURL = blob => {
      created.push(blob)
      return `blob:test-${created.length}`
    }
    globalThis.URL.revokeObjectURL = value => revoked.push(value)
    let width = 640
    let height = 480
    globalThis.Image = class {
      set src (_value) {
        this.naturalWidth = width
        this.naturalHeight = height
        queueMicrotask(() => this.onload?.())
      }
    }
    const previewItem = item({ previewKind: 'IMAGE', mime: 'image/png' })
    const detail = value => Promise.resolve({ item: value })
    const loadBlob = () => Promise.resolve({ data: new Blob([new Uint8Array([1, 2])], { type: 'application/octet-stream' }) })
    const wrapper = mount(OutputPreview, { props: { item: previewItem, detail, loadBlob, sourceKey: 'a' } })
    wrappers.add(wrapper)
    await flush(8)
    expect(wrapper.find('img').exists()).to.equal(true)
    expect(created[0].type).to.equal('image/png')

    width = 9000
    height = 10
    await wrapper.setProps({ sourceKey: 'b' })
    await flush(8)
    expect(wrapper.text()).to.include('图片尺寸过大')
    expect(wrapper.find('img').exists()).to.equal(false)
    expect(revoked).to.include('blob:test-1')
  })

  it('aborts an in-flight preview on unmount and ignores its late blob', async () => {
    const { OutputPreview } = loadOutputComponents()
    const blobRequest = deferred()
    let previewSignal
    let created = 0
    globalThis.URL.createObjectURL = () => {
      created += 1
      return 'blob:late'
    }
    globalThis.URL.revokeObjectURL = () => {}
    const previewItem = item({ previewKind: 'IMAGE', mime: 'image/png' })
    const wrapper = mount(OutputPreview, {
      props: {
        item: previewItem,
        sourceKey: 'a',
        detail: value => Promise.resolve({ item: value }),
        loadBlob: (_value, { signal }) => {
          previewSignal = signal
          return blobRequest.promise
        }
      }
    })
    wrappers.add(wrapper)
    await flush()
    wrapper.unmount()
    wrappers.delete(wrapper)
    expect(previewSignal.aborted).to.equal(true)
    blobRequest.resolve({ data: new Blob([new Uint8Array([1])], { type: 'application/octet-stream' }) })
    await flush()
    expect(created).to.equal(0)
  })

  it('shows actionable download errors and paged versions in the real list', async () => {
    const { OutputList } = loadOutputComponents()
    const outputItem = item()
    const outputs = {
      source: ref(outputItem.source),
      lifecycleKey: ref(0),
      items: ref([outputItem]),
      nextCursor: ref(null),
      loading: ref(false),
      error: ref(null),
      versions: ref([]),
      versionTarget: ref(null),
      versionNextCursor: ref(null),
      versionsLoading: ref(false),
      versionsError: ref(null),
      refresh: () => {},
      loadMore: () => {},
      loadVersions: target => {
        outputs.versionTarget.value = target
        outputs.versions.value = [item({ version: '1' })]
        outputs.versionNextCursor.value = 'next-versions'
      },
      clearVersions: () => { outputs.versionTarget.value = null },
      detail: () => {},
      downloadBlob: () => {},
      download: async () => {
        const error = new Error('文件暂不可取')
        error.retryable = true
        error.requestId = 'download-request'
        throw error
      },
      resourceRoute: () => 'https://example.test/'
    }
    const wrapper = mount(OutputList, { props: { outputs } })
    wrappers.add(wrapper)
    await findButton(wrapper, '下载').trigger('click')
    await flush()
    expect(wrapper.text()).to.include('文件暂不可取')
    expect(wrapper.text()).to.include('download-request')
    expect(findButton(wrapper, '重试下载')).to.exist
    await findButton(wrapper, '历史版本').trigger('click')
    await flush()
    expect(wrapper.text()).to.include('执行报告的历史版本')
    expect(wrapper.text()).to.include('更多历史版本')
  })

  it('builds token-free exact browser routes and parses safe attachment filenames', async () => {
    const source = ref({ type: 'CONVERSATION', id: 'conversation-a' })
    const http = { get: () => Promise.resolve(page(source.value, [])) }
    const { outputs } = mountOutputs(source, {
      http,
      location: {
        href: 'https://cyf.example/chat?conversationType=juyiting&access_token=secret&jwt=secret2#token=secret3',
        origin: 'https://cyf.example'
      }
    })
    await flush()
    const route = outputs.resourceRoute(item())
    expect(route.startsWith('https://cyf.example/chat?')).to.equal(true)
    expect(route).not.to.include('conversationType=juyiting')
    expect(route).to.include('outputSourceType=CONVERSATION')
    expect(route).to.include('outputSourceId=conversation-a')
    expect(route).to.include('outputId=report')
    expect(route).to.include('outputVersion=2')
    expect(route).not.to.match(/secret|token=|jwt=/i)
    expect(contentDispositionFilename("attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf")).to.equal('报告.pdf')
    expect(safeOutputFilename({ name: '../报告?.pdf' })).to.equal('_报告_.pdf')
  })

  it('reacts to copied-route version changes and requests the exact version without an Agent', async () => {
    window.history.replaceState({}, '', '/chat?outputSourceType=TASK&outputSourceId=task-9&outputId=deliverable&outputVersion=7')
    const { OutputList } = loadOutputComponents()
    const resourceRequest = ref(parseOutputResourceQuery(new URLSearchParams(window.location.search)))
    const source = computed(() => resourceRequest.value.source)
    const calls = []
    const http = {
      get: url => {
        calls.push(url)
        if (!url.endsWith('/artifacts')) {
          const version = url.split('/').at(-1)
          const exact = item({
            source: source.value,
            outputId: 'deliverable',
            version,
            title: `第${version}版交付件`,
            previewKind: 'TEXT',
            publicationKind: 'OWNER_SHARE'
          })
          return Promise.resolve({ data: { data: { item: exact, content: `精确历史正文-${version}` } } })
        }
        return Promise.resolve(page(source.value, []))
      }
    }
    let outputs
    const Harness = defineComponent({
      setup () {
        outputs = useOutputs(source, { http, requestedResource: resourceRequest })
        return () => h(OutputList, { outputs })
      }
    })
    const wrapper = mount(Harness)
    wrappers.add(wrapper)
    await flush(12)
    expect(calls.filter(url => url.endsWith('/deliverable/versions/7')).length).to.be.at.least(1)
    expect(wrapper.text()).to.include('第7版交付件')
    expect(wrapper.text()).to.include('精确历史正文')
    expect(wrapper.find('.is-targeted').exists()).to.equal(true)

    window.history.replaceState({}, '', '/chat?outputSourceType=TASK&outputSourceId=task-9&outputId=deliverable&outputVersion=8')
    resourceRequest.value = parseOutputResourceQuery(new URLSearchParams(window.location.search))
    await flush(12)
    expect(calls.some(url => url.endsWith('/deliverable/versions/8'))).to.equal(true)
    expect(wrapper.text()).to.include('第8版交付件')
    expect(wrapper.text()).to.include('精确历史正文-8')
    expect(wrapper.text()).not.to.include('第7版交付件')
  })

  it('keeps all three product entrypoints on the shared list with explicit syncing signals', () => {
    const panel = readFileSync(new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url), 'utf8')
    const bounty = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
    const chat = readFileSync(new URL('../src/components/chat/Chat.vue', import.meta.url), 'utf8')
    expect(panel).to.include('<OutputList v-if="conversationId" :outputs="outputs" />')
    expect(panel).to.include("outputSource('CONVERSATION', () => props.conversationId), { syncing: outputSyncing }")
    expect(bounty).to.include('<OutputList :outputs="outputs" />')
    expect(bounty).to.include("outputSource('TASK', () => detailTask.value?.id), { syncing: outputSyncing }")
    expect(chat).to.include('<OutputList v-if="resourceOutputRequest || (isJuyiting && conversationId)" :outputs="outputs" />')
    expect(chat).to.include('const resourceOutputRequest = computed(() => parseOutputResourceQuery(route.query))')
    expect(chat).to.include('const outputs = useOutputs(activeOutputSource, { syncing: outputSyncing, requestedResource: resourceOutputRequest })')
    expect([panel, bounty, chat].join('\n')).not.to.match(/accept|request_changes|验收通过/)
  })
})
