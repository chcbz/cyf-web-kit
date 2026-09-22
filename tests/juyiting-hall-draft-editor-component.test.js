import { expect } from 'chai'
import { after, before, describe, it } from 'mocha'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'

let Vue
let mount
let HallDraftEditor
let editorState

const loadEditor = (deps = editorDeps()) => {
  const filename = new URL('../src/components/juyiting/HallDraftEditor.vue', import.meta.url).pathname
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const script = compileScript(descriptor, { id: 'hall-draft-editor-test', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, bindings) => {
      const values = bindings.split(',').map(binding => {
        const [name, alias] = binding.trim().split(/\s+as\s+/)
        return alias ? `${name}: ${alias}` : name
      }).join(', ')
      return `var { ${values} } = Vue`
    })
    .replace(/^import\s+\{[^}]+\}\s+from\s+['"]@\/composables\/usePersonalWorkspace['"];?\s*$/gm, 'var { savePersonalWorkspaceBlob, usePersonalWorkspace } = deps')
    .replace(/^import\s+\{\s*useHallDrafts\s*\}\s+from\s+['"]@\/composables\/juyiting\/useHallDrafts['"];?\s*$/gm, 'var { useHallDrafts } = deps')
    .replace('export default', 'return')
  return new Function('Vue', 'deps', script)(Vue, deps)
}

const editorDeps = () => {
  const draft = Vue.ref(null)
  const summaries = Vue.ref([])
  const nextCursor = Vue.ref(null)
  const state = Vue.ref('idle')
  const error = Vue.ref('')
  const reloadRequired = Vue.ref(false)
  const receipt = Vue.ref(null)
  const submissionState = Vue.ref('idle')
  const caseView = Vue.ref(null)
  const submissionRecovery = Vue.ref(null)
  const unresolvedIntent = Vue.ref(null)
  const executionResults = Vue.ref(null)
  const resultsState = Vue.ref('idle')
  const resultsError = Vue.ref('')
  const created = []
  const loadedResults = []
  const workspaceCalls = []
  editorState = { draft, receipt, caseView, executionResults, resultsState, resultsError, created, loadedResults, workspaceCalls }
  return {
    useHallDrafts: () => ({
      draft, summaries, nextCursor, state, error, reloadRequired, receipt, submissionState, caseView, submissionRecovery, unresolvedIntent, executionResults, resultsState, resultsError,
      create: async fields => {
        created.push(fields)
        draft.value = { draftId: `draft-${created.length}`, revision: 1, state: 'EDITING', editableFields: fields }
        return draft.value
      },
      save: async fields => { draft.value = { ...draft.value, revision: 2, editableFields: fields }; return draft.value },
      list: async () => true, loadMore: async () => false, load: async () => null, discard: async () => null,
      submit: async () => null, reconcileSubmission: async () => null, loadCase: async () => null,
      loadResults: async executionId => {
        loadedResults.push(executionId)
        executionResults.value = {
          executionId, state: 'OUTPUT_COMMITTED', manifestId: 'manifest-1', allowedActions: ['VIEW', 'CREATE_REVISION'],
          items: [
            { outputId: 'output-1', fileId: 'file-1', fileVersion: 2, mime: 'application/pdf', filename: '结案.pdf', byteLength: 12, sha256: 'a'.repeat(64), availability: 'AVAILABLE' },
            { outputId: 'output-2', fileId: 'file-2', fileVersion: 7, mime: 'text/plain', filename: '缺失.txt', byteLength: 3, sha256: 'b'.repeat(64), availability: 'UNAVAILABLE' }
          ]
        }
        resultsState.value = 'ready'
        return executionResults.value
      },
      dispose: () => {}
    }),
    usePersonalWorkspace: () => ({
      loading: Vue.ref(false), error: Vue.ref(''), items: Vue.ref([]), listState: Vue.ref('empty'), detail: Vue.ref(null), preview: Vue.ref(null),
      refresh: async () => true,
      select: async fileId => { workspaceCalls.push(['select', fileId]); return { file: { fileId } } },
      previewVersion: async version => { workspaceCalls.push(['preview', version]); return true },
      download: async version => { workspaceCalls.push(['download', version]); return { blob: {}, filename: '结案.pdf' } },
      dispose: () => {}
    }),
    savePersonalWorkspaceBlob: result => { workspaceCalls.push(['save', result.filename]) }
  }
}

const button = (wrapper, text) => wrapper.findAll('button').find(item => item.text() === text)

before(async () => {
  for (const key of ['SVGElement', 'Element', 'Node']) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: globalThis.window[key] })
  }
  Vue = await import('vue')
  ;({ mount } = await import('@vue/test-utils'))
  HallDraftEditor = loadEditor()
})
after(() => { document.body.innerHTML = '' })

