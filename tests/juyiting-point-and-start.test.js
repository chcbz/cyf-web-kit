import { expect } from 'chai'
import { ref } from 'vue'
import { setImmediate } from 'node:timers'
import { useHallPointAndStart } from '../src/composables/juyiting/useHallPointAndStart.js'
import { createPointAndStartIntentStore, pointAndStartBody, pointAndDeliberateBody, pointAndStartProjection } from '../src/composables/juyiting/hallPointAndStartIntent.js'

const copy = value => JSON.parse(JSON.stringify(value))
const storage = () => {
  const values = new Map()
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}
const req = () => ({ taskId: 'task-1', taskVersion: '6', requirementRevision: '3', title: '画一只鸟',
  description: null, contentSha256: 'a'.repeat(64), source: 'CREATE' })
const task = () => ({ id: 'task-1', taskVersion: '6', status: 'open' })
const canonical = () => ({ id: 'task-1', taskVersion: '7', status: 'assigned', assignedAgentId: 'agent-1', title: '画一只鸟' })
const grant = () => projection()
const projection = () => ({ schemaVersion: 1, taskId: 'task-1', targetAgentId: 'agent-1', requirementRevision: '3',
  assignmentRevision: '7', taskVersion: '7', grantId: 'grant-1', grantVersion: '1', grantState: 'ACTIVE',
  permittedOperations: ['DELIBERATE', 'INSPECT_INPUTS'], inputs: [], bootstrapId: 'bootstrap-1',
  bootstrapState: 'ADMITTED', stateVersion: '2', initialOperation: 'DELIBERATE',
  conversationId: '9007199254740993', initialRequestId: 'initial-1', currentAssignment: true })
const args = () => ({ task: task(), agent: { agentId: 'agent-1' } })
const record = () => ({ schemaVersion: 2, taskId: 'task-1', key: 'original-key', postAcknowledged: false,
  body: pointAndDeliberateBody({ targetAgentId: 'agent-1', expectedTaskVersion: '6', requirementRevision: '3' }) })
const instances = []
const harness = (overrides = {}) => {
  const memory = overrides.storage || storage()
  const scope = overrides.scope || ref('owner-a/client-a')
  const calls = []
  let sent = false
  const admitted = []
  const api = {
    get: async (path, query, opts) => {
      calls.push(['get', path, opts?.headers?.['Idempotency-Key']])
      if (path.endsWith('/requirements/current')) return { data: req() }
      if (path.endsWith('/point-and-deliberate/request')) return { data: projection() }
      return { data: sent ? canonical() : task() }
    },
    create: async (path, body, opts) => {
      calls.push(['post', path, copy(body), opts.headers['Idempotency-Key']])
      const original = createPointAndStartIntentStore({ storage: memory, scope: scope.value, taskId: 'task-1' }).read()
      expect(original.state).to.equal('PRESENT')
      expect(original.record.key).to.equal(opts.headers['Idempotency-Key'])
      expect(original.record.body).to.deep.equal(body)
      sent = true
      return { data: grant() }
    }, ...overrides.api
  }
  const flow = useHallPointAndStart({ agentApi: api, actorScopeKey: scope, storage: memory,
    canAssign: current => current.status === 'open',
    createIdempotencyKey: () => 'original-key', onAdmitted: async value => { admitted.push(value); return true }, ...overrides.options })
  instances.push(flow)
  return { flow, calls, memory, scope, admitted, seed: value => createPointAndStartIntentStore({ storage: memory,
    scope: scope.value, taskId: 'task-1' }).write(value || record()) }
}
const pause = () => new Promise(resolve => setImmediate(resolve))

