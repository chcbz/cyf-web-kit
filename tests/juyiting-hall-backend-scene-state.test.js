import { expect } from 'chai'

import { useHallBackendSceneState } from '../src/composables/juyiting/useHallBackendSceneState.js'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

function snapshot (sceneVersion) {
  return { sceneId: 'juyiting-main', sceneVersion, generatedAt: 1000, agents: [], states: [] }
}

function event (sceneVersion) {
  return {
    sceneVersion,
    eventType: 'agent-scene-state-updated',
    occurredAt: 1200,
    state: { agentId: 'agent-songjiang', personaCode: 'songjiang', stateVersion: sceneVersion }
  }
}

function harness ({ snapshots = [snapshot(128)], sseEnabled = true } = {}) {
  const calls = []
  const streams = []
  const appliedSnapshots = []
  const appliedEvents = []
  const agentApi = {
    execute: async (request) => {
      calls.push(request)
      if (request.method === 'GET') {
        const value = snapshots.shift()
        return { data: { status: 200, data: value } }
      }
      return { data: { status: 200, data: { result: 'accepted' } } }
    }
  }
  const streamFactory = (options) => {
    const stream = {
      ...options,
      closed: false,
      close () {
        this.closed = true
      }
    }
    streams.push(stream)
    options.onOpen?.()
    return stream
  }
  const state = useHallBackendSceneState({
    agentApi,
    streamFactory,
    sseEnabled,
    now: () => 5000,
    onSnapshot: value => appliedSnapshots.push(value),
    onEvent: value => appliedEvents.push(value)
  })
  return { state, calls, streams, appliedSnapshots, appliedEvents, agentApi }
}

