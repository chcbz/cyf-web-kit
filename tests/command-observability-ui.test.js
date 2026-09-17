import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import * as policy from '../src/utils/commandObservabilityPolicy.js'
import * as navigation from '../src/utils/profileNavigation.js'
import { useCommandObservability } from '../src/composables/useCommandObservability.js'

const Vue = await import('vue')
const { mount, flushPromises } = await import('@vue/test-utils')
const { compileScript, parse } = await import('@vue/compiler-sfc')
for (const key of ['Element', 'SVGElement', 'Node']) global[key] = global.window[key]
const wrappers = []
const cap = (available = true, reason = null) => ({ contractVersion: 'command-observability-v1', available, readOnly: true, reason })
const metric = value => ({ outboxBacklog: value, ackLatencySeconds: 0.125, capturedAt: 1000, deliveryByStatus: { SENT: 1 } })
const row = (id = '9007199254740993') => ({ deliveryId: id, taskId: 'task-378', targetAgentId: 'agent-exact', messageId: 'message-1', commandId: 'command-1', eventId: 'event-1', activeAttempt: 1, publishAttemptCount: 2, updatedAt: 1000, wireSha256: 'PRIVATE-WIRE', reason: 'PRIVATE-REASON' })
const client = () => ({ capabilities: async () => cap(), metrics: async () => metric(2), dlq: async () => ({ items: [row()], nextAfterDeliveryId: null, hasMore: false }), audit: async () => ({ items: [{ id: '9007199254740995', taskId: 'task-378', requesterId: 'PRIVATE-REQUESTER', reason: 'PRIVATE-AUDIT' }], nextAfterId: null, hasMore: false }) })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function component ({ api, apiStore, globalStore, router }) {
  const filename = new URL('../src/components/CommandObservability.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const compiled = compileScript(descriptor, { id: 'command-board-mounted', inlineTemplate: true }).content
  const executable = compiled.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_all, names, path) =>
    `const { ${names.split(',').map(n => n.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`).replace('export default', 'return')
  return new Function('imports', executable)({
    vue: Vue,
    'vue-router': { useRouter: () => router },
    '@/stores/api': { useApiStore: () => apiStore },
    '@/stores/global': { useGlobalStore: () => globalStore },
    '@/composables/useCommandObservability': { useCommandObservability: options => useCommandObservability({ ...options, client: api }) },
    '@/utils/commandObservabilityPolicy': policy,
    '@/utils/profileNavigation': navigation
  })
}
async function setup (api = client()) {
  const apiStore = Vue.reactive({ authorizationGeneration: 0 })
  const globalStore = Vue.reactive({ user: { id: 'user-a', username: 'a' }, setTitle: () => {}, setShowBack: () => {}, setShowMore: () => {} })
  const paths = []; const router = { replace: async path => { paths.push(path) } }
  const wrapper = mount(component({ api, apiStore, globalStore, router }))
  wrappers.push(wrapper); await flushPromises()
  return { wrapper, apiStore, globalStore, paths }
}

describe('command observability actual mounted interactions', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => { for (const w of wrappers.splice(0)) w.unmount() })

  it('refreshes metrics by actual click and recovers a failed request without retaining the event as lifecycle', async () => {
    const api = client(); let reads = 0; let fail = false
    api.metrics = async () => { reads++; if (fail) throw new TypeError('network'); return metric(reads) }
    const { wrapper } = await setup(api)
    expect(reads).to.equal(1)
    expect(wrapper.get('.metrics-card').text()).to.include('0.125')
    fail = true
    await wrapper.get('.metrics-card .card-heading button').trigger('click'); await flushPromises()
    expect(reads).to.equal(2)
    expect(wrapper.get('.metrics-card .stale').text()).to.include('可能已过期')
    expect(wrapper.get('.metrics-card .card-heading button').attributes('disabled')).to.equal(undefined)
    fail = false
    await wrapper.get('.metrics-card .block-error button').trigger('click'); await flushPromises()
    expect(reads).to.equal(3)
    expect(wrapper.find('.metrics-card .block-error').exists()).to.equal(false)
  })

  it('aligns nonempty DLQ cells with headings, preserves large IDs and does not render hidden payload fields', async () => {
    const { wrapper, paths } = await setup()
    const table = wrapper.findAll('table')[0]
    const headers = table.findAll('thead th').map(x => x.text())
    const cells = table.findAll('tbody tr')[0].findAll('td').map(x => x.text())
    expect(headers.length).to.equal(cells.length)
    expect(headers.length).to.equal(16)
    expect(cells[headers.indexOf('任务 ID')]).to.equal('task-378')
    expect(cells[headers.indexOf('消息 ID')]).to.equal('message-1')
    expect(cells[0]).to.equal('9007199254740993')
    expect(wrapper.text()).not.to.include('PRIVATE-')
    await wrapper.get('.page-header .page-actions button:last-child').trigger('click')
    expect(paths).to.deep.equal([{ name: 'UserProfile' }])
  })

  it('renders disabled and forbidden states without requesting metrics or records', async () => {
    for (const reason of ['DISABLED', 'FORBIDDEN']) {
      const api = client(); let reads = 0
      api.capabilities = async () => cap(false, reason)
      api.metrics = api.dlq = api.audit = async () => { reads++; throw new Error('must not read') }
      const { wrapper } = await setup(api)
      expect(wrapper.text()).to.include(reason === 'DISABLED' ? '当前未启用' : '没有查看')
      expect(reads).to.equal(0)
      expect(wrapper.find('table').exists()).to.equal(false)
    }
  })

  it('clears rows immediately on same-mounted identity switch and prevents late old metrics from resurfacing', async () => {
    const api = client(); const late = deferred(); let reads = 0
    api.metrics = async () => ++reads === 1 ? metric(111) : late.promise
    const { wrapper, apiStore, globalStore } = await setup(api)
    expect(wrapper.text()).to.include('task-378')
    await wrapper.get('.metrics-card .card-heading button').trigger('click')
    api.capabilities = async () => cap(false, 'FORBIDDEN')
    globalStore.user = { id: 'user-b', username: 'b' }; apiStore.authorizationGeneration++
    await flushPromises()
    expect(wrapper.text()).not.to.include('task-378')
    late.resolve(metric(999)); await flushPromises()
    expect(wrapper.text()).not.to.include('999')
    expect(wrapper.text()).to.include('没有查看')
  })

  it('revokes all sections when one previously-authorized metrics refresh returns403', async () => {
    const api = client(); const { wrapper } = await setup(api)
    api.metrics = async () => { throw Object.assign(new Error('denied'), { status: 403 }) }
    await wrapper.get('.metrics-card .card-heading button').trigger('click'); await flushPromises()
    expect(wrapper.text()).to.include('没有查看')
    expect(wrapper.find('table').exists()).to.equal(false)
    expect(wrapper.text()).not.to.include('task-378')
  })
})
