import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, compileStyle, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'

import { cleanup } from '../../setup.js'

global.Element = global.window?.Element
global.SVGElement = global.window?.SVGElement
global.Node = global.window?.Node

const vueImportToVar = (_line, imports) => {
  const bindings = imports.split(',').map(part => {
    const [name, alias] = part.trim().split(/\s+as\s+/)
    return alias ? `${name}: ${alias}` : name
  }).join(', ')
  return `var { ${bindings} } = Vue`
}

const loadPreview = () => {
  const relativePath = '../../../src/components/juyiting/HallLiveMapPreview.vue'
  const filename = new URL(relativePath, import.meta.url).pathname
  const { descriptor } = parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'), { filename })
  const body = compileScript(descriptor, { id: 'hall-live-map-preview-test', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace('export default', 'return')
  return new Function('Vue', body)(Vue)
}

const settle = async () => {
  await Promise.resolve()
  await Vue.nextTick()
}

describe('HallLiveMapPreview', () => {
  let originalIntersectionObserver

  beforeEach(() => {
    originalIntersectionObserver = global.IntersectionObserver
  })

  afterEach(() => {
    global.IntersectionObserver = originalIntersectionObserver
    cleanup()
  })

  it('keeps its slot mounted beneath loading and error state overlays', async () => {
    delete global.IntersectionObserver
    const Preview = loadPreview()
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: { state: 'loading' },
      slots: { default: '<canvas data-test="stable-map-slot"></canvas>' }
    })

    const stableSlot = wrapper.get('[data-test="stable-map-slot"]').element
    expect(wrapper.get('.preview-map-slot').attributes('inert')).to.equal('')
    expect(wrapper.text()).to.include('地图预览加载中')
    await wrapper.setProps({ errorMessage: '资源加载失败', state: 'error' })
    expect(wrapper.get('[data-test="stable-map-slot"]').element).to.equal(stableSlot)
    expect(wrapper.text()).to.include('资源加载失败')
    expect(wrapper.get('button').text()).to.equal('横屏看全景')
    wrapper.unmount()
  })

  it('emits only presentation events and disables the landscape request while pending', async () => {
    delete global.IntersectionObserver
    const Preview = loadPreview()
    const wrapper = mount(Preview, {
      props: { orientationHint: '请允许横屏', orientationRequestPending: true, state: 'ready' }
    })

    const buttons = wrapper.findAll('button')
    expect(buttons[0].attributes('disabled')).to.equal('')
    expect(buttons[0].text()).to.equal('正在请求横屏…')
    expect(wrapper.text()).to.include('请允许横屏')
    await buttons[0].trigger('click')
    expect(wrapper.emitted('request-landscape')).to.equal(undefined)

    await wrapper.setProps({ orientationRequestPending: false })
    await wrapper.findAll('button')[0].trigger('click')
    expect(wrapper.emitted('request-landscape')).to.have.length(1)
    expect(wrapper.emitted('select-agent')).to.equal(undefined)
    await wrapper.setProps({ errorMessage: '资源加载失败', state: 'error' })
    await wrapper.findAll('button')[1].trigger('click')
    expect(wrapper.emitted('retry')).to.have.length(1)
    wrapper.unmount()
  })

  it('emits de-duplicated visibility changes and disconnects its observer', () => {
    const instances = []
    global.IntersectionObserver = class {
      constructor (callback) { this.callback = callback; this.disconnectCalls = 0; instances.push(this) }
      observe (target) { this.target = target }
      disconnect () { this.disconnectCalls += 1 }
    }
    const Preview = loadPreview()
    const wrapper = mount(Preview, { props: { state: 'ready' } })
    const observer = instances[0]

    expect(wrapper.emitted('visibility-change')).to.deep.equal([[true]])
    observer.callback([{ isIntersecting: true, target: observer.target }])
    observer.callback([{ isIntersecting: false, target: observer.target }])
    observer.callback([{ isIntersecting: false, target: observer.target }])
    expect(wrapper.emitted('visibility-change')).to.deep.equal([[true], [false]])
    wrapper.unmount()
    expect(observer.disconnectCalls).to.equal(1)
  })

  it('uses valid and fallback aspect ratios, and degrades to visible without IntersectionObserver', async () => {
    delete global.IntersectionObserver
    const Preview = loadPreview()
    const wrapper = mount(Preview, { props: { mapHeight: 200, mapWidth: 400, state: 'ready' } })

    expect(wrapper.get('.preview-frame').attributes('style')).to.include('aspect-ratio: 2')
    expect(wrapper.emitted('visibility-change')).to.deep.equal([[true]])
    expect(wrapper.get('.preview-map-slot').attributes('inert')).to.equal('')
    const source = readFileSync(new URL('../../../src/components/juyiting/HallLiveMapPreview.vue', import.meta.url), 'utf8')
    const { descriptor } = parse(source, { filename: 'HallLiveMapPreview.vue' })
    const style = descriptor.styles[0]
    const compiledStyle = compileStyle({
      filename: 'HallLiveMapPreview.vue',
      id: 'data-v-live-map-preview-test',
      scoped: style.scoped,
      source: style.content
    })
    expect(compiledStyle.errors).to.deep.equal([])
    expect(compiledStyle.code).to.include('.preview-map-slot[data-v-live-map-preview-test]')
    const readonlyRules = compiledStyle.code.match(/\.preview-map-slot[^}]*\{[^}]*pointer-events:\s*none/g) || []
    expect(readonlyRules).to.have.length.at.least(2)
    await wrapper.setProps({ mapHeight: 0, mapWidth: NaN, state: 'paused' })
    expect(wrapper.get('.preview-frame').attributes('style')).to.include('aspect-ratio: 1.793103448275862')
    expect(wrapper.text()).to.include('预览已暂停')
    await settle()
    wrapper.unmount()
  })
})
