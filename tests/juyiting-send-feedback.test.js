import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'

const page = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const source = page.slice(page.indexOf('const manualSendPending = ref(false)'), page.indexOf('\nconst handleTypedReply'))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function setup({ refresh, submit = async () => true } = {}) {
  const draft = ref('改成绿色'), task = ref({ id: 'task-1' })
  let writes = 0
  const deps = { ref, voiceReplyCorrelation: { close() {} }, hallVoice: null, playSend() {},
    typedDeliberationEnabled: ref(true), conversationTask: task, hallIdentityScope: ref('user-1'),
    apiStore: { authorizationGeneration: 1 }, conversationId: ref('conv-1'),
    bountyInteractionTargetId: () => 'agent-1', chatContext: ref({}), draft,
    refreshCurrentConversationTask: refresh || (async () => true),
    bountyAssignmentContext: { refresh: async () => true, error: ref('') },
    typedAssignmentRevision: () => '1', showToast() {},
    typedDeliberation: { submit: async (...args) => { writes++; return submit(...args) }, error: ref('') },
    setDraft: value => { draft.value = value }, sendHallMessage: async () => true }
  return { ...new Function(...Object.keys(deps), `${source}; return { manualSendPending, handleSendHallMessage }`)(...Object.values(deps)), draft, task, writes: () => writes }
}
describe('manual send immediate feedback', () => {
  it('locks before slow preflight, prevents duplicate sends, and releases after submission', async () => {
    const read = deferred(), write = deferred()
    const s = setup({ refresh: () => read.promise, submit: () => write.promise })
    const result = s.handleSendHallMessage()
    expect(s.manualSendPending.value).to.equal(true)
    expect(await s.handleSendHallMessage()).to.equal(false)
    expect(s.writes()).to.equal(0)
    read.resolve(true); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(s.manualSendPending.value).to.equal(true)
    write.resolve(true); expect(await result).to.equal(true)
    expect(s.writes()).to.equal(1)
    expect(s.manualSendPending.value).to.equal(false)
    expect(s.draft.value).to.equal('')
  })
  for (const outcome of ['not-ready', 'throw', 'context-change', 'rejected']) {
    it(`releases pending and keeps draft when ${outcome}`, async () => {
      const read = deferred()
      const s = setup({ refresh: outcome === 'throw' ? async () => { throw Error('read failed') } : () => read.promise, submit: async () => false })
      const result = s.handleSendHallMessage().catch(() => false)
      if (outcome === 'context-change') s.task.value = { id: 'task-2' }
      read.resolve(outcome !== 'not-ready')
      expect(await result).to.equal(false)
      expect(s.manualSendPending.value).to.equal(false)
      expect(s.draft.value).to.equal('改成绿色')
      expect(s.writes()).to.equal(outcome === 'rejected' ? 1 : 0)
    })
  }
  it('wires immediate pending into every composer lock and progress indicator', () => {
    expect(page.match(/:conversation-busy="isConversationBusy \|\| manualSendPending"/g)).to.have.length(3)
    expect(page.match(/:is-awaiting-reply="isAwaitingReply \|\| manualSendPending"/g)).to.have.length(3)
  })
})
