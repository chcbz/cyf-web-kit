import * as ordinaryCancellation from '../src/composables/juyiting/useHallOrdinaryCancellation.js'
/* global before */
import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
let Vue
let mount
let Panel
const stub = { template: '<span />' }
const compile = async () => {
  const filename = new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const silver = await import('../src/utils/silverAmount.js')
  const code = compileScript(descriptor, { id: 'controlled-image-checkbox', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, names, path) => `const { ${names.split(',').map(x => x.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_m, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', code)({ vue: Vue, '../../composables/juyiting/useHallOrdinaryCancellation.js': ordinaryCancellation, './BountyActionIcon.vue': stub, './WorkItemPlanPanel.vue': stub,
    './TeamRecommendationPanel.vue': stub, './HallDraftEditor.vue': stub, './HallMaterialPicker.vue': stub,
    '@/components/personal-workspace/TaskMaterialLinks.vue': stub, '@/utils/silverAmount': silver })
}
const task = (id, taskVersion = '6', requirementRevision = '3') => ({ id, title: id, description: '', status: 'open', taskVersion, requirementRevision })
const props = () => ({ embeddedHall: true, tasks: [], selectedTask: task('task-a'), selectedAgent: { agentId: 'agent-a' },
  operableAgents: [{ agentId: 'agent-a', name: '吴用', canOperate: true, status: 'online' }], recommendedAgents: [],
  taskAbilityOptions: [], taskStatusFilters: [], abilityText: () => '', canAssign: () => true,
  formatTime: () => '', portraitName: () => '', portraitStyle: () => ({}), taskAgentMatchScore: () => 0,
  taskStateClass: () => '', taskStatusCount: () => 0, taskStatusText: () => '' })
describe('unified generic point detail replaces drawing-specific confirmation', () => {
  before(async () => { Vue = await import('vue'); ({ mount } = await import('@vue/test-utils')); Panel = await compile() })
  it('ordinary detail offers explicit point, not a provider/image checkbox or predicted PDF', async () => {
    const wrapper = mount(Panel, { props: props() })
    try {
      wrapper.vm.openTask(task('task-a')); await Vue.nextTick()
      expect(wrapper.find('.controlled-image-consent').exists()).to.equal(false)
      expect(wrapper.find('input[type="checkbox"]').exists()).to.equal(false)
      expect(wrapper.text()).not.to.include('受控图像外部账户确认')
      expect(wrapper.text()).to.include('文本、图片、音频或文件')
      const button = wrapper.findAll('button').find(item => item.text() === '交给吴用')
      expect(Boolean(button)).to.equal(true); await button.trigger('click')
      expect(wrapper.emitted('assign-task')[0][1].agentId).to.equal('agent-a')
      expect(wrapper.emitted('confirm-controlled-image-consent')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })
  it('generic receipt displays all mixed materials neutrally without purpose or operation selector', async () => {
    const state = { status: 'PREPARING', intent: { schemaVersion: 2, taskId: 'task-a',
      body: { targetAgentId: 'agent-a', expectedTaskVersion: '6', requirementRevision: '3' } },
    projection: { inputs: ['image', 'document', 'audio', 'text'].map(fileId => ({ fileId, version: 2, purpose: 'INPUT' })) } }
    const wrapper = mount(Panel, { props: { ...props(), pointAndStartState: state } })
    try {
      wrapper.vm.openTask(task('task-a')); await Vue.nextTick()
      const text = wrapper.find('.point-and-start-recovery').text()
      for (const file of ['image', 'document', 'audio', 'text']) expect(text).to.include(`${file} v2`)
      expect(text).to.include('agent-a'); expect(text).not.to.include('INPUT'); expect(text).not.to.include('GENERATE_IMAGE')
      await wrapper.find('.point-and-start-recovery button').trigger('click')
      expect(wrapper.emitted('check-point-and-start')[0][0].id).to.equal('task-a')
    } finally { wrapper.unmount() }
  })
})
