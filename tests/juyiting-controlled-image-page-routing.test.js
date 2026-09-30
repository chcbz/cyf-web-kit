import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { nextTick, reactive, ref, watch } from 'vue'
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

describe('actual JuyiHall controlled bootstrap observation fence', () => {
  it('adopts PREPARING→ADMITTED in the original context but fences late admitted projections after target, authorization, or revision changes', async function () { this.timeout(12000)
    const { descriptor } = parse(readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8'))
    const script = descriptor.scriptSetup.content; const ast = babel.parse(script, { sourceType: 'module' }); const declarations = ast.program.body.flatMap(node => node.declarations || [])
    const declaration = name => { const node = declarations.find(node => node.id?.name === name); return script.slice(node.start, node.end) }
    const bridgeCall = declarations.find(node => node.init?.callee?.name === 'useHallPointAndStartControlledBridge')
    const onBound = script.slice(bridgeCall.init.arguments[0].properties.find(node => node.key.name === 'onBound').value.start, bridgeCall.init.arguments[0].properties.find(node => node.key.name === 'onBound').value.end)
    const actualCheck = declaration('checkPointAndStartOriginal')
    const lifecycle = ast.program.body.filter(node => node.type === 'ExpressionStatement' && node.expression?.callee?.name === 'watch')
      .map(node => script.slice(node.expression.start, node.expression.end)).filter(code => code.includes('[selectedTask.value?.id, selectedTask.value?.taskVersion') || code.includes('watch([() => apiStore.authorizationGeneration, hallIdentityScope, () => selectedAgent.value?.agentId]'))
    expect(lifecycle).to.have.length(2)
    const preparing = { schemaVersion: 1, taskId: 'task_fixture_1', targetAgentId: 'agent_fixture_1', requirementRevision: '3', assignmentRevision: '7', taskVersion: '7', grantId: 'grant_fixture_1', grantVersion: '1', grantState: 'ACTIVE', permittedOperations: ['GENERATE_IMAGE'], inputs: [], bootstrapId: 'bootstrap_fixture_1', bootstrapState: 'PENDING', stateVersion: '1', initialOperation: 'GENERATE_IMAGE', conversationId: null, initialRequestId: null, currentAssignment: true }
    const admitted = { ...preparing, bootstrapState: 'ADMITTED', stateVersion: '2', conversationId: '9007199254740993', initialRequestId: 'initial_fixture_1' }
    const scenario = async invalidation => {
      const scope = ref('tenant\u0000client\u0000owner'); const apiStore = reactive({ authorizationGeneration: 1 }); const selectedTask = ref({ id: 'task_fixture_1', taskVersion: '6', requirementRevision: '3' }); const selectedAgent = ref({ agentId: 'agent_fixture_1' }); const tasks = ref([selectedTask.value]); const operableRosterAgents = ref([{ agentId: 'agent_fixture_1' }, { agentId: 'agent_new' }]); const storageValues = new Map(); const storage = { getItem: key => storageValues.get(key) ?? null, setItem: (key, value) => storageValues.set(key, value) }; const calls = []; let reads = 0; let release; let secondRead; const secondReady = new Promise(resolve => { secondRead = resolve }); const secondValue = new Promise(resolve => { release = resolve }); let adopted = 0; let opened = 0
      const api = { get: async path => { calls.push(['GET', path]); if (path.endsWith('/requirements/current')) return { data: { taskId: 'task_fixture_1', taskVersion: '6', requirementRevision: '3' } }; if (path.endsWith('/assignment-operation')) { reads++; if (reads === 1) return { data: preparing }; secondRead(); return { data: await secondValue } }; if (path.endsWith('/point-and-start-controlled-image/request')) throw Object.assign(new Error('new controlled read unavailable'), { status: 503 }); if (path === '/tasks/task_fixture_1') return { data: reads >= 2 ? { id: 'task_fixture_1', taskVersion: '7', status: 'assigned', assignedAgentId: 'agent_fixture_1' } : { id: 'task_fixture_1', taskVersion: '6', status: 'open' } }; throw Error(path) }, create: async path => { calls.push(['POST', path]); return { data: path.endsWith('cost-consents') ? { ...copy(fixture.wire.wrapper_receipt.providerConsent), state: 'ISSUED', version: '1' } : copy(fixture.wire.wrapper_receipt) } } }
      let invalidateBridge = () => {}; const noopFence = { invalidate () {} }; let stopObservation = () => {}; let controlledCheck = async () => false; let ordinaryCheck = async () => false
      const page = new Function('ref', 'watch', 'hallIdentityScope', 'apiStore', 'pointAndStartObservation', 'controlledImageObservation', 'pointAndStartReferenceInputs', 'invalidateControlledBridge', 'stopPointAndStartObservation', 'pointAndStartCapability', 'controlledImageCapability', 'controlledConsentOffer', 'pointAndStartIntentState', 'pointAndStartRecoveryLane', 'checkControlledBridgeOriginal', 'checkPointAndStart', 'pointAndStartState', 'showToast', 'explainPointAndStartState', 'panelDisposed', 'operableRosterAgents', 'tasks', 'selectedTask', 'selectedAgent', 'openPanel', 'enterBountyDiscussion', 'nextTick', 'adoptBountyBootstrap', `${declaration('pointAndStartContextGeneration')}; ${declaration('admittedPointAndStartTaskFingerprint')}; ${declaration('pointAndStartTaskFingerprint')}; ${declaration('preserveAdmittedPointAndStartContext')}; ${declaration('clearPointAndStartCapability')}; ${declaration('attachAdmittedPointAndStart')}; ${actualCheck}; ${lifecycle.join(';')}; return { pointAndStartContextGeneration, clearPointAndStartCapability, attachAdmittedPointAndStart, checkPointAndStartOriginal }`)(ref, watch, scope, apiStore, noopFence, noopFence, noopFence, () => invalidateBridge(), () => stopObservation(), ref(null), ref(null), ref(null), id => createPointAndStartIntentStore({ storage, scope: scope.value, taskId: id }).read(), pointAndStartRecoveryLane, id => controlledCheck(id), id => ordinaryCheck(id), ref({ intent: null }), () => {}, () => '', false, operableRosterAgents, tasks, selectedTask, selectedAgent, () => { opened++; return true }, () => {}, nextTick, () => { adopted++; return true })
      const ordinary = useHallPointAndStart({ agentApi: api, actorScopeKey: scope, storage, getContextGeneration: () => page.pointAndStartContextGeneration.value, onAdmitted: page.attachAdmittedPointAndStart }); stopObservation = ordinary.stopObservation; ordinaryCheck = ordinary.checkOriginal
      const bound = new Function('observePointAndStart', `return (${onBound})`)(ordinary.observeOriginal)
      const controlled = useHallPointAndStartControlledBridge({ agentApi: api, actorScopeKey: scope, storage, keys: { createAssignmentKey: () => 'fixture_assignment_key', createIssueKey: () => 'fixture_issue_key' }, onBound: bound }); invalidateBridge = controlled.invalidate; controlledCheck = controlled.checkOriginal
      controlled.selectContext({ taskId: 'task_fixture_1', targetAgentId: 'agent_fixture_1' })
      expect(await controlled.start({ task: { id: 'task_fixture_1' }, agent: { agentId: 'agent_fixture_1' }, requestedOperations: ['GENERATE_IMAGE'], initialOperation: 'GENERATE_IMAGE', providerBinding: { bindingId: 'fixture_binding', bindingEpoch: '1' }, acknowledgement: providerConsentAcknowledgement })).to.equal(true)
      await secondReady
      if (invalidation === 'target') selectedAgent.value = { agentId: 'agent_new' }
      if (invalidation === 'authorization') apiStore.authorizationGeneration++
      if (invalidation === 'revision') selectedTask.value = { ...selectedTask.value, taskVersion: '7', requirementRevision: '4' }
      release(admitted); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
      const result = { contextGeneration: page.pointAndStartContextGeneration.value, controlledReadbacks: calls.filter(call => call[0] === 'GET' && call[1].endsWith('/point-and-start-controlled-image/request')).length, adopted, opened, status: ordinary.state.value.status, bridgePosts: calls.filter(call => call[0] === 'POST' && call[1].endsWith('controlled-image')).length, assignPosts: calls.filter(call => call[0] === 'POST' && call[1].endsWith('/assign')).length }
      controlled.dispose(); ordinary.dispose(); return result
    }
    const positive = await scenario(null); expect(positive).to.deep.include({ adopted: 1, opened: 1, status: 'ATTACHED', bridgePosts: 1, assignPosts: 0 })
    for (const invalidation of ['target', 'authorization', 'revision']) {
      const stale = await scenario(invalidation)
      expect(stale).to.deep.include({ contextGeneration: 1, controlledReadbacks: invalidation === 'revision' ? 1 : 0, adopted: 0, opened: 0, status: 'IDLE', bridgePosts: 1, assignPosts: 0 })
    }
  })
})
