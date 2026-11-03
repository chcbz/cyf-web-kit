import { expect } from 'chai'
import { discussionTurns, discussionDeliveryText, discussionTurnStatus } from '../src/composables/juyiting/hallDiscussionTurns.js'
import { normalizeHallMessage, appendHallEventMessage, appendStreamPayload } from '../src/composables/juyiting/hallConversationMessages.js'

const part = (id = 'image-1') => ({ partId: id, revision: '1', kind: 'image', state: 'ready', assetId: `asset-${id}`, mime: 'image/png' })
const parent = () => ({ localId: 'reply-1', sender: 'AGENT', agentId: 'agent-1', content: '正在为你改图', parts: [] })
const delivery = () => ({ localId: 'delivery-1', requestId: 'child-1', sender: 'AGENT', agentId: 'agent-1', content: '已生成成果；可预览或下载。', parts: [part()] })
const projection = () => ({ key: 'outcome-1', conversationId: '42', state: 'COMPLETED', outcome: { outcomeId: 'outcome-1', taskId: 'task-1', kind: 'ACTION_REQUEST', assistantMessageId: 'reply-1' }, actionProgress: { childRequestId: 'child-1', state: 'RUNNING' } })
const project = (messages, projections = [projection()]) => discussionTurns({ messages, projections, conversationId: '42', taskId: 'task-1' })

describe('discussion turn display projection', () => {
  it('joins one execution delivery to its exact original reply without changing stored messages', () => {
    const messages = [parent(), delivery()]; const before = structuredClone(messages)
    const rows = project(messages)
    expect(rows).to.have.length(1)
    expect(rows[0].parts).to.have.length(1)
    expect(rows[0].turnOriginal).to.equal(messages[0])
    expect(rows[0].turnDeliveries[0]).to.equal(messages[1])
    expect(rows[0].turnRequestIds).to.deep.equal(['child-1'])
    expect(messages).to.deep.equal(before)
    expect(discussionDeliveryText(rows[0].turnDeliveries[0])).to.equal('')
  })
  it('does not treat completed parent CHAT as completed execution', () => {
    expect(discussionTurnStatus(projection())).to.equal('正在处理')
    for (const [state, label] of Object.entries({ QUEUED: '等待处理', ARCHIVING: '已生成，登记中', RESULT_UNKNOWN: '结果待核实', FAILED: '本轮未完成', CANCELLED: '本轮已取消', COMPLETED: '本轮完成' })) {
      expect(discussionTurnStatus({ actionProgress: { state } })).to.equal(label)
    }
    expect(discussionTurnStatus({ state: 'COMPLETED' })).to.equal('正在核对处理状态')
  })
  it('retains missing, foreign and ambiguous links without text/time heuristics', () => {
    for (const override of [{ requestId: '' }, { requestId: 'other' }, { sender: 'USER' }, { agentId: 'agent-2' }, { parts: [] }, { streaming: true }]) {
      expect(project([parent(), { ...delivery(), ...override }])).to.have.length(2)
    }
    for (const override of [{ conversationId: '43' }, { outcome: { ...projection().outcome, taskId: 'task-2' } }]) {
      expect(project([parent(), delivery()], [{ ...projection(), ...override }])).to.have.length(2)
    }
    const second = { ...parent(), localId: 'reply-2' }
    const conflicting = { ...projection(), outcome: { ...projection().outcome, assistantMessageId: 'reply-2' } }
    expect(project([parent(), second, delivery()], [projection(), conflicting])).to.have.length(3)
    expect(project([delivery()])).to.have.length(1)
  })
  it('keeps concurrent turns and multiple artifacts in their own replies regardless of delivery order', () => {
    const p2 = { ...projection(), outcome: { ...projection().outcome, assistantMessageId: 'reply-2' }, actionProgress: { childRequestId: 'child-2', state: 'COMPLETED' } }
    const rows = project([delivery(), parent(), { ...parent(), localId: 'reply-2' },
      { ...delivery(), localId: 'delivery-2', requestId: 'child-2', parts: [part('image-2')] },
      { ...delivery(), localId: 'delivery-3', parts: [part('image-3')] }], [projection(), p2])
    expect(rows).to.have.length(2)
    expect(rows[0].parts.map(p => p.partId)).to.deep.equal(['image-1', 'image-3'])
    expect(rows[1].parts.map(p => p.partId)).to.deep.equal(['image-2'])
  })
  it('keeps custom delivery text and raw archive identities, including late assets after failure', () => {
    const custom = { ...delivery(), content: '请注意透明背景' }
    const p = projection(); p.actionProgress.state = 'FAILED'
    const row = project([parent(), custom], [p])[0]
    expect(discussionDeliveryText(row.turnDeliveries[0])).to.equal(custom.content)
    expect(row.turnOriginal.localId).to.equal('reply-1')
    expect(row.parts).to.have.length(1)
    expect(discussionTurnStatus(row.turnProjections[0])).to.equal('本轮未完成')
  })
  it('retains live and request-stream linkage, including replayed finals', () => {
    const event = { type: 'agent_message', senderType: 'agent', conversationId: '42', messageId: '101', requestId: 'child-1', agentId: 'agent-1', content: '交付', parts: [part()] }
    const live = { messages: [], conversationId: '42' }
    appendHallEventMessage(live, event)
    expect(live.messages[0].requestId).to.equal('child-1')
    appendHallEventMessage(live, event)
    expect(live.messages).to.have.length(1)
    const stream = { messages: [], conversationId: '42' }
    appendStreamPayload(stream, JSON.stringify(event))
    expect(stream.messages[0].requestId).to.equal('child-1')
  })
  it('preserves backend request metadata during history normalization', () => {
    expect(normalizeHallMessage({ id: '1', senderType: 'agent', metadata: JSON.stringify({ requestId: 'child-1', agentId: 'agent-1' }) }).requestId).to.equal('child-1')
    expect(normalizeHallMessage({ id: '2', senderType: 'agent' }).requestId).to.equal('')
  })
})

