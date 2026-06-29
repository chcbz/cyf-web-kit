/**
 * ��������ɫʵ�� ���� melonJS sprite + animation state machine
 */

import { ANIM_STATES, ATLAS_COLS, ATLAS_ROWS, CHAR_VISUALS } from '../config.js'

export function createHallAgentClass(me) {
  return class HallAgent extends me.Sprite {
    constructor(agentData) {
      const vpW = me.game.viewport.width
      const vpH = me.game.viewport.height
      const x = (agentData.x || 50) / 100 * vpW
      const y = (agentData.y || 60) / 100 * vpH

      const atlasImg = me.loader.getImage('character-atlas')
      const atlasW = atlasImg ? atlasImg.width : 1402
      const atlasH = atlasImg ? atlasImg.height : 1122
      const cellW = Math.floor(atlasW / ATLAS_COLS)
      const cellH = Math.floor(atlasH / ATLAS_ROWS)
      super(x, y, {
        image: atlasImg,
        framewidth: cellW,
        frameheight: cellH
      })

      this.agentId = agentData.agentId || ''
      this.agentName = agentData.name || ''
      this.personaCode = agentData.personaCode || ''

      const code = (agentData.personaCode || '').toLowerCase()
      this._visual = CHAR_VISUALS[code] || CHAR_VISUALS.default

      // Set initial frame from atlas position
      const frameIdx = this._visual.row * ATLAS_COLS + this._visual.col
      if (typeof this.renderable?.setCurrentAnimation === 'function') {
        this.renderable.addAnimation('idle', [frameIdx])
        this.renderable.setCurrentAnimation('idle')
      }

      this.scale = this._visual.scale
      this.anchorPoint.set(0.5, 1.0)

      // Minimal body for collision awareness (not used for physics yet)
      this.body = new me.Body(this)
      this.body.setVelocity(0, 0)

      this.currentAnim = ANIM_STATES.IDLE
      this.facing = 1
      this.targetX = x
      this.targetY = y
      this.speed = 0
      this._sourceData = agentData
      this._bubbleText = ''
      this._bubbleTimer = 0
      this._highlighted = false
      this._selected = false
      this._focused = false
      this._animTimer = 0
      this._animFrame = 0
      this.depth = y
    }

    setDestination(pctX, pctY) {
      this.targetX = (pctX / 100) * me.game.viewport.width
      this.targetY = (pctY / 100) * me.game.viewport.height
    }

    setAnimState(state) {
      if (this.currentAnim !== state) this.currentAnim = state
    }

    setBubble(text, durationMs = 5000) {
      this._bubbleText = text || ''
      this._bubbleTimer = text ? durationMs : 0
    }

    syncState(agentData = {}) {
      this._sourceData = { ...this._sourceData, ...agentData }
      if (agentData.name) this.agentName = agentData.name
      if (agentData.personaCode) this.personaCode = agentData.personaCode
      if (agentData.x !== undefined && agentData.y !== undefined) this.setDestination(agentData.x, agentData.y)
      if (agentData.sceneStatus) this.setAnimState(agentData.sceneStatus)
      if (agentData.bubble) this.setBubble(agentData.bubble.text, agentData.bubble.ttlMs || 5000)
      this._focused = Boolean(agentData.focused || agentData.recommended)
      this.setSelected(Boolean(agentData.selected))
      if (agentData.facing) this.setFacing(agentData.facing)
    }

    setSelected(on) {
      this._selected = !!on
      this.setHighlighted(this._selected || this._focused)
    }

    setHighlighted(on) {
      this._highlighted = !!on
      this.renderable.tint = on ? new me.Color(1, 0.95, 0.45, 0.35) : null
    }

    setFacing(dir) {
      const f = dir === 'left' ? -1 : 1
      if (f !== this.facing) {
        this.facing = f
        this.renderable.flipX(f < 0)
      }
    }

    _moveTowardTarget(_dt) {
      const dx = this.targetX - this.pos.x
      const dy = this.targetY - this.pos.y
      const dist = Math.hypot(dx, dy)
      if (dist < 2) {
        this.pos.x = this.targetX
        this.pos.y = this.targetY
        this.body.setVelocity(0, 0)
        this.speed = 0
        if (this.currentAnim === ANIM_STATES.WALK) this.setAnimState(ANIM_STATES.IDLE)
        return
      }
      const spd = Math.min(80, dist * 3.5)
      this.body.setVelocity((dx / dist) * spd, (dy / dist) * spd)
      this.speed = spd
      if (Math.abs(dx) > 2) this.setFacing(dx > 0 ? 'right' : 'left')
      this.setAnimState(ANIM_STATES.WALK)
    }

    containsPoint(x, y) {
      const width = this.width * this.scale
      const height = this.height * this.scale
      return x >= this.pos.x - width / 2 &&
        x <= this.pos.x + width / 2 &&
        y >= this.pos.y - height &&
        y <= this.pos.y
    }

    update(dt) {
      super.update(dt)
      this._moveTowardTarget(dt)
      this._animTimer += dt
      if (this._animTimer > 160) {
        this._animTimer = 0
        this._animFrame = (this._animFrame + 1) % 4
      }
      this.depth = this.pos.y
      if (this._bubbleTimer > 0) {
        this._bubbleTimer -= dt
        if (this._bubbleTimer <= 0) this._bubbleText = ''
      }
      return true
    }

    draw(renderer) {
      const bob = this.currentAnim === ANIM_STATES.WALK || this.currentAnim === ANIM_STATES.BUSY
        ? Math.sin(this._animFrame * Math.PI / 2) * 2
        : Math.sin(this._animFrame * Math.PI / 2) * 0.8
      this.pos.y += bob
      super.draw(renderer)
      this.pos.y -= bob
      const r = renderer || me.video.renderer
      if (!r || !r.getContext) return
      const ctx = r.getContext()

      if (this._selected || this._focused) {
        ctx.save()
        ctx.strokeStyle = this._selected ? 'rgba(255, 221, 130, 0.85)' : 'rgba(255, 244, 212, 0.42)'
        ctx.lineWidth = this._selected ? 3 : 2
        ctx.beginPath()
        ctx.ellipse(this.pos.x, this.pos.y - 8, 24 * this.scale, 9 * this.scale, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // Name label
      if (this.agentName) {
        ctx.save()
        ctx.font = 'bold 11px sans-serif'
        ctx.fillStyle = '#fff4d4'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(this.agentName, this.pos.x, this.pos.y - this.height * this.scale - 18)
        ctx.restore()
      }

      // Bubble
      if (this._bubbleText) {
        ctx.save()
        ctx.font = '11px sans-serif'
        const tw = ctx.measureText(this._bubbleText).width
        const bx = this.pos.x - tw / 2 - 6
        const by = this.pos.y - this.height * this.scale - 38
        ctx.fillStyle = 'rgba(30, 18, 10, 0.88)'
        ctx.strokeStyle = 'rgba(255, 220, 130, 0.45)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.rect(bx, by, tw + 12, 20)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = '#fff4d4'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(this._bubbleText, bx + 6, by + 10)
        ctx.restore()
      }
    }
  }
}
