/**
 * 閴存瘍娑斿宸洪崷鐑樻珯 - melonJS Stage (manual asset loading)
 */

import { DEPTH_LAYERS, HALL_SCENE_HEIGHT, HALL_SCENE_WIDTH } from '../config.js'
import { createCameraController } from '../camera/cameraController.js'
import { classifyViewportResize } from '../camera/resizePolicy.js'
import { screenToWorld } from '../camera/cameraTransform.js'
import { createInputController } from '../input/inputController.js'
import { createInteractionLock } from '../input/interactionLock.js'
import { clientToViewport } from '../viewportTransform.js'
import { createShadowRenderer, collectV1Snapshots, parseOcclusionDebugFlag } from '../occlusion/shadowRenderer.js'
import { hasRenderSchemaV2 } from '../occlusion/canonicalIr.js'
import { hasV2ActivationEnvelope, assembleV2Scene, computeUnifiedWorldOrder, buildHitTestTargets, hitTestPoint, buildFrameProposal, createEmptyMembershipState, registerAgentsInGrid, unregisterAgentFromGrid } from '../occlusion/hallSceneAssembly.js'
import { createRuntimeAgentAdapter, defaultSpawnResolver, defaultChunkResolver } from '../occlusion/runtimeAgentAdapter.js'
import { createDebugOverlay } from '../occlusion/debugOverlay.js'

const DEFAULT_INPUT_SNAPSHOT = Object.freeze({ activeGesture: 'none', interactionLocked: false })
const normalizeLockReason = reason => typeof reason === 'string' ? reason.trim() : ''
const normalizeViewport = viewport => ({
  width: Number.isFinite(Number(viewport?.width)) && Number(viewport.width) > 0 ? Number(viewport.width) : 0,
  height: Number.isFinite(Number(viewport?.height)) && Number(viewport.height) > 0 ? Number(viewport.height) : 0
})

