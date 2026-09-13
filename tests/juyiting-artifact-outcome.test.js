import { expect } from 'chai'
import { ref } from 'vue'
import { useHallArtifactOutcomes } from '../src/composables/juyiting/useHallArtifactOutcomes.js'

const subject = ref({ taskId: 'task-1', actorAgentId: 'agent-1' })
const workspace = ref({ recentArtifacts: [{ artifactId: 'draft-1', artifactVersion: '3', title: '当前成果', artifactType: 'analysis' }] })
const identity = ref(1)
const row = (overrides = {}) => ({ artifactId: 'accepted-1', taskId: 'task-1', workItemId: null, producerAgentId: 'agent-2', artifactType: 'analysis', title: '已接受成果', contentHash: 'a'.repeat(64), artifactVersion: 2, visibility: 'task_members', createdAt: 1, outcomeState: 'accepted', outcomeVersion: 4, decisionId: 'decision-existing', decidedByAgentId: 'agent-2', decidedAt: 2, ...overrides })
const outcome = options => useHallArtifactOutcomes({ subject, workspace, identityEpoch: identity, idempotencyKeyFactory: () => 'f06-test-idempotency-key', ...options })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('F06 Juyi Hall artifact outcome interaction', () => {
  it('uses JWT-only HTTP calls, renders accepted-only rows, and sends the exact closed accept contract', async () => {
    subject.value = { taskId: 'task-1', actorAgentId: 'agent-1' }; identity.value = 1
    const calls = []
    const api = { execute: async options => {
      calls.push(options)
      if (options.method === 'GET') return { data: [row()] }
      return { data: row({ artifactId: 'draft-1', artifactVersion: 3, title: '当前成果', outcomeVersion: 1, decisionId: 'f06-test-idempotency-key', decidedByAgentId: 'agent-1' }) }
    } }
    const t = outcome({ api })
    await tick()
    expect(calls[0]).to.include({ method: 'GET', url: '/tasks/task-1/artifact-outcomes/accepted' })
    expect(calls[0].params).to.deep.equal({ limit: 100 })
    expect(calls[0].params).not.to.have.property('actorAgentId')
    expect(t.accepted.value).to.deep.equal([row()])
    expect(t.acceptedState.value).to.equal('ready')
    expect(t.selectArtifact(t.workspaceArtifacts.value[0])).to.equal(true)
    expect(t.toggleSuperseded(t.accepted.value[0])).to.equal(true)
    t.confirmed.value = true
    const receipt = await t.accept()
    expect(receipt).to.include({ artifactId: 'draft-1', artifactVersion: 3, outcomeVersion: 1, decisionId: 'f06-test-idempotency-key' })
    expect(calls[1]).to.include({ method: 'POST', url: '/tasks/task-1/artifact-outcomes/accept' })
    expect(calls[1].headers).to.deep.equal({ 'Idempotency-Key': 'f06-test-idempotency-key' })
    expect(calls[1]).not.to.have.property('params')
    expect(calls[1].data).to.deep.equal({ acceptedArtifact: { artifactId: 'draft-1', artifactVersion: 3, expectedOutcomeVersion: 0 }, supersededArtifacts: [{ artifactId: 'accepted-1', artifactVersion: 2, expectedOutcomeVersion: 4 }] })
    expect(t.accepted.value[0].outcomeState).to.equal('accepted')
    t.dispose()
  })

  it('does not infer outcome state from workspace rows and distinguishes empty, unavailable, inaccessible, and conflict', async () => {
    subject.value = { taskId: 'task-1', actorAgentId: 'agent-1' }; identity.value = 1
    const empty = outcome({ api: { execute: async () => ({ data: [] }) } })
    await tick()
    expect(empty.acceptedState.value).to.equal('empty')
    expect(empty.workspaceArtifacts.value).to.have.length(1)
    expect(empty.accepted.value).to.deep.equal([])
    empty.dispose()
    const unavailable = outcome({ api: { execute: async () => { throw Object.assign(new Error('off'), { status: 503 }) } } })
    await tick(); expect(unavailable.acceptedState.value).to.equal('unavailable'); expect(unavailable.accepted.value).to.deep.equal([]); unavailable.dispose()
    const inaccessible = outcome({ api: { execute: async () => { throw Object.assign(new Error('denied'), { status: 403 }) } } })
    await tick(); expect(inaccessible.acceptedState.value).to.equal('inaccessible'); expect(inaccessible.accepted.value).to.deep.equal([]); inaccessible.dispose()
    const conflict = outcome({ api: { execute: async () => { throw Object.assign(new Error('changed'), { status: 409 }) } } })
    await tick(); expect(conflict.acceptedState.value).to.equal('conflict'); expect(conflict.accepted.value).to.deep.equal([]); conflict.dispose()
  })

  it('fences stale identity responses, prevents double submits, and requires manual refresh after an acceptance conflict', async () => {
    subject.value = { taskId: 'task-1', actorAgentId: 'agent-1' }; identity.value = 1
    let resolveFirst
    let listCalls = 0
    const stale = outcome({ api: { execute: () => {
      listCalls += 1
      if (listCalls === 1) return new Promise(resolve => { resolveFirst = resolve })
      return new Promise(() => {})
    } } })
    await tick(); identity.value = 2; resolveFirst({ data: [row()] }); await tick()
    expect(stale.accepted.value).to.deep.equal([]); stale.dispose()

    identity.value = 3
    const t = outcome({ api: { execute: async options => {
      if (options.method === 'GET') return { data: [row()] }
      throw Object.assign(new Error('changed'), { status: 409 })
    } } })
    await tick(); t.selectArtifact(t.workspaceArtifacts.value[0]); t.confirmed.value = true
    const first = t.accept(); const second = await t.accept()
    expect(second).to.equal(null); await first
    expect(t.submitState.value).to.equal('conflict')
    expect(t.submitMessage.value).to.include('刷新')
    t.dispose()
  })
})

