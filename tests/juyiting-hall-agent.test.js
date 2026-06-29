import { expect } from 'chai'

import { createHallAgentClass } from '../src/game/entities/HallAgent.js'

const createFakeMelon = () => {
  class Sprite {
    constructor(x, y, settings = {}) {
      this.pos = { x, y }
      this.width = settings.framewidth || settings.image?.width || 100
      this.height = settings.frameheight || settings.image?.height || 100
      this.renderable = {
        addAnimation: () => {},
        setCurrentAnimation: () => {},
        flipX: (on) => { this.flipped = on },
        tint: null
      }
      this.anchorPoint = { set: () => {} }
      this.scale = 1
    }

    update() { return true }
    draw() {}
  }

  class Body {
    constructor() {
      this.velocity = { x: 0, y: 0 }
    }

    setVelocity(x, y) {
      this.velocity = { x, y }
    }
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
      getImage: () => ({ width: 400, height: 300 })
    },
    video: { renderer: null }
  }
}

describe('HallAgent melonJS entity', () => {
  it('syncs scene state into animation, selection, facing, bubble, and hitbox behavior', () => {
    const me = createFakeMelon()
    const HallAgent = createHallAgentClass(me)
    const agent = new HallAgent({
      agentId: 'linchong',
      personaCode: 'linchong',
      name: '林冲',
      x: 50,
      y: 60
    })

    agent.syncState({
      x: 62,
      y: 72,
      sceneStatus: 'talk',
      bubble: { text: '收到传令', ttlMs: 1200 },
      selected: true,
      focused: true,
      facing: 'left'
    })

    expect(agent.targetX).to.equal(620)
    expect(agent.targetY).to.equal(720)
    expect(agent.currentAnim).to.equal('talk')
    expect(agent._bubbleText).to.equal('收到传令')
    expect(agent._selected).to.equal(true)
    expect(agent._focused).to.equal(true)
    expect(agent.renderable.tint).to.include({ a: 0.35 })
    expect(agent.flipped).to.equal(true)
    expect(agent.containsPoint(agent.pos.x, agent.pos.y - 20)).to.equal(true)
    expect(agent.containsPoint(agent.pos.x + 1000, agent.pos.y + 1000)).to.equal(false)
  })
})
