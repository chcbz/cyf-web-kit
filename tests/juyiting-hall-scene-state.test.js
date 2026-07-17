import { expect } from 'chai'
import { ref } from 'vue'

import { useHallCommandQueue } from '../src/composables/juyiting/useHallCommandQueue.js'
import { useHallData } from '../src/composables/juyiting/useHallData.js'
import { useHallScene } from '../src/composables/juyiting/useHallScene.js'
import { useHallSceneState } from '../src/composables/juyiting/useHallSceneState.js'

const runtimeMap = () => ({
  sceneId: 'juyiting-main',
  movementSchemaVersion: '1',
  navGraphVersion: 'graph-v1',
  spriteManifestVersion: 'sprites-v1',
  width: 400,
  height: 300,
  regions: [
    { stableId: 'main', regionId: 'main-seat', polygon: { points: [] }, label: 'Main', capacity: 1, protected: true, riskLevel: 'low' },
    { stableId: 'council', regionId: 'council-table', polygon: { points: [] }, label: 'Council', capacity: 4, protected: false, riskLevel: 'low' }
  ],
  nodes: [],
  edges: [],
  obstacles: [],
  slots: [{
    stableId: 'home-songjiang', slotId: 'home-songjiang', regionId: 'main-seat',
    point: { x: 20, y: 20 }, personaCode: 'songjiang', kind: 'home'
  }]
})

const backendState = (stateVersion, overrides = {}) => ({
  agentId: 'agent-songjiang',
  personaCode: 'songjiang',
  behavior: 'moving_to_discussion',
  targetRegionId: 'council-table',
  stateVersion,
  startedAt: 1000,
  expectedArrivalAt: 5000,
  phase: 'moving',
  x: 999,
  y: 888,
  path: [{ x: 1, y: 2 }],
  coordinates: { secret: true },
  ...overrides
})

