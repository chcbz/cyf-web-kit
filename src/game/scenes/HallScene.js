/**
 * 閴存瘍娑斿宸洪崷鐑樻珯 - melonJS Stage (manual asset loading)
 */

import { DEPTH_LAYERS, HALL_SCENE_HEIGHT, HALL_SCENE_WIDTH } from '../config.js'
import { createCameraController } from '../camera/cameraController.js'
import { classifyViewportResize } from '../camera/resizePolicy.js'
import { screenToWorld } from '../camera/cameraTransform.js'
import { createInputController } from '../input/inputController.js'
import { createInteractionLock } from '../input/interactionLock.js'

const DEFAULT_INPUT_SNAPSHOT = Object.freeze({ activeGesture: 'none', interactionLocked: false })
const normalizeLockReason = reason => typeof reason === 'string' ? reason.trim() : ''

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
      this._cameraController = null
      this._inputController = null
      this._interactionLock = null
      this._lockedReasons = new Set()
      this._inputTarget = null
      this._destroyed = false
      this._lastViewport = null
    }

    onAgentClick(cb)   { this._onAgentClick = cb }
    onHotspotClick(cb) { this._onHotspotClick = cb }
    onReady(cb)        { this._onReady = cb }

    setMapData(mapData) { this._mapData = mapData }

    syncAgents(list) {
      this._pendingAgents = list || []
      this._needsSync = true
    }

    syncHotspots(list = []) {
      this._hotspotState = new Map((list || []).map(item => [item.id, item]))
      this._hotspots.forEach(({ marker, data }) => {
        marker?.setFeedback?.(data?.id ? this._hotspotState.get(data.id) : null)
      })
    }

    updateAgentSceneState(agentId, state) {
      const agent = this._agents.get(agentId)
      if (!agent) return
      if (state.x !== undefined && state.y !== undefined) agent.setDestination(state.x, state.y)
      if (state.sceneStatus) agent.setAnimState(state.sceneStatus)
      if (state.bubble) agent.setBubble(state.bubble.text, state.bubble.ttlMs || 5000)
      if (state.highlighted !== undefined) agent.setHighlighted(state.highlighted)
      if (state.facing) agent.setFacing(state.facing)
    }

    setSelectedAgent(agentId) {
      this._agents.forEach((a, id) => a.setHighlighted(id === agentId))
    }

    getAgent(id) { return this._agents.get(id) }

    _viewportSize() {
      const viewport = me.game.viewport
      return {
        width: Number.isFinite(viewport?.width) && viewport.width > 0 ? viewport.width : 0,
        height: Number.isFinite(viewport?.height) && viewport.height > 0 ? viewport.height : 0
      }
    }

    _sceneSize() {
      return {
        width: Number(this._mapData?.coordinateWidth) || HALL_SCENE_WIDTH,
        height: Number(this._mapData?.coordinateHeight) || HALL_SCENE_HEIGHT
      }
    }

    _applyCameraTransform(transform) {
      if (this._destroyed) return
      const viewport = this._viewportSize()
      const matrix = me.game.world?.currentTransform
      if (!matrix || viewport.width <= 0 || viewport.height <= 0) return
      matrix.identity()
        .translate(viewport.width / 2 + transform.offsetX, viewport.height / 2 + transform.offsetY)
        .scale(transform.zoom, transform.zoom)
        .translate(-viewport.width / 2, -viewport.height / 2)
    }

    _coarsePointer() {
      try {
        return globalThis.matchMedia?.('(pointer: coarse)')?.matches === true
      } catch {
        return false
      }
    }

    _createCamera() {
      const requestFrame = callback => {
        if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback)
        return globalThis.setTimeout(() => callback(Date.now()), 16)
      }
      const cancelFrame = id => {
        if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(id)
        else globalThis.clearTimeout(id)
      }
      this._cameraController = createCameraController({
        viewport: () => this._viewportSize(),
        sceneSize: () => this._sceneSize(),
        apply: transform => this._applyCameraTransform(transform),
        requestFrame,
        cancelFrame,
        now: () => globalThis.performance?.now?.() ?? Date.now()
      }, { minZoom: 0.1, maxZoom: this._maxZoom, roundingTolerance: 2 }, this._coarsePointer())
      this._lastViewport = this._viewportSize()
    }

    _canvasElement() {
      return me.video?.getCanvas?.() || me.video?.renderer?.getCanvas?.() ||
        (typeof document !== 'undefined' ? document.querySelector('.melon-layer canvas, canvas') : null)
    }

    _canvasRect() { return this._canvasElement()?.getBoundingClientRect?.() || null }

    _displayRect() {
      const canvas = this._canvasElement()
      const layer = canvas?.closest?.('.melon-layer') || canvas?.parentElement ||
        (typeof document !== 'undefined' ? document.querySelector('.melon-layer') : null)
      return layer?.getBoundingClientRect?.() || this._canvasRect()
    }

    _clientToViewport(clientX, clientY) {
      const viewport = this._viewportSize()
      const rect = this._displayRect()
      if (!rect?.width || !rect?.height || viewport.width <= 0 || viewport.height <= 0) {
        return { x: clientX, y: clientY }
      }
      const scale = Math.max(rect.width / viewport.width, rect.height / viewport.height)
      const offsetX = (rect.width - viewport.width * scale) / 2
      const offsetY = (rect.height - viewport.height * scale) / 2
      return {
        x: (clientX - rect.left - offsetX) / scale,
        y: (clientY - rect.top - offsetY) / scale
      }
    }

    _createInputTarget() {
      const source = this._canvasElement()
      if (!source?.addEventListener || !source?.removeEventListener) {
        return { addEventListener() {}, removeEventListener() {} }
      }
      const wrappers = new Map()
      return {
        addEventListener: (type, listener, options) => {
          const wrapped = event => {
            if ((type.startsWith('pointer') || type === 'wheel') &&
                Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
              const point = this._clientToViewport(event.clientX, event.clientY)
              listener({
                pointerId: event.pointerId,
                pointerType: event.pointerType,
                clientX: point.x,
                clientY: point.y,
                button: event.button,
                deltaY: event.deltaY,
                deltaMode: event.deltaMode,
                target: event.target,
                preventDefault: () => event.preventDefault?.()
              })
            } else listener(event)
          }
          wrappers.set(listener, wrapped)
          source.addEventListener(type, wrapped, options)
        },
        removeEventListener: (type, listener, options) => {
          const wrapped = wrappers.get(listener)
          if (!wrapped) return
          source.removeEventListener(type, wrapped, options)
          wrappers.delete(listener)
        },
        setPointerCapture: id => source.setPointerCapture?.(id),
        releasePointerCapture: id => source.releasePointerCapture?.(id)
      }
    }

    _screenToWorld(point) {
      return screenToWorld(point, this.getTransform(), this._viewportSize())
    }

    _worldToScreen(point) {
      const viewport = this._viewportSize()
      const transform = this.getTransform()
      return {
        x: (point.x - viewport.width / 2) * transform.zoom + viewport.width / 2 + transform.offsetX,
        y: (point.y - viewport.height / 2) * transform.zoom + viewport.height / 2 + transform.offsetY
      }
    }

    _hitProvider() {
      const touchSlop = 11
      const agentAreas = [...this._agents.entries()].reverse().map(([id, agent]) => {
        const bounds = agent.getBounds?.()
        const screenStart = bounds ? this._worldToScreen({ x: bounds.x, y: bounds.y }) : null
        const screenEnd = bounds ? this._worldToScreen({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }) : null
        return {
          id,
          kind: 'agent',
          touchSlop,
          bounds: screenStart && screenEnd ? {
            x: Math.min(screenStart.x, screenEnd.x), y: Math.min(screenStart.y, screenEnd.y),
            width: Math.abs(screenEnd.x - screenStart.x), height: Math.abs(screenEnd.y - screenStart.y)
          } : undefined,
          contains: point => {
            const world = this._screenToWorld(point)
            return agent.containsPoint?.(world.x, world.y) === true || bounds?.contains?.(world.x, world.y) === true
          },
          containsWithSlop: (point, slop) => {
            if (!bounds) return false
            const world = this._screenToWorld(point)
            const worldSlop = slop / Math.max(this.getTransform().zoom, 0.001)
            const dx = Math.max(bounds.x - world.x, 0, world.x - (bounds.x + bounds.width))
            const dy = Math.max(bounds.y - world.y, 0, world.y - (bounds.y + bounds.height))
            return Math.hypot(dx, dy) <= worldSlop
          }
        }
      })
      const hotspotAreas = this._hotspots.filter(item => item.data && item.marker).map(({ data, marker }) => {
        const start = this._worldToScreen({ x: marker.pos.x, y: marker.pos.y })
        const end = this._worldToScreen({ x: marker.pos.x + marker.width, y: marker.pos.y + marker.height })
        return {
          id: data.id,
          kind: 'hotspot',
          touchSlop,
          bounds: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) },
          contains: point => {
            const world = this._screenToWorld(point)
            if (world.x < marker.pos.x || world.x > marker.pos.x + marker.width || world.y < marker.pos.y || world.y > marker.pos.y + marker.height) return false
            return data.shape !== 'polygon' || !data.polygon || this._pointInPolygon(world, data.polygon)
          },
          containsWithSlop: (point, slop) => {
            const world = this._screenToWorld(point)
            const worldSlop = slop / Math.max(this.getTransform().zoom, 0.001)
            const dx = Math.max(marker.pos.x - world.x, 0, world.x - (marker.pos.x + marker.width))
            const dy = Math.max(marker.pos.y - world.y, 0, world.y - (marker.pos.y + marker.height))
            return Math.hypot(dx, dy) <= worldSlop
          }
        }
      })
      return { agents: agentAreas, hotspots: hotspotAreas }
    }

    _createInput() {
      const canvas = this._canvasElement()
      if (!canvas?.addEventListener || !canvas?.removeEventListener) return false
      this._interactionLock = createInteractionLock()
      this._lockedReasons.forEach(reason => this._interactionLock.lock(reason))
      this._inputTarget = this._createInputTarget()
      this._inputController = createInputController({
        target: this._inputTarget,
        camera: this._cameraController,
        interactionLock: this._interactionLock,
        viewport: () => this._viewportSize(),
        hitProvider: () => this._hitProvider(),
        onAgentClick: id => this._agents.get(id)?.onPointerDown?.(),
        onHotspotClick: id => {
          const hotspot = this._hotspots.find(item => item.data?.id === id)?.data
          if (hotspot) this._onHotspotClick?.({ id: hotspot.id, panel: hotspot.panel })
        }
      })
      return true
    }

    _ensureControllers() {
      if (this._destroyed) return false
      if (!this._cameraController) this._createCamera()
      if (!this._inputController) this._createInput()
      return this._cameraController !== null
    }

    getCameraSnapshot() { return this._cameraController?.snapshot?.() || null }
    inputSnapshot() { return this._inputController?.snapshot?.() || DEFAULT_INPUT_SNAPSHOT }
    getTransform() { return this.getCameraSnapshot()?.transform || { offsetX: 0, offsetY: 0, zoom: 1 } }

    panBy(dx, dy) {
      this._ensureControllers()
      return this._cameraController?.panBy?.(dx, dy) || this.getTransform()
    }

    zoomBy(delta) {
      this._ensureControllers()
      const zoom = this.getTransform().zoom
      const next = zoom + (Number.isFinite(delta) ? delta : 0)
      const factor = zoom > 0 && next > 0 ? next / zoom : 1
      return this._cameraController?.zoomAt?.({ x: this._viewportSize().width / 2, y: this._viewportSize().height / 2 }, factor) || this.getTransform()
    }

    resetToMainHall() {
      this._ensureControllers()
      this._inputController?.cancelGesture?.()
      this._cameraController?.resetTo?.(this.getCameraSnapshot()?.presetKey || 'desktop')
      return this.getTransform()
    }

    resetTransform() { return this.resetToMainHall() }
    fitToViewport() { return this.resetToMainHall() }

    resizeViewport(change = {}) {
      if (!this._cameraController) return this.getTransform()
      const previous = this._lastViewport || this._viewportSize()
      const next = { width: Number(change.width) || previous.width, height: Number(change.height) || previous.height }
      const kind = ['keyboard', 'orientation', 'layout'].includes(change.kind)
        ? change.kind
        : classifyViewportResize({ previous, next, previousVisualHeight: previous.height, nextVisualHeight: next.height, editableFocused: false, orientationChanged: change.orientationChanged })
      this._lastViewport = next
      return this._cameraController.resize(next, kind)
    }

    setInteractionLocked(locked, reason = 'panel') {
      const normalizedReason = normalizeLockReason(reason)
      if (normalizedReason === '') return this._lockedReasons.size > 0
      if (locked && !this._lockedReasons.has(normalizedReason)) {
        this._lockedReasons.add(normalizedReason)
        this._interactionLock?.lock(normalizedReason)
      } else if (!locked && this._lockedReasons.delete(normalizedReason)) {
        this._interactionLock?.unlock(normalizedReason)
      }
      if (locked) this._inputController?.cancelGesture?.()
      return this._interactionLock?.isLocked?.() ?? this._lockedReasons.size > 0
    }

    _pointInPolygon(point, polygon) {
      let inside = false
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y
        const xj = polygon[j].x, yj = polygon[j].y
        if (((yi > point.y) !== (yj > point.y)) && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) inside = !inside
      }
      return inside
    }

    _renderModularLayers(vpW, vpH) {
      const tmxLayers = this._mapData?.imageLayers
      if (!tmxLayers || !Object.keys(tmxLayers).length) {
        return false
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
        const resourceName = tmxLayer.resourceName || name
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
      const resourceNameForTileset = (tileset) => tileset.tilesetResourceName || tileset.resourceName || tileset.name
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
      if (this._destroyed || this._sceneBuilt) return false
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
          this.anchorPoint.set(0, 0)
          this.data = data
          this.polygon = data?.drawPolygon || null
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
            ctx.beginPath()
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(0, 0, this.width, this.height, 8)
            } else {
              ctx.rect(0, 0, this.width, this.height)
            }
            ctx.fill()
            ctx.stroke()
          }

          if (this.feedback?.feedbackText) {
            ctx.font = 'bold 12px sans-serif'
            ctx.fillStyle = '#fff4d4'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText(this.feedback.feedbackText, this.width / 2, -8)
          }
          ctx.restore()
        }
      }

      hotspots.forEach(h => {
        const ox = (h.x - h.w / 2) / 100 * vpW
        const oy = (h.y - h.h / 2) / 100 * vpH
        const ow = h.w / 100 * vpW
        const oh = h.h / 100 * vpH
        const coordinateWidth = mapData?.coordinateWidth || vpW
        const coordinateHeight = mapData?.coordinateHeight || vpH
        const drawPolygon = h.polygon?.map(point => ({
          x: (point.x / coordinateWidth * vpW) - ox,
          y: (point.y / coordinateHeight * vpH) - oy
        })) || null

        const marker = new HotspotMarker(ox, oy, ow, oh, { ...h, drawPolygon })
        marker.setFeedback(this._hotspotState.get(h.id))

        me.game.world.addChild(marker, DEPTH_LAYERS.HOTSPOTS)
        this._hotspots.push({ marker, hitArea: marker, data: h })
      })


      // Render prop tile objects from TMX collection-of-images tilesets.
      let propDepth = 3
      hotspots.forEach(h => {
        if (h.shape !== 'rect' || h.type !== 'prop' || !h.tileResourceName) return
        const image = me.loader.getImage(h.tileResourceName)
        if (!image) {
          console.warn('[HallScene] Prop tile image not loaded:', h.tileResourceName)
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

      this._ensureControllers()

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
      if (this._destroyed) return false
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
        // Behind mask 锟斤拷 depth 1.5-2.5; in front 锟斤拷 depth 3.0-5.5
        if (behindMask) {
          agent.depth = 1.5 + normY * 1.0
        } else {
          agent.depth = 2.0 + normY * 3.5
        }
      })
    }

    onDestroyEvent() {
      if (this._destroyed) return
      this._destroyed = true
      this._inputController?.cleanup?.()
      this._cameraController?.cleanup?.()
      this._inputController = null
      this._cameraController = null
      this._inputTarget = null
      this._interactionLock = null
      this._lockedReasons.clear()
      this._onAgentClick = null
      this._onHotspotClick = null
      this._onReady = null
      this._pendingAgents = []
      this._needsSync = false
      this._hotspotState.clear()
      this._hotspots.forEach(({ marker }) => {
        try {
          if (marker && me.game.world?.hasChild?.(marker)) me.game.world.removeChild(marker)
        } catch (err) {
          console.warn('[HallScene] hotspot cleanup failed:', err?.message || err)
        }
      })
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
      this._agents.forEach(agent => {
        try {
          if (me.game.world?.hasChild?.(agent)) me.game.world.removeChild(agent)
        } catch (err) {
          console.warn('[HallScene] agent cleanup failed:', err?.message || err)
        }
      })
      this._agents.clear()
      this._sceneBuilt = false
    }
  }
}
