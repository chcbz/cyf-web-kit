import { expect } from 'chai'
import { describe, it } from 'mocha'
import { ref } from 'vue'
import { useHallQuickMatter } from '../src/composables/juyiting/useHallQuickMatter.js'

const memoryStorage = () => {
  const values = new Map()
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  }
}
const savedDraft = data => ({
  draftId: 'draft-quick-1', revision: 1, state: 'EDITING', savedAt: 1,
  kind: 'TASK_CREATE', editableFields: {
    title: data.title, instruction: data.instruction, targetAgentId: null, outputMime: null, inputs: []
  }, sourceSummary: {}, submissionRef: null
})
const taskReceipt = () => ({
  ref: { sourceType: 'TASK', sourceId: 'task-quick-1' }, execution: null,
  task: { taskId: 'task-quick-1', taskVersion: '1' }, submittedAt: 2
})
const taskDetail = () => ({ id: 'task-quick-1', title: '移动竖屏活动方案', description: '移动竖屏活动方案', status: 'open' })

describe('Juyi Hall one-sentence matter adapter', () => {
  it('creates TASK_CREATE with a bounded title, preserves the request, and never creates an execution', async () => {
    const calls = []
    let keyNo = 0
    const model = useHallQuickMatter({
      identityScope: 'tenant\u0000client\u0000owner-a', storage: memoryStorage(), keyFactory: () => `quick-key-${++keyNo}`,
      agentApi: { execute: async request => {
        calls.push(request)
        if (request.url === '/hall/drafts') return savedDraft(request.data)
        if (request.url.endsWith('/submit')) return taskReceipt()
        if (request.url === '/tasks/task-quick-1') return taskDetail()
        throw new Error(`unexpected request ${request.url}`)
      } }
    })
    const request = `，${'移动竖屏活动方案需要整理成可直接发给团队的执行清单'.repeat(2)}。`
    const result = await model.submit(request)

    expect(result.task).to.deep.equal(taskDetail())
    expect(calls.map(call => [call.method, call.url])).to.deep.equal([
      ['POST', '/hall/drafts'], ['POST', '/hall/drafts/draft-quick-1/submit'], ['GET', '/tasks/task-quick-1']
    ])
    expect(calls[0].data).to.include({ kind: 'TASK_CREATE', originRef: 'juyiting-conversation-v4', instruction: request })
    expect([...calls[0].data.title]).to.have.length.at.most(30)
    expect(calls[0].data.inputs).to.deep.equal([])
    expect(calls.some(call => call.url.includes('/personal-workspace/executions'))).to.equal(false)
    expect(result.receipt.execution).to.equal(null)
    expect(model.message.value).to.include('尚未调用 Agent')
    model.drafts.dispose()
  })

  it('rejects empty and over-limit requests before any network request', async () => {
    const calls = []
    const model = useHallQuickMatter({ identityScope: 'scope-a', storage: memoryStorage(), agentApi: { execute: async request => { calls.push(request) } } })
    expect(await model.submit(' \n ')).to.equal(null)
    expect(model.message.value).to.include('先说一句')
    expect(await model.submit('甲'.repeat(201))).to.equal(null)
    expect(model.message.value).to.include('最多 200 字')
    expect(calls).to.have.length(0)
    model.drafts.dispose()
  })

  it('reconciles the exact unknown submit instead of creating or submitting a duplicate', async () => {
    const storage = memoryStorage()
    const calls = []
    let submitLost = true
    const api = { execute: async request => {
      calls.push(request)
      if (request.url === '/hall/drafts') return savedDraft(request.data)
      if (request.url.endsWith('/submit') && submitLost) {
        submitLost = false
        throw Object.assign(new Error('lost response'), { status: 503 })
      }
      if (request.url === '/hall/submissions/request') return taskReceipt()
      if (request.url === '/tasks/task-quick-1') return taskDetail()
      throw new Error(`unexpected request ${request.url}`)
    } }
    const first = useHallQuickMatter({ identityScope: 'scope-a', storage, keyFactory: () => 'unknown-key', agentApi: api })
    expect(await first.submit('整理明天的会议方案')).to.equal(null)
    expect(first.drafts.unresolvedIntent.value.idempotencyKey).to.equal('unknown-key')

    const second = useHallQuickMatter({ identityScope: 'scope-a', storage, keyFactory: () => 'new-key', agentApi: api })
    expect(second.message.value).to.include('再次点击只会查询原请求')
    const recovered = await second.submit('这是一条不会新建的不同文字')
    expect(recovered.task.id).to.equal('task-quick-1')
    expect(calls.filter(call => call.url === '/hall/drafts')).to.have.length(1)
    expect(calls.filter(call => call.url.endsWith('/submit'))).to.have.length(1)
    expect(calls.filter(call => call.url === '/hall/submissions/request')).to.have.length(1)
    expect(calls.find(call => call.url === '/hall/submissions/request').headers['Idempotency-Key']).to.equal('unknown-key')
    first.drafts.dispose(); second.drafts.dispose()
  })

  it('clears quick text and does not expose another owner scope recovery state', async () => {
    const storage = memoryStorage()
    const scope = ref('tenant\u0000client\u0000owner-a')
    const model = useHallQuickMatter({ identityScope: scope, identityEpoch: ref(1), storage, agentApi: { execute: async () => { throw new Error('unused') } } })
    model.requestText.value = 'owner-a sensitive request'
    model.message.value = 'owner-a state'
    scope.value = 'tenant\u0000client\u0000owner-b'
    expect(model.requestText.value).to.equal('')
    expect(model.message.value).to.equal('')
    expect(model.drafts.unresolvedIntent.value).to.equal(null)
    model.drafts.dispose()
  })
})
