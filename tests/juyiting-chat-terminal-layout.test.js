import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
import * as Vue from 'vue'

const source = readFileSync(new URL('../src/components/juyiting/ChatPanel.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'terminal-chat', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, names) => `var { ${names} } = deps`)
  .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, name) => `var ${name} = deps.${name}`)
  .replace('export default', 'return')
const directory = () => ({
  items: Vue.ref([]), links: Vue.ref([]), pendingWrites: Vue.ref([]), loading: Vue.ref(false), error: Vue.ref(''),
  actionState: Vue.ref('idle'), writeNotice: Vue.ref(''), refresh: async () => true, load: async () => true,
  dispose: () => {}, retryWrite: () => {}
})
const Composer = Vue.defineComponent({
  name: 'ComposerProbe', props: ['draft', 'compact'], emits: ['open-materials'],
  setup: (_props, { slots, emit }) => () => Vue.h('section', { class: 'composer-probe' }, [
    Vue.h('button', { onClick: () => emit('open-materials') }, '资料'), slots.materials?.()
  ])
})
const Panel = new Function('Vue', 'deps', script)(Vue, {
  usePersonalWorkspace: directory, usePersonalWorkspaceTaskLinks: directory, usePersonalWorkspaceConversationLinks: directory,
  marked: Object.assign(value => value, { setOptions: () => {} }), DOMPurify: { sanitize: value => value }, HallChatComposer: Composer,
  HallMessageParts: { render: () => null }, BountyTextSelectionArchive: { render: () => null },
  HallConversationHistory: { render: () => null }, BountyTypedOutcomeCard: { render: () => null }, WorkspaceWriteRecovery: { render: () => null }
})

describe('formal discussion terminal resource and toolbar layout', () => {
  it('closes materials and cancels voice on completed/cancelled/archived without erasing the parent draft', async () => {
    for (const status of ['completed', 'cancelled', 'archived']) {
      let cancellations = 0
      const wrapper = mount(Panel, { props: {
        discussionVariant: 'bounty', selectedTask: { id: 'task-a', status: 'running' }, draft: '尚未发送的草稿',
        mentionLabel: () => '吴用', senderText: () => '我', voice: { cancel: () => cancellations++ }
      } })
      try {
        expect(wrapper.findComponent(Composer).props('compact')).to.equal(true)
        await wrapper.get('.composer-probe button').trigger('click')
        expect(wrapper.find('.material-reference-picker').exists()).to.equal(true)
        await wrapper.setProps({ selectedTask: { id: 'task-a', status } })
        expect(wrapper.findComponent(Composer).exists()).to.equal(false)
        expect(wrapper.find('.material-reference-picker').exists()).to.equal(false)
        expect(cancellations).to.equal(1)
        expect(wrapper.props('draft')).to.equal('尚未发送的草稿')
        expect(wrapper.emitted('update:draft')).to.equal(undefined)
        await wrapper.setProps({ selectedTask: { id: 'task-b', status: 'running' } })
        expect(wrapper.findComponent(Composer).exists()).to.equal(true)
        expect(wrapper.find('.material-reference-picker').exists()).to.equal(false)
        expect(cancellations).to.equal(1)
      } finally { wrapper.unmount() }
    }
  })
  it('does not treat unknown/pending or a private discussion as a formal terminal state', async () => {
    const wrapper = mount(Panel, { props: { mentionLabel: () => '', senderText: () => '', discussionVariant: 'bounty' } })
    try {
      for (const status of ['open', 'reviewing', 'blocked', 'unknown']) {
        await wrapper.setProps({ selectedTask: { id: 'task', status } })
        expect(wrapper.findComponent(Composer).exists()).to.equal(true)
      }
      await wrapper.setProps({ matterReadOnly: true })
      expect(wrapper.findComponent(Composer).exists()).to.equal(false)
      await wrapper.setProps({ discussionVariant: 'private', selectedTask: { id: 'task', status: 'completed' } })
      expect(wrapper.findComponent(Composer).exists()).to.equal(true)
      expect(wrapper.findComponent(Composer).props('compact')).to.equal(false)
    } finally { wrapper.unmount() }
  })
  it('provides an independent matter action slot outside the message/composer areas', () => {
    const wrapper = mount(Panel, { props: { mentionLabel: () => '', senderText: () => '' }, slots: {
      'matter-actions': '<button class="matter-action" aria-label="查看并验收"><svg width="20" height="20"><path d="M4 12l5 5L20 6" /></svg></button>'
    } })
    try {
      expect(wrapper.find('.toolbar-actions .matter-action').exists()).to.equal(true)
      expect(wrapper.find('.hall-messages .matter-action').exists()).to.equal(false)
      expect(wrapper.find('.composer-probe .matter-action').exists()).to.equal(false)
      expect(descriptor.styles[0].content).to.include('.toolbar-actions :deep(.matter-action)')
    } finally { wrapper.unmount() }
  })
})
