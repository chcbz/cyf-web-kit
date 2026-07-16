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
      sleep: async delay => delays.push(delay)
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
})
