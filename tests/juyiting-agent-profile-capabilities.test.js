import { expect } from 'chai'
import { ref, nextTick } from 'vue'
import { agentProfileCapabilitiesProjection as project, agentProfileReasonText, useHallAgentProfileCapabilities } from '../src/composables/juyiting/useHallAgentProfileCapabilities.js'

const item = () => ({ skillKey: 'image-edit', skillVersion: '1.0.0', title: '图片修改', installationVerified: true, runtimeState: 'RUNTIME_READY', reasonCode: null })
const fixture = (agentId = 'a') => ({ agentId, observedAt: 10000, abilities: ['内容管理'], lastSeenAt: null, skills: { status: 'AVAILABLE', catalogRevision: '999999999999999999999', reasonCode: null, items: [item()] } })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const settle = async () => { await Promise.resolve(); await nextTick(); await Promise.resolve() }

describe('Agent private profile safe field projection', () => {
  it('accepts exact DTO with huge decimal revision and immutable empty abilities', () => {
    const raw = fixture(); raw.abilities = []
    const result = project(raw, 'a')
    expect(result.abilities).to.deep.equal([]); expect(result.skills.catalogRevision).to.equal(raw.skills.catalogRevision)
    expect(Object.isFrozen(result.skills.items[0])).to.equal(true)
  })
  it('rejects wrong identity, unsafe times and impossible ready', () => {
    const changes = [raw => { raw.agentId = 'b' }, raw => { raw.observedAt = 9007199254740992 }, raw => { raw.skills.catalogRevision = '01' }, raw => { raw.skills.items[0].skillVersion = 1 }, raw => { raw.skills.items[0].installationVerified = false }, raw => { raw.skills.items.push(item()) }, raw => { raw.skills.items[0].reasonCode = 'UNAVAILABLE' }]
    for (const change of changes) { const raw = fixture(); change(raw); expect(project(raw, 'a')).to.equal(null) }
  })
  it('distinguishes partial failure, empty directory and unknown safe reason', () => {
    const raw = fixture(); raw.skills = { status: 'UNAVAILABLE', catalogRevision: null, reasonCode: 'SKILL_DESCRIPTOR_SOURCE_UNAVAILABLE', items: [] }
    expect(project(raw, 'a').skills.status).to.equal('UNAVAILABLE')
    raw.skills.status = 'AVAILABLE'; raw.skills.reasonCode = null
    expect(project(raw, 'a').skills.items).to.deep.equal([])
    expect(agentProfileReasonText('NEW_REASON')).to.equal('暂不可用（NEW_REASON）')
    expect(agentProfileReasonText('SKILL_RUNTIME_UNAVAILABLE')).to.equal('运行状态待核验')
  })
})

describe('Agent profile read lifecycle', () => {
  const setup = () => {
    const agent = ref({ agentId: 'a', boundToMe: true, systemAgent: false })
    const identity = ref('owner1'); const visible = ref(true); const calls = []
    const api = { get: (url, query, options) => { const call = { ...deferred(), url, query, options }; calls.push(call); return call.promise } }
    const profile = useHallAgentProfileCapabilities({ api, getAgent: () => agent.value, identityKey: () => identity.value, enabled: () => visible.value })
    return { agent, identity, visible, calls, profile }
  }
  it('aborts A and ignores every stale success/finally while B remains loading', async () => {
    const t = setup()
    try {
      t.agent.value = { ...t.agent.value, agentId: 'b' }
      expect(t.calls[0].options.signal.aborted).to.equal(true)
      t.calls[0].resolve(fixture('a')); await settle(); expect(t.profile.loading.value).to.equal(true); expect(t.profile.projection.value).to.equal(null)
      t.calls[1].resolve(fixture('b')); await settle(); expect(t.profile.projection.value.agentId).to.equal('b')
      expect(t.calls[1].url).to.equal('/b/profile-capabilities'); expect(t.calls[1].query).to.deep.equal({})
    } finally { t.profile.dispose() }
  })
  it('retracts old READY before refresh and does not turn failure into empty', async () => {
    const t = setup()
    try {
      t.calls[0].resolve(fixture()); await settle(); expect(t.profile.projection.value).not.to.equal(null)
      const done = t.profile.refresh(); expect(t.profile.projection.value).to.equal(null)
      t.calls[1].reject({ status: 503 }); await done
      expect(t.profile.error.value).to.include('读取失败'); expect(t.profile.projection.value).to.equal(null)
    } finally { t.profile.dispose() }
  })
  it('same ID object replacement does not request; identity and hide clear immediately', async () => {
    const t = setup()
    try {
      t.agent.value = { ...t.agent.value, name: 'new name' }; expect(t.calls).to.have.length(1)
      t.identity.value = 'owner2'; expect(t.calls).to.have.length(2)
      t.calls[0].reject({ status: 401 }); await settle(); expect(t.profile.error.value).to.equal('')
      t.visible.value = false; expect(t.calls[1].options.signal.aborted).to.equal(true)
      t.calls[1].resolve(fixture()); await settle(); expect(t.profile.projection.value).to.equal(null)
      t.visible.value = true; expect(t.calls).to.have.length(3)
    } finally { t.profile.dispose() }
  })
  it('nonowner/system never requests, offline/busy owner does, disposal never leaks', async () => {
    const t = setup()
    t.visible.value = false; t.agent.value = { agentId: 'b', boundToMe: false }; t.visible.value = true
    expect(t.calls).to.have.length(1)
    t.agent.value = { agentId: 'b', boundToMe: true, systemAgent: true }; expect(t.calls).to.have.length(1)
    t.agent.value = { agentId: 'b', boundToMe: true, systemAgent: false, status: 'offline' }; expect(t.calls).to.have.length(2)
    t.profile.dispose(); t.calls[1].resolve(fixture('b')); await settle(); expect(t.profile.projection.value).to.equal(null)
  })
  it('HTTP 401 and 404 retain distinct user states', async () => {
    const t = setup()
    try { t.calls[0].reject({ status: 401 }); await settle(); expect(t.profile.error.value).to.include('重新登录'); const done = t.profile.refresh(); t.calls[1].reject({ status: 404 }); await done; expect(t.profile.error.value).to.include('不可访问') } finally { t.profile.dispose() }
  })
})
