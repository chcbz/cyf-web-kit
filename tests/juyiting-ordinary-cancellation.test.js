import { readFileSync } from 'node:fs'
import { parse as parseSfc } from '@vue/compiler-sfc'
import postcss from 'postcss'
import { expect } from 'chai'
import { ref } from 'vue'
import { useHallOrdinaryCancellation, ordinaryTaskVersion, canCancelOrdinaryTask, cancellationPayload } from '../src/composables/juyiting/useHallOrdinaryCancellation.js'
import { useHallTaskActions } from '../src/composables/juyiting/useHallTaskActions.js'

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const receipt = { taskId: 'a', status: 'cancelled', taskVersion: '3' }
const task = overrides => ({ id: 'a', status: 'open', taskVersion: '2', funding: null, reward: 0, ...overrides })
const disposables = []
const harness = (overrides = {}) => {
  const selectedTask = ref(task(overrides.task)); const tasks = ref([selectedTask.value])
  const identityScope = ref('owner-a'); const identityEpoch = ref(1); const sessionKey = ref('tasks:1')
  const requests = []; const toasts = []; let refreshed = 0; let success = 0
  const agentApi = {
    create: async (url, body, options) => { requests.push({ method: 'POST', url, body, options }); return overrides.post ? overrides.post() : { data: receipt } },
    get: async (url, params, options) => { requests.push({ method: 'GET', url, params, options }); return overrides.get ? overrides.get() : { data: { code: 'E0', data: task({ status: 'cancelled', taskVersion: '3', assignedAgentIds: ['old-agent'] }) } } }
  }
  const deps = { agentApi, selectedTask, tasks, identityScope, identityEpoch, sessionKey,
    onCancelled: async (...args) => { refreshed++; if (overrides.refresh) await overrides.refresh(...args) },
    log: { warn() {} }, showToast: message => toasts.push(message), playSuccess: () => success++, playError() {} }
  const actions = useHallOrdinaryCancellation(deps); disposables.push(actions)
  return { actions, deps, requests, selectedTask, tasks, identityScope, identityEpoch, sessionKey, toasts,
    refreshed: () => refreshed, success: () => success }
}
const posts = h => h.requests.filter(request => request.method === 'POST')
const rejected = (status, code) => { throw Object.assign(new Error('rejected'), { status, code }) }

