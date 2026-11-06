// Explicit empty server context for unrelated outcome/recovery tests. This helper
// never infers choices from the catalog. Choice scenarios supply server items.
import { useHallTypedDeliberation as useActual } from '../../../src/composables/juyiting/useHallTypedDeliberation.js'
export const contextPage = (context, items = [], pendingExecution = false) => ({
  schemaVersion: 1, scope: { conversationId: context.conversationId, conversationGeneration: context.conversationGeneration, taskId: context.taskId },
  assignmentRevision: context.assignmentRevision, targetAgentId: context.targetAgentId,
  items, pendingExecution, hasMore: false, nextBeforeMessageId: null, nextBeforeOutcomeId: null
})
export const serverChoice = value => ({ outcomeId: value.outcome.outcomeId, requestId: value.requestId,
  assistantMessageId: value.outcome.assistantMessageId, finalSha256: value.outcome.finalSha256, kind: value.outcome.kind, label: '当前成果' })
export const useHallTypedDeliberation = ({ serverDeliveryContext, ...options }) => useActual({ ...options,
  chatApi: { ...options.chatApi, get: (path, params, request) => path.endsWith('/delivery-context')
    ? Promise.resolve(serverDeliveryContext ? serverDeliveryContext(params) : contextPage(options.getContext()))
    : options.chatApi.get(path, params, request) }
})