describe('F06 ArtifactOutcomePanel binding', () => {
  it('mounts the actual component and composable with a workspace artifact and explicit confirmation', async () => {
    const { readFileSync } = await import('node:fs')
    const { compileScript, parse } = await import('@vue/compiler-sfc')
    const Vue = await import('vue')
    const { mount } = await import('@vue/test-utils')
    const source = readFileSync(new URL('../src/components/juyiting/ArtifactOutcomePanel.vue', import.meta.url), 'utf8')
    const { descriptor } = parse(source, { filename: 'ArtifactOutcomePanel.vue' })
    const body = compileScript(descriptor, { id: 'f06-artifact-outcome-test', inlineTemplate: true }).content
      .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, imports) => `var { ${imports.replace(/\s+as\s+/g, ': ')} } = Vue`)
      .replace(/^import\s+\{\s*useHallArtifactOutcomes\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { useHallArtifactOutcomes } = mocks')
      .replace('export default', 'return')
    const ArtifactOutcomePanel = new Function('Vue', 'mocks', body)(Vue, { useHallArtifactOutcomes })
    const globals = Object.fromEntries(['SVGElement', 'Element', 'Node'].map(key => [key, Object.getOwnPropertyDescriptor(global, key)]))
    for (const key of Object.keys(globals)) global[key] = global.window?.[key]
    const calls = []
    const api = { execute: async options => {
      calls.push(options)
      if (options.method === 'GET') return { data: [row()] }
      return { data: row({ artifactId: 'draft-1', artifactVersion: 3, title: '当前成果', outcomeVersion: 1, decisionId: 'f06-11111111-1111-1111-1111-111111111111', decidedByAgentId: 'agent-1' }) }
    } }
    const originalCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => '11111111-1111-1111-1111-111111111111' } })
    const wrapper = mount(ArtifactOutcomePanel, { props: { api, subject: { taskId: 'task-1', actorAgentId: 'agent-1' }, workspace: workspace.value, identityEpoch: 9 } })
    try {
      await tick()
      const select = wrapper.find('select'); await select.setValue('draft-1\u00003')
      expect(wrapper.find('input[inputmode="numeric"]').exists()).to.equal(false)
      expect(wrapper.text()).to.include('由服务器原子核验')
      await wrapper.find('.artifact-outcome-confirm input').setValue(true)
      expect(wrapper.find('button[type="submit"]').attributes('disabled')).to.equal(undefined)
      await wrapper.find('form').trigger('submit')
      expect(calls.filter(call => call.method === 'POST')).to.have.length(1)
      expect(wrapper.text()).to.include('服务端已确认')
    } finally {
      wrapper.unmount()
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto })
      for (const [key, descriptor] of Object.entries(globals)) { if (descriptor) Object.defineProperty(global, key, descriptor); else delete global[key] }
    }
  })
})

