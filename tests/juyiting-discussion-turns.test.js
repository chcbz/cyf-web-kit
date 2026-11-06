import { expect } from 'chai'
import { discussionTurns, discussionDeliveryText, discussionTurnStatus, discussionMessageText } from '../src/composables/juyiting/hallDiscussionTurns.js'
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
    expect(rows[0].turnDeliveries[0].turnOriginal).to.equal(messages[1])
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

describe('typed discussion live and reload rendering', () => {
  it('does not expose unfinished stream text, but restores the final user answer', async () => {
    const { discussionMessageText } = await import('../src/composables/juyiting/hallDiscussionTurns.js')
    const streamed = { ...parent(), streaming: true, content: '请执行内部步骤' }
    expect(discussionMessageText(project([streamed], [])[0])).to.equal('')
    const answer = { ...streamed, streaming: false, typedOutcomeId: 'answer-1', typedOutcomeKind: 'ANSWER', typedOutcomeTaskId: 'task-1', content: '已为你调整时间。' }
    expect(discussionMessageText(project([answer], [])[0])).to.equal(answer.content)
    expect(discussionMessageText(streamed)).to.equal(streamed.content) // non-bounty/private retains streaming
  })
  it('keeps the original text readable when only its structured history is unavailable', async () => {
    const { discussionMessageText } = await import('../src/composables/juyiting/hallDiscussionTurns.js')
    const message = { ...normalizeHallMessage({ id: 'reply-1', messageType: 'ASSISTANT', content: '历史原文', metadata: { outcomeId: 'outcome-1', turnId: 'turn-1' } }, ''), typedDisplayUnavailable: true }
    const displayed = project([message], [])[0]
    expect(displayed.turnAwaitingType).to.equal(false)
    expect(discussionMessageText(displayed)).to.equal('历史原文')
    expect(message.turnId).to.equal('turn-1')
  })
  it('holds persisted typed prose until the exact scoped outcome is available', async () => {
    const { discussionMessageText } = await import('../src/composables/juyiting/hallDiscussionTurns.js')
    const message = normalizeHallMessage({ id: 'reply-1', messageType: 'ASSISTANT', content: '请生成一张鸟的图片。', metadata: { outcomeId: 'outcome-1' } }, '')
    expect(discussionMessageText(project([message], [])[0])).to.equal('')
    expect(project([message], [])[0].turnAwaitingType).to.equal(true)
    expect(discussionMessageText(project([message])[0])).to.equal('')
    const answerProjection = projection(); answerProjection.outcome.kind = 'ANSWER'
    expect(discussionMessageText(project([message], [answerProjection])[0])).to.equal(message.content)
  })
  it('uses an authoritative final event kind before its progress lookup arrives', async () => {
    const { discussionMessageText } = await import('../src/composables/juyiting/hallDiscussionTurns.js')
    const state = { conversationId: '42', messages: [] }
    appendHallEventMessage(state, { type: 'agent_message', conversationId: '42', messageId: 'reply-1', senderType: 'agent', content: '请生成图片', typedOutcome: { outcomeId: 'outcome-1', taskId: 'task-1', kind: 'ACTION_REQUEST' } }, '')
    expect(state.messages[0].typedOutcomeKind).to.equal('ACTION_REQUEST')
    expect(discussionMessageText(project(state.messages, [])[0])).to.equal('')
  })
})

