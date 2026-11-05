import { expect } from 'chai'
import { effectScope, ref } from 'vue'
import { useHallCampaignGrant } from '../src/composables/juyiting/useHallCampaignGrant.js'

const flush = async () => { await Promise.resolve(); await Promise.resolve() }
const receipt = { grants: [{ campaignRef: 'beta', transactionId: 'tx1', status: 'POSTED', amount: { amountMinor: '3500', currency: 'WEN' } }] }
const create = (post, initial = 'identity-a') => {
  const identity = ref(initial), epoch = ref(1), scope = effectScope(), errors = []
  const grant = scope.run(() => useHallCampaignGrant({ economyApi: { create: post },
    identityScope: identity, authorizationGeneration: () => epoch.value, onError: e => errors.push(e) }))
  return { identity, epoch, scope, grant, errors }
}

describe('hall campaign business event', () => {
  it('waits for authenticated identity, sends only event and leaves the page unblocked', async () => {
    const calls = [], h = create(async (...args) => { calls.push(args); return receipt }, '')
    expect(calls).to.have.length(0)
    h.identity.value = 'identity-a'
    await flush()
    expect(calls).to.have.length(1)
    expect(calls[0][0]).to.equal('/events')
    expect(calls[0][1]).to.deep.equal({ event: 'HALL_ENTERED' })
    expect(calls[0][2].autoLoading).to.equal(false)
    expect(h.grant.status.value).to.equal('confirmed')
    h.scope.stop()
  })
  it('retains unconfirmed failure and permits an idempotent retry without a registration check', async () => {
    let attempts = 0
    const h = create(async () => { if (++attempts === 1) throw Error('offline'); return receipt })
    await flush()
    expect(h.grant.status.value).to.equal('unconfirmed')
    expect(h.errors).to.have.length(1)
    expect(await h.grant.retry()).to.equal(true)
    expect(attempts).to.equal(2)
    h.scope.stop()
  })
  it('ignores late results and cancels transport on identity changes and disposal', async () => {
    const calls = [], h = create((url, body, options) => new Promise(resolve => calls.push({ options, resolve })))
    h.identity.value = 'identity-b'
    expect(calls).to.have.length(2)
    expect(calls[0].options.signal.aborted).to.equal(true)
    calls[0].resolve(receipt); await flush()
    expect(h.grant.status.value).to.equal('pending')
    h.scope.stop()
    expect(calls[1].options.signal.aborted).to.equal(true)
    calls[1].resolve(receipt); await flush()
    expect(h.grant.status.value).to.equal('pending')
  })
  it('treats disabled/expired/no-match campaigns as a successful empty receipt', async () => {
    const h = create(async () => ({ grants: [] }))
    await flush(); expect(h.grant.status.value).to.equal('confirmed'); h.scope.stop()
  })
  it('does not accept an old currency or a malformed receipt as granted', async () => {
    const h = create(async () => ({ grants: [{ ...receipt.grants[0], amount: { amountMinor: '3500', currency: 'SILVER' } }] }))
    await flush(); expect(h.grant.status.value).to.equal('unconfirmed'); h.scope.stop()
  })
})
