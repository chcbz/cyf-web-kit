import { expect } from 'chai'
import * as Vue from 'vue'
import { normalizeHallMessage, appendHallEventMessage } from '../src/composables/juyiting/hallConversationMessages.js'
import { applyMessagePartEvent, conversationAssetContentPath, mergeMessageParts, safeMediaKind } from '../src/composables/juyiting/hallMessageParts.js'
import { createHallSseParser } from '../src/composables/juyiting/hallConversationSse.js'
import { useHallConversation } from '../src/composables/juyiting/useHallConversation.js'

const image = (revision, changes = {}) => ({ partId: 'img-1', revision: String(revision), kind: 'image', state: 'ready', assetId: 'asset-1', mime: 'image/png', filename: 'bird.png', ...changes })
const state = () => ({ conversationId: '77', messages: [{ localId: '32', sender: 'AGENT', content: '鸟', parts: [], streaming: false }], isAwaitingReply: false, isStreaming: false, turnStates: new Map() })

describe('bounty conversation persisted media parts', () => {
  it('restores persisted content blocks only from the server message and not metadata URLs', () => {
    const message = normalizeHallMessage({ id: '32', senderType: 'agent', content: '鸟', metadata: { parts: [image(1)], mediaUrl: 'https://example.invalid/bird.png' }, parts: [image(2)] }, 'owner')
    expect(message.parts).to.deep.equal([image(2, { text: '', errorCode: '' })])
    expect(message.parts[0]).not.to.have.property('mediaUrl')
  })
  it('renders a media part arriving after the text final without ending or replacing it', () => {
    const current = state()
    const event = { type: 'part.ready', conversationId: '77', messageId: '32', part: image(1) }
    expect(appendHallEventMessage(current, event, 'owner').type).to.equal('part')
    expect(current.messages[0].content).to.equal('鸟')
    expect(current.messages[0].parts).to.have.length(1)
    expect(appendHallEventMessage(current, event, 'owner').type).to.equal('duplicate_part')
    expect(current.messages).to.have.length(1)
  })
  it('merges newer projected parts on a replayed final without replaying the text or final notification', () => {
    const current = state()
    const projected = part => ({
      type: 'agent_message', conversationId: '77', messageId: '32',
      senderType: 'agent', content: 'stale text', timestamp: 123,
      parts: [part]
    })
    const result = appendHallEventMessage(current, projected(image(2)), 'owner')
    expect(result.type).to.equal('part')
    expect(result).not.to.have.property('shouldStopPolling')
    expect(result).not.to.have.property('toastName')
    expect(current.messages).to.have.length(1)
    expect(current.messages[0].content).to.equal('鸟')
    expect(current.messages[0].parts[0].revision).to.equal('2')
    expect(appendHallEventMessage(current, projected(image(1, { state: 'failed' })), 'owner').type).to.equal('duplicate')
    expect(appendHallEventMessage(current, projected(image(3, { assetId: '', url: 'https://example.invalid/bird.png' })), 'owner').type).to.equal('duplicate')
    expect(appendHallEventMessage(current, projected(image(2)), 'owner').type).to.equal('duplicate')
    expect(current.messages[0].parts[0].state).to.equal('ready')
    expect(current.messages[0].parts[0].revision).to.equal('2')
  })
  it('prevents older processing/failed events and duplicate replay from rolling back a ready card', () => {
    const current = state()
    appendHallEventMessage(current, { type: 'part.ready', conversationId: '77', messageId: '32', part: image(4) }, 'owner')
    for (const type of ['part.processing', 'part.failed', 'part.ready']) {
      const result = appendHallEventMessage(current, { type, conversationId: '77', messageId: '32', part: image(3) }, 'owner')
      expect(result.type).to.equal('duplicate_part')
      expect(current.messages[0].parts[0].state).to.equal('ready')
    }
  })
  it('requires a scoped persisted asset ID before promoting ready media or consuming a cursor', () => {
    const current = state()
    expect(applyMessagePartEvent(current, { type: 'part.ready', conversationId: '77', messageId: '32', part: image(1, { assetId: '', url: '/local/file' }) }).type).to.equal('invalid_part')
    expect(applyMessagePartEvent(current, { type: 'part.ready', conversationId: '77', messageId: '99', part: image(1) }).type).to.equal('missing_message')
    expect(current.messages[0].parts).to.deep.equal([])
    expect(() => conversationAssetContentPath({ conversationId: '77', assetId: '../../other' })).to.throw()
    expect(conversationAssetContentPath({ conversationId: '77', assetId: 'asset-1' })).to.equal('/conversations/77/assets/asset-1/content')
  })
  it('uses a single durable SSE cursor, mixed audio/file, and safe MIME preview policy', () => {
    const current = state()
    const cursors = []
    const parser = createHallSseParser({ conversationId: '77', onEvent: event => appendHallEventMessage(current, event, 'owner').type === 'part', onCursor: value => cursors.push(value), onInvalid: reason => { throw new Error(reason) } })
    parser.push('id: 42\ndata: {"type":"part.ready","conversationId":"77","eventSequence":"42","messageId":"32","part":{"partId":"sound","revision":"1","kind":"audio","state":"ready","assetId":"audio-2","mime":"audio/mpeg"}}\n\n')
    expect(cursors).to.deep.equal(['42'])
    expect(safeMediaKind(current.messages[0].parts[0])).to.equal('audio')
    expect(safeMediaKind({ kind: 'image', mime: 'image/svg+xml' })).to.equal('file')
    expect(mergeMessageParts(current.messages[0].parts, [{ partId: 'file-2', revision: '2', kind: 'file', state: 'ready', assetId: 'asset-3', mime: 'application/pdf' }])).to.have.length(2)
  })
  it('applies owner-scoped media events from the reply stream instead of consuming them as status only', async () => {
    const events = [
      { type: 'part.ready', requestId: 'req-1', conversationId: '77', messageId: '32', part: image(1) },
      { type: 'part.failed', requestId: 'req-1', conversationId: '77', messageId: '32', part: image(0) },
      { type: 'part.ready', requestId: 'req-2', conversationId: 'other', messageId: '32', part: image(2) }
    ]
    const conversation = useHallConversation({
      apiStore: { token: async () => '' },
      chatApi: { create: async (_path, _body, options) => {
        for (const event of events) options.onStream(JSON.stringify(event))
        options.onStreamEnd()
      } },
      chatContext: Vue.ref({ conversationScopeType: 'bounty', conversationScopeKey: 'task:task-1',
        targetAgentIds: ['agent-1'], targetAgentId: 'agent-1', participantAgentIds: ['agent-1'],
        mentionAgentIds: [], taskId: 'task-1' }),
      chatMode: Vue.ref('bounty'), globalStore: { getJiacn: 'owner', user: { name: 'Tester' } },
      log: { warn: () => {}, error: () => {} }, openPanel: () => {},
      outgoingMetadata: Vue.ref({}), portraitShortName: () => '',
      selectedAgent: Vue.ref({ agentId: 'agent-1' }), selectedTask: Vue.ref({ id: 'task-1' }),
      showToast: () => {}
    })
    try {
      conversation.conversationId.value = '77'
      conversation.messages.value.push(state().messages[0])
      expect(await conversation.sendHallMessage({ content: '改成蓝色' })).to.equal(true)
      const persisted = conversation.messages.value.find(message => message.localId === '32')
      expect(persisted.parts).to.have.length(1)
      expect(persisted.parts[0]).to.include({ assetId: 'asset-1', state: 'ready', revision: '1' })
    } finally { conversation.disposeHallConversation() }
  })
  it('does not accept untrusted lower revision or a signed URL in place of private bytes', () => {
    const current = [image(3)]
    expect(mergeMessageParts(current, [image(2, { state: 'failed', url: 'https://example.invalid' })])[0].state).to.equal('ready')
    expect(mergeMessageParts([], [image(2, { assetId: '', url: 'https://example.invalid' })])).to.deep.equal([])
  })
})