describe('persisted exact point-and-start source contract', () => {
  afterEach(() => instances.splice(0).forEach(flow => flow.dispose()))

  it('persists/readbacks original body before one POST, then reads exact action/task and adopts without resend', async () => {
    const { flow, calls, admitted } = harness()
    const original = args()
    expect(await flow.start(original)).to.equal(true)
    expect(calls.map(c => c[0])).to.deep.equal(['get', 'get', 'post', 'get', 'get'])
    expect(calls[2][2]).to.deep.equal(record().body)
    expect(calls[3]).to.deep.equal(['get', '/tasks/task-1/point-and-deliberate/request', 'original-key'])
    expect(flow.state.value.status).to.equal('ATTACHED')
    expect(admitted[0].reference.conversationId).to.equal('9007199254740993')
    expect(admitted[0].task).to.deep.equal(canonical())
    expect(original.task).to.deep.equal(task()) // grant is never assigned into TaskDTO
    expect(original.agent).to.deep.equal({ agentId: 'agent-1' })
  })

  it('preserves exact fixed-version optional reference with metadata/hash projected by server', async () => {
    const input = { fileId: 'image-1', version: 2, purpose: 'REFERENCE' }
    const facts = { ...input, contentMimeType: 'image/png', byteLength: '12', contentHash: 'b'.repeat(64) }
    let taskReads = 0
    const h = harness({ api: {
      get: async path => ({ data: path.endsWith('/requirements/current') ? req() : path.endsWith('/point-and-deliberate/request')
        ? { ...projection(), inputs: [facts] } : taskReads++ === 0 ? task() : canonical() }),
      create: async (path, body) => { h.calls.push(['post', path, copy(body)]); return { data: { ...grant(), inputs: [{ ...facts, byteLength: '12' }] } } }
    } })
    expect(await h.flow.start({ ...args(), inputRefs: [input] })).to.equal(true)
    expect(h.calls.find(c => c[0] === 'post')[2]).to.deep.equal(record().body)
    expect(h.flow.state.value.projection.inputs).to.deep.equal([facts])
  })

  it('image capability negotiation is not a prerequisite for generic discussion', async () => {
    const h = harness({ options: { isSupported: () => { throw new Error('must not query drawing capability') } } })
    expect(await h.flow.start(args())).to.equal(true)
    expect(h.calls.some(c => /capability|consent|provider/.test(c[1]))).to.equal(false)
  })

  for (const [name, mutate] of [
    ['no trustworthy requirement', r => { delete r.requirementRevision }],
    ['numeric revision', r => { r.requirementRevision = 3 }],
    ['overflow revision', r => { r.requirementRevision = '9223372036854775808' }],
    ['mismatched task root version', r => { r.taskVersion = '5' }],
    ['missing immutable hash', r => { r.contentSha256 = '' }],
    ['bad source', r => { r.source = 'TASK_PLAN' }]
  ]) it(`never writes with ${name}`, async () => {
    const value = req(); mutate(value)
    const h = harness({ api: { get: async path => ({ data: path.endsWith('/requirements/current') ? value : task() }) } })
    expect(await h.flow.start(args())).to.equal(false)
    expect(h.calls.filter(c => c[0] === 'post')).to.have.length(0)
    expect(h.seed(record()).state).to.equal('PRESENT') // no unsafe intent was persisted
  })

  it('funded tasks stay outside this workflow', async () => {
    const h = harness()
    expect(await h.flow.start({ ...args(), task: { ...task(), funding: { mode: 'FUNDED_SINGLE_AGENT' } } })).to.equal(false)
    expect(h.calls).to.have.length(0)
  })

  it('corrupt storage cannot be replaced to bypass an unresolved request', async () => {
    const h = harness(); h.seed(); const name = [...h.memory.values.keys()][0]
    h.memory.setItem(name, '{broken')
    expect(await h.flow.start(args())).to.equal(false)
    expect(h.calls).to.have.length(0)
    expect(h.memory.getItem(name)).to.equal('{broken')
  })

  it('failed storage readback prevents POST', async () => {
    const h = harness({ storage: { getItem: () => null, setItem: () => {} } })
    expect(await h.flow.start(args())).to.equal(false)
    expect(h.calls.filter(c => c[0] === 'post')).to.have.length(0)
  })

  it('unknown POST preserves original key/body; remount only reads and never POSTs', async () => {
    const memory = storage()
    const h = harness({ storage: memory, api: { create: async () => { throw new Error('lost ACK') } } })
    expect(await h.flow.start(args())).to.equal(false)
    expect(h.flow.state.value.status).to.equal('UNKNOWN')
    const original = copy(h.flow.state.value.intent)
    h.flow.dispose()
    const next = harness({ storage: memory, api: { get: async path => ({ data: path.endsWith('/point-and-deliberate/request') ? projection() : canonical() }) } })
    expect(await next.flow.checkOriginal('task-1')).to.equal(true)
    expect(next.calls.every(c => c[0] === 'get')).to.equal(true)
    expect(next.flow.state.value.intent.body).to.deep.equal(original.body)
    expect(next.flow.state.value.intent.key).to.equal('original-key')
  })

  it('new selection never overwrites an existing original intent', async () => {
    const h = harness(); h.seed()
    expect(await h.flow.start({ ...args(), agent: { agentId: 'other' } })).to.equal(false)
    expect(h.calls).to.have.length(0)
    expect(h.flow.state.value.intent.body.targetAgentId).to.equal('agent-1')
  })

  for (const [status, code] of [[404, 'ASSIGNMENT_OPERATION_UNAVAILABLE'], [401, 'AUTH_REQUIRED'], [403, 'FORBIDDEN'], [500, 'ASSIGNMENT_OPERATION_INTEGRITY_ERROR'], [503, 'ASSIGNMENT_OPERATION_SOURCE_UNAVAILABLE']]) {
    it(`checking ${status} does not resend the original request`, async () => {
      const h = harness({ api: { get: async () => { const e = new Error('read error'); e.status = status; e.code = code; throw e } } }); h.seed()
      expect(await h.flow.checkOriginal('task-1')).to.equal(false)
      expect(h.calls.filter(c => c[0] === 'post')).to.have.length(0)
    })
  }

  it('explicit recovery after exact action404 replays original body/key only', async () => {
    let reads = 0
    const h = harness({ api: { get: async path => {
      if (path.endsWith('/point-and-deliberate/request') && reads++ === 0) {
        const e = new Error('not yet observed'); e.status = 404; e.code = 'ASSIGNMENT_OPERATION_UNAVAILABLE'; throw e
      }
      return { data: path.endsWith('/point-and-deliberate/request') ? projection() : canonical() }
    } } }); h.seed()
    expect(await h.flow.resumeOriginal('task-1')).to.equal(true)
    expect(h.calls.filter(c => c[0] === 'post')).to.have.length(1)
    expect(h.calls.find(c => c[0] === 'post').slice(2)).to.deep.equal([record().body, 'original-key'])
  })

  it('explicit recovery replays persisted reference versions even when an external catalog could have changed', async () => {
    const input = { fileId: 'image-original', version: 2, purpose: 'REFERENCE' }
    const facts = { ...input, contentMimeType: 'image/png', byteLength: '12', contentHash: 'c'.repeat(64) }
    const original = record()
    let actionReads = 0
    const h = harness({ api: {
      get: async path => {
        if (path.endsWith('/point-and-deliberate/request') && actionReads++ === 0) {
          throw Object.assign(new Error('not yet observed'), { status: 404, code: 'ASSIGNMENT_OPERATION_UNAVAILABLE' })
        }
        return { data: path.endsWith('/point-and-deliberate/request') ? { ...projection(), inputs: [facts] } : canonical() }
      },
      create: async (path, body, options) => {
        h.calls.push(['post', path, copy(body), options.headers['Idempotency-Key']])
        return { data: { ...grant(), inputs: [{ ...facts, byteLength: '12' }] } }
      }
    } })
    h.seed(original)

    expect(await h.flow.resumeOriginal('task-1')).to.equal(true)
    expect(h.calls.find(call => call[0] === 'post')[2]).to.deep.equal(original.body)
    expect(h.flow.state.value.projection.inputs).to.deep.equal([facts])
  })

  it('confirmed POST + projection404 cannot erase facts or trigger replay', async () => {
    const h = harness({ api: { get: async () => { const e = new Error('missing'); e.status = 404; e.code = 'ASSIGNMENT_OPERATION_UNAVAILABLE'; throw e } } })
    h.seed({ ...record(), postAcknowledged: true })
    expect(await h.flow.resumeOriginal('task-1')).to.equal(false)
    expect(h.calls.filter(c => c[0] === 'post')).to.have.length(0)
    expect(h.flow.state.value.intent.postAcknowledged).to.equal(true)
  })

  it('PENDING preparation uses no new first-turn/send/POST', async () => {
    const value = { ...projection(), bootstrapState: 'PENDING', stateVersion: '0', conversationId: null, initialRequestId: null }
    const h = harness({ api: { get: async () => ({ data: value }) } }); h.seed()
    expect(await h.flow.resumeOriginal('task-1')).to.equal(true)
    expect(h.flow.state.value.status).to.equal('PREPARING')
    expect(h.admitted).to.have.length(0)
    expect(h.calls.filter(c => c[0] === 'post')).to.have.length(0)
  })

  it('reassigned/revoked historical original can be read but never automatically attached', async () => {
    const h = harness({ api: { get: async () => ({ data: { ...projection(), grantState: 'REVOKED', grantVersion: '2', currentAssignment: false } }) } }); h.seed()
    expect(await h.flow.checkOriginal('task-1')).to.equal(true)
    expect(h.flow.state.value.status).to.equal('HISTORICAL')
    expect(h.admitted).to.have.length(0)
  })

  it('scope switch while POST is in flight isolates late receipt and forbids followup reads/adoption', async () => {
    let resolve
    const h = harness({ api: { create: async () => new Promise(done => { resolve = done }) } })
    const sending = h.flow.start(args()); await pause()
    h.scope.value = 'owner-b/client-b'
    resolve({ data: grant() })
    expect(await sending).to.equal(false)
    expect(h.flow.state.value.status).to.equal('IDLE')
    expect(h.admitted).to.have.length(0)
    expect(h.calls.some(c => c[1].endsWith('/point-and-deliberate/request'))).to.equal(false)
    h.scope.value = 'owner-a/client-a'
    expect(h.seed().record.key).to.equal('original-key')
  })

  it('draft edits during requirement read do not mutate the fixed operation selection', async () => {
    let resolve, reads = 0
    const h = harness({ api: { get: async path => {
      if (path.endsWith('/requirements/current')) return new Promise(done => { resolve = done })
      return { data: path.endsWith('/point-and-deliberate/request') ? projection() : reads++ === 0 ? task() : canonical() }
    } } })
    const original = args()
    const running = h.flow.start(original)
    original.requestedOperations = ['GENERATE_IMAGE']
    original.inputRefs = [{ fileId: 'new', version: 1, purpose: 'REFERENCE' }]
    resolve({ data: req() })
    expect(await running).to.equal(true)
    expect(h.calls.find(c => c[0] === 'post')[2]).to.deep.equal(record().body)
  })

  it('changed explicit target during preflight cannot silently point to another Agent', async () => {
    let resolve
    const h = harness({ api: { get: async () => new Promise(done => { resolve = done }) } })
    const original = args()
    const running = h.flow.start(original)
    original.agent.agentId = 'other'
    resolve({ data: req() })
    expect(await running).to.equal(false)
    expect(h.calls.filter(c => c[0] === 'post')).to.have.length(0)
  })

  it('canonical read failure retains confirmed grant and uses original key for a pure read retry', async () => {
    let reads = 0
    const h = harness({ api: { get: async path => {
      if (path.endsWith('/requirements/current')) return { data: req() }
      if (path.endsWith('/point-and-deliberate/request')) return { data: projection() }
      if (reads++ === 0) return { data: task() }
      if (reads === 2) throw new Error('snapshot offline')
      return { data: canonical() }
    } } })
    expect(await h.flow.start(args())).to.equal(false)
    expect(h.flow.state.value.status).to.equal('ADMITTED')
    expect(h.flow.state.value.intent.postAcknowledged).to.equal(true)
    expect(h.flow.state.value.intent.projection.grantId).to.equal('grant-1')
    expect(await h.flow.checkOriginal('task-1')).to.equal(true)
    expect(h.calls.filter(c => c[0] === 'post')).to.have.length(1)
  })

  it('newer canonical root requires fresh original-assignment verification before attaching', async () => {
    let actionReads = 0
    const h = harness({ api: { get: async path => ({ data: path.endsWith('/point-and-deliberate/request')
      ? { ...projection(), taskVersion: actionReads++ === 0 ? '7' : '8' }
      : { ...canonical(), taskVersion: '8' } }) } }); h.seed()
    expect(await h.flow.checkOriginal('task-1')).to.equal(true)
    expect(actionReads).to.equal(2)
    expect(h.admitted[0].task.taskVersion).to.equal('8')
    expect(h.flow.state.value.projection.assignmentRevision).to.equal('7')
  })

  it('same-target but changed assignment epoch fails fresh read and never attaches an old request', async () => {
    let actionReads = 0
    const h = harness({ api: { get: async path => ({ data: path.endsWith('/point-and-deliberate/request')
      ? { ...projection(), taskVersion: actionReads++ === 0 ? '7' : '8', currentAssignment: actionReads === 1 }
      : { ...canonical(), taskVersion: '8' } }) } }); h.seed()
    expect(await h.flow.checkOriginal('task-1')).to.equal(false)
    expect(h.admitted).to.have.length(0)
    expect(h.calls.filter(c => c[0] === 'post')).to.have.length(0)
  })

  for (const [status, code] of [[401, 'AUTH_REQUIRED'], [403, 'FORBIDDEN'], [500, 'ASSIGNMENT_OPERATION_INTEGRITY_ERROR'], [503, 'ASSIGNMENT_OPERATION_SOURCE_UNAVAILABLE']]) {
    it(`explicit recovery ${status} never retries a write`, async () => {
      const h = harness({ api: { get: async () => { const e = new Error('unavailable'); e.status = status; e.code = code; throw e } } }); h.seed()
      expect(await h.flow.resumeOriginal('task-1')).to.equal(false)
      expect(h.calls.filter(c => c[0] === 'post')).to.have.length(0)
    })
  }

  it('bad grant ACK retains original intent and never copies it into task or blindly replays', async () => {
    const h = harness({ api: { create: async () => ({ data: { ...grant(), targetAgentId: 'foreign' } }) } })
    const original = args()
    expect(await h.flow.start(original)).to.equal(false)
    expect(h.flow.state.value.status).to.equal('UNKNOWN')
    expect(original.task).to.deep.equal(task())
    expect(h.flow.state.value.intent.key).to.equal('original-key')
    expect(h.flow.state.value.intent.postAcknowledged).to.equal(false)
    expect(h.admitted).to.have.length(0)
  })

  it('old in-flight operation occupies the same slot and stays read-only without conversion', async () => {
    const old = { schemaVersion: 1, taskId: 'task-1', key: 'old-key', postAcknowledged: false,
      body: pointAndStartBody({ agentId: 'agent-1', taskVersion: '6', requirementRevision: '3',
        requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE' }) }
    const h = harness({ api: { get: async path => {
      h.calls.push(['get', path])
      throw Object.assign(new Error('unknown'), { status: 404, code: 'ASSIGNMENT_OPERATION_UNAVAILABLE' })
    } } })
    h.seed(old)
    expect(await h.flow.start(args())).to.equal(false)
    expect(await h.flow.resumeOriginal('task-1')).to.equal(false)
    expect(h.calls).to.deep.equal([['get', '/tasks/task-1/assignment-operation']])
    expect(h.seed(record()).state).to.equal('CORRUPT')
    expect(h.flow.state.value.intent).to.deep.equal(old)
  })

  it('server-frozen mixed catalogue accepts 32 versions without requesting image roles from browser', async () => {
    const inputs = Array.from({ length: 32 }, (_, index) => ({ fileId: `file-${index}`, version: 1, purpose: 'INPUT',
      contentMimeType: ['image/png', 'application/pdf', 'audio/ogg', 'text/plain'][index % 4], byteLength: '12', contentHash: 'd'.repeat(64) }))
    let taskReads = 0
    const h = harness({ api: {
      get: async path => ({ data: path.endsWith('/requirements/current') ? req() : path.endsWith('/point-and-deliberate/request')
        ? { ...projection(), inputs } : taskReads++ === 0 ? task() : canonical() }),
      create: async (path, body) => { h.calls.push(['post', path, body]); return { data: { ...projection(), inputs } } }
    } })
    expect(await h.flow.start(args())).to.equal(true)
    expect(h.calls.find(c => c[0] === 'post')[2]).to.deep.equal(record().body)
    expect(h.flow.state.value.projection.inputs).to.have.length(32)
    const altered = [...inputs]; altered[0] = { ...altered[0], version: 2 }
    expect(pointAndStartProjection({ ...projection(), inputs: altered }, record(), h.flow.state.value.projection)).to.equal(null)
  })

  it('single composable blocks double click and disposal fences pending reads', async () => {
    let resolve
    const h = harness({ api: { get: async () => new Promise(done => { resolve = done }) } })
    const first = h.flow.start(args())
    expect(await h.flow.start(args())).to.equal(false)
    h.flow.dispose(); resolve({ data: req() })
    expect(await first).to.equal(false)
    expect(h.admitted).to.have.length(0)
  })
})

describe('independent generic action/grant/root fences', () => {
  for (const [name, mutate] of [
    ['foreign task', p => { p.taskId = 'foreign' }],
    ['wrong target', p => { p.targetAgentId = 'foreign' }],
    ['another first action', p => { p.initialOperation = 'EDIT_IMAGE' }],
    ['altered grant set', p => { p.permittedOperations = ['GENERATE_IMAGE'] }],
    ['numeric stateVersion', p => { p.stateVersion = 2 }],
    ['missing admitted request', p => { p.initialRequestId = null }],
    ['extra injected input', p => { p.inputs = [{ fileId: 'x', version: 1, purpose: 'REFERENCE' }] }]
  ]) it(`rejects ${name}`, () => {
    const p = projection(); mutate(p)
    expect(pointAndStartProjection(p, record())).to.equal(null)
  })

  it('root/grant can advance without moving outbox fence or inventing conflict', () => {
    const p = pointAndStartProjection(projection(), record())
    expect(pointAndStartProjection({ ...p, taskVersion: '8', grantVersion: '2' }, record(), p)).not.to.equal(null)
  })
  it('same outbox version conflicting state and admitted regression are rejected', () => {
    const p = projection()
    expect(pointAndStartProjection({ ...p, conversationId: '88' }, record(), p)).to.equal(null)
    expect(pointAndStartProjection({ ...p, stateVersion: '3', bootstrapState: 'RETRY', conversationId: null, initialRequestId: null }, record(), p)).to.equal(null)
  })
  it('new body keeps long decimal versions as strings and rejects authority fields in persisted records', () => {
    expect(pointAndDeliberateBody({ targetAgentId: 'agent-1', expectedTaskVersion: '9007199254740993', requirementRevision: '9223372036854775807' }))
      .to.deep.equal({ targetAgentId: 'agent-1', expectedTaskVersion: '9007199254740993', requirementRevision: '9223372036854775807' })
    const memory = storage(); const store = createPointAndStartIntentStore({ storage: memory, scope: 'owner', taskId: 'task-1' })
    for (const changed of [{ ...record(), body: { ...record().body, paidExecutionAuthorized: true } },
      { ...record(), providerConsent: {} }, { ...record(), controlledImageBridge: {} }, { ...record(), grant: null }]) {
      expect(store.write(changed).state).to.equal('UNAVAILABLE')
    }
    expect(store.read().state).to.equal('ABSENT')
  })
  it('noncanonical/unsafe version never becomes an inaccurate write number', () => {
    expect(pointAndStartBody({ agentId: 'agent-1', taskVersion: '9007199254740993', requirementRevision: '3', requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE' })).to.equal(null)
    expect(pointAndStartBody({ agentId: 'agent-1', taskVersion: '06', requirementRevision: '3', requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE' })).to.equal(null)
  })
})