describe('JYT-UX-W03 HallDraftEditor boundary', () => {
  it('receives the stable owner/client scope from the production Hall path rather than an epoch', () => {
    const bounty = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
    const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    expect(bounty).to.include(':identity-scope="identityScope"')
    expect(hall).to.include(':identity-scope="hallIdentityScope"')
    expect(hall).to.include("[tenant, client, owner].filter(Boolean).join('\\u0000')")
  })

  it('mounts the production component with its empty default draft and exposes the first save action', async () => {
    const wrapper = mount(HallDraftEditor, {
      props: { agents: [], selectedAgent: null, identityEpoch: 7, identityScope: 'tenant\u0000client\u0000owner' }
    })
    await Vue.nextTick()
    expect(wrapper.text()).to.include('确认保存草稿')
    expect(wrapper.find('button[type="submit"]').exists()).to.equal(true)
    expect(wrapper.find('input[type="checkbox"]').exists()).to.equal(false)
    wrapper.unmount()
  })

  it('mounts fixed private results, hides unavailable actions, and creates a revision from the exact output reference', async () => {
    const wrapper = mount(HallDraftEditor, {
      props: { agents: [], selectedAgent: null, identityEpoch: 7, identityScope: 'tenant\u0000client\u0000owner' }
    })
    editorState.draft.value = { draftId: 'draft-submitted', revision: 1, state: 'SUBMITTED', editableFields: {} }
    editorState.receipt.value = { ref: { sourceType: 'PRIVATE_CASE', sourceId: 'case-1' }, execution: { executionId: 'exec-1', targetAgentId: 'agent-1', state: 'OUTPUT_COMMITTED' }, task: null, submittedAt: 1 }
    editorState.caseView.value = { caseId: 'case-1', executions: [{ revisionNo: 1, execution: { executionId: 'exec-1', targetAgentId: 'agent-1', state: 'OUTPUT_COMMITTED' } }] }
    await Vue.nextTick()
    expect(wrapper.text()).to.include('可查看已登记的固定版本成果')
    await button(wrapper, '查看成果').trigger('click')
    await Vue.nextTick()
    expect(editorState.loadedResults).to.deep.equal(['exec-1'])
    expect(wrapper.text()).to.include('结案.pdf')
    expect(wrapper.text()).to.include('缺失.txt')
    expect(wrapper.findAll('.hall-result-item').at(1).findAll('button')).to.have.length(0)
    await button(wrapper, '预览').trigger('click')
    await button(wrapper, '下载').trigger('click')
    expect(editorState.workspaceCalls).to.deep.equal([
      ['select', 'file-1'], ['preview', 2], ['select', 'file-1'], ['download', 2], ['save', '结案.pdf']
    ])
    editorState.executionResults.value = { ...editorState.executionResults.value, allowedActions: ['VIEW'] }
    await Vue.nextTick()
    expect(button(wrapper, '提出修改')).to.equal(undefined)
    editorState.executionResults.value = { ...editorState.executionResults.value, allowedActions: ['VIEW', 'CREATE_REVISION'] }
    await Vue.nextTick()
    await button(wrapper, '提出修改').trigger('click')
    await Vue.nextTick()
    expect(wrapper.find('button[type="submit"]').text()).to.equal('保存修改草稿')
    await wrapper.find('form').trigger('submit')
    expect(editorState.created).to.have.length(1)
    expect(editorState.created[0]).to.include({ kind: 'REVISION', caseId: 'case-1' })
    expect(editorState.created[0].sourceOutputRef).to.deep.equal({ executionId: 'exec-1', outputId: 'output-1', fileId: 'file-1', fileVersion: 2 })
    wrapper.unmount()
  })
})

