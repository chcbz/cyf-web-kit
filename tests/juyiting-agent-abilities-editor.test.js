import { expect } from 'chai'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { normalizeAbilityDraft, useHallAgentAbilitiesEditor } from '../src/composables/juyiting/useHallAgentAbilitiesEditor.js'

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const setup = () => {
  const agent = ref({ agentId: 'a', boundToMe: true, systemAgent: false })
  const identity = ref('owner1'); const visible = ref(true)
  const projection = ref({ agentId: 'a', abilities: ['old'] })
  const reads = []; const writes = []
  const profile = { projection, loading: ref(false), error: ref(''), refresh: async () => {
    const read = deferred(); reads.push(read); const value = await read.promise
    if (value) projection.value = value
    return Boolean(value)
  } }
  const api = { put: (url, data, options) => { const write = { ...deferred(), url, data, options }; writes.push(write); return write.promise } }
  const editor = useHallAgentAbilitiesEditor({ api, profile, getAgent: () => agent.value, identityKey: () => identity.value, enabled: () => visible.value })
  return { agent, identity, visible, profile, reads, writes, editor }
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

describe('user-maintained Agent abilities editor', () => {
  it('normalizes blank/duplicate lines and compiles actual panel and hall templates', function () {
    this.timeout(10000)
    expect(normalizeAbilityDraft(' research \n\nRESEARCH\r\n分析')).to.deep.equal(['research', '分析'])
    for (const relative of ['src/components/juyiting/AgentPanel.vue', 'src/components/world/JuyiHall.vue']) {
      const { descriptor, errors } = parse(readFileSync(new URL('../' + relative, import.meta.url), 'utf8'))
      expect(errors).to.deep.equal([])
      const script = compileScript(descriptor, { id: relative })
      expect(compileTemplate({ id: relative, source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } }).errors).to.deep.equal([])
    }
  })
  it('cancel never writes; nonowner, system and hidden agents cannot edit', () => {
    const t = setup()
    try {
      t.editor.begin(); t.editor.draft.value = 'draft'; t.editor.cancel(); expect(t.writes).to.have.length(0)
      for (const patch of [{ boundToMe: false }, { boundToMe: true, systemAgent: true }]) {
        t.agent.value = { ...t.agent.value, ...patch }; t.editor.begin(); expect(t.editor.editing.value).to.equal(false)
      }
      t.agent.value = { agentId: 'a', boundToMe: true, systemAgent: false }; t.visible.value = false
      t.editor.begin(); expect(t.editor.editing.value).to.equal(false)
    } finally { t.editor.dispose() }
  })
  it('saves an empty list once and requires authoritative read before closing', async () => {
    const t = setup()
    try {
      t.editor.begin(); t.editor.draft.value = '\n'
      const done = t.editor.save(); await t.editor.save(); expect(t.writes).to.have.length(1)
      expect(t.writes[0].url).to.equal('/a/abilities'); expect(t.writes[0].data).to.deep.equal({ expectedAbilities: ['old'], abilities: [] })
      t.writes[0].resolve({ agentId: 'a', abilities: [] }); await settle()
      expect(t.editor.editing.value).to.equal(true)
      t.reads[0].resolve({ agentId: 'a', abilities: [] }); await done
      expect(t.editor.editing.value).to.equal(false); expect(t.editor.message.value).to.include('已保存')
    } finally { t.editor.dispose() }
  })
  it('conflict preserves draft, blocks retries, and lets explicit reread rebase without writing', async () => {
    const t = setup()
    try {
      t.editor.begin(); t.editor.draft.value = 'mine'
      const done = t.editor.save(); t.writes[0].reject({ code: 'AGENT_ABILITIES_CONFLICT', status: 409 }); await done
      expect(t.editor.draft.value).to.equal('mine'); expect(t.editor.needsCheck.value).to.equal(true)
      await t.editor.save(); expect(t.writes).to.have.length(1)
      const check = t.editor.checkLatest(); t.reads[0].resolve({ agentId: 'a', abilities: ['theirs'] }); await check
      expect(t.editor.draft.value).to.equal('mine'); expect(t.editor.needsCheck.value).to.equal(false)
      const again = t.editor.save(); expect(t.writes[1].data.expectedAbilities).to.deep.equal(['theirs'])
      t.writes[1].reject({ status: 400 }); await again
    } finally { t.editor.dispose() }
  })
  it('unknown results do not replay; matching reread confirms the requested final state', async () => {
    const t = setup()
    try {
      t.editor.begin(); t.editor.draft.value = 'mine'
      const done = t.editor.save(); t.writes[0].reject(new Error('network')); await done
      await t.editor.save(); expect(t.writes).to.have.length(1)
      const check = t.editor.checkLatest(); t.reads[0].resolve({ agentId: 'a', abilities: ['mine'] }); await check
      expect(t.editor.editing.value).to.equal(false); expect(t.writes).to.have.length(1)
    } finally { t.editor.dispose() }
  })
  it('does not discard a newer draft while checking an unknown write', async () => {
    const t = setup()
    try {
      t.editor.begin(); t.editor.draft.value = 'sent'
      const done = t.editor.save(); t.writes[0].reject(new Error('network')); await done
      t.editor.draft.value = 'newer draft'
      const check = t.editor.checkLatest(); t.reads[0].resolve({ agentId: 'a', abilities: ['sent'] }); await check
      expect(t.editor.editing.value).to.equal(true); expect(t.editor.draft.value).to.equal('newer draft')
      expect(t.editor.needsCheck.value).to.equal(false); expect(t.writes).to.have.length(1)
    } finally { t.editor.dispose() }
  })
  it('failed read after success retains draft and does not silently claim completion', async () => {
    const t = setup()
    try {
      t.editor.begin(); t.editor.draft.value = 'mine'
      const done = t.editor.save(); t.writes[0].resolve({ agentId: 'a', abilities: ['mine'] }); await settle()
      t.reads[0].resolve(false); await done
      expect(t.editor.editing.value).to.equal(true); expect(t.editor.needsCheck.value).to.equal(true); expect(t.editor.draft.value).to.equal('mine')
    } finally { t.editor.dispose() }
  })
  it('identity/selection changes abort writes and ignore late replies without refreshing another profile', async () => {
    const t = setup()
    try {
      t.editor.begin(); t.editor.draft.value = 'mine'; const done = t.editor.save()
      t.identity.value = 'owner2'; expect(t.writes[0].options.signal.aborted).to.equal(true)
      t.writes[0].resolve({ agentId: 'a', abilities: ['mine'] }); await done
      expect(t.reads).to.have.length(0); expect(t.editor.editing.value).to.equal(false); expect(t.editor.draft.value).to.equal('')
    } finally { t.editor.dispose() }
  })
})
