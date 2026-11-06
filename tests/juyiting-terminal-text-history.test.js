import { expect } from 'chai'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { displayFixture } from './fixtures/juyiting/interface-display-fixture.mjs'
import { useHallTerminalTextHistory } from '../src/composables/juyiting/useHallTerminalTextHistory.js'

const base = displayFixture(JSON.parse(readFileSync(new URL('./fixtures/juyiting/completed-message-delivery-v3.json', import.meta.url), 'utf8')))
const outcome = n => {
  const value = structuredClone(base)
  value.requestId = `r${n}`; value.turnId = `t${n}`
  Object.assign(value.outcome, { outcomeId: `o${n}`, assistantMessageId: String(n * 2), text: `成果${n}` })
  Object.assign(value.outcome.messageSource, { messageId: String(n * 2), turnId: value.turnId, snapshotId: `s${n}` })
  return value
}
const entry = n => ({ ordinal: String(n), request: { requestId: `r${n}`, requestRevision: '1', conversationId: '42', conversationGeneration: '1',
  userMessageId: String(n * 2 - 1), state: 'COMPLETED', stateVersion: '1', steps: [], turns: [{
    turnId: `t${n}`, requestId: `r${n}`, requestRevision: '1', conversationId: '42', conversationGeneration: '1', targetAgentId: 'wuyong',
    contextSnapshotId: `s${n}`, dispatchId: `d${n}`, route: 'CHAT', state: 'PUBLISHED', stateVersion: '1', lastDeltaSeq: '0',
    terminalReason: null, finalMessageId: String(n * 2), createdAt: '1', updatedAt: '1'
  }] } })
const messagePage = (ids, nextCursor = null) => ({ items: ids.map(n => ({ id: String(n * 2), createTime: 1000,
  content: `成果${n}`, senderType: 'agent', metadata: JSON.stringify({ requestId: `r${n}` }) })), hasMore: nextCursor !== null, nextCursor,
  requestPage: { schemaVersion: 1, scope: { conversationId: '42', conversationGeneration: '1', taskId: 'task' },
    after: '0', through: String(Math.max(0, ...ids)), nextAfter: null, hasMore: false, eventCursor: null, entries: ids.map(entry) },
  outcomeSummaries: ids.map(n => { const value = outcome(n); value.schemaVersion = 1; delete value.outcome.text; return value }) })
const setup = ({ latest = messagePage([101, 102], '1000:202'), older = messagePage([1, 2]), hook, visible = true } = {}) => {
  const identity = ref('owner'), task = ref('task'), calls = []
  const doc = new EventTarget(); doc.visibilityState = visible ? 'visible' : 'hidden'
  const api = { list: async (path, params) => { calls.push({ path, params }); return { items: [{ id: '42', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: `task:${task.value}` }] } },
    get: async (path, params, options) => {
      calls.push({ path, params }); const custom = await hook?.(path, params, options)
      if (custom?.handled) return custom.value
      if (path === '/conversation/messages') { const value = params.cursor ? older : latest; options.onSuccess?.(value); return value }
      throw new Error(`Unexpected follow-up read: ${path}`)
    } }
  const history = useHallTerminalTextHistory({ api, taskId: () => task.value, identityKey: () => identity.value, documentRef: doc })
  return { history, calls, identity, task, doc }
}
const settle = async h => {
  for (let i = 0; i < 500; i++) { await new Promise(resolve => setTimeout(resolve, 2)); await flushPromises(); if (!h.history.loading.value) return }
  throw new Error('history did not settle')
}
const reads = h => h.calls.filter(call => call.path.endsWith('/typed-outcome'))

