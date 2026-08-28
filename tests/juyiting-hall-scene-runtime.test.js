import { expect } from 'chai'

import { createHallSceneClass } from '../src/game/scenes/HallScene.js'
import { JuyitingGame } from '../src/game/JuyitingGame.js'
import { HALL_MAP_RESOURCE } from '../src/game/resources.js'
import { readFileSync } from 'node:fs'
import { useHallCommandQueue } from '../src/composables/juyiting/useHallCommandQueue.js'
import { useHallSceneState } from '../src/composables/juyiting/useHallSceneState.js'
import { parseMovementTmx } from '../src/game/map/tmxMovementParser.js'
import { PERSONA_SPRITE_MANIFEST } from '../src/game/sprites/personaSpriteManifest.js'
import { createMovementEngine } from '../src/game/simulation/movementEngine.js'

const HALL_XML = readFileSync('public/juyiting/hall.tmx', 'utf8')

describe('HallScene melonJS runtime compatibility', () => {
  it('prefetches the SHA-versioned TMX and registers its XML through the melonJS data path', async () => {
    const originalFetch = globalThis.fetch
    const fetched = []
    const loaded = []
    const mountToken = Symbol('mount')
    const game = new JuyitingGame()
    game._mountToken = mountToken

    try {
      globalThis.fetch = async url => {
        fetched.push(url)
        return { ok: true, status: 200, text: async () => HALL_XML }
      }
      const me = {
        loader: {
          load: (resource, onload) => {
            loaded.push(resource)
            onload()
          }
        }
      }

      await game._loadResources(me, [HALL_MAP_RESOURCE], mountToken)

      expect(fetched).to.deep.equal([HALL_MAP_RESOURCE.src])
      expect(loaded).to.have.length(1)
      expect(loaded[0]).to.deep.include(HALL_MAP_RESOURCE)
      expect(loaded[0].data).to.equal(HALL_XML)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('derives an identical canvas display rectangle regardless of prior melonJS fit styles', () => {
    const displayVariables = new Map()
    const canvas = {
      style: {
        width: '809.6px',
        height: '451.51px',
        transform: '',
        setProperty: (name, value) => displayVariables.set(name, value)
      }
    }
    const game = new JuyitingGame()
    game._canvas = canvas
    game._container = {
      getBoundingClientRect: () => ({ width: 844, height: 390 })
    }
    game._me = { game: { viewport: { width: 1664, height: 928 } } }
    game._markSceneDebugDirty = () => {}

    game._applyCanvasCover()
    const firstDisplay = {
      width: displayVariables.get('--juyiting-canvas-display-width'),
      height: displayVariables.get('--juyiting-canvas-display-height')
    }

    canvas.style.width = '1451.68px'
    canvas.style.height = '809.55px'
    game._applyCanvasCover()

    expect(displayVariables.get('--juyiting-canvas-display-width')).to.equal(firstDisplay.width)
    expect(displayVariables.get('--juyiting-canvas-display-height')).to.equal(firstDisplay.height)
    expect(firstDisplay).to.deep.equal({ width: '844px', height: '470.692px' })
    expect(canvas.style.transform).to.equal('translate(-50%, -50%)')
  })

  it('commits final canvas geometry once before resizing the scene across orientation changes', () => {
    const displayVariables = new Map([
      ['--juyiting-canvas-display-width', '1513.38px'],
      ['--juyiting-canvas-display-height', '844px']
    ])
    let container = { width: 844, height: 390 }
    const displayNumber = name => Number.parseFloat(displayVariables.get(name))
    const canvas = {
      style: {
        transform: '',
        setProperty: (name, value) => displayVariables.set(name, value)
      },
      getBoundingClientRect: () => {
        const width = displayNumber('--juyiting-canvas-display-width')
        const height = displayNumber('--juyiting-canvas-display-height')
        const left = (container.width - width) / 2
        const top = (container.height - height) / 2
        return { width, height, left, top, right: left + width, bottom: top + height }
      }
    }
    const resizeCalls = []
    const game = new JuyitingGame()
    game._canvas = canvas
    game._container = { getBoundingClientRect: () => ({ ...container, left: 0, top: 0, right: container.width, bottom: container.height }) }
    game._me = { game: { viewport: { width: 1664, height: 928 } } }
    game._hallScene = { resizeViewport: change => resizeCalls.push(change) }
    game._markSceneDebugDirty = () => {}

    game._pendingViewportChange = { width: 844, height: 390, kind: 'orientation', orientationChanged: true }
    game._commitViewportGeometry(game._geometrySnapshot())

    expect(displayVariables.get('--juyiting-canvas-display-width')).to.equal('844px')
    expect(displayVariables.get('--juyiting-canvas-display-height')).to.equal('470.692px')
    expect(resizeCalls).to.have.length(1)
    expect(resizeCalls[0].displayViewport).to.deep.equal({ width: 844, height: 390 })
    expect(resizeCalls[0].visibleViewport.width).to.equal(1664)
    expect(resizeCalls[0].visibleViewport.height).to.be.closeTo(768.91, 0.01)

    game._pendingViewportChange = { width: 844, height: 390, kind: 'layout' }
    game._commitViewportGeometry(game._geometrySnapshot())
    expect(resizeCalls).to.have.length(1)

    container = { width: 390, height: 844 }
    game._pendingViewportChange = { width: 390, height: 844, kind: 'orientation', orientationChanged: true }
    game._commitViewportGeometry(game._geometrySnapshot())

    expect(displayVariables.get('--juyiting-canvas-display-width')).to.equal('1513.379px')
    expect(displayVariables.get('--juyiting-canvas-display-height')).to.equal('844px')
    expect(resizeCalls).to.have.length(2)
    expect(resizeCalls[1].displayViewport).to.deep.equal({ width: 390, height: 844 })
    expect(resizeCalls[1].visibleViewport.width).to.be.closeTo(428.82, 0.01)
    expect(resizeCalls[1].visibleViewport.height).to.equal(928)
  })

  it('registers a mount-specific melon state and starts that exact stage', () => {
    const calls = []
    const game = new JuyitingGame()
    const me = {
      state: {
        USER: 100,
        PLAY: 3,
        set: (...args) => calls.push(['set', ...args]),
        change: (...args) => calls.push(['change', ...args])
      }
    }
    game._me = me
    game._mountToken = 7
    game._hallScene = { stage: true }
    game._markSceneDebugDirty = () => {}

    game._startGame(me, 7)
    game.start()

    expect(calls).to.deep.equal([
      ['set', 101, game._hallScene],
      ['change', 101, true]
    ])
  })

  it('exposes command, snapshot, movement-map, and phase-event simulation facades', () => {
    const enqueued = []
    const synced = []
    const movement = { sceneId: 'juyiting-main' }
    const game = new JuyitingGame()
    game._movementEngine = { enqueue: command => { enqueued.push(command); return { accepted: true } } }
    game._mapData = { movement }
    game._hallScene = { syncAgentSnapshots: snapshots => synced.push(snapshots) }
    game._pendingSimulationPhaseEvents = [{ reportId: 'phase-1', phase: 'arrived' }]

    expect(game.enqueueMovementCommands([{ commandId: 'move-1' }])).to.deep.equal([{ accepted: true }])
    game.syncAgentSnapshots([{ agentId: 'agent-songjiang', x: 10, y: 20 }])
    const phases = game.drainSimulationPhaseEvents()
    phases[0].phase = 'mutated'

    expect(enqueued).to.deep.equal([{ commandId: 'move-1' }])
    expect(synced).to.deep.equal([[{ agentId: 'agent-songjiang', x: 10, y: 20 }]])
    expect(game.getMovementRuntime()).to.equal(movement)
    expect(game.drainSimulationPhaseEvents()).to.deep.equal([])
  })

  for (const cancellation of ['blocked', 'absent']) {
    it(`cancels ${cancellation} backend state through the real game facade without stale arrival`, () => {
      const runtime = parseMovementTmx(HALL_XML)
      const game = new JuyitingGame()
      game._movementEngine = createMovementEngine(runtime, PERSONA_SPRITE_MANIFEST, {
        now: () => 2_000
      })
      const commandQueue = useHallCommandQueue()
      const sceneState = useHallSceneState({ commandQueue, now: () => 2_000 })
      sceneState.setMapRuntime(runtime)
      commandQueue.setSimulation({
        enqueue: command => game.enqueueMovementCommands([command])[0],
        cancel: (agentId, stateVersion) => game.cancelMovement(agentId, stateVersion)
      })
      sceneState.applySnapshot({
        sceneId: 'juyiting-main', sceneVersion: 1,
        states: [{
          agentId: 'agent-songjiang', personaCode: 'songjiang',
          behavior: 'moving_to_discussion', targetRegionId: 'council-table',
          stateVersion: 1, startedAt: 1_000, expectedArrivalAt: 20_000,
          phase: 'moving'
        }]
      })
      expect(game._movementEngine.snapshots()[0].phase).to.equal('moving')

      if (cancellation === 'absent') {
        sceneState.applySnapshot({ sceneId: 'juyiting-main', sceneVersion: 2, states: [] })
      } else {
        sceneState.applyEvent({
          sceneVersion: 2,
          state: {
            agentId: 'agent-songjiang', personaCode: 'songjiang', behavior: 'blocked',
            targetRegionId: 'unknown-region', stateVersion: 2, startedAt: 2_000,
            phase: 'blocked'
          }
        })
      }
      game._movementEngine.update(120_000)

      expect(game._movementEngine.snapshots()[0].phase).not.to.equal('arrived')
      expect(game._movementEngine.drainPhaseEvents()).to.deep.equal([])
    })
  }

  it('syncs simulation snapshots into native HallAgent entities without CSS transforms', () => {
    const added = []
    class Stage { update () {} }
    class Agent {
      static supports () { return true }
      static create (data) { return new Agent(data) }
      constructor (data) {
        this.agentId = data.agentId
        this.personaCode = data.personaCode
        this.pos = { x: data.x, y: data.y }
        this.snapshots = []
      }
      syncState () {}
      syncSimulationSnapshot (snapshot) {
        this.snapshots.push(snapshot)
        this.pos = { x: snapshot.x, y: snapshot.y }
      }
    }
    const me = {
      Stage,
      game: {
        viewport: { width: 960, height: 640 },
        world: {
          addChild: agent => added.push(agent),
          removeChild: () => {}
        }
      }
    }
    const HallScene = createHallSceneClass(me, Agent)
    const scene = new HallScene()
    scene.setAvailablePersonas(new Set(['songjiang']))

    scene.syncAgentSnapshots([{
      agentId: 'agent-songjiang', personaCode: 'songjiang', x: 480, y: 320,
      facing: 'right', animation: 'walk', behavior: 'moving_to_discussion', phase: 'moving',
      regionId: 'main-seat', targetRegionId: 'council-table', stateVersion: 16
    }])
    scene._fullSyncAgentSnapshots()

    expect(added).to.have.length(1)
    expect(scene.getAgent('agent-songjiang').pos).to.deep.equal({ x: 480, y: 320 })
    expect(scene.getAgent('agent-songjiang').snapshots).to.have.length(1)
  })

  it('stops simulation frame updates and phase draining after scene destroy', () => {
    let updates = 0
    let drains = 0
    class Stage { update () {} }
    const me = {
      Stage,
      game: { viewport: { width: 960, height: 640 }, world: {} },
      input: { releaseAllPointerEvents: () => {} }
    }
    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    scene._sceneBuilt = true
    scene.setSimulationRuntime({
      update: () => { updates += 1 },
      snapshots: () => [],
      drainPhaseEvents: () => { drains += 1; return [] }
    })

    scene.update(16)
    scene.onDestroyEvent()
    scene.update(16)

    expect(updates).to.equal(1)
    expect(drains).to.equal(1)
  })

  it('retries input controller creation after the canvas becomes available', () => {
    class Stage { update () {} }
    const HallScene = createHallSceneClass({
      Stage,
      game: { viewport: { width: 960, height: 640 }, world: {} }
    }, class {})
    const scene = new HallScene()
    scene._sceneBuilt = true
    scene._cameraController = { snapshot: () => ({ transform: { zoom: 1, offsetX: 0, offsetY: 0 } }) }
    let attempts = 0
    scene._createInput = () => {
      attempts += 1
      scene._inputController = { snapshot: () => ({ activeGesture: 'none', interactionLocked: false }) }
      return true
    }

    scene.update(16)

    expect(attempts).to.equal(1)
    expect(scene._inputController).not.to.equal(null)
  })

  it('keeps camera and input facades null-safe before mount and after destroy', () => {
    const game = new JuyitingGame()

    expect(game.getCameraSnapshot()).to.equal(null)
    expect(game.getInputSnapshot()).to.equal(null)
    expect(game.resizeViewport({ width: 800, height: 600, kind: 'layout' })).to.equal(undefined)
    expect(game.setInteractionLocked(true)).to.equal(undefined)
    expect(game.resetToMainHall()).to.equal(undefined)

    game.destroy()
    expect(game.getCameraSnapshot()).to.equal(null)
    expect(game.getInputSnapshot()).to.equal(null)
  })

  it('delegates the camera and input migration facade safely', () => {
    const calls = []
    const game = new JuyitingGame()
    game._hallScene = {
      resizeViewport: change => calls.push(['resize', change]),
      setInteractionLocked: (locked, reason) => calls.push(['lock', locked, reason]),
      getCameraSnapshot: () => ({ presetKey: 'desktop' }),
      inputSnapshot: () => ({ interactionLocked: true }),
      resetToMainHall: () => calls.push(['reset'])
    }

    game.resizeViewport({ width: 800, height: 600, kind: 'layout' })
    game.setInteractionLocked(true, 'panel')
    expect(game.getCameraSnapshot()).to.deep.equal({ presetKey: 'desktop' })
    expect(game.getInputSnapshot()).to.deep.equal({ interactionLocked: true })
    game.resetToMainHall()

    expect(calls).to.deep.equal([
      ['resize', { width: 800, height: 600, kind: 'layout' }],
      ['lock', true, 'panel'],
      ['reset']
    ])
  })

  it('captures, restores, focuses, and clears schema-2 map runtime facades without business state', async () => {
    const originalRequestAnimationFrame = window.requestAnimationFrame
    const originalCancelAnimationFrame = window.cancelAnimationFrame
    const frames = new Map()
    let nextFrame = 1
    let containerRect = { left: 0, top: 0, width: 844, height: 390, right: 844, bottom: 390 }
    const calls = []
    const cameraSnapshot = { presetKey: 'desktop', transform: { zoom: 1, offsetX: 0, offsetY: 0 } }
    const game = new JuyitingGame()
    const canvasVariables = new Map()

    try {
      window.requestAnimationFrame = callback => {
        const id = nextFrame++
        frames.set(id, callback)
        return id
      }
      window.cancelAnimationFrame = id => frames.delete(id)
      game._generation = 77
      game._mountToken = 77
      game._lifecycleGeneration = 9
      game._container = { getBoundingClientRect: () => ({ ...containerRect }) }
      game._canvas = {
        width: 1664,
        height: 928,
        style: {
          transform: '',
          setProperty: (name, value) => canvasVariables.set(name, value)
        },
        getBoundingClientRect: () => ({ ...containerRect })
      }
      game._me = { game: { viewport: { width: 1664, height: 928 } } }
      game._markSceneDebugDirty = () => {}
      game._hallScene = {
        getCameraSnapshot: () => cameraSnapshot,
        restoreCameraSnapshot: (snapshot, sourceViewport) => calls.push(['restore', snapshot, sourceViewport]) || true,
        resizeViewport: change => calls.push(['resize', change]) || { resized: true },
        focusAgent: id => {
          calls.push(['agent', id])
          return true
        },
        focusHotspot: id => {
          calls.push(['hotspot', id])
          return true
        }
      }

      const snapshot = game.captureResumeSnapshot()
      expect(snapshot).to.deep.equal({
        schemaVersion: 2,
        cameraSnapshot,
        sourceViewport: {
          backing: { width: 1664, height: 928 },
          display: { width: 844, height: 390 },
          visible: { x: 0, y: 0, width: 1664, height: 928 }
        },
        mapGeneration: 9
      })

      containerRect = { left: 0, top: 0, width: 390, height: 844, right: 390, bottom: 844 }
      const pending = game.restoreResumeSnapshot(snapshot, { width: 390, height: 844 })
      expect(pending).to.be.an.instanceof(Promise)
      expect(game._viewportCommitWaiters).to.have.length(1)
      const firstFrame = frames.entries().next().value
      expect(firstFrame).to.not.equal(undefined)
      frames.delete(firstFrame[0])
      firstFrame[1]()
      expect(game._viewportCommitWaiters).to.have.length(1)
      const secondFrame = frames.entries().next().value
      expect(secondFrame).to.not.equal(undefined)
      expect(secondFrame[0]).to.not.equal(firstFrame[0])
      frames.delete(secondFrame[0])
      secondFrame[1]()

      expect(await pending).to.deep.equal(cameraSnapshot)
      expect(calls[0]).to.deep.equal(['restore', snapshot.cameraSnapshot, snapshot.sourceViewport])
      expect(calls[1]).to.deep.equal(['resize', {
        width: 1664,
        height: 928,
        kind: 'orientation',
        orientationChanged: true,
        displayViewport: { width: 390, height: 844 },
        visibleViewport: { x: 0, y: 0, width: 1664, height: 928 }
      }])
      expect(game._committedViewportGeometrySignature).to.equal('390:844:1664:928')
      expect(game._pendingViewportRestore).to.equal(null)
      expect(game._pendingViewportChange).to.equal(null)
      expect(game._viewportCommitCandidateSignature).to.equal('')
      expect(game._viewportCommitFrame).to.equal(null)
      expect(game._viewportCommitWaiters).to.have.length(0)
      expect(game.focusAgent('agent-1')).to.equal(true)
      expect(game.focusHotspot('hotspot-1')).to.equal(true)
      expect(calls.slice(2)).to.deep.equal([['agent', 'agent-1'], ['hotspot', 'hotspot-1']])
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
    }
  })


  it('uses non-container image layers so melonJS broadphase does not recurse into them', () => {
    const added = []

    class Stage {
      update() {}
    }

    class Renderable {
      constructor(x, y, width, height) {
        this.pos = { x, y }
        this.width = width
        this.height = height
        this.anchorPoint = { set: () => {} }
      }
    }

    class ImageLayer {
      constructor() {
        this.addChild = () => {}
      }
    }

    const me = {
      ImageLayer,
      Renderable,
      Stage,
      game: {
        viewport: { width: 1672, height: 941 },
        world: {
          addChild: child => added.push(child),
          currentTransform: {
            identity() { return this },
            translate() { return this },
            scale() { return this }
          }
        }
      },
      input: {
        registerPointerEvent: () => {}
      },
      loader: {
        getImage: () => ({ width: 1672, height: 941 })
      }
    }

    const HallScene = createHallSceneClass(me, class {})
    const scene = new HallScene()
    scene.setMapData({
      imageLayers: {
        'mid-occluders': { width: 1672, height: 941 },
        'foreground-occluders': { width: 1672, height: 941 },
        'lighting-overlay': { width: 1672, height: 941 }
      },
      tileLayers: [],
      tilesets: [],
      hotspots: []
    })

    scene._buildScene()

    const imageLayers = added.filter(child => child.image)

    const renderLayerCount = Object.keys(scene._mapData.imageLayers).length
    expect(imageLayers).to.have.length(renderLayerCount)
    expect(imageLayers.every(layer => typeof layer.addChild === 'function')).to.equal(false)
    expect(imageLayers.every(layer => layer.isKinematic === true)).to.equal(true)
    expect(added.filter(child => child.data).every(marker => marker.isKinematic === true)).to.equal(true)
  })

  it('skips image layer removal when the melonJS world no longer owns the layer', () => {
    const warnings = []
    const originalWarn = console.warn

    class Stage {
      update() {}
    }

    class Renderable {
      constructor(x, y, width, height) {
        this.pos = { x, y }
        this.width = width
        this.height = height
        this.anchorPoint = { set: () => {} }
      }
    }

    const me = {
      Renderable,
      Stage,
      game: {
        viewport: { width: 1672, height: 941 },
        world: {
          addChild: () => {},
          currentTransform: {
            identity() { return this },
            translate() { return this },
            scale() { return this }
          },
          hasChild: () => false,
          removeChild: () => {
            throw new Error('Child is not mine.')
          }
        }
      },
      input: {
        registerPointerEvent: () => {},
        releaseAllPointerEvents: () => {}
      },
      loader: {
        getImage: () => ({ width: 1672, height: 941 })
      }
    }

    console.warn = (...args) => warnings.push(args)
    try {
      const HallScene = createHallSceneClass(me, class {})
      const scene = new HallScene()

      scene._buildScene()
      scene.onDestroyEvent()
    } finally {
      console.warn = originalWarn
    }

    expect(warnings).to.deep.equal([])
  })

  it('removes and recreates an existing agent when its normalized persona identity changes', () => {
    const added = []
    const removed = []
    class Stage {}
    class Agent {
      static supports(data) { return ['alpha', 'beta'].includes(String(data.personaCode).toLowerCase()) }
      static create(data) { return new Agent(data) }
      constructor(data) {
        this.personaCode = String(data.personaCode).toLowerCase()
        this._sourceData = data
      }
      syncState(data) { this._sourceData = data }
    }
    const me = {
      Stage,
      game: {
        viewport: { width: 960, height: 640 },
        world: {
          addChild: agent => added.push(agent),
          removeChild: agent => removed.push(agent)
        }
      }
    }
    const HallScene = createHallSceneClass(me, Agent)
    const scene = new HallScene()
    scene.setAvailablePersonas(new Set(['alpha', 'beta']))

    scene.syncAgents([{ agentId: 'shared-id', personaCode: 'Alpha' }])
    scene._fullSyncAgents()
    const original = scene.getAgent('shared-id')

    scene.syncAgents([{ agentId: 'shared-id', personaCode: 'BETA' }])
    scene._fullSyncAgents()
    const replacement = scene.getAgent('shared-id')

    expect(removed).to.deep.equal([original])
    expect(added).to.have.length(2)
    expect(replacement).not.to.equal(original)
    expect(replacement.personaCode).to.equal('beta')
  })
})