// User sees outcomes, not instructions to another agent or CHAT transport completion.
describe('discussion user-facing content', () => {
  it('hides only exactly linked action prose, preserving originals and real user/answer text', async () => {
    const { discussionMessageText } = await import('../src/composables/juyiting/hallDiscussionTurns.js')
    const original = { ...parent(), content: '请生成一张鸟的图片。' }
    expect(discussionMessageText(project([original])[0])).to.equal('')
    expect(original.content).to.equal('请生成一张鸟的图片。')
    expect(discussionMessageText(project([original], [ { ...projection(), conversationId: 'other' } ])[0])).to.equal(original.content)
    expect(discussionMessageText({ sender: 'USER', content: original.content })).to.equal(original.content)
    expect(discussionMessageText({ sender: 'AGENT', content: '这里是给你的建议。' })).to.equal('这里是给你的建议。')
  })
  it('does not present transport completion as task completion, retaining all non-success feedback', async () => {
    const { discussionFooterStatus } = await import('../src/composables/juyiting/hallDiscussionTurns.js')
    for (const label of ['本轮回话已结束', '本轮结果已登记', '本轮成果已就绪']) {
      expect(discussionFooterStatus(label, true)).to.equal('')
      expect(discussionFooterStatus(label, false)).to.equal(label)
    }
    for (const label of ['回话失败', '结果待核实', '正在读取', '本轮回复已停止']) expect(discussionFooterStatus(label, true)).to.equal(label)
    expect(discussionTurnStatus(projection())).to.equal('正在处理')
  })
  it('deduplicates only normal linked progress, retaining data, unlinked and unresolved results', async () => {
    const { inlineSkillResults, skillResultStatus } = await import('../src/composables/juyiting/hallSkillResults.js')
    const running = { executionId: 'e1', complete: false, phase: 'RUNNING', data: null }
    expect(inlineSkillResults([running], ['e1'])).to.deep.equal([])
    expect(inlineSkillResults([running], [])).to.deep.equal([running])
    for (const phase of ['RESULT_UNKNOWN', 'FAILED', 'ARCHIVING']) {
      const result = { ...running, phase }
      expect(inlineSkillResults([result], ['e1'])).to.deep.equal([result])
      expect(skillResultStatus(result)).not.to.equal(phase)
    }
    const result = { ...running, complete: true, data: '合计42' }
    expect(inlineSkillResults([result], ['e1'])).to.deep.equal([result])
  })
})
