/**
 * ������ melonJS game instance manager
 */

import { createGameConfig } from './config.js'
import { HALL_RESOURCES } from './resources.js'
import { createHallSceneClass } from './scenes/HallScene.js'
import { createHallAgentClass } from './entities/HallAgent.js'

class JuyitingGame {
  constructor() {
    this._me = null
    this._container = null
    this._hallScene = null
    this._callbacks = {}
    this._initialized = false
  }

  async _loadMelonJS() {
    if (this._me) return this._me
    const m = await import('melonjs')
    this._me = m.default || m
    return this._me
  }

  async mount(container, options = {}) {
    if (this._initialized) return
    const me = await this._loadMelonJS()
    if (!container) throw new Error('container required')

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
    this._hallScene.onAgentClick((d) => this._callbacks.onAgentClick?.(d))
    this._hallScene.onHotspotClick((d) => this._callbacks.onHotspotClick?.(d))
    this._hallScene.onReady(() => this._callbacks.onReady?.())

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
      this._startGame(me)
      return
    }

    const checkDone = () => {
      loaded++
      if (loaded >= total) {
        this._startGame(me)
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

  _startGame(me) {
    // Register and switch to PLAY state
    me.state.set(me.state.PLAY, this._hallScene, true)
    this._initialized = true
    // Emit ready again if onResetEvent didn't call it
    setTimeout(() => {
      if (this._callbacks.onReady) this._callbacks.onReady()
    }, 200)
  }

  start() {
    if (!this._me) return
    this._me.state.restart()
  }

  pause() {
    if (!this._me) return
    this._me.state.pause()
  }

  destroy() {
    this.pause()
    if (this._hallScene) {
      this._hallScene.onDestroyEvent()
      this._hallScene = null
    }
    this._me = null
    this._initialized = false
  }

  syncAgents(list) {
    if (this._hallScene) this._hallScene.syncAgents(list)
  }

  updateAgentSceneState(agentId, state) {
    if (this._hallScene) this._hallScene.updateAgentSceneState(agentId, state)
  }

  setSelectedAgent(agentId) {
    if (this._hallScene) this._hallScene.setSelectedAgent(agentId)
  }
}

export const juyitingGame = new JuyitingGame()
export default juyitingGame
