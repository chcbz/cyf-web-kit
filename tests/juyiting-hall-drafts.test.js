import { expect } from 'chai'
import { describe, it } from 'mocha'
const draft = (overrides = {}) => ({
  draftId: 'draft-1', revision: 1, state: 'EDITING', savedAt: 1, kind: 'TASK_CREATE',
  editableFields: { title: '整理案卷', instruction: '固定版本后保存', targetAgentId: 'agent-1', outputMime: 'text/plain', inputs: [{ fileId: 'file-1', version: 2 }] },
  sourceSummary: {}, submissionRef: null, ...overrides
})

describe('JYT-UX-W02 Hall DRAFT-v1 adapter', () => {
  it('persists only a validated DRAFT-v1 create receipt with exact fixed inputs', async () => {
    const calls = []
    const api = { execute: async request => { calls.push(request); return { data: draft() } } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, keyFactory: () => 'create-key' })
    const saved = await drafts.create({ title: '整理案卷', instruction: '固定版本后保存', targetAgentId: 'agent-1', outputMime: 'text/plain', inputs: [{ fileId: 'file-1', version: 2 }] })
    expect(saved.draftId).to.equal('draft-1')
    expect(calls[0]).to.include({ url: '/hall/drafts', method: 'POST' })
    expect(calls[0].headers).to.deep.equal({ 'Idempotency-Key': 'create-key' })
    expect(calls[0].data.inputs).to.deep.equal([{ fileId: 'file-1', version: 2 }])
    expect(Object.keys(calls[0].data)).not.to.include('submit')
    drafts.dispose()
  })

  it('quotes If-Match, keeps local input on a 412, and asks the user to reload', async () => {
    const calls = []
    const api = { execute: async request => {
      calls.push(request)
      if (request.method === 'POST') return { data: draft() }
      const error = new Error('changed'); error.status = 412; error.code = 'HALL_DRAFT_REVISION_CHANGED'; throw error
    } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, keyFactory: () => 'key' })
    await drafts.create({ title: '整理案卷', instruction: '固定版本后保存', targetAgentId: 'agent-1', outputMime: 'text/plain', inputs: [{ fileId: 'file-1', version: 2 }] })
    await drafts.save({ title: '本地新标题', instruction: '不应覆盖', targetAgentId: 'agent-1', outputMime: 'text/plain', inputs: [{ fileId: 'file-1', version: 2 }] })
    expect(calls[1].headers).to.deep.equal({ 'If-Match': '"1"' })
    expect(drafts.draft.value.editableFields.title).to.equal('整理案卷')
    expect(drafts.reloadRequired.value).to.equal(true)
    expect(drafts.error.value).to.match(/本地内容未覆盖/)
    drafts.dispose()
  })

  it('does not fabricate a submit endpoint; discard is the only terminal DRAFT-v1 action', async () => {
    const calls = []
    const api = { execute: async request => {
      calls.push(request)
      if (request.method === 'POST' && request.url === '/hall/drafts') return { data: draft() }
      return { data: { ...draft(), state: 'DISCARDED' } }
    } }
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const drafts = useHallDrafts({ agentApi: api, keyFactory: () => 'discard-key' })
    await drafts.create({ title: '', instruction: '', targetAgentId: '', outputMime: '', inputs: [] })
    await drafts.discard()
    expect(calls.map(call => call.url)).to.deep.equal(['/hall/drafts', '/hall/drafts/draft-1/discard'])
    expect(calls[1].headers).to.deep.equal({ 'Idempotency-Key': 'discard-key' })
    expect(calls[1].data).to.deep.equal({ expectedRevision: 1 })
    expect(drafts.draft.value).to.equal(null)
    drafts.dispose()
  })
})
