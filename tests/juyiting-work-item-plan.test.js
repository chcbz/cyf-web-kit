import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { createApi } from '../src/composables/useHttp.js'
import { useHallWorkItemPlan } from '../src/composables/juyiting/useHallWorkItemPlan.js'

const deferred = () => {
  let resolve
  const promise = new Promise(value => { resolve = value })
  return { promise, resolve }
}
const suggested = (taskId = 'task-1') => ({
  taskId, sourcePlanId: 'opaque-source-id', sourcePlanDigest: 'a'.repeat(64), expectedTaskVersion: '7',
  confirmationRequired: true, confirmed: false,
  items: [{ itemKey: 'item-1', title: '拆解', description: '说明', workType: 'implementation', requiredAbilities: ['plan'], priority: 0, requiredItem: true, dependsOn: [], maxAttempts: 3 }]
})
const ok = data => ({ data: { data } })
const error = (status, code = '') => Object.assign(new Error(code || `HTTP error! status: ${status}`), { status, code })
const fixture = ({ task = ref({ id: 'task-1', coordinatorAgentId: 'agent-a' }), actor = ref('agent-a'), enabled = ref(true), api, key = () => 'plan-key-0001' } = {}) =>
  useHallWorkItemPlan({ task, actorAgentId: actor, enabled, api, createIdempotencyKey: key })

describe('E03 manual work item plan client', () => {
  it('keeps the panel explicit-actor only and outside existing assignment/recommendation paths', () => {
    const source = readFileSync(new URL('../src/composables/juyiting/useHallWorkItemPlan.js', import.meta.url), 'utf8')
    const panel = readFileSync(new URL('../src/components/juyiting/WorkItemPlanPanel.vue', import.meta.url), 'utf8')
    expect(source).to.include('params: { actorAgentId: actor.value }')
    expect(source).not.to.include('selectedAgent')
    expect(source).not.to.match(/auto-assign|dispatch|\/assign/)
    expect(panel).to.include('coordinatorAgentId')
    expect(panel).not.to.include('v-html')
  })
  it('uses the real createApi/useHttp boundary with explicit task and actor query, body, and idempotency header', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    try {
      globalThis.fetch = async (url, options) => {
        requests.push({ url: String(url), method: options.method, body: JSON.parse(options.body), headers: options.headers })
        const isConfirm = String(url).includes('/confirm')
        const data = isConfirm ? { ...suggested(), confirmed: true, items: [{ ...suggested().items[0], workItemId: 'work-1', status: 'pending' }] } : suggested()
        return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const api = createApi('/agent')
      const authStore = { authorizationGeneration: 1, token: async () => 'plan-token' }
      const plan = fixture({ api: { execute: options => api.execute({ ...options, authStore }) } })
      plan.objective.value = '先分析，再验证'
      await plan.suggest()
      await plan.confirm()
      expect(requests).to.have.length(2)
      expect(requests[0].url).to.equal('/agent/tasks/task-1/work-item-plans/suggest?actorAgentId=agent-a')
      expect(requests[0].body).to.deep.equal({ objective: '先分析，再验证', maxItems: 4, dependencyMode: 'sequential' })
      expect(requests[1].url).to.equal('/agent/tasks/task-1/work-item-plans/confirm?actorAgentId=agent-a')
      expect(requests[1].headers).to.include({ Authorization: 'Bearer plan-token', 'Idempotency-Key': 'plan-key-0001' })
      expect(requests[1].body).to.include({ confirmed: true, sourcePlanId: 'opaque-source-id', sourcePlanDigest: 'a'.repeat(64), expectedTaskVersion: '7' })
      expect(plan.confirmedItems.value[0]).to.include({ workItemId: 'work-1', status: 'pending' })
    } finally { globalThis.fetch = originalFetch }
  })

  it('edits allowed fields, reuses the key only for an unchanged retry, and never dispatches or assigns', async () => {
    const calls = []
    let confirmAttempts = 0
    const api = { execute: async call => {
      calls.push(call)
      if (call.url.includes('/suggest')) return ok(suggested())
      confirmAttempts += 1
      if (confirmAttempts === 1) throw error(503, 'WORK_ITEM_PLAN_UNAVAILABLE')
      return ok({ ...suggested(), confirmed: true, items: [{ ...suggested().items[0], workItemId: 'work-1', status: 'pending' }] })
    } }
    let key = 0
    const plan = fixture({ api, key: () => `plan-key-${++key}-0000` })
    plan.objective.value = '目标'
    await plan.suggest()
    plan.items.value[0].title = '人工修改标题'
    plan.items.value[0].dependsOn = []
    await plan.confirm()
    expect(plan.confirmedItems.value).to.deep.equal([])
    await plan.confirm()
    expect(calls.filter(call => call.url.includes('/confirm')).map(call => call.headers['Idempotency-Key'])).to.deep.equal(['plan-key-1-0000', 'plan-key-1-0000'])
    plan.items.value[0].description = '内容变了'
    await plan.confirm()
    expect(calls.filter(call => call.url.includes('/confirm')).at(-1).headers['Idempotency-Key']).to.equal('plan-key-2-0000')
    expect(calls.every(call => !/assign|dispatch|auto-assign/.test(call.url))).to.equal(true)
  })

  it('fails closed for disabled/missing actor, 404 and CAS 409 without claiming success', async () => {
    const disabled = fixture({ api: { execute: async () => { throw new Error('must not call') } }, enabled: ref(false) })
    await disabled.suggest()
    expect(disabled.message.value).to.include('尚未在此环境启用')
    const missingActor = fixture({ api: { execute: async () => { throw new Error('must not call') } }, actor: ref('') })
    await missingActor.suggest()
    expect(missingActor.message.value).to.include('明确协调者')
    const plan = fixture({ api: { execute: async call => call.url.includes('/suggest') ? ok(suggested()) : Promise.reject(error(404, 'WORK_ITEM_PLAN_NOT_FOUND')) } })
    plan.objective.value = '目标'; await plan.suggest(); await plan.confirm()
    expect(plan.message.value).to.include('暂不可用')
    const forbiddenPlan = fixture({ api: { execute: async call => call.url.includes('/suggest') ? ok(suggested()) : Promise.reject(error(403, 'WORK_ITEM_PLAN_FORBIDDEN')) } })
    forbiddenPlan.objective.value = '目标'; await forbiddenPlan.suggest(); await forbiddenPlan.confirm()
    expect(forbiddenPlan.message.value).to.include('暂不可用')
    const stalePlan = fixture({ api: { execute: async call => call.url.includes('/suggest') ? ok(suggested()) : Promise.reject(error(409, 'WORK_ITEM_PLAN_STALE')) } })
    stalePlan.objective.value = '目标'; await stalePlan.suggest(); await stalePlan.confirm()
    expect(stalePlan.stale.value).to.equal(true)
    expect(stalePlan.confirmedItems.value).to.deep.equal([])
  })

  it('aborts and ignores a late response when explicit task or actor changes', async () => {
    const task = ref({ id: 'task-1', coordinatorAgentId: 'agent-a' })
    const actor = ref('agent-a')
    const pending = deferred()
    const plan = fixture({ task, actor, api: { execute: async () => pending.promise } })
    plan.objective.value = '目标'
    const request = plan.suggest()
    task.value = { id: 'task-2', coordinatorAgentId: 'agent-b' }; actor.value = 'agent-b'
    pending.resolve(ok(suggested('task-1')))
    expect(await request).to.equal(null)
    expect(plan.suggestion.value).to.equal(null)
    expect(plan.items.value).to.deep.equal([])
  })
})
