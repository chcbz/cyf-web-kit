import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { mount } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'
import { typedOutcomeProjection, inspectionOutcomeProjection } from '../src/composables/juyiting/hallTypedDeliberation.js'
import { useHallTypedDeliberation } from '../src/composables/juyiting/useHallTypedDeliberation.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/juyiting/action-final-projection-v3.json', import.meta.url)))
const clone = value => JSON.parse(JSON.stringify(value))
const action = () => clone(fixture.chatAction)
const context = { conversationId: '42', conversationGeneration: '1', taskId: 'task', requestId: 'request', requestRevision: '1', turnId: 'turn', assignmentRevision: '3', targetAgentId: 'agent' }
const digest = char => `sha256:${char.repeat(64)}`
const card = () => {
  const source = readFileSync(new URL('../src/components/juyiting/BountyTypedOutcomeCard.vue', import.meta.url), 'utf8')
  const descriptor = parse(source).descriptor
  const code = compileScript(descriptor, { id: 'action-outcome-card', inlineTemplate: true }).content
    .replace(/import\s*\{([^}]+)\}\s*from\s*["']vue["'];?/g, (_, bindings) => `const {${bindings.replace(/\s+as\s+/g, ':')}} = Vue`)
    .replace('export default', 'return')
  return new Function('Vue', code)(Vue)
}

describe('ordinary v3 Agent outcome projection', () => {
  it('reads the same exact projection vector as the Java final service without converting it to an image proposal', () => {
    const actual = typedOutcomeProjection(action(), context)
    expect(actual).to.deep.equal({ ...fixture.chatAction, purpose: 'CHAT' })
    expect(actual.outcome.action.actionId).to.equal('write-document')
    expect(actual.outcome).not.to.have.property('proposal')
    expect(inspectionOutcomeProjection(action(), context)).to.equal(null)
  })

  it('renders full multiline document answers instead of enforcing the old image instruction limit', () => {
    const value = action(); value.outcome.kind = 'ANSWER'; value.outcome.action = null
    value.outcome.text = `说明\n${'内容'.repeat(3000)}\n完成🌏`
    expect(typedOutcomeProjection(value, context).outcome.text).to.equal(value.outcome.text)
    value.outcome.text = '\ud800'
    expect(typedOutcomeProjection(value, context)).to.equal(null)
  })

  it('rejects foreign lifecycle, request, task, assignment, union extras and invented browser authority', () => {
    for (const key of ['conversationId', 'conversationGeneration', 'requestId', 'requestRevision', 'turnId']) {
      expect(typedOutcomeProjection(action(), { ...context, [key]: '2' }), key).to.equal(null)
    }
    for (const key of ['taskId', 'assignmentRevision']) {
      const value = action(); value.outcome[key] = 'other'
      expect(typedOutcomeProjection(value, context), key).to.equal(null)
    }
    const extra = action(); extra.outcome.action.grant = true
    expect(typedOutcomeProjection(extra, context)).to.equal(null)
    const legacy = action(); legacy.outcome.kind = 'EXECUTION_PROPOSAL'
    expect(typedOutcomeProjection(legacy, context)).to.equal(null)
    const injected = action(); injected.outcome.proposal = null
    expect(typedOutcomeProjection(injected, context)).to.equal(null)
  })

  it('accepts natural clarification and only valid open or answered question versions', () => {
    const value = action(); value.outcome.kind = 'CLARIFY'; value.outcome.action = null
    value.outcome.clarification = { pendingQuestionId: 'question', state: 'OPEN', stateVersion: '0', question: '用于哪里？', requiredFacts: ['用途'], replyRequestId: null }
    expect(typedOutcomeProjection(value, context).outcome.clarification.requiredFacts).to.deep.equal(['用途'])
    value.outcome.clarification.stateVersion = '1'
    expect(typedOutcomeProjection(value, context)).to.equal(null)
    Object.assign(value.outcome.clarification, { state: 'ANSWERED', replyRequestId: 'reply' })
    expect(typedOutcomeProjection(value, context).outcome.clarification.replyRequestId).to.equal('reply')
    value.outcome.clarification.requiredFacts.push('用途')
    expect(typedOutcomeProjection(value, context)).to.equal(null)
  })

  it('keeps the exact mixed-input receipt on inspection reads and never claims pending material was read', () => {
    const value = action(); value.route = 'INSPECT'; value.outcome.kind = 'ANSWER'; value.outcome.action = null
    value.inspection = { authorizationId: 'inspection', manifestDigest: digest('a'), sourceRefIds: ['source-text', 'source-audio'],
      inputSummary: { inputDigest: digest('b'), sources: [
        { sourceRefId: 'source-text', sha256: 'a'.repeat(64), byteLength: '9007199254740993', carrier: 'DIRECT_TEXT', contributionDigest: digest('c') },
        { sourceRefId: 'source-audio', sha256: 'b'.repeat(64), byteLength: '12', carrier: 'LOCAL_AUDIO', contributionDigest: digest('d') }
      ] } }
    expect(inspectionOutcomeProjection(value, context).purpose).to.equal('INSPECT')
    expect(typedOutcomeProjection(value, context)).to.equal(null)
    value.inspection.inputSummary.sources.reverse()
    expect(inspectionOutcomeProjection(value, context)).to.equal(null)
    value.state = 'PENDING'; value.outcome = null
    expect(inspectionOutcomeProjection(value, context)).to.equal(null)
    value.inspection.inputSummary = null
    expect(inspectionOutcomeProjection(value, context).state).to.equal('PENDING')
  })

  it('supports all 32 selected materials and rejects duplicate or extra references', () => {
    const value = action(); value.outcome.action.sourceRefIds = Array.from({ length: 32 }, (_, i) => `source-${i}`)
    expect(typedOutcomeProjection(value, context).outcome.action.sourceRefIds).to.have.length(32)
    value.outcome.action.sourceRefIds.push('source-32')
    expect(typedOutcomeProjection(value, context)).to.equal(null)
    value.outcome.action.sourceRefIds = ['source-0', 'source-0']
    expect(typedOutcomeProjection(value, context)).to.equal(null)
  })

  it('hydrates and refreshes actions with GET only and rejects rewriting an immutable final', async () => {
    let value = action(); let gets = 0; let posts = 0; let proposals = 0
    const lane = useHallTypedDeliberation({ chatApi: { get: async () => { gets++; return { data: { data: clone(value) } } }, create: async () => { posts++ } },
      actorScopeKey: Vue.ref('owner'), authorizationGeneration: Vue.ref(1), getContext: () => context, getContextGeneration: () => 1,
      getCatalogEntries: () => [], enabled: () => true, onProposal: () => { proposals++ } })
    try {
      await lane.readOne('request'); await lane.readOne('request')
      expect(lane.cards.value).to.have.length(1)
      expect(lane.cards.value[0].outcome.kind).to.equal('ACTION_REQUEST')
      value.outcome.text = 'forged same digest'
      await lane.readOne('request')
      expect(lane.cards.value[0].outcome.text).to.equal('处理中')
      expect(gets).to.equal(3); expect(posts).to.equal(0); expect(proposals).to.equal(0)
    } finally { lane.dispose() }
  })

  it('shows a simple processing card, not another confirmation or tool panel', () => {
    const wrapper = mount(card(), { props: { projection: typedOutcomeProjection(action(), context) } })
    try {
      expect(wrapper.text()).to.include('正在处理')
      expect(wrapper.findAll('button')).to.have.length(0)
      for (const internal of ['write-document', 'ACTION_REQUEST', '受控', 'Provider', 'START', '整理文档']) expect(wrapper.text()).not.to.include(internal)
    } finally { wrapper.unmount() }
  })
})
