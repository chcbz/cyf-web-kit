import test from 'node:test'
import assert from 'node:assert/strict'
import { appendHallPreview, appendHallEventMessage, stopHallPreviews } from '../src/composables/juyiting/hallConversationMessages.js'
const state = () => ({ conversationId: '42', messages: [], turnStates: new Map(), isAwaitingReply: true })
const preview = (seq, patch = {}) => ({ conversationId: '42', turnId: 't1', requestId: 'r1', agentId: 'a1',
  streamId: 's1', deltaSeq: String(seq), content: 'word ', streamOutcomeKind: 'ANSWER', occurredAt: 1000, ...patch })
const final = { type: 'agent_message', conversationId: '42', turnId: 't1', requestId: 'r1',
  messageId: '99', senderType: 'agent', agentId: 'a1', content: 'complete reply', timestamp: 2000 }
test('1000 preview frames change only display state; final replaces rather than appends', () => {
  const s = state()
  for (let i = 1; i <= 1000; i++) assert.equal(appendHallPreview(s, preview(i)).type, 'preview')
  assert.equal(s.messages.length, 1)
  assert.equal(s.messages[0].content, 'word '.repeat(1000))
  assert.equal(s.turnStates.get('t1').lastDeltaSeq, '0')
  assert.equal(s.turnStates.get('t1').stateVersion, undefined)
  appendHallEventMessage(s, final, 'owner')
  assert.equal(s.messages.length, 1)
  assert.equal(s.messages[0].content, final.content)
  assert.equal(s.messages[0].streaming, false)
  assert.equal(appendHallPreview(s, preview(1001)).type, 'ignored')
})
test('duplicate, foreign stream and foreign conversation do not change displayed text', () => {
  const s = state(); appendHallPreview(s, preview(1))
  for (const e of [preview(1), preview(2, { streamId: 'old' }), preview(2, { conversationId: '43' })]) {
    assert.equal(appendHallPreview(s, e).type, 'ignored')
  }
  assert.equal(s.messages[0].content, 'word ')
  assert.equal(appendHallPreview(s, preview(2)).type, 'preview')
})
test('gap or late subscription drops preview only, then final still renders', () => {
  for (const start of [false, true]) {
    const s = state(); if (start) appendHallPreview(s, preview(1))
    assert.equal(appendHallPreview(s, preview(3)).type, 'preview_dropped')
    assert.equal(s.messages.length, 0)
    assert.equal(appendHallPreview(s, preview(4)).type, 'ignored')
    assert.equal(s.turnStates.get('t1').waitingFinal, false)
    appendHallEventMessage(s, final, 'owner')
    assert.equal(s.messages[0].content, final.content)
  }
})
test('transport replacement stops partial preview without reviving it or discarding finals', () => {
  const s = state(); appendHallPreview(s, preview(1)); stopHallPreviews(s)
  assert.equal(s.messages.length, 0)
  assert.equal(appendHallPreview(s, preview(1, { streamId: 'replacement' })).type, 'ignored')
  appendHallEventMessage(s, final, 'owner'); stopHallPreviews(s)
  assert.equal(s.messages[0].content, final.content)
})
test('cancelled turns and internal action prose never enter preview', () => {
  const s = state()
  for (const streamOutcomeKind of [undefined, 'ACTION_REQUEST', 'REVISION_REQUEST']) {
    assert.equal(appendHallPreview(s, preview(1, { streamOutcomeKind })).type, 'ignored')
  }
  s.turnStates.set('t1', { terminal: true })
  assert.equal(appendHallPreview(s, preview(1)).type, 'ignored')
  assert.equal(s.messages.length, 0)
})