describe('backend scene state', () => {
  it('allows a failed initial start to be retried by a manual refresh', async () => {
    let snapshotCalls = 0
    const backend = useHallBackendSceneState({
      agentApi: {
        execute: async ({ url }) => {
          if (!url.endsWith('/snapshot')) throw new Error('unexpected request')
          snapshotCalls += 1
          if (snapshotCalls === 1) throw new Error('temporary snapshot failure')
          return { data: { sceneId: 'juyiting-main', sceneVersion: 7, states: [] } }
        }
      },
      sseEnabled: false,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {}
    })

    let firstError
    try { await backend.start() } catch (error) { firstError = error }
    const recovered = await backend.start()

    expect(firstError?.message).to.equal('temporary snapshot failure')
    expect(snapshotCalls).to.equal(2)
    expect(recovered).to.include({ sceneId: 'juyiting-main', sceneVersion: 7 })
    expect(backend.snapshotReady.value).to.equal(true)
    backend.stop()
  })
  it('loads the REST snapshot and parses resumable complete SSE records once', async () => {
    const { state, calls, streams, appliedEvents } = harness()

    await state.start()

    expect(calls[0]).to.include({
      url: '/agent/scenes/juyiting-main/snapshot',
      method: 'GET'
    })
    expect(streams[0].url).to.equal('/agent/scenes/juyiting-main/events')
    expect(streams[0].params).to.deep.equal({ sinceVersion: 128 })
    expect(streams[0].headers).to.deep.include({ 'Last-Event-ID': '128' })
    const payload = JSON.stringify(event(129))
    streams[0].onChunk(`id: 129\r\nevent: agent-scene-state-updated\r\ndata: ${payload.slice(0, 20)}`)
    streams[0].onChunk(`${payload.slice(20)}\r\ndata:\r\n\r\n`)
    streams[0].onChunk(`id: 129\nevent: agent-scene-state-updated\ndata: ${payload}\n\n`)
    await tick()

    expect(state.snapshotReady.value).to.equal(true)
    expect(state.sseConnected.value).to.equal(true)
    expect(state.sceneVersion.value).to.equal(129)
    expect(state.lastEventAt.value).to.equal(5000)
    expect(appliedEvents).to.have.length(1)
    state.stop()
  })

  it('closes and resynchronizes on a version gap before reopening from the snapshot cursor', async () => {
    const { state, calls, streams, appliedEvents } = harness({
      snapshots: [snapshot(10), snapshot(20)]
    })
    await state.start()

    streams[0].onChunk(`id: 12\nevent: agent-scene-state-updated\ndata: ${JSON.stringify(event(12))}\n\n`)
    await tick()

    expect(streams[0].closed).to.equal(true)
    expect(calls.filter(call => call.method === 'GET')).to.have.length(2)
    expect(state.resyncCount.value).to.equal(1)
    expect(state.sceneVersion.value).to.equal(20)
    expect(appliedEvents).to.have.length(0)
    expect(streams[1].params).to.deep.equal({ sinceVersion: 20 })
    state.stop()
  })

  it('never applies a truncated SSE record when the stream closes', async () => {
    const { state, streams, appliedEvents } = harness()
    await state.start()

    streams[0].onChunk(`id: 129\nevent: agent-scene-state-updated\ndata: ${JSON.stringify(event(129))}`)
    streams[0].onClose()
    await tick()

    expect(state.sceneVersion.value).to.equal(128)
    expect(appliedEvents).to.have.length(0)
    state.stop()
  })

  it('resynchronizes when the server sends resync-required', async () => {
    const { state, streams } = harness({ snapshots: [snapshot(4), snapshot(9)] })
    await state.start()

    streams[0].onChunk('id: 8\nevent: resync-required\ndata: {"sceneVersion":8,"eventType":"resync-required"}\n\n')
    await tick()

    expect(state.resyncCount.value).to.equal(1)
    expect(state.sceneVersion.value).to.equal(9)
    expect(streams[0].closed).to.equal(true)
    state.stop()
  })

  it('polls without SSE, refreshes immediately on focus, and tears lifecycle resources down', async () => {
    const intervalCallbacks = []
    const cleared = []
    const calls = []
    const values = [snapshot(1), snapshot(2), snapshot(3)]
    const state = useHallBackendSceneState({
      agentApi: {
        execute: async request => {
          calls.push(request)
          return { data: { data: values.shift() } }
        }
      },
      sseEnabled: false,
      setIntervalFn: callback => {
        intervalCallbacks.push(callback)
        return 77
      },
      clearIntervalFn: id => cleared.push(id)
    })

    await state.start()
    expect(intervalCallbacks).to.have.length(1)
    await intervalCallbacks[0]()
    window.dispatchEvent(new window.Event('focus'))
    await tick()
    expect(calls).to.have.length(3)
    expect(state.sceneVersion.value).to.equal(3)

    state.stop()
    expect(cleared).to.deep.equal([77])
    expect(state.sseConnected.value).to.equal(false)
    window.dispatchEvent(new window.Event('focus'))
    await tick()
    expect(calls).to.have.length(3)
  })

  it('reconnects a disconnected stream on focus and cancels it on stop', async () => {
    const { state, streams } = harness()
    await state.start()
    streams[0].onClose?.()
    expect(state.sseConnected.value).to.equal(false)

    window.dispatchEvent(new window.Event('focus'))
    await tick()
    expect(streams).to.have.length(2)

    state.stop()
    expect(streams[1].closed).to.equal(true)
  })

  it('uses the authenticated HTTP stream path and aborts its fetch on stop', async () => {
    const calls = []
    const agentApi = {
      execute: async request => {
        calls.push(request)
        if (request.method === 'GET' && request.responseType !== 'stream') {
          return { data: { data: snapshot(3) } }
        }
        request.onStreamOpen?.({ cancel () {} })
        return { data: null }
      }
    }
    const state = useHallBackendSceneState({ agentApi })

    await state.start()
    const streamRequest = calls.find(call => call.responseType === 'stream')
    expect(streamRequest).to.include({
      url: '/agent/scenes/juyiting-main/events',
      method: 'GET',
      needAuth: true,
      streamChunks: true
    })
    expect(streamRequest.signal.aborted).to.equal(false)
    expect(state.sseConnected.value).to.equal(true)

    state.stop()
    expect(streamRequest.signal.aborted).to.equal(true)
  })

  it('retries phase reports after one and two seconds and records a bounded warning', async () => {
    const attempts = []
    const delays = []
    const state = useHallBackendSceneState({
      agentApi: {
        execute: async request => {
          attempts.push(request)
          throw new Error('offline secret detail')
        }
      },
      streamFactory: () => ({ close () {} }),
      setTimeoutFn: (callback, delay) => {
        delays.push(delay)
        queueMicrotask(callback)
        return delays.length
      }
    })

    const result = await state.reportPhase({
      reportId: 'report-1', agentId: 'agent-songjiang', stateVersion: 7,
      phase: 'arrived', regionId: 'council-table', occurredAt: 1234
    })

    expect(result).to.equal(null)
    expect(attempts).to.have.length(3)
    expect(attempts[0]).to.include({
      url: '/agent/scenes/juyiting-main/phases', method: 'POST'
    })
    expect(delays).to.deep.equal([1000, 2000])
    expect(state.warnings.value).to.deep.equal([{
      code: 'PHASE_REPORT_FAILED', message: 'Failed to report scene phase after 3 attempts'
    }])
  })

  it('publishes one frozen allowlisted phase payload with epoch-millisecond time across retries', async () => {
    const attempts = []
    const timers = []
    const source = {
      reportId: 'report-wire', agentId: 'agent-songjiang', stateVersion: 7,
      phase: 'arrived', regionId: 'council-table',
      occurredAt: '2026-07-17T08:00:00.123Z', path: [{ x: 1, y: 2 }], token: 'secret'
    }
    const state = useHallBackendSceneState({
      agentApi: {
        execute: async request => {
          attempts.push(request)
          if (attempts.length < 3) throw new Error('offline')
          return { data: { data: { result: 'accepted' } } }
        }
      },
      setTimeoutFn: callback => {
        timers.push(callback)
        return timers.length
      }
    })

    const resultPromise = state.reportPhase(source)
    await tick()
    source.occurredAt = '2040-01-01T00:00:00.000Z'
    source.regionId = 'mutated-region'
    timers.shift()()
    await tick()
    timers.shift()()
    const result = await resultPromise

    expect(result).to.deep.equal({ result: 'accepted' })
    expect(attempts).to.have.length(3)
    expect(attempts.map(item => item.data)).to.satisfy(values => values.every(value => value === values[0]))
    expect(Object.isFrozen(attempts[0].data)).to.equal(true)
    expect(attempts[0].data).to.deep.equal({
      reportId: 'report-wire', agentId: 'agent-songjiang', stateVersion: 7,
      phase: 'arrived', regionId: 'council-table', occurredAt: 1784275200123
    })
  })

  it('switches a controlled events-disabled response to polling and focus refresh', async () => {
    const calls = []
    const intervals = []
    const values = [snapshot(4), snapshot(5), snapshot(6)]
    const disabled = Object.assign(new Error('disabled'), {
      status: 503, code: 'SCENE_EVENTS_DISABLED'
    })
    const state = useHallBackendSceneState({
      agentApi: {
        execute: async request => {
          calls.push(request)
          if (request.responseType === 'stream') throw disabled
          return { data: { data: values.shift() } }
        }
      },
      setIntervalFn: (callback, delay) => {
        intervals.push({ callback, delay })
        return 91
      }
    })

    await state.start()
    await tick()

    expect(intervals).to.have.length(1)
    expect(intervals[0].delay).to.equal(15000)
    expect(state.sseConnected.value).to.equal(false)
    await intervals[0].callback()
    window.dispatchEvent(new window.Event('focus'))
    await tick()
    expect(calls.filter(call => call.method === 'GET' && call.responseType !== 'stream')).to.have.length(3)
    expect(state.sceneVersion.value).to.equal(6)
    state.stop()
  })

  it('cancels phase retry timers and requests on stop without publishing a warning', async () => {
    const attempts = []
    const timers = new Map()
    const cleared = []
    let timerId = 0
    const state = useHallBackendSceneState({
      agentApi: {
        execute: async request => {
          attempts.push(request)
          if (request.url.endsWith('/snapshot')) return { data: { data: snapshot(1) } }
          throw new Error('offline')
        }
      },
      streamFactory: () => ({ close () {} }),
      setTimeoutFn: callback => {
        timerId += 1
        timers.set(timerId, callback)
        return timerId
      },
      clearTimeoutFn: id => {
        cleared.push(id)
        timers.delete(id)
      }
    })
    await state.start()

    const resultPromise = state.reportPhase({
      reportId: 'report-cancel', agentId: 'agent-songjiang', stateVersion: 7,
      phase: 'blocked', regionId: 'council-table', occurredAt: 1234
    })
    await tick()
    expect(attempts.filter(call => call.method === 'POST')).to.have.length(1)
    state.stop()

    expect(await resultPromise).to.equal(null)
    expect(cleared).to.have.length(1)
    expect(timers.size).to.equal(0)
    expect(attempts.filter(call => call.method === 'POST')).to.have.length(1)
    expect(state.warnings.value).to.deep.equal([])
  })

  it('ignores a snapshot that completes after stop', async () => {
    let resolveSnapshot
    const applied = []
    const state = useHallBackendSceneState({
      agentApi: {
        execute: () => new Promise(resolve => { resolveSnapshot = resolve })
      },
      streamFactory: () => ({ close () {} }),
      onSnapshot: value => applied.push(value)
    })

    const starting = state.start()
    state.stop()
    resolveSnapshot({ data: { data: snapshot(9) } })
    await starting

    expect(state.snapshotReady.value).to.equal(false)
    expect(state.sceneVersion.value).to.equal(0)
    expect(state.latestSnapshot.value).to.equal(null)
    expect(applied).to.deep.equal([])
  })

  it('preserves Java Long snapshot and SSE cursors without Number narrowing', async () => {
    const streams = []
    const beforeMax = '9223372036854775806'
    const max = '9223372036854775807'
    const state = useHallBackendSceneState({
      agentApi: {
        execute: async request => ({ data: request.responseType === 'text'
          ? `{"status":200,"data":{"sceneId":"juyiting-main","sceneVersion":${beforeMax},` +
            '"generatedAt":1000,"agents":[],"states":[]}}'
          : null })
      },
      streamFactory: options => {
        streams.push(options)
        options.onOpen()
        return { close () {} }
      }
    })

    await state.start()
    expect(state.sceneVersion.value).to.equal(beforeMax)
    expect(streams[0].params).to.deep.equal({ sinceVersion: beforeMax })
    expect(streams[0].headers).to.deep.include({ 'Last-Event-ID': beforeMax })

    streams[0].onChunk(`id: ${max}\nevent: agent-scene-state-updated\n` +
      `data: {"sceneVersion":${max},"eventType":"agent-scene-state-updated","state":null}\n\n`)
    expect(state.sceneVersion.value).to.equal(max)
    state.stop()
  })
})

describe('backend scene disposal', () => {
  it('dispose stops timers, aborts requests, unregisters identity cleanup, and is idempotent', async () => {
    const intervals = []
    const cleared = []
    const state = useHallBackendSceneState({
      agentApi: { execute: async () => ({ data: { data: snapshot(1) } }) },
      sseEnabled: false,
      setIntervalFn: callback => { intervals.push(callback); return 17 },
      clearIntervalFn: id => cleared.push(id)
    })
    await state.start()
    state.dispose()
    state.dispose()
    expect(cleared).to.deep.equal([17])
    expect(await state.start()).to.equal(null)
  })
})
