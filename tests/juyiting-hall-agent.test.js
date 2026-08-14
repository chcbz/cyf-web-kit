import { expect } from 'chai'

import { createHallAgentClass } from '../src/game/entities/HallAgent.js'

const createFakeMelon = ({
  bodyHasSetVelocity = true,
  spriteHasRenderable = true,
  spriteHasScaleMethod = false,
  spriteImage = { width: 1024, height: 1024 }
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
    postDraw() {}
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
    expect(agent.facing).to.equal('left')
    expect(agent.flipped).to.equal(false)
    expect(agent.containsPoint(agent.pos.x, agent.pos.y - 20)).to.equal(true)
    expect(agent.containsPoint(agent.pos.x + 1000, agent.pos.y + 1000)).to.equal(false)
  })

  it('keeps the selection halo in the world postDraw pass and limits world-ui to labels and bubbles', () => {
    const operations = []
    const context = {
      save: () => operations.push(['save']),
      restore: () => operations.push(['restore']),
      beginPath: () => operations.push(['beginPath']),
      ellipse: (...args) => operations.push(['ellipse', ...args]),
      stroke: () => operations.push(['stroke']),
      measureText: text => ({ width: text.length * 8 }),
      fillText: (...args) => operations.push(['fillText', ...args]),
      rect: (...args) => operations.push(['rect', ...args]),
      fill: () => operations.push(['fill'])
    }
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: '宋江',
      scale: 0.5,
      x: 50,
      y: 50
    })
    agent.syncState({ selected: true, bubble: { text: '收到传令', ttlMs: 1200 } })

    agent.draw({ getContext: () => context })
    expect(operations.find(([operation]) => operation === 'ellipse')).to.equal(undefined)

    agent.postDraw({ getContext: () => context })
    const halo = operations.find(([operation]) => operation === 'ellipse')
    expect(halo[1]).to.equal(agent.pos.x)
    expect(halo[2]).to.be.closeTo(agent.pos.y - 0.5, 0.001)
    expect(halo[3]).to.equal(13)
    expect(halo[4]).to.equal(3.5)
    expect(operations.find(([operation]) => operation === 'fillText')).to.equal(undefined)

    operations.length = 0
    agent.drawWorldUi({ getContext: () => context })
    expect(operations.find(([operation]) => operation === 'ellipse')).to.equal(undefined)
    expect(operations.filter(([operation]) => operation === 'fillText').map(([, text]) => text)).to.deep.equal(['宋江', '收到传令'])
  })

  it('uses the sprite transform-scaled bob displacement for independent world-ui', () => {
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const halfScale = new HallAgent({ agentId: 'half', personaCode: 'songjiang', scale: 0.5, x: 50, y: 50 })
    const fullScale = new HallAgent({ agentId: 'full', personaCode: 'songjiang', scale: 1, x: 50, y: 50 })

    halfScale.setAnimState('walk')
    fullScale.setAnimState('walk')
    halfScale._animFrame = 1
    fullScale._animFrame = 1
    halfScale.draw({ getContext: () => ({}) })
    fullScale.draw({ getContext: () => ({}) })

    // melonJS scales the draw coordinates around the anchor, so a raw 2px
    // walking bob renders as 1px at 0.5 scale and 2px at full scale.
    expect(halfScale._lastOverlayBob).to.equal(1)
    expect(fullScale._lastOverlayBob).to.equal(2)
  })

  it('does not draw a halo for highlight-only transient feedback', () => {
    const operations = []
    const context = {
      save: () => operations.push(['save']),
      restore: () => operations.push(['restore']),
      beginPath: () => operations.push(['beginPath']),
      ellipse: (...args) => operations.push(['ellipse', ...args]),
      stroke: () => operations.push(['stroke']),
      measureText: text => ({ width: text.length * 8 }),
      fillText: (...args) => operations.push(['fillText', ...args]),
      rect: (...args) => operations.push(['rect', ...args]),
      fill: () => operations.push(['fill'])
    }
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      scale: 0.5,
      x: 50,
      y: 50
    })

    agent.setHighlighted(true)
    agent.draw({ getContext: () => context })
    agent.postDraw({ getContext: () => context })

    expect(operations.find(([operation]) => operation === 'ellipse')).to.equal(undefined)
  })

  it('does not draw a halo for focused-only transient feedback', () => {
    const operations = []
    const context = {
      save: () => operations.push(['save']),
      restore: () => operations.push(['restore']),
      beginPath: () => operations.push(['beginPath']),
      ellipse: (...args) => operations.push(['ellipse', ...args]),
      stroke: () => operations.push(['stroke']),
      measureText: text => ({ width: text.length * 8 }),
      fillText: (...args) => operations.push(['fillText', ...args]),
      rect: (...args) => operations.push(['rect', ...args]),
      fill: () => operations.push(['fill'])
    }
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      scale: 0.5,
      x: 50,
      y: 50
    })

    agent.syncState({ focused: true })
    agent.draw({ getContext: () => context })
    agent.postDraw({ getContext: () => context })

    expect(operations.find(([operation]) => operation === 'ellipse')).to.equal(undefined)
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

    expect(agent.pos.x).to.be.greaterThan(500)
    expect(agent.body.velocity.x).to.equal(0)
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
    expect(agent.renderable.animations['idle-down'].frames).to.deep.equal([0, 1, 2, 3])
    expect(agent.renderable.animations['walk-down'].frames).to.deep.equal([32, 33, 34, 35])
    expect(agent.renderable.animations['walk-left'].frames).to.deep.equal([56, 57, 58, 59])
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

  it('keeps an in-progress patrol when a display-only sync carries an equivalent route', () => {
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const patrolRoute = [
      { x: 45, y: 60 },
      { x: 55, y: 60 },
      { x: 52, y: 66 }
    ]
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: 'Song Jiang',
      x: 45,
      y: 60,
      facing: 'left',
      patrolRoute,
      patrolDelayMs: 0,
      regionId: 'mainSeat'
    })

    agent.update(16)
    expect(agent._patrolIndex).to.equal(1)
    expect(agent.facing).to.equal('right')
    const targetBeforeSync = { x: agent.targetX, y: agent.targetY }

    agent.syncState({
      patrolRoute: patrolRoute.map(point => ({ ...point })),
      patrolDelayMs: 0,
      regionId: 'mainSeat',
      facing: 'left',
      bubble: { text: '厅中传令', ttlMs: 1200 },
      selected: true
    })

    expect(agent._patrolIndex).to.equal(1)
    expect(agent.targetX).to.equal(targetBeforeSync.x)
    expect(agent.targetY).to.equal(targetBeforeSync.y)
    expect(agent.facing).to.equal('right')
    expect(agent._bubbleText).to.equal('厅中传令')

    agent.update(16)
    expect(agent.pos.x).to.be.greaterThan(450)
    expect(agent.body.velocity.x).to.equal(0)
  })

  it('uses elapsed time and never crosses a patrol target on a slow frame', () => {
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: 'Song Jiang',
      x: 45,
      y: 60,
      patrolRoute: [
        { x: 45, y: 60 },
        { x: 55, y: 60 }
      ],
      patrolDelayMs: 0
    })

    agent.update(1000)
    expect(agent.pos.x).to.equal(546)
    expect(agent.pos.x).to.be.at.most(550)
    expect(agent.targetX).to.equal(550)

    agent.update(1000)
    expect(agent.pos.x).to.equal(550)
    expect(agent.targetX).to.equal(450)

    agent.update(1000)
    expect(agent.pos.x).to.equal(454)
    expect(agent.pos.x).to.be.at.least(450)
    expect(agent.body.velocity).to.deep.equal({ x: 0, y: 0 })
  })

  it('restarts patrol only when its route or explicit revision changes', () => {
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: 'Song Jiang',
      x: 45,
      y: 60,
      patrolRoute: [
        { x: 45, y: 60 },
        { x: 55, y: 60 }
      ],
      regionId: 'mainSeat'
    })

    agent.update(16)
    expect(agent._patrolIndex).to.equal(1)

    agent.syncState({
      patrolRoute: [
        { x: 45, y: 60 },
        { x: 40, y: 60 }
      ],
      regionId: 'mainSeat'
    })

    expect(agent._patrolIndex).to.equal(1)
    expect(agent.targetX).to.equal(400)

    agent.pos.x = 425

    agent.syncState({
      patrolRoute: [
        { x: 45, y: 60 },
        { x: 40, y: 60 }
      ],
      regionId: 'mainSeat',
      patrolRevision: 1
    })

    expect(agent._patrolIndex).to.equal(0)
    expect(agent.targetX).to.equal(450)
  })

  it('stops when a changed patrol plan becomes empty', () => {
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'songjiang',
      personaCode: 'songjiang',
      name: 'Song Jiang',
      x: 45,
      y: 60,
      patrolRoute: [
        { x: 45, y: 60 },
        { x: 55, y: 60 }
      ],
      regionId: 'mainSeat'
    })

    agent.update(16)
    agent.syncState({ patrolRoute: [], regionId: 'mainSeat' })

    expect(agent.targetX).to.equal(agent.pos.x)
    expect(agent.targetY).to.equal(agent.pos.y)
    expect(agent.speed).to.equal(0)
    expect(agent.body.velocity).to.deep.equal({ x: 0, y: 0 })
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
    expect(agent.facing).to.equal('left')
    expect(agent.flipped).to.equal(false)
  })

  it('returns no entity for an unknown persona or an unavailable sprite image', () => {
    const availableClass = createHallAgentClass(createFakeMelon())
    expect(availableClass.create({ personaCode: 'unknown-persona' })).to.equal(null)

    const missingClass = createHallAgentClass(createFakeMelon({ spriteImage: null }))
    expect(missingClass.create({ personaCode: 'songjiang' })).to.equal(null)
  })
})
