import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'

const source = name => readFileSync(new URL(`../src/components/juyiting/${name}.vue`, import.meta.url), 'utf8')

describe('scoped bounty media belongs to the conversation transcript', () => {
  it('renders owner-scoped execution results inside the shared chat scroll region and not above the transcript', () => {
    const chat = source('ChatPanel')
    const bounty = source('BountyDiscussionPanel')
    const messages = chat.indexOf('<div ref="messageBoxRef" class="hall-messages">')
    const composer = chat.indexOf('<HallChatComposer', messages)
    const results = chat.indexOf('<slot name="bounty-results" />')
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
  it('mounts the real transcript section with inline results after the last message', () => {
    const chat = source('ChatPanel')
    const begin = chat.indexOf('<div ref="messageBoxRef" class="hall-messages">')
    const end = chat.indexOf('\n\n    <HallChatComposer', begin)
    expect(begin).to.be.greaterThan(-1)
    expect(end).to.be.greaterThan(begin)
    const template = chat.slice(begin, end).trim()
    const transcript = { render: Vue.compile(template), setup: () => ({
      messages: [{ localId: 'first', sender: 'AGENT', content: '第一稿', parts: [] }],
      senderText: () => 'Agent', renderMarkdown: text => text,
      deliberationStatus: '', isAwaitingReply: false, emptyText: '暂无',
      conversationId: 'conversation-1', materialIdentityKey: 'owner-a', identityScope: 'tenant\u0000client\u0000owner-a'
    }) }
    const globals = ['Element', 'HTMLElement', 'SVGElement', 'Node']
    const installed = globals.filter(name => !globalThis[name])
    for (const name of installed) globalThis[name] = window[name]
    let wrapper
    try {
      wrapper = mount(transcript, { slots: { 'bounty-results': '<section class="bounty-output-gallery">第二稿：图片</section>' },
        global: { stubs: { HallMessageParts: true } } })
      const scroll = wrapper.find('.hall-messages')
      expect(scroll.exists()).to.equal(true)
      expect(scroll.findAll('.hall-message')).to.have.length(1)
      expect(scroll.find('.bounty-output-gallery').text()).to.include('图片')
      expect(scroll.find('.hall-message').element.compareDocumentPosition(scroll.find('.bounty-output-gallery').element)
        & Node.DOCUMENT_POSITION_FOLLOWING).to.be.greaterThan(0)
    } finally {
      wrapper?.unmount()
      for (const name of installed) delete globalThis[name]
    }
  })
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