describe('ordinary cancellation scoped existing API', () => {
  afterEach(() => { for (const actions of disposables.splice(0)) actions.dispose() })
  for (const status of ['open', 'planning', 'assigned']) it(`cancels ${status} with only a canonical string version and preserves historical assignment`, async () => {
    const h = harness({ task: { status, assignedAgentIds: ['old-agent'] } })
    expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(true)
    expect(posts(h)[0]).to.include({ url: '/tasks/a/cancel' })
    expect(posts(h)[0].body).to.deep.equal({ expectedTaskVersion: '2' })
    expect(typeof posts(h)[0].body.expectedTaskVersion).to.equal('string')
    expect(h.requests[1]).to.include({ method: 'GET', url: '/tasks/a' })
    expect(h.selectedTask.value.status).to.equal('cancelled')
    expect(h.selectedTask.value.assignedAgentIds).to.deep.equal(['old-agent'])
    expect(h.refreshed()).to.equal(1)
    expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(false)
    expect(posts(h)).to.have.length(1)
  })
  it('suppresses duplicate clicks throughout POST and GET', async () => {
    const wait = deferred(); const readback = deferred()
    const h = harness({ post: () => wait.promise, get: () => readback.promise })
    const pending = h.actions.cancelTask(h.selectedTask.value)
    expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(false)
    wait.resolve(receipt); await Promise.resolve(); await Promise.resolve()
    expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(false)
    readback.resolve({ data: task({ status: 'cancelled', taskVersion: '3' }) })
    expect(await pending).to.equal(true); expect(posts(h)).to.have.length(1)
  })
  it('confirms a lost POST response only by GET of the original cancelled task', async () => {
    const h = harness({ post: () => { throw new TypeError('response lost') } })
    expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(true)
    expect(h.success()).to.equal(1); expect(posts(h)).to.have.length(1)
  })
  for (const get of [() => ({ data: task() }), () => ({ data: task({ id: 'other', status: 'cancelled', taskVersion: '3' }) }),
    () => ({ data: task({ status: 'cancelled', taskVersion: '2' }) }), () => { throw new TypeError('GET lost') }]) {
    it('leaves an unconfirmed lost response unknown; explicit check never repeats POST', async () => {
      const h = harness({ post: () => { throw new TypeError('response lost') }, get })
      expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(false)
      expect(h.selectedTask.value.status).to.equal('open')
      expect(h.actions.cancellationState.value.status).to.equal('unresolved')
      expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(false)
      expect(posts(h)).to.have.length(1); expect(h.success()).to.equal(0); expect(h.refreshed()).to.equal(0)
    })
  }
  it('keeps a validated receipt confirmed when the subsequent task GET is lost', async () => {
    const h = harness({ task: { assignedAgentIds: ['old-agent'] }, get: () => { throw new TypeError('lost GET') } })
    expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(true)
    expect(h.selectedTask.value.status).to.equal('cancelled')
    expect(h.selectedTask.value.assignedAgentIds).to.deep.equal(['old-agent'])
    expect(h.toasts.at(-1)).to.include('刷新待完成')
  })
  it('does not claim projections refreshed when existing loader error flags reject the refresh callback', async () => {
    const h = harness({ refresh: () => { throw new Error('catalogError') } })
    expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(true)
    expect(h.toasts.at(-1)).to.include('刷新待完成')
  })
  for (const [status, code, text] of [[403, 'CANCEL_FORBIDDEN', '无权'], [409, 'TASK_VERSION_CONFLICT', '版本已变化'],
    [409, 'INITIAL_CANCEL_UNSUPPORTED', '不支持普通取消'], [409, undefined, '状态不支持或版本冲突']]) {
    it(`reports ${status}/${code} accurately without success or a fallback mutation`, async () => {
      const h = harness({ post: () => rejected(status, code) })
      expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(false)
      expect(h.toasts.at(-1)).to.include(text)
      expect(h.requests).to.have.length(1); expect(h.selectedTask.value.status).to.equal('open'); expect(h.success()).to.equal(0)
    })
  }
  for (const boundary of ['identityScope', 'identityEpoch', 'sessionKey', 'selectedTask', 'dispose']) {
    it(`ignores late POST results after ${boundary} changes`, async () => {
      const wait = deferred(); const h = harness({ post: () => wait.promise }); const original = h.selectedTask.value
      const pending = h.actions.cancelTask(original)
      if (boundary === 'dispose') h.actions.dispose()
      else if (boundary === 'selectedTask') h.selectedTask.value = task({ id: 'b' })
      else h[boundary].value = boundary === 'identityEpoch' ? 2 : 'different'
      wait.resolve(receipt)
      expect(await pending).to.equal(false)
      expect(original.status).to.equal('open'); expect(h.requests).to.have.length(1)
      expect(h.refreshed()).to.equal(0); expect(h.toasts).to.deep.equal([])
    })
  }
  it('A→B→A before the old POST settles is not stuck busy; checking cannot admit its late receipt', async () => {
    const wait = deferred(); const h = harness({ post: () => wait.promise, get: () => ({ data: task() }) })
    const original = h.selectedTask.value; const pending = h.actions.cancelTask(original)
    h.selectedTask.value = task({ id: 'b' }); h.selectedTask.value = original
    expect(h.actions.cancellationBusy.value).to.equal(false)
    expect(h.actions.cancellationState.value.status).to.equal('unresolved')
    expect(await h.actions.cancelTask(original)).to.equal(false)
    wait.resolve(receipt); expect(await pending).to.equal(false)
    expect(h.actions.cancellationBusy.value).to.equal(false)
    expect(h.actions.cancellationState.value.status).to.equal('unresolved')
    expect(original.status).to.equal('open'); expect(posts(h)).to.have.length(1)
  })
  it('does not let an old POST overwrite a newer confirmed GET after A→B→A', async () => {
    const wait = deferred(); const h = harness({ post: () => wait.promise })
    const original = h.selectedTask.value; const pending = h.actions.cancelTask(original)
    h.selectedTask.value = task({ id: 'b' }); h.selectedTask.value = original
    expect(await h.actions.cancelTask(original)).to.equal(true)
    wait.reject(new TypeError('old lost response')); expect(await pending).to.equal(false)
    expect(h.actions.cancellationState.value.status).to.equal('confirmed'); expect(h.success()).to.equal(1)
  })
  it('never routes funded or unknown funding objects into ordinary cancellation', async () => {
    for (const funding of [{ mode: 'FUNDED_SINGLE_AGENT' }, {}]) {
      const h = harness({ task: { funding } })
      expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(false); expect(h.requests).to.have.length(0)
    }
  })
  it('keeps the existing funding/cancel route and string version independent', async () => {
    const h = harness({ task: { funding: { mode: 'FUNDED_SINGLE_AGENT' } } })
    const actions = useHallTaskActions({ ...h.deps, canAssign: () => false, selectedAgent: ref(null), fundedIntentStorage: null })
    disposables.push(actions)
    await actions.cancelFunding(h.selectedTask.value)
    expect(posts(h)[0].url).to.equal('/tasks/a/funding/cancel')
    expect(posts(h)[0].body).to.deep.equal({ expectedTaskVersion: '2' })
    expect(await actions.cancelTask(h.selectedTask.value)).to.equal(false)
  })
  it('accepts only canonical int64 string versions and preliminarily supported states', () => {
    for (const version of [null, true, '02', '2.0', '', -1, 0, 2, 1.1, Number.MAX_SAFE_INTEGER, '9223372036854775808', ' 2', '+2', '2e1']) expect(ordinaryTaskVersion({ taskVersion: version })).to.equal(null)
    for (const status of ['running', 'cancelled', 'completed', 'queued']) expect(canCancelOrdinaryTask(task({ status }))).to.equal(false)
    expect(canCancelOrdinaryTask(task({ startedAt: 0 }))).to.equal(false)
    expect(canCancelOrdinaryTask(task({ reward: 1 }))).to.equal(false)
    expect(canCancelOrdinaryTask(task())).to.equal(true)
  })
  for (const [before, after] of [['0', '1'], ['9', '10'], ['9007199254740992', '9007199254740993'], ['9223372036854775806', '9223372036854775807']]) {
    it(`preserves exact request, receipt and readback for ${before} → ${after}`, async () => {
      const h = harness({ task: { taskVersion: before },
        post: () => ({ ...receipt, taskVersion: after }),
        get: () => task({ status: 'cancelled', taskVersion: after }) })
      expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(true)
      expect(posts(h)[0].body).to.deep.equal({ expectedTaskVersion: before })
      expect(h.selectedTask.value.taskVersion).to.equal(after)
    })
    it(`reconciles lost POST with exact string increment for ${before} → ${after}`, async () => {
      const h = harness({ task: { taskVersion: before }, post: () => { throw new TypeError('lost') },
        get: () => task({ status: 'cancelled', taskVersion: after }) })
      expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(true)
      expect(posts(h)).to.have.length(1)
    })
  }
  it('does not admit a cancellation that would overflow the server Long version', async () => {
    const h = harness({ task: { taskVersion: '9223372036854775807' } })
    expect(ordinaryTaskVersion(h.selectedTask.value)).to.equal('9223372036854775807')
    expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(false)
    expect(h.requests).to.have.length(0)
  })
  for (const version of [3, '03', '3.0', '9223372036854775808', '2', null]) {
    it(`does not confirm malformed/non-advancing receipt ${JSON.stringify(version)} without valid readback`, async () => {
      const h = harness({ post: () => ({ ...receipt, taskVersion: version }), get: () => task() })
      expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(false)
      expect(h.actions.cancellationState.value.status).to.equal('unresolved')
      expect(h.success()).to.equal(0)
    })
  }
  it('rejects rounded/equal large readback versions and only GETs when checking again', async () => {
    const h = harness({ task: { taskVersion: '9007199254740992' }, post: () => { throw new TypeError('lost') },
      get: () => task({ status: 'cancelled', taskVersion: '9007199254740992' }) })
    expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(false)
    expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(false)
    expect(posts(h)).to.have.length(1)
  })
  it('does not accept a numeric canonical GET after a lost response', async () => {
    const h = harness({ post: () => { throw new TypeError('lost') }, get: () => task({ status: 'cancelled', taskVersion: 3 }) })
    expect(await h.actions.cancelTask(h.selectedTask.value)).to.equal(false)
  })
  it('decodes actual bare result.data and the existing business envelope without hiding failures', () => {
    expect(cancellationPayload({ data: receipt, status: 200 })).to.equal(receipt)
    expect(cancellationPayload({ data: { code: 'E0', data: receipt } })).to.equal(receipt)
    expect(() => cancellationPayload({ data: { code: 'CANCEL_FORBIDDEN', status: 403 } })).to.throw()
  })
})


