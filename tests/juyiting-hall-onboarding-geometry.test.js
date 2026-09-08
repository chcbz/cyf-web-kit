import { readFileSync } from 'node:fs'
import { expect } from 'chai'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'
import * as geometry from '../src/components/juyiting/hallOnboardingGeometry.js'

global.Element = global.window?.Element
global.HTMLElement = global.window?.HTMLElement
global.SVGElement = global.window?.SVGElement
global.Node = global.window?.Node

const onboardingUrl = new URL('../src/components/juyiting/HallOnboarding.vue', import.meta.url)
const onboardingSource = readFileSync(onboardingUrl, 'utf8')

const vueImportToVar = (_line, imports) => {
  const bindings = imports.split(',').map(part => {
    const [name, alias] = part.trim().split(/\s+as\s+/)
    return alias ? `${name}: ${alias}` : name
  }).join(', ')
  return `var { ${bindings} } = Vue`
}

const loadOnboarding = game => {
  const { descriptor } = parse(onboardingSource, { filename: onboardingUrl.pathname })
  const body = compileScript(descriptor, { id: 'hall-onboarding-geometry', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+\{\s*guestDemoTemplates\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var guestDemoTemplates = []')
    .replace(/^import\s+\{\s*juyitingGame\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var juyitingGame = game')
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/hallOnboardingGeometry\.js['"];?\s*$/gm, (_line, imports) => {
      const bindings = imports.split(',').map(part => part.trim()).filter(Boolean).join(', ')
      return `var { ${bindings} } = geometry`
    })
    .replace('export default', 'return')
  return new Function('Vue', 'game', 'geometry', body)(Vue, game, geometry)
}

const restoreDescriptor = (target, key, descriptor) => {
  if (descriptor) Object.defineProperty(target, key, descriptor)
  else delete target[key]
}

describe('HallOnboarding mounted geometry', () => {
  let frames
  let nextFrameId
  let originalRaf
  let originalCancelRaf
  let originalResizeObserver
  let originalInnerWidth
  let originalInnerHeight
  let originalVisualViewport
  let originalOffsetHeight

  beforeEach(() => {
    frames = new Map()
    nextFrameId = 0
    originalRaf = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame')
    originalCancelRaf = Object.getOwnPropertyDescriptor(window, 'cancelAnimationFrame')
    originalResizeObserver = Object.getOwnPropertyDescriptor(window, 'ResizeObserver')
    originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    originalOffsetHeight = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetHeight')

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: null })
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: callback => {
        const id = ++nextFrameId
        frames.set(id, callback)
        return id
      }
    })
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: id => frames.delete(id) })
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class {
        constructor (callback) { this.callback = callback }
        observe () {}
        unobserve () {}
        disconnect () {}
      }
    })
    Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get () { return this.classList?.contains('onboarding-dialog') ? 280 : 0 }
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    frames.clear()
    restoreDescriptor(window, 'requestAnimationFrame', originalRaf)
    restoreDescriptor(window, 'cancelAnimationFrame', originalCancelRaf)
    restoreDescriptor(window, 'ResizeObserver', originalResizeObserver)
    restoreDescriptor(window, 'innerWidth', originalInnerWidth)
    restoreDescriptor(window, 'innerHeight', originalInnerHeight)
    restoreDescriptor(window, 'visualViewport', originalVisualViewport)
    restoreDescriptor(window.HTMLElement.prototype, 'offsetHeight', originalOffsetHeight)
  })

  const runFrame = async () => {
    const pending = frames.entries().next().value
    expect(pending, 'an onboarding geometry frame should be scheduled').to.not.equal(undefined)
    frames.delete(pending[0])
    pending[1](0)
    await Vue.nextTick()
  }

  const mountFixture = async ({ mode = 'portrait-command', virtual = false, targetRect = null, game = null } = {}) => {
    const page = document.createElement('main')
    page.className = `juyi-page experience-${mode}${virtual ? ' is-virtual-landscape' : ''}`
    const target = document.createElement('div')
    target.dataset.tour = mode === 'landscape-map' ? 'landscape-map' : 'portrait-preview'
    let currentRect = targetRect
    target.getBoundingClientRect = () => currentRect || { left: 24, top: 160, right: 366, bottom: 360, width: 342, height: 200 }
    target.scrollIntoView = () => {
      currentRect = { left: 24, top: 160, right: 366, bottom: 360, width: 342, height: 200 }
    }
    page.appendChild(target)

    const board = document.createElement('div')
    board.className = 'hall-board'
    const layer = document.createElement('div')
    layer.className = 'melon-layer'
    const canvas = document.createElement('canvas')
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844 })
    layer.appendChild(canvas)
    board.appendChild(layer)
    page.appendChild(board)

    const host = document.createElement('div')
    document.body.append(page, host)
    const gameFixture = game || {
      focusHotspot: () => false,
      getHotspotScreenBounds: () => null,
      getRenderSnapshot: () => ({ viewport: { width: 390, height: 844 } })
    }
    const wrapper = mount(loadOnboarding(gameFixture), { attachTo: host, props: { modelValue: true } })
    await Vue.nextTick()
    await Vue.nextTick()
    return { wrapper, page, target }
  }

  const dialogVisualRect = () => {
    const dialog = document.querySelector('.onboarding-dialog')
    const left = Number.parseFloat(dialog.style.left)
    const top = Number.parseFloat(dialog.style.top)
    const width = Number.parseFloat(dialog.style.width)
    if (dialog.style.transform.includes('rotate')) {
      return { left: left - 280, top, right: left, bottom: top + width }
    }
    return { left, top, right: left + width, bottom: top + 280 }
  }

  it('scrolls a partially clipped portrait target once, then renders a finite card fully inside the viewport', async () => {
    const fixture = await mountFixture({
      targetRect: { left: 24, top: 720, right: 366, bottom: 900, width: 342, height: 180 }
    })
    await runFrame()
    await runFrame()

    const spotlight = document.querySelector('.onboarding-spotlight')
    expect(spotlight).to.not.equal(null)
    for (const property of ['left', 'top', 'width', 'height']) {
      expect(Number.isFinite(Number.parseFloat(spotlight.style[property]))).to.equal(true)
    }
    const card = dialogVisualRect()
    expect(card.left).to.be.at.least(12)
    expect(card.top).to.be.at.least(12)
    expect(card.right).to.be.at.most(378)
    expect(card.bottom).to.be.at.most(832)
    fixture.wrapper.unmount()
  })

  it('keeps a missing target card centered with navigation and explanatory fallback content', async () => {
    const fixture = await mountFixture()
    fixture.target.remove()
    await runFrame()

    expect(document.querySelector('.onboarding-spotlight')).to.equal(null)
    expect(document.querySelector('.target-note')?.textContent).to.include('暂未显示')
    const card = dialogVisualRect()
    expect(card.left).to.equal(15)
    expect(card.top).to.equal(282)
    expect(document.querySelector('.next-button')).to.not.equal(null)
    expect(document.querySelector('.skip-button')).to.not.equal(null)
    fixture.wrapper.unmount()
  })

  it('restarts at the matching first step after a portrait-to-landscape class switch', async () => {
    const fixture = await mountFixture()
    await runFrame()
    document.querySelector('.next-button').click()
    await Vue.nextTick()
    fixture.page.className = 'juyi-page experience-landscape-map'
    window.dispatchEvent(new window.Event('resize'))
    await runFrame()

    expect(document.querySelector('.eyebrow')?.textContent).to.include('横屏全景')
    expect(document.querySelector('.step-progress')?.textContent).to.include('第 1 步')
    expect(document.querySelector('#hall-onboarding-title')?.textContent).to.equal('地图是厅中动态的入口')
    fixture.wrapper.unmount()
  })

  it('focuses a shipped hotspot before measuring it and keeps virtual-landscape text aligned with the rotated hall', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
    const calls = []
    const game = {
      focusHotspot: id => { calls.push(id); return true },
      getHotspotScreenBounds: id => id === 'main-seat' ? { x: 70, y: 222, width: 110, height: 48 } : null,
      getRenderSnapshot: () => ({ viewport: { width: 844, height: 390 } })
    }
    const fixture = await mountFixture({ mode: 'landscape-map', virtual: true, game })
    await runFrame()
    document.querySelector('.next-button').click()
    await Vue.nextTick()
    await runFrame()

    expect(calls).to.deep.equal(['main-seat'])
    expect(document.querySelector('.onboarding-dialog').style.transform).to.include('rotate(90deg)')
    expect(document.querySelector('.onboarding-spotlight')).to.not.equal(null)
    const card = dialogVisualRect()
    expect(card.left).to.be.at.least(12)
    expect(card.top).to.be.at.least(12)
    expect(card.right).to.be.at.most(378)
    expect(card.bottom).to.be.at.most(832)
    fixture.wrapper.unmount()
  })
})
