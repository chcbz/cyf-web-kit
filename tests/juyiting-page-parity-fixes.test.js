import { expect } from 'chai'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { useHallLibrary } from '../src/composables/juyiting/useHallLibrary.js'

const page = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const closure = (start, end) => page.slice(page.indexOf(start), page.indexOf(end, page.indexOf(start))).replace(/^const \w+ = /, '').trim()

describe('production page parity fixes', () => {
  it('creates attachment-only requirements and truncates only generated titles at Unicode boundaries', async () => {
    const payloads = []
    const deps = { hallIdentityScope: ref('owner'), apiStore: { authorizationGeneration: 1 }, createTask: async p => { payloads.push(p); return true }, hallReadRevision: ref(0), requirementCreateState: ref({}), openPanel: () => {} }
    const submit = new Function(...Object.keys(deps), `return ${closure('const handleQuickRequest =', 'const openOverviewTask =')}`)(...Object.values(deps))
    expect(await submit({ request: '', materials: [{ fileId: 'f1', version: '2' }] })).to.equal(true)
    expect(payloads[0]).to.deep.equal({ title: '资料处理', description: '', attachments: [{ fileId: 'f1', version: '2' }] })
    const text = '🦜'.repeat(43)
    await submit({ request: text, materials: [] })
    expect(payloads[1].title).to.equal('🦜'.repeat(36)); expect(payloads[1].description).to.equal(text)
    expect(await submit({ request: '', materials: [] })).to.equal(false)
  })
  it('routes workspace and reader citations to TASK_CREATE without private source authority or Agent selection', () => {
    const panels = [], context = ref(null), generation = ref(0)
    const deps = { guardPanelLeave: () => false, openPanel: panel => { panels.push(panel); return true }, formalDraftContext: context, formalDraftGeneration: generation }
    const open = new Function(...Object.keys(deps), `return ${closure('const openReferencedRequirement =', 'const openPrivateDraft =')}`)(...Object.values(deps))
    expect(open({ originRef: 'juyiting:file', sourceRef: { sourceType: 'FILE', sourceId: 'f1' }, targetAgentId: 'private-agent', inputs: [{ fileId: 'f1', version: '7' }] })).to.equal(true)
    expect(panels).to.deep.equal(['formalDraft']); expect(context.value).to.deep.equal({ originRef: 'juyiting:file', instruction: '', inputs: [{ fileId: 'f1', version: '7' }] })
    open({ originRef: 'juyiting:archive', instruction: '明确引用的段落', inputs: [] })
    expect(context.value.instruction).to.equal('明确引用的段落'); expect(generation.value).to.equal(2)
    expect(page.match(/@start-draft="openReferencedRequirement"/g)).to.have.length(2)
  })
  it('library citations open a draft, not public chat, and respect a blocked leave', () => {
    let context, toast = 0
    const library = useHallLibrary({ chatApi: {}, log: {}, openRequirement: value => { context = value; return true }, playSuccess: () => {}, showToast: () => toast++ })
    expect(library.citeLibraryItem({ id: 'cite-1', content: '案卷摘录' })).to.equal(true)
    expect(context).to.deep.equal({ originRef: 'juyiting:library', instruction: '参看典籍阁案卷：案卷摘录', inputs: [] })
    const blocked = useHallLibrary({ chatApi: {}, log: {}, openRequirement: () => false, playSuccess: () => { throw Error('unexpected') }, showToast: () => toast++ })
    expect(blocked.citeLibraryItem({ content: '不应丢失现有草稿' })).to.equal(false); expect(toast).to.equal(1)
  })
  it('compiles all changed page templates and keeps download confined to independent preview', () => {
    for (const name of ['HallOverview', 'HallMaterialPicker', 'HallDraftEditor', 'BountyPanel', 'HallOnboarding', 'HallMessageMedia', 'HallMessageParts']) {
      const filename = `src/components/juyiting/${name}.vue`, source = readFileSync(filename, 'utf8')
      const { descriptor, errors } = parse(source, { filename }); expect(errors).to.deep.equal([])
      const script = compileScript(descriptor, { id: name })
      expect(compileTemplate({ source: descriptor.template.content, filename, id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors).to.deep.equal([])
    }
    const media = readFileSync('src/components/juyiting/HallMessageMedia.vue', 'utf8')
    expect(media).not.to.include('@click="download">下载</button>')
    expect(media).to.include('aria-label="关闭预览"')
    expect(media).not.to.include('media-preview-download')
    expect(media).not.to.include('@click="download"')
    expect(media).to.include('controlslist="nodownload"')
  })
})
