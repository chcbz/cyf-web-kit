/**
 * 鉴毃涔夊巺鍦烘櫙 - melonJS Stage (manual asset loading)
 */

import { DEPTH_LAYERS, HALL_SCENE_HEIGHT, HALL_SCENE_WIDTH } from '../config.js'
import { HALL_SCENE_RENDER_LAYERS } from '../hallSceneLayers.js'
import { HALL_MODULAR_RENDER_LAYERS } from '../hallModularLayers.js'
import { FALLBACK_HALL_HOTSPOTS } from '../resources.js'
import { clampSceneTransform, fitSceneTransform, screenToWorldPoint } from '../sceneTransform.js'

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
      this._minZoom = 1
      this._maxZoom = 3.3
      this._zoomStep = 0.12
      this._transform = { offsetX: 0, offsetY: 0, zoom: 1 }
      this._dragState = {
        active: false,
        pointerId: null,
        lastX: 0,
        lastY: 0,
        moved: false
      }
      this._touchPointers = new Map()
      this._pinchState = { active: false, startDistance: 0, startZoom: 1 }
      this._interactionHitAreas = []
      this._suppressNextSceneClick = false
      this._applySceneTransform()
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

    getTransform() {
      return { ...this._transform }
    }

    _getViewportBounds() {
      const vp = me.game.viewport
      const width = vp?.width
      const height = vp?.height
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null
      }
      const displayRect = this._displayRect()
      return {
        viewportWidth: width,
        viewportHeight: height,
        containerWidth: displayRect?.width,
        containerHeight: displayRect?.height,
        minZoom: this._minZoom,
        maxZoom: this._maxZoom
      }
    }

    _clampTransform(next) {
      const bounds = this._getViewportBounds()
      if (!bounds) return this.getTransform()
      const clamped = clampSceneTransform(next, bounds)
      return {
        ...clamped,
        offsetX: Object.is(clamped.offsetX, -0) ? 0 : clamped.offsetX,
        offsetY: Object.is(clamped.offsetY, -0) ? 0 : clamped.offsetY
      }
    }

    _applySceneTransform() {
      const bounds = this._getViewportBounds()
      const transform = me.game.world?.currentTransform
      if (!bounds || !transform) return
      const centerX = bounds.viewportWidth / 2
      const centerY = bounds.viewportHeight / 2
      transform
        .identity()
        .translate(centerX + this._transform.offsetX, centerY + this._transform.offsetY)
        .scale(this._transform.zoom, this._transform.zoom)
        .translate(-centerX, -centerY)
    }

    panBy(dx, dy) {
      const next = {
        ...this._transform,
        offsetX: this._transform.offsetX + dx,
        offsetY: this._transform.offsetY + dy
      }

      this._transform = this._clampTransform(next)
      this._applySceneTransform()
      return this.getTransform()
    }

    zoomBy(delta) {
      this._transform = this._clampTransform({
        ...this._transform,
        zoom: this._transform.zoom + delta
      })
      this._applySceneTransform()
      return this.getTransform()
    }

    resetTransform() {
      this._transform = { offsetX: 0, offsetY: 0, zoom: 1 }
      this._dragState = {
        active: false,
        pointerId: null,
        lastX: 0,
        lastY: 0,
        moved: false
      }
      this._touchPointers.clear()
      this._pinchState = { active: false, startDistance: 0, startZoom: 1 }
      this._applySceneTransform()
      return this.getTransform()
    }

    fitToViewport() {
      const bounds = this._getViewportBounds()
      if (!bounds) return this.getTransform()
      this._transform = fitSceneTransform({
        ...bounds,
        sceneWidth: HALL_SCENE_WIDTH,
        sceneHeight: HALL_SCENE_HEIGHT
      })
      this._applySceneTransform()
      return this.getTransform()
    }

    _touchDistance() {
      const points = [...this._touchPointers.values()]
      if (points.length < 2) return 0
      return Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY)
    }

    _trackTouchPointer(event) {
      if (event.pointerType !== 'touch') return false
      this._touchPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
      if (this._touchPointers.size >= 2) {
        const distance = this._touchDistance()
        if (!this._pinchState.active && distance > 0) {
          this._pinchState = { active: true, startDistance: distance, startZoom: this._transform.zoom }
        }
        this._dragState = { active: false, pointerId: null, lastX: 0, lastY: 0, moved: false }
      }
      return this._touchPointers.size >= 2
    }

    _updatePinchZoom(event) {
      if (event.pointerType !== 'touch' || !this._touchPointers.has(event.pointerId)) return false
      this._touchPointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY })
      if (!this._pinchState.active) return false
      const distance = this._touchDistance()
      if (distance <= 0 || this._pinchState.startDistance <= 0) return false
      const targetZoom = this._pinchState.startZoom * (distance / this._pinchState.startDistance)
      this._transform = this._clampTransform({ ...this._transform, zoom: targetZoom })
      this._applySceneTransform()
      event.preventDefault?.()
      return true
    }

    _releaseTouchPointer(event) {
      if (event.pointerType !== 'touch') return
      this._touchPointers.delete(event.pointerId)
      if (this._touchPointers.size < 2) {
        this._pinchState = { active: false, startDistance: 0, startZoom: this._transform.zoom }
      }
    }

    _registerSceneInput() {
      const viewport = me.game.viewport
      if (!viewport) return

      me.input.registerPointerEvent('wheel', viewport, (event) => {
        const direction = event.deltaY > 0 ? -1 : 1
        this.zoomBy(direction * this._zoomStep)
        event.preventDefault?.()
        return false
      })

      me.input.registerPointerEvent('pointerdown', viewport, (event) => {
        if (event.button !== undefined && event.button !== 0) return true
        if (this._trackTouchPointer(event)) {
          event.preventDefault?.()
          return false
        }
        this._dragState = {
          active: true,
          pointerId: event.pointerId,
          lastX: event.clientX,
          lastY: event.clientY,
          moved: false
        }
        return true
      })

      me.input.registerPointerEvent('pointermove', viewport, (event) => {
        if (this._updatePinchZoom(event)) return false
        if (!this._dragState.active || this._dragState.pointerId !== event.pointerId) return true
        if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return true
        const dx = event.clientX - this._dragState.lastX
        const dy = event.clientY - this._dragState.lastY
        this._dragState.lastX = event.clientX
        this._dragState.lastY = event.clientY
        if (Math.hypot(dx, dy) < 1) return true
        this._dragState.moved = true
        this.panBy(dx, dy)
        event.preventDefault?.()
        return false
      })

      const endDrag = (event) => {
        const wasClick = this._dragState.pointerId === event.pointerId && !this._dragState.moved
        this._releaseTouchPointer(event)
        if (this._dragState.pointerId === event.pointerId) {
          this._dragState = { active: false, pointerId: null, lastX: 0, lastY: 0, moved: false }
        }
        if (wasClick) this._clickHotspotFromEvent(event)
        return true
      }
      me.input.registerPointerEvent('pointerup', viewport, endDrag)
      me.input.registerPointerEvent('pointercancel', viewport, endDrag)

      this._interactionHitAreas.push(viewport)
    }

    _screenToWorld(x, y) {
      const bounds = this._getViewportBounds()
      if (!bounds) return null
      return screenToWorldPoint({
        x,
        y,
        viewportWidth: bounds.viewportWidth,
        viewportHeight: bounds.viewportHeight,
        ...this._transform
      })
    }

    _canvasElement() {
      return me.video?.getCanvas?.() ||
        me.video?.renderer?.getCanvas?.() ||
        (typeof document !== 'undefined' ? document.querySelector('.melon-layer canvas, canvas') : null)
    }

    _canvasRect() {
      const canvas = this._canvasElement()
      return canvas?.getBoundingClientRect?.() || null
    }

    _displayRect() {
      const canvas = this._canvasElement()
      const layer = canvas?.closest?.('.melon-layer') ||
        canvas?.parentElement ||
        (typeof document !== 'undefined' ? document.querySelector('.melon-layer') : null)
      return layer?.getBoundingClientRect?.() || this._canvasRect()
    }

    _eventToWorldPoint(event) {
      const bounds = this._getViewportBounds()
      if (!bounds) return null
      const hasClientPoint = Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      if (hasClientPoint) {
        const rect = this._displayRect()
        if (rect?.width > 0 && rect?.height > 0) {
          const scale = Math.max(rect.width / bounds.viewportWidth, rect.height / bounds.viewportHeight)
          const drawnWidth = bounds.viewportWidth * scale
          const drawnHeight = bounds.viewportHeight * scale
          const offsetX = (rect.width - drawnWidth) / 2
          const offsetY = (rect.height - drawnHeight) / 2
          return this._screenToWorld(
            (event.clientX - rect.left - offsetX) / scale,
            (event.clientY - rect.top - offsetY) / scale
          )
        }
      }
      const x = event.gameX ?? event.clientX
      const y = event.gameY ?? event.clientY
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null
      return this._screenToWorld(x, y)
    }

    _clickHotspotFromEvent(event) {
      if (this._suppressNextSceneClick) {
        this._suppressNextSceneClick = false
        return
      }
      const point = this._eventToWorldPoint(event)
      const vp = me.game.viewport
      if (!point || !vp?.width || !vp?.height) return
      const hotspot = this._findHotspotAt(point)
      if (hotspot) {
        this._onHotspotClick?.({ id: hotspot.id, panel: hotspot.panel })
      }
    }

    _findHotspotAt(point) {
      return this._hotspots
        .map(item => ({ data: item.data, marker: item.marker }))
        .filter(item => item.data && item.marker)
        .find(({ marker }) => (
          point.x >= marker.pos.x - marker.width / 2 &&
          point.x <= marker.pos.x + marker.width / 2 &&
          point.y >= marker.pos.y - marker.height / 2 &&
          point.y <= marker.pos.y + marker.height / 2
        ))?.data || null
    }

    _renderModularLayers(vpW, vpH) {
      const loaded = HALL_MODULAR_RENDER_LAYERS
        .map(layer => ({ layer, image: me.loader.getImage(layer.resourceName) }))
        .filter(({ image }) => Boolean(image))

      if (!loaded.length) return false

      loaded.forEach(({ layer, image }) => {
        if (layer.kind === 'environment') {
          const imageLayer = this._createCustomImageLayer(0, 0, vpW, vpH, image, {
            blendMode: layer.blendMode
          })
          me.game.world.addChild(imageLayer, layer.depth)
          this._imageLayers.push(imageLayer)
        } else {
          const scale = layer.defaultScale || 1
          const iw = Math.round((image.width || vpW) * scale)
          const ih = Math.round((image.height || vpH) * scale)
          const imageLayer = this._createCustomImageLayer(
            layer.defaultX || 0,
            layer.defaultY || 0,
            iw, ih, image
          )
          me.game.world.addChild(imageLayer, layer.depth)
          this._imageLayers.push(imageLayer)
        }
      })
      return true
    }

    _buildScene() {
      if (this._sceneBuilt) return
      const vp = me.game.viewport
      if (!vp) return false // viewport not ready yet, retry later

      const vpW = vp.width
      const vpH = vp.height
      const mapData = this._mapData
      const hotspots = mapData?.hotspots?.length ? mapData.hotspots : FALLBACK_HALL_HOTSPOTS

      // === Image layers (modular first, manifest fallback, legacy last) ===
      let layersRendered = this._renderModularLayers(vpW, vpH)

      if (!layersRendered) {
        const renderedManifestLayers = HALL_SCENE_RENDER_LAYERS
          .map(layer => ({ layer, image: me.loader.getImage(layer.resourceName) }))
          .filter(({ image }) => Boolean(image))

        if (renderedManifestLayers.length) {
          renderedManifestLayers.forEach(({ layer, image }) => {
            const imageLayer = this._createCustomImageLayer(0, 0, vpW, vpH, image, {
              blendMode: layer.blendMode
            })
            me.game.world.addChild(imageLayer, layer.depth)
            this._imageLayers.push(imageLayer)
          })
          layersRendered = true
        }
      }

      if (!layersRendered) {
        const bgImage = me.loader.getImage('liangshan-hall-bg')
        const fgImage = me.loader.getImage('liangshan-hall-fg')

        if (bgImage) {
          const bgLayer = this._createCustomImageLayer(0, 0, vpW, vpH, bgImage)
          me.game.world.addChild(bgLayer, DEPTH_LAYERS.BACKGROUND)
          this._imageLayers.push(bgLayer)
        }

        if (fgImage) {
          const fgLayer = this._createCustomImageLayer(0, 0, vpW, vpH, fgImage)
          me.game.world.addChild(fgLayer, DEPTH_LAYERS.FOREGROUND)
          this._imageLayers.push(fgLayer)
        }
      }

      // === Hotspot layer ===
      class HotspotMarker extends me.Renderable {
        constructor(x, y, w, h, data) {
          super(x, y, w, h)
          this.anchorPoint.set(0.5, 0.5)
          this.data = data
          this.feedback = null
          this.isKinematic = true
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
        const point = this._eventToWorldPoint(event)
        if (!point) return true
        const hotspot = this._findHotspotAt(point)
        if (hotspot) {
          this._suppressNextSceneClick = true
          this._onHotspotClick?.({ id: hotspot.id, panel: hotspot.panel })
          return false
        }
        const hit = [...this._agents.values()].reverse().find(agent => agent.containsPoint(point.x, point.y))
        if (hit) {
          this._suppressNextSceneClick = true
          hit.onPointerDown?.()
          return false
        }
        return true
      })
      this._hotspots.push({ hitArea: me.game.viewport, stage: true })
      this._registerSceneInput()

      this._sceneBuilt = true
      this._needsSync = true
      if (this._onReady) this._onReady()
      return true
    }

    _createCustomImageLayer(x, y, width, height, image, options = {}) {
      class ImageLayer extends me.Renderable {
        constructor(x, y, width, height, img, layerOptions) {
          super(x, y, width, height)
          this.anchorPoint.set(0, 0)
          this.image = img
          this.blendMode = layerOptions.blendMode || null
          this.isKinematic = true
        }

        draw(renderer) {
          if (!this.image) return
          const ctx = renderer.getContext?.() || renderer
          if (!ctx) return
          const previousBlendMode = ctx.globalCompositeOperation
          if (this.blendMode) ctx.globalCompositeOperation = this.blendMode
          ctx.drawImage(this.image, this.pos.x, this.pos.y, this.width, this.height)
          if (this.blendMode) ctx.globalCompositeOperation = previousBlendMode
        }
      }
      return new ImageLayer(x, y, width, height, image, options)
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
      this._interactionHitAreas.forEach(hitArea => {
        try {
          me.input.releaseAllPointerEvents(hitArea)
        } catch (err) {
          console.warn('[HallScene] input cleanup failed:', err?.message || err)
        }
      })
      this._interactionHitAreas = []
      this._hotspots = []
      this._imageLayers.forEach(layer => {
        try {
          if (me.game.world?.hasChild?.(layer)) {
            me.game.world.removeChild(layer)
          }
        } catch (err) {
          console.warn('[HallScene] image layer cleanup failed:', err?.message || err)
        }
      })
      this._imageLayers = []
      this._agents.clear()
      this._touchPointers.clear()
      this._pinchState = { active: false, startDistance: 0, startZoom: this._transform.zoom }
      this._sceneBuilt = false
    }
  }
}
