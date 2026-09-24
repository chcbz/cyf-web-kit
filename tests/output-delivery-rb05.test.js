import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { nextTick, ref } from 'vue'
import { outputCacheKey, useOutputs } from '../src/composables/useOutputs.js'
import { safeOutputFilename, saveOutputBlob } from '../src/utils/outputDownload.js'

const tick = async () => { await Promise.resolve(); await nextTick(); await Promise.resolve() }
const item = overrides => ({
  artifactId: 'artifact-1', artifactVersion: 1, taskId: 'task-1', workItemId: 'work-item-1', producerAgentId: 'agent-1',
  title: '报告.md', artifactType: 'report', visibility: 'OWNER', createdAt: 1,
  contentMimeType: 'text/markdown', contentByteLength: 12, contentHash: 'a'.repeat(64), ...overrides
})

describe('RB05 output directory boundary', () => {
  it('keys each directory by identity plus source and never calls a legacy actor endpoint', async () => {
    const source = ref({ type: 'task', id: 'task-1' })
    const identity = ref('user-a:client-a:1')
    const calls = []
    const adapter = {
      async list (request) { calls.push(request); return { items: [item()], nextCursor: null } },
      async download () { throw new Error('not needed') }, async preview () { throw new Error('not needed') }
    }
    const outputs = useOutputs({ source, identityFingerprint: identity, adapter })
    await tick()
    expect(outputCacheKey(identity.value, source.value)).to.equal('user-a:client-a:1\u0000task\u0000task-1')
    expect(calls).to.have.length(1)
    expect(calls[0]).to.include({ sourceType: 'task', sourceId: 'task-1', cursor: null, limit: 20 })
    expect(calls[0]).not.to.have.property('actorAgentId')
    expect(outputs.items.value).to.have.length(1)
  })

  it('aborts and fences an old identity/source response before it can populate the new directory', async () => {
    const source = ref({ type: 'task', id: 'task-old' })
    const identity = ref('user-a:client-a:1')
    let resolveOld
    const adapter = {
      list: ({ sourceId }) => sourceId === 'task-old'
        ? new Promise(resolve => { resolveOld = resolve })
        : Promise.resolve({ items: [item({ artifactId: 'artifact-new', taskId: 'task-new', title: '新成果' })] }),
      async download () {}, async preview () {}
    }
    const outputs = useOutputs({ source, identityFingerprint: identity, adapter })
    await tick()
    source.value = { type: 'task', id: 'task-new' }
    identity.value = 'user-b:client-b:2'
    await tick()
    resolveOld({ items: [item({ artifactId: 'artifact-old', title: '旧成果' })] })
    await tick()
    expect(outputs.cacheKey.value).to.equal('user-b:client-b:2\u0000task\u0000task-new')
    expect(outputs.items.value.map(value => value.artifactId)).to.deep.equal(['artifact-new'])
  })

  it('keeps forbidden and uncertain directory states distinct from an empty directory', async () => {
    const source = ref({ type: 'task', id: 'task-1' })
    const forbidden = useOutputs({ source, identityFingerprint: ref('user-a'), adapter: { async list () { throw Object.assign(new Error('forbidden'), { status: 403 }) } } })
    await tick()
    expect(forbidden.state.value).to.equal('forbidden')
    expect(forbidden.message.value).to.equal('无访问权限。')
    const uncertain = useOutputs({ source, identityFingerprint: ref('user-b'), adapter: { async list () { throw new TypeError('network unavailable') } } })
    await tick()
    expect(uncertain.state.value).to.equal('unavailable')
    expect(uncertain.message.value).to.not.equal('暂无可领取成果。')
  })

  it('reads an authenticated conversation directory and renders a confirmed empty response', async () => {
    const calls = []
    const outputs = useOutputs({
      source: ref({ type: 'conversation', id: 'conversation-1' }), identityFingerprint: ref('user-a'),
      adapter: {
        async list (request) { calls.push(request); return { items: [], nextCursor: null } },
        async download () { throw new Error('not needed') }, async preview () { throw new Error('not needed') }
      }
    })
    await tick()
    expect(calls).to.have.length(1)
    expect(calls[0]).to.include({ sourceType: 'conversation', sourceId: 'conversation-1', cursor: null, limit: 20 })
    expect(outputs.state.value).to.equal('empty')
    expect(outputs.items.value).to.deep.equal([])
    expect(outputs.message.value).to.equal('暂无可领取成果。')
  })

  it('asks the injected adapter for only the selected artifact version', async () => {
    const calls = []
    const outputs = useOutputs({
      source: ref({ type: 'task', id: 'task-1' }), identityFingerprint: ref('user-a'),
      adapter: { async list () { return { items: [item({ artifactVersion: 2 })] } }, async download (request) { calls.push(request); return new Blob(['v2']) }, async preview () {} }
    })
    await tick()
    await outputs.download(outputs.items.value[0])
    expect(calls).to.deep.equal([{
      sourceType: 'task', sourceId: 'task-1', taskId: 'task-1',
      artifactId: 'artifact-1', artifactVersion: '2', fileId: null, fileVersion: null, contentMimeType: 'text/markdown', signal: undefined
    }])
  })

  it('uses the authenticated task deliverables routes without legacy actor parameters', () => {
    const composable = readFileSync(new URL('../src/composables/useOutputs.js', import.meta.url), 'utf8')
    expect(composable).to.include('/tasks/${encodeURIComponent(sourceId)}/deliverables')
    expect(composable).to.include("responseType: 'blob'")
    expect(composable).to.not.include('actorAgentId')
  })

  it('keeps deliverable management out of the bounty detail and routes users to the compact Babao entry', () => {
    const outputs = readFileSync(new URL('../src/components/outputs/OutputList.vue', import.meta.url), 'utf8')
    const bounty = readFileSync(new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url), 'utf8')
    const chat = readFileSync(new URL('../src/components/chat/Chat.vue', import.meta.url), 'utf8')
    expect(outputs).to.not.include('type="file"')
    expect(outputs).to.not.include('v-html')
    expect(outputs).to.include("outputs.state.value === 'available' && outputs.items.value.length")
    expect(bounty).to.not.include('<OutputList')
    expect(bounty).to.not.include('<FormalDeliveryList')
    // W06 includes materials/execution controls, not inline delivery management.
    expect(bounty).to.include('<TaskMaterialLinks')
    expect(bounty).to.include('class="workspace-shortcut"')
    expect(bounty).to.include("$emit('open-workspace')")
    expect(chat).to.not.include('OutputList')
  })

  it('downloads only the exact adapter-returned Blob and sanitizes the local filename', () => {
    expect(safeOutputFilename({ title: '../evil:\u0000name?.txt' })).to.equal('_evil__name_.txt')
    const clicks = []
    const anchor = { style: {}, remove () {}, click () { clicks.push(this.download) } }
    const documentRef = { body: { appendChild () {} }, createElement: () => anchor }
    const urls = { createObjectURL: blob => { expect(blob).to.be.instanceOf(Blob); return 'blob:exact' }, revokeObjectURL: href => expect(href).to.equal('blob:exact') }
    saveOutputBlob({ blob: new Blob(['exact version']), item: { title: '成果-v2.txt' }, documentRef, urlApi: urls })
    expect(clicks).to.deep.equal(['成果-v2.txt'])
  })
})