describe('provisional user reply stream purpose', () => {
  const delta = (seq, content, kind = 'ANSWER', turnId = 'turn-1') => ({ type: 'agent_message_delta', senderType: 'agent',
    agentId: 'agent-1', conversationId: '42', turnId, deltaSeq: String(seq), content, streamOutcomeKind: kind })
  const visible = state => discussionMessageText(project(state.messages, [])[0])
  it('shows two ANSWER/CLARIFY increments before final, then replaces rather than duplicates', () => {
    for (const kind of ['ANSWER', 'CLARIFY']) {
      const state = { messages: [], conversationId: '42' }
      appendHallEventMessage(state, delta(1, '你好', kind))
      expect(state.messages[0].streaming).to.equal(true)
      expect(visible(state)).to.equal('你好')
      appendHallEventMessage(state, delta(2, '，请说明', kind))
      expect(visible(state)).to.equal('你好，请说明')
      appendHallEventMessage(state, { type: 'agent_message', senderType: 'agent', agentId: 'agent-1', conversationId: '42',
        turnId: 'turn-1', messageId: '101', content: '你好，请说明需求', typedOutcome: { outcomeId: 'out-1', kind, taskId: 'task-1' } })
      expect(state.messages).to.have.length(1)
      expect(state.messages[0].streaming).to.equal(false)
      expect(visible(state)).to.equal('你好，请说明需求')
    }
  })
  it('unknown, control and mixed purpose chunks stay hidden, even when a later chunk is marked', () => {
    for (const kinds of [[undefined, 'ANSWER', 'ANSWER'], ['ACTION_REQUEST', 'ANSWER'], ['ANSWER', undefined], ['ANSWER', 'CLARIFY']]) {
      const state = { messages: [], conversationId: '42' }
      kinds.forEach((kind, i) => {
        const event = delta(i + 1, '片段'); event.streamOutcomeKind = kind
        appendHallEventMessage(state, event)
      })
      expect(visible(state)).to.equal('')
    }
  })
  it('keeps purpose per turn and retains sequence gap/duplicate protection', () => {
    const state = { messages: [], conversationId: '42' }
    appendHallEventMessage(state, delta(1, '公开'))
    appendHallEventMessage(state, delta(1, '秘密', 'ACTION_REQUEST', 'turn-2'))
    expect(project(state.messages, []).map(discussionMessageText)).to.deep.equal(['公开', ''])
    expect(appendHallEventMessage(state, delta(1, 'duplicate')).type).to.equal('duplicate_delta')
    expect(appendHallEventMessage(state, delta(3, 'gap')).type).to.equal('resync_required')
    expect(project(state.messages, []).map(discussionMessageText)).not.to.include('公开gap')
  })
})


describe('revision control prose from production regression', () => {
  it('hides revision instructions in live final and scoped reload, keeping user text, files and progress intact', () => {
    const instruction = '请将检查建议整理成可下载的 HTML 文件，不改动图片。'
    const state = { conversationId: '42', messages: [] }
    appendHallEventMessage(state, { type: 'agent_message', conversationId: '42', messageId: 'reply-1', senderType: 'agent', content: instruction,
      typedOutcome: { outcomeId: 'revision-1', taskId: 'task-1', kind: 'REVISION_REQUEST' } }, '')
    const live = project(state.messages, [])[0]
    expect(discussionMessageText(live)).to.equal('')
    expect(live.turnControlRequest).to.equal(true)
    expect(live.turnActionRequest).to.equal(false) // not execution progress / do not invent a child link
    const history = normalizeHallMessage({ id: 'reply-1', messageType: 'ASSISTANT', content: instruction, metadata: { outcomeId: 'revision-1' } }, '')
    const revision = { ...projection(), outcome: { ...projection().outcome, kind: 'REVISION_REQUEST', outcomeId: 'revision-1' },
      actionProgress: null, reviewProgress: { state: 'COMMITTED', childRequestId: 'revision-child' } }
    const before = structuredClone(revision)
    const row = project([{ ...history, parts: [part()] }], [revision])[0]
    expect(discussionMessageText(row)).to.equal('')
    expect(row.parts).to.have.length(1)
    expect(row.turnOriginal.content).to.equal(instruction)
    expect(revision).to.deep.equal(before)
    expect(discussionMessageText({ sender: 'USER', content: instruction })).to.equal(instruction)
    expect(discussionMessageText(project([{ ...history, content: '这是给你的建议。' }], [{ ...revision, outcome: { ...revision.outcome, kind: 'ANSWER' } }])[0])).to.equal('这是给你的建议。')
  })
})

