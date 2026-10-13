import * as ordinaryCancellation from '../src/composables/juyiting/useHallOrdinaryCancellation.js'
import { readFileSync } from 'node:fs'
import { expect } from 'chai'
import { parse, compileScript } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'
import * as silver from '../src/utils/silverAmount.js'

const source = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const Empty = Vue.defineComponent({ render: () => Vue.h('span') })
const imports = new Proxy({ vue: Vue, '../../composables/juyiting/useHallOrdinaryCancellation.js': ordinaryCancellation, '@/utils/silverAmount': silver }, { get: (target, name) => target[name] || Empty })
const code = compileScript(descriptor, { id: 'bounty-toolbar-test', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, names, path) =>
    `const { ${names.replace(/\s+as\s+/g, ': ')} } = imports[${JSON.stringify(path)}]`)
  .replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
  .replace('export default', 'return')
const Panel = new Function('imports', code)(imports)
const props = {
  embeddedHall: true, taskAbilityOptions: ['绘画'],
  abilityText: () => '', canAssign: () => false, formatTime: () => '', portraitName: () => '', portraitStyle: () => ({}),
  taskAgentMatchScore: () => 0, taskStateClass: () => '', taskStatusCount: () => 0, taskStatusText: () => ''
}

describe('Bounty task toolbar', () => {
  it('shows only search, ability filter and accessible refresh in the embedded toolbar', async () => {
    const wrapper = mount(Panel, { props })
    try {
      const toolbar = wrapper.get('.panel-toolbar')
      expect(toolbar.findAll('button')).to.have.length(1)
      expect(toolbar.text()).not.to.include('提出需求')
      expect(toolbar.find('.task-draft-actions').exists()).to.equal(false)
      expect(wrapper.find('.task-create-form').exists()).to.equal(false)
      expect(toolbar.get('input').attributes('aria-label')).to.equal('查榜号')
      expect(toolbar.get('select').attributes('aria-label')).to.equal('筛选所需本领')
      await toolbar.get('input').setValue(' 434 ')
      expect(wrapper.emitted('update:taskKeyword').at(-1)).to.deep.equal(['434'])
      await toolbar.get('input').trigger('keyup.enter')
      await toolbar.get('select').setValue('绘画')
      expect(wrapper.emitted('update:taskAbilityFilter').at(-1)).to.deep.equal(['绘画'])
      await toolbar.get('[aria-label="刷新事项"]').trigger('click')
      expect(wrapper.emitted('load-tasks')).to.have.length(3)
      expect(wrapper.emitted('create-task')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })

  for (const embeddedHall of [true, false]) it(`has no creation form or exposed creation method (embedded=${embeddedHall})`, () => {
    const wrapper = mount(Panel, { props: { ...props, embeddedHall } })
    try {
      expect(wrapper.vm.openCreateRequirement).to.equal(undefined)
      expect(wrapper.find('form').exists()).to.equal(false)
      expect(wrapper.find('.task-draft-actions').exists()).to.equal(false)
      expect(wrapper.text()).not.to.include('提出需求')
      expect(wrapper.emitted('create-task')).to.equal(undefined)
      expect(source).not.to.include('submitCreateTask')
    } finally { wrapper.unmount() }
  })

  it('gives toolbar controls independent grid cells without obsolete creation styles', () => {
    const css = descriptor.styles[0].content
    expect(css).to.include('grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr) 44px')
    expect(css).to.include('.task-search { display: contents; }')
    expect(css).not.to.match(/\.task-search input,[^{}]*\.task-material-picker\s*\{/)
    expect(css).not.to.include('.task-create-form')
  })
})
