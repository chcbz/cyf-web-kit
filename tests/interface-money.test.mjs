import test from 'node:test'
import assert from 'node:assert/strict'
import { isSilverMoney, formatSilverMoney } from '../src/utils/silverAmount.js'
import { assessReadOnlyPreviewCapabilities } from '../src/utils/economyReadOnlyPreviewPolicy.js'

test('Money preserves Long precision and rejects old scalar/wrong currency/extra aliases', () => {
  const max = { amountMinor: '9223372036854775807', currency: 'SILVER' }
  assert.equal(isSilverMoney(max), true)
  assert.equal(formatSilverMoney(max), '9223372036854.775807 SILVER')
  for (const value of ['100', 100, { ...max, amountMinor: '9223372036854775808' },
    { ...max, amountMinor: '01' }, { ...max, amountMinor: 100 }, { ...max, currency: 'USD' }, { ...max, amountMicro: '1' }]) {
    assert.equal(isSilverMoney(value), false); assert.throws(() => formatSilverMoney(value))
  }
})
test('readonly capability requires version2 and renamed exact SHA, no mutations granted', () => {
  const value = { contractVersion: 'economy-readonly-v2', mode: 'READ_ONLY_PREVIEW', enabled: true,
    principalScopeSha256: 'a'.repeat(64), features: { wallet: true, ledger: true, catalog: true, installationStatus: true, hostingPlan: true, hostingLease: true },
    actions: { estimate: true, issue: false, purchase: false, settle: false, refund: false, install: false, hostingActivate: false, hostingRenew: false } }
  assert.equal(assessReadOnlyPreviewCapabilities(value).available, true)
  assert.equal(assessReadOnlyPreviewCapabilities({ ...value, contractVersion: 'economy-readonly-v1' }).available, false)
  assert.equal(assessReadOnlyPreviewCapabilities({ ...value, principalScopeSha256: 'invalid' }).available, false)
  assert.equal(assessReadOnlyPreviewCapabilities({ ...value, actions: { ...value.actions, purchase: true } }).available, false)
})