// Exact production shape: revision CHAT -> action CHAT -> execution/file.
describe('single reply across revision and execution', () => {
  const revision = () => ({ ...projection(), outcome: { ...projection().outcome, kind: 'REVISION_REQUEST' },
    actionProgress: null, reviewProgress: { state: 'COMMITTED', childRequestId: 'revision-child', childState: 'COMPLETED' } })
  const action = () => ({ ...projection(), outcome: { ...projection().outcome, assistantMessageId: 'reply-2' }, actionProgress: { childRequestId: 'child-1', state: 'COMPLETED' } })
  const child = () => ({ ...parent(), localId: 'reply-2', requestId: 'revision-child' })
  it('replaces progress with image or document in the original row, preserving all raw records', async () => {
    const { discussionReplyStatus } = await import('../src/composables/juyiting/hallDiscussionTurns.js')
    for (const kind of ['image', 'file']) {
      const messages = [parent(), child(), { ...delivery(), parts: [{ ...part(), kind }] }]
      const before = structuredClone(messages)
      const rows = project(messages, [revision(), action()])
      expect(rows).to.have.length(1)
      expect(rows[0].localId).to.equal('reply-1')
      expect(rows[0].parts).to.have.length(1)
      expect(rows[0].turnRequestIds).to.deep.equal(['revision-child', 'child-1'])
      expect(rows[0].turnDeliveries.map(discussionDeliveryText)).to.deep.equal(['', ''])
      expect(discussionReplyStatus(rows[0])).to.equal('')
      expect(messages).to.deep.equal(before)
    }
  })
  it('keeps one generic pending state and never calls completed CHAT a delivered result', async () => {
    const { discussionReplyStatus } = await import('../src/composables/juyiting/hallDiscussionTurns.js')
    const p = revision();p.reviewProgress.childState = 'RUNNING'
    expect(discussionReplyStatus(project([parent()], [p])[0])).to.equal('正在处理…')
    expect(discussionReplyStatus(project([parent()], [revision()])[0])).to.equal('正在读取答复…')
    expect(discussionReplyStatus(project([parent(), child()], [revision(), action()])[0])).to.equal('正在读取成果…')
  })
  it('groups a text-only streaming answer and preserves its text and original identity', () => {
    const answer = { ...child(), content: '已按要求调整', streamOutcomeKind: 'ANSWER', streaming: true }
    const rows = project([parent(), answer], [revision()])
    expect(rows).to.have.length(1)
    expect(rows[0].streaming).to.equal(true)
    expect(discussionDeliveryText(rows[0].turnDeliveries[0])).to.equal(answer.content)
    expect(rows[0].turnDeliveries[0].turnOriginal).to.equal(answer)
  })
  it('preserves clarification projection identity for the reply button', () => {
    const p = { ...action(), outcome: { ...action().outcome, kind: 'CLARIFY' } }
    const rows = project([parent(), { ...child(), content: '需要什么尺寸？' }], [revision(), p])
    expect(rows).to.have.length(1)
    expect(rows[0].turnProjections).to.have.length(1)
    expect(rows[0].turnDeliveries[0].localId).to.equal(p.outcome.assistantMessageId)
    expect(discussionDeliveryText(rows[0].turnDeliveries[0])).to.equal('需要什么尺寸？')
  })
  it('keeps failures visible even if an older artifact is present', async () => {
    const { discussionReplyStatus } = await import('../src/composables/juyiting/hallDiscussionTurns.js')
    const p = action();p.actionProgress.state = 'FAILED'
    expect(discussionReplyStatus(project([parent(), child(), delivery()], [revision(), p])[0])).to.equal('本轮未完成')
  })
  it('uses exact links with shuffled arrival, does not group unrelated or other-agent answers', () => {
    expect(project([delivery(), child(), parent()], [action(), revision()])).to.have.length(1)
    expect(project([parent(), { ...child(), requestId: 'unrelated' }], [revision()])).to.have.length(2)
    expect(project([parent(), { ...child(), agentId: 'other' }], [revision()])).to.have.length(2)
  })
})
