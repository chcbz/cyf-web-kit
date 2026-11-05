import test from 'node:test'
import assert from 'node:assert/strict'
import { isWenMoney, formatWenMoney } from '../src/utils/wenAmount.js'
import { assessReadOnlyPreviewCapabilities } from '../src/utils/economyReadOnlyPreviewPolicy.js'

test('Money preserves Long precision and rejects old scalar/wrong currency without legacy scaling', () => {
  const max = { amountMinor: '9223372036854775807', currency: 'WEN' }
  assert.equal(isWenMoney(max), true)
  assert.equal(isWenMoney({ ...max, note: 'harmless additive field' }), true)
  assert.equal(formatWenMoney(max), '9223372036854775807文')
  for (const value of ['100', 100, { ...max, amountMinor: '9223372036854775808' },
    { ...max, amountMinor: '01' }, { ...max, amountMinor: 100 }, { ...max, currency: 'USD' }, { currency: 'WEN', amountWen: '1' }]) {
    assert.equal(isWenMoney(value), false); assert.throws(() => formatWenMoney(value))
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