describe('ordinary cancellation detail layout', () => {
  const source = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
  const { descriptor } = parseSfc(source)
  const css = postcss.parse(descriptor.styles.map(style => style.content).join('\n'))
  const declarations = selector => {
    const values = {}
    css.walkRules(selector, rule => rule.walkDecls(decl => { values[decl.prop] = decl.value }))
    return values
  }

  it('separates the cancellation copy, button and following results action', () => {
    expect(declarations('.ordinary-cancellation')).to.include({
      display: 'grid', gap: '12px', margin: '16px 0', 'padding-top': '16px'
    })
    expect(declarations('.ordinary-cancellation > p')).to.include({ margin: '0', 'line-height': '1.65' })
  })

  it('keeps the secondary action full-width and allows narrow-screen wrapping', () => {
    expect(declarations('.ordinary-cancel-action')).to.include({
      width: '100%', 'min-width': '0', 'box-sizing': 'border-box',
      'white-space': 'normal', 'overflow-wrap': 'anywhere', 'min-height': '44px',
      border: '1px solid var(--hall-brand, #923f30)', background: 'var(--hall-surface, #fffefa)'
    })
    expect(declarations('.ordinary-cancel-action:focus-visible').outline).to.exist
    expect(declarations('.ordinary-cancel-action:disabled').cursor).to.equal('not-allowed')
  })
})
