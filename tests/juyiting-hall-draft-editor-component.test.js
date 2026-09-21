import { expect } from 'chai'
import { after, before, describe, it } from 'mocha'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'

let Vue
let mount
let HallDraftEditor
let editorState

const loadEditor = () => {
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
  return new Function('Vue', 'deps', script)(Vue, editorDeps())
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
