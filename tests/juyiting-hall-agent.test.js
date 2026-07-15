import { expect } from 'chai'

import { createHallAgentClass } from '../src/game/entities/HallAgent.js'

const createFakeMelon = ({
  bodyHasSetVelocity = true,
  spriteHasRenderable = true,
  spriteHasScaleMethod = false,
  spriteImage = { width: 1024, height: 256 }
} = {}) => {
  class Sprite {
    constructor(x, y, settings = {}) {
      this.pos = { x, y }
      this.width = settings.framewidth || settings.image?.width || 100
      this.height = settings.frameheight || settings.image?.height || 100
      if (spriteHasRenderable) {
        this.renderable = {
          animations: {},
          addAnimation: (name, frames, delay) => {
            this.renderable.animations[name] = { frames, delay }
          },
          setCurrentAnimation: () => {},
          flipX: (on) => { this.flipped = on },
          tint: null
        }
      }
      this.anchorPoint = { set: () => {} }
      if (!spriteHasScaleMethod) this.scale = 1
      this.appliedScale = 1
      this.tint = null
    }

    scale(value) {
      this.appliedScale *= value
    }

    update() { return true }
    draw() {}
    addAnimation() {}
    setCurrentAnimation() {}
    flipX(on) { this.flipped = on }
  }

  class Body {
    constructor() {
      this.velocity = { x: 0, y: 0 }
    }

    setVelocity(x, y) {
      if (!bodyHasSetVelocity) {
        throw new TypeError('this.body.setVelocity is not a function')
      }
      this.velocity = { x, y }
    }
  }

  if (!bodyHasSetVelocity) {
    delete Body.prototype.setVelocity
  }

  class Color {
    constructor(r, g, b, a) {
      this.r = r
      this.g = g
      this.b = b
      this.a = a
    }
  }

  return {
    Body,
    Color,
    Sprite,
    game: { viewport: { width: 1000, height: 1000 } },
    loader: {
      getImage: () => spriteImage
    },
    video: { renderer: null }
  }
}

describe('HallAgent melonJS entity', () => {
  it('syncs scene state into animation, selection, facing, bubble, and hitbox behavior', () => {
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: '林冲',
      x: 50,
      y: 60
    })

    agent.syncState({
      destination: { x: 62, y: 72 },
      sceneStatus: 'talk',
      bubble: { text: '收到传令', ttlMs: 1200 },
      selected: true,
      focused: true,
      facing: 'left'
    })

    expect(agent.targetX).to.equal(620)
    expect(agent.targetY).to.equal(720)
    expect(agent.currentAnim).to.equal('idle')
    expect(agent._bubbleText).to.equal('收到传令')
    expect(agent._selected).to.equal(true)
    expect(agent._focused).to.equal(true)
    expect(agent.renderable.tint).to.include({ a: 0.35 })
    expect(agent.flipped).to.equal(true)
    expect(agent.containsPoint(agent.pos.x, agent.pos.y - 20)).to.equal(true)
    expect(agent.containsPoint(agent.pos.x + 1000, agent.pos.y + 1000)).to.equal(false)
  })

  it('uses direct body velocity assignment when melonJS Body has no setVelocity helper', () => {
    const me = createFakeMelon({ bodyHasSetVelocity: false })
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: '瀹嬫睙',
      x: 50,
      y: 50
    })

    agent.syncState({ destination: { x: 60, y: 50 } })
    agent.update(16)

    expect(agent.body.velocity.x).to.be.greaterThan(0)
    expect(agent.body.velocity.y).to.equal(0)
  })

  it('registers manifest-defined Songjiang idle and walking cycles', () => {
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: 'Song Jiang',
      x: 50,
      y: 50
    })

    expect(agent.width).to.equal(128)
    expect(agent.height).to.equal(128)
    expect(agent.renderable.animations.idle.frames).to.deep.equal([0, 1, 2, 3])
    expect(agent.renderable.animations.walk.frames).to.have.length(8)
    expect(agent.renderable.animations.walk.frames).to.deep.equal([
      8, 9, 10, 11, 12, 13, 14, 15
    ])
    expect(agent.renderable.animations).not.to.have.property('busy')
  })

  it('keeps hall agents kinematic so melonJS broadphase does not recurse into sprites', () => {
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: 'Song Jiang',
      x: 50,
      y: 50
    })

    expect(agent.body).to.exist
    expect(agent.isKinematic).to.equal(true)
  })

  it('applies scene depth scale from synced agent data', () => {
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: '扈三娘',
      scale: 0.62,
      x: 50,
      y: 50
    })

    expect(agent.scale).to.be.closeTo(0.62, 0.001)

    agent.syncState({ scale: 0.7 })

    expect(agent.scale).to.be.closeTo(0.7, 0.001)
  })

  it('applies melonJS render scale without replacing the scale method', () => {
    const me = createFakeMelon({ spriteHasScaleMethod: true })
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: '宋江',
      scale: 0.52,
      x: 50,
      y: 50
    })

    expect(agent.scale).to.be.a('function')
    expect(agent._renderScale).to.be.closeTo(0.52, 0.001)
    expect(agent.appliedScale).to.be.closeTo(0.52, 0.001)

    agent.syncState({ scale: 0.65 })

    expect(agent.scale).to.be.a('function')
    expect(agent._renderScale).to.be.closeTo(0.65, 0.001)
    expect(agent.appliedScale).to.be.closeTo(0.65, 0.001)
  })

  it('keeps synced destinations inside the agent walkable region', () => {
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: '李逵',
      x: 5,
      y: 5,
      walkableRegion: {
        walkable: [
          { x: 40, y: 70 },
          { x: 60, y: 70 },
          { x: 60, y: 85 },
          { x: 40, y: 85 }
        ]
      }
    })

    expect(agent.pos.x).to.be.within(400, 600)
    expect(agent.pos.y).to.be.within(700, 850)

    agent.syncState({ destination: { x: 90, y: 10 } })

    expect(agent.targetX).to.be.within(400, 600)
    expect(agent.targetY).to.be.within(700, 850)
  })

  it('advances through an autonomous patrol route without an external destination command', () => {
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: 'Wu Yong',
      x: 45,
      y: 60,
      patrolRoute: [
        { x: 45, y: 60 },
        { x: 55, y: 60 },
        { x: 52, y: 66 }
      ],
      patrolDelayMs: 0
    })

    agent.update(16)

    expect(agent.targetX).to.equal(550)
    expect(agent.targetY).to.equal(600)
    expect(agent.currentAnim).to.equal('walk')

    agent.pos.x = agent.targetX
    agent.pos.y = agent.targetY
    agent.update(16)

    expect(agent.targetX).to.equal(520)
    expect(agent.targetY).to.equal(660)
  })

  it('uses the sprite itself for animation, flipping, and tint when no renderable child exists', () => {
    const me = createFakeMelon({ spriteHasRenderable: false })
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: '姝︽澗',
      x: 50,
      y: 50
    })

    agent.syncState({ selected: true, facing: 'left' })

    expect(agent.tint).to.include({ a: 0.35 })
    expect(agent.flipped).to.equal(true)
  })

  it('returns no entity for an unknown persona or an unavailable sprite image', () => {
    const availableClass = createHallAgentClass(createFakeMelon())
    expect(availableClass.create({ personaCode: 'unknown-persona' })).to.equal(null)

    const missingClass = createHallAgentClass(createFakeMelon({ spriteImage: null }))
    expect(missingClass.create({ personaCode: 'songjiang' })).to.equal(null)
  })
})
