import { outputItemKey } from './bountyOutputCatalog.js'

// Select by persisted source identity, never by MIME, arrival order, or latest version.
export function selectedOutput (item) {
  const common = { requestId: item.requestId, sha256: item.sha256,
    title: (item.title || item.outputId || '文字成果').slice(0, 255), purpose: '用户选定的验收成果' }
  return item.messageSource ? { ...common, messageSource: { ...item.messageSource } }
    : { ...common, stepId: item.stepId, outputId: item.outputId }
}
export const selectionKey = outputItemKey
export function batchMatchesSelection (batch, selection) {
  const items = batch?.items?.filter(item => item.displayRole === 'RESULT') || []
  if (!selection?.length || items.length !== selection.length || new Set(selection.map(selectionKey)).size !== selection.length) return false
  return selection.every(selected => items.some(item => {
    const source = item.source
    if (item.unavailableReason || item.contentHash !== selected.sha256 || source?.requestId !== selected.requestId) return false
    if (selected.messageSource) return source.kind === 'COMPLETED_MESSAGE' &&
      ['turnId', 'messageId', 'snapshotId', 'finalSha256'].every(key => source.messageSource?.[key] === selected.messageSource[key])
    return source.kind === 'CONVERSATION_OUTPUT' && source.stepId === selected.stepId && source.outputId === selected.outputId
  }))
}
