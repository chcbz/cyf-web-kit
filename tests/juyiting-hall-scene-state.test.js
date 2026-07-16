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
})
