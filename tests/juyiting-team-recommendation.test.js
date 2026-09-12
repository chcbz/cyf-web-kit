import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { createApi } from '../src/composables/useHttp.js'
import { useHallTeamRecommendation } from '../src/composables/juyiting/useHallTeamRecommendation.js'

const deferred = () => {
  let resolve
  const promise = new Promise(value => { resolve = value })
  return { promise, resolve }
}
const ok = data => ({ data: { data } })
const failure = status => Object.assign(new Error(`HTTP error! status: ${status}`), { status })
const task = (overrides = {}) => ({ id: 'task-1', riskLevel: 'high', reviewRequired: true, maxAgents: 3, ...overrides })
const preview = (taskId = 'task-1') => ({
  taskId, taskVersion: '8', requiredAbilities: ['plan', 'verify'], coveredAbilities: ['plan', 'verify'], missingAbilities: [],
  requestedMaxTeamSize: 3, taskMaxAgents: 3, maxTeamSize: 3, budgetUnits: 3, totalCostUnits: 2,
  costModel: 'NON_MONETARY_TEAM_SLOT', monetaryCostKnown: false, riskLevel: 'high', highRisk: true,
  taskReviewRequired: true, independentReviewerRequired: true, independentReviewerSatisfied: true,
  constraintsSatisfied: true, readyForConfirmation: true, previewOnly: true, autoDispatchAllowed: false,
  blockingReasons: [], autoDispatchReasons: ['TEAM_PREVIEW_ONLY'], duplicateCandidateAgentIds: [],
  members: [
    { agentId: 'agent-a', name: '甲', role: 'PRODUCER', score: 90, matchedAbilities: ['plan'], marginalCoveredAbilities: ['plan'], costUnits: 1, reason: '覆盖计划' },
    { agentId: 'agent-r', name: '乙', role: 'REVIEWER', score: 80, matchedAbilities: ['verify'], marginalCoveredAbilities: ['verify'], costUnits: 1, reason: '独立复核' }
  ],
  candidates: [
    { agentId: 'agent-a', name: '甲', score: 90, roles: ['PRODUCER'], matchedAbilities: ['plan'], eligible: true, exclusionReasons: [], selected: true, selectionRole: 'PRODUCER', costUnits: 1, reason: '覆盖计划' },
    { agentId: 'agent-r', name: '乙', score: 80, roles: ['REVIEWER'], matchedAbilities: ['verify'], eligible: true, exclusionReasons: [], selected: true, selectionRole: 'REVIEWER', costUnits: 1, reason: '独立复核' },
    { agentId: 'agent-b', name: '丙', score: 70, roles: ['PRODUCER'], matchedAbilities: ['plan'], eligible: true, exclusionReasons: [], selected: false, selectionRole: null, costUnits: 1, reason: '人工替换候选' },
    { agentId: 'agent-x', name: '丁', score: 10, roles: [], matchedAbilities: [], eligible: false, exclusionReasons: ['OFFLINE'], selected: false, selectionRole: null, costUnits: 1, reason: '不可用' }
  ]
})
const fixture = ({ currentTask = ref(task()), identity = ref(1), api } = {}) =>
  useHallTeamRecommendation({ task: currentTask, authorizationGeneration: identity, api })

