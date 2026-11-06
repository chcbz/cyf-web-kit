import { expect } from 'chai'
import { createEconomyRequestIntentStore } from '../src/composables/juyiting/economyRequestIntent.js'

const memoryStorage = () => {
  const values = new Map()
  return { getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}

// The former funded-create/cancel mutation tests are retired with those APIs.
// Read-only recovery and no-replay are covered by funded-history-retirement.test.js.
describe('economy intent storage preserves historical evidence', () => {
  it('supports an empty namespace and preserves sibling operation records', () => {
    const storage = memoryStorage()
    const key = 'cyf.juyiting.economy-request-intent.v1.actor-a'
    storage.setItem(key, JSON.stringify({ schemaVersion: 1, records: {} }))
    const store = createEconomyRequestIntentStore({ storage, scopeKey: () => 'actor-a' })
    const alpha = { body: { title: 'alpha' }, key: 'alpha-key' }
    const beta = { body: { title: 'beta' }, key: 'beta-key' }
    expect(store.save('alpha', alpha)).to.include({ state: 'PRESENT' })
    expect(store.save('beta', beta)).to.include({ state: 'PRESENT' })
    expect(store.get('alpha').record).to.deep.equal(alpha)
    expect(store.get('beta').record).to.deep.equal(beta)
    expect(store.remove('alpha')).to.include({ state: 'ABSENT' })
    expect(store.save('alpha', alpha).record).to.deep.equal(alpha)
    expect(store.get('beta').record).to.deep.equal(beta)

  })
})
