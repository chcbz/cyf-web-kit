import { expect } from 'chai'
import { readFileSync } from 'node:fs'

import { JuyitingGame } from '../src/game/JuyitingGame.js'
import { personaSpriteResourceName } from '../src/game/resources.js'

const HALL_XML = readFileSync('public/juyiting/hall.tmx', 'utf8')
const SONGJIANG_RESOURCE = personaSpriteResourceName('songjiang')

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

const nextLoadBatch = async fake => {
  for (let turn = 0; turn < 50 && fake.pendingLoads.length === 0; turn += 1) await Promise.resolve()
  expect(fake.pendingLoads.length, 'expected a runtime resource batch').to.be.greaterThan(0)
  return fake.pendingLoads.splice(0)
}

const succeedBatch = (fake, batch) => {
  batch.forEach(({ resource, onload }) => {
    if (resource.type === 'image') {
      fake.images.set(resource.name, resource.name === SONGJIANG_RESOURCE
        ? { width: 1024, height: 256 }
        : { width: 16, height: 16 })
    }
    onload()
  })
}

const mountThroughBaseResources = async (game, fake) => {
  const mountPromise = game.mount({ querySelector: () => null })
  const bootBatch = await nextLoadBatch(fake)
  expect(bootBatch.map(item => item.resource.name)).to.deep.equal(['juyiting-hall'])
  succeedBatch(fake, bootBatch)

  const baseBatch = await nextLoadBatch(fake)
  expect(baseBatch.map(item => item.resource.name)).not.to.include(SONGJIANG_RESOURCE)
  succeedBatch(fake, baseBatch)
  expect(game._mapData).not.to.equal(null)
  return { mountPromise }
}

describe('JuyitingGame sprite lifecycle', () => {
  it('keeps the map ready and degraded when a required sprite fails', async () => {
    const fake = createRuntimeMelon()
    const game = new JuyitingGame()
    game._me = fake.me
    const { mountPromise } = await mountThroughBaseResources(game, fake)

    const spriteBatch = await nextLoadBatch(fake)
    expect(spriteBatch.map(item => item.resource.name)).to.deep.equal([SONGJIANG_RESOURCE])
    spriteBatch[0].onerror(new Error('sprite CDN unavailable'))

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

  it('makes Songjiang available only after the dedicated sprite load succeeds', async () => {
    const fake = createRuntimeMelon()
    const game = new JuyitingGame()
    game._me = fake.me
    const { mountPromise } = await mountThroughBaseResources(game, fake)

    const spriteBatch = await nextLoadBatch(fake)
    expect(spriteBatch.map(item => item.resource.name)).to.deep.equal([SONGJIANG_RESOURCE])
    succeedBatch(fake, spriteBatch)

    await mountPromise
    const outcome = game.getSpriteLoadSnapshot()
    expect(outcome.degraded).to.equal(false)
    expect(outcome.available.has('songjiang')).to.equal(true)
    expect(fake.stateSets).to.have.length(1)

    game.syncAgents([{ agentId: 'songjiang', personaCode: 'songjiang', name: 'Song Jiang', x: 50, y: 50 }])
    game._hallScene._fullSyncAgents()
    expect(game._hallScene.getAgent('songjiang')).to.exist
    expect(fake.worldChildren).to.have.length(1)
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
    expect(spriteBatch.map(item => item.resource.name)).to.deep.equal([SONGJIANG_RESOURCE])
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
