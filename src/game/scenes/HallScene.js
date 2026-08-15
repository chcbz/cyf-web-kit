/**
 * 閴存瘍娑斿宸洪崷鐑樻珯 - melonJS Stage (manual asset loading)
 */

import { DEPTH_LAYERS, HALL_SCENE_HEIGHT, HALL_SCENE_WIDTH } from '../config.js'
import { createCameraController } from '../camera/cameraController.js'
import { classifyViewportResize } from '../camera/resizePolicy.js'
import { screenToWorld } from '../camera/cameraTransform.js'
import { createInputController } from '../input/inputController.js'
import { createInteractionLock } from '../input/interactionLock.js'
import { clientToViewport, clockwiseRectToViewport, localToViewport, quadToViewport } from '../viewportTransform.js'
import { createShadowRenderer, parseOcclusionDebugFlag } from '../occlusion/shadowRenderer.js'
import { hasV2ActivationEnvelope, assembleV2Scene, computeUnifiedWorldOrder, buildHitTestTargets, hitTestPoint, buildFrameProposal, createEmptyMembershipState, registerAgentsInGrid, unregisterAgentFromGrid, createSceneActivationController, projectActivationEnvelope } from '../occlusion/hallSceneAssembly.js'
import { createRuntimeAgentAdapter, defaultSpawnResolver, defaultChunkResolver } from '../occlusion/runtimeAgentAdapter.js'
import { createDebugOverlay } from '../occlusion/debugOverlay.js'
import { HALL_SCENE_DEPTH_BANDS, HALL_SCENE_LEGACY_OCCLUDER_LAYERS, hallV2WorldDepth } from '../occlusion/hallSceneDepthBands.js'
import { isValidSourceEntityId } from '../occlusion/sourceIdentity.js'

