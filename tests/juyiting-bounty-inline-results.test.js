import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'

const source = name => readFileSync(new URL(`../src/components/juyiting/${name}.vue`, import.meta.url), 'utf8')

// Bind the production predicate from its parsed script-setup AST, not a permissive
// receipt stub or a duplicated implementation. ChatPanel currently keeps it local.
const receiptPredicate = () => {
  const { descriptor, errors } = parse(source('ChatPanel'), { filename: 'ChatPanel.vue' })
  expect(errors).to.deep.equal([])
  const script = compileScript(descriptor, { id: 'inline-receipt-predicate' })
  const declaration = script.scriptSetupAst
    .filter(node => node.type === 'VariableDeclaration')
    .flatMap(node => node.declarations)
    .find(node => node.id.type === 'Identifier' && node.id.name === 'isArchiveMaintenanceReceipt')
  expect(declaration?.init?.type).to.equal('ArrowFunctionExpression')
  return new Function(`return (${descriptor.scriptSetup.content.slice(declaration.init.start, declaration.init.end)})`)()
}

describe('scoped bounty media belongs to the conversation transcript', () => {
  it('renders owner-scoped execution results inside the shared chat scroll region and not above the transcript', () => {
    const chat = source('ChatPanel')
    const bounty = source('BountyDiscussionPanel')
    const messages = chat.indexOf('<div ref="messageBoxRef" class="hall-messages">')
    const composer = chat.indexOf('<HallChatComposer', messages)
    const results = chat.search(/<slot\b[^>]*\bname="bounty-results"/)
    expect(messages).to.be.greaterThan(-1)
    expect(results).to.be.greaterThan(messages)
    expect(results).to.be.lessThan(composer)
    expect(bounty.indexOf('<BountyExecutionOutputs')).to.be.greaterThan(bounty.indexOf('<template #bounty-results>'))
    expect(bounty.indexOf('<template #bounty-results>')).to.be.greaterThan(bounty.indexOf('<ChatPanel'))
    expect(bounty.indexOf('<BountyExecutionOutputs')).to.be.lessThan(bounty.indexOf('</ChatPanel>'))
    for (const contract of [':enabled="deliberationV2Enabled"', ':request="activeRequest"',
      ':conversation-id="conversationId"', ':identity-key="`${identityEpoch}\\u0000${identityScope}`"']) {
      expect(bounty).to.include(contract)
    }
  })
  for (const withReceipt of [false, true]) {
    it(withReceipt ? 'keeps inline results after the last message including a real archive receipt'
      : 'mounts the real transcript section with inline results after the last message', () => {
      const chat = source('ChatPanel')
      const begin = chat.indexOf('<div ref="messageBoxRef" class="hall-messages">')
      const end = chat.indexOf('<HallChatComposer', begin)
      expect(begin).to.be.greaterThan(-1)
      expect(end).to.be.greaterThan(begin)
      const template = chat.slice(begin, end).trim()
      const isArchiveMaintenanceReceipt = receiptPredicate()
      const receipt = JSON.stringify({ type: 'archive_maintenance_receipt', archiveMaintenance: { jobId: 'job-1' } })
      expect(isArchiveMaintenanceReceipt(receipt, 'SYSTEM')).to.equal(true)
      expect(isArchiveMaintenanceReceipt(receipt, 'USER')).to.equal(false)
      expect(isArchiveMaintenanceReceipt('第一稿', 'AGENT')).to.equal(false)
      const messages = [{ localId: 'first', sender: 'AGENT', content: '第一稿', parts: [] }]
      if (withReceipt) messages.push({ localId: 'receipt', sender: 'SYSTEM', content: receipt, parts: [] })
      const transcript = { render: Vue.compile(template), setup: () => ({
        messages, isArchiveMaintenanceReceipt, archiveApi: null,
        senderText: () => 'Agent', renderMarkdown: text => text,
        deliberationStatus: '', isAwaitingReply: false, emptyText: '暂无',
        conversationId: 'conversation-1', materialIdentityKey: 'owner-a', identityScope: 'tenant\u0000client\u0000owner-a',
        isTaskDiscussion: true, taskId: 'task-1', materialName: () => '资料', typedForMessage: () => []
      }) }
      const globals = ['Element', 'HTMLElement', 'SVGElement', 'Node']
      const installed = globals.filter(name => !globalThis[name])
      for (const name of installed) globalThis[name] = window[name]
      let wrapper
      try {
        wrapper = mount(transcript, { slots: { 'bounty-results': '<section class="bounty-output-gallery">第二稿：图片</section>' },
          global: { stubs: { HallMessageParts: true, BountyTextSelectionArchive: true, BountyTypedOutcomeCard: true,
            ArchiveMaintenanceReceiptCard: { props: ['content', 'api'],
              template: '<section class="archive-receipt-stub">{{ content }}</section>' } } } })
        const scroll = wrapper.find('.hall-messages')
        expect(scroll.exists()).to.equal(true)
        expect(scroll.findAll('.hall-message')).to.have.length(withReceipt ? 2 : 1)
        expect(scroll.findAll('.archive-receipt-stub')).to.have.length(withReceipt ? 1 : 0)
        expect(scroll.find('.message-content').text()).to.equal('第一稿')
        expect(scroll.find('.bounty-output-gallery').text()).to.include('图片')
        expect(scroll.findAll('.hall-message').at(-1).element.compareDocumentPosition(scroll.find('.bounty-output-gallery').element)
          & Node.DOCUMENT_POSITION_FOLLOWING).to.be.greaterThan(0)
      } finally {
        wrapper?.unmount()
        for (const name of installed) delete globalThis[name]
      }
    })
  }
  it('compiles both Vue templates and scripts with the optional slot', () => {
    for (const name of ['ChatPanel', 'BountyDiscussionPanel']) {
      const filename = `src/components/juyiting/${name}.vue`
      const { descriptor, errors } = parse(source(name), { filename })
      expect(errors, filename).to.deep.equal([])
      compileScript(descriptor, { id: name })
      expect(compileTemplate({ source: descriptor.template.content, filename, id: name }).errors, filename).to.deep.equal([])
    }
  })
})