describe('F06 cross-operation race regressions', () => {
  it('does not let refresh invalidate a pending acceptance or strand submitting state', async () => {
    subject.value = { taskId: 'task-1', actorAgentId: 'agent-1' }; identity.value = 21
    let resolvePost; let gets = 0
    const t = outcome({ api: { execute: options => {
      if (options.method === 'GET') { gets += 1; return Promise.resolve({ data: [row()] }) }
      return new Promise(resolve => { resolvePost = resolve })
    } } })
    try {
      await tick(); t.selectArtifact(t.workspaceArtifacts.value[0]); t.confirmed.value = true
      const pending = t.accept(); await tick(); await t.refreshAccepted()
      expect(gets).to.equal(1)
      resolvePost({ data: row({ artifactId: 'draft-1', artifactVersion: 3, outcomeVersion: 1, decisionId: 'f06-test-idempotency-key', decidedByAgentId: 'agent-1' }) })
      await pending; expect(t.submitState.value).to.equal('accepted')
    } finally { t.dispose() }
  })

  it('does not let submission invalidate a pending initial read or strand loading state', async () => {
    subject.value = { taskId: 'task-1', actorAgentId: 'agent-1' }; identity.value = 22
    let resolveList; let posts = 0
    const t = outcome({ api: { execute: options => {
      if (options.method === 'GET') return new Promise(resolve => { resolveList = resolve })
      posts += 1; return Promise.resolve({ data: row({ artifactId: 'draft-1', artifactVersion: 3, outcomeVersion: 1, decisionId: 'f06-test-idempotency-key' }) })
    } } })
    try {
      await tick(); t.selectArtifact(t.workspaceArtifacts.value[0]); t.confirmed.value = true
      await t.accept(); expect(posts).to.equal(0)
      resolveList({ data: [row()] }); await tick(); expect(t.acceptedState.value).to.equal('ready')
    } finally { t.dispose() }
  })

  it('requires successful explicit refresh after conflict before another acceptance attempt', async () => {
    subject.value = { taskId: 'task-1', actorAgentId: 'agent-1' }; identity.value = 23
    let posts = 0
    const t = outcome({ api: { execute: async options => {
      if (options.method === 'GET') return { data: [row()] }
      posts += 1; throw Object.assign(new Error('changed'), { status: 409 })
    } } })
    try {
      await tick(); t.selectArtifact(t.workspaceArtifacts.value[0]); t.confirmed.value = true
      await t.accept(); await t.accept(); expect(posts).to.equal(1)
      await t.refreshAccepted(); t.selectArtifact(t.workspaceArtifacts.value[0]); t.confirmed.value = true
      await t.accept(); expect(posts).to.equal(2)
    } finally { t.dispose() }
  })
})

describe('F06 wire and uncertainty regressions', () => {
  it('accepts nullable workItemId omitted by JSON serialization but rejects extra fields', async () => {
    subject.value = { taskId: 'task-1', actorAgentId: 'agent-1' }; identity.value = 24
    const optional = row(); delete optional.workItemId
    const t = outcome({ api: { execute: async () => ({ data: [optional] }) } })
    try { await tick(); expect(t.acceptedState.value).to.equal('ready') } finally { t.dispose() }
    const poisoned = outcome({ api: { execute: async () => ({ data: [{ ...optional, storageUri: 'private-value' }] }) } })
    try { await tick(); expect(poisoned.accepted.value).to.deep.equal([]); expect(poisoned.acceptedState.value).to.equal('error') } finally { poisoned.dispose() }
  })
  it('keeps uncertain POST outcomes blocked until a successful authoritative refresh', async () => {
    subject.value = { taskId: 'task-1', actorAgentId: 'agent-1' }; identity.value = 25
    let posts = 0; let failRead = false
    const t = outcome({ api: { execute: async options => {
      if (options.method === 'GET') { if (failRead) throw Object.assign(new Error('off'), { status: 503 }); return { data: [] } }
      posts += 1; throw new TypeError('connection lost')
    } } })
    try {
      await tick(); t.selectArtifact(t.workspaceArtifacts.value[0]); t.confirmed.value = true; await t.accept()
      expect(t.submitState.value).to.equal('unknown'); expect(t.refreshRequired.value).to.equal(true)
      expect(t.selectArtifact(t.workspaceArtifacts.value[0])).to.equal(false)
      await t.accept(); expect(posts).to.equal(1)
      failRead = true; await t.refreshAccepted(); expect(t.refreshRequired.value).to.equal(true)
      failRead = false; await t.refreshAccepted(); expect(t.refreshRequired.value).to.equal(false)
      expect(t.confirmed.value).to.equal(false)
    } finally { t.dispose() }
  })
})