describe('E07 team recommendation preview client', () => {
  it('uses the real createApi/useHttp boundary with JWT auth and the frozen request body', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    try {
      globalThis.fetch = async (url, options) => {
        requests.push({ url: String(url), method: options.method, body: JSON.parse(options.body), headers: options.headers })
        return new Response(JSON.stringify(preview()), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const api = createApi('/agent')
      const plan = fixture({ api: { execute: options => api.execute({ ...options, authStore: { authorizationGeneration: 1, token: async () => 'team-token' } }) } })
      plan.maxTeamSize.value = 3
      plan.budgetUnits.value = 3
      await plan.request()
      expect(requests).to.have.length(1)
      expect(requests[0].url).to.equal('/agent/tasks/task-1/team-recommendation')
      expect(requests[0].method).to.equal('POST')
      expect(requests[0].headers).to.include({ Authorization: 'Bearer team-token' })
      expect(requests[0].body).to.deep.equal({ maxTeamSize: 3, budgetUnits: 3, highRisk: true, independentReviewerRequired: true })
    } finally { globalThis.fetch = originalFetch }
  })

  it('keeps the product reviewer while allowing a local-only explicit producer override', async () => {
    const plan = fixture({ api: { execute: async () => ok(preview()) } })
    plan.maxTeamSize.value = 3; plan.budgetUnits.value = 3
    await plan.request()
    const producer = plan.preview.value.candidates[0]
    const reviewer = plan.preview.value.candidates[1]
    const replacement = plan.preview.value.candidates[2]
    expect(plan.toggleCandidate(reviewer)).to.equal(false)
    expect(plan.toggleCandidate(producer)).to.equal(true)
    expect(plan.toggleCandidate(replacement)).to.equal(true)
    expect(plan.localMembers.value.map(member => member.agentId)).to.deep.equal(['agent-r', 'agent-b'])
    expect(plan.localOverride.value).to.equal(true)
    expect(plan.localConstraintsSatisfied.value).to.equal(true)
  })

  it('keeps an unsatisfied product reviewer visible as a preview gap instead of fabricating confirmation', async () => {
    const unavailableReviewer = preview()
    unavailableReviewer.members = [unavailableReviewer.members[0]]
    unavailableReviewer.independentReviewerSatisfied = false
    unavailableReviewer.constraintsSatisfied = false
    unavailableReviewer.readyForConfirmation = false
    unavailableReviewer.blockingReasons = ['INDEPENDENT_REVIEWER_UNAVAILABLE']
    unavailableReviewer.candidates[1] = { ...unavailableReviewer.candidates[1], eligible: false, selected: false, selectionRole: null, exclusionReasons: ['OFFLINE'] }
    const plan = fixture({ api: { execute: async () => ok(unavailableReviewer) } })
    await plan.request()
    expect(plan.preview.value?.blockingReasons).to.deep.equal(['INDEPENDENT_REVIEWER_UNAVAILABLE'])
    expect(plan.localConstraintsSatisfied.value).to.equal(false)
  })

  it('clears and aborts the preview on task or authorization scope changes, ignoring a late reply', async () => {
    const currentTask = ref(task())
    const identity = ref(1)
    const pending = deferred()
    const plan = fixture({ currentTask, identity, api: { execute: async () => pending.promise } })
    const request = plan.request()
    currentTask.value = task({ id: 'task-2', riskLevel: 'low', reviewRequired: false })
    pending.resolve(ok(preview('task-1')))
    expect(await request).to.equal(null)
    expect(plan.preview.value).to.equal(null)
    expect(plan.state.value).to.equal('idle')

    const loaded = fixture({ currentTask, identity, api: { execute: async () => ok({ ...preview('task-2'), highRisk: false, riskLevel: 'low', taskReviewRequired: false, independentReviewerRequired: false, members: [preview().members[0]], candidates: preview().candidates.map((candidate, index) => ({ ...candidate, selected: index === 0, selectionRole: index === 0 ? 'PRODUCER' : null })) }) } })
    await loaded.request()
    expect(loaded.preview.value?.taskId).to.equal('task-2')
    identity.value = 2
    expect(loaded.preview.value).to.equal(null)
  })

  it('fails closed for missing authoritative task data and 404/403/409 without claiming success', async () => {
    const missing = fixture({ currentTask: ref({ id: 'task-1', riskLevel: 'high' }), api: { execute: async () => { throw new Error('must not call') } } })
    await missing.request()
    expect(missing.message.value).to.include('不能代猜')
    for (const status of [404, 403, 409]) {
      const plan = fixture({ api: { execute: async () => { throw failure(status) } } })
      await plan.request()
      expect(plan.preview.value).to.equal(null)
      expect(plan.state.value).to.equal('error')
      expect(plan.message.value).to.not.equal('')
    }
  })

  it('states preview-only/manual boundaries and does not call assignment or dispatch endpoints', async () => {
    const source = readFileSync(new URL('../src/composables/juyiting/useHallTeamRecommendation.js', import.meta.url), 'utf8')
    const panel = readFileSync(new URL('../src/components/juyiting/TeamRecommendationPanel.vue', import.meta.url), 'utf8')
    expect(source).to.include('url: `/tasks/${encodeURIComponent(capturedTaskId)}/team-recommendation`')
    expect(source).to.include('previewOnly === true')
    expect(source).to.include('autoDispatchAllowed === false')
    expect(panel).to.include('尚无服务端最终团队确认 API')
    expect(panel).to.include('不会后台批量 assign')
    expect(panel).to.include('产品 reviewer 角色必须保留')
  })
})
