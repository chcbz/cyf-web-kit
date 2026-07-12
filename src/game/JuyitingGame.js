/**
 * 鑱氫箟鍘?melonJS game instance manager
 */

import { createGameConfig } from './config.js'
import { HALL_BOOT_RESOURCES, HALL_MAP_RESOURCE, buildHallMapResources } from './resources.js'
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

    // === Load boot resources, parse TMX, then load resources declared by TMX ===
    await this._loadResources(me, HALL_BOOT_RESOURCES, mountToken)
    if (!this._isCurrentMount(mountToken)) return

    await this._prepareMapData(me)
    if (!this._isCurrentMount(mountToken)) return

    await this._loadResources(me, buildHallMapResources(this._mapData), mountToken)
    if (!this._isCurrentMount(mountToken)) return

    this._startGame(me, mountToken)
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
        console.warn("[JuyitingGame] Direct TMX fetch failed:", err?.message || err)
      }
    }

    try {
      this._mapData = tmx ? parseJuyiHallTmx(tmx) : null
    } catch (error) {
      console.warn("[JuyitingGame] TMX parse failed:", error?.message || error)
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

  resetToMainHall() {
    return this._hallScene?.resetToMainHall?.()
  }
}

export const juyitingGame = new JuyitingGame()
export default juyitingGame
