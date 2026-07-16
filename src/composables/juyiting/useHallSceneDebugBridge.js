import { watch } from 'vue'

export const useHallSceneDebugBridge = ({ backend, commandQueue, game }) => {
  if (!backend || !commandQueue || !game) throw new TypeError('Scene debug bridge dependencies are required')

  const stopBackend = watch([
    backend.snapshotReady,
    backend.sceneVersion,
    backend.sseConnected,
    backend.lastEventAt,
    backend.resyncCount,
    backend.degraded,
    backend.warnings
  ], () => {
    game.updateBackendSceneDebug?.({
      snapshotReady: backend.snapshotReady.value,
      sceneVersion: backend.sceneVersion.value,
      sseConnected: backend.sseConnected.value,
      lastEventAt: backend.lastEventAt.value,
      resyncCount: backend.resyncCount.value,
      degraded: backend.degraded.value,
      warnings: backend.warnings.value
    })
  }, { immediate: true, deep: true })

  const stopSimulation = watch(commandQueue.pendingCount, value => {
    game.updateSimulationDebug?.({ queuedCommandCount: value })
  }, { immediate: true })

  return () => {
    stopBackend()
    stopSimulation()
  }
}