describe('hall scene state', () => {
  it('adapts snapshot and newer event semantics into coordinate-free backend commands', () => {
    const enqueued = []
    const commandQueue = useHallCommandQueue()
    commandQueue.setSimulation({ enqueue: command => enqueued.push(command) })
    const sceneState = useHallSceneState({ commandQueue, now: () => 2000 })
    sceneState.setMapRuntime(runtimeMap())

    sceneState.applySnapshot({
      sceneId: 'juyiting-main', sceneVersion: 16,
      states: [backendState(16)]
    })
    sceneState.applyEvent({
      sceneVersion: 17,
      eventType: 'agent-scene-state-updated',
      state: backendState(17, { behavior: 'moving_to_task' })
    })
    sceneState.applyEvent({ sceneVersion: 17, state: backendState(17) })

    expect(enqueued[0]).to.include({
      type: 'MOVE_TO_REGION', targetRegionId: 'council-table', stateVersion: 16,
      source: 'backend'
    })
    expect(enqueued.at(-1).stateVersion).to.equal(17)
    expect(enqueued).to.have.length(2)
    enqueued.forEach(command => {
      expect(command).not.to.have.any.keys('x', 'y', 'path', 'coordinates', 'frame')
    })
  })

  it('buffers only the latest command until both map and simulation are ready', () => {
    const enqueued = []
    const commandQueue = useHallCommandQueue()
    const sceneState = useHallSceneState({ commandQueue, now: () => 2000 })

    sceneState.applySnapshot({ sceneId: 'juyiting-main', sceneVersion: 5, states: [backendState(5)] })
    sceneState.applyEvent({ sceneVersion: 6, state: backendState(6) })
    expect(enqueued).to.deep.equal([])

    sceneState.setMapRuntime(runtimeMap())
    expect(enqueued).to.deep.equal([])
    commandQueue.setSimulation({ enqueue: command => enqueued.push(command) })

    expect(enqueued).to.have.length(1)
    expect(enqueued[0].stateVersion).to.equal(6)
    expect(commandQueue.pendingCount.value).to.equal(0)
  })

  it('detaches a replaced engine and accepts a fresh same-version authoritative snapshot', () => {
    const firstEngine = []
    const replacementEngine = []
    const commandQueue = useHallCommandQueue()
    const sceneState = useHallSceneState({ commandQueue, now: () => 2000 })
    const snapshot = {
      sceneId: 'juyiting-main', sceneVersion: 16, states: [backendState(16)]
    }

    sceneState.setMapRuntime(runtimeMap())
    commandQueue.setSimulation({ enqueue: command => {
      firstEngine.push(command)
      return { accepted: true }
    } })
    sceneState.applySnapshot(snapshot)

    commandQueue.setSimulation(null)
    sceneState.reset()
    sceneState.setMapRuntime(runtimeMap())
    commandQueue.setSimulation({ enqueue: command => {
      replacementEngine.push(command)
      return { accepted: true }
    } })
    const result = sceneState.applySnapshot(snapshot)

    expect(firstEngine).to.have.length(1)
    expect(result.accepted).to.equal(true)
    expect(replacementEngine).to.have.length(1)
    expect(replacementEngine[0]).to.include({ agentId: 'agent-songjiang', stateVersion: 16 })
  })

  it('forwards simulation phases as the backend allowlist with epoch milliseconds', async () => {
    const reports = []
    const sceneState = useHallSceneState({
      commandQueue: useHallCommandQueue(),
      reportPhase: async report => {
        reports.push(report)
        return { result: 'accepted' }
      }
    })

    await sceneState.forwardPhaseEvents([{
      reportId: 'phase-1', agentId: 'agent-songjiang', stateVersion: 8,
      phase: 'arrived', regionId: 'council-table', occurredAt: '1970-01-01T00:00:02.500Z',
      x: 100, path: [{ x: 1, y: 1 }]
    }])

    expect(reports).to.deep.equal([{
      reportId: 'phase-1', agentId: 'agent-songjiang', stateVersion: 8,
      phase: 'arrived', regionId: 'council-table', occurredAt: 2500
    }])
  })

  it('blocks unknown semantic regions without substituting a destination', () => {
    const enqueued = []
    const commandQueue = useHallCommandQueue()
    commandQueue.setSimulation({ enqueue: command => enqueued.push(command) })
    const sceneState = useHallSceneState({ commandQueue })
    sceneState.setMapRuntime(runtimeMap())

    const result = sceneState.applyEvent({
      sceneVersion: 9,
      state: backendState(9, { targetRegionId: 'made-up-region' })
    })

    expect(result).to.deep.include({ accepted: false, reason: 'unknown-region' })
    expect(enqueued).to.deep.equal([])
  })

  it('cancels pending movement and watermarks a newer blocked state', () => {
    const commandQueue = useHallCommandQueue()
    const sceneState = useHallSceneState({ commandQueue })
    sceneState.setMapRuntime(runtimeMap())
    sceneState.applySnapshot({ sceneId: 'juyiting-main', sceneVersion: 1, states: [backendState(1)] })
    expect(commandQueue.pendingCount.value).to.equal(1)

    const blocked = sceneState.applyEvent({
      sceneVersion: 2,
      state: backendState(2, { targetRegionId: 'made-up-region' })
    })
    const stale = sceneState.applyEvent({ sceneVersion: 3, state: backendState(1) })

    expect(blocked).to.deep.include({ accepted: false, reason: 'unknown-region' })
    expect(stale).to.deep.include({ accepted: false, reason: 'stale-agent-state' })
    expect(commandQueue.pendingCount.value).to.equal(0)
    expect(commandQueue.snapshot()).to.deep.equal([])
  })

  it('cancels pending movement and watermarks a newer semantically invalid state', () => {
    const commandQueue = useHallCommandQueue()
    const sceneState = useHallSceneState({ commandQueue })
    sceneState.setMapRuntime(runtimeMap())
    sceneState.applySnapshot({ sceneId: 'juyiting-main', sceneVersion: 1, states: [backendState(1)] })

    const invalid = sceneState.applyEvent({
      sceneVersion: 2,
      state: backendState(2, { behavior: '' })
    })
    const stale = sceneState.applyEvent({ sceneVersion: 3, state: backendState(1) })

    expect(invalid).to.deep.include({ accepted: false, reason: 'invalid-state' })
    expect(stale).to.deep.include({ accepted: false, reason: 'stale-agent-state' })
    expect(commandQueue.pendingCount.value).to.equal(0)
  })

  it('reconciles agents absent from accepted snapshots across pending and buffered commands', () => {
    const wuyongState = version => backendState(version, {
      agentId: 'agent-wuyong', personaCode: 'wuyong'
    })

    const pendingQueue = useHallCommandQueue()
    const pendingState = useHallSceneState({ commandQueue: pendingQueue })
    pendingState.setMapRuntime(runtimeMap())
    pendingState.applySnapshot({
      sceneId: 'juyiting-main', sceneVersion: 5,
      states: [backendState(5), wuyongState(5)]
    })
    pendingState.applySnapshot({
      sceneId: 'juyiting-main', sceneVersion: 6,
      states: [backendState(6)]
    })

    expect(pendingQueue.snapshot().map(command => command.commandId)).to.deep.equal([
      'agent-songjiang:6:target'
    ])

    const bufferedQueue = useHallCommandQueue()
    const bufferedState = useHallSceneState({ commandQueue: bufferedQueue })
    bufferedState.applySnapshot({
      sceneId: 'juyiting-main', sceneVersion: 5,
      states: [backendState(5), wuyongState(5)]
    })
    bufferedState.applySnapshot({
      sceneId: 'juyiting-main', sceneVersion: 6,
      states: [backendState(6)]
    })
    bufferedState.setMapRuntime(runtimeMap())

    expect(bufferedQueue.snapshot().map(command => command.commandId)).to.deep.equal([
      'agent-songjiang:6:target'
    ])
  })

  it('flushes equal-version buffered agents in deterministic code-unit order', () => {
    const enqueued = []
    const commandQueue = useHallCommandQueue()
    commandQueue.setSimulation({ enqueue: command => enqueued.push(command) })
    const sceneState = useHallSceneState({ commandQueue })
    sceneState.applySnapshot({
      sceneId: 'juyiting-main',
      sceneVersion: 4,
      states: [
        backendState(4, { agentId: 'agent-a', personaCode: 'wuyong' }),
        backendState(4, { agentId: 'agent-Z', personaCode: 'linchong' })
      ]
    })

    sceneState.setMapRuntime(runtimeMap())

    expect(enqueued.map(command => command.agentId)).to.deep.equal(['agent-Z', 'agent-a'])
  })

  it('keeps agent map data as display metadata while snapshots remain movement-authoritative', async () => {
    const appliedSnapshots = []
    const agentApi = {
      get: async (url, _params, options) => {
        if (url === '/map') options.onSuccess({ data: [{
          agentId: 'agent-songjiang', personaCode: 'songjiang', status: 'online', x: 321, y: 654
        }] })
      }
    }
    const hallData = useHallData({
      agentApi,
      log: { warn: () => {} },
      normalizeStatus: value => value,
      selectedAgent: ref(null),
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0,
      sceneState: { applySnapshot: value => appliedSnapshots.push(value), applyEvent: () => {} }
    })

    await hallData.loadMapAgents()
    expect(hallData.mapAgents.value[0]).to.include({ x: 321, y: 654 })
    expect(appliedSnapshots).to.have.length(0)

    const snapshot = {
      sceneId: 'juyiting-main', sceneVersion: 12,
      agents: [{ agentId: 'agent-songjiang', personaCode: 'songjiang', status: 'online', x: 999 }],
      states: [backendState(12)]
    }
    hallData.applySceneSnapshot(snapshot)

    expect(appliedSnapshots).to.deep.equal([snapshot])
    expect(hallData.backendSceneAgents.value).to.deep.equal([{
      agentId: 'agent-songjiang', personaCode: 'songjiang', status: 'online'
    }])
    expect(hallData.backendSceneVersion.value).to.equal(12)
  })

  it('rejects stale snapshots before mutating backend scene metadata', () => {
    const appliedSnapshots = []
    const hallData = useHallData({
      agentApi: {},
      log: { warn: () => {} },
      normalizeStatus: value => value,
      selectedAgent: ref(null),
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0,
      sceneState: {
        applySnapshot: snapshot => {
          appliedSnapshots.push(snapshot)
          return { accepted: true }
        },
        applyEvent: () => {}
      }
    })
    const current = {
      sceneId: 'juyiting-main', sceneVersion: 12,
      agents: [{ agentId: 'agent-songjiang', personaCode: 'songjiang', status: 'online' }],
      states: [backendState(12)]
    }
    const stale = {
      sceneId: 'juyiting-main', sceneVersion: 11,
      agents: [{ agentId: 'agent-wuyong', personaCode: 'wuyong', status: 'busy' }],
      states: [backendState(11, { agentId: 'agent-wuyong', personaCode: 'wuyong' })]
    }

    expect(hallData.applySceneSnapshot(current)).to.equal(true)
    expect(hallData.applySceneSnapshot(stale)).to.equal(false)

    expect(hallData.backendSceneVersion.value).to.equal(12)
    expect(hallData.backendSceneAgents.value).to.deep.equal([{
      agentId: 'agent-songjiang', personaCode: 'songjiang', status: 'online'
    }])
    expect(appliedSnapshots).to.deep.equal([current])
  })

  it('disables synthetic Songjiang patrol movement only while simulation is enabled', () => {
    const mapAgents = ref([
      { agentId: 'agent-songjiang', personaCode: 'songjiang', name: 'Songjiang', status: 'online' },
      { agentId: 'linchong', personaCode: 'linchong', name: 'Lin Chong', status: 'online' }
    ])
    const enabled = useHallScene({
      mapAgents, selectedAgent: ref(null), selectedTask: ref(null),
      simulationEnabled: true
    })
    enabled.markTaskAssigned({ title: 'Council order' }, mapAgents.value)
    const enabledSongjiang = enabled.sceneAgents.value.find(agent => agent.personaCode === 'songjiang')
    const enabledLinchong = enabled.sceneAgents.value.find(agent => agent.personaCode === 'linchong')

    expect(enabledSongjiang.patrolRoute).to.deep.equal([])
    expect(enabledSongjiang.destination).to.equal(undefined)
    expect(enabledSongjiang.simulationControlled).to.equal(true)
    expect(enabledSongjiang).to.include({ regionId: 'mainSeat', x: 50, y: 45 })
    expect(enabledLinchong.patrolRoute).to.have.length.greaterThan(2)

    const rollback = useHallScene({
      mapAgents, selectedAgent: ref(null), selectedTask: ref(null),
      simulationEnabled: false
    })
    expect(rollback.sceneAgents.value.find(agent => agent.personaCode === 'songjiang').patrolRoute)
      .to.have.length.greaterThan(2)
  })

  it('does not sample or retain a synthetic task destination for simulation-controlled Songjiang', () => {
    const sampledRegions = []
    const hallScene = useHallScene({
      mapAgents: ref([{
        agentId: 'agent-songjiang', personaCode: 'songjiang', name: 'Songjiang', status: 'online'
      }]),
      selectedAgent: ref(null),
      selectedTask: ref(null),
      simulationEnabled: true,
      sampleMovementPoint: region => {
        sampledRegions.push(region.id)
        return { x: 99, y: 99 }
      }
    })

    hallScene.markTaskAssigned({ title: 'Council order' }, ['agent-songjiang'])

    expect(sampledRegions).to.deep.equal([])
    expect(hallScene.sceneAgents.value.find(agent => agent.personaCode === 'songjiang')).to.include({
      regionId: 'mainSeat',
      x: 50,
      y: 45,
      facing: 'right',
      prominentMotion: false,
      sceneStatus: 'busy',
      focused: true
    })
  })

  it('does not sample or retain a synthetic discussion destination for simulation-controlled Songjiang', () => {
    const sampledRegions = []
    const hallScene = useHallScene({
      mapAgents: ref([{
        agentId: 'agent-songjiang', personaCode: 'songjiang', name: 'Songjiang', status: 'online'
      }]),
      selectedAgent: ref(null),
      selectedTask: ref(null),
      simulationEnabled: true,
      sampleMovementPoint: region => {
        sampledRegions.push(region.id)
        return { x: 99, y: 99 }
      }
    })

    hallScene.markDiscussionStarted({ title: 'Council order' }, ['agent-songjiang'])

    expect(sampledRegions).to.deep.equal([])
    expect(hallScene.sceneAgents.value.find(agent => agent.personaCode === 'songjiang')).to.include({
      regionId: 'mainSeat',
      x: 50,
      y: 45,
      facing: 'right',
      prominentMotion: false,
      sceneStatus: 'discuss',
      focused: true
    })
  })

  it('cancels active movement for blocked states and agents absent from authoritative snapshots', () => {
    const enqueued = []
    const cancelled = []
    const commandQueue = useHallCommandQueue()
    commandQueue.setSimulation({
      enqueue: command => {
        enqueued.push(command)
        return { accepted: true }
      },
      cancel: (agentId, stateVersion) => {
        cancelled.push({ agentId, stateVersion })
        return true
      }
    })
    const sceneState = useHallSceneState({ commandQueue })
    sceneState.setMapRuntime(runtimeMap())
    sceneState.applyEvent({ sceneVersion: 1, state: backendState(1) })
    sceneState.applyEvent({
      sceneVersion: 2,
      state: backendState(2, { targetRegionId: 'missing-region' })
    })
    sceneState.applyEvent({ sceneVersion: 3, state: backendState(3) })
    sceneState.applySnapshot({ sceneId: 'juyiting-main', sceneVersion: 4, states: [] })

    expect(enqueued.map(command => command.stateVersion)).to.deep.equal([1, 3])
    expect(cancelled).to.deep.equal([
      { agentId: 'agent-songjiang', stateVersion: 2 },
      { agentId: 'agent-songjiang', stateVersion: 3 }
    ])
  })

  it('delivers buffered commands in the same queue order for either readiness sequence', () => {
    const run = simulationFirst => {
      const delivered = []
      const commandQueue = useHallCommandQueue()
      const sceneState = useHallSceneState({ commandQueue })
      sceneState.applySnapshot({
        sceneId: 'juyiting-main', sceneVersion: 9,
        states: [
          backendState(2, { agentId: 'agent-a', personaCode: 'wuyong' }),
          backendState(8, { agentId: 'agent-z', personaCode: 'linchong' })
        ]
      })
      const simulation = { enqueue: command => {
        delivered.push(command.commandId)
        return { accepted: true }
      } }
      if (simulationFirst) {
        commandQueue.setSimulation(simulation)
        sceneState.setMapRuntime(runtimeMap())
      } else {
        sceneState.setMapRuntime(runtimeMap())
        commandQueue.setSimulation(simulation)
      }
      return delivered
    }

    expect(run(true)).to.deep.equal(['agent-z:8:target', 'agent-a:2:target'])
    expect(run(false)).to.deep.equal(run(true))
  })

  it('rejects equal blocked state versions without reviving movement', () => {
    const enqueued = []
    const commandQueue = useHallCommandQueue()
    commandQueue.setSimulation({
      enqueue: command => {
        enqueued.push(command)
        return { accepted: true }
      },
      cancel: () => true
    })
    const sceneState = useHallSceneState({ commandQueue })
    sceneState.setMapRuntime(runtimeMap())

    sceneState.applyEvent({
      sceneVersion: 1,
      state: backendState(5, { targetRegionId: 'missing-region' })
    })
    const duplicate = sceneState.applyEvent({ sceneVersion: 2, state: backendState(5) })

    expect(duplicate).to.deep.include({ accepted: false, reason: 'stale-agent-state' })
    expect(enqueued).to.deep.equal([])
  })

  it('preserves exact Java Long scene versions through hall data and scene state', () => {
    const beforeMax = '9223372036854775806'
    const max = '9223372036854775807'
    const commandQueue = useHallCommandQueue()
    const sceneState = useHallSceneState({ commandQueue })
    const hallData = useHallData({
      agentApi: {},
      log: { warn: () => {} },
      normalizeStatus: value => value,
      selectedAgent: ref(null),
      selectedTask: ref(null),
      taskAgentMatchScore: () => 0,
      sceneState
    })

    expect(hallData.applySceneSnapshot({
      sceneId: 'juyiting-main', sceneVersion: beforeMax,
      agents: [], states: [backendState(1)]
    })).to.equal(true)
    expect(hallData.applySceneEvent({
      sceneVersion: max,
      state: backendState(2)
    })).to.equal(true)

    expect(hallData.backendSceneVersion.value).to.equal(max)
    expect(sceneState.sceneVersion.value).to.equal(max)
  })

  it('validates optional timestamp ordering and cancels active authoritative state', () => {
    const cancelled = []
    const commandQueue = useHallCommandQueue()
    commandQueue.setSimulation({
      enqueue: () => ({ accepted: true }),
      cancel: (agentId, stateVersion) => {
        cancelled.push({ agentId, stateVersion })
        return true
      }
    })
    const sceneState = useHallSceneState({ commandQueue })
    sceneState.setMapRuntime(runtimeMap())
    sceneState.applyEvent({ sceneVersion: 1, state: backendState(1) })

    const invalid = sceneState.applyEvent({
      sceneVersion: 2,
      state: backendState(2, {
        expectedArrivalAt: 900,
        expiresAt: 800
      })
    })

    expect(invalid).to.deep.include({ accepted: false, reason: 'invalid-state' })
    expect(cancelled).to.deep.equal([{ agentId: 'agent-songjiang', stateVersion: 2 }])
  })

  it('clears stale pending movement when authoritative command enqueue is rejected', () => {
    const cleared = []
    const sceneState = useHallSceneState({
      commandQueue: {
        enqueue: () => ({ accepted: false, reason: 'invalid-command' }),
        clearPending: agentId => {
          cleared.push(agentId)
          return 1
        },
        setMapRuntime: () => {}
      }
    })
    sceneState.setMapRuntime(runtimeMap())

    const result = sceneState.applyEvent({ sceneVersion: 1, state: backendState(1) })

    expect(result).to.deep.equal({ accepted: false, reason: 'invalid-command' })
    expect(cleared).to.deep.equal(['agent-songjiang'])
  })
})
