import { computed, ref } from 'vue'

import { createMovementCommandQueue } from '../../game/simulation/movementCommandQueue.js'

export const useHallCommandQueue = ({ queue = createMovementCommandQueue() } = {}) => {
  const mapReady = ref(false)
  const simulationReady = ref(false)
  const pendingCount = ref(0)
  const ready = computed(() => mapReady.value && simulationReady.value)
  let simulation = null

  const syncPendingCount = () => {
    pendingCount.value = queue.size
  }

  const flush = () => {
    if (!ready.value || !simulation?.enqueue) return []
    const results = []
    while (queue.size > 0) {
      const command = queue.peek()
      if (!command) break
      const result = simulation.enqueue(command)
      queue.shift()
      results.push(result)
    }
    syncPendingCount()
    return results
  }

  const enqueue = (command) => {
    const result = queue.push(command)
    syncPendingCount()
    if (result.accepted) flush()
    return result
  }

  const setMapRuntime = (map) => {
    mapReady.value = Boolean(map)
    flush()
  }

  const setSimulation = (value) => {
    simulation = value?.enqueue ? value : null
    simulationReady.value = Boolean(simulation)
    flush()
  }

  const clearPending = (agentId) => {
    const removed = queue.clearPending(agentId)
    syncPendingCount()
    return removed
  }

  const reset = (agentId) => {
    const removed = queue.reset(agentId)
    syncPendingCount()
    return removed
  }

  return {
    clearPending,
    enqueue,
    flush,
    mapReady,
    pendingCount,
    ready,
    reset,
    setMapRuntime,
    setSimulation,
    simulationReady,
    snapshot: () => queue.snapshot()
  }
}
