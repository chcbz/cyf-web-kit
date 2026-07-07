/**
 * 鉴毃涔夊巺鍦烘櫙 - melonJS Stage (manual asset loading)
 */

import { DEPTH_LAYERS, HALL_SCENE_HEIGHT, HALL_SCENE_WIDTH } from '../config.js'
import { clampSceneTransform, fitSceneTransform, screenToWorldPoint } from '../sceneTransform.js'

const GESTURE_CLICK_TOLERANCE = 6

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
      this._fitMinZoom = 1
      this._maxZoom = 3.3
      this._zoomStep = 0.12
      this._transform = { offsetX: 0, offsetY: 0, zoom: 1 }
      this._dragState = {
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        moved: false
      }
      this._pendingClick = null
      this._touchPointers = new Map()
      this._pinchState = { active: false, startDistance: 0, startZoom: 1 }
      this._interactionHitAreas = []
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
        minZoom: Math.min(this._minZoom, this._fitMinZoom),
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
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        moved: false
      }
      this._pendingClick = null
      this._touchPointers.clear()
      this._pinchState = { active: false, startDistance: 0, startZoom: 1 }
      this._applySceneTransform()
      return this.getTransform()
    }

    fitToViewport() {
      const bounds = this._getViewportBounds()
      if (!bounds) return this.getTransform()
      const md = this._mapData
      this._transform = fitSceneTransform({
        ...bounds,
        sceneWidth: md?.coordinateWidth || HALL_SCENE_WIDTH,
        sceneHeight: md?.coordinateHeight || HALL_SCENE_HEIGHT
      })
      this._fitMinZoom = Math.min(this._minZoom, this._transform.zoom)
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
        this._cancelPendingClick()
        const distance = this._touchDistance()
        if (!this._pinchState.active && distance > 0) {
          this._pinchState = { active: true, startDistance: distance, startZoom: this._transform.zoom }
        }
        this._dragState = { active: false, pointerId: null, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false }
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
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          moved: false
        }
        this._pendingClick = this._resolveInteractionTarget(event, event.pointerId)
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
        const totalMove = Math.hypot(event.clientX - this._dragState.startX, event.clientY - this._dragState.startY)
        if (totalMove > GESTURE_CLICK_TOLERANCE) {
          this._dragState.moved = true
          this._cancelPendingClick()
        }
        this.panBy(dx, dy)
        event.preventDefault?.()
        return false
      })

      const endDrag = (event) => {
        const wasClick = this._dragState.pointerId === event.pointerId && !this._dragState.moved
        this._releaseTouchPointer(event)
        if (this._dragState.pointerId === event.pointerId) {
          this._dragState = { active: false, pointerId: null, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false }
        }
        if (wasClick) this._activatePendingClick(event)
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

    _resolveInteractionTarget(event, pointerId) {
      const point = this._eventToWorldPoint(event)
      const vp = me.game.viewport
      if (!point || !vp?.width || !vp?.height) return null
      const hotspot = this._findHotspotAt(point)
      if (hotspot) {
        return {
          type: 'hotspot',
          pointerId,
          id: hotspot.id,
          panel: hotspot.panel
        }
      }
      const agent = [...this._agents.values()].reverse().find(item => item.containsPoint(point.x, point.y))
      if (agent) return { type: 'agent', pointerId, agent }
      return null
    }

    _cancelPendingClick() {
      this._pendingClick = null
    }

    _activatePendingClick(event) {
      const target = this._pendingClick
      this._pendingClick = null
      if (!target || target.pointerId !== event.pointerId) return
      if (target.type === 'hotspot') {
        this._onHotspotClick?.({ id: target.id, panel: target.panel })
        return
      }
      if (target.type === 'agent') {
        target.agent?.onPointerDown?.()
      }
    }

    _pointInPolygon(point, polygon) {
      let inside = false
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y
        const xj = polygon[j].x, yj = polygon[j].y
        if (((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
          inside = !inside
        }
      }
      return inside
    }

    _findHotspotAt(point) {
      return this._hotspots
        .map(item => ({ data: item.data, marker: item.marker }))
        .filter(item => item.data && item.marker)
        .find(({ marker, data }) => {
          // AABB fast reject
          if (point.x < marker.pos.x - marker.width / 2 ||
              point.x > marker.pos.x + marker.width / 2 ||
              point.y < marker.pos.y - marker.height / 2 ||
              point.y > marker.pos.y + marker.height / 2) {
            return false
          }
          // Polygon: ray-casting
          if (data.shape === 'polygon' && data.polygon) {
            return this._pointInPolygon(point, data.polygon)
          }
          return true
        })?.data || null
    }

    _renderModularLayers(vpW, vpH) {
      const tmxLayers = this._mapData?.imageLayers
      if (!tmxLayers || !Object.keys(tmxLayers).length) {
        return false
      }

      // --- fully TMX-driven: imagelayer name -> melonJS resource name ---
      const NAME_TO_RESOURCE = {
        "mid-occluders": "liangshan-hall-mid-occluders",
        "prop-gate": "liangshan-hall-prop-gate",
        "foreground-occluders": "liangshan-hall-foreground-occluders",
        "lighting-overlay": "liangshan-hall-lighting-overlay"
      }

      const LAYER_DEPTH = {
        "mid-occluders": 2,
        "foreground-occluders": 5,
        "lighting-overlay": 8
      }
      const PROP_DEPTH_START = 3
      const PROP_DEPTH_STEP = 0.5

      const BLEND_MODES = {
        "lighting-overlay": "screen"
      }

      let propIndex = 0
      let rendered = 0

      Object.entries(tmxLayers).forEach(([name, tmxLayer]) => {
        const resourceName = NAME_TO_RESOURCE[name]
        if (!resourceName) {
          console.warn("[HallScene] No resource mapping for TMX layer:", name)
          return
        }

        const image = me.loader.getImage(resourceName)
        if (!image) {
          console.warn("[HallScene] Image not loaded:", resourceName, "for layer:", name)
          return
        }

        const depth = LAYER_DEPTH[name] !== undefined ? LAYER_DEPTH[name] : (PROP_DEPTH_START + propIndex * PROP_DEPTH_STEP)
        const blendMode = BLEND_MODES[name] || null

        const x = tmxLayer.offsetX || 0
        const y = tmxLayer.offsetY || 0
        const w = tmxLayer.width || vpW
        const h = tmxLayer.height || vpH

        const layerOpacity = tmxLayer.opacity !== undefined ? tmxLayer.opacity : 1
        const layerTint = tmxLayer.tintcolor || null
        const imageLayer = this._createCustomImageLayer(x, y, w, h, image, { blendMode, opacity: layerOpacity, tintcolor: layerTint })
        me.game.world.addChild(imageLayer, depth)
        this._imageLayers.push(imageLayer)

        if (!LAYER_DEPTH[name]) propIndex++
        rendered++
      })

      return rendered > 0
    }

    // Render tile layers from TMX using a cached offscreen canvas.
    // Each tile is drawn once into a cached image, then used as a single
    // ImageLayer for efficient per-frame rendering.
    _renderTileLayers(vpW, vpH) {
      const tileLayers = this._mapData?.tileLayers
      const tilesets = this._mapData?.tilesets
      if (!tileLayers?.length || !tilesets?.length) return false

      // Map TMX tileset name → melonJS image resource name
      const TILESET_RESOURCE_MAP = {
        'liangshan-hall-base-clean-v3': 'liangshan-hall-base-clean',
        'hall-tileset': 'hall-tileset'
      }

      const resourceNameForTileset = (tileset) => TILESET_RESOURCE_MAP[tileset.name] || tileset.tilesetResourceName || tileset.name
      const tilesetsByFirstGid = tilesets
        .slice()
        .sort((a, b) => Number(b.firstgid || 0) - Number(a.firstgid || 0))
      const tilesetForGid = gid => tilesetsByFirstGid.find(ts => gid >= Number(ts.firstgid || 1))
      const imageCache = new Map()
      const imageForTileset = (tileset) => {
        const resourceName = resourceNameForTileset(tileset)
        if (!imageCache.has(resourceName)) {
          imageCache.set(resourceName, me.loader.getImage(resourceName))
        }
        return imageCache.get(resourceName)
      }

      let rendered = 0
      tileLayers.forEach((tileLayer, layerIdx) => {
        // Composite all tiles into an offscreen canvas (done once, GPU-friendly)
        const fallbackTileset = tilesetsByFirstGid[tilesetsByFirstGid.length - 1] || {}
        const fallbackTileWidth = fallbackTileset.tilewidth || 16
        const fallbackTileHeight = fallbackTileset.tileheight || 16
        const canvasW = tileLayer.width * fallbackTileWidth
        const canvasH = tileLayer.height * fallbackTileHeight
        const offCanvas = document.createElement('canvas')
        offCanvas.width = canvasW
        offCanvas.height = canvasH
        const ctx = offCanvas.getContext('2d')
        let tileDrawCount = 0

        for (let i = 0; i < tileLayer.data.length; i++) {
          const gid = tileLayer.data[i]
          if (gid === 0) continue
          const tileset = tilesetForGid(gid)
          if (!tileset) continue
          const tilesetImg = imageForTileset(tileset)
          if (!tilesetImg) {
            console.warn('[HallScene] Tileset image not loaded:', resourceNameForTileset(tileset), 'for layer:', tileLayer.name)
            continue
          }
          const tw = tileset.tilewidth || fallbackTileWidth
          const th = tileset.tileheight || fallbackTileHeight
          const cols = tileset.columns || Math.floor((tileset.imagewidth || tilesetImg.width || tw) / tw) || 1
          const tileIdx = gid - tileset.firstgid
          const srcCol = tileIdx % cols
          const srcRow = Math.floor(tileIdx / cols)
          const sx = srcCol * tw
          const sy = srcRow * th
          const dx = (i % tileLayer.width) * fallbackTileWidth
          const dy = Math.floor(i / tileLayer.width) * fallbackTileHeight
          ctx.drawImage(tilesetImg, sx, sy, tw, th, dx, dy, tw, th)
          tileDrawCount += 1
        }
        if (!tileDrawCount) return

        // depth: background layers start at 0, add small offset per layer
        const depth = layerIdx * 0.1
        const imageLayer = this._createCustomImageLayer(0, 0, vpW, vpH, offCanvas, { opacity: null })
        me.game.world.addChild(imageLayer, depth)
        this._imageLayers.push(imageLayer)
        rendered++
      })
      return rendered > 0
    }

    _buildScene() {
      if (this._sceneBuilt) return
      const vp = me.game.viewport
      if (!vp) return false

      const vpW = vp.width
      const vpH = vp.height
      const mapData = this._mapData
      const hotspots = mapData?.hotspots || []

      // Apply TMX map properties (zoom, dimensions) if available
      if (mapData?.mapProperties) {
        const mp = mapData.mapProperties
        if (mp.minZoom && Number.isFinite(Number(mp.minZoom))) this._minZoom = Number(mp.minZoom)
        if (mp.maxZoom && Number.isFinite(Number(mp.maxZoom))) this._maxZoom = Number(mp.maxZoom)
      }

      // 1. Render tile layers first (background base)
      let layersRendered = this._renderTileLayers(vpW, vpH)

      // 2. Render imagelayer-driven layers (occluders, props, lighting)
      const modularRendered = this._renderModularLayers(vpW, vpH)
      layersRendered = layersRendered || modularRendered

      class HotspotMarker extends me.Renderable {
        constructor(x, y, w, h, data) {
          super(x, y, w, h)
          this.anchorPoint.set(0.5, 0.5)
          this.data = data
          this.polygon = data?.polygon || null
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
          ctx.save()
          ctx.fillStyle = active ? 'rgba(255, 214, 113, 0.18)' : 'rgba(255, 235, 180, 0.06)'
          ctx.strokeStyle = active ? 'rgba(255, 221, 130, 0.66)' : 'rgba(255, 235, 180, 0.16)'
          ctx.lineWidth = active ? 2 : 1

          if (this.polygon && this.polygon.length >= 3) {
            // Polygon shape
            ctx.beginPath()
            ctx.moveTo(this.polygon[0].x, this.polygon[0].y)
            for (let i = 1; i < this.polygon.length; i++) {
              ctx.lineTo(this.polygon[i].x, this.polygon[i].y)
            }
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
          } else {
            // Rectangle shape
            const x = this.pos.x - this.width / 2
            const y = this.pos.y - this.height / 2
            ctx.beginPath()
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(x, y, this.width, this.height, 8)
            } else {
              ctx.rect(x, y, this.width, this.height)
            }
            ctx.fill()
            ctx.stroke()
          }

          if (this.feedback?.feedbackText) {
            const bx = this.pos.x - this.width / 2
            const by = this.pos.y - this.height / 2
            ctx.font = 'bold 12px sans-serif'
            ctx.fillStyle = '#fff4d4'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText(this.feedback.feedbackText, this.pos.x, by - 8)
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

        me.game.world.addChild(marker, DEPTH_LAYERS.HOTSPOTS)
        this._hotspots.push({ marker, hitArea: marker, data: h })
      })


      // Render prop images from rect-type hotspot objects (cropped images)
      const PROP_IMAGE_MAP = {
        'main-seat-rect': 'hall-prop-main-seat-cropped',
        'agent-roster-rect': 'hall-prop-agent-roster-cropped',
        'bounty-board-rect': 'hall-prop-bounty-board-cropped',
        'library-shelf-rect': 'hall-prop-library-shelf-cropped',
        'roster-book-rect': 'hall-prop-roster-book-cropped',
      }
      let propDepth = 3
      hotspots.forEach(h => {
        if (h.shape !== 'rect' || h.type !== 'prop') return
        const resourceName = PROP_IMAGE_MAP[h.id]
        if (!resourceName) return
        const image = me.loader.getImage(resourceName)
        if (!image) {
          console.warn('[HallScene] Prop image not loaded:', resourceName)
          return
        }
        const ox = (h.x - h.w / 2) / 100 * vpW
        const oy = (h.y - h.h / 2) / 100 * vpH
        const ow = h.w / 100 * vpW
        const oh = h.h / 100 * vpH
        const propLayer = this._createCustomImageLayer(ox, oy, ow, oh, image, { opacity: null })
        me.game.world.addChild(propLayer, propDepth)
        this._imageLayers.push(propLayer)
        propDepth += 0.5
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
          this._sourceX = layerOptions.sourceX || 0
          this._sourceY = layerOptions.sourceY || 0
          this._sourceW = layerOptions.sourceW || (img ? img.width : width)
          this._sourceH = layerOptions.sourceH || (img ? img.height : height)
          this._opacity = layerOptions.opacity !== undefined && layerOptions.opacity !== null ? layerOptions.opacity : null
          this._tintcolor = layerOptions.tintcolor || null
          this.isKinematic = true
        }

        draw(renderer) {
          if (!this.image) return
          const ctx = renderer.getContext?.() || renderer
          if (!ctx) return
          const prevAlpha = ctx.globalAlpha
          const prevBlend = ctx.globalCompositeOperation
          if (this._opacity !== null && this._opacity !== undefined && this._opacity < 1) {
            ctx.globalAlpha = this._opacity
          }
          if (this.blendMode) ctx.globalCompositeOperation = this.blendMode
          ctx.drawImage(
            this.image,
            this._sourceX, this._sourceY, this._sourceW, this._sourceH,
            this.pos.x, this.pos.y, this.width, this.height
          )
          if (this._tintcolor) {
            ctx.globalCompositeOperation = 'multiply'
            ctx.fillStyle = this._tintcolor
            ctx.fillRect(this.pos.x, this.pos.y, this.width, this.height)
          }
          ctx.globalAlpha = prevAlpha
          ctx.globalCompositeOperation = prevBlend
        }
      }
      return new ImageLayer(x, y, width, height, image, options)
    }

    onResetEvent() {
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
      if (!this._sceneBuilt) this._buildScene()
      if (this._needsSync) this._fullSyncAgents()
      this._sortByDepth()
      return true
    }

    _sortByDepth() {
      const occluders = this._mapData?.occluders || []
      const sceneHeight = this._mapData?.coordinateHeight || 941
      const agents = [...this._agents.values()].sort((a, b) => a.pos.y - b.pos.y)
      agents.forEach((agent) => {
        // Normalise Y to [0,1] range
        const normY = agent.pos.y / sceneHeight
        // Check if agent is behind any mask polygon
        let behindMask = false
        if (occluders.length) {
          behindMask = occluders.some(occ => {
            const inX = agent.pos.x >= occ.x && agent.pos.x <= occ.x + occ.width
            const inY = agent.pos.y >= occ.y && agent.pos.y <= occ.y + occ.height
            return inX && inY
          })
        }
        // Behind mask �� depth 1.5-2.5; in front �� depth 3.0-5.5
        if (behindMask) {
          agent.depth = 1.5 + normY * 1.0
        } else {
          agent.depth = 2.0 + normY * 3.5
        }
      })
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
