import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'
import { validMaterialVersion } from '../src/composables/juyiting/materialVersion.js'

const compile = (name, imports) => {
  const { descriptor } = parse(readFileSync(new URL(`../src/components/juyiting/${name}.vue`, import.meta.url), 'utf8'))
  const code = compileScript(descriptor, { id: name, inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, names, path) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, name, path) => `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', code)({ vue: Vue, ...imports })
}
const flush = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); await Vue.nextTick() } }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const row = (fileId, role = 'INPUT', version = '2', state = 'ACTIVE') => ({ fileId, role, version, state })
const PickerStub = Vue.defineComponent({ props: { modelValue: Array, readOnly: Boolean }, setup: props => () => Vue.h('ul', props.modelValue.map(m => Vue.h('li', `${m.displayName} v${m.version}`))) })
const harness = ({ load = async () => [], select = async id => ({ file: { fileId: id, displayName: `真实-${id}` } }) } = {}) => {
  const error = Vue.ref(''), calls = []
  const Component = compile('HallTaskResources', {
    '@/composables/usePersonalWorkspaceTaskLinks': { usePersonalWorkspaceTaskLinks: () => ({ loadAll: load, error }) },
    '@/composables/usePersonalWorkspace': { usePersonalWorkspace: () => ({ select: async id => { calls.push(id); return select(id) } }) },
    './HallMaterialPicker.vue': PickerStub
  })
  const wrapper = mount(Component, { props: { taskId: 'a', identityScope: 'owner', identityEpoch: 1 } })
  return { wrapper, error, calls }
}
describe('matter resources matches prototype without duplicate acceptance', () => {
  it('uses complete ACTIVE fixed-version references, deduplicates roles, resolves names and counts outputs separately', async () => {
    const h = harness({ load: async () => [row('file'), row('file', 'REFERENCE'), row('file', 'INPUT', '3'), row('out', 'OUTPUT'), row('out', 'OUTPUT'), row('removed', 'INPUT', '1', 'DETACHED')] })
    try {
      await flush()
      expect(h.wrapper.text()).to.include('真实-file v2').and.include('真实-file v3').and.include('已有 1 份成果引用')
      expect(h.wrapper.text()).not.to.include('removed')
      expect(h.calls).to.deep.equal(['file'])
      expect(h.wrapper.findComponent(PickerStub).props('readOnly')).to.equal(true)
      expect(h.wrapper.emitted('summary').at(-1)[0]).to.deep.equal({ taskId: 'a', materials: 2, outputs: 1 })
      expect(h.wrapper.text()).not.to.include('验收按钮')
    } finally { h.wrapper.unmount() }
  })
  it('has an honest empty state only after successful complete loading', async () => {
    const wait = deferred(), h = harness({ load: () => wait.promise })
    try {
      expect(h.wrapper.text()).to.include('正在读取').and.not.include('暂无关联资料')
      wait.resolve([]); await flush()
      expect(h.wrapper.text()).to.include('暂无关联资料').and.include('正式成果数量待核对')
      await h.wrapper.setProps({ resultCount: 1 })
      expect(h.wrapper.text()).to.include('本轮已有 1 份成果').and.not.include('尚无成果引用')
    } finally { h.wrapper.unmount() }
  })
  it('error can retry and never reports unknown counts as zero', async () => {
    let n = 0; const h = harness({ load: async () => ++n === 1 ? null : [row('ok')] })
    try {
      await flush(); expect(h.wrapper.find('[role="alert"]').exists()).to.equal(true)
      expect(h.wrapper.text()).not.to.include('暂无关联资料')
      expect(h.wrapper.emitted('summary').at(-1)[0]).to.equal(null)
      await h.wrapper.get('button').trigger('click'); await flush()
      expect(h.wrapper.text()).to.include('真实-ok')
    } finally { h.wrapper.unmount() }
  })
  for (const change of [{ taskId: 'b' }, { identityScope: 'other' }, { identityEpoch: 2 }]) it(`discards late name lookups after ${Object.keys(change)[0]} changes`, async () => {
    const late = deferred(); let n = 0
    const h = harness({ load: async () => [row(++n === 1 ? 'old' : 'new')], select: async id => id === 'old' ? late.promise : { file: { displayName: '新资料' } } })
    try {
      await flush(); await h.wrapper.setProps(change); await flush()
      late.resolve({ file: { displayName: '旧资料不能污染' } }); await flush()
      expect(h.wrapper.text()).to.include('新资料').and.not.include('旧资料不能污染')
    } finally { h.wrapper.unmount() }
  })
  it('discards late directory results after changing tasks', async () => {
    const late = deferred(); let n = 0; const h = harness({ load: () => ++n === 1 ? late.promise : Promise.resolve([row('new')]) })
    try {
      await h.wrapper.setProps({ taskId: 'b' }); await flush(); late.resolve([row('old')]); await flush()
      expect(h.wrapper.text()).to.include('真实-new').and.not.include('真实-old')
    } finally { h.wrapper.unmount() }
  })
  it('readonly picker shows only fixed-version preview, no add/remove/upload entry', async () => {
    const selected = [], previewed = []
    const workspace = { items: Vue.ref([]), detail: Vue.ref(null), error: Vue.ref(''), listState: Vue.ref('idle'), preview: Vue.ref({ kind: 'none' }), pendingWrites: Vue.ref([]),
      closeDetail() {}, revokePreview() {}, select: async id => { selected.push(id); workspace.detail.value = { file: { fileId: id, state: 'ACTIVE' }, versions: [{ version: '2' }], latestVersion: { version: '9' } }; return workspace.detail.value },
      previewVersion: async version => { previewed.push(version); return {} }, dispose() {}, reset() {} }
    const Picker = compile('HallMaterialPicker', { '../../composables/juyiting/materialVersion.js': { validMaterialVersion }, '@/composables/usePersonalWorkspace': { usePersonalWorkspace: () => workspace, savePersonalWorkspaceBlob() {} } })
    const w = mount(Picker, { props: { readOnly: true, identityScope: 'owner', modelValue: [{ fileId: 'f', version: '2', displayName: '资料.md' }] }, global: { stubs: { 'var-icon': true } } })
    try {
      expect(w.find('.quick-material-open').exists()).to.equal(false)
      expect(w.findAll('button').map(b => b.attributes('aria-label'))).to.deep.equal(['预览所选资料'])
      expect(w.get('button').text()).to.equal('')
      await w.get('button').trigger('click'); await flush()
      expect(selected).to.deep.equal(['f']); expect(previewed).to.include('2'); expect(previewed).not.to.include('9')
      expect(w.find('.quick-material-picker').exists()).to.equal(false)
      expect(w.emitted('update:modelValue')).to.equal(undefined)
    } finally { w.unmount() }
  })
})
