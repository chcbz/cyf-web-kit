import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { ref } from 'vue'
import { useHallPointAndStartControlledBridge } from '../src/composables/juyiting/useHallPointAndStartControlledBridge.js'
import { useHallPointAndStart } from '../src/composables/juyiting/useHallPointAndStart.js'
import { createPointAndStartIntentStore } from '../src/composables/juyiting/hallPointAndStartIntent.js'
import { providerConsentAcknowledgement } from '../src/composables/juyiting/hallPointAndStartProviderConsent.js'
import { pointAndStartRecoveryLane } from '../src/composables/juyiting/hallPointAndStartRecoveryLane.js'
const require = createRequire(import.meta.url)
const { parse } = require('@vue/compiler-sfc')
const babel = require('@babel/parser')
const fixture = JSON.parse(readFileSync(new URL('./fixtures/controlled-image-bridge-v1.json', import.meta.url)))
const copy = value => JSON.parse(JSON.stringify(value))
const handler = name => { const { descriptor } = parse(readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')); const script = descriptor.scriptSetup.content; const ast = babel.parse(script, { sourceType: 'module' }); const node = ast.program.body.flatMap(item => item.declarations || []).find(item => item.id.name === name); return script.slice(node.init.start, node.init.end) }
describe('actual JuyiHall controlled issuer-only recovery handlers', () => {
  it('uses controlled check then exact controlled resume, with no native capability or ordinary core route', async () => {
    const scope = ref('tenant\u0000client\u0000owner'); const taskId = 'task_fixture_1'; const values = new Map(); const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; const calls = []
    const api = { get: async path => { calls.push(['GET', path]); if (path.endsWith('/requirements/current')) return { data: { taskId, taskVersion: '6', requirementRevision: '3' } }; if (path === `/tasks/${taskId}`) return { data: { id: taskId, taskVersion: '6', status: 'open' } }; if (path.endsWith('cost-consents/request')) return { data: { ...copy(fixture.wire.wrapper_receipt.providerConsent), state: 'ISSUED', version: '1' } }; throw Object.assign(new Error('absent'), { status: 404 }) }, create: async path => { calls.push(['POST', path]); if (path.endsWith('cost-consents')) throw new Error('ACK lost'); return { data: copy(fixture.wire.wrapper_receipt) } } }
    const controlled = useHallPointAndStartControlledBridge({ agentApi: api, actorScopeKey: scope, storage, keys: { createAssignmentKey: () => 'fixture_assignment_key', createIssueKey: () => 'fixture_issue_key' } }); controlled.selectContext({ taskId, targetAgentId: 'agent_fixture_1' }); const ordinary = useHallPointAndStart({ agentApi: api, actorScopeKey: scope, storage })
    await controlled.start({ task: { id: taskId }, agent: { agentId: 'agent_fixture_1' }, requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE', providerBinding: { bindingId: 'fixture_binding', bindingEpoch: '1' }, acknowledgement: providerConsentAcknowledgement })
    const deps = { pointAndStartRecoveryLane, pointAndStartIntentState: id => createPointAndStartIntentStore({ storage, scope: scope.value, taskId: id }).read(), checkControlledBridgeOriginal: controlled.checkOriginal, checkPointAndStart: ordinary.checkOriginal, pointAndStartState: ordinary.state, showToast: () => {}, explainPointAndStartState: () => '', resumeControlledBridgeOriginal: controlled.resumeOriginal, pointAndStartObservation: { capture: () => ({ isCurrent: () => true }) }, readPointAndStartCapability: async () => { calls.push(['NATIVE_CAPABILITY_GET']); return null }, canReplayPointAndStartOriginal: () => false, resumePointAndStart: ordinary.resumeOriginal }
    const make = name => new Function(...Object.keys(deps), `return (${handler(name)})`)(...Object.values(deps)); const check = make('checkPointAndStartOriginal'); deps.checkPointAndStartOriginal = check; const resume = make('resumePointAndStartOriginal')
    calls.length = 0; expect(await check({ id: taskId })).to.equal(true); expect(calls).to.deep.equal([['GET', `/tasks/${taskId}/point-and-start-cost-consents/request`]])
    calls.length = 0; expect(await resume({ id: taskId })).to.equal(true); expect(calls).to.deep.equal([['GET', `/tasks/${taskId}/point-and-start-controlled-image/request`], ['POST', `/tasks/${taskId}/point-and-start-controlled-image`]]); expect(ordinary.state.value.status).to.equal('IDLE'); controlled.dispose(); ordinary.dispose()
  })
})
