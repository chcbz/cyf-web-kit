/* global before, after */
import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'
let Vue
let mount
let Panel
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
const original = {}
const stub = { template: '<span />' }
const compile = async () => {
  const filename = new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const silver = await import('../src/utils/silverAmount.js')
  const code = compileScript(descriptor, { id: 'controlled-image-checkbox', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, names, path) => `const { ${names.split(',').map(x => x.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', code)({ vue: Vue, './BountyActionIcon.vue': stub, './WorkItemPlanPanel.vue': stub,
    './TeamRecommendationPanel.vue': stub, './HallDraftEditor.vue': stub, './HallReferenceImagePicker.vue': stub,
    '@/components/personal-workspace/TaskMaterialLinks.vue': stub, '@/utils/silverAmount': silver })
}
const task = (id, taskVersion = '6', requirementRevision = '3') => ({ id, title: id, description: '', status: 'open', taskVersion, requirementRevision })
const offer = (taskId = 'task-a', target = 'agent-a', revision = 'r1') => ({ taskId, targetAgentId: target, capability: { providerBinding: { bindingId: 'binding-a', bindingEpoch: '1', modelId: 'model-a' }, authorization: { state: 'CONSENT_REQUIRED' }, newStart: { blockingReasons: [revision] } } })
const props = value => ({ embeddedHall: true, tasks: [], selectedTask: task('task-a'), selectedAgent: null, operableAgents: [], recommendedAgents: [], taskAbilityOptions: [], taskStatusFilters: [], controlledConsentOffer: value, abilityText: () => '', canAssign: () => false, formatTime: () => '', portraitName: () => '', portraitStyle: () => ({}), taskAgentMatchScore: () => 0, taskStateClass: () => '', taskStatusCount: () => 0, taskStatusText: () => '' })
describe('controlled image consent checkbox component behavior', () => {
  before(async () => { for (const key of ['SVGElement', 'Element', 'Node']) { original[key] = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] }) }; globalThis.window = dom.window; globalThis.document = dom.window.document; Vue = await import('vue'); ({ mount } = await import('@vue/test-utils')); Panel = await compile() })
  after(() => { for (const [key, value] of Object.entries(original)) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] } })
  it('resets explicit acknowledgement for a new identical offer object, real task/requirement revisions, task target changes, modal close, and auth generation', async () => {
    const wrapper = mount(Panel, { props: props(offer()) }); const open = async (id = 'task-a') => { wrapper.vm.openTask(task(id)); await Vue.nextTick(); return wrapper.find('input[type="checkbox"]') }
    let checkbox = await open(); await checkbox.setValue(true); expect(checkbox.element.checked).to.equal(true)
    await wrapper.setProps({ controlledConsentOffer: offer() }); await Vue.nextTick(); checkbox = wrapper.find('input[type="checkbox"]'); expect(checkbox.element.checked).to.equal(false)
    await checkbox.setValue(true); await wrapper.setProps({ selectedTask: task('task-a', '7', '4') }); await Vue.nextTick(); checkbox = wrapper.find('input[type="checkbox"]'); expect(checkbox.element.checked).to.equal(false)
    await checkbox.setValue(true); await wrapper.setProps({ selectedTask: task('task-b', '1', '1'), controlledConsentOffer: offer('task-b', 'agent-b') }); await Vue.nextTick(); wrapper.vm.openTask(task('task-b', '1', '1')); await Vue.nextTick(); checkbox = wrapper.find('input[type="checkbox"]'); expect(checkbox.element.checked).to.equal(false)
    await checkbox.setValue(true); wrapper.vm.back(); await Vue.nextTick(); checkbox = await open('task-b'); expect(checkbox.element.checked).to.equal(false)
    await checkbox.setValue(true); await wrapper.setProps({ authorizationGeneration: 1 }); await Vue.nextTick(); checkbox = await open('task-b'); expect(checkbox.element.checked).to.equal(false); wrapper.unmount()
  })
})
