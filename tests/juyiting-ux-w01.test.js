import { expect } from 'chai'
import { before } from 'mocha'
import { readFileSync } from 'node:fs'

global.SVGElement = global.window?.SVGElement
global.Element = global.window?.Element
global.Node = global.window?.Node

let Vue
let mount

const flush = async () => {
  await Promise.resolve()
  await Vue.nextTick()
}

describe('JYT-UX-W01 unified Hall shell', () => {
  before(async () => {
    Vue = await import('vue')
    ;({ mount } = await import('@vue/test-utils'))
  })

  it('keeps home preference independent from orientation projection', async () => {
    const { useHallHomeMode } = await import('../src/composables/juyiting/useHallHomeMode.js')
    const { resolveHallExperienceMode } = await import('../src/composables/juyiting/useHallExperienceMode.js')
    let home
    const wrapper = mount({
      setup() {
        home = useHallHomeMode()
        return () => Vue.h('div', home.homeMode.value)
      }
    })
    try {
      expect(home.homeMode.value).to.equal('overview')
      expect(home.setHomeMode('map')).to.equal(true)
      expect(home.homeMode.value).to.equal('map')
      expect(resolveHallExperienceMode({ isMobileCoarse: true, isPhysicalLandscape: false })).to.equal('portrait-command')
      expect(home.setHomeMode('overview')).to.equal(true)
      await flush()
      expect(home.homeMode.value).to.equal('overview')
      expect(resolveHallExperienceMode({ isMobileCoarse: true, isPhysicalLandscape: true })).to.equal('landscape-map')
      expect(home.homeMode.value).to.equal('overview')
    } finally {
      wrapper.unmount()
    }
  })

  it('uses one near-full active work-window for both touch orientations', async () => {
    const { classifyPanelLayout } = await import('../src/composables/juyiting/useHallPanels.js')
    expect(classifyPanelLayout({ isMobileCoarse: false, experienceMode: 'landscape-map' })).to.equal('center-modal')
    expect(classifyPanelLayout({ isMobileCoarse: true, experienceMode: 'landscape-map' })).to.equal('full-window')
    expect(classifyPanelLayout({ isMobileCoarse: true, experienceMode: 'portrait-command' })).to.equal('full-window')
    expect(classifyPanelLayout({ isMobileCoarse: false, viewportHeight: 390 })).to.equal('full-window')
    expect(classifyPanelLayout({ isMobileCoarse: false, viewportHeight: 900 })).to.equal('center-modal')
  })

  it('keeps orientation requests event/owner settled, not timer-cancelled', () => {
    const source = readFileSync(new URL('../src/composables/juyiting/useHallExperienceMode.js', import.meta.url), 'utf8')
    expect(source).not.to.include('REQUEST_TIMEOUT_MS')
    expect(source).not.to.include('requestTimer')
    expect(source).to.include('await releaseRequestOwnership(token)')
    expect(source).to.include('handleFullscreenChange')
  })

  it('provides direction control and logical return in the single active window', () => {
    const source = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    expect(source).to.include('class="panel-orientation"')
    expect(source).to.include('const requestPanelOrientation = () =>')
    expect(source).to.include('const returnPanel = () =>')
    expect(source).to.include('layout-full-window')
  })

  it('fills the unified portrait body instead of leaving the old aspect-ratio thumbnail above a blank area', () => {
    const portrait = readFileSync(new URL('../src/components/juyiting/HallPortraitHome.vue', import.meta.url), 'utf8')
    expect(portrait).to.include('.is-unified-shell .portrait-scene :deep(.preview-frame) { height:100%; min-height:0; }')
  })

  it('keeps the Portrait Home flex layout and exposes a pending-request exit', () => {
    const portrait = readFileSync(new URL('../src/components/juyiting/HallPortraitHome.vue', import.meta.url), 'utf8')
    const stage = readFileSync(new URL('../src/components/juyiting/HallStage.vue', import.meta.url), 'utf8')
    const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    expect(portrait).to.include('.portrait-context-actions {\n  display: flex;\n  align-items: center;')
    expect(portrait).to.include('@cancel-orientation="emit(\'cancel-orientation\')"')
    expect(stage).to.include("if (props.orientationRequestPending) {\n    emit('request-portrait')")
    expect(hall).to.include('if (orientationRequestPending.value) return requestPortrait()')
  })
})

describe('A03 low-height work-window sizing contract (not browser geometry)', () => {
  it('has one outer gutter, fills the remaining height, and keeps only the workspace content scroller', () => {
    const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    const workspace = readFileSync(new URL('../src/components/workspace/PersonalWorkspace.vue', import.meta.url), 'utf8')
    const rule = hall.match(/\.panel-overlay\.is-full-window \.floating-panel\.layout-full-window \{([^}]+)\}/)[1]
    expect(rule).to.include('height: 100%;').and.include('max-height: 100%;').and.include('width: min(1180px, 100%);')
    expect(rule).not.to.include('calc(')
    expect(hall).to.include("'is-full-window': panelLayout === 'full-window'")
    expect(hall).to.include('viewportHeight: resolvedHallViewportHeight')
    expect(workspace).to.include('.personal-workspace.is-hall-treasure { min-height:0;')
    expect(workspace).to.include('.is-compact-hall .library-tools { margin-top:6px; padding-bottom:6px; }')
    expect(workspace).to.include('.is-hall-treasure .babao-modal {\n  position: static;\n  overflow: visible;')
  })
})
