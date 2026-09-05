import { expect } from 'chai'
import { readFileSync } from 'node:fs'

import { JuyitingGame } from '../src/game/JuyitingGame.js'
import { personaSpriteResourceName } from '../src/game/resources.js'
import { PERSONA_SPRITE_MANIFEST } from '../src/game/sprites/personaSpriteManifest.js'

const HALL_XML = readFileSync('public/juyiting/hall.tmx', 'utf8')
const SONGJIANG_RESOURCE = personaSpriteResourceName('songjiang')
const REQUIRED_PERSONA_RESOURCE_NAMES = Object.values(PERSONA_SPRITE_MANIFEST.personas)
  .filter(definition => definition.required)
  .map(definition => personaSpriteResourceName(definition.personaCode))
const DEFERRED_PERSONA_RESOURCE_NAMES = Object.values(PERSONA_SPRITE_MANIFEST.personas)
  .filter(definition => !definition.required)
  .map(definition => personaSpriteResourceName(definition.personaCode))
const PERSONA_BY_RESOURCE = new Map(Object.values(PERSONA_SPRITE_MANIFEST.personas)
  .map(definition => [personaSpriteResourceName(definition.personaCode), definition]))

const createRuntimeMelon = () => {
  const pendingLoads = []
  const images = new Map()
  const worldChildren = []
  const stateSets = []

  class Stage {}
  class Renderable {}
  class Sprite {
    constructor(x, y, settings = {}) {
      this.pos = { x, y }
      this.width = settings.framewidth || settings.image?.width || 0
      this.height = settings.frameheight || settings.image?.height || 0
      this.anchorPoint = { set: (anchorX, anchorY) => { this.anchor = { x: anchorX, y: anchorY } } }
      this.scale = 1
      this.renderable = {
        animations: {},
        addAnimation: (name, frames, delay) => { this.renderable.animations[name] = { frames, delay } },
        setCurrentAnimation: name => { this.renderable.currentAnimation = name },
        flipX: () => {}
      }
    }

    update() { return true }
    draw() {}
  }
  class Body {
    constructor() { this.velocity = { x: 0, y: 0 } }
    setVelocity(x, y) { this.velocity = { x, y } }
  }
  class Color {}

  const me = {
    Body,
    Color,
    Renderable,
    Sprite,
    Stage,
    device: { onReady: callback => callback() },
    game: {
      viewport: { width: 960, height: 640 },
      world: {
        addChild: child => { worldChildren.push(child) },
        removeChild: child => {
          const index = worldChildren.indexOf(child)
          if (index >= 0) worldChildren.splice(index, 1)
        }
      }
    },
    input: {
      registerPointerEvent: () => {},
      releaseAllPointerEvents: () => {}
    },
    loader: {
      getImage: name => images.get(name) || null,
      getTMX: () => HALL_XML,
      load: (resource, onload, onerror) => pendingLoads.push({ resource, onload, onerror })
    },
    state: {
      PLAY: 'PLAY',
      change: () => {},
      pause: () => {},
      set: (...args) => stateSets.push(args)
    },
    video: {
      CANVAS: 'canvas',
      init: () => true,
      renderer: null
    }
  }

  return { images, me, pendingLoads, stateSets, worldChildren }
}

const createSameSlotIgnoringMelon = () => {
  const fake = createRuntimeMelon()
  const stages = new Map()
  const stateChanges = []
  const ignoredChanges = []
  const sceneEntries = []
  let currentState = null

  fake.me.state = {
    USER: 100,
    PLAY: 'PLAY',
    set: (stateId, scene) => {
      fake.stateSets.push([stateId, scene])
      stages.set(stateId, scene)
    },
    change: stateId => {
      if (stateId === currentState) {
        ignoredChanges.push(stateId)
        return
      }
      currentState = stateId
      stateChanges.push(stateId)
      const scene = stages.get(stateId)
      sceneEntries.push(stateId)
      scene?.onResetEvent?.()
    },
    isCurrent: stateId => stateId === currentState,
    pause: () => {}
  }

  return { ...fake, ignoredChanges, sceneEntries, stateChanges }
}

