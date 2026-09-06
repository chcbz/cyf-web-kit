import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'

const vueImportToVar = (_line, imports) => `var { ${imports.split(',').map(part => { const [name, alias] = part.trim().split(/\s+as\s+/); return alias ? `${name}: ${alias}` : name }).join(', ')} } = Vue`
const loadStage = game => {
  const url = new URL('../src/components/juyiting/HallStage.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(url, 'utf8'), { filename: url.pathname })
  const body = compileScript(descriptor, { id: 'live-preview-stage-harness', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, vueImportToVar)
    .replace(/^import\s+\{\s*juyitingGame\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var juyitingGame = game')
    .replace(/^import\s+\{\s*classifyViewportResize\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, "var classifyViewportResize = () => 'layout'")
    .replace('export default', 'return')
  return new Function('Vue', 'game', body)(Vue, game)
}
const flush = async () => { for (let i = 0; i < 4; i++) { await Promise.resolve(); await Vue.nextTick() } }
const props = { agentBubbles: {}, agentKey: () => '', agentStyle: () => ({}), portraitName: () => '', portraitShortName: () => '', portraitStyle: () => ({}), roleClass: () => '', statusClass: () => '', statusText: () => '', readOnlyPreview: true, previewVisible: true }
const fixture = () => {
  const calls = { destroy: 0, draw: [], locks: [], phases: [], ready: 0, reset: 0, targets: 0 }
  let handlers
  const game = {
    beginMapGeneration: () => 1, getSceneBounds: () => ({ x: 0, y: 0, width: 1664, height: 928 }),
    mount: async (_container, next) => { handlers = next }, start: () => {}, destroy: () => { calls.destroy++ },
    setInteractionLocked: (...args) => calls.locks.push(args), applyPreviewContain: () => ({}), clearPreviewContain: () => ({}),
    setPreviewDrawPolicy: value => calls.draw.push(value), clearPreviewDrawPolicy: () => calls.draw.push('clear'),
    getMovementRuntime: () => ({}), enqueueMovementCommands: () => [], cancelMovement: () => {},
    commitViewport: async () => ({}), resizeViewport: () => ({}), syncAgents: () => {}, syncHotspots: () => {}, setSelectedAgent: () => {},
    getCameraSnapshot: () => null, setVirtualViewport: () => {}, getMapGeneration: () => 1, captureResumeSnapshot: () => null,
    setInteractionLocked: (...args) => calls.locks.push(args), focusAgent: () => { calls.targets++; return true }, focusHotspot: () => false
  }
  return { calls, game, get handlers () { return handlers } }
}
describe('live map preview Stage adapter lifecycle', () => {
  it('mounts cold preview without business admission, then admits once and keeps the instance through returns', async () => {
    const f = fixture(); const Stage = loadStage(f.game)
    const globalRaf = Object.getOwnPropertyDescriptor(global, 'requestAnimationFrame')
    const windowRaf = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame')
    const globalCancel = Object.getOwnPropertyDescriptor(global, 'cancelAnimationFrame')
    const windowCancel = Object.getOwnPropertyDescriptor(window, 'cancelAnimationFrame')
    const frames = new Map(); let nextFrame = 1
    const requestFrame = callback => { const id = nextFrame++; frames.set(id, callback); return id }
    const cancelFrame = id => frames.delete(id)
    const pump = async (limit = 12) => { for (let i = 0; i < limit && frames.size; i++) { const queued = [...frames.entries()]; frames.clear(); queued.forEach(([, callback]) => callback(i * 16)); await flush() } }
    Object.defineProperty(global, 'requestAnimationFrame', { configurable: true, value: requestFrame })
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: requestFrame })
    Object.defineProperty(global, 'cancelAnimationFrame', { configurable: true, value: cancelFrame })
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: cancelFrame })
    let wrapper
    try {
      wrapper = mount(Stage, { attachTo: document.body, props, global: { stubs: { 'var-icon': true } } })
      const container = wrapper.get('.melon-layer').element
      container.getBoundingClientRect = () => ({ width: 390, height: 720, top: 0, left: 0, right: 390, bottom: 720 })
      await flush(); f.handlers.onReady(); await pump()
    expect(wrapper.emitted('simulation-ready')).to.equal(undefined)
    f.handlers.onSimulationPhaseEvents([{ id: 'cold-terminal' }]); await pump()
    expect(wrapper.emitted('simulation-phase-events')).to.equal(undefined)
    expect(f.calls.destroy).to.equal(0)
    expect(f.calls.locks.some(([, reason]) => reason === 'preview')).to.equal(true)
    await wrapper.setProps({ readOnlyPreview: false }); await flush()
    expect(wrapper.emitted('simulation-ready')).to.have.length(1)
    await wrapper.setProps({ readOnlyPreview: true }); f.handlers.onSimulationPhaseEvents([{ id: 'terminal' }]); await pump()
    await wrapper.setProps({ readOnlyPreview: true }); await wrapper.setProps({ readOnlyPreview: false }); await wrapper.setProps({ readOnlyPreview: true }); await flush()
    expect(wrapper.emitted('simulation-ready')).to.have.length(1)
    expect(wrapper.emitted('simulation-phase-events')).to.have.length(1)
    expect(f.calls.destroy).to.equal(0)
    wrapper.unmount(); expect(f.calls.destroy).to.equal(1)
    } finally { wrapper?.unmount(); Object.defineProperty(global, 'requestAnimationFrame', globalRaf); Object.defineProperty(window, 'requestAnimationFrame', windowRaf); Object.defineProperty(global, 'cancelAnimationFrame', globalCancel); Object.defineProperty(window, 'cancelAnimationFrame', windowCancel) }
  })
})