describe('cancelled task text history window', () => {
  it('receives twenty messages and their outcomes in one page request, with no follow-up GETs', async () => {
    const h = setup({ latest: messagePage(Array.from({ length: 20 }, (_, i) => 9981 + i), '1000:19962') })
    try {
      await settle(h)
      expect(h.history.error.value).to.equal(''); expect(h.history.items.value).to.have.length(20)
      expect(reads(h)).to.have.length(0)
      expect(h.calls.filter(call => call.path.startsWith('/conversations/42/requests?'))).to.have.length(0)
      expect(h.calls.filter(call => call.path === '/conversation/messages')).to.have.length(1)
      expect(h.calls.some(call => call.path === '/conversations/42/requests' || call.path.startsWith('/requests/'))).to.equal(false)
      expect(h.history.hasMore.value).to.equal(true)
    } finally { h.history.dispose() }
  })
  it('one explicit older page only reads new IDs and keeps the original outcomes', async () => {
    const h = setup({ older: messagePage([1, 2, 101]) })
    try {
      await settle(h); const original = h.history.items.value[0]
      expect(await h.history.loadOlder()).to.equal(true)
      expect(h.history.items.value.map(item => item.requestId)).to.deep.equal(['r1', 'r2', 'r101', 'r102'])
      expect(h.history.items.value[2]).to.equal(original); expect(reads(h)).to.have.length(0)
      expect(h.history.hasMore.value).to.equal(false); expect(await h.history.loadOlder()).to.equal(false)
      expect(h.calls.filter(call => call.path === '/conversation/messages')).to.have.length(2)
    } finally { h.history.dispose() }
  })
  it('an empty visible window is not a claim that all historical outcomes are absent', async () => {
    const latest = { ...messagePage([], '1000:202'), items: [{ id: '202', createTime: 1000, content: 'ordinary', metadata: '{}' }] }
    const h = setup({ latest })
    try {
      await settle(h); expect(h.history.items.value).to.have.length(0); expect(h.history.hasMore.value).to.equal(true)
      expect(h.calls).to.have.length(2)
      expect(await h.history.loadOlder()).to.equal(true); expect(h.history.items.value).to.have.length(2)
    } finally { h.history.dispose() }
  })
  it('retries an older message-page network failure with the same cursor, preserving current items', async () => {
    let fail = true
    const h = setup({ hook: async (path, params) => { if (path === '/conversation/messages' && params.cursor && fail) { fail = false; throw new Error('offline') } } })
    try {
      await settle(h); expect(await h.history.loadOlder()).to.equal(false)
      expect(h.history.items.value).to.have.length(2); expect(h.history.error.value).to.equal('offline')
      expect(await h.history.retry()).to.equal(true); expect(h.history.error.value).to.equal('')
      expect(h.history.items.value).to.have.length(4)
      expect(h.calls.filter(call => call.params?.cursor).map(call => call.params.cursor)).to.deep.equal(['1000:202', '1000:202'])
    } finally { h.history.dispose() }
  })
  it('retries a malformed older page without advancing its cursor or losing prior items', async () => {
    let fail = true
    const h = setup({ hook: async (path, params, options) => {
      if (path === '/conversation/messages' && params.cursor && fail) {
        fail = false
        const broken = messagePage([1, 2]); broken.requestPage.scope.conversationId = 'foreign'
        options.onSuccess(broken)
        return { handled: true, value: broken }
      }
    } })
    try {
      await settle(h); expect(await h.history.loadOlder()).to.equal(false)
      expect(h.history.items.value).to.have.length(2)
      expect(await h.history.retry()).to.equal(true); expect(h.history.items.value).to.have.length(4)
      expect(h.calls.filter(call => call.params?.cursor).map(call => call.params.cursor)).to.deep.equal(['1000:202', '1000:202'])
      expect(reads(h)).to.have.length(0)
    } finally { h.history.dispose() }
  })
  it('rejects an outcome whose turn is not associated with its message page', async () => {
    const latest = messagePage([101, 102]); latest.outcomeSummaries[0].turnId = 'foreign-turn'
    const h = setup({ latest })
    try { await settle(h); expect(h.history.items.value).to.have.length(0); expect(h.history.error.value).to.include('回合不匹配'); expect(reads(h)).to.have.length(0) }
    finally { h.history.dispose() }
  })
  it('fences a late aggregate page on identity change and aborts its transport', async () => {
    let done; let signal; let first = true
    const h = setup({ hook: async (path, _params, options) => {
      if (path === '/conversation/messages' && first) { first = false; signal = options.signal; return await new Promise(resolve => { done = () => resolve({ handled: true, value: messagePage([1]) }) }) }
    } })
    try {
      for (let n = 0; n < 30 && !done; n++) await flushPromises()
      expect(done).to.be.a('function'); h.identity.value = 'new-owner'; expect(signal.aborted).to.equal(true)
      await settle(h); done(); await flushPromises()
      expect(h.history.error.value).to.equal(''); expect(h.history.items.value).to.have.length(2)
    } finally { done?.(); h.history.dispose() }
  })
  it('does not double-load older pages and stops reads when disposed', async () => {
    let done
    const h = setup({ hook: async (path, params, options) => {
      if (path === '/conversation/messages' && params.cursor) return await new Promise(resolve => { done = () => { options.onSuccess(messagePage([1, 2])); resolve({ handled: true }) } })
    } })
    try {
      await settle(h); const flight = h.history.loadOlder(); expect(await h.history.loadOlder()).to.equal(false)
      await flushPromises(); expect(done).to.be.a('function'); h.history.dispose(); done()
      expect(await flight).to.equal(false); expect(h.history.items.value).to.have.length(0)
      expect(reads(h)).to.have.length(0)
    } finally { done?.(); h.history.dispose() }
  })
  it('defers reads while hidden and has no stream/timer reads after initialization', async () => {
    const h = setup({ visible: false })
    try {
      await settle(h); expect(h.calls).to.have.length(0)
      h.doc.visibilityState = 'visible'; h.doc.dispatchEvent(new Event('visibilitychange')); await settle(h)
      expect(h.history.items.value).to.have.length(2)
      const count = h.calls.length; await flushPromises(); await flushPromises(); expect(h.calls).to.have.length(count)
    } finally { h.history.dispose() }
  })
})
