import assert from 'node:assert/strict'
import { assigneeSummary, assigneePage } from '../src/composables/juyiting/hallAssigneeCandidates.js'
import { skillCapabilityProjection, skillCostInfo } from '../src/composables/juyiting/hallSkillCapabilities.js'
import { agentProfileCapabilitiesProjection } from '../src/composables/juyiting/useHallAgentProfileCapabilities.js'
import { assessCommandObservabilityCapability } from '../src/utils/commandObservabilityPolicy.js'
const assignee = { agentId: 'a', displayName: '吴用', providerDisplayName: null, isMine: true, availability: 'online' }
it('assignee read additions are ignored without changing ID or pagination checks', () => {
  assert.deepEqual(assigneeSummary({ ...assignee, token: 'not forwarded' }), assignee)
  assert.deepEqual(assigneePage({ items: [{ ...assignee, trace: true }], nextAfterAgentId: null, total: '1' }), { items: [assignee], nextAfterAgentId: null })
  assert.equal(assigneePage({ items: [assignee], nextAfterAgentId: 'different' }), null)
  assert.equal(assigneeSummary({ ...assignee, agentId: null }), null)
})
it('skill read additions do not hide callable skills or grant a new action', () => {
  const item = { skillKey: 'image-edit', skillVersion: '1', title: '改图', state: 'CALLABLE', reasonCode: null, costInfo: { mode: 'UNKNOWN' } }
  const expected = { catalogRevision: '1', items: [item] }
  assert.deepEqual(skillCapabilityProjection({ ...expected, token: 'secret', items: [{ ...item, canBuy: true }] }), expected)
  assert.deepEqual(skillCostInfo({ mode: 'FREE', endpoint: 'ignored' }), { mode: 'FREE' })
  assert.equal(skillCapabilityProjection({ ...expected, items: [{ ...item, state: 'UNKNOWN_STATE' }] }), null)
})
it('profile read ignores additions at every display layer but keeps agent and readiness checks', () => {
  const item = { skillKey: 'image-edit', skillVersion: '1', title: '改图', installationVerified: true, runtimeState: 'RUNTIME_READY', reasonCode: null }
  const expected = { agentId: 'a', observedAt: 1, lastSeenAt: null, abilities: [], skills: { status: 'AVAILABLE', catalogRevision: '1', reasonCode: null, items: [item] } }
  assert.deepEqual(agentProfileCapabilitiesProjection({ ...expected, token: 'secret', skills: { ...expected.skills, nextCursor: null, items: [{ ...item, endpoint: 'ignored' }] } }, 'a'), expected)
  assert.equal(agentProfileCapabilitiesProjection(expected, 'b'), null)
  assert.equal(agentProfileCapabilitiesProjection({ ...expected, observedAt: NaN }, 'a'), null)
})
it('observability ignores display metadata without granting write capability', () => {
  const value = { contractVersion: 'command-observability-v1', available: true, readOnly: true, reason: null }
  assert.deepEqual(assessCommandObservabilityCapability({ ...value, trace: 'next' }).capability, value)
  assert.equal(assessCommandObservabilityCapability({ ...value, readOnly: false }).available, false)
})

import { readFileSync } from 'node:fs'
import { decodeHttpResponse } from '../src/utils/apiEnvelope.js'
import { decodeMessage, eventMessage } from '../src/utils/messageEnvelope.js'
import { readEconomyCapability } from '../src/utils/economyPreviewCapability.js'
const envelopeFixture = JSON.parse(readFileSync(new URL('./fixtures/interface-standard/http-envelope-fixtures.json', import.meta.url)))
for (const item of envelopeFixture.cases) {
  it(`HTTP compatibility: ${item.name}`, () => {
    const run = () => decodeHttpResponse(item.text, { status: item.status, requestId: item.requestId, responseRequestId: item.requestId })
    if (item.valid) assert.deepEqual(run().value, JSON.parse(item.text).data)
    else assert.throws(run, error => error.code === item.errorCode && error.status === item.status)
  })
}
it('message metadata is not a routing or authorization override', () => {
  const known = eventMessage('r', 'agent.register', 'm', null)
  assert.deepEqual(decodeMessage(JSON.stringify({ ...known, trace: 'next', type: 'admin.delete' })), known)
  const { messageType, ...missing } = known
  assert.throws(() => decodeMessage(JSON.stringify({ ...missing, type: messageType })))
})
it('economy capability ignores additions without inventing write capability or a scope', () => {
  const value = { economyPreviewEnabled: true, skillMarketplaceEnabled: false, principalScopeSha256: 'a'.repeat(64) }
  assert.deepEqual(readEconomyCapability({ ...value, mayPurchase: true }), value)
  assert.equal(readEconomyCapability({ ...value, principalScopeSha256: null }), null)
})
