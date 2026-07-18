/**
 * 鑱氫箟鍘?melonJS game instance manager
 */

import { createGameConfig } from './config.js'
import {
  HALL_BOOT_RESOURCES,
  HALL_MAP_RESOURCE,
  buildHallMapResources,
  buildPersonaSpriteResource,
  personaSpriteResourceName
} from './resources.js'
import { parseJuyiHallTmx } from './tiledMap.js'
import { createHallSceneClass } from './scenes/HallScene.js'
import { createHallAgentClass } from './entities/HallAgent.js'
import { loadPersonaSprites } from './sprites/spriteLoader.js'
import { PERSONA_SPRITE_MANIFEST } from './sprites/personaSpriteManifest.js'
import { createMovementEngine } from './simulation/movementEngine.js'
import { aggregateSceneDebug } from './debug/sceneDebugAggregator.js'

const SCENE_DEBUG_KEY = '__JYTING_SCENE_DEBUG__'

export class JuyitingGame {
  constructor() {
    this._me = null
    this._container = null
    this._hallScene = null
    this._callbacks = {}
    this._initialized = false
    this._mapData = null
    this._spriteLoadResult = null
    // The approved 4x4 persona sheet is a multi-megabyte asset.  Keep the
    // runtime tolerant of a cold browser cache and slower local dev servers.
    this._spriteLoadTimeoutMs = 15_000
    this._spriteLoadAbortController = null
    this._readyTimer = null
    this._canvas = null
    this._canvasCoverFrame = null
    this._canvasCoverScale = 1
    this._displayViewportSignature = ''
    this._pendingStart = false
    this._stateId = null
    this._generation = 0
    this._mountToken = null
    this._movementEngine = null
    this._pendingSimulationPhaseEvents = []
    this._fatalError = null
    this._sceneDebugBackend = {}
    this._sceneDebugSimulation = {}
    this._sceneDebugPublication = null
    this._sceneDebugDirty = false
    this._sceneDebugPublishHandle = null
    this._sceneDebugPublishCancel = null
    this._simulationEnabled = true
  }

  async _loadMelonJS() {
    if (this._me) return this._me
    const m = await import('melonjs')
    this._me = m.default || m
    return this._me
  }

  _waitForEngineReady(me) {
    if (typeof me?.device?.onReady !== 'function') return Promise.resolve()
    return new Promise(resolve => {
      me.device.onReady(resolve)
    })
  }

