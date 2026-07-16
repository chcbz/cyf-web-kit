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

export class JuyitingGame {
  constructor() {
    this._me = null
    this._container = null
    this._hallScene = null
    this._callbacks = {}
    this._initialized = false
    this._mapData = null
    this._spriteLoadResult = null
    this._spriteLoadTimeoutMs = 5_000
    this._spriteLoadAbortController = null
    this._readyTimer = null
    this._canvas = null
    this._pendingStart = false
    this._generation = 0
    this._mountToken = null
    this._movementEngine = null
    this._pendingSimulationPhaseEvents = []
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
        renderer: me.video.CANVAS,
        scale: 'auto',
        scaleMethod: 'fit'
      })

      // Make canvas background transparent to show DOM underneath
      const canvas = container.querySelector('canvas')
      this._canvas = canvas || null
      if (canvas) canvas.style.background = 'transparent'

      // === Load boot resources, parse TMX, then load resources declared by TMX ===
      await this._loadResources(me, HALL_BOOT_RESOURCES, mountToken)
      if (!this._isCurrentMount(mountToken)) return

      await this._prepareMapData(me)
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

      this._initializeSimulationRuntime()

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
      if (this._isCurrentMount(mountToken)) this._cleanupFailedMount(me)
      throw failure
    }
  }

  _cleanupFailedMount(me) {
    this._generation += 1
    this._mountToken = null
    this._cleanupRuntime(me)
  }

  _cleanupRuntime(me = this._me) {
    this._spriteLoadAbortController?.abort()
    this._spriteLoadAbortController = null
    if (this._readyTimer !== null) clearTimeout(this._readyTimer)
    this._readyTimer = null
    try { me?.state?.pause?.() } catch { /* preserve the original mount failure */ }
    try { this._hallScene?.onDestroyEvent?.() } catch { /* best-effort scene cleanup */ }
    try { me?.video?.destroy?.() } catch { /* best-effort renderer cleanup */ }
    try { this._canvas?.remove?.() } catch { /* best-effort canvas cleanup */ }
    this._canvas = null
    this._hallScene = null
    this._container = null
    this._callbacks = {}
    this._me = null
    this._initialized = false
    this._mapData = null
    this._spriteLoadResult = null
    this._pendingStart = false
    this._movementEngine = null
    this._pendingSimulationPhaseEvents = []
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

  async _prepareMapData(me) {
    let tmx = me.loader.getTMX?.(HALL_MAP_RESOURCE.name)

    if (!tmx) {
      try {
        const resp = await fetch(HALL_MAP_RESOURCE.src)
        const xmlText = await resp.text()
        tmx = xmlText
      } catch (err) {
        console.warn('[JuyitingGame] Direct TMX fetch failed:', err?.message || err)
      }
    }

    this._mapData = parseJuyiHallTmx(tmx)
    this._hallScene?.setMapData(this._mapData)
  }

  _startGame(me, mountToken = this._mountToken) {
    if (!this._isCurrentMount(mountToken)) return
    // Register and switch to PLAY state
    me.state.set(me.state.PLAY, this._hallScene, true)
    this._initialized = true
    if (this._pendingStart) {
      this._pendingStart = false
      me.state.change(me.state.PLAY, true)
    }
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
        update: deltaMs => this._movementEngine?.update(deltaMs),
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
    } catch (error) {
      throw simulationInitializationError(error)
    }
  }

  start() {
    if (!this._me) return
    if (!this._initialized) {
      this._pendingStart = true
      return
    }
    this._me.state.change(this._me.state.PLAY, true)
  }

  pause() {
    if (!this._me) return
    this._me.state.pause()
  }

  destroy() {
    this._generation += 1
    this._mountToken = null
    this._cleanupRuntime(this._me)
  }

  syncAgents(list) {
    if (this._hallScene) this._hallScene.syncAgents(list)
  }

  syncAgentSnapshots(list) {
    this._hallScene?.syncAgentSnapshots?.(list)
  }

  enqueueMovementCommands(commands) {
    const list = Array.isArray(commands) ? commands : [commands]
    if (!this._movementEngine) {
      return list.map(() => ({ accepted: false, reason: 'simulation-unavailable' }))
    }
    return list.map(command => this._movementEngine.enqueue(command))
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
    return this._hallScene?.panBy?.(dx, dy)
  }

  zoomBy(delta) {
    return this._hallScene?.zoomBy?.(delta)
  }

  resetTransform() {
    return this._hallScene?.resetTransform?.()
  }

  fitToViewport() {
    return this._hallScene?.fitToViewport?.()
  }

  resizeViewport(change) {
    return this._hallScene?.resizeViewport?.(change)
  }

  setInteractionLocked(locked, reason = 'panel') {
    return this._hallScene?.setInteractionLocked?.(locked, reason)
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
    return this._hallScene?.resetToMainHall?.()
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
