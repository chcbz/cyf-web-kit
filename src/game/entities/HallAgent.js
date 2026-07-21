/**
 * 好汉角色实体 - melonJS sprite + animation state machine
 */

import { ANIM_STATES } from '../config.js'
import { personaSpriteResourceName } from '../resources.js'
import {
  personaAnimationKey,
  resolvePersonaAnimation,
  resolvePersonaDirectionFromDelta,
  resolvePersonaSprite,
} from '../sprites/animationResolver.js'
import { PERSONA_DIRECTIONS, PERSONA_SPRITE_MANIFEST } from '../sprites/personaSpriteManifest.js'
import { clampPointToRegion } from '../walkableArea.js'

export function createHallAgentClass(me) {
  return class HallAgent extends me.Sprite {
    static supports(agentData) {
      const definition = resolvePersonaSprite(
        String(agentData?.personaCode || '').toLowerCase(),
        PERSONA_SPRITE_MANIFEST
      )
      if (!definition) return false
      return isExpectedSpriteImage(
        me.loader.getImage(personaSpriteResourceName(definition.personaCode)),
        definition
      )
    }

    static create(agentData) {
      const definition = resolvePersonaSprite(
        String(agentData?.personaCode || '').toLowerCase(),
        PERSONA_SPRITE_MANIFEST
      )
      if (!definition) return null
      const image = me.loader.getImage(personaSpriteResourceName(definition.personaCode))
      if (!isExpectedSpriteImage(image, definition)) return null
      return new this(agentData, definition, image)
    }

    constructor(agentData, providedDefinition = null, providedImage = null) {
      const vpW = me.game.viewport.width
      const vpH = me.game.viewport.height
      const worldCoordinates = agentData.coordinateSpace === 'world'
      const startPoint = worldCoordinates
        ? { x: Number(agentData.x) || 0, y: Number(agentData.y) || 0 }
        : clampPointToRegion(
          { x: agentData.x || 50, y: agentData.y || 60 },
          agentData.walkableRegion
        )
      const x = worldCoordinates ? startPoint.x : startPoint.x / 100 * vpW
      const y = worldCoordinates ? startPoint.y : startPoint.y / 100 * vpH

      const code = String(agentData.personaCode || '').toLowerCase()
      const definition = providedDefinition || resolvePersonaSprite(code, PERSONA_SPRITE_MANIFEST)
      if (!definition) throw new Error(`Unknown Juyiting persona sprite: ${code || '<empty>'}`)
      const spriteImage = providedImage || me.loader.getImage(personaSpriteResourceName(definition.personaCode))
      if (!isExpectedSpriteImage(spriteImage, definition)) {
        throw new Error(`Unavailable Juyiting persona sprite: ${definition.personaCode}`)
      }
      super(x, y, {
        image: spriteImage,
        framewidth: definition.frame.width,
        frameheight: definition.frame.height
      })

      this.agentId = agentData.agentId || ''
      this.agentName = agentData.name || ''
      this.personaCode = definition.personaCode
      this._visual = definition
      this._collider = definition.collider
      const sprite = this._spriteTarget()
      if (typeof sprite?.setCurrentAnimation === 'function') {
        for (const state of [ANIM_STATES.IDLE, ANIM_STATES.WALK]) {
          for (const direction of PERSONA_DIRECTIONS) {
            const animation = definition.animations[state][direction]
            sprite.addAnimation(personaAnimationKey(state, direction), animation.frames, animation.frameMs)
          }
        }
        sprite.setCurrentAnimation(personaAnimationKey(ANIM_STATES.IDLE, 'down'))
      }

      this._renderScale = 1
      this._applyScale(this._resolveScale(agentData.scale))
      this.anchorPoint.set(definition.anchor.x, definition.anchor.y)

      // Minimal body for collision awareness (not used for physics yet)
      this.body = new me.Body(this)
      this.isKinematic = true
      this._setBodyVelocity(0, 0)

      this.currentAnim = ANIM_STATES.IDLE
      this.direction = 'down'
      this._activeDirection = this.direction
      this._activeAnimation = definition.animations.idle[this.direction]
      this.facing = this.direction
      if (agentData.facing) this.setFacing(agentData.facing)
      this.targetX = x
      this.targetY = y
      this.speed = 0
      this._sourceData = agentData
      this._bubbleText = ''
      this._bubbleTimer = 0
      this._highlighted = false
      this._selected = false
      this._focused = false
      this._walkableRegion = agentData.walkableRegion || null
      this._simulationControlled = Boolean(agentData.simulationControlled || worldCoordinates)
      this._patrolRoute = this._normalisePatrolRoute(agentData.patrolRoute)
      this._patrolPlanSignature = this._patrolSignature(this._patrolRoute, agentData.regionId)
      this._patrolRevision = agentData.patrolRevision
      this._patrolIndex = 0
      this._patrolDelayMs = Number.isFinite(agentData.patrolDelayMs) ? agentData.patrolDelayMs : 600
      this._patrolWaitMs = 0
      this._animTimer = 0
      this._animFrame = 0
      this.depth = y
      if (!this._simulationControlled) this._advancePatrolTarget()
    }

    setDestination(pctX, pctY) {
      const point = clampPointToRegion({ x: pctX, y: pctY }, this._walkableRegion)
      this.targetX = (point.x / 100) * me.game.viewport.width
      this.targetY = (point.y / 100) * me.game.viewport.height
    }

    setAnimState(state) {
      const resolved = resolvePersonaAnimation(this._visual, state, this.direction)
      if (this.currentAnim === resolved.name && this._activeDirection === resolved.direction) return
      this.currentAnim = resolved.name
      this._activeDirection = resolved.direction
      this._activeAnimation = resolved.animation
      const sprite = this._spriteTarget()
      if (typeof sprite?.setCurrentAnimation === 'function') {
        sprite.setCurrentAnimation(personaAnimationKey(resolved.name, resolved.direction))
      }
    }

    setBubble(text, durationMs = 5000) {
      this._bubbleText = text || ''
      this._bubbleTimer = text ? durationMs : 0
    }

    syncState(agentData = {}) {
      const previousSource = this._sourceData || {}
      this._sourceData = { ...this._sourceData, ...agentData }
      if (agentData.walkableRegion) this._walkableRegion = agentData.walkableRegion
      if (agentData.name) this.agentName = agentData.name
      if (Array.isArray(agentData.patrolRoute)) {
        const nextRoute = this._normalisePatrolRoute(agentData.patrolRoute)
        const nextSignature = this._patrolSignature(nextRoute, agentData.regionId)
        const hasPatrolRevision = Object.prototype.hasOwnProperty.call(agentData, 'patrolRevision')
        const planChanged = nextSignature !== this._patrolPlanSignature ||
          (hasPatrolRevision && agentData.patrolRevision !== this._patrolRevision)

        if (Number.isFinite(agentData.patrolDelayMs)) this._patrolDelayMs = agentData.patrolDelayMs
        if (planChanged) {
          this._patrolRoute = nextRoute
          this._patrolPlanSignature = nextSignature
          this._patrolRevision = agentData.patrolRevision
          this._patrolIndex = 0
          this._patrolWaitMs = 0
          if (this._patrolRoute.length) {
            this._advancePatrolTarget()
          } else {
            this.targetX = this.pos.x
            this.targetY = this.pos.y
            this._setBodyVelocity(0, 0)
            this.speed = 0
          }
        }
      } else if (agentData.destination) {
        this.setDestination(agentData.destination.x, agentData.destination.y)
      }
      if (agentData.sceneStatus) this.setAnimState(agentData.sceneStatus)
      if (agentData.bubble) this.setBubble(agentData.bubble.text, agentData.bubble.ttlMs || 5000)
      if (agentData.scale !== undefined) this._applyScale(this._resolveScale(agentData.scale))
      this._focused = Boolean(agentData.focused || agentData.recommended)
      this.setSelected(Boolean(agentData.selected))
      if (agentData.facing && agentData.facing !== previousSource.facing) this.setFacing(agentData.facing)
    }

    syncSimulationSnapshot(snapshot = {}) {
      if (!Number.isFinite(snapshot.x) || !Number.isFinite(snapshot.y)) return
      this._simulationControlled = true
      this._sourceData = { ...this._sourceData, ...snapshot, coordinateSpace: 'world' }
      this.pos.x = snapshot.x
      this.pos.y = snapshot.y
      this.targetX = snapshot.x
      this.targetY = snapshot.y
      this._setBodyVelocity(0, 0)
      this.speed = 0
      if (snapshot.facing) this.setFacing(snapshot.facing)
      this.setAnimState(snapshot.animation || 'idle')
      this.depth = snapshot.y
    }

    setSelected(on) {
      this._selected = !!on
      this.setHighlighted(this._selected || this._focused)
    }

    setHighlighted(on) {
      this._highlighted = !!on
      const sprite = this._spriteTarget()
      if (sprite) {
        sprite.tint = on ? new me.Color(255, 242, 115, 0.35) : new me.Color(255, 255, 255, 1)
      }
    }

    setFacing(dir) {
      if (!PERSONA_DIRECTIONS.includes(dir)) return
      if (dir === this.direction) return
      this.direction = dir
      this.facing = dir
      const sprite = this._spriteTarget()
      if (typeof sprite?.flipX === 'function') sprite.flipX(false)
      this.setAnimState(this.currentAnim)
    }

    _spriteTarget() {
      return this.renderable || this
    }

    _resolveScale(scale) {
      const value = Number(scale)
      return Number.isFinite(value) && value > 0 ? value : this._visual.scale
    }

    _applyScale(scale) {
      const nextScale = this._resolveScale(scale)
      const previousScale = this._renderScale || 1
      this._renderScale = nextScale

      if (typeof this.scale === 'function') {
        this.scale(nextScale / previousScale)
      } else {
        this.scale = nextScale
      }
    }

    _setBodyVelocity(x, y) {
      if (typeof this.body?.setVelocity === 'function') {
        this.body.setVelocity(x, y)
        return
      }

      const velocity = this.body?.velocity || this.body?.vel
      if (velocity) {
        velocity.x = x
        velocity.y = y
      }
    }

    _overlayMetrics(verticalOffset = 0) {
      const scale = this._renderScale || 1
      const width = this.width * scale
      const height = this.height * scale
      const anchor = this._visual?.anchor || { x: 0.5, y: 0.5 }
      const left = this.pos.x - width * anchor.x
      const top = this.pos.y + verticalOffset - height * anchor.y
      return {
        left,
        top,
        width,
        height,
        centerX: left + width / 2
      }
    }

    _drawOverlay(renderer, verticalOffset = 0) {
      const r = renderer || me.video.renderer
      if (!r || !r.getContext) return
      const ctx = r.getContext()
      const overlay = this._overlayMetrics(verticalOffset)

      // Name label
      if (this.agentName) {
        ctx.save()
        ctx.font = 'bold 11px sans-serif'
        ctx.fillStyle = '#fff4d4'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(this.agentName, overlay.centerX, overlay.top - 18)
        ctx.restore()
      }

      // Bubble
      if (this._bubbleText) {
        ctx.save()
        ctx.font = '11px sans-serif'
        const tw = ctx.measureText(this._bubbleText).width
        const bx = overlay.centerX - tw / 2 - 6
        const by = overlay.top - 38
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

    _drawSelectionBase(renderer, verticalOffset = 0) {
      if (!this._selected) return
      const r = renderer || me.video.renderer
      if (!r || !r.getContext) return
      const ctx = r.getContext()
      const scale = this._renderScale || 1
      const baseX = this.pos.x
      const baseY = this.pos.y + verticalOffset - 1 * scale
      ctx.save()
      ctx.fillStyle = 'rgba(255, 207, 92, 0.04)'
      ctx.strokeStyle = 'rgba(255, 221, 130, 0.34)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.ellipse(baseX, baseY, 26 * scale, 7 * scale, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }

    _normalisePatrolRoute(route = []) {
      return (Array.isArray(route) ? route : [])
        .map(point => clampPointToRegion(point, this._walkableRegion))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
        .map(point => ({
          x: (point.x / 100) * me.game.viewport.width,
          y: (point.y / 100) * me.game.viewport.height
        }))
    }

    _patrolSignature(route = [], regionId = '') {
      const scope = String(regionId || '')
      const points = route.map(point => `${point.x.toFixed(3)},${point.y.toFixed(3)}`)
      return `${scope}:${points.join('|')}`
    }

    _advancePatrolTarget() {
      if (!this._patrolRoute.length) return
      const current = this._patrolRoute[this._patrolIndex % this._patrolRoute.length]
      const nearCurrent = Math.hypot(current.x - this.pos.x, current.y - this.pos.y) < 3
      if (nearCurrent && this._patrolRoute.length > 1) this._patrolIndex += 1
      const next = this._patrolRoute[this._patrolIndex % this._patrolRoute.length]
      this.targetX = next.x
      this.targetY = next.y
    }

    _moveTowardTarget(dt) {
      const dx = this.targetX - this.pos.x
      const dy = this.targetY - this.pos.y
      const dist = Math.hypot(dx, dy)
      const deltaMs = Math.max(0, Number(dt) || 0)
      if (dist < 2) {
        this.pos.x = this.targetX
        this.pos.y = this.targetY
        this._setBodyVelocity(0, 0)
        this.speed = 0
        if (this._patrolRoute.length > 1) {
          this._patrolWaitMs -= deltaMs
          if (this._patrolWaitMs <= 0) {
            this._patrolIndex += 1
            this._patrolWaitMs = this._patrolDelayMs
            this._advancePatrolTarget()
          } else if (this.currentAnim === ANIM_STATES.WALK) {
            this.setAnimState(ANIM_STATES.IDLE)
          }
        } else if (this.currentAnim === ANIM_STATES.WALK) {
          this.setAnimState(ANIM_STATES.IDLE)
        }
        return
      }
      if (this._patrolWaitMs > 0) {
        this._patrolWaitMs = Math.max(0, this._patrolWaitMs - deltaMs)
        this._setBodyVelocity(0, 0)
        this.speed = 0
        if (this.currentAnim === ANIM_STATES.WALK) this.setAnimState(ANIM_STATES.IDLE)
        return
      }
      const spd = Math.min(this._visual.baseSpeed, dist * 3.5)
      const step = Math.min(dist, spd * deltaMs / 1000)
      this.pos.x += (dx / dist) * step
      this.pos.y += (dy / dist) * step
      this._setBodyVelocity(0, 0)
      this.speed = spd
      this.setFacing(resolvePersonaDirectionFromDelta(dx, dy, this.direction))
      this.setAnimState(ANIM_STATES.WALK)
      if (step >= dist) this._moveTowardTarget(0)
    }

    containsPoint(x, y) {
      const width = this.width * this._renderScale
      const height = this.height * this._renderScale
      return x >= this.pos.x - width / 2 &&
        x <= this.pos.x + width / 2 &&
        y >= this.pos.y - height &&
        y <= this.pos.y
    }

    update(dt) {
      if (!this._simulationControlled) this._setBodyVelocity(0, 0)
      super.update(dt)
      if (!this._simulationControlled) this._moveTowardTarget(dt)
      this._animTimer += dt
      if (this._animTimer > this._activeAnimation.frameMs) {
        this._animTimer = 0
        this._animFrame = (this._animFrame + 1) % this._activeAnimation.frames.length
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
      this._lastOverlayBob = bob
      this.pos.y += bob
      super.draw(renderer)
      this.pos.y -= bob
    }

    postDraw(renderer) {
      super.postDraw(renderer)
      this._drawSelectionBase(renderer, this._lastOverlayBob || 0)
      this._drawOverlay(renderer, this._lastOverlayBob || 0)
    }
  }
}

function isExpectedSpriteImage(image, definition) {
  if (!image) return false
  const width = image.naturalWidth ?? image.width
  const height = image.naturalHeight ?? image.height
  return width === definition.image.width && height === definition.image.height
}
