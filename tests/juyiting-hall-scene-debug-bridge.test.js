import { expect } from 'chai'
import { nextTick, ref } from 'vue'

import { useHallSceneDebugBridge } from '../src/composables/juyiting/useHallSceneDebugBridge.js'
import { JuyitingGame } from '../src/game/JuyitingGame.js'

describe('hall scene debug bridge', () => {
  it('publishes live snapshot and SSE status with exact versions and no event payloads', async () => {
    const backend = {
      snapshotReady: ref(false),
      sceneVersion: ref(0),
      sseConnected: ref(false),
      lastEventAt: ref(null),
      resyncCount: ref(0),
      degraded: ref(false),
      warnings: ref([]),
      lastEvent: ref({ rawResponse: 'private-model-response', chatContent: 'private-chat' })
    }
    const commandQueue = { pendingCount: ref(0) }
    const game = new JuyitingGame()
    const bridge = useHallSceneDebugBridge({ backend, commandQueue, game })

    backend.snapshotReady.value = true
    backend.sceneVersion.value = '9223372036854775807'
    backend.sseConnected.value = true
    backend.lastEventAt.value = 1234
    backend.resyncCount.value = 2
    commandQueue.pendingCount.value = 3
    await nextTick()

    const debug = game.getSceneDebugSnapshot()
    expect(debug.backend).to.deep.equal({
      snapshotReady: true,
      sceneVersion: '9223372036854775807',
      sseConnected: true,
      lastEventAt: 1234,
      resyncCount: 2
    })
    expect(debug.simulation.queuedCommandCount).to.equal(3)
    expect(JSON.stringify(debug)).not.to.match(/private|chatContent|rawResponse|model-response/i)

    bridge.stop()
    game.destroy()
  })

  it('force republishes unchanged backend status after destroy and same-version restart', () => {
    const target = global.window || globalThis
    const originalRequest = target.requestAnimationFrame
    const originalCancel = target.cancelAnimationFrame
    const callbacks = []
    target.requestAnimationFrame = callback => {
      callbacks.push(callback)
      return callbacks.length
    }
    target.cancelAnimationFrame = () => {}
    const backend = {
      snapshotReady: ref(true),
      sceneVersion: ref('9223372036854775807'),
      sseConnected: ref(true),
      lastEventAt: ref(1234),
      resyncCount: ref(2),
      degraded: ref(false),
      warnings: ref([])
    }
    const commandQueue = { pendingCount: ref(3) }
    const game = new JuyitingGame()
    const bridge = useHallSceneDebugBridge({ backend, commandQueue, game })

    try {
      callbacks.shift()?.()
      expect(target.__JYTING_SCENE_DEBUG__.backend.sceneVersion)
        .to.equal('9223372036854775807')

      game.destroy()
      expect(target).not.to.have.property('__JYTING_SCENE_DEBUG__')

      bridge.republish()
      callbacks.shift()?.()

      expect(target.__JYTING_SCENE_DEBUG__.backend).to.deep.equal({
        snapshotReady: true,
        sceneVersion: '9223372036854775807',
        sseConnected: true,
        lastEventAt: 1234,
        resyncCount: 2
      })
      expect(target.__JYTING_SCENE_DEBUG__.simulation.queuedCommandCount).to.equal(3)
    } finally {
      bridge.stop()
      game.destroy()
      target.requestAnimationFrame = originalRequest
      target.cancelAnimationFrame = originalCancel
    }
  })
})
