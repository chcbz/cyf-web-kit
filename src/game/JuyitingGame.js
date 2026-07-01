/**
 * 聚义厅 melonJS game instance manager
 */

import { createGameConfig } from './config.js'
import { HALL_MAP_RESOURCE, HALL_RESOURCES } from './resources.js'
import { parseJuyiHallTmx } from './tiledMap.js'
import { createHallSceneClass } from './scenes/HallScene.js'
import { createHallAgentClass } from './entities/HallAgent.js'

export class JuyitingGame {
  constructor() {
    this._me = null
    this._container = null
    this._hallScene = null
    this._callbacks = {}
    this._initialized = false
    this._mapData = null
    this._pendingStart = false
    this._generation = 0
    this._mountToken = null
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
    const mountToken = ++this._generation
    this._mountToken = mountToken
    const me = await this._loadMelonJS()
    await this._waitForEngineReady(me)
    if (!this._isCurrentMount(mountToken)) return

    this._container = container
    this._callbacks = {
      onAgentClick: options.onAgentClick || null,
      onHotspotClick: options.onHotspotClick || null,
      onReady: options.onReady || null
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
    if (canvas) canvas.style.background = 'transparent'

    // === Load all resources, then start ===
    let loaded = 0
    const total = HALL_RESOURCES.length
    if (total === 0) {
      this._startGame(me, mountToken)
      return
    }

    const checkDone = () => {
      if (!this._isCurrentMount(mountToken)) return
      loaded++
      if (loaded >= total) {
        this._prepareMapData(me)
        this._startGame(me, mountToken)
      }
    }

    HALL_RESOURCES.forEach(res => {
      try {
        me.loader.load(
          res,
          () => checkDone(),       // success
          (err) => {               // error
            console.warn('[JuyitingGame] Failed:', res.name, err)
            checkDone()
          }
        )
      } catch (e) {
        console.warn('[JuyitingGame] Load error:', res.name, e.message)
        checkDone()
      }
    })
  }

  _isCurrentMount(mountToken) {
    return this._mountToken === mountToken
  }

  _prepareMapData(me) {
    const tmx = me.loader.getTMX?.(HALL_MAP_RESOURCE.name)
    try {
      this._mapData = tmx ? parseJuyiHallTmx(tmx) : null
    } catch (error) {
      console.warn('[JuyitingGame] TMX parse failed:', error?.message || error)
      this._mapData = null
    }
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
    setTimeout(() => {
      if (this._isCurrentMount(mountToken) && this._callbacks.onReady) this._callbacks.onReady()
    }, 200)
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
    this.pause()
    if (this._hallScene) {
      this._hallScene.onDestroyEvent()
      this._hallScene = null
    }
    this._me = null
    this._initialized = false
    this._mapData = null
    this._pendingStart = false
  }

  syncAgents(list) {
    if (this._hallScene) this._hallScene.syncAgents(list)
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
}

export const juyitingGame = new JuyitingGame()
export default juyitingGame
