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
    const stop = useHallSceneDebugBridge({ backend, commandQueue, game })

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

    stop()
    game.destroy()
  })
})
