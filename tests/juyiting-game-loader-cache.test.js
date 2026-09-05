import { expect } from 'chai'

import { JuyitingGame } from '../src/game/JuyitingGame.js'

const createControlledImage = ({ complete = false, naturalWidth = 0 } = {}) => {
  const listeners = new Map()
  return {
    complete,
    naturalWidth,
    addEventListener: (type, listener) => {
      const entries = listeners.get(type) || new Set()
      entries.add(listener)
      listeners.set(type, entries)
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
    emit: type => {
      for (const listener of [...(listeners.get(type) || [])]) listener()
    },
    listenerCount: () => [...listeners.values()].reduce((count, entries) => count + entries.size, 0)
  }
}

const expectRejectedWith = async (promise, message) => {
  let error = null
  try {
    await promise
  } catch (caught) {
    error = caught
  }
  expect(error).to.be.instanceOf(Error)
  expect(error.message).to.include(message)
}

const createCacheZeroMelon = () => {
  const images = new Map()
  const tmxs = new Map()
  const loads = []
  return {
    images,
    loads,
    me: {
      loader: {
        getImage: name => images.get(name) || null,
        getTMX: name => tmxs.get(name) || null,
        load: (resource, onload, onerror) => {
          loads.push({ resource, onload, onerror })
          return resource.name.startsWith('first-') ? 1 : 0
        }
      }
    },
    tmxs
  }
}

describe('JuyitingGame cached melonJS loader contract', () => {
  it('settles cache-return-zero TMX and image loads without callbacks while preserving pending, failed, and stale fences', async () => {
    const { images, loads, me, tmxs } = createCacheZeroMelon()
    const game = new JuyitingGame()
    const mountToken = 41
    game._mountToken = mountToken

    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => ({ ok: true, text: async () => '<map />' })
    try {
      const first = game._loadResources(me, [{ name: 'first-image', type: 'image', src: '/first.png' }], mountToken)
      expect(loads).to.have.length(1)
      loads[0].onload()
      await first

      tmxs.set('cached-hall', { name: 'cached-hall' })
      await game._loadResources(me, [{ name: 'cached-hall', type: 'tmx', src: '/hall.tmx' }], mountToken)

      const completed = createControlledImage({ complete: true, naturalWidth: 48 })
      images.set('cached-complete', completed)
      await game._loadResources(me, [{ name: 'cached-complete', type: 'image', src: '/complete.png' }], mountToken)
      expect(completed.listenerCount()).to.equal(0)

      const pending = createControlledImage()
      images.set('cached-pending', pending)
      const pendingResource = game._loadResources(me, [{ name: 'cached-pending', type: 'image', src: '/pending.png' }], mountToken)
      expect(pending.listenerCount()).to.equal(2)
      pending.complete = true
      pending.naturalWidth = 24
      pending.emit('load')
      await pendingResource
      expect(pending.listenerCount()).to.equal(0)

      const failed = createControlledImage({ complete: true, naturalWidth: 0 })
      images.set('cached-failed', failed)
      await game._loadResources(me, [{ name: 'cached-failed', type: 'image', src: '/failed.png' }], mountToken)

      images.set('persona-sprite-cached-complete', completed)
      const sprite = { personaCode: 'cached-complete', src: '/complete.png' }
      expect(await game._loadPersonaSprite(me, sprite, mountToken)).to.equal(completed)

      const pendingSprite = createControlledImage()
      images.set('persona-sprite-cached-pending', pendingSprite)
      const spritePending = game._loadPersonaSprite(me, { personaCode: 'cached-pending', src: '/pending.png' }, mountToken)
      expect(pendingSprite.listenerCount()).to.equal(2)
      pendingSprite.complete = true
      pendingSprite.naturalWidth = 32
      pendingSprite.emit('load')
      expect(await spritePending).to.equal(pendingSprite)
      expect(pendingSprite.listenerCount()).to.equal(0)

      images.set('persona-sprite-cached-failed', failed)
      await expectRejectedWith(
        game._loadPersonaSprite(me, { personaCode: 'cached-failed', src: '/failed.png' }, mountToken),
        'Cached image failed'
      )

      const stale = createControlledImage()
      images.set('persona-sprite-stale', stale)
      const abortController = new AbortController()
      const staleSprite = game._loadPersonaSprite(me, { personaCode: 'stale', src: '/stale.png' }, mountToken, abortController.signal)
      expect(stale.listenerCount()).to.equal(2)
      game._mountToken = mountToken + 1
      stale.complete = true
      stale.naturalWidth = 16
      stale.emit('load')
      await expectRejectedWith(staleSprite, 'mount was cancelled')
      expect(stale.listenerCount()).to.equal(0)

      const mapPending = createControlledImage()
      images.set('destroy-pending', mapPending)
      const destroyedMapLoad = game._loadResources(me, [{ name: 'destroy-pending', type: 'image', src: '/destroy.png' }], mountToken + 1)
      expect(mapPending.listenerCount()).to.equal(2)
      game.destroy()
      await destroyedMapLoad
      expect(mapPending.listenerCount()).to.equal(0)
    } finally {
      game.destroy()
      globalThis.fetch = originalFetch
    }
  })
})
