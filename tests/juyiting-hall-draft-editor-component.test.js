import { expect } from 'chai'
import { after, before, describe, it } from 'mocha'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'

let Vue
let mount
let HallDraftEditor

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
    .replace(/^import\s+\{\s*usePersonalWorkspace\s*\}\s+from\s+['"]@\/composables\/usePersonalWorkspace['"];?\s*$/gm, 'var { usePersonalWorkspace } = deps')
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
  return {
    useHallDrafts: () => ({
      draft, summaries, nextCursor, state, error, reloadRequired, receipt, submissionState, caseView, submissionRecovery, unresolvedIntent,
      create: async fields => { draft.value = { draftId: 'draft-1', revision: 1, state: 'EDITING', editableFields: fields }; return draft.value },
      save: async fields => { draft.value = { ...draft.value, revision: 2, editableFields: fields }; return draft.value },
      list: async () => true, loadMore: async () => false, load: async () => null, discard: async () => null,
      submit: async () => null, reconcileSubmission: async () => null, loadCase: async () => null, dispose: () => {}
    }),
    usePersonalWorkspace: () => ({
      loading: Vue.ref(false), error: Vue.ref(''), items: Vue.ref([]), listState: Vue.ref('empty'), detail: Vue.ref(null), preview: Vue.ref(null),
      refresh: async () => true, select: async () => null, previewVersion: async () => null, dispose: () => {}
    })
  }
}

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
})
