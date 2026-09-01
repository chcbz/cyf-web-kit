import { computed, ref } from 'vue'
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

const runtimeEnv = import.meta.env ?? {}

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

  const startHallEventStream = async () => {
    if (disposed) return
    const generation = lifecycleGeneration
    const id = conversationId.value
    if (typeof id !== 'string' || !id || hallEventConversationId === id) return
    stopHallEventStream()
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
        hallEventController = null
        return
      }
      if (!response.ok || !response.body) {
        throw new Error(`Hall event stream failed: ${response.status}`)
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
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError' && !disposed && generation === lifecycleGeneration) {
        log.warn('聚义厅实时消息连接中断', error)
        eventStreamRecovering.value = true
        hallEventReconnectTimer = window.setTimeout(() => {
          if (disposed || generation !== lifecycleGeneration) return
          hallEventConversationId = ''
          startHallEventStream()
        }, 2500)
      }
    } finally {
      if (generation === lifecycleGeneration) {
        hallEventSignalCleanup?.()
        hallEventSignalCleanup = null
      }
    }
  }

  const stopHallEventStream = () => {
    if (hallEventReconnectTimer) window.clearTimeout(hallEventReconnectTimer)
    hallEventReconnectTimer = null
    if (hallEventController) hallEventController.abort(new DOMException('Hall event stream stopped', 'AbortError'))
    hallEventController = null
    hallEventSignalCleanup?.()
    hallEventSignalCleanup = null
    hallEventConversationId = ''
    eventStreamRecovering.value = false
  }

  const resetLifecycle = () => {
    lifecycleGeneration += 1
    lifecycleController.abort(new DOMException('Hall identity lifecycle reset', 'AbortError'))
    if (!disposed) lifecycleController = new AbortController()
  }

  const clearHallConversationIdentityState = () => {
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

  const unregisterIdentityCleanup = registerIdentityCleanup(clearHallConversationIdentityState)
  const disposeHallConversation = () => {
    if (disposed) return
    disposed = true
    clearHallConversationIdentityState()
    unregisterIdentityCleanup()
  }

  const loadHallConversationContent = async (id = conversationId.value) => {
    if (disposed || !id) return
    const generation = lifecycleGeneration
    try {
      await chatApi.getById('/conversation/content', id, {
        autoLoading: false,
        signal: lifecycleController.signal,
        onSuccess: (contentResult) => {
          if (disposed || generation !== lifecycleGeneration) return
          messages.value = (contentResult?.data || []).map(normalizeHallMessage).filter(Boolean)
          const finalAgentReplies = messages.value.filter(message => message.sender === 'AGENT' && !message.streaming && String(message.content || '').trim())
          const activeTurnForConversation = Boolean(activeBuiltInTurn && activeBuiltInTurn.conversationId === id)
          finalAgentReplies.forEach(message => {
            if (!stageActiveBuiltInFinal({ message, source: 'poll_final', replyConversationId: id })) {
              notifyFinalReply({ message, source: 'poll_final', replyConversationId: id })
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
          startHallEventStream()
        }
      })
    } catch (error) {
      if (error?.name !== 'AbortError' && !disposed && generation === lifecycleGeneration) {
        log.warn('加载聚义厅会话内容失败', error)
      }
    }
  }

  const loadHallMessages = async () => {
    if (disposed) return
    const generation = lifecycleGeneration
    stopHallEventStream()
    stopHallReplyStreaming()
    stopHallReplyPolling()
    conversationId.value = ''
    messages.value = []
    isAwaitingReply.value = false
    isStreaming.value = false
    try {
      await chatApi.list('/conversation/list', {
        pageNum: 1,
        pageSize: 1,
        orderBy: 'update_time desc',
        search: {
          jiacn: globalStore.getJiacn,
          conversationType: 'juyiting',
          conversationScopeType: chatContext.value.conversationScopeType,
          conversationScopeKey: chatContext.value.conversationScopeKey
        }
      }, {
        autoLoading: false,
        signal: lifecycleController.signal,
        onSuccess: async (result) => {
          if (disposed || generation !== lifecycleGeneration) return
          const hallConversation = result?.data?.[0]
          if (!hallConversation) return
          if (typeof hallConversation.id !== 'string' || !hallConversation.id) return
          conversationId.value = hallConversation.id
          await loadHallConversationContent(conversationId.value)
        }
      })
    } catch (error) {
      if (error?.name !== 'AbortError' && !disposed && generation === lifecycleGeneration) {
        log.warn('加载聚义厅会话失败', error)
      }
    }
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

  const newHallConversation = () => {
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
    showToast('已另起厅前话头')
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
    if (result.type === 'conversation') resolveBuiltInTurnConversation(result.conversationId)
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
    if (disposed || !content || isStreaming.value) return false
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
          if (disposed || generation !== lifecycleGeneration) {
            handle.cancel?.(new DOMException('Stale Hall reply stream', 'AbortError'))
            return
          }
          hallReplyStreamHandle = handle
        },
        onStream: eventData => {
          if (disposed || generation !== lifecycleGeneration) return
          const previousConversationId = conversationId.value
          processStream(eventData)
          if (conversationId.value && conversationId.value !== previousConversationId) onConversationResolved?.(conversationId.value)
        },
        onStreamEnd: () => {
          if (disposed || generation !== lifecycleGeneration) return
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
          if (disposed || generation !== lifecycleGeneration || requestError?.name === 'AbortError') return
          throw requestError || new Error(message)
        }
      })
      if (disposed || generation !== lifecycleGeneration) return false
      if (isVoiceSend && draftRevision.value === clearDraftRevision) clearDraft()
      if (outgoingMetadata) outgoingMetadata.value = {}
      return true
    } catch (error) {
      if (error?.name === 'AbortError' || disposed || generation !== lifecycleGeneration) return false
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
      if (generation === lifecycleGeneration) {
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
    chatConnectionStatus,
    conversationId,
    clearDraft,
    disposeHallConversation,
    draft,
    draftRevision,
    eventStreamRecovering,
    insertAgentMention,
    isAwaitingReply,
    isStreaming,
    loadHallMessages,
    mentionAgent,
    messages,
    newHallConversation,
    pendingAgentName,
    replyEventSequence,
    sendHallMessage,
    senderText,
    setDraft,
    startAgentConversation,
    stopHallEventStream,
    stopHallReplyPolling,
    stopHallReplyStreaming
  }
}