  async mount(container, options = {}) {
    if (this._initialized) return
    if (!container) throw new Error('container required')
    this._spriteLoadAbortController?.abort()
    this._spriteLoadAbortController = null
    const mountToken = ++this._generation
    this._mountToken = mountToken
    this._spriteLoadResult = null
    this._fatalError = null
    this._simulationEnabled = options.simulationEnabled !== false
    this._markSceneDebugDirty()
    let me
    try {
      me = await this._loadMelonJS()
      await this._waitForEngineReady(me)
      if (!this._isCurrentMount(mountToken)) return

      this._container = container
      this._callbacks = {
        onAgentClick: options.onAgentClick || null,
        onHotspotClick: options.onHotspotClick || null,
        onReady: options.onReady || null,
        onSimulationPhaseEvents: options.onSimulationPhaseEvents || null
      }

      const config = createGameConfig()
      const HallAgentClass = createHallAgentClass(me)
      const HallSceneClass = createHallSceneClass(me, HallAgentClass)
      this._hallScene = new HallSceneClass()
      this._hallScene.onAgentClick((d) => {
        if (this._isCurrentMount(mountToken)) this._callbacks.onAgentClick?.(d)
      })
      this._hallScene.onHotspotClick((d) => {
        if (this._isCurrentMount(mountToken)) this._callbacks.onHotspotClick?.(d)
      })
      this._hallScene.onReady(() => {
        if (this._isCurrentMount(mountToken)) this._callbacks.onReady?.()
      })

      // Init video (creates canvas inside container)
      me.video.init(config.width, config.height, {
        ...config,
        parent: container,
        scaleTarget: container,
        renderer: me.video.CANVAS,
        scale: 'auto',
        scaleMethod: 'fit'
      })

      // Preserve melonJS's stable fit renderer. CSS handles visual coverage so
      // mobile viewport changes never resize the Canvas backing buffer.
      const canvas = container.querySelector('canvas')
      this._canvas = canvas || null
      if (canvas) {
        canvas.style.background = 'transparent'
        canvas.style.position = 'absolute'
        canvas.style.left = '50%'
        canvas.style.top = '50%'
        canvas.style.transformOrigin = 'center center'
        this._scheduleCanvasCover()
      }

      // === Load boot resources, parse TMX, then load resources declared by TMX ===
      await this._loadResources(me, HALL_BOOT_RESOURCES, mountToken)
      if (!this._isCurrentMount(mountToken)) return

      await this._prepareMapData(me, mountToken)
      if (!this._isCurrentMount(mountToken)) return

      await this._loadResources(me, buildHallMapResources(this._mapData), mountToken)
      if (!this._isCurrentMount(mountToken)) return

      if (!this._hallScene?.prepareRuntime?.()) {
        throw simulationInitializationError(new Error('Camera/input runtime is unavailable'))
      }

      const spriteLoadAbortController = new AbortController()
      this._spriteLoadAbortController = spriteLoadAbortController
      const spriteLoadResult = await loadPersonaSprites(
        definition => this._loadPersonaSprite(me, definition, mountToken),
        PERSONA_SPRITE_MANIFEST,
        {
          timeoutMs: this._spriteLoadTimeoutMs,
          signal: spriteLoadAbortController.signal
        }
      )
      if (!this._isCurrentMount(mountToken)) return
      if (this._spriteLoadAbortController === spriteLoadAbortController) {
        this._spriteLoadAbortController = null
      }
      this._spriteLoadResult = spriteLoadResult
      this._hallScene?.setAvailablePersonas(spriteLoadResult.available)
      this._markSceneDebugDirty()

      if (this._simulationEnabled) this._initializeSimulationRuntime()

      this._startGame(me, mountToken)
      return {
        ready: true,
        movementReady: this._mapData?.movementReady === true,
        simulationReady: Boolean(this._movementEngine),
        degraded: spriteLoadResult.degraded,
        requiredMissingCount: spriteLoadResult.requiredMissingCount,
        optionalMissingCount: spriteLoadResult.optionalMissingCount,
        errors: spriteLoadResult.errors.map(error => ({ ...error }))
      }
    } catch (error) {
      const failure = error?.source === 'map'
        ? Object.assign(error, { retryable: true })
        : error
      if (this._isCurrentMount(mountToken)) {
        this._cleanupFailedMount(me)
        this._fatalError = failure
        this._markSceneDebugDirty()
      }
      throw failure
    }
  }

  _cleanupFailedMount(me) {
    this._generation += 1
    this._mountToken = null
    this._cancelSceneDebugPublication()
    this._cleanupRuntime(me)
  }

  _cleanupRuntime(me = this._me) {
    this._spriteLoadAbortController?.abort()
    this._spriteLoadAbortController = null
    if (this._readyTimer !== null) clearTimeout(this._readyTimer)
    this._readyTimer = null
    this._cancelCanvasCover()
    try { me?.state?.pause?.() } catch { /* preserve the original mount failure */ }
    try { this._hallScene?.onDestroyEvent?.() } catch { /* best-effort scene cleanup */ }
    try { me?.video?.destroy?.() } catch { /* best-effort renderer cleanup */ }
    try { this._canvas?.remove?.() } catch { /* best-effort canvas cleanup */ }
    this._canvas = null
    this._canvasCoverScale = 1
    this._displayViewportSignature = ''
    this._hallScene = null
    this._container = null
    this._callbacks = {}
    this._me = null
    this._initialized = false
    this._mapData = null
    this._spriteLoadResult = null
    this._pendingStart = false
    this._stateId = null
    this._movementEngine = null
    this._pendingSimulationPhaseEvents = []
    this._simulationEnabled = true
  }

