import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as Vue from 'vue'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { compileScript } from '@vue/compiler-sfc'
const require = createRequire(import.meta.url)
const { parse } = require('@vue/compiler-sfc')
const babel = require('@babel/parser')
const source = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const script = parse(source, { filename: 'JuyiHall.vue' }).descriptor.scriptSetup.content
const program = babel.parse(script, { sourceType: 'module' }).program
const declarations = program.body.flatMap(node => node.declarations || [])
const handler = name => { const node = declarations.find(item => item.id?.name === name); if (!node) throw new Error(`missing ${name}`); return script.slice(node.init.start, node.init.end) }
const option = (callee, name) => {
  let call = declarations.find(item => item.init?.callee?.name === callee)?.init
  if (!call) call = program.body.find(node => node.type === 'ExpressionStatement' && node.expression?.type === 'AssignmentExpression' && node.expression.right?.callee?.name === callee)?.expression.right
  const property = call?.arguments?.[0]?.properties?.find(item => item.key?.name === name)
  if (!property) throw new Error(`missing ${callee}.${name}`)
  return script.slice(property.value.start, property.value.end)
}
describe('actual JuyiHall typed natural follow-up routing', () => {
  it('routes the one bounty composer through typed DISCUSSION only when the strict default-off flag is enabled', async () => {
    const enabled = ref(true); const draft = ref('画一只鸟'); const calls = []; const typed = { error: ref(''), submit: async body => { calls.push(['typed', body]); return true } }
    const send = async () => { calls.push(['legacy']); return true }
    const actual = new Function('voiceReplyCorrelation', 'hallVoice', 'playSend', 'typedDeliberationEnabled', 'typedDeliberation', 'draft', 'setDraft', 'showToast', 'sendHallMessage', `return (${handler('handleSendHallMessage')})`)({ close: () => {} }, { cancel: () => {} }, () => {}, enabled, typed, draft, value => calls.push(['draft', value]), () => {}, send)
    expect(await actual()).to.equal(true)
    expect(calls).to.deep.equal([['typed', { content: '画一只鸟', sourceSelectors: [] }], ['draft', '']])
    enabled.value = false
    expect(await actual()).to.equal(true)
    expect(calls.at(-1)).to.deep.equal(['legacy'])
    enabled.value = true
    await actual({ sourceSelectors: [{ kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: 'file-1', version: '7', purpose: 'REFERENCE', assetId: null, assetRevision: null }] })
    expect(calls.at(-2)).to.deep.equal(['typed', { content: '画一只鸟', sourceSelectors: [{ kind: 'TASK_LINKED_WORKSPACE_VERSION', fileId: 'file-1', version: '7', purpose: 'REFERENCE', assetId: null, assetRevision: null }] }])
  })
  it('uses actual page proposal callback to enter existing preview preparation, never issue/admit directly', async () => {
    const enabled = ref(true); const calls = []
    const onProposal = new Function('typedDeliberationEnabled', 'prepareFollowupGenerate', 'prepareFollowupEdit', `return (${option('useHallTypedDeliberation', 'onProposal')})`)(enabled,
      async payload => { calls.push(['generate', payload]); return true }, async payload => { calls.push(['edit', payload]); return true })
    expect(await onProposal({ kind: 'GENERATE_IMAGE', content: '画鸟', inputRefs: [], projection: {} })).to.equal(true)
    expect(await onProposal({ kind: 'EDIT_IMAGE', content: '改鸟', assetRef: { assetId: 'asset-1', revision: '1' }, continuationOf: { requestId: 'request-1', stepId: 'step-1' }, projection: {} })).to.equal(true)
    expect(calls).to.deep.equal([
      ['generate', { content: '画鸟', inputRefs: [] }],
      ['edit', { content: '改鸟', assetRef: { assetId: 'asset-1', revision: '1' }, continuationOf: { requestId: 'request-1', stepId: 'step-1' } }]
    ])
    enabled.value = false
    expect(await onProposal({ kind: 'GENERATE_IMAGE', content: '不应办理', inputRefs: [] })).to.equal(false)
    expect(calls).to.have.length(2)
  })

  it('evaluates the actual page template expressions to values and forwards selector payload through the mounted bounty panel', async () => {
    const tag = source.match(/<BountyDiscussionPanel\b[\s\S]*?>/)[0]
    const attrs = [...tag.matchAll(/:(typed-[a-z-]+)="([^"]+)"/g)].map(match => `:${match[1]}="${match[2]}"`).join(' ')
    const { compile } = require('@vue/compiler-dom')
    const render = new Function('Vue', compile(`<BountyDiscussionPanel ${attrs} />`, { mode: 'function' }).code)(Vue)
    const vnode = render(Vue.proxyRefs({ typedDeliberation: { cards: ref([{ requestId: 'request-1' }]), selectedPending: ref(null), recoveryAvailable: ref(true) }, typedDeliberationEnabled: ref(true) }), [])
    expect(vnode.props['typed-outcomes']).to.deep.equal([{ requestId: 'request-1' }]); expect(vnode.props['typed-pending-question']).to.equal(null); expect(vnode.props['typed-recovery-available']).to.equal(true)
    const panelFile = new URL('../src/components/juyiting/BountyDiscussionPanel.vue', import.meta.url).pathname
    const panelDescriptor = parse(readFileSync(panelFile, 'utf8'), { filename: panelFile }).descriptor
    const panelCode = compileScript(panelDescriptor, { id: 'typed-panel-forward', inlineTemplate: true }).content
      .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
      .replace(/^import\s+(\w+)\s+from\s+['"][^'"]+['"];?\s*$/gm, (_, name) => name === 'ChatPanel' ? 'var ChatPanel = deps.ChatPanel' : `var ${name} = { template: '<span />' }`)
      .replace(/^import\s+\{\s*bountyDeliberationPresentation\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, 'var { bountyDeliberationPresentation } = deps')
      .replace('export default', 'return')
    const ChatPanel = { emits: ['send-message'], render () { return Vue.h('button', { class: 'emit-send', onClick: () => this.$emit('send-message', { sourceSelectors: [{ kind: 'TASK_LINKED_WORKSPACE_VERSION' }] }) }) } }
    const Panel = new Function('Vue', 'deps', panelCode)(Vue, { ChatPanel, bountyDeliberationPresentation: () => ({}) })
    const previous = new Map()
    for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) { if (globalThis[name]) continue; previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true }) }
    const wrapper = mount(Panel, { props: { mentionLabel: () => '', senderText: () => '', typedEnabled: true } })
    try {
      await wrapper.find('.emit-send').trigger('click')
      expect(wrapper.emitted('send-message')).to.deep.equal([[{ sourceSelectors: [{ kind: 'TASK_LINKED_WORKSPACE_VERSION' }] }]])
    } finally {
      wrapper.unmount()
      for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] }
    }
  })
  it('binds a real durable final event only to authoritative typed GET readback', async () => {
    const calls = []
    const callback = new Function('typedDeliberation', `return (${option('useHallConversation', 'onTypedOutcome')})`)({ readOne: value => calls.push(value) })
    callback({ requestId: 'request-1' }); callback({})
    expect(calls).to.deep.equal(['request-1'])
  })
})
