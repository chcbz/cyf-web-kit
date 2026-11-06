import { expect } from 'chai'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useHallBountyAcceptance } from '../src/composables/juyiting/useHallBountyAcceptance.js'

describe('original-conversation discovery no longer owns an outcome event subscription', () => {
  for (const completed of [false, true]) it(`needs no SSE, outcome scan or retry timer (terminal=${completed})`, async () => {
    const events = ref(null); const version = ref('1'); const enabled = ref(true)
    let discoveries = 0; let requests = 0; let connections = 0
    const source = useHallBountyAcceptance({ taskId: () => 'task', identityKey: () => 'owner', enabled: () => enabled.value,
      taskCompleted: () => completed, stateVersion: () => version.value,
      eventSource: () => ({ sharedEvent: () => events.value, connect: () => { connections++ } }),
      api: { list: async () => { discoveries++; return { items: [{ id: '42', conversationType: 'juyiting', conversationScopeType: 'bounty', conversationScopeKey: 'task:task' }] } },
        get: () => { requests++ } } })
    try {
      await flushPromises()
      events.value = { type: 'agent_message', conversationId: '42' }; version.value = '2'
      await flushPromises()
      expect(discoveries).to.equal(1); expect(requests).to.equal(0); expect(connections).to.equal(0)
      expect(source.catalog.entries.value).to.deep.equal([])
      enabled.value = false; await flushPromises(); expect(source.scope.value).to.equal(null)
      enabled.value = true; await flushPromises(); expect(discoveries).to.equal(2)
      expect(requests).to.equal(0); expect(connections).to.equal(0)
    } finally { source.dispose() }
  })
})