  _loadPersonaSprite(me, definition, mountToken = this._mountToken) {
    return new Promise((resolve, reject) => {
      if (!this._isCurrentMount(mountToken)) return reject(new Error('Juyiting mount was cancelled'))
      const resource = buildPersonaSpriteResource(definition)
      try {
        me.loader.load(
          resource,
          () => {
            if (!this._isCurrentMount(mountToken)) return reject(new Error('Juyiting mount was cancelled'))
            const image = me.loader.getImage(personaSpriteResourceName(definition.personaCode))
            if (!image) return reject(new Error(`Loaded image is unavailable for ${definition.personaCode}`))
            resolve(image)
          },
          error => reject(error instanceof Error ? error : new Error(String(error)))
        )
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  _loadResources(me, resources = [], mountToken = this._mountToken) {
    const list = (resources || []).filter(Boolean)
    if (!list.length) return Promise.resolve()

    return Promise.all(list.map(res => new Promise(resolve => {
      if (!this._isCurrentMount(mountToken)) return resolve()
      try {
        me.loader.load(
          res,
          () => resolve(),
          (err) => {
            console.warn('[JuyitingGame] Failed:', res.name, err)
            resolve()
          }
        )
      } catch (e) {
        console.warn('[JuyitingGame] Load error:', res.name, e.message)
        resolve()
      }
    })))
  }

  _isCurrentMount(mountToken) {
    return this._mountToken === mountToken
  }

  async _prepareMapData(me, mountToken = this._mountToken) {
    let tmx = me.loader.getTMX?.(HALL_MAP_RESOURCE.name)

    if (!tmx) {
      try {
        const resp = await fetch(HALL_MAP_RESOURCE.src)
        const xmlText = await resp.text()
        if (!this._isCurrentMount(mountToken)) return
        tmx = xmlText
      } catch (err) {
        console.warn('[JuyitingGame] Direct TMX fetch failed:', err?.message || err)
      }
    }

    if (!this._isCurrentMount(mountToken)) return

    this._mapData = parseJuyiHallTmx(tmx, { movementEnabled: this._simulationEnabled })
    this._hallScene?.setMapData(this._mapData)
    this._markSceneDebugDirty()
  }

  _startGame(me, mountToken = this._mountToken) {
    if (!this._isCurrentMount(mountToken)) return
    // Alternate between two private state slots so remounting cannot be ignored
    // while the melonJS state registry remains bounded across repeated retries.
    this._stateId = Number(me.state.USER ?? me.state.PLAY) + (Number(mountToken) % 2)
    me.state.set(this._stateId, this._hallScene)
    this._initialized = true
    this._fatalError = null
    this._markSceneDebugDirty()
    if (this._pendingStart) {
      this._pendingStart = false
      me.state.change(this._stateId, true)
    }
    this._scheduleCanvasCover()
    // Emit ready again if onResetEvent didn't call it
    if (this._readyTimer !== null) clearTimeout(this._readyTimer)
    this._readyTimer = setTimeout(() => {
      this._readyTimer = null
      if (this._isCurrentMount(mountToken) && this._callbacks.onReady) this._callbacks.onReady()
    }, 200)
  }

  _initializeSimulationRuntime() {
    try {
      if (!this._mapData?.movementReady || !this._mapData?.movement) {
        throw new Error('Validated movement runtime is unavailable')
      }
      this._movementEngine = createMovementEngine(this._mapData.movement, PERSONA_SPRITE_MANIFEST)
      this._hallScene?.setSimulationRuntime?.({
        update: deltaMs => {
          this._movementEngine?.update(deltaMs)
          this._markSceneDebugDirty()
        },
        snapshots: () => this._movementEngine?.snapshots() || [],
        drainPhaseEvents: () => this._movementEngine?.drainPhaseEvents() || [],
        onPhaseEvents: events => {
          const copies = events.map(event => ({ ...event }))
          this._pendingSimulationPhaseEvents.push(...copies)
          if (this._callbacks.onSimulationPhaseEvents) {
            this._callbacks.onSimulationPhaseEvents(this.drainSimulationPhaseEvents())
          }
        }
      })
      this._markSceneDebugDirty()
    } catch (error) {
      throw simulationInitializationError(error)
    }
  }

  start() {
    if (!this._me || this._stateId == null) return
    if (!this._initialized) {
      this._pendingStart = true
      return
    }
    this._me.state.change(this._stateId, true)
  }

  pause() {
    if (!this._me) return
    this._me.state.pause()
  }

  destroy() {
    this._generation += 1
    this._mountToken = null
    this._cancelSceneDebugPublication()
    this._removeSceneDebug()
    this._cleanupRuntime(this._me)
    this._fatalError = null
    this._sceneDebugBackend = {}
    this._sceneDebugSimulation = {}
  }

  syncAgents(list) {
    if (this._hallScene) this._hallScene.syncAgents(list)
  }

  syncAgentSnapshots(list) {
    this._hallScene?.syncAgentSnapshots?.(list)
    this._markSceneDebugDirty()
  }

  enqueueMovementCommands(commands) {
    const list = Array.isArray(commands) ? commands : [commands]
    if (!this._movementEngine) {
      return list.map(() => ({ accepted: false, reason: 'simulation-unavailable' }))
    }
    const results = list.map(command => this._movementEngine.enqueue(command))
    this._markSceneDebugDirty()
    return results
  }

  drainSimulationPhaseEvents() {
    return this._pendingSimulationPhaseEvents.splice(0).map(event => ({ ...event }))
  }

  getMovementRuntime() {
    return this._mapData?.movement || null
  }

  syncHotspots(list) {
    if (this._hallScene) this._hallScene.syncHotspots(list)
  }

  updateAgentSceneState(agentId, state) {
    if (this._hallScene) this._hallScene.updateAgentSceneState(agentId, state)
  }

  setSelectedAgent(agentId) {
    if (this._hallScene) this._hallScene.setSelectedAgent(agentId)
  }

  panBy(dx, dy) {
    const result = this._hallScene?.panBy?.(dx, dy)
    this._markSceneDebugDirty()
    return result
  }

  zoomBy(delta) {
    const result = this._hallScene?.zoomBy?.(delta)
    this._markSceneDebugDirty()
    return result
  }

  resetTransform() {
    const result = this._hallScene?.resetTransform?.()
    this._markSceneDebugDirty()
    return result
  }

  fitToViewport() {
    const result = this._hallScene?.fitToViewport?.()
    this._markSceneDebugDirty()
    return result
  }

  resizeViewport(change) {
    const engineViewport = this._me?.game?.viewport
    const viewportWidth = Number(engineViewport?.width)
    const viewportHeight = Number(engineViewport?.height)
    const containerRect = this._container?.getBoundingClientRect?.()
    const sceneChange = Number.isFinite(viewportWidth) && viewportWidth > 0 && Number.isFinite(viewportHeight) && viewportHeight > 0
      ? {
          ...change,
          width: viewportWidth,
          height: viewportHeight,
          displayViewport: { width: Number(change?.width), height: Number(change?.height) },
          visibleViewport: this._visibleViewport(containerRect)
        }
      : change
    this._scheduleCanvasCover()
    const result = this._hallScene?.resizeViewport?.(sceneChange)
    this._markSceneDebugDirty()
    return result
  }

  getRenderSnapshot() {
    const canvas = this._canvas
    const canvasRect = canvas?.getBoundingClientRect?.()
    const containerRect = this._container?.getBoundingClientRect?.()
    const viewport = this._me?.game?.viewport
    return {
      scaleMethod: this._me?.game?.settings?.scaleMethod || '',
      coverScale: this._canvasCoverScale,
      devicePixelRatio: Number(globalThis.devicePixelRatio) || 1,
      viewport: { width: Number(viewport?.width) || 0, height: Number(viewport?.height) || 0 },
      container: { width: Math.round(containerRect?.width || 0), height: Math.round(containerRect?.height || 0) },
      canvas: {
        width: Number(canvas?.width) || 0,
        height: Number(canvas?.height) || 0,
        cssWidth: Math.round(canvasRect?.width || 0),
        cssHeight: Math.round(canvasRect?.height || 0)
      },
      visibleViewport: this._visibleViewport(containerRect, canvasRect)
    }
  }

  setInteractionLocked(locked, reason = 'panel') {
    const result = this._hallScene?.setInteractionLocked?.(locked, reason)
    this._markSceneDebugDirty()
    return result
  }

  getCameraSnapshot() {
    return this._hallScene?.getCameraSnapshot?.() || null
  }

  getInputSnapshot() {
    return this._hallScene?.inputSnapshot?.() || null
  }

  getSpriteLoadSnapshot() {
    if (!this._spriteLoadResult) return null
    return {
      ...this._spriteLoadResult,
      available: new Set(this._spriteLoadResult.available),
      assets: new Map(this._spriteLoadResult.assets),
      errors: this._spriteLoadResult.errors.map(error => ({ ...error }))
    }
  }

  resetToMainHall() {
    const result = this._hallScene?.resetToMainHall?.()
    this._markSceneDebugDirty()
    return result
  }

  _scheduleCanvasCover() {
    if (!this._canvas || !this._container || this._canvasCoverFrame !== null) return
    const target = typeof window !== 'undefined' ? window : globalThis
    const schedule = typeof target.requestAnimationFrame === 'function'
      ? callback => target.requestAnimationFrame(callback)
      : callback => setTimeout(callback, 0)
    this._canvasCoverFrame = schedule(() => {
      this._canvasCoverFrame = null
      this._applyCanvasCover()
    })
  }

  _cancelCanvasCover() {
    if (this._canvasCoverFrame === null) return
    const target = typeof window !== 'undefined' ? window : globalThis
    if (typeof target.cancelAnimationFrame === 'function') target.cancelAnimationFrame(this._canvasCoverFrame)
    else clearTimeout(this._canvasCoverFrame)
    this._canvasCoverFrame = null
  }

  _applyCanvasCover() {
    const canvas = this._canvas
    const containerRect = this._container?.getBoundingClientRect?.()
    if (!canvas || !containerRect?.width || !containerRect?.height) return
    const baseWidth = Number.parseFloat(canvas.style.width)
    const baseHeight = Number.parseFloat(canvas.style.height)
    if (!Number.isFinite(baseWidth) || baseWidth <= 0 || !Number.isFinite(baseHeight) || baseHeight <= 0) return
    const coverScale = Math.max(containerRect.width / baseWidth, containerRect.height / baseHeight)
    this._canvasCoverScale = Number.isFinite(coverScale) && coverScale > 0 ? coverScale : 1
    canvas.style.transform = `translate(-50%, -50%) scale(${this._canvasCoverScale})`
    this._syncDisplayViewport(containerRect)
    this._markSceneDebugDirty()
  }

  _syncDisplayViewport(containerRect) {
    const width = Math.round(containerRect?.width || 0)
    const height = Math.round(containerRect?.height || 0)
    const signature = `${width}:${height}`
    if (!width || !height || signature === this._displayViewportSignature) return
    const engineViewport = this._me?.game?.viewport
    const viewportWidth = Number(engineViewport?.width)
    const viewportHeight = Number(engineViewport?.height)
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return
    this._displayViewportSignature = signature
    this._hallScene?.resizeViewport?.({
      width: viewportWidth,
      height: viewportHeight,
      displayViewport: { width, height },
      visibleViewport: this._visibleViewport(containerRect),
      kind: 'layout'
    })
  }

  _visibleViewport(containerRect, canvasRect = this._canvas?.getBoundingClientRect?.()) {
    const viewport = this._me?.game?.viewport
    const viewportWidth = Number(viewport?.width)
    const viewportHeight = Number(viewport?.height)
    if (!containerRect?.width || !containerRect?.height || !canvasRect?.width || !canvasRect?.height ||
      !Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
      return { x: 0, y: 0, width: Number.isFinite(viewportWidth) ? viewportWidth : 0, height: Number.isFinite(viewportHeight) ? viewportHeight : 0 }
    }
    const scaleX = canvasRect.width / viewportWidth
    const scaleY = canvasRect.height / viewportHeight
    const left = Math.max(0, (containerRect.left - canvasRect.left) / scaleX)
    const top = Math.max(0, (containerRect.top - canvasRect.top) / scaleY)
    const right = Math.min(viewportWidth, (containerRect.right - canvasRect.left) / scaleX)
    const bottom = Math.min(viewportHeight, (containerRect.bottom - canvasRect.top) / scaleY)
    return {
      x: Math.min(viewportWidth, left),
      y: Math.min(viewportHeight, top),
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    }
  }

  cancelMovement(agentId, stateVersion) {
    const cancelled = this._movementEngine?.cancel?.(agentId, stateVersion) === true
    this._markSceneDebugDirty()
    return cancelled
  }

  updateBackendSceneDebug(value = {}) {
    this._sceneDebugBackend = {
      snapshotReady: value?.snapshotReady,
      sceneVersion: value?.sceneVersion,
      sseConnected: value?.sseConnected,
      lastEventAt: value?.lastEventAt,
      resyncCount: value?.resyncCount,
      degraded: value?.degraded,
      warnings: Array.isArray(value?.warnings) ? value.warnings.map(warning => ({
        code: warning?.code,
        severity: warning?.severity,
        source: warning?.source,
        retryable: warning?.retryable
      })) : []
    }
    this._markSceneDebugDirty()
  }

  updateSimulationDebug(value = {}) {
    this._sceneDebugSimulation = {
      queuedCommandCount: value?.queuedCommandCount,
      replanningCount: value?.replanningCount
    }
    this._markSceneDebugDirty()
  }

  getSceneDebugSnapshot() {
    return this._publishSceneDebugNow() || this._createSceneDebugSnapshot()
  }

  _createSceneDebugSnapshot() {
    const movement = this._mapData?.movement || {}
    const snapshots = this._movementEngine?.snapshots?.() || []
    const metrics = this._movementEngine?.metrics?.() || {}
    const renderedVisibleCount = this._hallScene?.getRenderedSimulationAgentCount?.()
    const available = this._spriteLoadResult?.available
    const warnings = [
      ...(this._mapData?.movementWarnings || []),
      ...(this._spriteLoadResult?.errors || []),
      ...(this._sceneDebugBackend?.warnings || [])
    ]
    const snapshot = aggregateSceneDebug({
      ready: this._initialized,
      degraded: Boolean(
        this._fatalError
        || this._spriteLoadResult?.degraded
        || this._sceneDebugBackend?.degraded
      ),
      fatalError: this._fatalError,
      camera: {
        ...(this.getCameraSnapshot() || {}),
        viewport: this._hallScene?._viewportSize?.() || {}
      },
      input: this.getInputSnapshot(),
      map: {
        tmxLoaded: Boolean(this._mapData),
        movementReady: this._mapData?.movementReady,
        sceneId: movement.sceneId,
        movementSchemaVersion: movement.movementSchemaVersion,
        navGraphVersion: movement.navGraphVersion,
        hotspotCount: this._mapData?.hotspots?.length
      },
      sprites: {
        manifestReady: Boolean(PERSONA_SPRITE_MANIFEST?.personas),
        manifestVersion: PERSONA_SPRITE_MANIFEST?.version,
        requiredMissingCount: this._spriteLoadResult?.requiredMissingCount,
        optionalMissingCount: this._spriteLoadResult?.optionalMissingCount,
        placeholderCount: this._spriteLoadResult?.placeholderCount
      },
      backend: this._sceneDebugBackend,
      simulation: {
        ready: Boolean(this._movementEngine),
        visibleCount: Number.isSafeInteger(renderedVisibleCount)
          ? renderedVisibleCount
          : snapshots.length,
        movingCount: snapshots.filter(agent => agent?.phase === 'moving').length,
        blockedCount: snapshots.filter(agent => agent?.phase === 'blocked').length,
        queuedCommandCount: this._sceneDebugSimulation.queuedCommandCount
          ?? metrics.queuedCommandCount,
        replanningCount: this._sceneDebugSimulation.replanningCount
          ?? metrics.replanningCount
      },
      agents: snapshots.map(agent => ({
        agentId: agent?.agentId,
        personaCode: agent?.personaCode,
        behavior: agent?.behavior,
        phase: agent?.phase,
        regionId: agent?.regionId,
        targetRegionId: agent?.targetRegionId,
        spriteLoaded: Boolean(available?.has?.(agent?.personaCode)),
        placeholder: false
      })),
      warnings
    })
    return snapshot
  }

  _publishSceneDebug() {
    return this._markSceneDebugDirty()
  }

  _markSceneDebugDirty() {
    if (!sceneDebugEnabled()) return null
    const target = sceneDebugTarget()
    if (!target) return null
    this._sceneDebugDirty = true
    if (this._sceneDebugPublishHandle !== null) return null
    const generation = this._generation
    const publish = () => {
      this._sceneDebugPublishHandle = null
      this._sceneDebugPublishCancel = null
      if (!this._sceneDebugDirty || generation !== this._generation) return
      this._sceneDebugDirty = false
      this._publishSceneDebugNow()
    }
    if (typeof target.requestAnimationFrame === 'function') {
      const handle = target.requestAnimationFrame(publish)
      this._sceneDebugPublishHandle = handle
      this._sceneDebugPublishCancel = () => target.cancelAnimationFrame?.(handle)
    } else {
      const handle = setTimeout(publish, 0)
      this._sceneDebugPublishHandle = handle
      this._sceneDebugPublishCancel = () => clearTimeout(handle)
    }
    return null
  }

  _publishSceneDebugNow() {
    if (!sceneDebugEnabled()) return null
    const target = sceneDebugTarget()
    if (!target) return null
    const publication = this._createSceneDebugSnapshot()
    try {
      Object.defineProperty(target, SCENE_DEBUG_KEY, {
        value: publication,
        configurable: true,
        enumerable: false,
        writable: false
      })
      this._sceneDebugPublication = publication
      return publication
    } catch {
      return null
    }
  }

  _cancelSceneDebugPublication() {
    try { this._sceneDebugPublishCancel?.() } catch { /* best-effort debug cleanup */ }
    this._sceneDebugPublishHandle = null
    this._sceneDebugPublishCancel = null
    this._sceneDebugDirty = false
  }

  _removeSceneDebug() {
    const target = sceneDebugTarget()
    if (target && target[SCENE_DEBUG_KEY] === this._sceneDebugPublication) {
      try { delete target[SCENE_DEBUG_KEY] } catch { /* external debug owner retained */ }
    }
    this._sceneDebugPublication = null
  }
}

export const juyitingGame = new JuyitingGame()
export default juyitingGame

function simulationInitializationError(error) {
  if (error?.code === 'SIMULATION_INIT_FAILED') return error
  const result = new Error(error?.message || 'Juyiting simulation could not be initialized')
  Object.assign(result, {
    code: 'SIMULATION_INIT_FAILED',
    severity: 'fatal',
    retryable: true,
    userMessage: 'Juyiting movement is unavailable. Retry initialization.',
    technicalMessage: error?.message || String(error),
    source: 'simulation'
  })
  return result
}

function sceneDebugTarget() {
  if (typeof window !== 'undefined') return window
  if (typeof globalThis !== 'undefined') return globalThis
  return null
}

function sceneDebugEnabled() {
  if (import.meta.env?.VITE_JUYITING_SCENE_DEBUG === 'true') return true
  if (import.meta.env?.MODE === 'test') return true
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('scene-debug') === '1') return true
  return typeof process !== 'undefined'
    && process.argv?.some(argument => /(?:mocha|vitest|node:test)/i.test(argument))
}
