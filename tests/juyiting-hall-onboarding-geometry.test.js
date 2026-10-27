import { readFileSync } from 'node:fs'
import { expect } from 'chai'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'
import * as geometry from '../src/components/juyiting/hallOnboardingGeometry.js'
import { resolveHallNavigationPresentation } from '../src/composables/juyiting/useHallPanels.js'
import { buildNavigationHostSource } from './helpers/juyiting-navigation-host.js'

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

const loadNavigationHost = () => {
  const { descriptor } = parse(buildNavigationHostSource())
  const body = compileScript(descriptor, { id: 'hall-navigation-host', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import.*resolveHallNavigationPresentation.*$/m, '')
    .replace('export default', 'return')
  return new Function('Vue', 'resolveHallNavigationPresentation', body)(Vue, resolveHallNavigationPresentation)
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

  const mountFixture = async ({ mode = 'portrait-command', virtual = false, workbench = false, targetRect = null, game = null } = {}) => {
    const page = document.createElement('main')
    page.className = `juyi-page experience-${mode}${virtual ? ' is-virtual-landscape' : ''}${workbench ? ' home-overview' : ''}`
    const target = document.createElement('div')
    target.dataset.tour = workbench ? 'workbench-request' : mode === 'landscape-map' ? 'landscape-map' : 'portrait-preview'
    target.getClientRects = () => [target.getBoundingClientRect()]
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

  it('keeps the four-step guide centered without scrolling or spotlighting a clipped map target', async () => {
    const fixture = await mountFixture({
      targetRect: { left: 24, top: 720, right: 366, bottom: 900, width: 342, height: 180 }
    })
    await runFrame()

    const spotlight = document.querySelector('.onboarding-spotlight')
    expect(spotlight).to.equal(null)
    expect(document.querySelector('.step-progress').textContent).to.include('4')
    const card = dialogVisualRect()
    expect(card.left).to.be.at.least(12)
    expect(card.top).to.be.at.least(12)
    expect(card.right).to.be.at.most(378)
    expect(card.bottom).to.be.at.most(832)
    fixture.wrapper.unmount()
  })

  it('keeps an anchorless guide centered with navigation and no missing-target warning', async () => {
    const fixture = await mountFixture()
    fixture.target.remove()
    await runFrame()

    expect(document.querySelector('.onboarding-spotlight')).to.equal(null)
    expect(document.querySelector('.target-note')).to.equal(null)
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

    expect(document.querySelector('.eyebrow')?.textContent).to.include('厅中实景')
    expect(document.querySelector('.step-progress')?.textContent).to.include('第 1 步')
    expect(document.querySelector('#hall-onboarding-title')?.textContent).to.equal('回到办事工作台')
    fixture.wrapper.unmount()
  })

  it('does not focus map hotspots and keeps virtual-landscape guide text aligned with the rotated hall', async () => {
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

    expect(calls).to.deep.equal([])
    expect(document.querySelector('.onboarding-dialog').style.transform).to.include('rotate(90deg)')
    expect(document.querySelector('.onboarding-spotlight')).to.equal(null)
    const card = dialogVisualRect()
    expect(card.left).to.be.at.least(12)
    expect(card.top).to.be.at.least(12)
    expect(card.right).to.be.at.most(378)
    expect(card.bottom).to.be.at.most(832)
    fixture.wrapper.unmount()
  })
  for (const width of [320, 390, 760, 761, 1440]) {
    it(`keeps real Hall navigation visible and inert during guidance at ${width}px`, async () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      const host = mount(loadNavigationHost(), { attachTo: document.body, props: { onboardingVisible: false }, global: { stubs: { 'var-icon': { render: () => Vue.h('i') } } } })
      const page = host.element
      const dock = page.querySelector('.workbench-mobile-nav')
      const sidebar = page.querySelector('.hall-workbench-sidebar')
      const visibleNav = width <= 760 ? dock : sidebar
      // jsdom geometry is synthetic; visibility still follows real computed/v-show.
      for (const target of page.querySelectorAll('[data-workbench-tab], [data-tour]')) {
        target.getBoundingClientRect = () => ({ left: 24, top: 700, right: 90, bottom: 744, width: 66, height: 44 })
        target.getClientRects = () => target.hasAttribute('data-tour') || visibleNav.contains(target) && visibleNav.style.display !== 'none' ? [target.getBoundingClientRect()] : []
      }
      let guide
      try {
        expect(dock.style.display).not.to.equal('none')
        expect(dock.hasAttribute('inert')).to.equal(false)
        await host.setProps({ onboardingVisible: true })
        expect(dock.style.display).not.to.equal('none')
        expect(page.classList.contains('has-workbench-dock')).to.equal(true)
        expect(dock.hasAttribute('inert')).to.equal(true)
        expect(sidebar.hasAttribute('inert')).to.equal(true)
        for (const panel of ['', 'tasks', 'treasure', 'mine']) {
          host.vm.renderedPanel = panel
          host.vm.activePanel = panel
          await Vue.nextTick()
          expect(dock.style.display, panel || 'overview').not.to.equal('none')
        }
        host.vm.renderedPanel = ''
        host.vm.activePanel = ''
        await Vue.nextTick()
        guide = mount(loadOnboarding({}), { attachTo: document.body, props: { modelValue: true } })
        await Vue.nextTick()
        await Vue.nextTick()
        for (let step = 0; step < 4; step++) {
          await runFrame()
          expect(document.querySelector('.onboarding-spotlight'), `step ${step + 1}`).not.to.equal(null)
          expect(document.querySelector('.target-note')).to.equal(null)
          expect(page.closest('[inert]')).not.to.equal(null)
          if (step < 3) {
            document.querySelector('.next-button').click()
            await Vue.nextTick()
          }
        }
        expect(host.emitted('navigate')).to.equal(undefined)
        await guide.setProps({ modelValue: false })
        await host.setProps({ onboardingVisible: false })
        expect(page.hasAttribute('inert')).to.equal(false)
        expect(page.hasAttribute('aria-hidden')).to.equal(false)
        expect(dock.hasAttribute('inert')).to.equal(false)
        expect(sidebar.hasAttribute('inert')).to.equal(false)
        expect(dock.style.display).not.to.equal('none')
        await host.find('.workbench-mobile-nav [data-workbench-tab="tasks"]').trigger('click')
        expect(host.emitted('navigate')).to.deep.equal([['tasks']])
        await host.setProps({ onboardingVisible: true })
        host.vm.hallKeyboardActive = true
        await Vue.nextTick()
        expect(dock.style.display).to.equal('none')
        host.vm.hallKeyboardActive = false
        host.vm.renderedPanel = 'tasks'
        host.vm.activePanel = 'tasks'
        host.vm.bountyPanelRef = { canGoBack: true }
        await Vue.nextTick()
        expect(dock.style.display).to.equal('none')
        host.vm.bountyPanelRef = null
        host.vm.renderedPanel = 'messages'
        host.vm.activePanel = 'messages'
        await Vue.nextTick()
        expect(dock.style.display).to.equal('none')
      } finally {
        guide?.unmount()
        host.unmount()
      }
    })
  }

  for (const width of [320, 390, 760, 761, 1440]) {
    it(`uses the visible workbench navigation at ${width}px without dispatching business actions`, async () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      // Wide PC with a narrow visual viewport is still the CSS desktop layout.
      if (width === 1440) Object.defineProperty(window, 'visualViewport', { configurable: true, value: { width: 390, height: 844 } })
      const fixture = await mountFixture({ workbench: true, mode: 'landscape-map' })
      const mobile = width <= 760
      const hiddenNav = document.createElement('nav')
      hiddenNav.className = mobile ? 'hall-workbench-sidebar' : 'workbench-mobile-nav'
      const nav = document.createElement('nav')
      nav.className = mobile ? 'workbench-mobile-nav' : 'hall-workbench-sidebar'
      let writes = 0
      for (const panel of ['tasks', 'treasure', 'mine']) {
        for (const [container, visible] of [[hiddenNav, false], [nav, true]]) {
          const button = document.createElement('button')
          button.dataset.workbenchTab = panel
          button.getBoundingClientRect = () => ({ left: 24, top: 800, right: 100, bottom: 844, width: 76, height: 44 })
          button.getClientRects = () => visible ? [button.getBoundingClientRect()] : []
          button.addEventListener('click', () => { writes++ })
          container.append(button)
        }
      }
      fixture.page.append(hiddenNav, nav)
      await runFrame()
      expect(document.querySelector('.eyebrow').textContent).to.include(mobile ? '手机端' : 'PC端')
      expect(document.querySelector('.onboarding-spotlight')).not.to.equal(null)
      for (let i = 1; i < 4; i++) {
        document.querySelector('.next-button').click()
        await Vue.nextTick()
        await runFrame()
        expect(document.querySelector('.onboarding-spotlight')).not.to.equal(null)
        expect(document.querySelector('.target-note')).to.equal(null)
      }
      expect(document.querySelector('#hall-onboarding-description').textContent).to.include('使用帮助')
      document.querySelector('.previous-button').click()
      await Vue.nextTick()
      expect(document.querySelector('#hall-onboarding-title').textContent).to.include('资料')
      expect(writes).to.equal(0)
      fixture.wrapper.unmount()
    })
  }

  it('explains missing or hidden workbench targets and stays navigable', async () => {
    const fixture = await mountFixture({ workbench: true })
    fixture.target.getClientRects = () => []
    await runFrame()
    expect(document.querySelector('.onboarding-spotlight')).to.equal(null)
    expect(document.querySelector('.target-note').textContent).to.include('不会自动切页或提交需求')
    document.querySelector('.next-button').click()
    await Vue.nextTick()
    expect(document.querySelector('.step-progress').textContent).to.include('第 2 步')
    fixture.wrapper.unmount()
  })

  it('restarts at step one when crossing the actual workbench breakpoint', async () => {
    const fixture = await mountFixture({ workbench: true })
    document.querySelector('.next-button').click()
    await Vue.nextTick()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    window.dispatchEvent(new window.Event('resize'))
    await runFrame()
    expect(document.querySelector('.eyebrow').textContent).to.include('PC端')
    expect(document.querySelector('.step-progress').textContent).to.include('第 1 步')
    fixture.wrapper.unmount()
  })

})