const normalizeVisibleViewport = (visibleViewport, fallbackViewport) => {
  const fallback = normalizeViewport(fallbackViewport)
  const rawX = Number(visibleViewport?.x)
  const rawY = Number(visibleViewport?.y)
  const x = Number.isFinite(rawX) ? Math.min(fallback.width, Math.max(0, rawX)) : 0
  const y = Number.isFinite(rawY) ? Math.min(fallback.height, Math.max(0, rawY)) : 0
  const rawWidth = Number(visibleViewport?.width)
  const rawHeight = Number(visibleViewport?.height)
  const width = Number.isFinite(rawWidth) && rawWidth > 0
    ? Math.min(fallback.width - x, rawWidth)
    : fallback.width
  const height = Number.isFinite(rawHeight) && rawHeight > 0
    ? Math.min(fallback.height - y, rawHeight)
    : fallback.height
  return { x, y, width, height }
}

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
      this._pendingAgentSnapshots = []
      this._simulationAgentIds = new Set()
      this._simulationRuntime = null
      this._availablePersonas = null
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
      // E6: shadow renderer (lazy init, both flags off → zero construct)
      this._shadowRenderer = null
      this._shadowState = null
      // E6: debug overlay (only created when ?jytOcclusionDebug=1)
      this._debugOverlay = null
      this._shadowDebugActive = false
      this._lastViewport = null
      this._currentViewport = normalizeViewport(me.game.viewport)
      this._displayViewport = { ...this._currentViewport }
      this._visibleViewport = normalizeVisibleViewport(null, this._currentViewport)
      // E12: V2 activation gate (off by default; V1 active until explicit activate)
      this._v2Generation = 0
      this._v2Assembly = null
      this._v2Active = false
      this._v2Controller = null
      this._v2AgentAdapter = null
      this._v2Membership = createEmptyMembershipState()
      this._v2HitTargets = null
      this._v2Depths = null
      this._v2PropRenderables = new Map()     // stableId → melonJS prop renderable
      this._v2StagingRenderables = null        // Set<melonJS renderable> staging-owned (fragments only)
      this._v2FrameSerial = Promise.resolve()   // serialized async frame processing
      this._v2FramePending = false
      this._v2PendingFrame = null
    }

    onAgentClick(cb)   { this._onAgentClick = cb }
    onHotspotClick(cb) { this._onHotspotClick = cb }
    onReady(cb)        { this._onReady = cb }

    setMapData(mapData) {
      this._mapData = mapData
      // Propagate to existing shadow renderer if any
      if (this._shadowRenderer) {
        this._shadowRenderer.setMapData(mapData)
      }
      // E12: deactivate V2 when map data changes, then re-check gate
      if (this._v2Active) {
        this.deactivateV2()
      }
      if (this._shouldActivateV2() && this.hasV2Support()) {
        this.activateV2()
      }

    }


    _ensureShadowFlags() {
      if (this._destroyed) return
      // Re-evaluate flags every call (supports late binding, no one-shot block)
      const featureOn = typeof window !== 'undefined' && window.__JYT_OCCLUSION_SHADOW_ENABLED === true
      const debugOn = typeof window !== 'undefined'
        && parseOcclusionDebugFlag(window.location?.search || '')
      const needShadow = featureOn || debugOn  // P1: debug flag alone enables shadow
      this._shadowDebugActive = debugOn

      if (needShadow) {
        // Ensure renderer exists and is enabled
        if (!this._shadowRenderer) {
          this._shadowRenderer = createShadowRenderer({ mapData: this._mapData })
        }
        this._shadowRenderer.enable()

        // Ensure debug overlay if debug flag on
        if (debugOn) {
          if (!this._debugOverlay) {
            this._debugOverlay = createDebugOverlay({ game: me?.game })
          }
          this._debugOverlay.activate()
        }
      } else {
        // Both flags off: zero construct — dispose renderer if it exists
        if (this._shadowRenderer) {
          this._shadowRenderer.dispose()
          this._shadowRenderer = null
          this._shadowState = null
        }
        if (this._debugOverlay) {
          this._debugOverlay.dispose()
          this._debugOverlay = null
        }
      }
    }

    _ensureDebugOverlay() {
      if (this._destroyed) return
      try {
        if (!this._debugOverlay) {
          this._debugOverlay = createDebugOverlay({ game: me?.game })
        }
        this._debugOverlay.activate()
      } catch (err) {
        // Only log when debug is explicitly active
        if (this._shadowDebugActive) {
          console.warn('[HallScene] debug overlay activation failed:', err?.message || err)
        }
      }
    }


    prepareRuntime() {
      if (this._destroyed) return false
      this._initializeViewport()
      if (this._currentViewport.width <= 0 || this._currentViewport.height <= 0) return false
      const properties = this._mapData?.mapProperties
      if (properties?.minZoom && Number.isFinite(Number(properties.minZoom))) this._minZoom = Number(properties.minZoom)
      if (properties?.maxZoom && Number.isFinite(Number(properties.maxZoom))) this._maxZoom = Number(properties.maxZoom)
      this._ensureControllers()
      return true
    }

    setSimulationRuntime(runtime) {
      this._simulationRuntime = runtime || null
    }

    setAvailablePersonas(personaCodes) {
      this._availablePersonas = new Set(personaCodes || [])
      this._needsSync = true
    }

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
      this._agents.forEach((a, id) => a.setSelected(id === agentId))
    }

    getAgent(id) { return this._agents.get(id) }

    _viewportSize() {
      return { ...this._currentViewport }
    }

    _displayViewportSize() {
      return { ...this._displayViewport }
    }

    _visibleViewportRect() {
      if (this._visibleViewport.width > 0 && this._visibleViewport.height > 0) {
        return { ...this._visibleViewport }
      }
      const viewport = this._viewportSize()
      const canvas = this._canvasElement()
      const canvasRect = canvas?.getBoundingClientRect?.()
      const layer = canvas?.closest?.('.melon-layer') || canvas?.parentElement ||
        (typeof document !== 'undefined' ? document.querySelector('.melon-layer') : null)
      const layerRect = layer?.getBoundingClientRect?.()
      if (!canvasRect?.width || !canvasRect?.height || !layerRect?.width || !layerRect?.height ||
        viewport.width <= 0 || viewport.height <= 0) {
        return { ...this._visibleViewport }
      }
      const scaleX = canvasRect.width / viewport.width
      const scaleY = canvasRect.height / viewport.height
      return normalizeVisibleViewport({
        x: (layerRect.left - canvasRect.left) / scaleX,
        y: (layerRect.top - canvasRect.top) / scaleY,
        width: layerRect.width / scaleX,
        height: layerRect.height / scaleY
      }, viewport)
    }

    syncAgentSnapshots(list) {
      this._pendingAgentSnapshots = Array.isArray(list) ? list.map(snapshot => ({ ...snapshot })) : []
    }

    _initializeViewport() {
      if (this._currentViewport.width > 0 && this._currentViewport.height > 0) return
      this._currentViewport = normalizeViewport(me.game.viewport)
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
        presetViewport: () => this._displayViewportSize(),
        visibleViewport: () => this._visibleViewportRect(),
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
      const canvasRect = canvas?.getBoundingClientRect?.()
      if (canvasRect?.width > 0 && canvasRect?.height > 0) return canvasRect
      const layer = canvas?.closest?.('.melon-layer') || canvas?.parentElement ||
        (typeof document !== 'undefined' ? document.querySelector('.melon-layer') : null)
      return layer?.getBoundingClientRect?.() || canvasRect
    }

    _clientToViewport(clientX, clientY) {
      const viewport = this._viewportSize()
      const rect = this._displayRect()
      if (!rect?.width || !rect?.height || viewport.width <= 0 || viewport.height <= 0) {
        return { x: clientX, y: clientY }
      }
      return clientToViewport(clientX, clientY, rect, viewport)
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
      const agentAreas = [...this._agents.entries()]
        .sort(([firstId, first], [secondId, second]) => {
          const firstStableId = this._v2AgentAdapter?.lookup?.(firstId)?.stableId ?? ""
          const secondStableId = this._v2AgentAdapter?.lookup?.(secondId)?.stableId ?? ""
          const depthDifference = this._v2Active ? ((this._v2Depths?.[secondStableId] ?? 0) - (this._v2Depths?.[firstStableId] ?? 0)) : ((Number(second.depth) || 0) - (Number(first.depth) || 0))
          if (depthDifference !== 0) return depthDifference
          const yDifference = (Number(second.pos?.y) || 0) - (Number(first.pos?.y) || 0)
          if (yDifference !== 0) return yDifference
          const firstKey = String(firstId)
          const secondKey = String(secondId)
          return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0
        })
        .map(([id, agent]) => {
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
        const polygon = marker.polygon?.length >= 3
          ? marker.polygon.map(point => ({ x: marker.pos.x + point.x, y: marker.pos.y + point.y }))
          : null
        const polygonBounds = polygon ? {
          x: Math.min(...polygon.map(point => point.x)),
          y: Math.min(...polygon.map(point => point.y)),
          width: Math.max(...polygon.map(point => point.x)) - Math.min(...polygon.map(point => point.x)),
          height: Math.max(...polygon.map(point => point.y)) - Math.min(...polygon.map(point => point.y))
        } : null
        const worldBounds = polygonBounds || { x: marker.pos.x, y: marker.pos.y, width: marker.width, height: marker.height }
        const start = this._worldToScreen({ x: worldBounds.x, y: worldBounds.y })
        const end = this._worldToScreen({ x: worldBounds.x + worldBounds.width, y: worldBounds.y + worldBounds.height })
        return {
          id: data.id,
          kind: 'hotspot',
          touchSlop,
          bounds: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) },
          contains: point => {
            const world = this._screenToWorld(point)
            if (polygon) return this._pointInPolygon(world, polygon)
            return world.x >= marker.pos.x && world.x <= marker.pos.x + marker.width &&
              world.y >= marker.pos.y && world.y <= marker.pos.y + marker.height
          },
          containsWithSlop: (point, slop) => {
            const world = this._screenToWorld(point)
            const worldSlop = slop / Math.max(this.getTransform().zoom, 0.001)
            if (polygon) {
              return this._pointInPolygon(world, polygon) || this._distanceToPolygon(world, polygon) <= worldSlop
            }
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

    getCameraSnapshot() {
      this._ensureControllers()
      return this._cameraController?.snapshot?.() || null
    }
    inputSnapshot() {
      this._ensureControllers()
      return this._inputController?.snapshot?.() || DEFAULT_INPUT_SNAPSHOT
    }
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
      const previous = this._viewportSize()
      const supplied = normalizeViewport(change)
      const display = normalizeViewport(change.displayViewport)
      const next = {
        width: supplied.width || previous.width,
        height: supplied.height || previous.height
      }
      const kind = ['keyboard', 'orientation', 'layout'].includes(change.kind)
        ? change.kind
        : classifyViewportResize({ previous, next, previousVisualHeight: previous.height, nextVisualHeight: next.height, editableFocused: false, orientationChanged: change.orientationChanged })
      if (kind === 'keyboard') return this.getTransform()
      this._currentViewport = next
      this._displayViewport = {
        width: display.width || next.width,
        height: display.height || next.height
      }
      if (change.visibleViewport) {
        this._visibleViewport = normalizeVisibleViewport(change.visibleViewport, next)
      }
      this._lastViewport = next
      if (!this._cameraController) return this.getTransform()
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

    _distanceToPolygon(point, polygon) {
      let minimum = Infinity
      for (let index = 0; index < polygon.length; index++) {
        const start = polygon[index]
        const end = polygon[(index + 1) % polygon.length]
        const dx = end.x - start.x
        const dy = end.y - start.y
        const lengthSquared = dx * dx + dy * dy
        const projection = lengthSquared > 0
          ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
          : 0
        minimum = Math.min(minimum, Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy)))
      }
      return minimum
    }

    _renderModularLayers(vpW, vpH) {
      const tmxLayers = this._mapData?.imageLayers
      if (!tmxLayers || !Object.keys(tmxLayers).length) {
        return false
      }

      const LAYER_DEPTH = {
        'mid-occluders': 2,
        'foreground-occluders': 5,
        'lighting-overlay': 8
      }
      const PROP_DEPTH_START = 3
      const PROP_DEPTH_STEP = 0.5

      const BLEND_MODES = {
        'lighting-overlay': 'screen'
      }

      let propIndex = 0
      let rendered = 0

      Object.entries(tmxLayers).forEach(([name, tmxLayer]) => {
        const resourceName = tmxLayer.resourceName || name
        const image = me.loader.getImage(resourceName)
        if (!image) {
          console.warn('[HallScene] Image not loaded:', resourceName, 'for layer:', name)
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
      this._initializeViewport()
      const { width: vpW, height: vpH } = this._viewportSize()
      if (vpW <= 0 || vpH <= 0) return false
      const mapData = this._mapData
      const mapObjects = mapData?.hotspots || []
      const hotspots = mapObjects.filter(hotspot => hotspot.type !== 'prop' && hotspot.panel)

      // Apply TMX map properties (zoom, dimensions) if available
      if (mapData?.mapProperties) {
        const mp = mapData.mapProperties
        if (mp.minZoom && Number.isFinite(Number(mp.minZoom))) this._minZoom = Number(mp.minZoom)
        if (mp.maxZoom && Number.isFinite(Number(mp.maxZoom))) this._maxZoom = Number(mp.maxZoom)
      }

      // prepareRuntime runs before melonJS activates the stage. Recreate the
      // controllers here so they use the final map bounds, active viewport,
      // and the canvas that now owns the input listeners.
      this._inputController?.cleanup?.()
      this._cameraController?.cleanup?.()
      this._inputController = null
      this._cameraController = null
      this._inputTarget = null
      this._interactionLock = null

      // 1. Render tile layers first (background base)
      this._renderTileLayers(vpW, vpH)

      // 2. Render imagelayer-driven layers (occluders, props, lighting)
      this._renderModularLayers(vpW, vpH)

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
          if (!active) return
          ctx.save()
          ctx.fillStyle = 'rgba(255, 214, 113, 0.18)'
          ctx.strokeStyle = 'rgba(255, 221, 130, 0.66)'
          ctx.lineWidth = 2

          if (this.polygon && this.polygon.length >= 3) {
            ctx.beginPath()
            ctx.moveTo(this.pos.x + this.polygon[0].x, this.pos.y + this.polygon[0].y)
            for (let i = 1; i < this.polygon.length; i++) {
              ctx.lineTo(this.pos.x + this.polygon[i].x, this.pos.y + this.polygon[i].y)
            }
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
          } else {
            ctx.beginPath()
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(this.pos.x, this.pos.y, this.width, this.height, 8)
            } else {
              ctx.rect(this.pos.x, this.pos.y, this.width, this.height)
            }
            ctx.fill()
            ctx.stroke()
          }

          if (this.feedback?.feedbackText) {
            ctx.font = 'bold 12px sans-serif'
            ctx.fillStyle = '#fff4d4'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'bottom'
            ctx.fillText(this.feedback.feedbackText, this.pos.x + this.width / 2, this.pos.y - 8)
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
      mapObjects.forEach(h => {
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
        // E12: record prop renderable by its canonical stableId
        if (h.stableId) {
          this._v2PropRenderables.set(h.stableId, propLayer)
        }
        propDepth += 0.5
      })

      this._ensureControllers()

      this._sceneBuilt = true
      this._needsSync = true
      // E12: Auto-activate V2 if feature gate is enabled and map supports it
      if (this._shouldActivateV2() && this.hasV2Support()) {
        this.activateV2()
      }
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
        let agent = this._agents.get(id)
        const personaCode = String(data.personaCode || '').toLowerCase()
        if (this._availablePersonas && !this._availablePersonas.has(personaCode)) {
          if (agent) {
            me.game.world.removeChild(agent)
            this._agents.delete(id)
          }
          return
        }
        if (agent && String(agent.personaCode || '').toLowerCase() !== personaCode) {
          me.game.world.removeChild(agent)
          this._agents.delete(id)
          agent = null
        }
        if (typeof HallAgentClass.supports === 'function' && !HallAgentClass.supports(data)) {
          if (agent) {
            me.game.world.removeChild(agent)
            this._agents.delete(id)
          }
          return
        }
        if (!agent) {
          agent = typeof HallAgentClass.create === 'function'
            ? HallAgentClass.create(data)
            : new HallAgentClass(data)
          if (!agent) return
          agent.onPointerDown = () => this._onAgentClick?.(agent._sourceData || data)
          agent.syncState?.(data)
          me.game.world.addChild(agent, DEPTH_LAYERS.AGENTS)
          this._agents.set(id, agent)
        } else {
          agent.syncState?.(data)
        }
        keepIds.add(id)
      })
      this._agents.forEach((agent, id) => {
        if (!keepIds.has(id)) {
          me.game.world.removeChild(agent)
          this._agents.delete(id)
        }
      })
      this._needsSync = false
    }

    _fullSyncAgentSnapshots() {
      const keepIds = new Set()
      this._pendingAgentSnapshots.forEach(snapshot => {
        const id = snapshot.agentId || ''
        const personaCode = String(snapshot.personaCode || '').toLowerCase()
        if (!id || !personaCode) return
        if (this._availablePersonas && !this._availablePersonas.has(personaCode)) return
        let agent = this._agents.get(id)
        if (agent && String(agent.personaCode || '').toLowerCase() !== personaCode) {
          me.game.world.removeChild?.(agent)
          this._agents.delete(id)
          agent = null
        }
        if (!agent) {
          const source = {
            ...snapshot,
            coordinateSpace: 'world',
            simulationControlled: true
          }
          if (typeof HallAgentClass.supports === 'function' && !HallAgentClass.supports(source)) return
          agent = typeof HallAgentClass.create === 'function'
            ? HallAgentClass.create(source)
            : new HallAgentClass(source)
          if (!agent) return
          agent.onPointerDown = () => this._onAgentClick?.(agent._sourceData || source)
          me.game.world.addChild(agent, DEPTH_LAYERS.AGENTS)
          this._agents.set(id, agent)
        }
        agent.syncSimulationSnapshot?.(snapshot)
        keepIds.add(id)
      })
      this._simulationAgentIds.forEach(id => {
        if (keepIds.has(id)) return
        const agent = this._agents.get(id)
        if (agent) me.game.world.removeChild?.(agent)
        this._agents.delete(id)
      })
      this._simulationAgentIds = keepIds
      this._pendingAgentSnapshots = []
    }

    getShadowDiagnostics() {
      // Returns shadow state for testing (never affects v1 scene)
      return this._shadowState || null
    }

    getShadowProductionCounters() {
      return this._shadowRenderer
        ? this._shadowRenderer.productionCounters
        : { computeCount: 0, errorCount: 0, lastErrorTimestamp: 0 }
    }

    getRenderedSimulationAgentCount() {
      let count = 0
      this._simulationAgentIds.forEach(id => {
        if (this._agents.has(id)) count += 1
      })
      return count
    }

    // ── E12 V2 Activation Gate ──

    /** Feature gate: check if V2 should be activated. Tests can set window.__JYT_V2_ENABLED. */
    _shouldActivateV2() {
      return typeof window !== 'undefined' && window.__JYT_V2_ENABLED === true
    }

    /** Check if map data supports V2 occlusion system */
    hasV2Support() {
      return this._mapData ? hasV2ActivationEnvelope(this._mapData) : false
    }

    /** Get current active renderer mode */
    get activeRendererMode() {
      return this._v2Active ? 'v2' : 'v1'
    }

    getV2HitTargets() { return this._v2HitTargets ?? null }
    getV2Depths() { return this._v2Depths ?? null }

    /** Activate V2 occlusion system via E7 controller. Returns true if activation started. */
    activateV2() {
      if (this._destroyed || this._v2Active) return this._v2Active
      if (!this._mapData || !hasV2ActivationEnvelope(this._mapData)) return false

      const gen = ++this._v2Generation

      try {
        this._v2Assembly = assembleV2Scene(this._mapData)
        const ir = this._v2Assembly.canonicalIr

        // Create E3 agent adapter
        const adapter = createRuntimeAgentAdapter(
          defaultSpawnResolver('floor-1', 0),
          defaultChunkResolver(),
          'juyiting-main',
        )
        this._v2AgentAdapter = adapter

        // Build renderable registry
        const renderables = new Map()
        const stagingFragments = new Set()

        // (a) Props — exact match by stableId (assert 5/5)
        let propsMatched = 0
        for (const prop of ir.objects.filter(o => o.kind === 'prop')) {
          const handle = this._v2PropRenderables.get(prop.stableId)
          if (handle) {
            renderables.set(prop.stableId, handle)
            propsMatched++
          }
        }
        if (propsMatched !== 5) {
          console.warn('[HallScene] V2: matched only %d/5 props; activation failed', propsMatched)
          this._v2AgentAdapter.destroy()
          this._v2AgentAdapter = null
          this._v2Assembly = null
          return false
        }

        // (b) Fragments — load all 32 real assets; fail closed on any missing
        for (const f of ir.fragments) {
          const image = me.loader.getImage(f.assetRef)
          if (!image) {
            console.warn('[HallScene] V2: fragment asset not loaded: %s; activation failed', f.assetRef)
            for (const handle of stagingFragments) {
              try { me.game.world.removeChild(handle) } catch (e) {}
            }
            this._v2AgentAdapter.destroy()
            this._v2AgentAdapter = null
            this._v2Assembly = null
            return false
          }

          const FragRenderable = class extends me.Renderable {
            constructor() {
              super(f.destinationRect.x, f.destinationRect.y,
                f.destinationRect.width, f.destinationRect.height)
              this._img = image
              this._sx = f.sourceRect.x
              this._sy = f.sourceRect.y
              this._sw = f.sourceRect.width
              this._sh = f.sourceRect.height
              this.floating = true
            }
            draw(renderer) {
              const ctx = renderer.getContext?.()
              if (ctx && this._img) {
                ctx.drawImage(this._img, this._sx, this._sy, this._sw, this._sh,
                  this.pos.x, this.pos.y, this.width, this.height)
              }
            }
          }
          const handle = new FragRenderable()
          renderables.set(f.stableId, handle)
          stagingFragments.add(handle)
          me.game.world.addChild(handle, 0)
        }

        // (c) Agents — await initial adapter create so children include all current agents
        const agentCreatePromises = []
        for (const [agentId, entity] of this._agents) {
          const pos = entity.pos || {}
          agentCreatePromises.push(
            adapter.create([{ agentId, x: pos.x ?? 0, y: pos.y ?? 0 }])
              .then(scenes => {
                if (scenes.length > 0 && gen === this._v2Generation) {
                  renderables.set(scenes[0].stableId, entity)
                }
              })
          )
        }

        this._v2StagingRenderables = stagingFragments

        const self = this
        const capturedGen = gen
        const savedRenderables = renderables

        // Wait for all initial agent creates before activating controller
        Promise.all(agentCreatePromises).then(() => {
          if (capturedGen !== self._v2Generation || self._destroyed || !self._v2Assembly) return

          self._v2Controller = createSceneActivationController({
            parse: (source, ctx) => source,
            canonicalize: (parsed, ctx) => parsed,
            validate: (canonical, ctx) => canonical,
            loadAssets: (validated, ctx) => validated,
            instantiate: (input, ctx) => {
              const nodeValues = []
              const seen = new Set()
              for (const [stableId] of savedRenderables) {
                if (seen.has(stableId)) continue
                seen.add(stableId)
                nodeValues.push(Object.freeze({
                  stableId, sceneId: ctx.sceneId, mode: ctx.mode,
                  ownerTransactionId: ctx.transactionId, value: stableId,
                }))
              }
              return {
                sceneId: ctx.sceneId, mode: ctx.mode,
                ownerTransactionId: ctx.transactionId,
                children: Object.freeze(nodeValues),
                order: Object.freeze([]),
                depths: Object.freeze({}),
                dispose: () => {
                  if (self._v2StagingRenderables) {
                    for (const handle of self._v2StagingRenderables) {
                      try { me.game.world.removeChild(handle) } catch (e) {}
                    }
                    self._v2StagingRenderables = null
                  }
                },
              }
            },
            validateConstraints: (scene, ctx) => ({ order: [] }),
            commit: (ctx) => {
              const depths = self._v2Depths
              ctx.swap(
                () => {
                  self._v2Active = true
                  if (depths && savedRenderables) {
                    for (const [sid, h] of savedRenderables) {
                      const d = depths[sid]
                      if (d !== undefined && h && typeof h.depth === 'number') h.depth = d
                    }
                    if (me.game.world && typeof me.game.world.sort === 'function') {
                      me.game.world.sort(true)
                    }
                  }
                },
                () => { self._v2Active = false },
              )
            },
            commitFrame: (ctx) => {
              // Capture full old state for rollback
              const oldDepths = self._v2Depths
              const oldMembership = self._v2Membership
              const oldHitTargets = self._v2HitTargets
              const oldRenderableDepths = new Map()
              for (const [sid, h] of savedRenderables) {
                if (h && typeof h.depth === 'number') oldRenderableDepths.set(sid, h.depth)
              }

              ctx.swap(
                () => {
                  // Apply new depths to all renderables
                  for (const [sid, h] of savedRenderables) {
                    const d = ctx.next.depths[sid]
                    if (d !== undefined && h && typeof h.depth === 'number') h.depth = d
                  }
                  if (me.game.world && typeof me.game.world.sort === 'function') {
                    me.game.world.sort(true)
                  }
                  // Publish reader-side state atomically from pending frame
                  const pf = self._v2PendingFrame
                  if (pf) {
                    self._v2Depths = pf.nextDepths
                    self._v2Membership = pf.nextMembership
                    self._v2HitTargets = pf.nextHitTargets
                    self._v2PendingFrame = null
                  }
                },
                () => {
                  // Full rollback: restore renderable depths
                  for (const [sid, d] of oldRenderableDepths) {
                    const h = savedRenderables.get(sid)
                    if (h && typeof h.depth === 'number') h.depth = d
                  }
                  if (me.game.world && typeof me.game.world.sort === 'function') {
                    me.game.world.sort(true)
                  }
                  // Restore reader-side state
                  self._v2Depths = oldDepths
                  self._v2Membership = oldMembership
                  self._v2HitTargets = oldHitTargets
                  self._v2PendingFrame = null
                },
              )
            },
          })

          return self._v2Controller.activate({
            sceneId: 'juyiting-main', mode: 'v2', source: { mapData: self._mapData },
          })
        }).then(result => {
          if (capturedGen !== self._v2Generation || self._destroyed) return
          if (!result.ok) {
            console.warn('[HallScene] V2 activation failed:', result.error?.message)
            self.deactivateV2()
            return
          }
          self._applyV2Depths()
        }).catch(err => {
          if (capturedGen !== self._v2Generation) return
          console.warn('[HallScene] V2 activation failed:', err?.message || err)
          self.deactivateV2()
        })

        return true
      } catch (err) {
        console.warn('[HallScene] V2 activation failed:', err?.message || err)
        this.deactivateV2()
        return false
      }
    }

    /** Deactivate V2 system. Returns a promise that settles when cleanup is complete. */
    deactivateV2() {
      this._v2Generation++ // invalidate all pending async continuations
      this._v2Active = false

      if (this._v2StagingRenderables) {
        for (const handle of this._v2StagingRenderables) {
          try { me.game.world.removeChild(handle) } catch (e) {}
        }
        this._v2StagingRenderables = null
      }

      const controller = this._v2Controller
      this._v2Controller = null
      let destroyPromise = Promise.resolve()
      if (controller) {
        destroyPromise = controller.destroy()
          .then(() => {})
          .catch(err => {
            console.warn('[HallScene] V2 controller destroy error:', err?.message || err)
          })
      }

      if (this._v2AgentAdapter) {
        this._v2AgentAdapter.destroy()
        this._v2AgentAdapter = null
      }

      this._v2Assembly = null
      this._v2HitTargets = null
      this._v2Depths = null
      this._v2Membership = createEmptyMembershipState()
      this._v2FramePending = false
      this._v2PendingFrame = null

      return destroyPromise
    }

    /** Per-frame: adapt agents, build proposal, commitFrame via E7 controller. */
    _applyV2Depths() {
      if (!this._v2Active || !this._v2Assembly || !this._v2Controller) return
      if (this._v2FramePending) return

      const self = this
      const gen = this._v2Generation
      this._v2FramePending = true

      this._v2FrameSerial = this._v2FrameSerial
        .then(() => self._doApplyV2Depths(gen))
        .finally(() => {
          if (self._v2Generation === gen) self._v2FramePending = false
        })
    }

    async _doApplyV2Depths(capturedGen) {
      const self = this
      if (capturedGen !== self._v2Generation || !self._v2Active || !self._v2Assembly || !self._v2Controller) return

      try {
        const adapter = self._v2AgentAdapter
        if (!adapter) return

        // 1. Sync E3 agent adapter with current this._agents (fail closed on any error)
        const currentIds = new Set(self._agents.keys())
        const tasks = []

        for (const [agentId, entity] of self._agents) {
          const existing = adapter.lookup(agentId)
          const pos = entity.pos || {}
          if (!existing) {
            tasks.push(
              adapter.create([{ agentId, x: pos.x ?? 0, y: pos.y ?? 0 }])
                .then(() => {}) // success: no-op
            )
          } else if (pos.x !== undefined && pos.y !== undefined) {
            tasks.push(
              adapter.update([{ agentId, x: pos.x, y: pos.y }])
                .then(() => {})
            )
          }
        }

        // Remove agents no longer in _agents
        for (const id of adapter.sourceEntityIds) {
          if (!currentIds.has(id)) {
            tasks.push(adapter.remove([id]).then(() => {}))
          }
        }

        // Await all adapter operations; any failure → fail this frame
        const results = await Promise.allSettled(tasks)
        const anyFailed = results.some(r => r.status === 'rejected')
        if (anyFailed) {
          // Log but don't crash — V1 is preserved
          if (self._shadowDebugActive) {
            console.warn('[HallScene] V2 adapter sync had failures; skipping frame')
          }
          return
        }

        if (capturedGen !== self._v2Generation) return

        // 2. Build V2AgentAdapters from E3 snapshot
        const agentAdapters = []
        for (const id of adapter.sourceEntityIds) {
          const so = adapter.lookup(id)
          const entity = self._agents.get(id)
          if (so && entity) {
            agentAdapters.push({ sceneObject: so, entity })
          }
        }

        // 3. Register agents in spatial grid
        registerAgentsInGrid(
          self._v2Assembly.spatialGrid,
          agentAdapters,
          'juyiting-main', 'floor-1',
        )

        // 4. Build frame proposal
        const activationTxId = self._v2Controller.active?.ownerTransactionId
        if (!activationTxId) return

        const { proposal, nextMembership } = buildFrameProposal(
          self._v2Assembly, agentAdapters,
          activationTxId,
          self._v2Membership,
        )

        if (capturedGen !== self._v2Generation) return

        // 5. Pre-build next hit targets and store as pending frame state
        const nextHitTargets = buildHitTestTargets(
          proposal.order, proposal.depths, self._v2Assembly, agentAdapters,
        )
        self._v2PendingFrame = {
          nextMembership,
          nextDepths: proposal.depths,
          nextHitTargets,
        }

        // 6. Commit frame via E7 controller (sync; swap publishes reader state on success)
        self._v2Controller.commitFrame(proposal)
      } catch (err) {
        if (self._shadowDebugActive) {
          console.warn('[HallScene] V2 frame failed (V1 preserved):', err?.message || err)
        }
      }
    }

    /** V2 depth-based hit test using final visual order (agents only) */
    _v2HitTest(worldX, worldY) {
      if (!this._v2Active || !this._v2HitTargets || !this._v2AgentAdapter) return null
      const hit = hitTestPoint({ x: worldX, y: worldY }, this._v2HitTargets)
      if (hit && hit.kind === 'agent') {
        const sourceId = this._v2AgentAdapter.reverseLookup(hit.stableId)
        if (sourceId && this._agents.has(sourceId)) return sourceId
      }
      return null
    }

    update(dt) {
      if (this._destroyed) return false
      if (!this._inputController) this._ensureControllers()
      super.update(dt)
      if (!this._sceneBuilt) this._buildScene()
      if (this._needsSync) this._fullSyncAgents()
      if (this._simulationRuntime) {
        this._simulationRuntime.update?.(dt)
        this.syncAgentSnapshots(this._simulationRuntime.snapshots?.() || [])
        this._fullSyncAgentSnapshots()
        const phaseEvents = this._simulationRuntime.drainPhaseEvents?.() || []
        if (phaseEvents.length) this._simulationRuntime.onPhaseEvents?.(phaseEvents)
      }
      if (this._v2Active) {
        this._applyV2Depths()
      } else {
        this._sortByDepth()
      }
      // E6: re-evaluate flags, then shadow compute (never changes v1)
      this._ensureShadowFlags()
      this._runShadowPass()
      return true
    }


    _runShadowPass() {
      const sr = this._shadowRenderer
      if (!sr || !sr.enabled) return
      if (this._destroyed) return
      try {
        // Collect v1 object snapshots (read-only, never modifies scene)
        const v1Objects = collectV1Snapshots(me?.game?.world, this._mapData)
        // Compute shadow snapshot
        this._shadowState = sr.computeSnapshot(v1Objects)
        // Update debug overlay if active
        if (this._debugOverlay && this._shadowDebugActive) {
          this._debugOverlay.update(
            this._shadowState,
            sr.canonicalIr,
            sr.spatialGrid,
          )
        }
      } catch (err) {
        // Shadow failure must never affect v1 scene; only log when debug active
        if (this._shadowDebugActive) {
          console.warn('[HallScene] shadow pass failed (v1 preserved):', err?.message || err)
        }
      }
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
      this._pendingAgentSnapshots = []
      this._simulationAgentIds.clear()
      this._simulationRuntime = null
      this._availablePersonas = null
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
      // E6: dispose shadow renderer and debug overlay
      if (this._shadowRenderer) {
        try { this._shadowRenderer.dispose() } catch (err) { /* ignore */ }
        this._shadowRenderer = null
      }
      this._shadowState = null
      if (this._debugOverlay) {
        try { this._debugOverlay.dispose() } catch (err) { /* ignore */ }
        this._debugOverlay = null
      }
      this._shadowDebugActive = false
      // E12: clean up V2 activation state
      this.deactivateV2()
    }
  }
}
