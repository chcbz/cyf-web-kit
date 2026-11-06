import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { isTerminalMatter } from '../src/composables/juyiting/useHallOrdinaryCancellation.js'
const source = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const start = source.indexOf('const refreshFollowupContext = async event => {')
const end = source.indexOf('// Historical pages only enrich display', start)
const compile = mocks => new Function(...Object.keys(mocks), source.slice(start, end) + '\nreturn refreshFollowupContext')(...Object.values(mocks))
describe('history is not executable assignment admission', () => {
  for (const status of ['completed', 'archived', 'cancelled', 'failed']) {
    it(`reads ${status} without requesting active assignment context or delivery choices`, async () => {
      const calls = []
      const refresh = compile({ typedDeliberationEnabled: { value: true }, conversationId: { value: 'c' },
        conversationTask: { value: { status } }, isTerminalMatter, refreshCurrentConversationTask: async () => true,
        refreshHallMessagePage: async () => { calls.push('page'); return true },
        bountyAssignmentContext: { refresh: () => { throw new Error('no executable context for history') } },
        typedDeliberation: { refreshDeliveryChoices: () => { throw new Error('no execution choices for history') } } })
      expect(await refresh()).to.equal(true)
      expect(calls).to.deep.equal([])
      expect(await refresh({ type: 'request_final' })).to.equal(true)
      expect(calls).to.deep.equal(['page'])
    })
  }
  it('still refreshes assignment and choices for active work', async () => {
    const calls = []
    const refresh = compile({ typedDeliberationEnabled: { value: true }, conversationId: { value: 'c' },
      conversationTask: { value: { status: 'running' } }, isTerminalMatter, followupContextGeneration: { value: 1 },
      refreshCurrentConversationTask: async () => true,
      bountyAssignmentContext: { refresh: async () => { calls.push('assignment'); return true } },
      typedDeliberation: { refreshDeliveryChoices: async () => { calls.push('choices'); return true } } })
    expect(await refresh()).to.equal(true)
    expect(calls).to.deep.equal(['assignment', 'choices'])
  })
})
