import { pointAndStartGrant } from './hallPointAndStartIntent.js'
import { providerConsentReceipt } from './hallPointAndStartProviderConsent.js'
const clone = value => JSON.parse(JSON.stringify(value))
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => own(value, key))
const exactId = value => typeof value === 'string' && value.length > 0 && value.trim() === value && [...value].every(char => { const p = char.codePointAt(0); return p >= 0x20 && p !== 0x7f && !(p >= 0x80 && p <= 0x9f) && !(p >= 0xd800 && p <= 0xdfff) })
const positiveLong = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 9223372036854775807n
export const controlledImagePointAndStartWrapper = (intent, receipt) => {
  if (!intent?.providerConsent || !receipt || receipt.state !== 'ISSUED' || !exactId(receipt.consentId) || !positiveLong(receipt.version)) return null
  return { schemaVersion: 1, assignment: clone(intent.body), providerConsent: { consentId: receipt.consentId, expectedVersion: receipt.version } }
}
/** Validates the frozen bridge response and only permits a BOUND monotone receipt. */
export const controlledImagePointAndStartReceipt = (value, intent, previous = null) => {
  const bridge = intent?.controlledImageBridge
  if (!fields(value, ['schemaVersion', 'grant', 'providerConsent']) || value.schemaVersion !== 1 || !bridge?.wrapper || !fields(bridge.wrapper, ['schemaVersion', 'assignment', 'providerConsent']) ||
    !equal(bridge.wrapper.assignment, intent.body) || bridge.wrapper.providerConsent.consentId !== intent.providerConsent?.receipt?.consentId ||
    !positiveLong(bridge.wrapper.providerConsent.expectedVersion)) return null
  const consent = providerConsentReceipt(value.providerConsent, intent, intent.providerConsent.receipt)
  const grant = pointAndStartGrant(value.grant, intent)
  if (!consent || !['BOUND', 'RESERVED', 'CONSUMED', 'REVOKED', 'EXPIRED'].includes(consent.state) || !grant || BigInt(consent.version) < BigInt(bridge.wrapper.providerConsent.expectedVersion)) return null
  if (previous && (!fields(previous, ['schemaVersion', 'grant', 'providerConsent']) || previous.schemaVersion !== 1 ||
    !equal(previous.grant, value.grant) || !positiveLong(previous.providerConsent?.version) ||
    BigInt(consent.version) < BigInt(previous.providerConsent.version))) return null
  return { schemaVersion: 1, grant: clone(value.grant), providerConsent: consent }
}
/** Browser-side immutable wrapper extension. Server durable mapping remains authoritative. */
export const controlledImageBridgeExtension = (value, intent, previous = null) => {
  const currentConsent = intent?.providerConsent?.receipt
  const wrapper = value?.wrapper
  if (!fields(value, ['schemaVersion', 'wrapper', 'receipt']) || value.schemaVersion !== 1 || !currentConsent ||
    !fields(wrapper, ['schemaVersion', 'assignment', 'providerConsent']) || wrapper.schemaVersion !== 1 ||
    !equal(wrapper.assignment, intent.body) || !fields(wrapper.providerConsent, ['consentId', 'expectedVersion']) ||
    wrapper.providerConsent.consentId !== currentConsent.consentId || !positiveLong(wrapper.providerConsent.expectedVersion) ||
    BigInt(wrapper.providerConsent.expectedVersion) > BigInt(currentConsent.version)) return null
  const receipt = value.receipt === null ? null : controlledImagePointAndStartReceipt(value.receipt, intent, previous?.receipt || null)
  if (value.receipt !== null && !receipt) return null
  if (previous && (!equal(previous.wrapper, value.wrapper) || (previous.receipt && !receipt))) return null
  return { schemaVersion: 1, wrapper: clone(value.wrapper), receipt: receipt ? clone(receipt) : null }
}
