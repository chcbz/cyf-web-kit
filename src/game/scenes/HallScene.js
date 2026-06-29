/**
 * ������������ ���� melonJS Stage (manual asset loading)
 */

import { DEPTH_LAYERS } from '../config.js'
import { HALL_HOTSPOTS } from '../resources.js'

export function createHallSceneClass(me, HallAgentClass) {
  return class HallScene extends me.Stage {
    constructor() {
      super()
      this._agents = new Map()
      this._hotspots = []
      this._onAgentClick = null
      this._onHotspotClick = null
      this._onReady = null
      this._needsSync = false
      this._pendingAgents = []
    }

    onAgentClick(cb)   { this._onAgentClick = cb }
    onHotspotClick(cb) { this._onHotspotClick = cb }
    onReady(cb)        { this._onReady = cb }

    syncAgents(list) {
      this._pendingAgents = list || []
      this._needsSync = true
    }

    updateAgentSceneState(agentId, state) {
      const agent = this._agents.get(agentId)
      if (!agent) return
      if (state.x !== undefined && state.y !== undefined) {
        agent.setDestination(state.x, state.y)
      }
      if (state.sceneStatus) agent.setAnimState(state.sceneStatus)
      if (state.bubble) agent.setBubble(state.bubble.text, state.bubble.ttlMs || 5000)
      if (state.highlighted !== undefined) agent.setHighlighted(state.highlighted)
      if (state.facing) agent.setFacing(state.facing)
    }

    setSelectedAgent(agentId) {
      this._agents.forEach((a, id) => a.setHighlighted(id === agentId))
    }

    getAgent(id) { return this._agents.get(id) }

    onResetEvent() {
      const vpW = me.game.viewport.width
      const vpH = me.game.viewport.height

      // === Background layer ===
      try {
        const bgImg = me.loader.getImage('liangshan-hall-bg')
        if (bgImg) {
          const bg = new me.Sprite(vpW / 2, vpH / 2, {
            image: bgImg,
            anchorPoint: new me.Vector2d(0.5, 0.5)
          })
          bg.floating = true
          bg.scale(vpW / bg.width, vpH / bg.height)
          me.game.world.addChild(bg, DEPTH_LAYERS.BACKGROUND)
        }
      } catch (e) {
        console.warn('[HallScene] BG failed:', e.message)
      }

      // === Hotspot layer ===
      HALL_HOTSPOTS.forEach(h => {
        const ox = (h.x - h.w / 2) / 100 * vpW
        const oy = (h.y - h.h / 2) / 100 * vpH
        const ow = h.w / 100 * vpW
        const oh = h.h / 100 * vpH

        const hitArea = new me.Rect(ox, oy, ow, oh)
        me.input.registerPointerEvent('pointerdown', hitArea, () => {
          if (this._onHotspotClick) {
            this._onHotspotClick({ id: h.id, panel: h.panel })
          }
        })

        // Visual marker (semi-transparent debug rect)
        const marker = new me.Renderable(ox + ow / 2, oy + oh / 2, ow, oh)
        marker.anchorPoint.set(0.5, 0.5)
        marker.color = new me.Color(1, 0.92, 0.55, 0.06)
        me.game.world.addChild(marker, DEPTH_LAYERS.HOTSPOTS)
        this._hotspots.push({ marker, hitArea })
      })

      // === Foreground layer ===
      try {
        const fgImg = me.loader.getImage('liangshan-hall-fg')
        if (fgImg) {
          const fg = new me.Sprite(vpW / 2, vpH / 2, {
            image: fgImg,
            anchorPoint: new me.Vector2d(0.5, 0.5)
          })
          fg.floating = true
          fg.scale(vpW / fg.width, vpH / fg.height)
          me.game.world.addChild(fg, DEPTH_LAYERS.FOREGROUND)
        }
      } catch (e) {
        console.warn('[HallScene] FG failed:', e.message)
      }

      this._needsSync = true
      if (this._onReady) this._onReady()
    }

    _fullSyncAgents() {
      const keepIds = new Set()
      this._pendingAgents.forEach(data => {
        const id = data.agentId || data.personaCode || ''
        if (!id) return
        keepIds.add(id)
        let agent = this._agents.get(id)
        if (!agent) {
          agent = new HallAgentClass(data)
          me.game.world.addChild(agent, DEPTH_LAYERS.AGENTS)
          this._agents.set(id, agent)
        } else {
          if (data.x !== undefined && data.y !== undefined) agent.setDestination(data.x, data.y)
          if (data.name) agent.agentName = data.name
          if (data.personaCode) agent.personaCode = data.personaCode
        }
      })
      this._agents.forEach((agent, id) => {
        if (!keepIds.has(id)) {
          me.game.world.removeChild(agent)
          this._agents.delete(id)
        }
      })
      this._pendingAgents = []
      this._needsSync = false
    }

    update(dt) {
      super.update(dt)
      if (this._needsSync) this._fullSyncAgents()
      this._sortByDepth()
      return true
    }

    _sortByDepth() {
      const sorted = [...this._agents.values()].sort((a, b) => a.pos.y - b.pos.y)
      sorted.forEach((a, i) => { a.depth = DEPTH_LAYERS.AGENTS + i * 0.001 })
    }

    onDestroyEvent() {
      this._hotspots.forEach(h => {
        try {
          me.input.releaseAllPointerEvents(h.hitArea)
        } catch (err) {
          console.warn('[HallScene] pointer cleanup failed:', err?.message || err)
        }
      })
      this._hotspots = []
      this._agents.clear()
    }
  }
}
