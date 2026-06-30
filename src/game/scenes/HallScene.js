/**
 * 聚义厅场景 - melonJS Stage (manual asset loading)
 */

import { DEPTH_LAYERS } from '../config.js'
import { FALLBACK_HALL_HOTSPOTS } from '../resources.js'

export function createHallSceneClass(me, HallAgentClass) {
  return class HallScene extends me.Stage {
    constructor() {
      super()
      this._agents = new Map()
      this._hotspots = []
      this._imageLayers = []
      this._onAgentClick = null
      this._onHotspotClick = null
      this._onReady = null
      this._needsSync = false
      this._pendingAgents = []
      this._mapData = null
      this._hotspotState = new Map()
      this._sceneBuilt = false
    }

    onAgentClick(cb)   { this._onAgentClick = cb }
    onHotspotClick(cb) { this._onHotspotClick = cb }
    onReady(cb)        { this._onReady = cb }

    setMapData(mapData) {
      this._mapData = mapData
    }

    syncAgents(list) {
      this._pendingAgents = list || []
      this._needsSync = true
    }

    syncHotspots(list = []) {
      this._hotspotState = new Map((list || []).map(item => [item.id, item]))
      this._hotspots.forEach(({ marker, data }) => {
        const state = data?.id ? this._hotspotState.get(data.id) : null
        marker?.setFeedback?.(state)
      })
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

    /**
     * Build the full scene (image layers, hotspots, pointer events).
     * Called from onResetEvent or deferred to first update() if viewport not ready.
     */
    _buildScene() {
      if (this._sceneBuilt) return
      const vp = me.game.viewport
      if (!vp) return false // viewport not ready yet, retry later

      const vpW = vp.width
      const vpH = vp.height
      const mapData = this._mapData
      const hotspots = mapData?.hotspots?.length ? mapData.hotspots : FALLBACK_HALL_HOTSPOTS

      // === Image layers (background + foreground) ===
      const bgImage = me.loader.getImage('liangshan-hall-bg')
      const fgImage = me.loader.getImage('liangshan-hall-fg')

      if (bgImage) {
        // Use melonJS built-in ImageLayer if available, otherwise custom Renderable
        const bgLayer = typeof me.ImageLayer === 'function'
          ? new me.ImageLayer(0, 0, { image: bgImage, width: vpW, height: vpH })
          : this._createCustomImageLayer(0, 0, vpW, vpH, bgImage)
        me.game.world.addChild(bgLayer, DEPTH_LAYERS.BACKGROUND)
        this._imageLayers.push(bgLayer)
      }

      if (fgImage) {
        const fgLayer = typeof me.ImageLayer === 'function'
          ? new me.ImageLayer(0, 0, { image: fgImage, width: vpW, height: vpH })
          : this._createCustomImageLayer(0, 0, vpW, vpH, fgImage)
        me.game.world.addChild(fgLayer, DEPTH_LAYERS.FOREGROUND)
        this._imageLayers.push(fgLayer)
      }

      // === Hotspot layer ===
      class HotspotMarker extends me.Renderable {
        constructor(x, y, w, h, data) {
          super(x, y, w, h)
          this.anchorPoint.set(0.5, 0.5)
          this.data = data
          this.feedback = null
        }

        setFeedback(feedback) {
          this.feedback = feedback || null
        }

        draw(renderer) {
          const ctx = renderer.getContext?.()
          if (!ctx) return
          const active = this.feedback?.state && this.feedback.state !== 'idle'
          const x = this.pos.x - this.width / 2
          const y = this.pos.y - this.height / 2
          ctx.save()
          ctx.fillStyle = active ? 'rgba(255, 214, 113, 0.18)' : 'rgba(255, 235, 180, 0.06)'
          ctx.strokeStyle = active ? 'rgba(255, 221, 130, 0.66)' : 'rgba(255, 235, 180, 0.16)'
          ctx.lineWidth = active ? 2 : 1
          ctx.beginPath()
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x, y, this.width, this.height, 8)
          } else {
            ctx.rect(x, y, this.width, this.height)
          }
          ctx.fill()
          ctx.stroke()
          if (this.feedback?.feedbackText) {
            ctx.font = 'bold 12px sans-serif'
            ctx.fillStyle = '#fff4d4'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText(this.feedback.feedbackText, this.pos.x, y - 8)
          }
          ctx.restore()
        }
      }

      hotspots.forEach(h => {
        const ox = (h.x - h.w / 2) / 100 * vpW
        const oy = (h.y - h.h / 2) / 100 * vpH
        const ow = h.w / 100 * vpW
        const oh = h.h / 100 * vpH

        const marker = new HotspotMarker(ox + ow / 2, oy + oh / 2, ow, oh, h)
        marker.setFeedback(this._hotspotState.get(h.id))
        me.input.registerPointerEvent('pointerdown', marker, () => {
          if (this._onHotspotClick) {
            this._onHotspotClick({ id: h.id, panel: h.panel })
          }
          return false
        })

        me.game.world.addChild(marker, DEPTH_LAYERS.HOTSPOTS)
        this._hotspots.push({ marker, hitArea: marker, data: h })
      })

      // === Agent click on viewport ===
      me.input.registerPointerEvent('pointerdown', me.game.viewport, (event) => {
        const x = event.gameX ?? event.clientX
        const y = event.gameY ?? event.clientY
        const hit = [...this._agents.values()].reverse().find(agent => agent.containsPoint(x, y))
        if (hit) {
          hit.onPointerDown?.()
          return false
        }
        return true
      })
      this._hotspots.push({ hitArea: me.game.viewport, stage: true })

      this._sceneBuilt = true
      this._needsSync = true
      if (this._onReady) this._onReady()
      return true
    }

    _createCustomImageLayer(x, y, width, height, image) {
      class ImageLayer extends me.Renderable {
        constructor(x, y, width, height, img) {
          super(x, y, width, height)
          this.anchorPoint.set(0, 0)
          this.image = img
          this.floating = true
        }

        draw(renderer) {
          if (!this.image) return
          const ctx = renderer.getContext?.() || renderer
          if (!ctx) return
          ctx.drawImage(this.image, this.pos.x, this.pos.y, this.width, this.height)
        }
      }
      return new ImageLayer(x, y, width, height, image)
    }

    onResetEvent() {
      // Try to build immediately; if viewport not ready, defer to update()
      this._buildScene()
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
          agent.onPointerDown = () => this._onAgentClick?.(agent._sourceData || data)
          agent.syncState?.(data)
          me.game.world.addChild(agent, DEPTH_LAYERS.AGENTS)
          this._agents.set(id, agent)
        } else {
          agent.syncState?.(data)
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
      // If scene hasn't been built yet, retry (viewport may be ready now)
      if (!this._sceneBuilt) this._buildScene()
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
      this._imageLayers.forEach(layer => {
        try {
          me.game.world.removeChild(layer)
        } catch (err) {
          console.warn('[HallScene] image layer cleanup failed:', err?.message || err)
        }
      })
      this._imageLayers = []
      this._agents.clear()
      this._sceneBuilt = false
    }
  }
}