import { strict as assert } from 'node:assert'
import { describe, it } from 'mocha'
import { isProxy } from 'vue'
import { compareTaskEventVersions, nextTaskEventVersion, parseTaskEventVersion } from '../src/composables/juyiting/taskEventVersion.js'
import { applyTaskWorkspaceEvent, validateTaskWorkspaceSnapshot } from '../src/composables/juyiting/taskWorkspaceReducer.js'
import { createTaskSseParser, useTaskEventStream } from '../src/composables/juyiting/useTaskEventStream.js'
import { useTaskWorkspace } from '../src/composables/juyiting/useTaskWorkspace.js'

const V = '9007199254740993'
const NEXT = nextTaskEventVersion(V)
const HASH = 'a'.repeat(64)

function timeline (version) {
  if (version === '0') return []
  const count = BigInt(version) > 100n ? 100 : Number(BigInt(version))
  let current = BigInt(version) - BigInt(count) + 1n
  return Array.from({ length: count }, () => { const event = { version: current.toString(), redacted: false, eventType: 'PROGRESS_REPORTED', actorType: 'system', actorId: null, aggregateType: 'task', aggregateId: 'task-a', occurredAt: '1' }; current += 1n; return event })
}
function snapshot (version = V, taskId = 'task-a') {
  return { task: { taskId, status: 'assigned', assignedAgentId: null, requiredAbilities: null, reward: null, assignedAt: null, startedAt: null, completedAt: null, collaborationMode: 'single', riskLevel: 'low', maxAgents: 1, coordinatorAgentId: null, reviewRequired: true, version: '1' }, members: [{ agentId: 'agent-a', role: 'worker', status: 'accepted', assignmentSource: 'manual', joinedAt: null, acceptedAt: null, startedAt: null, completedAt: null, lastHeartbeatAt: null, version: '1' }], workItems: [], openRequests: [], recentArtifacts: [], recentArtifactsTruncated: false, conversationId: null, recentEvents: timeline(version), timelineTruncated: BigInt(version) > 100n, currentVersion: version }
}
function progress (version = NEXT) { return { version, eventId: `event-${version}`, eventType: 'PROGRESS_REPORTED', actorType: 'system', actorId: null, aggregateType: 'task', aggregateId: 'task-a', occurredAt: '2', payload: { noteId: 'note-a', noteType: 'progress', contentSha256: HASH } } }
function taskStarted (version = NEXT, overrides = {}) { return { version, eventId: `event-${version}`, eventType: 'TASK_STARTED', actorType: 'system', actorId: null, aggregateType: 'task', aggregateId: 'task-a', occurredAt: '2', payload: { fromStatus: 'assigned', toStatus: 'running', expectedVersion: '1', resultVersion: '2' }, ...overrides } }
function workItem (overrides = {}) { return { workItemId: 'work-a', title: 'Work A', description: null, workType: 'build', requiredAbilities: null, assigneeAgentId: null, status: 'pending', priority: 0, requiredItem: false, dependencyJson: null, leaseUntil: null, attemptCount: 0, maxAttempts: 1, resultArtifactId: null, submittedAt: null, completedAt: null, version: '1', ...overrides } }
function memberEvent (eventType, fromStatus, toStatus) { return { version: NEXT, eventId: `member-${eventType}`, eventType, actorType: 'system', actorId: null, aggregateType: 'member', aggregateId: 'agent-a', occurredAt: '2', payload: { agentId: 'agent-a', memberId: 'agent-a', role: 'worker', fromStatus, toStatus, expectedVersion: '1', resultVersion: '2' } } }
function deferred () { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
class FakeDocument extends EventTarget { constructor () { super(); this.visibilityState = 'visible' } }

describe('C06 task workspace state', () => {
  it('keeps canonical Long versions exact without Number coercion', () => {
    assert.equal(parseTaskEventVersion(V), V)
    assert.equal(parseTaskEventVersion('9223372036854775807'), '9223372036854775807')
    assert.equal(parseTaskEventVersion('9223372036854775808'), null)
    assert.equal(parseTaskEventVersion('01'), null)
    assert.equal(compareTaskEventVersions(V, '9007199254740992'), 1)
  })

  it('applies only complete allowlisted transitions and otherwise resyncs atomically', () => {
    const before = snapshot()
    const applied = applyTaskWorkspaceEvent(before, progress())
    assert.equal(applied.kind, 'applied')
    assert.equal(applied.workspace.currentVersion, NEXT)
    assert.equal(applied.workspace.task.status, 'assigned')
    assert.deepEqual(before, snapshot())
    const started = taskStarted(NEXT, { payload: { ...taskStarted().payload, startedAt: '2' } })
    const taskApplied = applyTaskWorkspaceEvent(before, started)
    assert.equal(taskApplied.kind, 'applied')
    assert.equal(taskApplied.workspace.task.status, 'running')
    assert.equal(taskApplied.workspace.task.version, '2')
    assert.equal(applyTaskWorkspaceEvent(before, taskStarted()).kind, 'resync')
    assert.equal(applyTaskWorkspaceEvent(before, { ...taskStarted(), payload: { ...taskStarted().payload, resultVersion: '1' } }).kind, 'resync')
    assert.equal(applyTaskWorkspaceEvent(before, { ...taskStarted(), payload: { ...taskStarted().payload, fromStatus: 'running' } }).kind, 'resync')
    assert.equal(applyTaskWorkspaceEvent(before, { ...taskStarted(), payload: { ...taskStarted().payload, expectedVersion: '0' } }).kind, 'resync')
    assert.deepEqual(before, snapshot())
  })

  it('fails closed for aggregate, actor, payload, lease, and redaction contract violations', () => {
    const before = snapshot()
    assert.equal(applyTaskWorkspaceEvent(before, { ...progress(), aggregateType: 'member' }).kind, 'resync')
    assert.equal(applyTaskWorkspaceEvent(before, { ...progress(), actorId: 'spoof' }).kind, 'resync')
    assert.equal(applyTaskWorkspaceEvent(before, { ...progress(), payload: { noteId: 'note-a', noteType: 'progress', contentSha256: 'bad' } }).kind, 'resync')
    const lease = { version: NEXT, eventId: 'lease', eventType: 'WORK_ITEM_LEASE_RELEASED', actorType: 'agent', actorId: 'agent-a', aggregateType: 'work_item', aggregateId: 'work-a', occurredAt: '2', payload: { workItemId: 'work-a', toStatus: 'ready', resultVersion: '2' } }
    assert.equal(applyTaskWorkspaceEvent(before, lease).kind, 'resync')
    assert.equal(applyTaskWorkspaceEvent(before, { version: NEXT, redacted: true, leaked: 'no' }).kind, 'resync')
    assert.equal(applyTaskWorkspaceEvent(before, { version: NEXT, redacted: true }).kind, 'resync')
  })

  it('binds snapshots to the requested task and rejects missing DTO fields or inconsistent timeline cursors', () => {
    assert.ok(validateTaskWorkspaceSnapshot(snapshot(), { taskId: 'task-a' }))
    assert.equal(validateTaskWorkspaceSnapshot(snapshot(V, 'task-b'), { taskId: 'task-a' }), null)
    const missing = snapshot(); delete missing.task.version
    assert.equal(validateTaskWorkspaceSnapshot(missing), null)
    const inconsistent = snapshot(); inconsistent.recentEvents[0].version = '1'; inconsistent.timelineTruncated = true
    assert.equal(validateTaskWorkspaceSnapshot(inconsistent), null)
  })

  it('accepts omitted system timeline actor ids but requires canonical ids for agent and role events', () => {
    const system = snapshot(); delete system.recentEvents[0].actorId
    assert.ok(validateTaskWorkspaceSnapshot(system))
    const agentMissing = snapshot(); agentMissing.recentEvents[0].actorType = 'agent'; delete agentMissing.recentEvents[0].actorId
    assert.equal(validateTaskWorkspaceSnapshot(agentMissing), null)
    const roleInvalid = snapshot(); roleInvalid.recentEvents[0].actorType = 'role'; roleInvalid.recentEvents[0].actorId = ' role'
    assert.equal(validateTaskWorkspaceSnapshot(roleInvalid), null)
  })

  it('accepts pending work items and rejects null requiredItem or negative attemptCount', () => {
    const valid = snapshot(); valid.workItems.push(workItem())
    assert.ok(validateTaskWorkspaceSnapshot(valid))
    for (const override of [{ requiredItem: null }, { attemptCount: -1 }]) {
      const invalid = snapshot(); invalid.workItems.push(workItem(override))
      assert.equal(validateTaskWorkspaceSnapshot(invalid), null)
    }
  })

  it('resyncs incomplete member timestamp transitions while retaining only provable member updates', () => {
    const blocked = snapshot(); blocked.members[0].status = 'working'
    const blockOutcome = applyTaskWorkspaceEvent(blocked, memberEvent('MEMBER_BLOCKED', 'working', 'blocked'))
    assert.equal(blockOutcome.kind, 'applied')
    for (const [type, from, to] of [['MEMBER_ACCEPTED', 'invited', 'accepted'], ['MEMBER_WORKING', 'accepted', 'working'], ['MEMBER_DONE', 'working', 'done'], ['MEMBER_REJECTED', 'invited', 'rejected'], ['MEMBER_FAILED', 'working', 'failed'], ['MEMBER_LEFT', 'accepted', 'left']]) {
      const before = snapshot(); before.members[0].status = from
      assert.equal(applyTaskWorkspaceEvent(before, memberEvent(type, from, to)).kind, 'resync')
      assert.equal(before.members[0].completedAt, null)
    }
  })

  it('parses CRLF/LF/chunks/comments but rejects duplicate or missing ids, mismatch, names, and truncated bytes', () => {
    const events = []; const failures = []
    const parser = createTaskSseParser({ onEvent: event => events.push(event), onMalformed: reason => failures.push(reason) })
    const wire = `: comment\r\nevent: task_event\r\nid: ${NEXT}\r\ndata: {"version":"${NEXT}",\r\ndata: "eventType":"PROGRESS_REPORTED"}\r\n\r\n`
    parser.push(wire.slice(0, 17)); parser.push(wire.slice(17))
    for (const boundary of ['\n\n', '\r\n\r\n', '\n\r\n', '\r\n\n']) {
      const mixed = `data: {"version":"${NEXT}"}\r\nid: ${NEXT}\nevent: task_event${boundary}`
      const mixedParser = createTaskSseParser({ onEvent: event => events.push(event), onMalformed: reason => failures.push(reason) })
      mixedParser.push(mixed.slice(0, mixed.length - 2)); mixedParser.push(mixed.slice(-2))
    }
    assert.equal(events.length, 5)
    for (const bad of [`event: task_event\nid: 0\ndata: {"version":"0"}\n\n`, `event: task_event\ndata: {"version":"${NEXT}"}\n\n`, `event: task_event\nid: ${NEXT}\ndata: {"version":"${V}"}\n\n`, `event: unknown\nid: ${NEXT}\ndata: {"version":"${NEXT}"}\n\n`, `event: resync_required\n\r\ndata: {"currentVersion":"${V}","reason":"gap"}\n\n`]) createTaskSseParser({ onMalformed: value => failures.push(value) }).push(bad)
    const truncated = createTaskSseParser({ onMalformed: value => failures.push(value) }); truncated.push(`event: task_event\nid: ${NEXT}\ndata: {"version":"${NEXT}"}`); truncated.finish()
    const noDelimiter = createTaskSseParser({ onMalformed: value => failures.push(value) }); noDelimiter.push(`event: task_event\nid: ${NEXT}\ndata: {"version":"${NEXT}"}\n`); noDelimiter.finish()
    assert.equal(failures.length, 7)
  })

  it('releases snapshot ownership before synchronous stream resync reloads it', async () => {
    let snapshots = 0; let streams = 0
    const api = { execute: options => {
      if (options.url.endsWith('/workspace')) {
        snapshots += 1
        return Promise.resolve({ data: { data: snapshot(snapshots === 1 ? V : NEXT) } })
      }
      streams += 1
      options.onStreamOpen({ cancel () {} })
      if (streams === 1) options.onStream(`event: resync_required\ndata: {"currentVersion":"${V}","reason":"gap"}\n\n`)
      return new Promise(() => {})
    } }
    const instance = useTaskWorkspace({ agentApi: api, documentRef: new FakeDocument(), windowRef: new EventTarget() })
    await instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve()
    assert.equal(snapshots, 2)
    assert.equal(streams, 2)
    assert.equal(instance.workspace.value.currentVersion, NEXT)
    assert.equal(instance.connectionState.value, 'live')
    assert.ok(instance.workspace.value.recentEvents.some(event => event.version === NEXT))
    instance.dispose()
  })

  it('bounds unterminated SSE input by UTF-8 bytes and fails only once', () => {
    const failures = []
    const parser = createTaskSseParser({ onMalformed: reason => failures.push(reason) })
    parser.push('x'.repeat(16 * 1024 * 1024 + 1))
    parser.push('\n')
    assert.deepEqual(failures, ['oversize_sse'])
  })

  it('bounds multiline SSE data accumulation before it can dispatch', () => {
    const events = []; const failures = []
    const padding = 'x'.repeat(16 * 1024)
    const parser = createTaskSseParser({ onEvent: event => events.push(event), onMalformed: reason => failures.push(reason) })
    parser.push(`event: task_event\nid: ${NEXT}\ndata: {"version":"${NEXT}",\ndata: "padding":"${padding}"}\n\n`)
    assert.deepEqual(events, [])
    assert.deepEqual(failures, ['oversize_sse'])
  })

  it('accepts a 16KiB UTF-8 multibyte SSE data record split across chunks', () => {
    const events = []; const failures = []; const encoder = new TextEncoder()
    const emptyPayload = JSON.stringify({ version: NEXT, padding: '' })
    const paddingBytes = 16 * 1024 - encoder.encode(emptyPayload).byteLength
    const padding = '€'.repeat(Math.floor(paddingBytes / 3)) + 'x'.repeat(paddingBytes % 3)
    const payload = JSON.stringify({ version: NEXT, padding })
    assert.equal(encoder.encode(payload).byteLength, 16 * 1024)
    const wire = `event: task_event\r\nid: ${NEXT}\r\ndata: ${payload}\r\n\r\n`
    const parser = createTaskSseParser({ onEvent: event => events.push(event), onMalformed: reason => failures.push(reason) })
    parser.push(wire.slice(0, 41)); parser.push(wire.slice(41, 999)); parser.push(wire.slice(999))
    assert.equal(events.length, 1)
    assert.equal(events[0].version, NEXT)
    assert.deepEqual(failures, [])
  })

  it('stops a 64MiB unterminated line after the bounded prefix without buffering or TextEncoder allocation', () => {
    const failures = []; let encoderCalls = 0; let largeChunkReads = 0
    const parser = createTaskSseParser({ onMalformed: reason => failures.push(reason) })
    const originalEncoder = globalThis.TextEncoder; const originalCharCodeAt = String.prototype.charCodeAt
    globalThis.TextEncoder = class { constructor () { encoderCalls += 1 } encode () { throw new Error('unexpected encoder use') } }
    String.prototype.charCodeAt = function (...args) {
      if (this.length > 1024 * 1024) largeChunkReads += 1
      return originalCharCodeAt.apply(this, args)
    }
    try {
      parser.push('x'.repeat(64 * 1024 * 1024))
    } finally {
      globalThis.TextEncoder = originalEncoder
      String.prototype.charCodeAt = originalCharCodeAt
    }
    assert.deepEqual(failures, ['oversize_sse'])
    assert.equal(encoderCalls, 0)
    assert.ok(largeChunkReads < 70 * 1024)
  })

  it('parses multiple near-limit frames from one mixed-ending transport chunk', () => {
    const events = []; const failures = []
    const padding = 'x'.repeat(11 * 1024)
    const payload = JSON.stringify({ version: NEXT, padding })
    const crlf = `event: task_event\r\nid: ${NEXT}\r\ndata: ${payload}\r\n\r\n`
    const lf = `event: task_event\nid: ${NEXT}\ndata: ${payload}\n\n`
    const parser = createTaskSseParser({ onEvent: event => events.push(event), onMalformed: reason => failures.push(reason) })
    parser.push(crlf + lf)
    assert.equal(events.length, 2)
    assert.deepEqual(events.map(event => event.version), [NEXT, NEXT])
    assert.deepEqual(failures, [])
  })

  it('rejects multi-chunk input once its bounded unterminated line budget is exhausted', () => {
    const failures = []
    const parser = createTaskSseParser({ onMalformed: reason => failures.push(reason) })
    parser.push('x'.repeat(12 * 1024))
    parser.push('y'.repeat(9 * 1024))
    assert.deepEqual(failures, ['oversize_sse'])
  })

  it('cancels the live transport before discarding it on malformed, resync, and EOF terminals', async () => {
    for (const action of ['malformed', 'oversize', 'resync', 'end']) {
      let options; let cancelled = 0
      const stream = useTaskEventStream({ agentApi: { execute: value => { options = value; value.onStreamOpen({ cancel: () => { cancelled += 1 } }); return new Promise(() => {}) } } })
      stream.open({ taskId: 'task-a', actorAgentId: 'agent-a', sinceVersion: V, generation: 1 })
      if (action === 'malformed') options.onStream(`event: task_event\ndata: {}\n\n`)
      if (action === 'oversize') options.onStream('x'.repeat(32 * 1024))
      if (action === 'resync') options.onStream(`event: resync_required\ndata: {"currentVersion":"${V}","reason":"gap"}\n\n`)
      if (action === 'end') options.onStreamEnd()
      await Promise.resolve()
      assert.equal(cancelled, 1)
      assert.equal(stream.active, null)
    }
  })

  it('contains throwing and rejected active or stale handle cancellation without unhandled rejections', async () => {
    const unhandled = []
    const onUnhandled = reason => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      for (const cancel of [() => { throw new Error('sync cancel') }, () => Promise.reject(new Error('async cancel'))]) {
        let options; let resyncs = 0
        const stream = useTaskEventStream({
          agentApi: { execute: value => { options = value; value.onStreamOpen({ cancel }); return new Promise(() => {}) } },
          onResync: () => { resyncs += 1 }
        })
        const connection = stream.open({ taskId: 'task-a', actorAgentId: 'agent-a', sinceVersion: V, generation: 1 })
        assert.doesNotThrow(() => options.onStream(`event: task_event\ndata: {}\n\n`))
        assert.equal(stream.active, null)
        assert.equal(connection.controller.signal.aborted, true)
        assert.equal(resyncs, 1)
      }
      let staleOptions
      const stale = useTaskEventStream({ agentApi: { execute: value => { staleOptions = value; return new Promise(() => {}) } } })
      const staleConnection = stale.open({ taskId: 'task-a', actorAgentId: 'agent-a', sinceVersion: V, generation: 1 })
      stale.close()
      assert.doesNotThrow(() => staleOptions.onStreamOpen({ cancel: () => Promise.reject(new Error('stale cancel')) }))
      assert.equal(stale.active, null)
      assert.equal(staleConnection.controller.signal.aborted, true)
      await new Promise(resolve => setTimeout(resolve, 0))
      assert.deepEqual(unhandled, [])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('keeps the Vue workspace snapshot plain while live SSE events replace whole state', async () => {
    let streamOptions
    const api = { execute: options => {
      if (options.url.endsWith('/workspace')) return Promise.resolve({ data: { data: snapshot() } })
      streamOptions = options
      return new Promise(() => {})
    } }
    const instance = useTaskWorkspace({ agentApi: api, documentRef: new FakeDocument(), windowRef: new EventTarget() })
    await instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    assert.equal(isProxy(instance.workspace.value), false)
    streamOptions.onStreamOpen({ cancel () {} })
    assert.doesNotThrow(() => streamOptions.onStream(`event: task_event\nid: ${NEXT}\ndata: ${JSON.stringify(progress())}\n\n`))
    assert.equal(instance.workspace.value.currentVersion, NEXT)
    assert.equal(instance.workspace.value.task.status, 'assigned')
    assert.equal(instance.workspace.value.recentEvents.at(-1).version, NEXT)
    assert.doesNotThrow(() => streamOptions.onStream(`event: task_event\nid: ${V}\ndata: ${JSON.stringify(progress(V))}\n\n`))
    assert.equal(instance.workspace.value.currentVersion, NEXT)
    const gap = nextTaskEventVersion(NEXT)
    assert.doesNotThrow(() => streamOptions.onStream(`event: task_event\nid: ${gap}\ndata: ${JSON.stringify(progress(gap))}\n\n`))
    instance.dispose()
  })

  it('uses explicit task and actor, only enters live on true stream open, and terminals stream ACL errors', async () => {
    const calls = []; let streamOptions
    const api = { execute: options => { calls.push(options); if (options.url.endsWith('/workspace')) return Promise.resolve({ data: { data: snapshot() } }); streamOptions = options; return new Promise(() => {}) } }
    const instance = useTaskWorkspace({ agentApi: api, documentRef: new FakeDocument(), windowRef: new EventTarget() })
    await instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    assert.equal(instance.connectionState.value, 'loading')
    streamOptions.onStreamOpen({ cancel () {} })
    assert.equal(instance.connectionState.value, 'live')
    assert.deepEqual(calls[0].params, { actorAgentId: 'agent-a' })
    assert.deepEqual(calls[1].params, { actorAgentId: 'agent-a', sinceVersion: V })
    streamOptions.onStreamEnd()
    await Promise.resolve()
    instance.dispose()
  })

  it('aborts old generations, clears stale state on stream 401/403/404, and does not retry', async () => {
    const first = deferred(); const timers = []; let workspaceCalls = 0
    const api = { execute: options => {
      if (options.url.endsWith('/workspace')) {
        workspaceCalls += 1
        return workspaceCalls === 1 ? first.promise : Promise.resolve({ data: { data: snapshot(V, 'task-b') } })
      }
      options.onStreamOpen?.({ cancel () {} })
      return new Promise(() => {})
    } }
    const instance = useTaskWorkspace({ agentApi: api, documentRef: new FakeDocument(), windowRef: new EventTarget(), setTimeoutFn: callback => { timers.push(callback); return timers.length }, clearTimeoutFn: () => {}, snapshotTimeoutMs: 0 })
    const opening = instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    await instance.open({ taskId: 'task-b', actorAgentId: 'agent-b' })
    assert.equal(workspaceCalls, 2)
    assert.equal(instance.subject.value.taskId, 'task-b')
    first.resolve({ data: { data: snapshot(V, 'task-a') } })
    await opening
    assert.equal(instance.workspace.value.task.taskId, 'task-b')
    const terminalApi = { execute: options => options.url.endsWith('/workspace') ? Promise.resolve({ data: { data: snapshot() } }) : Promise.reject(Object.assign(new Error('forbidden'), { status: 403 })) }
    const terminal = useTaskWorkspace({ agentApi: terminalApi, documentRef: new FakeDocument(), windowRef: new EventTarget(), setTimeoutFn: callback => { timers.push(callback); return timers.length }, clearTimeoutFn: () => {}, snapshotTimeoutMs: 0 })
    await terminal.open({ taskId: 'task-a', actorAgentId: 'agent-a' }); await Promise.resolve()
    assert.equal(terminal.connectionState.value, 'error')
    assert.equal(terminal.workspace.value.currentVersion, '0')
    terminal.dispose(); instance.dispose()
  })

  it('treats a never-settling snapshot timeout as bounded retry then degraded recovery', async () => {
    const timers = []; const cleared = []; const signals = []; let snapshots = 0
    const schedule = (callback, delay) => { const timer = { callback, delay, active: true }; timers.push(timer); return timer }
    const api = { execute: options => {
      if (!options.url.endsWith('/workspace')) return new Promise(() => {})
      snapshots += 1; signals.push(options.signal)
      return new Promise(() => {})
    } }
    const instance = useTaskWorkspace({ agentApi: api, documentRef: new FakeDocument(), windowRef: new EventTarget(), retryFailureThreshold: 2, retryBaseMs: 5, pollIntervalMs: 11, jitter: () => 0, snapshotTimeoutMs: 7, setTimeoutFn: schedule, clearTimeoutFn: timer => { timer.active = false; cleared.push(timer) } })
    const opening = instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    assert.equal(instance.connectionState.value, 'loading')
    const firstTimeout = timers.shift(); assert.equal(firstTimeout.delay, 7)
    firstTimeout.callback()
    await opening
    assert.equal(signals[0].aborted, true)
    assert.equal(instance.connectionState.value, 'reconnecting')
    const retry = timers.shift(); assert.equal(retry.delay, 5)
    retry.callback()
    await Promise.resolve()
    assert.equal(snapshots, 2)
    const secondTimeout = timers.shift(); assert.equal(secondTimeout.delay, 7)
    secondTimeout.callback()
    await Promise.resolve()
    assert.equal(instance.connectionState.value, 'degraded')
    assert.equal(timers.length, 1)
    assert.equal(timers[0].delay, 11)
    instance.dispose()
    assert.ok(cleared.includes(timers[0]))
  })

  it('clears snapshot timeout on success and manual close without scheduling retries', async () => {
    const timers = []; const cleared = []; let signal; let snapshots = 0
    const schedule = (callback, delay) => { const timer = { callback, delay, active: true }; timers.push(timer); return timer }
    const api = { execute: options => {
      if (options.url.endsWith('/workspace')) {
        snapshots += 1; signal = options.signal
        return snapshots === 1 ? Promise.resolve({ data: { data: snapshot() } }) : new Promise(() => {})
      }
      return new Promise(() => {})
    } }
    const instance = useTaskWorkspace({ agentApi: api, documentRef: new FakeDocument(), windowRef: new EventTarget(), snapshotTimeoutMs: 9, setTimeoutFn: schedule, clearTimeoutFn: timer => { timer.active = false; cleared.push(timer) } })
    await instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    assert.equal(cleared.length, 1)
    const closing = instance.reload()
    await Promise.resolve()
    const closeTimeout = timers.at(-1)
    instance.close()
    assert.equal(signal.aborted, true)
    assert.ok(cleared.includes(closeTimeout))
    closeTimeout.callback()
    await Promise.resolve()
    assert.equal(snapshots, 2)
    assert.equal(instance.connectionState.value, 'idle')
    void closing
  })

  it('clears generation-fenced snapshot timeouts on subject switch and dispose', async () => {
    const timers = []; const cleared = []; const signals = []
    const schedule = (callback, delay) => { const timer = { callback, delay, active: true }; timers.push(timer); return timer }
    const instance = useTaskWorkspace({
      agentApi: { execute: options => { if (options.url.endsWith('/workspace')) { signals.push(options.signal); return new Promise(() => {}) } return new Promise(() => {}) } },
      documentRef: new FakeDocument(), windowRef: new EventTarget(), snapshotTimeoutMs: 13, setTimeoutFn: schedule, clearTimeoutFn: timer => { timer.active = false; cleared.push(timer) }
    })
    void instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    const firstTimeout = timers.at(-1)
    void instance.open({ taskId: 'task-b', actorAgentId: 'agent-b' })
    const secondTimeout = timers.at(-1)
    assert.equal(signals[0].aborted, true)
    assert.ok(cleared.includes(firstTimeout))
    instance.dispose()
    assert.equal(signals[1].aborted, true)
    assert.ok(cleared.includes(secondTimeout))
    firstTimeout.callback(); secondTimeout.callback()
    await Promise.resolve()
    assert.equal(instance.connectionState.value, 'idle')
    assert.equal(timers.length, 2)
  })

  it('defers stream creation while hidden, reloads on visible/focus, and sends Last-Event-ID', async () => {
    const documentRef = new FakeDocument(); documentRef.visibilityState = 'hidden'
    const calls = []
    const api = { execute: options => { calls.push(options); return options.url.endsWith('/workspace') ? Promise.resolve({ data: { data: snapshot() } }) : new Promise(() => {}) } }
    const instance = useTaskWorkspace({ agentApi: api, documentRef, windowRef: new EventTarget() })
    await instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    assert.equal(calls.length, 1)
    documentRef.visibilityState = 'visible'; documentRef.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve(); await Promise.resolve()
    const eventCall = calls.find(call => call.url.endsWith('/events'))
    assert.equal(eventCall.headers['Last-Event-ID'], V)
    instance.dispose()
  })

  it('keeps controlled 503 degraded without a retry storm', async () => {
    const timers = []
    const instance = useTaskWorkspace({ agentApi: { execute: () => Promise.reject(Object.assign(new Error('disabled'), { status: 503 })) }, documentRef: new FakeDocument(), windowRef: new EventTarget(), setTimeoutFn: callback => { timers.push(callback); return timers.length }, clearTimeoutFn: () => {}, snapshotTimeoutMs: 0 })
    await instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    assert.equal(instance.connectionState.value, 'degraded')
    assert.equal(timers.length, 0)
    instance.dispose()
  })

  it('mirrors Java identifier whitespace rules and permits U+FEFF while rejecting Java space characters', async () => {
    const feffTask = '\ufefftask-a'; const calls = []
    const response = snapshot(V, feffTask); response.recentEvents.forEach(event => { event.aggregateId = feffTask })
    const accepted = useTaskWorkspace({ agentApi: { execute: options => { calls.push(options); return Promise.resolve({ data: { data: response } }) } }, documentRef: new FakeDocument(), windowRef: new EventTarget() })
    await accepted.open({ taskId: feffTask, actorAgentId: 'agent-a' })
    assert.equal(calls[0].url, `/agent/tasks/${encodeURIComponent(feffTask)}/workspace`)
    assert.equal(applyTaskWorkspaceEvent(snapshot(), { ...progress(), payload: { ...progress().payload, noteId: '\ufeffnote-a' } }).kind, 'applied')
    const rejected = useTaskWorkspace({ agentApi: { execute: () => { throw new Error('must not call') } }, documentRef: new FakeDocument(), windowRef: new EventTarget() })
    await rejected.open({ taskId: '\u3000task-a', actorAgentId: 'agent-a' })
    assert.equal(rejected.connectionState.value, 'error')
    accepted.dispose(); rejected.dispose()
  })

  it('fails local malformed subjects and backend 400 without timers', async () => {
    const timers = []
    const local = useTaskWorkspace({ agentApi: { execute: () => { throw new Error('must not call') } }, documentRef: new FakeDocument(), windowRef: new EventTarget(), setTimeoutFn: callback => { timers.push(callback); return timers.length }, clearTimeoutFn: () => {}, snapshotTimeoutMs: 0 })
    await local.open({ taskId: ' task-a', actorAgentId: 'agent-a' })
    assert.equal(local.connectionState.value, 'error')
    assert.equal(timers.length, 0)
    const remote = useTaskWorkspace({ agentApi: { execute: () => Promise.reject(Object.assign(new Error('bad'), { status: 400 })) }, documentRef: new FakeDocument(), windowRef: new EventTarget(), setTimeoutFn: callback => { timers.push(callback); return timers.length }, clearTimeoutFn: () => {}, snapshotTimeoutMs: 0 })
    await remote.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    assert.equal(remote.connectionState.value, 'error')
    assert.equal(timers.length, 0)
    local.dispose(); remote.dispose()
  })

  it('does not reset repeated open-to-EOF failures on open, then enters bounded degraded polling', async () => {
    const timers = []; let opens = 0
    const api = { execute: options => { if (options.url.endsWith('/workspace')) return Promise.resolve({ data: { data: snapshot() } }); opens += 1; options.onStreamOpen({ cancel () {} }); options.onStreamEnd(); return Promise.resolve() } }
    const instance = useTaskWorkspace({ agentApi: api, documentRef: new FakeDocument(), windowRef: new EventTarget(), setTimeoutFn: callback => { timers.push(callback); return timers.length }, clearTimeoutFn: () => {}, snapshotTimeoutMs: 0, retryFailureThreshold: 2 })
    await instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    await Promise.resolve(); timers.shift()(); await Promise.resolve(); await Promise.resolve()
    assert.equal(opens, 2)
    assert.equal(instance.connectionState.value, 'degraded')
    assert.equal(timers.length, 1)
    instance.dispose()
  })

  it('keeps degraded polling single-flight and on the configured failure cadence', async () => {
    const timers = []; const pollSnapshot = deferred(); let snapshotCalls = 0
    const api = { execute: options => {
      if (options.url.endsWith('/workspace')) {
        snapshotCalls += 1
        return snapshotCalls === 3 ? pollSnapshot.promise : Promise.resolve({ data: { data: snapshot() } })
      }
      options.onStreamOpen({ cancel () {} }); options.onStreamEnd(); return Promise.resolve()
    } }
    const instance = useTaskWorkspace({ agentApi: api, documentRef: new FakeDocument(), windowRef: new EventTarget(), retryFailureThreshold: 2, pollIntervalMs: 77, jitter: () => 0, setTimeoutFn: (callback, delay) => { timers.push({ callback, delay }); return timers.length }, clearTimeoutFn: () => {}, snapshotTimeoutMs: 0 })
    await instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    const retry = timers.shift(); assert.equal(retry.delay, 500)
    retry.callback(); await Promise.resolve(); await Promise.resolve()
    assert.equal(instance.connectionState.value, 'degraded')
    const poll = timers.at(-1); assert.equal(poll.delay, 77)
    poll.callback(); poll.callback()
    assert.equal(snapshotCalls, 3)
    pollSnapshot.resolve({ data: { data: snapshot() } })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    assert.equal(timers.at(-1).delay, 77)
    instance.dispose()
  })

  it('does not let a stale poll completion clear the current generation poll ownership', async () => {
    const timers = []; const stalePoll = deferred(); const currentPoll = deferred(); let snapshots = 0
    const api = { execute: options => {
      if (options.url.endsWith('/workspace')) {
        snapshots += 1
        if (snapshots === 1) return Promise.resolve({ data: { data: snapshot(V, 'task-a') } })
        if (snapshots === 2) return stalePoll.promise
        if (snapshots === 3) return Promise.resolve({ data: { data: snapshot(V, 'task-b') } })
        return currentPoll.promise
      }
      options.onStreamOpen({ cancel () {} }); options.onStreamEnd(); return Promise.resolve()
    } }
    const instance = useTaskWorkspace({ agentApi: api, documentRef: new FakeDocument(), windowRef: new EventTarget(), retryFailureThreshold: 1, pollIntervalMs: 17, snapshotTimeoutMs: 0, setTimeoutFn: (callback, delay) => { timers.push({ callback, delay }); return timers.length }, clearTimeoutFn: () => {} })
    await instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    const stalePollTimer = timers.shift(); stalePollTimer.callback(); await Promise.resolve()
    await instance.open({ taskId: 'task-b', actorAgentId: 'agent-b' })
    const currentPollTimer = timers.shift(); currentPollTimer.callback(); await Promise.resolve()
    assert.equal(snapshots, 4)
    stalePoll.resolve({ data: { data: snapshot(V, 'task-a') } })
    await Promise.resolve(); await Promise.resolve()
    currentPollTimer.callback()
    assert.equal(snapshots, 4)
    instance.dispose()
  })

  it('rejects payload metadata, identifiers, and key counts using the C04/C05 scalar contract', () => {
    const before = snapshot()
    assert.equal(applyTaskWorkspaceEvent(before, { ...progress(), payload: { ...progress().payload, noteType: 'safe_token' } }).kind, 'resync')
    assert.equal(applyTaskWorkspaceEvent(before, { ...progress(), payload: { ...progress().payload, noteId: '😀'.repeat(101) } }).kind, 'resync')
    assert.equal(applyTaskWorkspaceEvent(before, { ...progress(), payload: { ...progress().payload, noteId: '\ud800' } }).kind, 'resync')
    const excess = { ...progress().payload, taskId: 'task-a', taskType: 'type', agentId: 'agent-a', memberId: 'member-a', workItemId: 'work-a', assigneeAgentId: 'agent-a', requestId: 'request-a', targetId: 'target-a', artifactId: 'artifact-a', threadId: 'thread-a', conversationId: 'conversation-a', messageId: 'message-a', senderAgentId: 'agent-a', fromStatus: 'assigned', toStatus: 'running', status: 'open', reasonCode: 'reason', role: 'worker', source: 'manual', decisionCode: 'decision', requestType: 'help', targetType: 'agent', artifactType: 'artifact', visibility: 'private', threadType: 'thread', messageType: 'message', expectedVersion: '1', resultVersion: '2', artifactVersion: '1', attemptCount: '0', maxAttempts: '1' }
    assert.equal(Object.keys(excess).length, 34)
    assert.equal(applyTaskWorkspaceEvent(before, { ...progress(), payload: excess }).kind, 'resync')
  })

  it('rejects snapshot enum, range, timestamp, and timeline DTO integrity violations', () => {
    for (const mutate of [
      state => { state.task.reviewRequired = null },
      state => { state.task.status = 'new' },
      state => { state.task.maxAgents = 0 },
      state => { state.task.assignedAt = '01' },
      state => { state.recentEvents[0].redacted = null },
      state => { state.recentEvents[0].actorType = 'human' },
      state => { state.members.push(structuredClone(state.members[0])) },
      state => { state.recentArtifactsTruncated = true }
    ]) {
      const invalid = snapshot(); mutate(invalid)
      assert.equal(validateTaskWorkspaceSnapshot(invalid), null)
    }
  })

  it('treats duplicate and out-of-order records as durable duplicates but gaps as resync', () => {
    const before = snapshot()
    assert.equal(applyTaskWorkspaceEvent(before, { ...progress(), version: '0' }).kind, 'resync')
    assert.equal(applyTaskWorkspaceEvent(before, progress(V)).kind, 'duplicate')
    assert.equal(applyTaskWorkspaceEvent(before, progress(nextTaskEventVersion(NEXT))).kind, 'resync')
    assert.equal(applyTaskWorkspaceEvent(before, progress('1')).kind, 'duplicate')
  })

  it('caps retry jitter and aborts superseded snapshot requests through the caller signal', async () => {
    const delays = []; const first = deferred(); let signal
    const api = { execute: options => {
      if (options.url.endsWith('/workspace')) { signal ??= options.signal; return signal === options.signal ? first.promise : Promise.reject(new Error('network')) }
      return new Promise(() => {})
    } }
    const instance = useTaskWorkspace({ agentApi: api, documentRef: new FakeDocument(), windowRef: new EventTarget(), jitter: () => 1, retryBaseMs: 100, retryCapMs: 150, setTimeoutFn: (callback, delay) => { delays.push(delay); return delays.length }, clearTimeoutFn: () => {}, snapshotTimeoutMs: 0 })
    const opening = instance.open({ taskId: 'task-a', actorAgentId: 'agent-a' })
    await instance.open({ taskId: 'task-b', actorAgentId: 'agent-b' })
    assert.equal(signal.aborted, true)
    first.resolve({ data: { data: snapshot() } })
    await opening
    await Promise.resolve()
    assert.equal(delays[0], 150)
    instance.dispose()
  })
})
