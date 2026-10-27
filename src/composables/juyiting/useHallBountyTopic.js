import { ref, unref, watch } from 'vue'
import { pointAndStartLong } from './hallPointAndStartIntent.js'

const read = value => unref(typeof value === 'function' ? value() : value)
const newKey = () => globalThis.crypto?.randomUUID?.() || ''
const receiptMatches = (value, context) => value &&
  value.sourceConversationId === context.conversationId &&
  value.sourceConversationGeneration === context.conversationGeneration &&
  value.taskId === context.taskId && value.targetAgentId === context.targetAgentId &&
  typeof value.conversationId === 'string' && pointAndStartLong(value.conversationId) &&
  value.conversationId !== context.conversationId && pointAndStartLong(value.conversationGeneration)

// Empty-topic creation only. Never sends a message, changes a grant or retries an execution.
export const useHallBountyTopic = ({ chatApi, identityScope, authorizationGeneration, getContext,
  storage, adopt, makeKey = newKey }) => {
  const busy = ref(false); const error = ref('')
  let disposed = false; let controller = null; let operationEpoch = 0
  const snapshot = () => ({ identity: read(identityScope), authorization: read(authorizationGeneration), ...getContext() })
  const stopScopeWatch = watch(() => {
    const context = snapshot()
    return JSON.stringify([context.identity, context.authorization, context.taskId, context.targetAgentId, context.mode])
  }, () => {
    operationEpoch++; controller?.abort(); controller = null; busy.value = false; error.value = ''
  }, { flush: 'sync' })
  const open = async () => {
    if (disposed || busy.value) return false
    const context = snapshot()
    if (!context.identity || !context.taskId || !context.targetAgentId ||
      !pointAndStartLong(context.conversationId) || !pointAndStartLong(context.conversationGeneration)) {
      error.value = '原事项话头尚未加载完成，未创建新话头。'; return false
    }
    const epoch = ++operationEpoch
    const stamp = JSON.stringify(context)
    const current = () => !disposed && epoch === operationEpoch && stamp === JSON.stringify(snapshot())
    const recordKey = `cyf.bounty-topic:${encodeURIComponent(JSON.stringify([context.identity,
      context.taskId, context.conversationId, context.conversationGeneration, context.targetAgentId]))}`
    busy.value = true; error.value = ''; controller = new AbortController()
    try {
      // Persist before POST, so refresh/response loss cannot silently mint a second topic.
      let operation = storage?.getItem(recordKey) || ''
      const existing = Boolean(operation)
      if (!operation) {
        operation = makeKey()
        if (!operation || !storage) throw new Error('TOPIC_KEY_UNAVAILABLE')
        storage.setItem(recordKey, operation)
        if (storage.getItem(recordKey) !== operation) throw new Error('TOPIC_KEY_UNAVAILABLE')
      }
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(operation)) throw new Error('TOPIC_KEY_INVALID')
      const path = `/conversations/${encodeURIComponent(context.conversationId)}/topics`
      const options = { autoLoading: false, needAuth: true, signal: controller.signal }
      let receipt; let missing = !existing
      if (existing) {
        try { receipt = await chatApi.get(`${path}/${encodeURIComponent(operation)}`, undefined, options) }
        catch (cause) { if (cause?.status !== 404) throw cause; missing = true }
        if (!current()) return false
      }
      if (missing) {
        receipt = await chatApi.create(path, { expectedConversationGeneration: context.conversationGeneration },
          { ...options, headers: { 'Idempotency-Key': operation } })
      }
      if (!current()) return false
      if (!receiptMatches(receipt, context)) throw new Error('TOPIC_RECEIPT_MISMATCH')
      if (!await adopt(receipt, current)) {
        if (current()) error.value = '新话头已创建，暂未载入；原记录保留，再点“另起话头”核对同一结果。'
        return false
      }
      // Adoption deliberately changes the conversation; do not apply the old-context fence here.
      storage.removeItem(recordKey)
      return true
    } catch {
      if (current()) error.value = '尚未确认新话头，原记录和草稿保留；再次点击会核对同一次创建。'
      return false
    } finally { if (epoch === operationEpoch) { busy.value = false; controller = null } }
  }
  return { busy, error, open, dispose: () => { disposed = true; operationEpoch++; stopScopeWatch(); controller?.abort(); controller = null; busy.value = false } }
}

// History is authenticated by the existing conversation loader; do not fabricate a
// row from the POST receipt or clear the old draft while history is unavailable.
export const createHallBountyTopicAdopter = ({ loadHistory, history, select, conversationId, identity, taskId, mode }) =>
  async (receipt, current) => {
    const owner = read(identity), task = read(taskId), scope = read(mode)
    const sameScope = () => owner === read(identity) && task === read(taskId) && scope === read(mode)
    await loadHistory()
    if (!current() || !sameScope() || !read(history).some(row => row.id === receipt.conversationId)) return false
    await select(receipt.conversationId)
    // Selection saves the old draft before switching. A content-load error then
    // belongs to this confirmed topic's existing retry UI, not another creation.
    return sameScope() && read(conversationId) === receipt.conversationId
  }