const DEFAULT_INPUT_SNAPSHOT = Object.freeze({ activeGesture: 'none', interactionLocked: false })
const V2_ROSTER_RETRY_COOLDOWN_MS = 250
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
      this._imageLayersByName = new Map()
      this._worldUiOverlay = null
      // Handle-scoped identity cache: avoids allocating a long UTF-16 hex
      // string every draw while allowing removed handles to be collected.
      this._worldUiIdentityCache = new WeakMap()
      this._hotspotSnapshot = null
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
      this._initialBuildFatal = false
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
      this._shadowAssemblySource = null
      // E6: debug overlay (only created when ?jytOcclusionDebug=1)
      this._debugOverlay = null
      this._shadowDebugActive = false
      this._lastViewport = null
      this._currentViewport = normalizeViewport(me.game.viewport)
      this._displayViewport = { ...this._currentViewport }
      this._visibleViewport = normalizeVisibleViewport(null, this._currentViewport)
      // E12: V2 activation gate (production default; only explicit test opt-out keeps fallback)
      this._v2Generation = 0
      this._v2Assembly = null
      this._v2Active = false
      this._v2Controller = null
      this._v2AgentAdapter = null
      this._v2Membership = createEmptyMembershipState()
      this._v2HitTargets = null
      this._v2Depths = null
      this._v2RenderableHandles = null
      this._v2PropRenderables = new Map()     // stableId → melonJS prop renderable
      this._v2StagingRenderables = null        // Set<melonJS renderable> staging-owned (fragments only)
      this._v2FrameSerial = Promise.resolve()   // serialized async frame processing
      this._v2FramePending = false
      this._v2PendingFrame = null
      this._v2PendingActivation = null  // activation staging before commit publish
      this._v2DestroyPromise = Promise.resolve()
      this._v2RosterInFlight = false
      this._v2LastRosterFailure = null      // { ids: Set<string>, at: number, logged: boolean } | null
      this._v2Diagnostics = []               // structured, read-only diagnostics
      this._v2OwnsRenderStack = false
      this._v1RenderableDepths = null
      this._tmxSha256 = null
    }

    onAgentClick(cb)   { this._onAgentClick = cb }
    onHotspotClick(cb) { this._onHotspotClick = cb }
    onReady(cb)        { this._onReady = cb }

    get sceneBuildState() {
      if (this._sceneBuilt) return 'ready'
      if (this._initialBuildFatal) return 'failed'
      return 'pending'
    }

        /** Set TMX SHA-256 provenance for V2 activation gate. */
    setTmxSha256(sha) { this._tmxSha256 = sha }

    setMapData(mapData) {
      // E15 P2: an active V2 refresh must stage the replacement BEFORE
      // publishing new mapData. Keep this._mapData/shadow renderer aligned
      // with the currently live scene until the new transaction commits.
      if (!this._destroyed && this._v2Active && this._v2Controller && this._v2Assembly) {
        this._v2Generation++  // invalidate any pending async continuations
        this._replaceV2ForMapData(mapData)
        return
      }

      this._mapData = mapData
      this._syncWorldUiOverlayBounds(mapData)
      // Propagate to existing shadow renderer if any
      if (this._shadowRenderer) {
        this._shadowRenderer.setMapData(mapData)
      }
      if (this._destroyed) return

      // E12: always invalidate any in-flight activation on map change
      this._v2Generation++  // kill all pending async continuations
      if (this._v2Controller || this._v2AgentAdapter || this._v2Assembly || this._v2StagingRenderables) {
        this.deactivateV2()
      }
      // Only auto-activate if scene is already built (props registered).
      // Otherwise _buildScene will trigger activation after prop registration.
      if (this._sceneBuilt && this._shouldActivateV2() && this.hasV2Support()) {
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
        // Ensure renderer exists, aligned with the currently committed V2
        // assembly (projected renderSchemaVersion=2 input) and enabled.
        const shadowAssembly = this._v2Assembly
        const shadowMapData = this._shadowMapData()
        if (!this._shadowRenderer) {
          this._shadowRenderer = createShadowRenderer({ mapData: shadowMapData })
          this._shadowAssemblySource = shadowAssembly
        } else if (this._shadowAssemblySource !== shadowAssembly) {
          this._shadowRenderer.setMapData(shadowMapData)
          this._shadowAssemblySource = shadowAssembly
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
          this._shadowAssemblySource = null
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

    _clientToViewport(clientX, clientY, event = null) {
      const viewport = this._viewportSize()
      const canvas = this._canvasElement()
      if (viewport.width <= 0 || viewport.height <= 0) return { x: clientX, y: clientY }

      // A virtual landscape stage is rotated with CSS while the browser remains
      // in portrait coordinates. Resolve the transformed canvas quad first so
      // drag, pinch and hit-test axes stay aligned with what the user sees.
      try {
        const quad = canvas?.getBoxQuads?.({ box: 'border' })?.[0]
        const transformedPoint = quad && quadToViewport(clientX, clientY, quad, viewport)
        if (transformedPoint) return transformedPoint
      } catch { /* getBoxQuads is optional on older embedded browsers */ }

      const rect = this._displayRect()
      if (canvas?.closest?.('.hall-stage.is-virtual-landscape')) {
        const rotatedPoint = clockwiseRectToViewport(clientX, clientY, rect, viewport)
        if (rotatedPoint) return rotatedPoint
      }

      const localPoint = localToViewport(
        Number(event?.offsetX),
        Number(event?.offsetY),
        { width: canvas?.clientWidth, height: canvas?.clientHeight },
        viewport
      )
      if (Number.isFinite(event?.offsetX) && Number.isFinite(event?.offsetY) && localPoint) return localPoint

      if (!rect?.width || !rect?.height) return { x: clientX, y: clientY }
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
              const point = this._clientToViewport(event.clientX, event.clientY, event)
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
              // V2 hit-test takes priority when active
              if (this._v2Active) {
                const v2Hit = this._v2HitTest(world.x, world.y)
                if (v2Hit === id) return true
              }
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

      const BLEND_MODES = {
        'lighting-overlay': 'screen'
      }

      let rendered = 0

      Object.entries(tmxLayers).forEach(([name, tmxLayer]) => {
        const resourceName = tmxLayer.resourceName || name
        const image = me.loader.getImage(resourceName)
        if (!image) {
          console.warn('[HallScene] Image not loaded:', resourceName, 'for layer:', name)
          return
        }

        // Unknown imagelayers are non-production fallbacks; keep them inside the
        // base band without declaration-order depth.
        const depth = LAYER_DEPTH[name] !== undefined ? LAYER_DEPTH[name] : (HALL_SCENE_DEPTH_BANDS.BASE_MAX_EXCLUSIVE - 1)
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
        this._imageLayersByName.set(name, { handle: imageLayer, legacyDepth: depth, attached: true })

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
        if (depth >= HALL_SCENE_DEPTH_BANDS.BASE_MAX_EXCLUSIVE) {
          throw new RangeError(`HallScene base tile depth ${depth} escapes the background band`)
        }
        const imageLayer = this._createCustomImageLayer(0, 0, vpW, vpH, offCanvas, { opacity: null })
        me.game.world.addChild(imageLayer, depth)
        this._imageLayers.push(imageLayer)
        rendered++
      })
      return rendered > 0
    }

    _buildScene() {
      if (this._destroyed || this._sceneBuilt || this._initialBuildFatal) return false
      const mapData = this._mapData
      let canonicalHotspots
      try {
        // Hotspots own hit geometry and world-ui entries, so their complete
        // contract must pass before any map child, overlay, or ready signal is
        // published. V1 has no marker staging transaction to repair a partial
        // scene after publication.
        canonicalHotspots = this._canonicalizeHotspots(mapData)
      } catch (error) {
        this._hotspotSnapshot = null
        this._initialBuildFatal = true
        console.warn('[HallScene] Hotspot contract failed closed:', error?.message || error)
        return false
      }

      this._initializeViewport()
      const { width: vpW, height: vpH } = this._viewportSize()
      if (vpW <= 0 || vpH <= 0) return false
      const mapObjects = Array.isArray(mapData?.hotspots) ? mapData.hotspots : []
      const hotspots = canonicalHotspots.hotspots
      this._hotspotSnapshot = canonicalHotspots.snapshot

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
          // World-ui is painted once by HallScene's ordered overlay. Keep this
          // renderable for hit geometry only; painting here would depend on
          // sibling insertion order at the same depth.
        }

        drawWorldUi(renderer) {
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
        const drawPolygon = h.polygon?.map(point => ({
          x: (point.x / canonicalHotspots.projection.coordinateWidth * vpW) - ox,
          y: (point.y / canonicalHotspots.projection.coordinateHeight * vpH) - oy
        })) || null

        const marker = new HotspotMarker(ox, oy, ow, oh, { ...h, drawPolygon })
        marker.setFeedback(this._hotspotState.get(h.id))

        me.game.world.addChild(marker, HALL_SCENE_DEPTH_BANDS.WORLD_UI)
        this._hotspots.push({ marker, hitArea: marker, data: h })
      })
      // Render prop tile objects from TMX collection-of-images tilesets.
      // E16A: no declaration-order propDepth increments. V1/fallback props are
      // placed in the static agent band; V2 maps them into the world band on commit.
      const propDepth = DEPTH_LAYERS.AGENTS
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
        const stableId = h.stableId || h.properties?.stableId
        if (stableId) {
          this._v2PropRenderables.set(stableId, propLayer)
        }
      })

      this._ensureControllers()
      this._ensureWorldUiOverlay()

      this._sceneBuilt = true
      // E15 P1: sync pending agents BEFORE first activation so the first
      // committed V2 scene already contains every current agent in the
      // adapter, renderable handles, and V2 world-band depths.
      this._fullSyncAgents()
      // E12: Auto-activate V2 if feature gate is enabled and map supports it
      if (this._shouldActivateV2() && this.hasV2Support()) {
        this.activateV2()
      }
      if (this._onReady) this._onReady()
      return true
    }

    _worldUiBounds(mapData = this._mapData) {
      return {
        width: Number(mapData?.coordinateWidth) || HALL_SCENE_WIDTH,
        height: Number(mapData?.coordinateHeight) || HALL_SCENE_HEIGHT
      }
    }

    _syncWorldUiOverlayBounds(mapData = this._mapData) {
      if (!this._worldUiOverlay) return
      const { width, height } = this._worldUiBounds(mapData)
      this._worldUiOverlay.width = width
      this._worldUiOverlay.height = height
    }

    _validWorldUiSourceId(sourceId) {
      return isValidSourceEntityId(sourceId)
    }

    _encodeWorldUiStableId(kind, sourceId) {
      let codeUnits = ''
      for (let index = 0; index < sourceId.length; index++) {
        codeUnits += sourceId.charCodeAt(index).toString(16).padStart(4, '0')
      }
      // This local sorting identity is not a canonical-IR stableId, so UUID
      // agent IDs must retain their names/bubbles rather than disappearing.
      return `jyt.world-ui.${kind}.u${codeUnits}.v1`
    }

    _worldUiStableId(kind, sourceId, handle = null) {
      // world-ui is synchronous and deliberately independent from the async
      // world adapter. Every UTF-16 code unit is losslessly represented, so
      // Unicode/emoji never depend on TextEncoder or UTF-8 replacement rules.
      if ((kind !== 'agent' && kind !== 'hotspot') || !this._validWorldUiSourceId(sourceId)) return null
      if (handle && (typeof handle === 'object' || typeof handle === 'function')) {
        const cached = this._worldUiIdentityCache.get(handle)
        if (cached?.kind === kind && cached.sourceId === sourceId) return cached.stableId
        const stableId = this._encodeWorldUiStableId(kind, sourceId)
        this._worldUiIdentityCache.set(handle, { kind, sourceId, stableId })
        return stableId
      }
      return this._encodeWorldUiStableId(kind, sourceId)
    }

    _hotspotField(hotspot, field) {
      if (hotspot && Object.prototype.hasOwnProperty.call(hotspot, field)) return hotspot[field]
      return hotspot?.properties?.[field]
    }

    _hotspotFinite(value, field) {
      const valueType = typeof value
      if ((valueType !== 'number' && valueType !== 'string') ||
          (valueType === 'string' && value.trim().length === 0)) {
        throw new Error(`hotspot ${field} must be finite`)
      }
      const number = Number(value)
      if (!Number.isFinite(number)) throw new Error(`hotspot ${field} must be finite`)
      return number
    }

    _hotspotProjectionDimension(value, fallback, field) {
      const dimension = value === undefined ? fallback : this._hotspotFinite(value, field)
      if (!(dimension > 0)) throw new Error(`hotspot ${field} must be greater than zero`)
      return dimension
    }

    _validateHotspotPolygon(id, polygon) {
      if (!polygon || polygon.length < 3) {
        throw new Error(`hotspot ${id} polygon requires at least three points`)
      }
      const uniquePoints = new Set(polygon.map(point => JSON.stringify([point.x, point.y])))
      if (uniquePoints.size !== polygon.length) {
        throw new Error(`hotspot ${id} polygon vertices must be unique`)
      }

      let twiceArea = 0
      let maxCoordinate = 1
      for (let index = 0; index < polygon.length; index++) {
        const point = polygon[index]
        const next = polygon[(index + 1) % polygon.length]
        twiceArea += point.x * next.y - next.x * point.y
        maxCoordinate = Math.max(maxCoordinate, Math.abs(point.x), Math.abs(point.y))
      }
      const areaEpsilon = Math.max(1e-9, Number.EPSILON * maxCoordinate * maxCoordinate * polygon.length * 16)
      if (Math.abs(twiceArea) <= areaEpsilon) {
        throw new Error(`hotspot ${id} polygon area must be non-zero`)
      }
    }

    _canonicalizeHotspots(mapData, floorRegistry = null) {
      const projection = {
        coordinateWidth: this._hotspotProjectionDimension(mapData?.coordinateWidth, HALL_SCENE_WIDTH, 'coordinateWidth'),
        coordinateHeight: this._hotspotProjectionDimension(mapData?.coordinateHeight, HALL_SCENE_HEIGHT, 'coordinateHeight')
      }
      const seenIds = new Set()
      const canonical = []
      const source = Array.isArray(mapData?.hotspots) ? mapData.hotspots : []
      for (const hotspot of source) {
        if (!hotspot || hotspot.type === 'prop' || !hotspot.panel) continue
        const id = hotspot.id
        if (!this._validWorldUiSourceId(id)) throw new Error('hotspot id must be a valid source entity ID')
        if (seenIds.has(id)) throw new Error(`duplicate hotspot id: ${id}`)
        seenIds.add(id)

        const panel = hotspot.panel
        if (typeof panel !== 'string' || panel.trim().length === 0) throw new Error(`hotspot ${id} panel must be a non-empty string`)
        const rawFloorId = this._hotspotField(hotspot, 'floorId')
        const floorId = rawFloorId === undefined ? 'floor-1' : rawFloorId
        if (!this._validWorldUiSourceId(floorId)) throw new Error(`hotspot ${id} floorId must be a valid source entity ID`)
        if (floorRegistry) {
          if (!Number.isSafeInteger(floorRegistry[floorId])) throw new Error(`hotspot ${id} references unknown V2 floor: ${floorId}`)
        } else if (floorId !== 'floor-1') {
          throw new Error(`hotspot ${id} floorId ${floorId} is unavailable in V1`)
        }

        const rawElevation = this._hotspotField(hotspot, 'elevation')
        const elevation = rawElevation === undefined ? 0 : this._hotspotFinite(rawElevation, `${id}.elevation`)
        if (!Number.isSafeInteger(elevation)) throw new Error(`hotspot ${id} elevation must be an integer`)
        const x = this._hotspotFinite(hotspot.x, `${id}.x`)
        const y = this._hotspotFinite(hotspot.y, `${id}.y`)
        const w = this._hotspotFinite(hotspot.w, `${id}.w`)
        const h = this._hotspotFinite(hotspot.h, `${id}.h`)
        if (!(w > 0) || !(h > 0)) throw new Error(`hotspot ${id} geometry width and height must be greater than zero`)
        if (hotspot.shape !== undefined && hotspot.shape !== 'rect' && hotspot.shape !== 'polygon') {
          throw new Error(`hotspot ${id} has unsupported shape: ${hotspot.shape}`)
        }
        const shape = hotspot.shape === 'polygon' ? 'polygon' : 'rect'
        if (hotspot.polygon != null && !Array.isArray(hotspot.polygon)) throw new Error(`hotspot ${id} polygon must be an array`)
        const polygon = hotspot.polygon == null ? null : hotspot.polygon.map((point, index) => ({
          x: this._hotspotFinite(point?.x, `${id}.polygon[${index}].x`),
          y: this._hotspotFinite(point?.y, `${id}.polygon[${index}].y`)
        }))
        if (shape === 'polygon') this._validateHotspotPolygon(id, polygon)
        const rawSortAnchor = hotspot.sortAnchor
        const sortAnchorX = this._hotspotField(hotspot, 'sortAnchorX') ?? rawSortAnchor?.x
        const sortAnchorY = this._hotspotField(hotspot, 'sortAnchorY') ?? rawSortAnchor?.y
        const sortAnchor = {
          x: sortAnchorX === undefined ? null : this._hotspotFinite(sortAnchorX, `${id}.sortAnchor.x`),
          y: sortAnchorY === undefined ? null : this._hotspotFinite(sortAnchorY, `${id}.sortAnchor.y`)
        }
        const data = {
          ...hotspot, id, panel, shape, x, y, w, h, polygon, floorId, elevation,
          ...(sortAnchor.x === null && sortAnchor.y === null ? {} : { sortAnchor })
        }
        canonical.push({
          id, panel, type: typeof hotspot.type === 'string' ? hotspot.type : '', floorId, elevation,
          sortAnchor, geometry: { shape, x, y, w, h, polygon }, data
        })
      }
      const snapshot = JSON.stringify({
        projection,
        hotspots: canonical.map(({ id, panel, type, floorId, elevation, sortAnchor, geometry }) => (
          { id, panel, type, floorId, elevation, sortAnchor, geometry }
        ))
      })
      return { hotspots: canonical.map(item => item.data), projection, snapshot }
    }

    _worldUiFloorOrder(floorId) {
      const registry = this._v2Assembly?.canonicalIr?.floorRegistry || { 'floor-1': 0 }
      return Number.isSafeInteger(registry?.[floorId]) ? registry[floorId] : null
    }

    _worldUiEntries() {
      const entries = []
      for (const [agentId, agent] of this._agents) {
        const stableId = this._worldUiStableId('agent', agentId, agent)
        if (!stableId) continue
        const sceneObject = this._v2AgentAdapter?.lookup?.(agentId)
        const floorOrder = this._worldUiFloorOrder(sceneObject?.floorId || 'floor-1')
        if (!Number.isSafeInteger(floorOrder)) continue
        entries.push({
          floorOrder,
          elevation: Number.isSafeInteger(sceneObject?.elevation) ? sceneObject.elevation : 0,
          fixedPointY: Math.round((Number(agent?.pos?.y) || 0) * 256),
          stableId,
          draw: renderer => agent.drawWorldUi?.(renderer)
        })
      }
      for (const { marker, data } of this._hotspots) {
        if (!marker) continue
        const stableId = this._worldUiStableId('hotspot', data?.id, marker)
        if (!stableId || !Number.isSafeInteger(data?.elevation)) continue
        const floorOrder = this._worldUiFloorOrder(data?.floorId)
        if (!Number.isSafeInteger(floorOrder)) continue
        const sortAnchorY = Number(data?.sortAnchor?.y ?? data?.sortAnchorY)
        entries.push({
          floorOrder,
          elevation: data.elevation,
          fixedPointY: Math.round((Number.isFinite(sortAnchorY) ? sortAnchorY : ((Number(marker.pos?.y) || 0) + (Number(marker.height) || 0))) * 256),
          stableId,
          draw: renderer => marker.drawWorldUi?.(renderer)
        })
      }
      return entries.sort((first, second) => {
        if (first.floorOrder !== second.floorOrder) return first.floorOrder - second.floorOrder
        if (first.elevation !== second.elevation) return first.elevation - second.elevation
        if (first.fixedPointY !== second.fixedPointY) return first.fixedPointY - second.fixedPointY
        const length = Math.min(first.stableId.length, second.stableId.length)
        for (let index = 0; index < length; index++) {
          const difference = first.stableId.charCodeAt(index) - second.stableId.charCodeAt(index)
          if (difference !== 0) return difference
        }
        return first.stableId.length - second.stableId.length
      })
    }

    _ensureWorldUiOverlay() {
      if (this._worldUiOverlay) {
        this._worldUiOverlay.depth = HALL_SCENE_DEPTH_BANDS.WORLD_UI
        this._syncWorldUiOverlayBounds()
        return this._worldUiOverlay
      }

      const scene = this
      const { width, height } = this._worldUiBounds()
      class WorldUiOverlay extends me.Renderable {
        constructor() {
          super(0, 0, width, height)
          this.anchorPoint.set(0, 0)
          this.floating = false
          this.isKinematic = true
        }

        draw(renderer) {
          if (scene._destroyed) return
          for (const entry of scene._worldUiEntries()) entry.draw(renderer)
        }
      }

      const overlay = new WorldUiOverlay()
      me.game.world.addChild(overlay, HALL_SCENE_DEPTH_BANDS.WORLD_UI)
      this._worldUiOverlay = overlay
      return overlay
    }

    _pinWorldUiOverlayDepth() {
      if (this._worldUiOverlay) {
        this._worldUiOverlay.depth = HALL_SCENE_DEPTH_BANDS.WORLD_UI
      }
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
        const id = this._validWorldUiSourceId(data?.agentId) ? data.agentId : null
        if (!id) return
        let agent = this._agents.get(id)
        const personaCode = String(data?.personaCode || '').toLowerCase()
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
        const id = this._validWorldUiSourceId(snapshot?.agentId) ? snapshot.agentId : null
        const personaCode = String(snapshot?.personaCode || '').toLowerCase()
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

    _v2RenderDepth(logicalDepth) {
      return hallV2WorldDepth(logicalDepth)
    }

    _captureV1RenderableDepths() {
      if (this._v1RenderableDepths) return
      const depths = new Map()
      for (const [, handle] of this._v2PropRenderables) {
        if (handle && typeof handle.depth === 'number') depths.set(handle, handle.depth)
      }
      for (const [, handle] of this._agents) {
        if (handle && typeof handle.depth === 'number') depths.set(handle, handle.depth)
      }
      this._v1RenderableDepths = depths
    }

    _enterV2RenderOwnership() {
      if (this._v2OwnsRenderStack) return
      this._captureV1RenderableDepths()
      const legacyNames = new Set(HALL_SCENE_LEGACY_OCCLUDER_LAYERS)
      for (const [name, record] of this._imageLayersByName) {
        if (legacyNames.has(name) && record.attached) {
          me.game.world.removeChild(record.handle)
          record.attached = false
        }
      }
      const lighting = this._imageLayersByName.get('lighting-overlay')
      if (lighting) lighting.handle.depth = HALL_SCENE_DEPTH_BANDS.LIGHTING
      for (const { marker } of this._hotspots) {
        if (marker) marker.depth = HALL_SCENE_DEPTH_BANDS.WORLD_UI
      }
      this._v2OwnsRenderStack = true
    }

    _restoreV1RenderOwnership() {
      if (this._v1RenderableDepths) {
        for (const [handle, depth] of this._v1RenderableDepths) {
          try { handle.depth = depth } catch (error) {}
        }
      }
      const legacyNames = new Set(HALL_SCENE_LEGACY_OCCLUDER_LAYERS)
      for (const [name, record] of this._imageLayersByName) {
        if (name === 'lighting-overlay') {
          try { record.handle.depth = record.legacyDepth } catch (error) {}
        }
        if (!this._destroyed && legacyNames.has(name) && !record.attached) {
          try {
            me.game.world.addChild(record.handle, record.legacyDepth)
            record.attached = true
          } catch (error) {}
        }
      }
      for (const { marker } of this._hotspots) {
        if (marker) {
          try { marker.depth = HALL_SCENE_DEPTH_BANDS.WORLD_UI } catch (error) {}
        }
      }
      this._v2OwnsRenderStack = false
      this._v1RenderableDepths = null
      this._v2RenderableHandles = null
    }

    _reapplyCommittedV2RenderDepths() {
      this._pinWorldUiOverlayDepth()
      if (!this._v2Active || !this._v2Depths) return
      for (const [stableId, handle] of this._v2RenderableHandles || []) {
        const logicalDepth = this._v2Depths[stableId]
        if (logicalDepth !== undefined && handle) handle.depth = this._v2RenderDepth(logicalDepth)
      }
    }

    /**
     * E16A P2 fail-closed error-state render policy.
     * No Y sort, no mask/AABB, no declaration-order depth: only a fixed,
     * deterministic band for the complete fallback scene. Lighting, hotspots,
     * and world-ui ownership remain untouched.
     */
    _applyErrorStateRenderDepths() {
      this._pinWorldUiOverlayDepth()
      if (this._destroyed || this._v2Active) return
      for (const [, handle] of this._agents) {
        if (handle) {
          try { handle.depth = HALL_SCENE_DEPTH_BANDS.ERROR_STATE_AGENT_DEPTH } catch { /* noop */ }
        }
      }
      for (const [, handle] of this._v2PropRenderables) {
        if (handle) {
          try { handle.depth = HALL_SCENE_DEPTH_BANDS.ERROR_STATE_PROP_DEPTH } catch { /* noop */ }
        }
      }
    }

    /** Production V2 is the default renderer. Tests may opt out explicitly. */
    _shouldActivateV2() {
      return typeof window !== 'undefined' && window.__JYT_V2_ENABLED !== false
    }

    /** Check if map data supports V2 occlusion system */
    hasV2Support() {
      if (!this._mapData) return false
      if (!hasV2ActivationEnvelope(this._mapData, this._tmxSha256)) return false
      if (!this._tmxSha256) return false
      return true
    }

    /** Get current active renderer mode */
    get activeRendererMode() {
      return this._v2Active ? 'v2' : 'v1'
    }

    /** Get the active render schema version (whole-map, one-shot switch). */
    get renderSchemaVersion() {
      return this._v2Active ? '2' : '1'
    }

    getV2HitTargets() { return this._v2HitTargets ?? null }
    getV2Depths() { return this._v2Depths ?? null }
    getV2Diagnostics() { return this._v2Diagnostics.slice() }

    /** Append a structured, read-only diagnostic and emit one controlled warning. */
    _recordV2Diagnostic(code, label, message) {
      const diagnostic = Object.freeze({
        code, label, message, at: Date.now()
      })
      this._v2Diagnostics.push(diagnostic)
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(`[HallScene] V2 ${code}: ${label}: ${message}`)
      }
    }

    /** Activate V2 occlusion system via E7 controller. Returns true if activation started. */
    activateV2() {
      if (this._destroyed) return false
      if (this._v2Active) return true
      // Repeated activation while a switch is already in flight is a no-op;
      // the in-flight transaction owns the assembly/controller until commit.
      if (this._v2Assembly || this._v2Controller || this._v2PendingActivation) return false
      if (!this._mapData || !hasV2ActivationEnvelope(this._mapData, this._tmxSha256)) return false

      const gen = ++this._v2Generation

      try {
        this._v2Assembly = assembleV2Scene(this._mapData, this._tmxSha256)
        const ir = this._v2Assembly.canonicalIr
        // Fail closed: the whole map must switch to renderSchemaVersion=2 in
        // one transaction. Any mismatch leaves V1 active.
        if (ir.renderSchemaVersion !== '2' || ir.sceneId !== 'juyiting-main') {
          console.warn('[HallScene] V2: assembled IR failed renderSchemaVersion=2 gate')
          this.deactivateV2()
          return false
        }
        try {
          const v2Hotspots = this._canonicalizeHotspots(this._mapData, ir.floorRegistry)
          if (v2Hotspots.snapshot !== this._hotspotSnapshot) {
            throw new Error('V1/V2 hotspot snapshots differ; marker staging is required')
          }
        } catch (error) {
          this._recordV2Diagnostic('V2_HOTSPOT_CONTRACT_FAILED', 'hotspot', error?.message || String(error))
          this.deactivateV2()
          return false
        }

        // Create E3 agent adapter
        const adapter = createRuntimeAgentAdapter(
          defaultSpawnResolver('floor-1', 0),
          defaultChunkResolver(),
          'juyiting-main',
        )
        this._v2AgentAdapter = adapter

        // Build renderable registry — fragments created OFFLINE (not added to world yet)
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

        // (b) Fragments — create handles offline, do NOT addChild until commit
        for (const f of ir.fragments) {
          const image = me.loader.getImage(f.assetRef)
          if (!image) {
            console.warn('[HallScene] V2: fragment asset not loaded: %s; activation failed', f.assetRef)
            this._v2AgentAdapter.destroy()
            this._v2AgentAdapter = null
            this._v2Assembly = null
            return false
          }

          const handle = this._createFragmentHandle(image, f)
          renderables.set(f.stableId, handle)
          stagingFragments.add(handle)
          // NOT added to world yet — will be added in commit.apply
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
              // Compute initial unified world order — store in pending activation,
              // NOT in live reader state. Published during commit.apply.
              const initialAdapters = []
              for (const id of adapter.sourceEntityIds) {
                const so = adapter.lookup(id)
                const entity = self._agents.get(id)
                if (so && entity) initialAdapters.push({ sceneObject: so, entity })
              }
              registerAgentsInGrid(self._v2Assembly.spatialGrid, initialAdapters, 'juyiting-main', 'floor-1')
              const initOrder = computeUnifiedWorldOrder(self._v2Assembly, initialAdapters, createEmptyMembershipState())
              self._v2PendingActivation = {
                depths: initOrder.depths,
                membership: initOrder.nextMembership,
                hitTargets: buildHitTestTargets(initOrder.order, initOrder.depths, self._v2Assembly, initialAdapters),
                stagingFragments,
                renderables: savedRenderables,
              }
              return {
                sceneId: ctx.sceneId, mode: ctx.mode,
                ownerTransactionId: ctx.transactionId,
                children: Object.freeze(nodeValues),
                order: Object.freeze(initOrder.order),
                depths: Object.freeze(initOrder.depths),
                dispose: () => {
                  // Only dispose OWN staging fragments (captured locally, not global ref)
                  for (const handle of stagingFragments) {
                    try { me.game.world.removeChild(handle) } catch (e) {}
                  }
                  // Clear global only if it still points to this set
                  if (self._v2StagingRenderables === stagingFragments) {
                    self._v2StagingRenderables = null
                  }
                  if (self._v2PendingActivation?.stagingFragments === stagingFragments) {
                    self._v2PendingActivation = null
                  }
                },
              }
            },
            validateConstraints: (scene, ctx) => ({ order: scene.order }),
            commit: (ctx) => {
              const pa = self._v2PendingActivation
              const oldRenderableDepths = new Map()
              for (const [sid, h] of savedRenderables) {
                if (h && typeof h.depth === 'number') oldRenderableDepths.set(sid, h.depth)
              }
              const oldRenderOwnership = self._v2OwnsRenderStack
              // Remember old reader state for rollback
              const oldActive = self._v2Active
              const oldDepths = self._v2Depths
              const oldMembership = self._v2Membership
              const oldHitTargets = self._v2HitTargets

              ctx.swap(
                () => {
                  // ── apply ──
                  // 1. Atomically take V2 render-stack ownership: retain base/lighting,
                  // remove legacy full-map occluders, and move independent bands.
                  self._enterV2RenderOwnership()
                  // 2. Add offline fragments directly in the mapped world band.
                  if (pa && pa.stagingFragments && pa.depths && pa.renderables) {
                    for (const [sid, handle] of pa.renderables) {
                      if (!pa.stagingFragments.has(handle)) continue
                      me.game.world.addChild(handle, self._v2RenderDepth(pa.depths[sid]))
                    }
                  }
                  // 3. Apply mapped depths to all V2 world renderables.
                  if (pa && pa.depths && pa.renderables) {
                    for (const [sid, h] of pa.renderables) {
                      const d = pa.depths[sid]
                      if (d !== undefined && h) h.depth = self._v2RenderDepth(d)
                    }
                  }
                  // 4. Sort world (throw propagates)
                  if (me.game.world && typeof me.game.world.sort === 'function') {
                    me.game.world.sort(true)
                  }
                  // 5. Publish reader state from pending activation
                  if (pa) {
                    self._v2Depths = pa.depths
                    self._v2Membership = pa.membership
                    self._v2HitTargets = pa.hitTargets
                  }
                  self._v2RenderableHandles = new Map(pa?.renderables || [])
                  self._v2Active = true
                  self._v2PendingActivation = null
                },
                () => {
                  // ── rollback ──
                  // 1. Restore reader state FIRST (must not throw)
                  self._v2Active = oldActive
                  self._v2Depths = oldDepths
                  self._v2Membership = oldMembership
                  self._v2HitTargets = oldHitTargets
                  self._v2RenderableHandles = null
                  self._v2PendingActivation = null
                  // 2. Best-effort: remove newly added fragments
                  if (pa && pa.stagingFragments) {
                    for (const handle of pa.stagingFragments) {
                      try { me.game.world.removeChild(handle) } catch (e) {}
                    }
                  }
                  // 3. Best-effort: restore old prop/agent depths and V1 layer ownership.
                  for (const [sid, d] of oldRenderableDepths) {
                    const h = savedRenderables.get(sid)
                    if (h) { try { h.depth = d } catch (e) {} }
                  }
                  if (!oldRenderOwnership) self._restoreV1RenderOwnership()
                  // 4. Best-effort: restore world sort
                  if (me.game.world && typeof me.game.world.sort === 'function') {
                    try { me.game.world.sort(true) } catch (e) {}
                  }
                },
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
                    if (d !== undefined && h) h.depth = self._v2RenderDepth(d)
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
                  // Full rollback: restore renderable depths (must never throw).
                  for (const [sid, d] of oldRenderableDepths) {
                    const h = savedRenderables.get(sid)
                    if (h && typeof h.depth === 'number') {
                      try { h.depth = d } catch (e) {}
                    }
                  }
                  if (me.game.world && typeof me.game.world.sort === 'function') {
                    try { me.game.world.sort(true) } catch (e) {}
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
          // Activation committed; reader state already published via commit.apply.
          // v2Active is true; controller is active.
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


    /** Create an offline fragment renderable handle (shared by activateV2 and _reactivateV2ForRoster). */
    _createFragmentHandle(image, fragment) {
      const f = fragment
      const FragRenderable = class extends me.Renderable {
        constructor() {
          super(f.destinationRect.x, f.destinationRect.y,
            f.destinationRect.width, f.destinationRect.height)
          this.anchorPoint.set(0, 0)
          this._img = image
          this._sx = f.sourceRect.x
          this._sy = f.sourceRect.y
          this._sw = f.sourceRect.width
          this._sh = f.sourceRect.height
          this.floating = false
        }
        draw(renderer) {
          const ctx = renderer.getContext?.()
          if (ctx && this._img) {
            ctx.drawImage(this._img, this._sx, this._sy, this._sw, this._sh,
              this.pos.x, this.pos.y, this.width, this.height)
          }
        }
      }
      return new FragRenderable()
    }
    /** Deactivate V2 system. Returns a promise that settles when cleanup is complete. */
    deactivateV2() {
      this._v2Generation++ // invalidate all pending async continuations
      this._v2Active = false

      // Remove staging fragments from world (may have been published or not)
      if (this._v2StagingRenderables) {
        for (const handle of this._v2StagingRenderables) {
          try { me.game.world.removeChild(handle) } catch (e) {}
        }
        this._v2StagingRenderables = null
      }

      // Clear pending activation (unpublished reader state)
      this._v2PendingActivation = null

      const controller = this._v2Controller
      this._v2Controller = null
      let destroyPromise = Promise.resolve()
      if (controller) {
        destroyPromise = controller.destroy()
          .then(() => {}, err => {
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
      this._v2RenderableHandles = null
      this._v2Membership = createEmptyMembershipState()
      this._v2FramePending = false
      this._v2PendingFrame = null
      this._v2RosterInFlight = false
      this._v2LastRosterFailure = null

      this._restoreV1RenderOwnership()
      if (!this._destroyed) {
        try { me.game.world.sort?.(true) } catch (error) {}
      }

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

        // 1. Detect agent roster changes (additions/removals) → full reactivate
        const currentIds = new Set(self._agents.keys())
        const adapterIds = new Set(adapter.sourceEntityIds)
        const hasRosterChange =
          currentIds.size !== adapterIds.size ||
          [...currentIds].some(id => !adapterIds.has(id)) ||
          [...adapterIds].some(id => !currentIds.has(id))

        if (hasRosterChange) {
          if (self._v2RosterInFlight) return
          const failure = self._v2LastRosterFailure
          const sameRosterAsFailure = failure && failure.ids.size === currentIds.size &&
            [...currentIds].every(id => failure.ids.has(id))
          if (sameRosterAsFailure && Date.now() - failure.at < V2_ROSTER_RETRY_COOLDOWN_MS) {
            // Controlled cooldown: do not hammer a persistent failure, but never
            // permanently latch. The same roster is retried after the cooldown.
            if (!failure.logged) {
              failure.logged = true
              self._recordV2Diagnostic('V2_ROSTER_REPLACE_COOLDOWN', 'roster',
                'roster reactivation failed recently; cooling down before retry')
            }
            return
          }
          if (sameRosterAsFailure) self._v2LastRosterFailure = null

          self._v2RosterInFlight = true
          try {
            const replaced = await self._reactivateV2ForRoster()
            if (!replaced) {
              // The callee already recorded the single structured
              // V2_ROSTER_REPLACE_FAILED diagnostic; do not duplicate it here.
              self._v2LastRosterFailure = { ids: new Set(currentIds), at: Date.now(), logged: false }
            }
          } finally {
            self._v2RosterInFlight = false
          }
          return
        }
        // Roster is stable and matches the adapter: clear any failure latch.
        self._v2LastRosterFailure = null
        // 2. Sync E3 agent adapter positions, unregister removed from grid
        const tasks = []

        for (const [agentId, entity] of self._agents) {
          const existing = adapter.lookup(agentId)
          const pos = entity.pos || {}
          if (!existing) {
            tasks.push(
              adapter.create([{ agentId, x: pos.x ?? 0, y: pos.y ?? 0 }])
                .then(() => {})
                .catch(err => {
                  console.warn('[HallScene] V2 adapter create failed for %s:', agentId, err?.message || err)
                  throw err
                })
            )
          } else if (pos.x !== undefined && pos.y !== undefined) {
            tasks.push(
              adapter.update([{ agentId, x: pos.x, y: pos.y }])
                .then(() => {})
                .catch(err => {
                  console.warn('[HallScene] V2 adapter update failed for %s:', agentId, err?.message || err)
                  throw err
                })
            )
          }
        }

        // Remove agents no longer in _agents — unregister from grid too
        for (const id of adapter.sourceEntityIds) {
          if (!currentIds.has(id)) {
            const so = adapter.lookup(id)
            if (so) unregisterAgentFromGrid(self._v2Assembly.spatialGrid, so.stableId)
            tasks.push(
              adapter.remove([id])
                .then(() => {})
                .catch(err => {
                  console.warn('[HallScene] V2 adapter remove failed for %s:', id, err?.message || err)
                  throw err
                })
            )
          }
        }

        // Await all adapter operations; any failure → fail this frame closed
        const results = await Promise.allSettled(tasks)
        const anyFailed = results.some(r => r.status === 'rejected')
        if (anyFailed) {
          if (self._shadowDebugActive) {
            console.warn('[HallScene] V2 adapter sync had failures; skipping frame (V1 preserved)')
          }
          return
        }

        if (capturedGen !== self._v2Generation) return

        // 3. Build V2AgentAdapters from E3 snapshot
        const agentAdapters = []
        for (const id of adapter.sourceEntityIds) {
          const so = adapter.lookup(id)
          const entity = self._agents.get(id)
          if (so && entity) {
            agentAdapters.push({ sceneObject: so, entity })
          }
        }

        // 4. Register agents in spatial grid (re-register moves, auto-unregisters old position)
        registerAgentsInGrid(
          self._v2Assembly.spatialGrid,
          agentAdapters,
          'juyiting-main', 'floor-1',
        )

        // 5. Build frame proposal
        const activationTxId = self._v2Controller.active?.ownerTransactionId
        if (!activationTxId) return

        const { proposal, nextMembership } = buildFrameProposal(
          self._v2Assembly, agentAdapters,
          activationTxId,
          self._v2Membership,
        )

        if (capturedGen !== self._v2Generation) return

        // 6. Pre-build next hit targets and store as pending frame state
        const nextHitTargets = buildHitTestTargets(
          proposal.order, proposal.depths, self._v2Assembly, agentAdapters,
        )
        self._v2PendingFrame = {
          nextMembership,
          nextDepths: proposal.depths,
          nextHitTargets,
        }

        // 7. Commit frame via E7 controller (sync)
        const commitResult = self._v2Controller.commitFrame(proposal)
        if (!commitResult.ok) {
          // Commit failed; clear pending frame
          self._v2PendingFrame = null
          if (self._shadowDebugActive) {
            console.warn('[HallScene] V2 commitFrame failed:', commitResult.error?.message)
          }
        }
      } catch (err) {
        self._v2PendingFrame = null
        if (self._shadowDebugActive) {
          console.warn('[HallScene] V2 frame failed (V1 preserved):', err?.message || err)
        }
      }
    }

    /**
     * Rebuild V2 scene transaction when agent roster changes.
     * Creates NEW adapter from current _agents, NEW offline fragments, NEW E7 controller.
     * Old active stays live until new controller.activate commit succeeds.
     * On commit success: atomically swap fragments/depths/state; async destroy old.
     * On failure: destroy new staging, sync old adapter, keep old active.
     * Must be awaited by caller.
     */
    _snapshotSpatialGrid(assembly) {
      const grid = assembly.spatialGrid
      const sceneId = assembly.canonicalIr.sceneId
      const floorByStableId = new Map()
      for (const z of assembly.zones) floorByStableId.set(z.stableId, z.floorId)
      for (const f of assembly.fragments) floorByStableId.set(f.stableId, f.floorId)
      for (const o of assembly.worldObjects) floorByStableId.set(o.stableId, o.floorId)
      for (const o of assembly.nonWorldObjects) floorByStableId.set(o.stableId, o.floorId)
      return [...grid.snapshot().entries()].map(([stableId, entry]) => ({
        stableId,
        entryKind: entry.entryKind,
        bounds: { x: entry.bounds.x, y: entry.bounds.y, width: entry.bounds.width, height: entry.bounds.height },
        sceneId,
        floorId: floorByStableId.get(stableId) || 'floor-1'
      }))
    }

    _restoreSpatialGrid(assembly, snapshot) {
      const grid = assembly.spatialGrid
      grid.clear()
      for (const item of snapshot) {
        grid.register({
          stableId: item.stableId,
          entryKind: item.entryKind,
          bounds: item.bounds
        }, item.sceneId, item.floorId)
      }
    }

    /**
     * Rebuild V2 scene transaction when agent roster changes.
     * Creates NEW adapter from current _agents, NEW offline fragments, NEW E7 controller.
     * Old active stays live until new controller.activate commit succeeds.
     * On commit success: atomically swap fragments/depths/state; async destroy old.
     * On failure: destroy new staging, restore the trusted grid snapshot, keep old active.
     * Returns true on success and false when the old active scene is preserved.
     * Must be awaited by caller.
     */
    async _reactivateV2ForRoster() {
      const self = this
      const gen = this._v2Generation
      const oldController = self._v2Controller
      const oldAdapter = self._v2AgentAdapter
      const oldAssembly = self._v2Assembly
      const oldFragments = self._v2StagingRenderables
      const oldActive = self._v2Active
      const oldDepths = self._v2Depths
      const oldMembership = self._v2Membership
      const oldHitTargets = self._v2HitTargets
      const oldRenderableHandles = self._v2RenderableHandles
      const oldRenderableDepths = new Map()
      if (oldFragments) {
        for (const handle of oldFragments) oldRenderableDepths.set(handle, handle.depth)
      }
      for (const [, handle] of self._v2PropRenderables) oldRenderableDepths.set(handle, handle.depth)
      for (const [, handle] of self._agents) oldRenderableDepths.set(handle, handle.depth)

      // Trusted pre-mutation grid snapshot. Rollback restores by clear + rebuild,
      // never by incremental unregister that could fail and leave stale entries.
      const gridSnapshot = oldAssembly ? self._snapshotSpatialGrid(oldAssembly) : null

      let newAdapter = null
      let newController = null
      const stagingFragments = new Set()

      const restoreGrid = () => {
        // A destroyed scene must not mutate its (now dead) old assembly grid;
        // deactivateV2 has already released the live scene and its readers.
        if (self._destroyed) return
        if (!oldAssembly || !gridSnapshot) return
        try {
          self._restoreSpatialGrid(oldAssembly, gridSnapshot)
        } catch (error) {
          self._recordV2Diagnostic('V2_ROSTER_GRID_ROLLBACK_FAILED', 'roster',
            `could not rebuild grid from trusted snapshot: ${error?.message || error}`)
        }
      }

      try {
        if (gen !== self._v2Generation || self._destroyed || !oldAssembly || !oldController) return false

        // Remove stale runtime agents before any early return; the trusted
        // snapshot above is the recovery point if a later stage fails.
        const currentIds = new Set(self._agents.keys())
        for (const id of oldAdapter?.sourceEntityIds || []) {
          if (currentIds.has(id)) continue
          const sceneObject = oldAdapter.lookup(id)
          if (sceneObject) unregisterAgentFromGrid(oldAssembly.spatialGrid, sceneObject.stableId)
        }

        newAdapter = createRuntimeAgentAdapter(
          defaultSpawnResolver('floor-1', 0),
          defaultChunkResolver(),
          'juyiting-main'
        )
        await Promise.all([...self._agents].map(([agentId, entity]) => {
          const pos = entity.pos || {}
          return newAdapter.create([{ agentId, x: pos.x ?? 0, y: pos.y ?? 0 }])
        }))

        if (gen !== self._v2Generation || self._destroyed) {
          newAdapter.destroy()
          restoreGrid()
          return false
        }

        const ir = oldAssembly.canonicalIr
        const renderables = new Map()
        let propsMatched = 0
        for (const prop of ir.objects.filter(o => o.kind === 'prop')) {
          const handle = self._v2PropRenderables.get(prop.stableId)
          if (handle) {
            renderables.set(prop.stableId, handle)
            propsMatched++
          }
        }
        if (propsMatched !== 5) throw new Error(`V2 roster replacement matched ${propsMatched}/5 props`)

        for (const fragment of ir.fragments) {
          const image = me.loader.getImage(fragment.assetRef)
          if (!image) throw new Error(`V2 roster replacement asset missing: ${fragment.assetRef}`)
          const handle = self._createFragmentHandle(image, fragment)
          renderables.set(fragment.stableId, handle)
          stagingFragments.add(handle)
        }

        const agentAdapters = []
        for (const id of newAdapter.sourceEntityIds) {
          const sceneObject = newAdapter.lookup(id)
          const entity = self._agents.get(id)
          if (sceneObject && entity) {
            agentAdapters.push({ sceneObject, entity })
            renderables.set(sceneObject.stableId, entity)
          }
        }
        registerAgentsInGrid(oldAssembly.spatialGrid, agentAdapters, 'juyiting-main', 'floor-1')
        const initOrder = computeUnifiedWorldOrder(oldAssembly, agentAdapters, createEmptyMembershipState())
        const initialHitTargets = buildHitTestTargets(initOrder.order, initOrder.depths, oldAssembly, agentAdapters)

        if (gen !== self._v2Generation || self._destroyed) {
          newAdapter.destroy()
          restoreGrid()
          return false
        }

        newController = createSceneActivationController({
          parse: source => source,
          canonicalize: parsed => parsed,
          validate: canonical => canonical,
          loadAssets: validated => validated,
          instantiate: (input, ctx) => ({
            sceneId: ctx.sceneId,
            mode: ctx.mode,
            ownerTransactionId: ctx.transactionId,
            children: Object.freeze([...renderables].map(([stableId]) => Object.freeze({
              stableId,
              sceneId: ctx.sceneId,
              mode: ctx.mode,
              ownerTransactionId: ctx.transactionId,
              value: stableId
            }))),
            order: Object.freeze(initOrder.order),
            depths: Object.freeze(initOrder.depths),
            dispose: () => {
              for (const handle of stagingFragments) {
                try { me.game.world.removeChild(handle) } catch { /* noop */ }
              }
            }
          }),
          validateConstraints: scene => ({ order: scene.order }),
          commit: ctx => {
            ctx.swap(
              () => {
                if (gen !== self._v2Generation || self._destroyed) {
                  throw new Error('V2 roster replacement superseded before commit')
                }
                if (oldFragments) {
                  for (const handle of oldFragments) me.game.world.removeChild(handle)
                }
                for (const [stableId, handle] of renderables) {
                  if (stagingFragments.has(handle)) me.game.world.addChild(handle, self._v2RenderDepth(initOrder.depths[stableId]))
                }
                for (const [stableId, handle] of renderables) {
                  const depth = initOrder.depths[stableId]
                  if (depth !== undefined) handle.depth = self._v2RenderDepth(depth)
                }
                me.game.world.sort?.(true)
                self._v2Controller = newController
                self._v2AgentAdapter = newAdapter
                self._v2Assembly = oldAssembly
                self._v2StagingRenderables = stagingFragments
                self._v2Depths = initOrder.depths
                self._v2Membership = initOrder.nextMembership
                self._v2HitTargets = initialHitTargets
                self._v2RenderableHandles = new Map(renderables)
                self._v2PendingActivation = null
                self._v2PendingFrame = null
                self._v2Active = true
              },
              () => {
                // Destroyed scene: never resurrect live fields, fragments, or
                // active reader state. E7 disposes the new transaction staging;
                // the caller's catch destroys the new controller/adapter.
                if (self._destroyed) return
                // Only refuse when a third lifecycle event owns the live scene.
                // oldController means apply never ran; this transaction's
                // newController means apply ran and threw, so roll back fully.
                if (self._v2Controller !== oldController && self._v2Controller !== newController) return
                self._v2Controller = oldController
                self._v2AgentAdapter = oldAdapter
                self._v2Assembly = oldAssembly
                self._v2StagingRenderables = oldFragments
                self._v2Active = oldActive
                self._v2Depths = oldDepths
                self._v2Membership = oldMembership
                self._v2HitTargets = oldHitTargets
                self._v2RenderableHandles = oldRenderableHandles
                self._v2PendingActivation = null
                self._v2PendingFrame = null
                for (const handle of stagingFragments) {
                  try { me.game.world.removeChild(handle) } catch { /* noop */ }
                }
                if (oldFragments) {
                  for (const handle of oldFragments) {
                    try { me.game.world.addChild(handle, oldRenderableDepths.get(handle)) } catch { /* noop */ }
                  }
                }
                for (const [handle, depth] of oldRenderableDepths) {
                  try { handle.depth = depth } catch { /* noop */ }
                }
                try { me.game.world.sort?.(true) } catch { /* noop */ }
              }
            )
          },
          commitFrame: ctx => {
            const oldFrameDepths = self._v2Depths
            const oldFrameMembership = self._v2Membership
            const oldFrameHitTargets = self._v2HitTargets
            const oldHandleDepths = new Map([...renderables].map(([, handle]) => [handle, handle.depth]))
            ctx.swap(
              () => {
                for (const [stableId, handle] of renderables) {
                  const depth = ctx.next.depths[stableId]
                  if (depth !== undefined) handle.depth = self._v2RenderDepth(depth)
                }
                me.game.world.sort?.(true)
                const pending = self._v2PendingFrame
                if (pending) {
                  self._v2Depths = pending.nextDepths
                  self._v2Membership = pending.nextMembership
                  self._v2HitTargets = pending.nextHitTargets
                  self._v2PendingFrame = null
                }
              },
              () => {
                self._v2Depths = oldFrameDepths
                self._v2Membership = oldFrameMembership
                self._v2HitTargets = oldFrameHitTargets
                self._v2PendingFrame = null
                for (const [handle, depth] of oldHandleDepths) {
                  try { handle.depth = depth } catch { /* noop */ }
                }
                try { me.game.world.sort?.(true) } catch { /* noop */ }
              }
            )
          }
        })

        const result = await newController.activate({
          sceneId: 'juyiting-main', mode: 'v2', source: { mapData: self._mapData }
        })
        if (!result.ok) throw result.error
        if (gen !== self._v2Generation || self._destroyed) {
          // A newer lifecycle event now owns the committed scene; do not
          // double-destroy the controller that was just atomically published.
          return true
        }

        newController = null
        newAdapter = null
        Promise.resolve().then(async () => {
          await oldController.destroy()
          oldAdapter?.destroy()
        }).catch(error => {
          console.warn('[HallScene] V2 old roster scene destroy failed:', error?.message || error)
        })
        return true
      } catch (error) {
        if (newController) await newController.destroy().catch(() => {})
        if (newAdapter) newAdapter.destroy()
        restoreGrid()
        self._recordV2Diagnostic('V2_ROSTER_REPLACE_FAILED', 'roster',
          `roster reactivation failed (old active preserved): ${error?.message || error}`)
        return false
      }
    }

    /**
     * Replace the active V2 scene with one derived from new mapData without
     * falling back to V1. The old active scene stays live until the new E7
     * transaction commits; any failure preserves it. New assembly owns its own
     * spatial grid, so the old grid is never mutated during a refresh.
     */
    async _replaceV2ForMapData(newMapData) {
      const self = this
      const gen = this._v2Generation
      const oldController = self._v2Controller
      const oldAdapter = self._v2AgentAdapter
      const oldAssembly = self._v2Assembly
      const oldFragments = self._v2StagingRenderables
      const oldActive = self._v2Active
      const oldDepths = self._v2Depths
      const oldMembership = self._v2Membership
      const oldHitTargets = self._v2HitTargets
      const oldRenderableHandles = self._v2RenderableHandles
      const oldMapData = self._mapData
      const oldRenderableDepths = new Map()
      if (oldFragments) {
        for (const handle of oldFragments) oldRenderableDepths.set(handle, handle.depth)
      }
      for (const [, handle] of self._v2PropRenderables) oldRenderableDepths.set(handle, handle.depth)
      for (const [, handle] of self._agents) oldRenderableDepths.set(handle, handle.depth)

      let newAssembly = null
      let newAdapter = null
      let newController = null
      const stagingFragments = new Set()

      try {
        if (gen !== self._v2Generation || self._destroyed || !oldController || !oldAdapter || !oldAssembly) return false

        newAssembly = assembleV2Scene(newMapData, self._tmxSha256)
        const ir = newAssembly.canonicalIr
        if (ir.renderSchemaVersion !== '2' || ir.sceneId !== 'juyiting-main') {
          self._recordV2Diagnostic('V2_MAP_REFRESH_GATE_FAILED', 'map-refresh',
            'assembled IR failed renderSchemaVersion=2 gate')
          return false
        }
        try {
          const refreshedHotspots = self._canonicalizeHotspots(newMapData, ir.floorRegistry)
          if (!self._hotspotSnapshot || refreshedHotspots.snapshot !== self._hotspotSnapshot) {
            throw new Error('hotspot snapshot changed; marker staging is required')
          }
        } catch (error) {
          self._recordV2Diagnostic('V2_MAP_REFRESH_HOTSPOT_CHANGED', 'map-refresh',
            `hotspot refresh rejected: ${error?.message || error}`)
          return false
        }

        newAdapter = createRuntimeAgentAdapter(
          defaultSpawnResolver('floor-1', 0),
          defaultChunkResolver(),
          'juyiting-main'
        )
        await Promise.all([...self._agents].map(([agentId, entity]) => {
          const pos = entity.pos || {}
          return newAdapter.create([{ agentId, x: pos.x ?? 0, y: pos.y ?? 0 }])
        }))

        if (gen !== self._v2Generation || self._destroyed) {
          newAdapter.destroy()
          return false
        }

        const renderables = new Map()
        let propsMatched = 0
        for (const prop of ir.objects.filter(o => o.kind === 'prop')) {
          const handle = self._v2PropRenderables.get(prop.stableId)
          if (handle) {
            renderables.set(prop.stableId, handle)
            propsMatched++
          }
        }
        if (propsMatched !== 5) throw new Error(`V2 map refresh matched ${propsMatched}/5 props`)

        for (const fragment of ir.fragments) {
          const image = me.loader.getImage(fragment.assetRef)
          if (!image) throw new Error(`V2 map refresh asset missing: ${fragment.assetRef}`)
          const handle = self._createFragmentHandle(image, fragment)
          renderables.set(fragment.stableId, handle)
          stagingFragments.add(handle)
        }

        const agentAdapters = []
        for (const id of newAdapter.sourceEntityIds) {
          const sceneObject = newAdapter.lookup(id)
          const entity = self._agents.get(id)
          if (sceneObject && entity) {
            agentAdapters.push({ sceneObject, entity })
            renderables.set(sceneObject.stableId, entity)
          }
        }
        registerAgentsInGrid(newAssembly.spatialGrid, agentAdapters, 'juyiting-main', 'floor-1')
        const initOrder = computeUnifiedWorldOrder(newAssembly, agentAdapters, createEmptyMembershipState())
        const initialHitTargets = buildHitTestTargets(initOrder.order, initOrder.depths, newAssembly, agentAdapters)

        if (gen !== self._v2Generation || self._destroyed) {
          newAdapter.destroy()
          return false
        }

        newController = createSceneActivationController({
          parse: source => source,
          canonicalize: parsed => parsed,
          validate: canonical => canonical,
          loadAssets: validated => validated,
          instantiate: (input, ctx) => ({
            sceneId: ctx.sceneId,
            mode: ctx.mode,
            ownerTransactionId: ctx.transactionId,
            children: Object.freeze([...renderables].map(([stableId]) => Object.freeze({
              stableId,
              sceneId: ctx.sceneId,
              mode: ctx.mode,
              ownerTransactionId: ctx.transactionId,
              value: stableId
            }))),
            order: Object.freeze(initOrder.order),
            depths: Object.freeze(initOrder.depths),
            dispose: () => {
              for (const handle of stagingFragments) {
                try { me.game.world.removeChild(handle) } catch { /* noop */ }
              }
            }
          }),
          validateConstraints: scene => ({ order: scene.order }),
          commit: ctx => {
            ctx.swap(
              () => {
                if (gen !== self._v2Generation || self._destroyed) {
                  throw new Error('V2 map refresh superseded before commit')
                }
                if (oldFragments) {
                  for (const handle of oldFragments) me.game.world.removeChild(handle)
                }
                for (const [stableId, handle] of renderables) {
                  if (stagingFragments.has(handle)) me.game.world.addChild(handle, self._v2RenderDepth(initOrder.depths[stableId]))
                }
                for (const [stableId, handle] of renderables) {
                  const depth = initOrder.depths[stableId]
                  if (depth !== undefined) handle.depth = self._v2RenderDepth(depth)
                }
                me.game.world.sort?.(true)
                self._v2Controller = newController
                self._v2AgentAdapter = newAdapter
                self._v2Assembly = newAssembly
                self._v2StagingRenderables = stagingFragments
                self._v2Depths = initOrder.depths
                self._v2Membership = initOrder.nextMembership
                self._v2HitTargets = initialHitTargets
                self._v2RenderableHandles = new Map(renderables)
                self._v2PendingActivation = null
                self._v2PendingFrame = null
                self._v2Active = true
                // Publish new mapData only after the full scene swap succeeded;
                // shadow renderer must align with the published live map.
                self._mapData = newMapData
                self._syncWorldUiOverlayBounds(newMapData)
                if (self._shadowRenderer) {
                  self._shadowRenderer.setMapData(self._shadowMapData())
                  self._shadowAssemblySource = newAssembly
                }
              },
              () => {
                // Destroyed scene: never resurrect live fields, fragments,
                // active state, mapData, or shadow renderer alignment. E7
                // disposes the new transaction staging and the caller's catch
                // destroys the new controller/adapter.
                if (self._destroyed) return
                // Only refuse when a third lifecycle event owns the live scene.
                // oldController means apply never ran; this transaction's
                // newController means apply ran and threw, so roll back fully.
                if (self._v2Controller !== oldController && self._v2Controller !== newController) return
                self._v2Controller = oldController
                self._v2AgentAdapter = oldAdapter
                self._v2Assembly = oldAssembly
                self._v2StagingRenderables = oldFragments
                self._v2Active = oldActive
                self._v2Depths = oldDepths
                self._v2Membership = oldMembership
                self._v2HitTargets = oldHitTargets
                self._v2RenderableHandles = oldRenderableHandles
                self._v2PendingActivation = null
                self._v2PendingFrame = null
                if (self._mapData !== oldMapData) self._mapData = oldMapData
                // Shadow publication can throw after the new bounds have been
                // published. Bounds are part of the same map transaction and
                // must always be restored, even if shadow rollback also fails.
                self._syncWorldUiOverlayBounds(oldMapData)
                if (self._shadowRenderer) {
                  try {
                    self._shadowRenderer.setMapData(self._shadowMapData())
                    self._shadowAssemblySource = oldAssembly
                  } catch { /* noop */ }
                }
                for (const handle of stagingFragments) {
                  try { me.game.world.removeChild(handle) } catch { /* noop */ }
                }
                if (oldFragments) {
                  for (const handle of oldFragments) {
                    try { me.game.world.addChild(handle, oldRenderableDepths.get(handle)) } catch { /* noop */ }
                  }
                }
                for (const [handle, depth] of oldRenderableDepths) {
                  try { handle.depth = depth } catch { /* noop */ }
                }
                try { me.game.world.sort?.(true) } catch { /* noop */ }
              }
            )
          },
          commitFrame: ctx => {
            const oldFrameDepths = self._v2Depths
            const oldFrameMembership = self._v2Membership
            const oldFrameHitTargets = self._v2HitTargets
            const oldHandleDepths = new Map([...renderables].map(([, handle]) => [handle, handle.depth]))
            ctx.swap(
              () => {
                for (const [stableId, handle] of renderables) {
                  const depth = ctx.next.depths[stableId]
                  if (depth !== undefined) handle.depth = self._v2RenderDepth(depth)
                }
                me.game.world.sort?.(true)
                const pending = self._v2PendingFrame
                if (pending) {
                  self._v2Depths = pending.nextDepths
                  self._v2Membership = pending.nextMembership
                  self._v2HitTargets = pending.nextHitTargets
                  self._v2PendingFrame = null
                }
              },
              () => {
                self._v2Depths = oldFrameDepths
                self._v2Membership = oldFrameMembership
                self._v2HitTargets = oldFrameHitTargets
                self._v2PendingFrame = null
                for (const [handle, depth] of oldHandleDepths) {
                  try { handle.depth = depth } catch { /* noop */ }
                }
                try { me.game.world.sort?.(true) } catch { /* noop */ }
              }
            )
          }
        })

        const result = await newController.activate({
          sceneId: 'juyiting-main', mode: 'v2', source: { mapData: newMapData }
        })
        if (!result.ok) throw result.error
        if (gen !== self._v2Generation || self._destroyed) {
          // A newer lifecycle event now owns the committed scene; do not
          // double-destroy the controller that was just atomically published.
          return true
        }

        newController = null
        newAdapter = null
        Promise.resolve().then(async () => {
          await oldController.destroy()
          oldAdapter?.destroy()
        }).catch(error => {
          console.warn('[HallScene] V2 old map scene destroy failed:', error?.message || error)
        })
        return true
      } catch (error) {
        if (newController) await newController.destroy().catch(() => {})
        if (newAdapter) newAdapter.destroy()
        self._recordV2Diagnostic('V2_MAP_REFRESH_FAILED', 'map-refresh',
          `map refresh failed (old active preserved): ${error?.message || error}`)
        return false
      }
    }

    /** Sync the given adapter to match current _agents (best-effort, for recovery). */
    async _syncAdapterToCurrentAgents(adapter) {
      if (!adapter) return
      const currentIds = new Set(this._agents.keys())
      const adapterIds = new Set(adapter.sourceEntityIds)
      try {
        // Remove stale
        for (const id of adapterIds) {
          if (!currentIds.has(id)) {
            await adapter.remove([id]).catch(() => {})
          }
        }
        // Create/update current
        for (const [agentId, entity] of this._agents) {
          const pos = entity.pos || {}
          const existing = adapter.lookup(agentId)
          if (!existing) {
            await adapter.create([{ agentId, x: pos.x ?? 0, y: pos.y ?? 0 }]).catch(() => {})
          } else {
            await adapter.update([{ agentId, x: pos.x ?? 0, y: pos.y ?? 0 }]).catch(() => {})
          }
        }
      } catch (_) {
        // best-effort; ignore failures
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
        // HallAgent.update writes y into depth; pin the last committed logical
        // order back into the V2 world band until the async frame commits.
        this._reapplyCommittedV2RenderDepths()
        this._applyV2Depths()
      } else if (!this._destroyed) {
        // E16A P2: HallAgent.update also writes raw world Y into depth in the
        // fallback/error state, which would put agents/props above lighting and
        // foreground. Apply a fixed, complete error-state render policy instead
        // of reintroducing a Y sort, mask logic, or declaration order.
        this._applyErrorStateRenderDepths()
      }
      // E6: re-evaluate flags, then shadow compute (never changes the committed V2 scene)
      this._ensureShadowFlags()
      this._runShadowPass()
      return true
    }

    _shadowMapData() {
      if (this._v2Assembly) {
        try {
          return projectActivationEnvelope(this._mapData)
        } catch {
          return this._mapData
        }
      }
      return this._mapData
    }

    _collectV2RuntimeObjects() {
      const snapshots = []
      if (!this._v2Active || !this._v2AgentAdapter || !this._v2RenderableHandles) return snapshots
      for (const sourceId of this._v2AgentAdapter.sourceEntityIds) {
        const sceneObject = this._v2AgentAdapter.lookup(sourceId)
        if (!sceneObject) continue
        const handle = this._v2RenderableHandles.get(sceneObject.stableId)
        snapshots.push({
          objectId: sceneObject.stableId,
          sourceId,
          stableId: sceneObject.stableId,
          runtimeDepth: Number.isFinite(handle?.depth) ? handle.depth : 0,
          x: Number.isFinite(Number(sceneObject.sortAnchor?.x)) ? Number(sceneObject.sortAnchor.x) : 0,
          y: Number.isFinite(Number(sceneObject.sortAnchor?.y)) ? Number(sceneObject.sortAnchor.y) : 0,
          kind: 'agent',
          visible: true,
        })
      }
      return snapshots
    }

    _runShadowPass() {
      const sr = this._shadowRenderer
      if (!sr || !sr.enabled) return
      if (this._destroyed) return
      try {
        // Collect committed V2 runtime objects (read-only, never modifies scene).
        // When V2 has not committed yet, diagnostics are computed from the
        // canonical static IR with no runtime agents.
        const runtimeObjects = this._collectV2RuntimeObjects()
        // Compute shadow snapshot
        this._shadowState = sr.computeSnapshot(runtimeObjects)
        // Update debug overlay if active
        if (this._debugOverlay && this._shadowDebugActive) {
          this._debugOverlay.update(
            this._shadowState,
            sr.canonicalIr,
            sr.spatialGrid,
          )
        }
      } catch (err) {
        // Shadow failure must never affect the committed scene; only log when debug active
        if (this._shadowDebugActive) {
          console.warn('[HallScene] shadow pass failed (scene preserved):', err?.message || err)
        }
      }
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
      this._imageLayersByName.clear()
      if (this._worldUiOverlay) {
        try {
          if (me.game.world?.hasChild?.(this._worldUiOverlay)) me.game.world.removeChild(this._worldUiOverlay)
        } catch (err) {
          console.warn('[HallScene] world-ui overlay cleanup failed:', err?.message || err)
        }
        this._worldUiOverlay = null
      }
      this._agents.forEach(agent => {
        try {
          if (me.game.world?.hasChild?.(agent)) me.game.world.removeChild(agent)
        } catch (err) {
          console.warn('[HallScene] agent cleanup failed:', err?.message || err)
        }
      })
      this._agents.clear()
      this._sceneBuilt = false
      this._initialBuildFatal = false
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
      // E12: clean up V2 activation state — save promise for orderly shutdown logging
      const v2Cleanup = this.deactivateV2()
      // Store on instance so external teardown can await if needed
      this._v2DestroyPromise = v2Cleanup.catch(() => {})
      // Clear potentially stale fields that deactivateV2 may have missed
      this._v2PendingActivation = null
    }
  }
}
