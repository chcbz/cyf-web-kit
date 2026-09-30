import { computed, ref, watch } from 'vue'
import {
  appendHallEventMessage as reduceHallEventMessage,
  appendStreamPayload,
  hasResolvedAgentReply,
  normalizeHallMessage,
  normalizeSenderName,
  canonicalWireString
} from './hallConversationMessages.js'
import { fetchHallConversationEvents } from '../../utils/authenticatedSse.js'
import { registerIdentityCleanup } from '../../utils/identityLifecycle.js'
import { combineAbortSignals } from '../../utils/abortSignals.js'
import { captureHallVoiceSnapshot } from './useHallVoiceConversation.js'
import { exactHallConversationId, normalizeHallConversationHistory } from './hallConversationHistory.js'
import { createHallSseParser } from './hallConversationSse.js'
import { isMessagePartEvent } from './hallMessageParts.js'
import {
  bountyBootstrapReference, sameBountyBootstrapReference, bountyBootstrapContextMatches,
  validateBountyBootstrapRequest, bootstrapReadbackIsCurrent
} from './hallBountyBootstrap.js'
import {
  cancellationTarget,
  deliberationBusy,
  deliberationStatusText,
  isPendingTurn,
  isTerminalTurnState,
  reduceDeliberationEvent
} from './hallDeliberationState.js'

