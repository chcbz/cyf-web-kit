import { computed, ref, watch } from 'vue'
import {
  appendHallEventMessage as reduceHallEventMessage,
  appendStreamPayload,
  hasResolvedAgentReply,
  normalizeHallMessage
} from './hallConversationMessages.js'
import { fetchHallConversationEvents } from '../../utils/authenticatedSse.js'
import { registerIdentityCleanup } from '../../utils/identityLifecycle.js'
import { combineAbortSignals } from '../../utils/abortSignals.js'
import { captureHallVoiceSnapshot } from './useHallVoiceConversation.js'
import { exactHallConversationId, normalizeHallConversationHistory } from './hallConversationHistory.js'

const runtimeEnv = import.meta.env ?? {}
const HALL_HISTORY_PAGE_SIZE = 100
const HALL_EVENT_RETRY_BASE_MS = 1_000
const HALL_EVENT_RETRY_CAP_MS = 30_000

export const useHallConversation = ({
  apiStore,
  chatContext,
  chatMode,
  chatApi,
  globalStore,
  log,
  openPanel,
  outgoingMetadata,
  portraitShortName,
  selectedAgent,
  selectedTask,
  showToast,
  onFinalReply
}) => {
  const messages = ref([])
  const conversationId = ref('')
  const conversationHistory = ref([])
  const conversationHistoryDeletingId = ref('')
  const conversationHistoryLoading = ref(false)
  const conversationHistoryError = ref('')
  const conversationHistoryHasMore = ref(true)
  const conversationHistoryPage = ref(0)
  const conversationLoadError = ref('')
  const isConversationLoading = ref(false)
  const selectedHallConversationId = ref('')
  const draft = ref('')
  const isStreaming = ref(false)
  const isAwaitingReply = ref(false)
  const eventStreamRecovering = ref(false)
  const draftRevision = ref(0)
  const replyEventSequence = ref(0)
  const observedFinalReplyIds = new Set()
  let localMessageSequence = 0
  let streamFinalCandidate = null
  let activeBuiltInTurn = null

  let hallEventController = null
  let hallEventConversationId = ''
  let hallEventReconnectTimer = null
  let hallEventReconnectFailures = 0
  let hallEventTerminal = false
  let hallReplyTimers = []
  let hallReplyPollTimer = null
  let hallSyncTimers = []
  let lifecycleGeneration = 0
  let lifecycleController = new AbortController()
  let disposed = false
  let hallEventSignalCleanup = null
  let hallReplyController = null
  let hallReplySignalCleanup = null
  let hallReplyStreamHandle = null
  let hallReplyGeneration = 0
  let hallConversationLoadGeneration = 0
  let hallConversationHistoryGeneration = 0
  let pendingHallConversationLoad = null
  let pendingHallConversationHistoryLoad = null
  let loadedConversationScopeSignature = ''
  const suppressedRestoreScopes = new Set()
  let stopScopeWatch = () => {}

  const exactRuntimeId = exactHallConversationId

  const scopeSnapshot = () => {
    const context = chatContext?.value || {}
    const type = context.conversationScopeType
    const key = context.conversationScopeKey
    if (!['public', 'bounty', 'private'].includes(type) || typeof key !== 'string' || !key) return null
    return Object.freeze({ type, key })
  }

  const scopeSignature = snapshot => snapshot ? `${snapshot.type}\u0000${snapshot.key}` : ''

  const sameScope = snapshot => Boolean(
    snapshot &&
    chatContext?.value?.conversationScopeType === snapshot.type &&
    chatContext?.value?.conversationScopeKey === snapshot.key
  )

  const invalidateConversationLoads = () => {
    hallConversationLoadGeneration += 1
    return hallConversationLoadGeneration
  }

  const invalidateConversationHistoryLoads = () => {
    hallConversationHistoryGeneration += 1
    return hallConversationHistoryGeneration
  }

  const isConversationBusy = computed(() => isStreaming.value || isAwaitingReply.value || isConversationLoading.value || Boolean(conversationHistoryDeletingId.value))

  const pendingAgentName = computed(() => {
    if (!selectedAgent.value) return ''
    return portraitShortName(selectedAgent.value) || selectedAgent.value.name || selectedAgent.value.agentId || ''
  })

  const currentChatContext = computed(() => chatContext?.value || {
    conversationScopeType: 'public',
    conversationScopeKey: 'public',
    mode: 'public',
    participantAgentIds: [],
    selectedTaskId: selectedTask.value?.id,
    targetAgentIds: selectedAgent.value?.agentId ? [selectedAgent.value.agentId] : [],
    taskId: selectedTask.value?.id,
    targetAgentId: selectedAgent.value?.agentId || ''
  })

  const chatConnectionStatus = computed(() => {
    if (eventStreamRecovering.value) return '正在续上传令'
    if (isStreaming.value) return '传令中'
    if (isAwaitingReply.value) return pendingAgentName.value ? `${pendingAgentName.value} 回话中` : '等待回报'
    return '传令畅通'
  })

  const senderText = (message) => {
    if (message.senderName) return message.senderName
    if (message.sender === 'USER') return '你'
    if (message.sender === 'SYSTEM') return '传令牌'
    return '聚义厅'
  }

  const stopHallReplyStreaming = () => {
    hallReplyTimers.forEach(timer => window.clearTimeout(timer))
    hallReplyTimers = []
    hallReplyController?.abort(new DOMException('Hall reply stopped', 'AbortError'))
    hallReplyController = null
    hallReplyStreamHandle?.cancel?.(new DOMException('Hall reply stopped', 'AbortError'))
    hallReplyStreamHandle = null
    hallReplySignalCleanup?.()
    hallReplySignalCleanup = null
  }

  const stopHallReplyPolling = () => {
    if (hallReplyPollTimer) {
      window.clearInterval(hallReplyPollTimer)
      hallReplyPollTimer = null
    }
  }

  const stopHallConversationSync = () => {
    hallSyncTimers.forEach(timer => window.clearTimeout(timer))
    hallSyncTimers = []
  }

  const cancelHallReplyTurn = (reason = 'Hall reply cancelled') => {
    hallReplyGeneration += 1
    stopHallReplyStreaming()
    stopHallReplyPolling()
    stopHallConversationSync()
    clearBuiltInTurn()
    isStreaming.value = false
    isAwaitingReply.value = false
    return reason
  }

  const setDraft = (value = '') => {
    draft.value = String(value || '')
    draftRevision.value += 1
  }

  const clearDraft = () => {
    setDraft('')
  }

  const exactMessageId = message => typeof message?.localId === 'string' && message.localId ? message.localId : ''
  const beginBuiltInTurn = requestConversationId => {
    activeBuiltInTurn = {
      conversationId: requestConversationId || null,
      baselineMessageIds: new Set(messages.value.map(exactMessageId).filter(Boolean)),
      stagedFinals: [],
      stagedMessageIds: new Set()
    }
  }
  const clearBuiltInTurn = () => {
    activeBuiltInTurn = null
    streamFinalCandidate = null
  }
  const resolveBuiltInTurnConversation = id => {
    if (!activeBuiltInTurn || typeof id !== 'string' || !id) return
    activeBuiltInTurn.conversationId = id
  }
  const stageActiveBuiltInFinal = ({ message, source, toastName, replyConversationId = conversationId.value }) => {
    if (!activeBuiltInTurn) return false
    if (activeBuiltInTurn.conversationId && replyConversationId !== activeBuiltInTurn.conversationId) return false
    const messageId = exactMessageId(message)
    if (!messageId) return false
    if (activeBuiltInTurn.baselineMessageIds.has(messageId)) return true
    if (!activeBuiltInTurn.stagedMessageIds.has(messageId)) {
      activeBuiltInTurn.stagedMessageIds.add(messageId)
      activeBuiltInTurn.stagedFinals.push({ message, source, toastName, conversationId: replyConversationId })
    }
    return true
  }

  const notifyFinalReply = ({ message, source, replyConversationId = conversationId.value }) => {
    const messageId = exactMessageId(message)
    if (!messageId || !String(message.content || '').trim() || observedFinalReplyIds.has(messageId)) return false
    observedFinalReplyIds.add(messageId)
    replyEventSequence.value += 1
    onFinalReply?.({
      conversationId: replyConversationId,
      message,
      messageId,
      source,
      sequence: replyEventSequence.value
    })
    return true
  }

  const appendHallEventMessage = (event) => {
    const state = {
      conversationId: conversationId.value,
      messages: messages.value,
      isAwaitingReply: isAwaitingReply.value,
      isStreaming: isStreaming.value
    }
    const result = reduceHallEventMessage(state, event)
    conversationId.value = state.conversationId
    messages.value = state.messages
    isAwaitingReply.value = state.isAwaitingReply
    isStreaming.value = state.isStreaming
    if (result.type === 'final' && result.message?.sender === 'AGENT' && stageActiveBuiltInFinal({
      message: result.message,
      source: 'agent_event',
      toastName: result.toastName,
      replyConversationId: event.conversationId
    })) {
      isAwaitingReply.value = true
      isStreaming.value = true
      return
    }
    if (result.shouldStopPolling) {
      stopHallReplyPolling()
    }
    if (result.toastName) showToast(`${result.toastName} 已回话`)
    if (result.type === 'final' && result.message?.sender === 'AGENT') {
      notifyFinalReply({ message: result.message, source: 'agent_event', replyConversationId: event.conversationId })
    }
  }

  const apiStreamUrl = (path, params = {}) => {
    const baseURL = runtimeEnv.VITE_API_BASE_URL || ''
    const requestPath = baseURL
      ? `${baseURL}${path.startsWith('/') ? path : `/${path}`}`
      : path
    const searchParams = new URLSearchParams(params).toString()
    return searchParams ? `${requestPath}?${searchParams}` : requestPath
  }

  const clearHallEventReconnect = () => {
    if (hallEventReconnectTimer != null) window.clearTimeout(hallEventReconnectTimer)
    hallEventReconnectTimer = null
  }

  const stopHallEventTransport = () => {
    clearHallEventReconnect()
    if (hallEventController) hallEventController.abort(new DOMException('Hall event stream stopped', 'AbortError'))
    hallEventController = null
    hallEventSignalCleanup?.()
    hallEventSignalCleanup = null
    hallEventConversationId = ''
    eventStreamRecovering.value = false
  }

  const resetHallEventRecovery = () => {
    hallEventReconnectFailures = 0
    hallEventTerminal = false
  }

  const scheduleHallEventReconnect = (generation) => {
    if (disposed || generation !== lifecycleGeneration || hallEventTerminal || hallEventReconnectTimer != null || !isPageVisible()) return
    const exponent = Math.max(0, hallEventReconnectFailures - 1)
    const base = Math.min(HALL_EVENT_RETRY_CAP_MS, HALL_EVENT_RETRY_BASE_MS * (2 ** exponent))
    const delay = Math.min(HALL_EVENT_RETRY_CAP_MS, base + Math.floor(base * boundedJitter()))
    hallEventReconnectTimer = window.setTimeout(() => {
      hallEventReconnectTimer = null
      if (disposed || generation !== lifecycleGeneration || hallEventTerminal || !isPageVisible()) return
      hallEventConversationId = ''
      startHallEventStream()
    }, delay)
  }

  const failHallEventStream = (generation, error) => {
    if (disposed || generation !== lifecycleGeneration || error?.name === 'AbortError') return
    if (isTerminalHallEventError(error)) {
      hallEventTerminal = true
      clearHallEventReconnect()
      eventStreamRecovering.value = false
      return
    }
    log.warn('聚义厅实时消息连接中断', error)
    hallEventReconnectFailures += 1
    eventStreamRecovering.value = true
    scheduleHallEventReconnect(generation)
  }

  const startHallEventStream = async () => {
    if (disposed || hallEventTerminal || !isPageVisible()) return
    const generation = lifecycleGeneration
    const id = conversationId.value
    if (typeof id !== 'string' || !id || hallEventConversationId === id) return
    stopHallEventTransport()
    hallEventConversationId = id
    hallEventController = new AbortController()
    const eventSignal = combineAbortSignals({ signals: [lifecycleController.signal, hallEventController.signal] })
    hallEventSignalCleanup = eventSignal.cleanup

    try {
      const response = await fetchHallConversationEvents({
        apiStore,
        url: apiStreamUrl('/chat/conversation/events', { id }),
        signal: eventSignal.signal
      })
      if (disposed || generation !== lifecycleGeneration || !response) {
        if (!response && generation === lifecycleGeneration) hallEventTerminal = true
        hallEventController = null
        return
      }
      if (!response.ok || !response.body) {
        const failure = new Error(`Hall event stream failed: ${response.status}`)
        failure.status = response.status
        throw failure
      }
      eventStreamRecovering.value = false

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done || disposed || generation !== lifecycleGeneration) break
        buffer += decoder.decode(value, { stream: true })
        let eventEndIndex
        while ((eventEndIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.substring(0, eventEndIndex).trim()
          buffer = buffer.substring(eventEndIndex + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload) continue
          appendHallEventMessage(JSON.parse(payload))
          hallEventReconnectFailures = 0
        }
      }
      if (!disposed && generation === lifecycleGeneration && !eventSignal.signal.aborted) {
        hallEventConversationId = ''
        hallEventController = null
        hallEventSignalCleanup?.()
        hallEventSignalCleanup = null
        failHallEventStream(generation, new Error('Hall event stream ended'))
      }
    } catch (error) {
      if (!disposed && generation === lifecycleGeneration) {
        hallEventConversationId = ''
        hallEventController = null
        failHallEventStream(generation, error)
      }
    } finally {
      if (generation === lifecycleGeneration) {
        hallEventSignalCleanup?.()
        hallEventSignalCleanup = null
      }
    }
  }

  const stopHallEventStream = () => {
    stopHallEventTransport()
    resetHallEventRecovery()
  }

  const handleHallEventVisibility = () => {
    if (disposed) return
    if (!isPageVisible()) {
      stopHallEventTransport()
      return
    }
    startHallEventStream()
  }

  const handleHallEventFocus = () => {
    if (!isPageVisible() || hallEventReconnectTimer != null) return
    startHallEventStream()
  }

  const resetLifecycle = () => {
    lifecycleGeneration += 1
    lifecycleController.abort(new DOMException('Hall identity lifecycle reset', 'AbortError'))
    if (!disposed) lifecycleController = new AbortController()
  }

  const clearHallConversationIdentityState = () => {
    invalidateConversationLoads()
    invalidateConversationHistoryLoads()
    pendingHallConversationLoad = null
    pendingHallConversationHistoryLoad = null
    conversationHistory.value = []
    conversationHistoryDeletingId.value = ''
    conversationHistoryLoading.value = false
    conversationHistoryError.value = ''
    conversationHistoryHasMore.value = true
    conversationHistoryPage.value = 0
    conversationLoadError.value = ''
    isConversationLoading.value = false
    selectedHallConversationId.value = ''
    loadedConversationScopeSignature = ''
    suppressedRestoreScopes.clear()
    resetLifecycle()
    stopHallEventStream()
    stopHallReplyStreaming()
    stopHallReplyPolling()
    stopHallConversationSync()
    conversationId.value = ''
    setDraft('')
    messages.value = []
    isStreaming.value = false
    isAwaitingReply.value = false
    clearBuiltInTurn()
  }

  stopScopeWatch = watch(
    () => `${chatContext?.value?.conversationScopeType || ''}\u0000${chatContext?.value?.conversationScopeKey || ''}`,
    (nextScope, previousScope) => {
      if (!previousScope || nextScope === previousScope || disposed) return
      invalidateConversationLoads()
      invalidateConversationHistoryLoads()
      pendingHallConversationLoad = null
      pendingHallConversationHistoryLoad = null
      conversationHistory.value = []
      conversationHistoryDeletingId.value = ''
      conversationHistoryLoading.value = false
      conversationHistoryError.value = ''
      conversationHistoryHasMore.value = true
      conversationHistoryPage.value = 0
      conversationLoadError.value = ''
      isConversationLoading.value = false
      selectedHallConversationId.value = ''
      loadedConversationScopeSignature = ''
      resetLifecycle()
      stopHallEventStream()
      stopHallReplyStreaming()
      stopHallReplyPolling()
      stopHallConversationSync()
      conversationId.value = ''
      messages.value = []
      isStreaming.value = false
      isAwaitingReply.value = false
      clearBuiltInTurn()
    },
    { flush: 'sync' }
  )

  browserDocument()?.addEventListener?.('visibilitychange', handleHallEventVisibility)
  browserWindow()?.addEventListener?.('focus', handleHallEventFocus)

  const unregisterIdentityCleanup = registerIdentityCleanup(clearHallConversationIdentityState)
  const disposeHallConversation = () => {
    if (disposed) return
    disposed = true
    browserDocument()?.removeEventListener?.('visibilitychange', handleHallEventVisibility)
    browserWindow()?.removeEventListener?.('focus', handleHallEventFocus)
    stopScopeWatch()
    clearHallConversationIdentityState()
    unregisterIdentityCleanup()
  }

  const loadHallConversationContent = async (id = conversationId.value, guard = {}) => {
    const exactId = exactRuntimeId(id)
    if (disposed || !exactId) return false
    const generation = lifecycleGeneration
    const loadGeneration = guard.loadGeneration ?? hallConversationLoadGeneration
    const expectedScope = guard.scope || scopeSnapshot()
    const isSelectedLoad = guard.selection === true
    const isCurrentContentLoad = () => (
      !disposed &&
      generation === lifecycleGeneration &&
      loadGeneration === hallConversationLoadGeneration &&
      conversationId.value === exactId &&
      sameScope(expectedScope)
    )
    let loaded = false
    let contentFailed = false
    const failContentLoad = error => {
      if (!isCurrentContentLoad()) return
      contentFailed = true
      if (error?.name !== 'AbortError') log.warn('加载聚义厅会话内容失败', error)
      if (isSelectedLoad && error?.name !== 'AbortError') {
        messages.value = []
        conversationLoadError.value = '这段旧话暂不可取，请重试。'
      }
    }
    if (isSelectedLoad) {
      isConversationLoading.value = true
      conversationLoadError.value = ''
    }
    try {
      await chatApi.getById('/conversation/content', exactId, {
        autoLoading: false,
        signal: lifecycleController.signal,
        onSuccess: (contentResult) => {
          if (!isCurrentContentLoad()) return
          messages.value = (Array.isArray(contentResult?.data) ? contentResult.data : []).map(normalizeHallMessage).filter(Boolean)
          const finalAgentReplies = messages.value.filter(message => message.sender === 'AGENT' && !message.streaming && String(message.content || '').trim())
          loadedConversationScopeSignature = scopeSignature(expectedScope)
          const activeTurnForConversation = Boolean(activeBuiltInTurn && activeBuiltInTurn.conversationId === exactId)
          finalAgentReplies.forEach(message => {
            if (!stageActiveBuiltInFinal({ message, source: 'poll_final', replyConversationId: exactId })) {
              notifyFinalReply({ message, source: 'poll_final', replyConversationId: exactId })
            }
          })
          if (activeTurnForConversation) {
            isAwaitingReply.value = true
            isStreaming.value = true
          } else if (hasResolvedAgentReply(messages.value)) {
            isAwaitingReply.value = false
            isStreaming.value = false
            stopHallReplyPolling()
          }
          if (isSelectedLoad) conversationLoadError.value = ''
          loaded = true
          startHallEventStream()
        },
        onError: failContentLoad
      })
      if (!loaded && !contentFailed && isCurrentContentLoad()) failContentLoad(new Error('Hall conversation content response was empty'))
      return loaded && isCurrentContentLoad()
    } catch (error) {
      failContentLoad(error)
      return false
    } finally {
      if (isSelectedLoad && isCurrentContentLoad()) isConversationLoading.value = false
    }
  }

  const performHallMessagesLoad = async (expectedScope, loadGeneration) => {
    const generation = lifecycleGeneration
    const expectedSignature = scopeSignature(expectedScope)
    const isCurrentLoad = () => (
      !disposed &&
      generation === lifecycleGeneration &&
      loadGeneration === hallConversationLoadGeneration &&
      sameScope(expectedScope) &&
      !suppressedRestoreScopes.has(expectedSignature)
    )
    stopHallEventStream()
    stopHallReplyStreaming()
    stopHallReplyPolling()
    conversationId.value = ''
    selectedHallConversationId.value = ''
    conversationLoadError.value = ''
    messages.value = []
    isAwaitingReply.value = false
    isStreaming.value = false
    try {
      let callbackResult
      const response = await chatApi.list('/conversation/list', {
        pageNum: 1,
        pageSize: 1,
        orderBy: 'update_time desc',
        search: {
          conversationType: 'juyiting',
          conversationScopeType: expectedScope.type,
          conversationScopeKey: expectedScope.key
        }
      }, {
        autoLoading: false,
        signal: lifecycleController.signal,
        onSuccess: result => { callbackResult = result }
      })
      if (!isCurrentLoad()) return false
      const result = callbackResult ?? response?.data
      if (!Array.isArray(result?.data)) return false
      const hallConversation = result.data[0]
      if (!hallConversation) return false
      if (hallConversation.conversationType !== 'juyiting' ||
          hallConversation.conversationScopeType !== expectedScope.type ||
          hallConversation.conversationScopeKey !== expectedScope.key) return false
      const id = exactRuntimeId(hallConversation.id)
      if (!id) return false
      conversationId.value = id
      selectedHallConversationId.value = id
      return loadHallConversationContent(id, { loadGeneration, scope: expectedScope })
    } catch (error) {
      if (error?.name !== 'AbortError' && isCurrentLoad()) log.warn('加载聚义厅会话失败', error)
      return false
    }
  }

  const loadHallMessages = ({ force = false } = {}) => {
    if (disposed) return Promise.resolve(false)
    const expectedScope = scopeSnapshot()
    if (!expectedScope) return Promise.resolve(false)
    const expectedSignature = scopeSignature(expectedScope)
    if (suppressedRestoreScopes.has(expectedSignature)) return Promise.resolve(false)
    if (!force && loadedConversationScopeSignature === expectedSignature && conversationId.value) {
      startHallEventStream()
      return Promise.resolve(true)
    }
    if (pendingHallConversationLoad?.signature === expectedSignature) return pendingHallConversationLoad.promise

    const loadGeneration = invalidateConversationLoads()
    const promise = performHallMessagesLoad(expectedScope, loadGeneration)
    pendingHallConversationLoad = { signature: expectedSignature, promise }
    return promise.finally(() => {
      if (pendingHallConversationLoad?.promise === promise) pendingHallConversationLoad = null
    })
  }

  const readHistoryRows = result => {
    if (Array.isArray(result?.data)) return result.data
    if (Array.isArray(result?.data?.data)) return result.data.data
    return []
  }

  const loadHallConversationHistory = ({ force = false, loadMore = false } = {}) => {
    if (disposed) return Promise.resolve([])
    const expectedScope = scopeSnapshot()
    if (!expectedScope || conversationHistoryDeletingId.value || (loadMore && !conversationHistoryHasMore.value)) return Promise.resolve([])
    const expectedSignature = scopeSignature(expectedScope)
    if (pendingHallConversationHistoryLoad?.signature === expectedSignature) return pendingHallConversationHistoryLoad.promise

    const generation = lifecycleGeneration
    const historyGeneration = invalidateConversationHistoryLoads()
    const pageNum = loadMore ? conversationHistoryPage.value + 1 : 1
    const isCurrentHistoryLoad = () => (
      !disposed &&
      generation === lifecycleGeneration &&
      historyGeneration === hallConversationHistoryGeneration &&
      sameScope(expectedScope)
    )
    if (!loadMore) {
      conversationHistory.value = []
      conversationHistoryPage.value = 0
      conversationHistoryHasMore.value = true
    }
    conversationHistoryLoading.value = true
    conversationHistoryError.value = ''
    const promise = (async () => {
      try {
        let callbackResult
        const response = await chatApi.list('/conversation/list', {
          pageNum,
          pageSize: HALL_HISTORY_PAGE_SIZE,
          orderBy: 'update_time desc',
          search: {
            conversationType: 'juyiting',
            conversationScopeType: expectedScope.type,
            conversationScopeKey: expectedScope.key
          }
        }, {
          autoLoading: false,
          signal: lifecycleController.signal,
          onSuccess: result => { callbackResult = result }
        })
        if (!isCurrentHistoryLoad()) return []
        const rawRows = readHistoryRows(callbackResult ?? response?.data)
        const nextRows = rawRows.map(row => normalizeHallConversationHistory(row, expectedScope)).filter(Boolean)
        const merged = loadMore ? [...conversationHistory.value] : []
        const seen = new Set(merged.map(item => item.id))
        nextRows.forEach(item => {
          if (seen.has(item.id)) return
          seen.add(item.id)
          merged.push(item)
        })
        conversationHistory.value = merged
        conversationHistoryPage.value = pageNum
        // The current service loses true PageInfo totals; raw page fullness is authoritative.
        conversationHistoryHasMore.value = rawRows.length === HALL_HISTORY_PAGE_SIZE
        return conversationHistory.value
      } catch (error) {
        if (error?.name !== 'AbortError' && isCurrentHistoryLoad()) {
          log.warn('加载聚义厅话头记录失败', error)
          conversationHistoryError.value = '旧话头暂不可取，请稍后重试。'
        }
        return []
      } finally {
        if (isCurrentHistoryLoad()) conversationHistoryLoading.value = false
      }
    })()
    pendingHallConversationHistoryLoad = { signature: expectedSignature, promise }
    return promise.finally(() => {
      if (pendingHallConversationHistoryLoad?.promise === promise) pendingHallConversationHistoryLoad = null
    })
  }

  const loadMoreHallConversationHistory = () => loadHallConversationHistory({ loadMore: true })

  const deleteHallConversation = async (id) => {
    if (disposed || isConversationBusy.value || conversationHistoryLoading.value || conversationHistoryDeletingId.value) return false
    const expectedScope = scopeSnapshot()
    const exactId = exactRuntimeId(id)
    if (!expectedScope || !exactId || !conversationHistory.value.some(item => item.id === exactId)) return false

    const generation = lifecycleGeneration
    const expectedSignature = scopeSignature(expectedScope)
    invalidateConversationHistoryLoads()
    pendingHallConversationHistoryLoad = null
    conversationHistoryLoading.value = false
    conversationHistoryDeletingId.value = exactId
    conversationHistoryError.value = ''
    try {
      await chatApi.delete('/conversation/delete', exactId, {
        autoLoading: false,
        signal: lifecycleController.signal
      })
      if (disposed || generation !== lifecycleGeneration || !sameScope(expectedScope)) return false

      conversationHistory.value = conversationHistory.value.filter(item => item.id !== exactId)
      conversationHistoryDeletingId.value = ''
      if (conversationId.value === exactId) {
        newHallConversation({ notify: false })
        showToast('话头已删除，已另起新话头')
      } else {
        showToast('旧话头已删除')
      }
      if (!disposed && sameScope(expectedScope) && scopeSignature(scopeSnapshot()) === expectedSignature) {
        await loadHallConversationHistory({ force: true })
      }
      return true
    } catch (error) {
      if (error?.name !== 'AbortError' && !disposed && generation === lifecycleGeneration && sameScope(expectedScope)) {
        log.warn('删除聚义厅话头失败', error)
        showToast('删除话头未成，请稍后重试')
      }
      return false
    } finally {
      if (conversationHistoryDeletingId.value === exactId) conversationHistoryDeletingId.value = ''
    }
  }

  const selectHallConversation = async (id) => {
    if (disposed || isConversationBusy.value) return false
    const expectedScope = scopeSnapshot()
    const exactId = exactRuntimeId(id)
    if (!expectedScope || !exactId || !conversationHistory.value.some(item => item.id === exactId)) return false

    const loadGeneration = invalidateConversationLoads()
    pendingHallConversationLoad = null
    loadedConversationScopeSignature = ''
    resetLifecycle()
    stopHallEventStream()
    stopHallReplyStreaming()
    stopHallReplyPolling()
    stopHallConversationSync()
    conversationId.value = exactId
    selectedHallConversationId.value = exactId
    messages.value = []
    isStreaming.value = false
    isAwaitingReply.value = false
    clearBuiltInTurn()
    return loadHallConversationContent(exactId, { loadGeneration, scope: expectedScope, selection: true })
  }

  const retryHallConversation = () => {
    resetHallEventRecovery()
    if (conversationLoadError.value && selectedHallConversationId.value) return selectHallConversation(selectedHallConversationId.value)
    return loadHallMessages({ force: true })
  }

  const startHallReplyPolling = (id = conversationId.value) => {
    if (disposed || typeof id !== 'string' || !id) return
    const generation = lifecycleGeneration
    stopHallReplyPolling()
    hallReplyPollTimer = window.setInterval(() => {
      if (disposed || generation !== lifecycleGeneration || !isAwaitingReply.value || conversationId.value !== id) {
        stopHallReplyPolling()
        return
      }
      loadHallConversationContent(id)
    }, 2000)
  }

  const scheduleHallConversationSync = (id) => {
    if (disposed || !id) return
    const generation = lifecycleGeneration
    const schedule = delay => {
      const timer = window.setTimeout(() => {
        hallSyncTimers = hallSyncTimers.filter(item => item !== timer)
        if (!disposed && generation === lifecycleGeneration && conversationId.value === id) {
          loadHallConversationContent(id)
        }
      }, delay)
      hallSyncTimers.push(timer)
    }
    schedule(1500)
    schedule(5000)
  }

  const newHallConversation = ({ notify = true } = {}) => {
    const currentScopeSignature = scopeSignature(scopeSnapshot())
    if (currentScopeSignature) suppressedRestoreScopes.add(currentScopeSignature)
    invalidateConversationLoads()
    invalidateConversationHistoryLoads()
    pendingHallConversationLoad = null
    pendingHallConversationHistoryLoad = null
    conversationHistoryLoading.value = false
    conversationHistoryError.value = ''
    conversationLoadError.value = ''
    isConversationLoading.value = false
    selectedHallConversationId.value = ''
    loadedConversationScopeSignature = ''
    resetLifecycle()
    stopHallEventStream()
    stopHallReplyStreaming()
    stopHallReplyPolling()
    stopHallConversationSync()
    conversationId.value = ''
    messages.value = []
    isStreaming.value = false
    isAwaitingReply.value = false
    clearBuiltInTurn()
    if (notify) showToast('已另起厅前话头')
  }

  const processStream = (eventData) => {
    const state = {
      conversationId: conversationId.value,
      messages: messages.value,
      isAwaitingReply: isAwaitingReply.value,
      isStreaming: isStreaming.value
    }
    const result = appendStreamPayload(state, eventData)
    conversationId.value = state.conversationId
    messages.value = state.messages
    isAwaitingReply.value = state.isAwaitingReply
    isStreaming.value = state.isStreaming
    if (result.shouldStopPolling) {
      stopHallReplyPolling()
    }
    if (result.type === 'assistant' && result.message?.content) {
      streamFinalCandidate = { message: result.message, conversationId: null, toastName: result.toastName }
    }
    if (result.type === 'stream_final' && result.message?.content) {
      streamFinalCandidate = { message: result.message, conversationId: result.conversationId, toastName: result.toastName }
    }
    if (result.type === 'conversation') {
      suppressedRestoreScopes.delete(scopeSignature(scopeSnapshot()))
      resolveBuiltInTurnConversation(result.conversationId)
    }
    if (result.shouldReconnect) {
      startHallEventStream()
      scheduleHallConversationSync(result.conversationId)
    }
  }

  const sendHallMessage = async ({
    content: explicitContent,
    contextSnapshot,
    source = 'text',
    clearDraftRevision,
    onConversationResolved
  } = {}) => {
    const isVoiceSend = source === 'voice'
    if (isVoiceSend && typeof explicitContent !== 'string') return false
    const content = (isVoiceSend ? explicitContent : String((explicitContent ?? draft.value) || '')).trim()
    if (disposed || !content || isStreaming.value || isAwaitingReply.value || isConversationLoading.value || conversationHistoryDeletingId.value || conversationLoadError.value) return false
    let sendContext = contextSnapshot || currentChatContext.value
    if (isVoiceSend) {
      const validated = captureHallVoiceSnapshot({
        context: contextSnapshot,
        draft: contextSnapshot?.draft,
        draftRevision: contextSnapshot?.draftRevision
      })
      if (!validated || validated.cas !== contextSnapshot?.cas || clearDraftRevision !== validated.draftRevision) return false
      sendContext = validated
    }
    const requestConversationId = isVoiceSend ? sendContext.conversationId : conversationId.value
    const metadataSource = isVoiceSend ? (sendContext.outgoingMetadata || {}) : (outgoingMetadata?.value || {})
    const mentionAgentIds = Array.isArray(sendContext.mentionAgentIds) && sendContext.mentionAgentIds.length
      ? sendContext.mentionAgentIds
      : sendContext.targetAgentIds
    const selectedAgentId = isVoiceSend ? sendContext.selectedAgentId : (sendContext.selectedAgentId ?? selectedAgent.value?.agentId)
    const selectedTaskId = isVoiceSend ? sendContext.selectedTaskId : (sendContext.selectedTaskId ?? selectedTask.value?.id)
    const generation = lifecycleGeneration
    const replyGeneration = ++hallReplyGeneration
    const isCurrentReplyTurn = () => !disposed && generation === lifecycleGeneration && replyGeneration === hallReplyGeneration
    if (explicitContent === undefined) clearDraft()
    stopHallReplyStreaming()
    clearBuiltInTurn()
    beginBuiltInTurn(requestConversationId)
    localMessageSequence += 1
    messages.value.push({
      localId: `user-${Date.now()}-${localMessageSequence}`,
      sender: 'USER',
      content,
      timestamp: Date.now(),
      streaming: false
    })
    isStreaming.value = true
    isAwaitingReply.value = true
    stopHallReplyPolling()

    hallReplyController = new AbortController()
    const replySignal = combineAbortSignals({ signals: [lifecycleController.signal, hallReplyController.signal] })
    hallReplySignalCleanup = replySignal.cleanup

    try {
      await chatApi.create('/stream', {
        content,
        conversationId: requestConversationId,
        conversationType: 'juyiting',
        conversationScopeType: sendContext.conversationScopeType,
        conversationScopeKey: sendContext.conversationScopeKey,
        targetAgentIds: sendContext.targetAgentIds,
        targetAgentId: sendContext.targetAgentId,
        taskId: sendContext.taskId,
        forceNewConversation: requestConversationId === '',
        senderType: 'user',
        senderName: globalStore.user?.name || globalStore.user?.nickname || '寨中来客',
        metadata: {
          ...metadataSource,
          scene: 'juyiting',
          mode: sendContext.mode,
          scopeKey: sendContext.conversationScopeKey,
          selectedAgentId,
          mentionAgentIds,
          participantAgentIds: sendContext.participantAgentIds,
          targetAgentIds: sendContext.targetAgentIds,
          selectedTaskId
        }
      }, {
        responseType: 'stream',
        autoLoading: false,
        timeout: 1800000,
        signal: replySignal.signal,
        onStreamOpen: handle => {
          if (!isCurrentReplyTurn()) {
            handle.cancel?.(new DOMException('Stale Hall reply stream', 'AbortError'))
            return
          }
          hallReplyStreamHandle = handle
        },
        onStream: eventData => {
          if (!isCurrentReplyTurn()) return
          const previousConversationId = conversationId.value
          processStream(eventData)
          if (conversationId.value && conversationId.value !== previousConversationId) onConversationResolved?.(conversationId.value)
        },
        onStreamEnd: () => {
          if (!isCurrentReplyTurn()) return
          hallReplyStreamHandle = null
          isStreaming.value = false
          const finalized = streamFinalCandidate
          const completedTurn = activeBuiltInTurn
          activeBuiltInTurn = null
          streamFinalCandidate = null
          const finalConversationId = conversationId.value
          if (finalized?.message?.content && typeof finalConversationId === 'string' && finalConversationId &&
            (!finalized.conversationId || finalized.conversationId === finalConversationId)) {
            if (finalized.toastName) showToast(`${finalized.toastName} 已回话`)
            notifyFinalReply({ message: finalized.message, source: 'stream_end', replyConversationId: finalConversationId })
          }
          completedTurn?.stagedFinals.forEach(staged => {
            if (staged.toastName && !observedFinalReplyIds.has(exactMessageId(staged.message))) showToast(`${staged.toastName} 已回话`)
            notifyFinalReply({ message: staged.message, source: staged.source, replyConversationId: staged.conversationId })
          })
          if (isAwaitingReply.value && conversationId.value) startHallReplyPolling(conversationId.value)
        },
        onError: (message, requestError) => {
          if (!isCurrentReplyTurn() || requestError?.name === 'AbortError') return
          throw requestError || new Error(message)
        }
      })
      if (!isCurrentReplyTurn()) return false
      if (isVoiceSend && draftRevision.value === clearDraftRevision) clearDraft()
      if (outgoingMetadata) outgoingMetadata.value = {}
      return true
    } catch (error) {
      if (error?.name === 'AbortError' || !isCurrentReplyTurn()) return false
      log.error('聚义厅消息发送失败', error)
      isStreaming.value = false
      isAwaitingReply.value = false
      clearBuiltInTurn()
      stopHallReplyPolling()
      localMessageSequence += 1
      messages.value.push({
        localId: `system-${Date.now()}-${localMessageSequence}`,
        sender: 'SYSTEM',
        content: '传令未达，请稍后再试',
        timestamp: Date.now(),
        streaming: false
      })
      return false
    } finally {
      if (isCurrentReplyTurn()) {
        hallReplyController = null
        hallReplyStreamHandle = null
        hallReplySignalCleanup?.()
        hallReplySignalCleanup = null
      }
    }
  }

  const insertAgentMention = (agent, suffix = '') => {
    const mention = `@${portraitShortName(agent)}`
    const current = draft.value.trim()
    const replacement = suffix ? `${mention} ${suffix}` : `${mention} `
    if (!current) {
      setDraft(replacement)
      return
    }
    if (current.includes(mention)) {
      setDraft(suffix && current === mention ? `${mention} ${suffix}` : draft.value)
      return
    }
    if (/(^|\s)@\S*$/.test(current)) {
      setDraft(current.replace(/(^|\s)@\S*$/, (_, prefix) => `${prefix}${replacement}`))
      return
    }
    setDraft(`${current} ${mention}${suffix ? ` ${suffix}` : ' '}`)
  }

  const mentionAgent = (agent) => {
    selectedAgent.value = agent
    insertAgentMention(agent)
  }

  const startAgentConversation = (agent) => {
    if (!agent) return
    if (chatMode) chatMode.value = 'private'
    selectedAgent.value = agent
    insertAgentMention(agent, '请报眼下动静、可领何榜、还需哪路照应。')
    openPanel('chat')
    showToast(`正与 ${portraitShortName(agent)} 密议`)
  }

  return {
    cancelHallReplyTurn,
    chatConnectionStatus,
    conversationHistory,
    conversationHistoryDeletingId,
    conversationHistoryError,
    conversationHistoryHasMore,
    conversationHistoryLoading,
    conversationId,
    conversationLoadError,
    clearDraft,
    disposeHallConversation,
    draft,
    draftRevision,
    deleteHallConversation,
    eventStreamRecovering,
    insertAgentMention,
    isAwaitingReply,
    isConversationBusy,
    isStreaming,
    loadHallConversationHistory,
    loadHallMessages,
    loadMoreHallConversationHistory,
    mentionAgent,
    messages,
    newHallConversation,
    pendingAgentName,
    replyEventSequence,
    retryHallConversation,
    sendHallMessage,
    senderText,
    selectHallConversation,
    selectedHallConversationId,
    setDraft,
    startAgentConversation,
    stopHallEventStream,
    stopHallReplyPolling,
    stopHallReplyStreaming
  }
}

function isTerminalHallEventError (error) {
  return error?.status === 401 || error?.status === 403
}

function isPageVisible () {
  return !browserDocument() || browserDocument().visibilityState !== 'hidden'
}

function boundedJitter () {
  const random = Math.random()
  return typeof random === 'number' && random >= 0 && random <= 1 ? random : 0
}

function browserWindow () {
  return typeof window === 'undefined' ? null : window
}

function browserDocument () {
  return typeof document === 'undefined' ? null : document
}