const nextLoadBatch = async (fake, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs
  while (fake.pendingLoads.length === 0 && Date.now() < deadline) {
    // Resource preparation includes WebCrypto and dynamic-module work. Yield to the
    // event loop until a wall-clock deadline instead of assuming a fixed number
    // of microtasks, which is flaky when the complete test suite is CPU-bound.
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(fake.pendingLoads.length, `expected a runtime resource batch within ${timeoutMs}ms`).to.be.greaterThan(0)
  return fake.pendingLoads.splice(0)
}

const succeedBatch = (fake, batch) => {
  batch.forEach(({ resource, onload }) => {
    if (resource.type === 'image') {
      const definition = PERSONA_BY_RESOURCE.get(resource.name)
      fake.images.set(resource.name, definition
        ? { width: definition.image.width, height: definition.image.height }
        : { width: 16, height: 16 })
    }
    onload()
  })
}

const mountThroughBaseResources = async (game, fake) => {
  const mountPromise = game.mount({ querySelector: () => null })
  const bootBatch = await nextLoadBatch(fake)
  expect(bootBatch.map(item => item.resource.name)).to.deep.equal(['liangshan-hall-base-clean-v3'])
  succeedBatch(fake, bootBatch)

  const baseBatch = await nextLoadBatch(fake)
  expect(baseBatch.map(item => item.resource.name)).not.to.include(SONGJIANG_RESOURCE)
  succeedBatch(fake, baseBatch)
  expect(game._mapData).not.to.equal(null)
  return { mountPromise }
}

describe('JuyitingGame sprite lifecycle', () => {
  it('alternates bounded melon state slots across normal and cancelled mount lifecycles', async () => {
    const fake = createSameSlotIgnoringMelon()
    const game = new JuyitingGame()
    let readyCallbacks = 0
    const spriteLoadResult = {
      available: new Set(),
      unavailable: new Set(),
      errors: [],
      degraded: false,
      requiredMissingCount: 0,
      optionalMissingCount: 0
    }
    game._loadMelonJS = async () => {
      game._me = fake.me
      return fake.me
    }
    game._loadResources = async () => {}
    game._prepareMapData = async (_me, mountToken) => {
      if (!game._isCurrentMount(mountToken)) return
      game._mapData = { movementReady: false }
      game._hallScene.prepareRuntime = () => true
      game._hallScene._buildScene = () => {
        game._hallScene._sceneBuilt = true
        game._hallScene._onReady?.()
        return true
      }
    }
    game._loadPersonaSpriteBatch = async () => spriteLoadResult
    game._deferredPersonaSpriteManifest = () => ({ personas: {} })

    const mount = () => game.mount({ querySelector: () => null }, { simulationEnabled: false, onReady: () => { readyCallbacks += 1 } })
    const mountAndEnter = async () => {
      await mount()
      game.start()
      game.destroy()
    }

    try {
      await mountAndEnter()
      await mount()
      game.destroy()
      await mountAndEnter()
      await mountAndEnter()
      await mountAndEnter()

      expect(fake.stateChanges).to.deep.equal([101, 100, 101, 100])
      expect(fake.sceneEntries).to.deep.equal([101, 100, 101, 100])
      expect(readyCallbacks).to.equal(4)
      expect(fake.ignoredChanges).to.deep.equal([])
      expect(fake.stateSets.map(([stateId]) => stateId)).to.deep.equal([101, 100, 100, 101, 100])
    } finally {
      game.destroy()
    }
  })

  it('keeps the map ready and degraded when a required sprite fails', async () => {
    const fake = createRuntimeMelon()
    const game = new JuyitingGame()
    game._me = fake.me
    const { mountPromise } = await mountThroughBaseResources(game, fake)

    const spriteBatch = await nextLoadBatch(fake)
    expect(spriteBatch.map(item => item.resource.name)).to.deep.equal(REQUIRED_PERSONA_RESOURCE_NAMES)
    spriteBatch.forEach(item => {
      if (item.resource.name === SONGJIANG_RESOURCE) item.onerror(new Error('sprite CDN unavailable'))
      else succeedBatch(fake, [item])
    })

    const mountOutcome = await mountPromise
    expect(mountOutcome).to.include({
      ready: true,
      movementReady: true,
      degraded: true,
      requiredMissingCount: 1
    })
    const outcome = game.getSpriteLoadSnapshot()
    expect(outcome.degraded).to.equal(true)
    expect(outcome.available.has('songjiang')).to.equal(false)
    expect(outcome.errors[0]).to.include({
      code: 'REQUIRED_SPRITE_LOAD_FAILED',
      severity: 'degraded',
      source: 'sprites'
    })
    expect(fake.stateSets).to.have.length(1)

    game.syncAgents([{ agentId: 'songjiang', personaCode: 'songjiang', x: 50, y: 50 }])
    game._hallScene._fullSyncAgents()
    expect(game._hallScene.getAgent('songjiang')).to.equal(undefined)
    expect(fake.worldChildren).to.have.length(0)
  })

  it('blocks initialization when movement validation returns a fatal error', async () => {
    const fake = createRuntimeMelon()
    fake.me.loader.getTMX = () => HALL_XML.replace(
      'name="movementSchemaVersion" value="1"',
      'name="movementSchemaVersion" value="999"'
    )
    const game = new JuyitingGame()
    game._me = fake.me
    const mountPromise = game.mount({ querySelector: () => null })
    succeedBatch(fake, await nextLoadBatch(fake))

    let error
    try {
      await mountPromise
    } catch (caught) {
      error = caught
    }
    expect(error).to.include({
      code: 'MOVEMENT_SCHEMA_INVALID',
      severity: 'fatal',
      source: 'map'
    })
    expect(fake.stateSets).to.have.length(0)
    expect(game._initialized).to.equal(false)
  })

  it('preserves the legacy hall when simulation is disabled and movement data is invalid', async () => {
    const fake = createRuntimeMelon()
    fake.me.loader.getTMX = () => HALL_XML.replace(
      'name="movementSchemaVersion" value="1"',
      'name="movementSchemaVersion" value="999"'
    )
    const game = new JuyitingGame()
    game._me = fake.me
    const mountPromise = game.mount(
      { querySelector: () => null },
      { simulationEnabled: false }
    )
    succeedBatch(fake, await nextLoadBatch(fake))
    succeedBatch(fake, await nextLoadBatch(fake))
    succeedBatch(fake, await nextLoadBatch(fake))

    const outcome = await mountPromise

    expect(outcome).to.include({ ready: true, movementReady: false, simulationReady: false })
    expect(fake.stateSets).to.have.length(1)
    expect(game._initialized).to.equal(true)
    expect(game.getMovementRuntime()).to.equal(null)
  })

  it('cleans a fatal partial mount and retries with exactly one clean scene and canvas', async () => {
    const fake = createRuntimeMelon()
    const canvases = []
    const container = {
      querySelector: selector => selector === 'canvas' ? canvases[0] || null : null
    }
    fake.me.video.init = (_width, _height, options) => {
      const canvas = {
        style: {},
        remove: () => {
          const index = canvases.indexOf(canvas)
          if (index >= 0) canvases.splice(index, 1)
        }
      }
      canvases.push(canvas)
      expect(options.parent).to.equal(container)
      return true
    }
    fake.me.video.destroy = () => canvases.slice().forEach(canvas => canvas.remove())

    let attempt = 0
    fake.me.loader.getTMX = () => {
      attempt += 1
      return attempt === 1
        ? HALL_XML.replace('name="movementSchemaVersion" value="1"', 'name="movementSchemaVersion" value="999"')
        : HALL_XML
    }

    const game = new JuyitingGame()
    game._loadMelonJS = async () => fake.me
    const firstMount = game.mount(container, { onReady: () => {} })
    succeedBatch(fake, await nextLoadBatch(fake))

    let fatal
    try { await firstMount } catch (error) { fatal = error }
    expect(fatal).to.include({ code: 'MOVEMENT_SCHEMA_INVALID', severity: 'fatal' })
    expect(canvases).to.have.length(0)
    expect(game._hallScene).to.equal(null)
    expect(game._container).to.equal(null)
    expect(game._callbacks).to.deep.equal({})
    expect(game._me).to.equal(null)
    expect(game._mountToken).to.equal(null)
    expect(game._readyTimer).to.equal(null)

    const retryMount = game.mount(container)
    succeedBatch(fake, await nextLoadBatch(fake))
    succeedBatch(fake, await nextLoadBatch(fake))
    succeedBatch(fake, await nextLoadBatch(fake))
    const outcome = await retryMount

    expect(outcome).to.include({ ready: true, movementReady: true, degraded: false })
    expect(canvases).to.have.length(1)
    expect(fake.stateSets).to.have.length(1)
    expect(game._hallScene).not.to.equal(null)
  })

  it('makes Songjiang available only after the dedicated sprite load succeeds', async () => {
    const fake = createRuntimeMelon()
    const game = new JuyitingGame()
    game._deferredSpriteLoadDelayMs = 0
    game._me = fake.me
    const { mountPromise } = await mountThroughBaseResources(game, fake)

    const spriteBatch = await nextLoadBatch(fake)
    expect(spriteBatch.map(item => item.resource.name)).to.deep.equal(REQUIRED_PERSONA_RESOURCE_NAMES)
    succeedBatch(fake, spriteBatch)

    await mountPromise
    const deferredBatch = await nextLoadBatch(fake)
    expect(deferredBatch.map(item => item.resource.name)).to.deep.equal(DEFERRED_PERSONA_RESOURCE_NAMES)
    const outcome = game.getSpriteLoadSnapshot()
    expect(outcome.degraded).to.equal(false)
    expect(outcome.available.has('songjiang')).to.equal(true)
    expect(outcome.available.has('lujunyi')).to.equal(false)
    expect(fake.stateSets).to.have.length(1)

    game.syncAgents([
      { agentId: 'songjiang', personaCode: 'songjiang', name: 'Song Jiang', x: 50, y: 50 },
      { agentId: 'lujunyi', personaCode: 'lujunyi', name: 'Lu Junyi', x: 55, y: 50 }
    ])
    game._hallScene._fullSyncAgents()
    expect(game._hallScene.getAgent('songjiang')).to.exist
    expect(game._hallScene.getAgent('lujunyi')).to.equal(undefined)
    expect(fake.worldChildren).to.have.length(1)

    succeedBatch(fake, deferredBatch)
    for (let turn = 0; turn < 20 && !game.getSpriteLoadSnapshot()?.available?.has('lujunyi'); turn += 1) {
      await Promise.resolve()
    }
    const merged = game.getSpriteLoadSnapshot()
    expect(merged.available.has('lujunyi')).to.equal(true)
    expect(merged.placeholderCount).to.equal(0)
    game._hallScene._fullSyncAgents()
    expect(game._hallScene.getAgent('lujunyi')).to.exist
  })

  it('discards a late sprite callback after destroy without starting the stale scene', async () => {
    const fake = createRuntimeMelon()
    const game = new JuyitingGame()
    game._me = fake.me
    const { mountPromise } = await mountThroughBaseResources(game, fake)

    const spriteBatch = await nextLoadBatch(fake)
    game.destroy()
    await mountPromise

    expect(game.getSpriteLoadSnapshot()).to.equal(null)
    expect(game._hallScene).to.equal(null)
    expect(fake.stateSets).to.have.length(0)

    succeedBatch(fake, spriteBatch)
    await Promise.resolve()
    expect(fake.stateSets).to.have.length(0)
  })

  it('times out a never-settling sprite request and still starts the map scene', async () => {
    const fake = createRuntimeMelon()
    const game = new JuyitingGame()
    game._spriteLoadTimeoutMs = 15
    game._me = fake.me
    const { mountPromise } = await mountThroughBaseResources(game, fake)

    const spriteBatch = await nextLoadBatch(fake)
    expect(spriteBatch.map(item => item.resource.name)).to.deep.equal(REQUIRED_PERSONA_RESOURCE_NAMES)
    // Deliberately leave the melonJS loader callback pending forever.
    await mountPromise

    const outcome = game.getSpriteLoadSnapshot()
    expect(outcome.degraded).to.equal(true)
    expect(outcome.available.has('songjiang')).to.equal(false)
    expect(outcome.errors[0].retryable).to.equal(true)
    expect(outcome.errors[0].technicalMessage).to.match(/timed out/i)
    expect(fake.stateSets).to.have.length(1)
  })
})