describe('JYT-UX-W05 real editor source restoration', () => {
  const setupReader = async handler => {
    const { useHallDrafts } = await import('../src/composables/juyiting/useHallDrafts.js')
    const deps = editorDeps()
    const calls = []
    const writes = []
    const storageMap = new Map()
    let workspaceRefreshes = 0
    const originalWorkspace = deps.usePersonalWorkspace
    deps.usePersonalWorkspace = () => ({ ...originalWorkspace(), refresh: async () => { workspaceRefreshes += 1; return true } })
    deps.useHallDrafts = options => useHallDrafts({
      ...options,
      agentApi: { execute: async request => { calls.push(request); return handler(request) } },
      storage: { getItem: key => storageMap.get(key) || null, setItem: (key, value) => { writes.push([key, value]); storageMap.set(key, value) }, removeItem: key => storageMap.delete(key) }
    })
    return { component: loadEditor(deps), calls, writes, entries: () => [...storageMap.entries()], workspaceRefreshes: () => workspaceRefreshes }
  }
  const base = { identityEpoch: 1, identityScope: 'tenant\u0000client\u0000owner-a' }
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick() }

  it('restores the exact saved draft revision through GET without creating a replacement', async () => {
    const { component, calls, writes, entries } = await setupReader(() => ({ draftId: 'draft-a', revision: 7, state: 'EDITING', savedAt: 100, kind: 'CREATE',
      editableFields: { title: '已存名目', instruction: '固定正文', targetAgentId: 'agent-a', outputMime: 'text/plain', inputs: [] }, sourceSummary: {}, submissionRef: null }))
    const wrapper = mount(component, { props: { ...base, initialRef: { sourceType: 'DRAFT', sourceId: 'draft-a' } } })
    try {
      await settle()
      expect(calls.map(call => [call.method, call.url])).to.deep.equal([['GET', '/hall/drafts/draft-a']])
      expect(wrapper.find('textarea').element.value).to.equal('固定正文')
      expect(wrapper.text()).to.include('r7')
      expect(wrapper.find('input[type="checkbox"]').element.checked).to.equal(false)
      expect(writes.every(([key]) => key === 'cyf.hall.submission-recovery.v1.browser')).to.equal(true)
      expect(JSON.stringify(entries())).not.to.match(/固定正文|已存名目|case-a|exec-a/)
    } finally { wrapper.unmount() }
  })

  it('restores formal draft editing without presenting a private-submission confirmation', async () => {
    for (const kind of ['TASK_CREATE', 'TASK_ACTION']) {
      const { component, calls } = await setupReader(() => ({ draftId: 'formal-draft', revision: 3, state: 'EDITING', savedAt: 100, kind,
        editableFields: { title: '正式草稿', instruction: '原正式交代', targetAgentId: 'agent-a', outputMime: 'text/plain', inputs: [] }, sourceSummary: {}, submissionRef: null }))
      const wrapper = mount(component, { props: { ...base, initialRef: { sourceType: 'DRAFT', sourceId: 'formal-draft' } } })
      try {
        await settle()
        expect(wrapper.find('textarea').element.value).to.equal('原正式交代')
        if (kind === 'TASK_ACTION') {
          expect(wrapper.find('input[type="checkbox"]').exists()).to.equal(false)
          expect(wrapper.text()).to.include('正式张榜和返工请使用原正式入口')
        } else {
          expect(wrapper.find('input[type="checkbox"]').element.disabled).to.equal(true)
          expect(wrapper.text()).to.include('原稿包含此入口不支持的选人')
          expect(wrapper.text()).not.to.include('我已确认本次私人交办')
        }
        expect(wrapper.find('button[type="submit"]').text()).to.equal('保存修改')
        expect(calls.map(call => call.method)).to.deep.equal(['GET'])
      } finally { wrapper.unmount() }
    }
  })

  it('opens PRIVATE_CASE progress without fabricating a submission receipt or resubmitting', async () => {
    const { component, calls, writes, entries } = await setupReader(() => ({ caseId: 'case-a', title: '原事项', revision: 1, sourceRef: {}, allowedActions: ['VIEW'],
      executions: [{ revisionNo: 1, execution: { executionId: 'exec-a', targetAgentId: 'agent-a', state: 'QUEUED' } }] }))
    const wrapper = mount(component, { props: { ...base, initialRef: { sourceType: 'PRIVATE_CASE', sourceId: 'case-a' } } })
    try {
      await settle()
      expect(wrapper.find('textarea').exists()).to.equal(false)
      expect(wrapper.text()).to.include('私人事项 · case-a')
      expect(wrapper.text()).to.include('exec-a')
      expect(wrapper.find('button[type="submit"]').exists()).to.equal(false)
      expect(calls.map(call => [call.method, call.url])).to.deep.equal([['GET', '/hall/cases/case-a']])
      expect(writes.every(([key]) => key === 'cyf.hall.submission-recovery.v1.browser')).to.equal(true)
      expect(JSON.stringify(entries())).not.to.match(/固定正文|已存名目|case-a|exec-a/)
    } finally { wrapper.unmount() }
  })

  it('keeps LEGACY_EXECUTION read-only and reads its real execution endpoint', async () => {
    const { component, calls } = await setupReader(() => ({ executionId: 'exec-old', targetAgentId: 'agent-a', state: 'OUTPUT_COMMITTED' }))
    const wrapper = mount(component, { props: { ...base, initialRef: { sourceType: 'LEGACY_EXECUTION', sourceId: 'exec-old' } } })
    try {
      await settle()
      expect(wrapper.text()).to.include('原私人交办 · exec-old')
      expect(wrapper.text()).to.include('可查看已登记的固定版本成果')
      expect(wrapper.find('button[type="submit"]').exists()).to.equal(false)
      expect(calls[0]).to.include({ method: 'GET', url: '/personal-workspace/executions/exec-old' })
      expect(calls[0]).not.to.have.property('params')
    } finally { wrapper.unmount() }
  })

  it('does not turn an inaccessible draft into a fresh editable form', async () => {
    const { component, calls } = await setupReader(() => { throw Object.assign(new Error('not found'), { status: 404 }) })
    const wrapper = mount(component, { props: { ...base, initialRef: { sourceType: 'DRAFT', sourceId: 'draft-missing' } } })
    try {
      await settle()
      expect(wrapper.text()).to.include('不会另建事项代替')
      expect(wrapper.find('button[type="submit"]').exists()).to.equal(false)
      expect(wrapper.find('textarea').exists()).to.equal(false)
      expect(calls).to.have.length(1)
    } finally { wrapper.unmount() }
  })

  it('rejects a different draft ID returned for an exact overview reference', async () => {
    const { component, calls } = await setupReader(() => ({ draftId: 'another-draft', revision: 1, state: 'EDITING', savedAt: 100, kind: 'CREATE',
      editableFields: { title: '不能代替原事项', instruction: '另一事项正文', targetAgentId: null, outputMime: null, inputs: [] }, sourceSummary: {}, submissionRef: null }))
    const wrapper = mount(component, { props: { ...base, initialRef: { sourceType: 'DRAFT', sourceId: 'exact-draft' } } })
    try {
      await settle()
      expect(wrapper.find('textarea').exists()).to.equal(false)
      expect(wrapper.text()).not.to.include('另一事项正文')
      expect(wrapper.text()).to.include('未用其他草稿代替')
      expect(calls).to.have.length(1)
    } finally { wrapper.unmount() }
  })

  const formalSaved = (fields = {}, overrides = {}) => ({
    draftId: 'formal-draft', revision: 1, state: 'EDITING', savedAt: 100, kind: 'TASK_CREATE',
    editableFields: { title: '任务名目', instruction: '任务简述', targetAgentId: null, outputMime: null, inputs: [], ...fields },
    sourceSummary: { originRef: 'juyiting', sourceRef: null, conversationId: null }, submissionRef: null, ...overrides
  })
  const formalReceipt = { ref: { sourceType: 'TASK', sourceId: 'task-created' }, execution: null,
    task: { taskId: 'task-created', taskVersion: '9007199254740993' }, submittedAt: 101 }

  it('creates a formal draft without agent/format/material inputs and opens the exact real formal task after one POST', async () => {
    let finishSubmit
    const canonicalTask = { id: 'task-created', title: '原正式任务', status: 'open', version: '9007199254740993' }
    const harness = await setupReader(request => {
      if (request.url === '/hall/drafts') return formalSaved({ ...request.data, targetAgentId: null, outputMime: null })
      if (request.url.endsWith('/submit')) return new Promise(resolve => { finishSubmit = () => resolve(formalReceipt) })
      if (request.url === '/tasks/task-created') return canonicalTask
      throw new Error(`unexpected ${request.url}`)
    })
    const wrapper = mount(harness.component, { props: { ...base, initialKind: 'TASK_CREATE', selectedAgent: { agentId: 'do-not-assign' } } })
    try {
      await settle()
      expect(wrapper.text()).to.include('任务名目')
      expect(wrapper.text()).to.include('简述')
      expect(wrapper.text()).to.include('不收取悬赏金额，也不启动执行')
      expect(wrapper.find('select').exists()).to.equal(false)
      expect(wrapper.find('.draft-materials').exists()).to.equal(false)
      expect(wrapper.findAll('input')).to.have.length(1)
      expect(harness.workspaceRefreshes()).to.equal(0)
      await wrapper.find('input').setValue('名'.repeat(30))
      await wrapper.find('textarea').setValue('述'.repeat(200))
      await wrapper.find('form').trigger('submit')
      await settle()
      const create = harness.calls[0]
      expect(create.data).to.include({ kind: 'TASK_CREATE', targetAgentId: '', outputMime: '', sourceRef: null, conversationId: null })
      expect(create.data.inputs).to.deep.equal([])
      expect(create.data.title).to.equal('名'.repeat(30))
      expect(create.data.instruction).to.equal('述'.repeat(200))
      const checkbox = wrapper.find('input[type="checkbox"]')
      expect(checkbox.element.disabled).to.equal(false)
      await checkbox.setValue(true)
      const submit = button(wrapper, '确认创建正式任务')
      await submit.trigger('click')
      await submit.trigger('click')
      expect(harness.calls.filter(call => call.url.endsWith('/submit'))).to.have.length(1)
      finishSubmit()
      await settle()
      expect(wrapper.text()).to.include('正式任务已创建，尚未指派或启动执行')
      expect(wrapper.text()).not.to.include('尚未取得成果')
      expect(wrapper.find('button[type="submit"]').exists()).to.equal(false)
      expect(button(wrapper, '确认创建正式任务')).to.equal(undefined)
      await button(wrapper, '打开正式事项').trigger('click')
      await settle()
      expect(wrapper.emitted('open-task')).to.deep.equal([[canonicalTask]])
      expect(harness.calls.at(-1)).to.include({ url: '/tasks/task-created', method: 'GET' })
      expect(harness.calls.at(-1)).not.to.have.property('params')
      expect(JSON.stringify(harness.entries())).not.to.include('名'.repeat(30))
      expect(JSON.stringify(harness.entries())).not.to.include('述'.repeat(200))
    } finally { wrapper.unmount() }
  })

  it('preserves oversized restored formal text and saves it without truncation, but requires correction before confirmation', async () => {
    const title = '长'.repeat(31)
    const instruction = '文'.repeat(201)
    const { component, calls } = await setupReader(request => formalSaved({ title, instruction }, { revision: request.method === 'PUT' ? 2 : 1 }))
    const wrapper = mount(component, { props: { ...base, initialRef: { sourceType: 'DRAFT', sourceId: 'formal-draft' } } })
    try {
      await settle()
      expect(wrapper.find('input').element.value).to.equal(title)
      expect(wrapper.find('textarea').element.value).to.equal(instruction)
      expect(wrapper.find('input').attributes('maxlength')).to.equal('30')
      expect(wrapper.find('textarea').attributes('maxlength')).to.equal('200')
      expect(wrapper.text()).to.include('原文仍保留')
      expect(wrapper.find('input[type="checkbox"]').element.disabled).to.equal(true)
      await wrapper.find('form').trigger('submit')
      await settle()
      expect(calls.at(-1)).to.include({ method: 'PUT', url: '/hall/drafts/formal-draft' })
      expect(calls.at(-1).data).to.include({ title, instruction })
      expect(wrapper.find('textarea').element.value).to.equal(instruction)
      expect(calls.filter(call => call.url.endsWith('/submit'))).to.have.length(0)
    } finally { wrapper.unmount() }
  })

  it('keeps incompatible formal agent/format/fixed inputs until explicit removal and withdraws saved-snapshot authorization on edit', async () => {
    const existing = { targetAgentId: 'old-agent', outputMime: 'application/pdf', inputs: [{ fileId: 'old-file', version: 7 }] }
    const { component, calls, entries } = await setupReader(request => {
      if (request.method === 'GET') return formalSaved(existing)
      if (request.method === 'PUT') return formalSaved(request.data, { revision: calls.filter(call => call.method === 'PUT').length + 1 })
      return formalReceipt
    })
    const wrapper = mount(component, { props: { ...base, initialRef: { sourceType: 'DRAFT', sourceId: 'formal-draft' } } })
    try {
      await settle()
      expect(wrapper.text()).to.include('old-agent')
      expect(wrapper.text()).to.include('application/pdf')
      expect(wrapper.text()).to.include('old-file · v7')
      expect(wrapper.find('select').exists()).to.equal(false)
      expect(wrapper.find('input[type="checkbox"]').element.disabled).to.equal(true)
      await wrapper.find('form').trigger('submit')
      await settle()
      expect(calls.at(-1).data).to.include({ targetAgentId: 'old-agent', outputMime: 'application/pdf' })
      expect(calls.at(-1).data.inputs).to.deep.equal(existing.inputs)
      await button(wrapper, '明确移除原选人、格式和附件').trigger('click')
      expect(wrapper.find('input[type="checkbox"]').element.disabled).to.equal(true)
      await wrapper.find('form').trigger('submit')
      await settle()
      expect(calls.at(-1).data).to.include({ targetAgentId: '', outputMime: '' })
      expect(calls.at(-1).data.inputs).to.deep.equal([])
      await wrapper.find('input[type="checkbox"]').setValue(true)
      await wrapper.find('textarea').setValue('用户后来修改的简述')
      expect(wrapper.find('input[type="checkbox"]').element.checked).to.equal(false)
      expect(button(wrapper, '确认创建正式任务').element.disabled).to.equal(true)
      await wrapper.find('form').trigger('submit')
      await settle()
      expect(wrapper.find('input[type="checkbox"]').element.checked).to.equal(false)
      await wrapper.find('input[type="checkbox"]').setValue(true)
      await button(wrapper, '确认创建正式任务').trigger('click')
      await settle()
      const post = calls.find(call => call.url.endsWith('/submit'))
      expect(post.data).to.deep.equal({ expectedRevision: 4, authorizationAcknowledgement: true })
      expect(calls.filter(call => call.method === 'PUT').at(-1).data.instruction).to.equal('用户后来修改的简述')
      expect(JSON.stringify(entries())).not.to.match(/用户后来|old-agent|old-file|application\/pdf/)
    } finally { wrapper.unmount() }
  })

  it('never erases immutable formal source/conversation metadata or creates a replacement draft to bypass it', async () => {
    for (const sourceSummary of [{ sourceRef: { sourceType: 'FILE', sourceId: 'private-file', version: 1 } }, { conversationId: 'private-chat' }]) {
      const { component, calls } = await setupReader(() => formalSaved({}, { sourceSummary }))
      const wrapper = mount(component, { props: { ...base, initialRef: { sourceType: 'DRAFT', sourceId: 'formal-draft' } } })
      try {
        await settle()
        expect(wrapper.text()).to.include('此处不能改变该关联')
        expect(wrapper.find('input[type="checkbox"]').element.disabled).to.equal(true)
        expect(button(wrapper, '确认创建正式任务').element.disabled).to.equal(true)
        expect(calls.map(call => call.method)).to.deep.equal(['GET'])
      } finally { wrapper.unmount() }
    }
  })

  it('retains full private CREATE editing, selected target and fixed inputs instead of imposing formal limits', async () => {
    const { component, calls } = await setupReader(request => formalSaved(request.data, { kind: 'CREATE' }))
    const wrapper = mount(component, { props: { ...base, selectedAgent: { agentId: 'private-agent' }, agents: [{ agentId: 'private-agent' }] } })
    try {
      await settle()
      expect(wrapper.find('select').element.value).to.equal('private-agent')
      expect(wrapper.find('.draft-materials').exists()).to.equal(true)
      expect(wrapper.find('input').attributes('maxlength')).to.equal('16000')
      await wrapper.find('input').setValue('私'.repeat(31))
      await wrapper.find('textarea').setValue('密'.repeat(201))
      await wrapper.find('form').trigger('submit')
      await settle()
      expect(calls[0].data).to.include({ kind: 'CREATE', title: '私'.repeat(31), instruction: '密'.repeat(201), targetAgentId: 'private-agent' })
      expect(wrapper.text()).to.include('我已确认本次私人交办')
      expect(button(wrapper, '确认创建正式任务')).to.equal(undefined)
    } finally { wrapper.unmount() }
  })

})