const runtimeEnv = import.meta.env ?? {}
const HALL_HISTORY_PAGE_SIZE = 100
const HALL_EVENT_RETRY_BASE_MS = 1_000
const HALL_EVENT_RETRY_CAP_MS = 30_000
const HALL_REQUEST_READBACK_DEBOUNCE_MS = 250

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
  onFinalReply,
  onDelivery
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
  const scopeDrafts = new Map()
  const isStreaming = ref(false)
  const isAwaitingReply = ref(false)
  const isSubmitting = ref(false)
  const isAdoptingBountyBootstrap = ref(false)
  const eventStreamRecovering = ref(false)
  const deliberationStatus = ref('')
  const activeRequest = ref(null)
  const activeTurns = ref([])
  const capabilityState = ref({ loaded: false, v2: false, fallbackReason: '旧版传令兼容模式' })
  const draftRevision = ref(0)
  const replyEventSequence = ref(0)
  const observedFinalReplyIds = new Set()
  let localMessageSequence = 0
  let streamFinalCandidate = null
  const eventCursors = new Map()
  const turnStates = new Map()
  const requestReadbackJobs = new Map()
  const requestReadbackInflight = new Map()
  let capabilityPromise = null
  let capabilityAttempt = 0
  let authoritativeResyncPromise = null
  let activeBuiltInTurn = null
  let recoveringReplyTurn = null
  let activeSendToken = null
  let bootstrapAdoptionToken = null
  let adoptedBootstrap = null

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
  const now = () => Date.now()
  const apiData = response => response?.data?.data ?? response?.data ?? response
  const authEpoch = () => apiStore?.authorizationGeneration
  const v2Supported = capability => capability?.schemaVersion === '2' && capability.requestId === true &&
    capability.requestRevision === true && capability.contextSnapshot === true && capability.durableTurns === true &&
    capability.deltaSequence === true && capability.cancel === true && Array.isArray(capability.interactionHints) &&
    capability.interactionHints.includes('chat')
  const inputRefsFor = metadata => Array.isArray(metadata?.inputRefs)
    ? metadata.inputRefs.map(ref => ({ type: typeof ref?.type === 'string' ? ref.type : '', id: typeof ref?.id === 'string' ? ref.id : '' }))
      .filter(ref => ref.type && ref.id)
    : []
  const safeOutgoingMetadata = metadata => {
    const source = metadata && typeof metadata === 'object' ? metadata : {}
    const safe = {}
    for (const key of ['libraryCitationId', 'librarySourceType']) {
      if (typeof source[key] === 'string' && source[key]) safe[key] = source[key]
    }
    return safe
  }
  const seenVector = () => ({ conversationId: conversationId.value || undefined, eventCursor: eventCursors.get(conversationId.value) || undefined })
  const recordObservation = (name, request) => { request?.observations?.push({ name, at: now() }) }
  const captureGuard = (scope = scopeSnapshot()) => Object.freeze({
    generation: lifecycleGeneration, authEpoch: authEpoch(), scope, signature: scopeSignature(scope)
  })
  const guardCurrent = guard => Boolean(guard && !disposed && guard.generation === lifecycleGeneration &&
    guard.authEpoch === authEpoch() && guard.signature === scopeSignature(scopeSnapshot()) && sameScope(guard.scope))
  const abortIfStale = guard => {
    if (!guardCurrent(guard)) throw new DOMException('Hall identity or scope changed', 'AbortError')
  }
  const negotiateCapabilities = async guard => {
    abortIfStale(guard)
    if (capabilityState.value.loaded) return capabilityState.value
    if (capabilityPromise) { const result = await capabilityPromise; abortIfStale(guard); return result }
    const attempt = ++capabilityAttempt
    const promise = (async () => {
      try {
        const response = await chatApi.get('/capabilities', {}, { autoLoading: false, signal: lifecycleController.signal })
        abortIfStale(guard)
        if (attempt !== capabilityAttempt) throw new DOMException('Stale capability negotiation', 'AbortError')
        const capability = apiData(response)
        const v2 = v2Supported(capability)
        capabilityState.value = { loaded: true, v2, fallbackReason: v2 ? '' : '服务端未声明 v2 durable turn 能力' }
      } catch (error) {
        if (error?.name === 'AbortError' || !guardCurrent(guard) || attempt !== capabilityAttempt) throw error?.name === 'AbortError'
          ? error : new DOMException('Hall identity changed during capability negotiation', 'AbortError')
        capabilityState.value = { loaded: true, v2: false, fallbackReason: '能力协商不可用，已安全回退旧传令' }
      } finally {
        if (capabilityPromise === promise) capabilityPromise = null
      }
      abortIfStale(guard)
      return capabilityState.value
    })()
    capabilityPromise = promise
    return promise
  }

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

  const durableBusy = computed(() => deliberationBusy(activeRequest.value, activeTurns.value))
  const durableCancelTarget = computed(() => cancellationTarget(activeRequest.value, activeTurns.value))
  const canCancelDurable = computed(() => Boolean(durableCancelTarget.value))
  const canCancelLegacy = computed(() => !activeRequest.value?.requestId && (isStreaming.value || isAwaitingReply.value))
  const isConversationBusy = computed(() => isAdoptingBountyBootstrap.value || isSubmitting.value || durableBusy.value || isStreaming.value || isAwaitingReply.value || isConversationLoading.value || Boolean(conversationHistoryDeletingId.value))

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
    if (isSubmitting.value) return '正在提交，等待受理'
    if (eventStreamRecovering.value) return '正在续上传令'
    if (deliberationStatus.value) return deliberationStatus.value
    if (isStreaming.value) return '传令中'
    if (isAwaitingReply.value) return pendingAgentName.value ? `${pendingAgentName.value} 回话中` : '等待回报'
    return '传令畅通'
  })

  const senderText = (message) => {
    if (message?.isSelf) return '你'
    const senderName = normalizeSenderName(message?.senderName)
    if (senderName) return senderName
    if (message.sender === 'USER') return '用户'
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
    recoveringReplyTurn = null
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

  const syncDurablePresentation = () => {
    if (!activeRequest.value?.requestId) return
    const busy = deliberationBusy(activeRequest.value, activeTurns.value)
    isAwaitingReply.value = busy
    isStreaming.value = activeTurns.value.some(turn => ['STREAMING', 'GENERATING'].includes(String(turn.state || '').toUpperCase()))
    deliberationStatus.value = deliberationStatusText(activeRequest.value, activeTurns.value) ||
      (busy ? '等待回话' : String(activeRequest.value.state || '').toUpperCase() === 'PARTIAL' ? '部分回话已完成' : '')
  }

  const applyDeliberationEvent = event => {
    if (!event || typeof event !== 'object') return false
    if (activeRequest.value?.requestId && event.requestId && event.requestId !== activeRequest.value.requestId) return false
    const reduced = reduceDeliberationEvent({ request: activeRequest.value, turns: activeTurns.value }, event)
    if (reduced.handled) {
      activeRequest.value = reduced.request
      activeTurns.value = reduced.turns
      for (const turn of activeTurns.value) {
        if (!turn?.turnId) continue
        const tracker = turnStates.get(turn.turnId) || { lastDeltaSeq: '0', waitingFinal: false, terminal: false }
        tracker.terminal = isTerminalTurnState(turn.state)
        turnStates.set(turn.turnId, tracker)
      }
      recordObservation('first_status', activeRequest.value)
    }
    return reduced.handled
  }

  const needsUnversionedTurnReadback = event => {
    const requestId = typeof event?.requestId === 'string' ? event.requestId : ''
    const turnId = typeof event?.turnId === 'string' ? event.turnId : (typeof event?.agentDelivery?.turnId === 'string' ? event.agentDelivery.turnId : '')
    if (!requestId || requestId !== activeRequest.value?.requestId || !turnId) return false
    const turn = activeTurns.value.find(item => item.turnId === turnId)
    if (isTerminalTurnState(turn?.state) || !canonicalWireString(turn?.stateVersion, { allowZero: true })) return false
    return !canonicalWireString(event.stateVersion ?? event.agentDelivery?.stateVersion, { allowZero: true })
  }

  const appendHallEventMessage = (event, { deferServerResync = false } = {}) => {
    const needsReadback = needsUnversionedTurnReadback(event)
    const durableHandled = applyDeliberationEvent(event)
    const messageEvent = event?.type === 'agent_message_delta' || event?.type === 'agent_message' || event?.type === 'resync_required' || ['part.processing', 'part.ready', 'part.failed'].includes(event?.type)
    if (!messageEvent) {
      if (durableHandled) syncDurablePresentation()
      return durableHandled
    }
    const state = {
      conversationId: conversationId.value,
      messages: messages.value,
      isAwaitingReply: isAwaitingReply.value,
      isStreaming: isStreaming.value,
      turnStates,
      manageTurnBusy: Boolean(activeRequest.value?.requestId)
    }
    const result = reduceHallEventMessage(state, event, globalStore.getJiacn)
    conversationId.value = state.conversationId
    messages.value = state.messages
    isAwaitingReply.value = state.isAwaitingReply
    isStreaming.value = state.isStreaming
    if (result.type === 'missing_message') {
      void authoritativeResync(event.conversationId, result.type)
      return false
    }
    if (result.type === 'invalid_part' || result.type === 'invalid_delta') {
      void authoritativeResync(event.conversationId, result.type)
      return false
    }
    if (result.type === 'resync_required') {
      if (!deferServerResync) void authoritativeResync(event.conversationId, result.type, { clearCursor: false })
      return event.type === 'resync_required'
    }
    if (result.type === 'late_delta' || result.type === 'duplicate_part') { syncDurablePresentation(); return true }
    if (needsReadback && result.type === 'delta') scheduleAuthoritativeRequestReadback(event.requestId)
    if (needsReadback && event.type === 'agent_message' && ['final', 'duplicate'].includes(result.type)) {
      scheduleAuthoritativeRequestReadback(event.requestId, { immediate: true })
    }
    if (result.type === 'delta') recordObservation('first_delta', activeRequest.value)
    if (result.type === 'final') recordObservation('final_render', activeRequest.value)
    if (result.type === 'final' && result.message?.sender === 'AGENT' &&
        recoveringReplyTurn?.conversationId === event.conversationId) {
      if (recoveringReplyTurn.baselineMessageIds.has(exactMessageId(result.message))) {
        syncDurablePresentation()
        return true
      }
      recoveringReplyTurn = null
    }
    if (result.type === 'final' && result.message?.sender === 'AGENT' && stageActiveBuiltInFinal({
      message: result.message,
      source: 'agent_event',
      toastName: result.toastName,
      replyConversationId: event.conversationId
    })) {
      syncDurablePresentation()
      return true
    }
    if (result.shouldStopPolling && !deliberationBusy(activeRequest.value, activeTurns.value)) stopHallReplyPolling()
    if (result.toastName) showToast(`${result.toastName} 已回话`)
    if (result.type === 'final' && result.message?.sender === 'AGENT') {
      notifyFinalReply({ message: result.message, source: 'agent_event', replyConversationId: event.conversationId })
    }
    syncDurablePresentation()
    return !['ignored', 'invalid_message_id', 'invalid_conversation'].includes(result.type)
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
    if (error?.status === 400 || error?.status === 409 || error?.status === 410 || error?.status === 501) {
      void authoritativeResync(conversationId.value, `sse_${error.status}`, { restartStream: error.status !== 501 })
      return
    }
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
    const streamScope = scopeSnapshot()
    const streamGuard = { generation, authEpoch: authEpoch(), scope: streamScope, signature: scopeSignature(streamScope) }
    const id = conversationId.value
    if (typeof id !== 'string' || !id || hallEventConversationId === id) return
    stopHallEventTransport()
    hallEventConversationId = id
    hallEventController = new AbortController()
    const eventSignal = combineAbortSignals({ signals: [lifecycleController.signal, hallEventController.signal] })
    hallEventSignalCleanup = eventSignal.cleanup

    try {
      const cursor = eventCursors.get(id)
      const response = await fetchHallConversationEvents({
        apiStore,
        url: apiStreamUrl('/chat/conversation/events', { id }),
        headers: cursor ? { 'Last-Event-ID': cursor } : {},
        signal: eventSignal.signal
      })
      if (!guardCurrent(streamGuard) || !response) {
        if (!response && guardCurrent(streamGuard)) hallEventTerminal = true
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
      let pendingServerResyncCursor = ''
      const parser = createHallSseParser({
        conversationId: id,
        onEvent: (event, candidateCursor) => {
          if (!guardCurrent(streamGuard)) return false
          if (event.type === 'stream_ready') { hallEventReconnectFailures = 0; return true }
          if (event.type === 'resync_required') {
            const currentCursor = eventCursors.get(id)
            pendingServerResyncCursor = candidateCursor && (!currentCursor || BigInt(candidateCursor) > BigInt(currentCursor))
              ? candidateCursor
              : ''
          }
          const accepted = appendHallEventMessage(event, { deferServerResync: event.type === 'resync_required' })
          if (accepted) hallEventReconnectFailures = 0
          return accepted
        },
        onCursor: cursorValue => eventCursors.set(id, cursorValue),
        onCommitted: (event, cursorValue) => {
          if (event.type === 'resync_required' && pendingServerResyncCursor === cursorValue) {
            pendingServerResyncCursor = ''
            void authoritativeResync(id, 'resync_required', { clearCursor: false })
          }
        },
        onInvalid: reason => { log.warn('聚义厅事件帧无效', reason); void authoritativeResync(id, reason) }
      })
      while (true) {
        const { done, value } = await reader.read()
        if (done || disposed || generation !== lifecycleGeneration) break
        parser.push(decoder.decode(value, { stream: true }))
      }
      parser.push(decoder.decode())
      parser.finish()
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

  const resetDurableState = () => {
    capabilityAttempt += 1
    capabilityPromise = null
    capabilityState.value = { loaded: false, v2: false, fallbackReason: '旧版传令兼容模式' }
    deliberationStatus.value = ''
    activeRequest.value = null
    activeTurns.value = []
    turnStates.clear()
    eventCursors.clear()
    for (const job of requestReadbackJobs.values()) {
      if (job.timer != null) window.clearTimeout(job.timer)
    }
    requestReadbackJobs.clear()
    requestReadbackInflight.clear()
    authoritativeResyncPromise = null
    activeSendToken = null
    isSubmitting.value = false
  }

  const resetLifecycle = ({ keepBootstrapAdoption = false } = {}) => {
    if (!keepBootstrapAdoption) {
      bootstrapAdoptionToken = null
      isAdoptingBountyBootstrap.value = false
    }
    adoptedBootstrap = null
    lifecycleGeneration += 1
    recoveringReplyTurn = null
    lifecycleController.abort(new DOMException('Hall identity lifecycle reset', 'AbortError'))
    resetDurableState()
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
    scopeDrafts.clear()
    setDraft('')
    if (outgoingMetadata) outgoingMetadata.value = {}
    messages.value = []
    isStreaming.value = false
    isAwaitingReply.value = false
    clearBuiltInTurn()
  }

  stopScopeWatch = watch(
    () => `${chatContext?.value?.conversationScopeType || ''}\u0000${chatContext?.value?.conversationScopeKey || ''}`,
    (nextScope, previousScope) => {
      if (!previousScope || nextScope === previousScope || disposed) return
      scopeDrafts.set(previousScope, { text: draft.value, metadata: { ...(outgoingMetadata?.value || {}) } })
      const restored = scopeDrafts.get(nextScope)
      setDraft(restored?.text || '')
      if (outgoingMetadata) outgoingMetadata.value = { ...(restored?.metadata || {}) }
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
      sameScope(expectedScope) &&
      (!guard.identity || guardCurrent(guard.identity)) &&
      (!guard.adoptionCurrent || guard.adoptionCurrent())
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
          messages.value = (Array.isArray(contentResult?.data) ? contentResult.data : [])
            .map(item => normalizeHallMessage(item, globalStore.getJiacn)).filter(Boolean)
          const recovery = recoveringReplyTurn?.conversationId === exactId ? recoveringReplyTurn : null
          const finalAgentReplies = messages.value.filter(message => message.sender === 'AGENT' && !message.streaming &&
            String(message.content || '').trim() && (!recovery || !recovery.baselineMessageIds.has(exactMessageId(message))))
          loadedConversationScopeSignature = scopeSignature(expectedScope)
          const activeTurnForConversation = Boolean(activeBuiltInTurn && activeBuiltInTurn.conversationId === exactId)
          finalAgentReplies.forEach(message => {
            if (!stageActiveBuiltInFinal({ message, source: 'poll_final', replyConversationId: exactId })) {
              notifyFinalReply({ message, source: 'poll_final', replyConversationId: exactId })
            }
          })
          if (recovery) {
            if (finalAgentReplies.length) {
              recoveringReplyTurn = null
              isAwaitingReply.value = false
              isStreaming.value = false
              stopHallReplyPolling()
            } else {
              isAwaitingReply.value = true
              isStreaming.value = false
              messages.value.push({
                localId: `recovery-${exactId}`, sender: 'SYSTEM',
                content: '正在核对原话头，尚无可核验的最终回话；请勿重复发送。',
                timestamp: Date.now(), streaming: false
              })
            }
          } else if (activeTurnForConversation) {
            isAwaitingReply.value = true
            isStreaming.value = true
          } else if (hasResolvedAgentReply(messages.value)) {
            isAwaitingReply.value = false
            isStreaming.value = false
            stopHallReplyPolling()
          }
          if (activeRequest.value?.requestId) syncDurablePresentation()
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
    if (disposed || isAdoptingBountyBootstrap.value) return Promise.resolve(false)
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
    recoveringReplyTurn = null
    if (notify) showToast('已另起厅前话头')
  }

  const processStream = (eventData) => {
    const raw = String(eventData || '').replace(/^data:\s?/, '').trim()
    let event = null
    try { event = JSON.parse(raw) } catch { /* legacy text stream */ }
    if (event && typeof event === 'object' && !Array.isArray(event)) {
      const durableEvent = Boolean(event.requestId || event.turnId || event.agentDelivery ||
        ['chat_request_replay', 'agent_message_delta', 'agent_message', 'resync_required'].includes(event.type))
      if (durableEvent && !Object.hasOwn(event, 'conversationId') && conversationId.value) event.conversationId = conversationId.value
      if (durableEvent && event.conversationId && conversationId.value && event.conversationId !== conversationId.value) {
        void authoritativeResync(conversationId.value, 'conversation_conflict')
        return false
      }
      // Stream replies can also carry replayed media events. Never consume a scoped
      // part as a status-only request update; the same reducer handles SSE and stream.
      if (isMessagePartEvent(event)) return appendHallEventMessage(event)
      if (event.agentDelivery || event.type === 'chat_request_replay' || (event.requestId && !['agent_message_delta', 'agent_message', 'resync_required'].includes(event.type))) {
        const handled = applyDeliberationEvent(event)
        const deliveryState = String(event.agentDelivery?.state || event.state || '').toUpperCase()
        const actuallyDelivered = event.agentDelivery?.delivered === true || deliveryState === 'DISPATCHED'
        if (event.agentDelivery && (event.agentDelivery.accepted === true || actuallyDelivered)) {
          isSubmitting.value = false
          if (actuallyDelivered) {
            onDelivery?.({ agentId: event.agentDelivery.agentId || event.agentId || '', requestId: event.requestId || '', turnId: event.turnId || event.agentDelivery.turnId || '' })
          }
        }
        if (event.agentDelivery && event.agentDelivery.accepted !== true && !actuallyDelivered) {
          const state = { conversationId: conversationId.value, messages: messages.value, isAwaitingReply: isAwaitingReply.value, isStreaming: isStreaming.value, turnStates, manageTurnBusy: true }
          const result = appendStreamPayload(state, JSON.stringify(event))
          conversationId.value = state.conversationId
          messages.value = state.messages
          if (result.shouldReconnect) { startHallEventStream(); scheduleHallConversationSync(result.conversationId) }
        }
        if (event.agentDelivery?.accepted === true && event.requestId) {
          scheduleAuthoritativeRequestReadback(event.requestId, { immediate: true })
        }
        syncDurablePresentation()
        return handled
      }
      if (event.type === 'agent_message' && activeBuiltInTurn) {
        const needsReadback = needsUnversionedTurnReadback(event)
        isSubmitting.value = false
        applyDeliberationEvent(event)
        const state = { conversationId: conversationId.value, messages: messages.value, isAwaitingReply: isAwaitingReply.value,
          isStreaming: isStreaming.value, turnStates, manageTurnBusy: Boolean(activeRequest.value?.requestId) }
        const result = appendStreamPayload(state, JSON.stringify(event))
        conversationId.value = state.conversationId; messages.value = state.messages
        isAwaitingReply.value = state.isAwaitingReply; isStreaming.value = state.isStreaming
        if (result.type === 'stream_final' && result.message?.content) {
          streamFinalCandidate = { message: result.message, conversationId: result.conversationId, toastName: result.toastName }
          if (needsReadback) scheduleAuthoritativeRequestReadback(event.requestId, { immediate: true })
        }
        syncDurablePresentation()
        return result.type === 'stream_final'
      }
      if (['agent_message_delta', 'agent_message', 'resync_required'].includes(event.type)) {
        isSubmitting.value = false
        return appendHallEventMessage(event)
      }
    }
    const state = {
      conversationId: conversationId.value, messages: messages.value,
      isAwaitingReply: isAwaitingReply.value, isStreaming: isStreaming.value, turnStates,
      manageTurnBusy: Boolean(activeRequest.value?.requestId)
    }
    const result = appendStreamPayload(state, eventData, globalStore.getJiacn)
    conversationId.value = state.conversationId
    messages.value = state.messages
    isAwaitingReply.value = state.isAwaitingReply
    isStreaming.value = state.isStreaming
    if (result.shouldStopPolling && !durableBusy.value) stopHallReplyPolling()
    if (result.type === 'assistant' && result.message?.content) streamFinalCandidate = { message: result.message, conversationId: null, toastName: result.toastName }
    if (result.type === 'stream_final' && result.message?.content) streamFinalCandidate = { message: result.message, conversationId: result.conversationId, toastName: result.toastName }
    if (result.type === 'conversation') { suppressedRestoreScopes.delete(scopeSignature(scopeSnapshot())); resolveBuiltInTurnConversation(result.conversationId) }
    if (result.shouldReconnect) { startHallEventStream(); scheduleHallConversationSync(result.conversationId) }
    return !['invalid_conversation', 'invalid_message_id'].includes(result.type)
  }

  const performHallMessageSend = async ({
    content: explicitContent,
    contextSnapshot,
    source = 'text',
    clearDraftRevision,
    onConversationResolved
  } = {}, sendToken) => {
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
    const sendScope = scopeSnapshot()
    const sendGuard = captureGuard(sendScope)
    let capability
    try {
      capability = typeof chatApi.get === 'function'
        ? await negotiateCapabilities(sendGuard)
        : { loaded: true, v2: false, fallbackReason: '旧版传令兼容模式' }
      abortIfStale(sendGuard)
    } catch (error) {
      if (error?.name === 'AbortError') return false
      throw error
    }
    const metadataSource = isVoiceSend ? (sendContext.outgoingMetadata || {}) : (outgoingMetadata?.value || {})
    const { senderName: _legacySenderName, senderType: _legacySenderType, ...safeMetadataSource } = metadataSource
    const mentionAgentIds = Array.isArray(sendContext.mentionAgentIds) && sendContext.mentionAgentIds.length
      ? sendContext.mentionAgentIds
      : sendContext.targetAgentIds
    const selectedAgentId = isVoiceSend ? sendContext.selectedAgentId : (Object.hasOwn(sendContext, 'selectedAgentId') ? sendContext.selectedAgentId : selectedAgent.value?.agentId)
    const selectedTaskId = isVoiceSend ? sendContext.selectedTaskId : (Object.hasOwn(sendContext, 'selectedTaskId') ? sendContext.selectedTaskId : selectedTask.value?.id)
    const requestId = capability.v2 ? sendToken.requestId : ''
    const requestRevision = '1'
    const interactionHint = inputRefsFor(metadataSource).length ? 'inspect' : 'chat'
    const request = capability.v2 ? { requestId, requestRevision, observations: [] } : null
    recordObservation('send', request)
    const replyGeneration = ++hallReplyGeneration
    const isCurrentReplyTurn = () => guardCurrent(sendGuard) && replyGeneration === hallReplyGeneration
    if (explicitContent === undefined) clearDraft()
    stopHallReplyStreaming()
    clearBuiltInTurn()
    beginBuiltInTurn(requestConversationId)
    localMessageSequence += 1
    messages.value.push({
      localId: `user-${Date.now()}-${localMessageSequence}`,
      sender: 'USER',
      senderName: '你',
      isSelf: true,
      content,
      timestamp: Date.now(),
      streaming: false
    })
    isStreaming.value = false
    isAwaitingReply.value = false
    activeRequest.value = request ? { ...request, state: 'SUBMITTING' } : null
    activeTurns.value = []
    stopHallReplyPolling()

    hallReplyController = new AbortController()
    const replySignal = combineAbortSignals({ signals: [lifecycleController.signal, hallReplyController.signal] })
    hallReplySignalCleanup = replySignal.cleanup

    try {
      const safeMetadata = safeOutgoingMetadata(metadataSource)
      const body = {
        content,
        conversationId: requestConversationId,
        conversationType: 'juyiting',
        conversationScopeType: sendContext.conversationScopeType,
        conversationScopeKey: sendContext.conversationScopeKey,
        targetAgentIds: sendContext.targetAgentIds,
        targetAgentId: sendContext.targetAgentId,
        taskId: sendContext.taskId,
        metadata: {
          ...safeMetadata,
          scene: 'juyiting',
          scopeKey: sendContext.conversationScopeKey,
          selectedAgentId,
          mentionAgentIds,
          participantAgentIds: sendContext.participantAgentIds,
          targetAgentIds: sendContext.targetAgentIds,
          selectedTaskId
        }
      }
      if (capability.v2) Object.assign(body, { requestId, requestRevision, interactionHint,
        clientSeenVector: seenVector(), inputRefs: inputRefsFor(metadataSource) })
      await chatApi.create('/stream', body, {
        responseType: 'stream',
        autoLoading: false,
        timeout: 1800000,
        signal: replySignal.signal,
        headers: capability.v2 ? { 'Idempotency-Key': requestId } : {},
        onStreamOpen: handle => {
          if (!isCurrentReplyTurn()) {
            handle.cancel?.(new DOMException('Stale Hall reply stream', 'AbortError'))
            return
          }
          hallReplyStreamHandle = handle
          if (!capability.v2) {
            if (activeSendToken === sendToken) isSubmitting.value = false
            isStreaming.value = true
            isAwaitingReply.value = true
            deliberationStatus.value = capability.fallbackReason || '旧版传令兼容模式'
          }
        },
        onStream: eventData => {
          if (!isCurrentReplyTurn()) return
          if (!capability.v2) isAwaitingReply.value = true
          const previousConversationId = conversationId.value
          const accepted = processStream(eventData)
          if (accepted) recordObservation('first_response', request)
          if (conversationId.value && conversationId.value !== previousConversationId) onConversationResolved?.(conversationId.value)
        },
        onStreamEnd: () => {
          if (!isCurrentReplyTurn()) return
          hallReplyStreamHandle = null
          if (activeRequest.value?.requestId) syncDurablePresentation()
          else { isStreaming.value = false; deliberationStatus.value = '' }
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
      recordObservation('network_unknown', request)
      isStreaming.value = false
      isAwaitingReply.value = false
      if (capability.v2 && requestId) {
        deliberationStatus.value = '结果未知，正在核对原请求'
        await recoverUnknownRequest(requestId, sendGuard)
      }
      const exactId = exactRuntimeId(conversationId.value)
      const stillBusy = capability.v2 ? deliberationBusy(activeRequest.value, activeTurns.value) : Boolean(exactId)
      recoveringReplyTurn = exactId && stillBusy ? {
        conversationId: exactId,
        baselineMessageIds: new Set(activeBuiltInTurn?.baselineMessageIds || [])
      } : null
      clearBuiltInTurn()
      if (exactId && stillBusy) {
        isAwaitingReply.value = true
        startHallEventStream()
        startHallReplyPolling(exactId)
        // Read only: the POST may have been accepted before the transport failed.
        void loadHallConversationContent(exactId)
      } else {
        isAwaitingReply.value = false
        stopHallReplyPolling()
        if (exactId) void loadHallConversationContent(exactId)
      }
      localMessageSequence += 1
      messages.value.push({
        localId: `system-${Date.now()}-${localMessageSequence}`,
        sender: 'SYSTEM',
        content: exactId && stillBusy
          ? '传令连接中断，正在原话头核对回话；请勿重复发送。'
          : exactId ? '传令连接中断，但原请求已核对为终态。' : '传令连接中断，结果未知；请从话头记录核对，勿直接重发。',
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

  const sendHallMessage = async (options = {}) => {
    const isVoiceSend = options.source === 'voice'
    const content = String(isVoiceSend ? (options.content ?? '') : ((options.content ?? draft.value) || '')).trim()
    if (disposed || !content || isAdoptingBountyBootstrap.value || activeSendToken || isStreaming.value || isAwaitingReply.value || isConversationLoading.value || conversationHistoryDeletingId.value || conversationLoadError.value) return false
    const sendToken = Object.freeze({ requestId: createStableRequestId(), generation: lifecycleGeneration })
    activeSendToken = sendToken
    isSubmitting.value = true
    deliberationStatus.value = '正在提交，等待受理'
    try {
      return await performHallMessageSend(options, sendToken)
    } finally {
      if (activeSendToken === sendToken) {
        activeSendToken = null
        isSubmitting.value = false
        if (!activeRequest.value?.requestId && !isAwaitingReply.value && !isStreaming.value && deliberationStatus.value === '正在提交，等待受理') {
          deliberationStatus.value = ''
        }
      }
    }
  }

  const applyRequestView = (requestView, requestId) => {
    if (!requestView || typeof requestView !== 'object' || requestView.requestId !== requestId) return false
    const requestRevision = canonicalWireString(requestView.requestRevision)
    const requestStateVersion = canonicalWireString(requestView.stateVersion, { allowZero: true })
    const requestConversationId = exactRuntimeId(requestView.conversationId)
    if ((requestView.requestRevision !== undefined && !requestRevision) ||
        (requestView.stateVersion !== undefined && !requestStateVersion) ||
        (requestView.conversationId !== undefined && !requestConversationId)) return false
    const nextTurns = []
    for (const turn of Array.isArray(requestView.turns) ? requestView.turns : []) {
      if (typeof turn?.turnId !== 'string' || !turn.turnId || (turn.requestId && turn.requestId !== requestId)) return false
      const stateVersion = canonicalWireString(turn.stateVersion, { allowZero: true })
      const lastDeltaSeq = canonicalWireString(turn.lastDeltaSeq, { allowZero: true })
      const turnRevision = canonicalWireString(turn.requestRevision)
      const turnConversationId = exactRuntimeId(turn.conversationId)
      const finalMessageId = turn.finalMessageId == null ? null : exactRuntimeId(turn.finalMessageId)
      if ((turn.stateVersion !== undefined && !stateVersion) || (turn.lastDeltaSeq !== undefined && !lastDeltaSeq) ||
          (turn.requestRevision !== undefined && !turnRevision) || (turn.conversationId !== undefined && !turnConversationId) ||
          (turn.finalMessageId != null && !finalMessageId)) return false
      const normalizedTurn = { ...turn, requestId, requestRevision: turnRevision, conversationId: turnConversationId,
        stateVersion, lastDeltaSeq, finalMessageId }
      const previous = activeTurns.value.find(item => item.turnId === turn.turnId)
      const staleVersion = previous?.stateVersion && stateVersion && BigInt(stateVersion) < BigInt(previous.stateVersion)
      if (staleVersion || (isTerminalTurnState(previous?.state) && !isTerminalTurnState(normalizedTurn.state))) {
        nextTurns.push(previous)
      } else {
        nextTurns.push(normalizedTurn)
      }
    }
    activeRequest.value = { ...(activeRequest.value || {}), ...requestView, requestId,
      requestRevision, stateVersion: requestStateVersion, conversationId: requestConversationId }
    activeTurns.value = nextTurns
    for (const turn of activeTurns.value) {
      const tracker = turnStates.get(turn.turnId) || { lastDeltaSeq: '0', waitingFinal: false, terminal: false }
      tracker.lastDeltaSeq = turn.lastDeltaSeq || tracker.lastDeltaSeq
      tracker.terminal = isTerminalTurnState(turn.state)
      tracker.waitingFinal = String(turn.state || '').toUpperCase() === 'RECOVERY_REQUIRED'
      turnStates.set(turn.turnId, tracker)
    }
    syncDurablePresentation()
    return true
  }

  const adoptBountyBootstrap = async (value) => {
    const reference = bountyBootstrapReference(value)
    const contextMatches = () => bountyBootstrapContextMatches(chatContext?.value, selectedTask?.value, selectedAgent?.value, reference)
    if (disposed || !reference || !contextMatches() || isAdoptingBountyBootstrap.value || activeSendToken || isSubmitting.value) return false
    const retry = sameBountyBootstrapReference(adoptedBootstrap, reference) &&
      activeRequest.value?.requestId === reference.initialRequestId && conversationId.value === reference.conversationId
    if (!retry && (isConversationBusy.value || pendingHallConversationLoad ||
        (activeRequest.value?.requestId && activeRequest.value.requestId !== reference.initialRequestId))) return false
    const job = { guard: captureGuard(), requestBefore: activeRequest.value?.requestId || '' }
    bootstrapAdoptionToken = job
    isAdoptingBountyBootstrap.value = true
    const current = () => bootstrapAdoptionToken === job && guardCurrent(job.guard) && contextMatches()
    try {
      const response = await chatApi.get(`/requests/${encodeURIComponent(reference.initialRequestId)}`, {}, {
        autoLoading: false, signal: lifecycleController.signal
      })
      if (!current() || (activeRequest.value?.requestId || '') !== job.requestBefore) return false
      const requestView = validateBountyBootstrapRequest(apiData(response), reference)
      if (!requestView || (retry && !bootstrapReadbackIsCurrent(activeRequest.value, requestView))) return false
      let loadGeneration
      if (!retry) {
        loadGeneration = invalidateConversationLoads()
        invalidateConversationHistoryLoads()
        pendingHallConversationLoad = null
        pendingHallConversationHistoryLoad = null
        conversationHistoryLoading.value = false
        resetLifecycle({ keepBootstrapAdoption: true })
        stopHallEventStream()
        stopHallReplyStreaming()
        stopHallReplyPolling()
        stopHallConversationSync()
        clearBuiltInTurn()
        job.guard = captureGuard()
        conversationId.value = reference.conversationId
        selectedHallConversationId.value = reference.conversationId
        loadedConversationScopeSignature = ''
        messages.value = []
        suppressedRestoreScopes.delete(job.guard.signature)
      } else loadGeneration = invalidateConversationLoads()
      // Keep the accepted server fact even if the separate history read fails.
      if (!applyRequestView(requestView, reference.initialRequestId)) return false
      adoptedBootstrap = reference
      conversationLoadError.value = ''
      const loaded = await loadHallConversationContent(reference.conversationId, {
        loadGeneration, scope: job.guard.scope, selection: true, identity: job.guard,
        adoptionCurrent: () => current() && activeRequest.value?.requestId === reference.initialRequestId
      })
      if (!current()) return false
      if (!loaded && activeRequest.value?.requestId === reference.initialRequestId) {
        conversationLoadError.value = '首轮需求已受理，历史暂不可取；请核对原请求，勿重复生成。'
        isConversationLoading.value = false
      }
      return loaded && activeRequest.value?.requestId === reference.initialRequestId
    } catch (error) {
      if (error?.name !== 'AbortError' && current()) log.warn('核对悬赏议事首轮失败', error)
      return false
    } finally {
      if (bootstrapAdoptionToken === job) {
        bootstrapAdoptionToken = null
        isAdoptingBountyBootstrap.value = false
        isConversationLoading.value = false
      }
    }
  }

  const recoverUnknownRequest = async (requestId, guard = captureGuard()) => {
    const existing = requestReadbackInflight.get(requestId)
    if (existing) return existing
    const promise = (async () => {
      try {
        abortIfStale(guard)
        const response = await chatApi.get(`/requests/${requestId}`, {}, { autoLoading: false, signal: lifecycleController.signal })
        abortIfStale(guard)
        const requestView = apiData(response)
        if (!applyRequestView(requestView, requestId)) return false
        const id = typeof requestView?.conversationId === 'string' ? requestView.conversationId : conversationId.value
        if (id) conversationId.value = id
        if (!deliberationBusy(activeRequest.value, activeTurns.value)) stopHallReplyPolling()
        return true
      } catch (error) {
        if (error?.name === 'AbortError' || !guardCurrent(guard)) return false
        deliberationStatus.value = '需要恢复核对'
        return false
      }
    })()
    requestReadbackInflight.set(requestId, promise)
    try {
      return await promise
    } finally {
      if (requestReadbackInflight.get(requestId) === promise) requestReadbackInflight.delete(requestId)
    }
  }

  const runScheduledRequestReadback = (requestId, job) => {
    if (requestReadbackJobs.get(requestId) !== job || !guardCurrent(job.guard) || activeRequest.value?.requestId !== requestId) {
      requestReadbackJobs.delete(requestId)
      return
    }
    if (job.inFlight) return
    job.timer = null
    job.deltaDirty = false
    const inFlight = recoverUnknownRequest(requestId, job.guard)
    job.inFlight = inFlight
    const settle = () => {
      if (requestReadbackJobs.get(requestId) !== job || job.inFlight !== inFlight) return
      job.inFlight = null
      const forceTrailingImmediate = job.forceTrailingImmediate
      const deltaDirty = job.deltaDirty
      job.forceTrailingImmediate = false
      job.deltaDirty = false
      if (!guardCurrent(job.guard) || activeRequest.value?.requestId !== requestId) {
        requestReadbackJobs.delete(requestId)
        return
      }
      if (forceTrailingImmediate) {
        Promise.resolve().then(() => runScheduledRequestReadback(requestId, job))
      } else if (deltaDirty) {
        job.timer = window.setTimeout(() => runScheduledRequestReadback(requestId, job), HALL_REQUEST_READBACK_DEBOUNCE_MS)
      } else {
        requestReadbackJobs.delete(requestId)
      }
    }
    void inFlight.then(settle, settle)
  }

  const scheduleAuthoritativeRequestReadback = (requestId, { immediate = false } = {}) => {
    if (disposed || typeof requestId !== 'string' || !requestId || activeRequest.value?.requestId !== requestId) return false
    let job = requestReadbackJobs.get(requestId)
    if (!job) {
      job = { timer: null, inFlight: null, forceTrailingImmediate: false, deltaDirty: false, guard: captureGuard() }
      requestReadbackJobs.set(requestId, job)
    } else {
      job.guard = captureGuard()
    }
    if (immediate) {
      if (job.timer != null) window.clearTimeout(job.timer)
      job.timer = null
      job.deltaDirty = false
      if (job.inFlight || requestReadbackInflight.has(requestId)) job.forceTrailingImmediate = true
      if (!job.inFlight) runScheduledRequestReadback(requestId, job)
      return true
    }
    job.deltaDirty = true
    if (job.inFlight) return true
    if (job.timer != null) window.clearTimeout(job.timer)
    job.timer = window.setTimeout(() => runScheduledRequestReadback(requestId, job), HALL_REQUEST_READBACK_DEBOUNCE_MS)
    return true
  }

  const authoritativeResync = (id = conversationId.value, reason = 'resync_required', { restartStream = true, clearCursor = true } = {}) => {
    const exactId = exactRuntimeId(id)
    if (!exactId || disposed) return Promise.resolve(false)
    if (authoritativeResyncPromise) return authoritativeResyncPromise
    const guard = captureGuard()
    if (clearCursor) eventCursors.delete(exactId)
    messages.value = messages.value.filter(message => !message.streaming)
    for (const tracker of turnStates.values()) tracker.waitingFinal = true
    deliberationStatus.value = '正在拉取权威状态'
    stopHallEventTransport()
    if (!restartStream) hallEventTerminal = true
    authoritativeResyncPromise = (async () => {
      try {
        if (activeRequest.value?.requestId) await recoverUnknownRequest(activeRequest.value.requestId, guard)
        abortIfStale(guard)
        if (conversationId.value === exactId) await loadHallConversationContent(exactId)
        abortIfStale(guard)
        if (restartStream) {
          resetHallEventRecovery()
          startHallEventStream()
        } else {
          eventStreamRecovering.value = false
          if (deliberationBusy(activeRequest.value, activeTurns.value)) startHallReplyPolling(exactId)
        }
        return true
      } catch (error) {
        if (error?.name !== 'AbortError' && guardCurrent(guard)) log.warn('聚义厅权威恢复失败', { reason, error })
        return false
      } finally {
        if (guardCurrent(guard)) authoritativeResyncPromise = null
      }
    })()
    return authoritativeResyncPromise
  }

  const authoritativeTurnView = (view, expectedRequestId, expectedTurnId) => {
    if (!view || Array.isArray(view) || typeof view !== 'object' ||
        view.requestId !== expectedRequestId || view.turnId !== expectedTurnId) return null
    const requiredStrings = ['targetAgentId', 'contextSnapshotId', 'dispatchId', 'route', 'state']
    if (requiredStrings.some(key => typeof view[key] !== 'string' || !view[key])) return null
    const requestRevision = canonicalWireString(view.requestRevision)
    const conversationId = exactRuntimeId(view.conversationId)
    const conversationGeneration = canonicalWireString(view.conversationGeneration, { allowZero: true })
    const stateVersion = canonicalWireString(view.stateVersion, { allowZero: true })
    const lastDeltaSeq = canonicalWireString(view.lastDeltaSeq, { allowZero: true })
    const createdAt = canonicalWireString(view.createdAt, { allowZero: true })
    const updatedAt = canonicalWireString(view.updatedAt, { allowZero: true })
    const finalMessageId = view.finalMessageId == null ? null : exactRuntimeId(view.finalMessageId)
    if (!requestRevision || !conversationId || !conversationGeneration || !stateVersion || !lastDeltaSeq ||
        !createdAt || !updatedAt || (view.finalMessageId != null && !finalMessageId)) return null
    if (view.terminalReason != null && typeof view.terminalReason !== 'string') return null
    return { ...view, requestRevision, conversationId, conversationGeneration, stateVersion, lastDeltaSeq,
      finalMessageId, createdAt, updatedAt }
  }

  const cancelDeliberation = async target => {
    const request = activeRequest.value
    const selectedTarget = target && typeof target === 'object' ? target : durableCancelTarget.value
    if (!request?.requestId || !selectedTarget) return false
    const guard = captureGuard()
    try {
      let response
      if (selectedTarget.turnId) {
        const turn = activeTurns.value.find(item => item.turnId === selectedTarget.turnId)
        if (!turn || !isPendingTurn(turn)) return true
        const expectedStateVersion = canonicalWireString(turn.stateVersion, { allowZero: true })
        if (!expectedStateVersion) return false
        response = await chatApi.post(`/turns/${turn.turnId}/cancel`, { expectedStateVersion }, { autoLoading: false, signal: lifecycleController.signal })
        abortIfStale(guard)
        const view = authoritativeTurnView(apiData(response), request.requestId, turn.turnId)
        if (!view) return false
        if (BigInt(view.stateVersion) <= BigInt(expectedStateVersion)) return false
        if (!applyDeliberationEvent(view)) return false
        const applied = activeTurns.value.find(item => item.turnId === turn.turnId)
        if (applied?.stateVersion !== view.stateVersion || applied?.state !== view.state) return false
        activeTurns.value = activeTurns.value.map(item => item.turnId === turn.turnId ? view : item)
        const tracker = turnStates.get(turn.turnId) || { lastDeltaSeq: '0', waitingFinal: false, terminal: false }
        tracker.lastDeltaSeq = view.lastDeltaSeq
        tracker.waitingFinal = view.state === 'RECOVERY_REQUIRED'
        tracker.terminal = isTerminalTurnState(view.state)
        turnStates.set(turn.turnId, tracker)
      } else if (selectedTarget.allPending === true) {
        response = await chatApi.post(`/requests/${request.requestId}/cancel?allPending=true`, { allPending: true }, { autoLoading: false, signal: lifecycleController.signal })
        abortIfStale(guard)
        if (!applyRequestView(apiData(response), request.requestId)) return false
      } else return false
      syncDurablePresentation()
      if (deliberationBusy(activeRequest.value, activeTurns.value)) deliberationStatus.value = '取消请求已提交'
      return true
    } catch (error) {
      if (error?.name !== 'AbortError' && guardCurrent(guard)) log.warn('取消聚义厅回话失败', error)
      return false
    }
  }

  const cancelLegacyHallReply = async () => {
    if (!canCancelLegacy.value) return false
    const id = exactRuntimeId(conversationId.value)
    if (id && typeof chatApi.post === 'function') {
      try { await chatApi.post('/stop_stream', { conversationId: id }, { autoLoading: false, signal: lifecycleController.signal }) } catch (error) {
        if (error?.name !== 'AbortError') log.warn('停止旧版聚义厅回话失败', error)
      }
    }
    cancelHallReplyTurn('legacy_user_cancelled')
    deliberationStatus.value = '已停止旧版回话等待'
    return true
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
    adoptBountyBootstrap,
    isAdoptingBountyBootstrap,
    cancelHallReplyTurn,
    cancelDeliberation,
    cancelLegacyHallReply,
    canCancelDurable,
    canCancelLegacy,
    durableCancelTarget,
    activeRequest,
    activeTurns,
    capabilityState,
    chatConnectionStatus,
    deliberationStatus,
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
    isSubmitting,
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

function createStableRequestId () {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
