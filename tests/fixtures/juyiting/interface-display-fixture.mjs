// Project immutable historical test facts into the one current display DTO.
// This is test fixture construction, never a browser legacy-wire adapter.
export const displayFixture = old => {
  const value = structuredClone(old), version = value.schemaVersion
  value.schemaVersion = 5; value.route = value.route || (version === 2 ? 'INSPECT' : 'CHAT')
  delete value.contract; value.inspection ??= null; value.actionProgress ??= null
  const rename = (item, before, after) => { if (Object.hasOwn(item, before)) { item[after] = item[before] === null ? null : item[before].replace(/^sha256:/, ''); delete item[before] } }
  const o = value.outcome
  if (o) {
    o.outcomeContractVersion ??= version
    for (const key of ['clarification', 'proposal', 'action', 'deliverable', 'messageSource', 'deliveryRelation']) o[key] ??= null
    rename(o, 'finalDigest', 'finalSha256')
    if (o.messageSource) rename(o.messageSource, 'finalDigest', 'finalSha256')
    if (o.action) o.action.parameters ??= null
    if (o.deliveryRelation) {
      rename(o.deliveryRelation, 'parentFinalDigest', 'parentFinalSha256'); rename(o.deliveryRelation, 'targetFinalDigest', 'targetFinalSha256')
      o.deliveryRelation.targetOutcomeId ??= null; o.deliveryRelation.targetFinalSha256 ??= null
    }
  }
  if (value.inspection) {
    rename(value.inspection, 'manifestDigest', 'manifestSha256')
    if (value.inspection.inputSummary) {
      rename(value.inspection.inputSummary, 'inputDigest', 'inputSha256')
      value.inspection.inputSummary.sources.forEach(s => rename(s, 'contributionDigest', 'contributionSha256'))
    }
  }
  if (value.actionProgress) {
    for (const key of ['executionId', 'executionStateVersion', 'phase', 'resultSha256']) value.actionProgress[key] ??= null
    rename(value.actionProgress, 'resultDigest', 'resultSha256')
  }
  return value
}

// Convert captured DTO fixtures, not canonical embedded model/snapshot bytes.
export const displayFixtures = value => {
  if (Array.isArray(value)) return value.map(displayFixtures)
  if (!value || typeof value !== 'object') return value
  if ([1, 2, 3, 4].includes(value.schemaVersion) && Object.hasOwn(value, 'outcome') && value.requestId && value.conversationId) return displayFixture(value)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    const renamed = ({ finalDigest: 'finalSha256', parentFinalDigest: 'parentFinalSha256', targetFinalDigest: 'targetFinalSha256' })[key]
    return [renamed || key, renamed && typeof child === 'string' ? child.replace(/^sha256:/, '') : displayFixtures(child)]
  }))
}
