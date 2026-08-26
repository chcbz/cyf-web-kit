<template>
  <div class="chat-container">
    <div class="chat-main-content">
      <ChatMessageList
        ref="messageListRef"
        :messages="messages"
        :should-show-empty-state="shouldShowEmptyState"
        :random-phrase="randomPhrase"
        :conversation-type="conversationType"
        @scroll="handleScroll"
      />
      <ChatInput
        ref="chatInputRef"
        :is-streaming="isStreaming"
        :is-loading="isLoading"
        :conversation-type="conversationType"
        @send="sendMessage"
        @cancel="stopStream"
      />
    </div>

    <div :class="['chat-overlay', { show: showSidebar }]" @click="toggleSidebar"></div>
    <ChatSidebar
      v-if="!isJuyiting"
      :show-sidebar="showSidebar"
      :conversations="conversations"
      :active-conversation-id="conversationId"
      :format-date="utilStore.formatDate"
      @new-conversation="generateNewConversationId"
      @select-conversation="loadConversation"
      @delete-conversation="deleteConversation"
      @update-title="updateConversationTitle"
      @close-sidebar="toggleSidebar"
    />
  </div>
</template>

<script setup>
import { marked } from 'marked'
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useUtilStore } from '../../stores/util'
import { useGlobalStore } from '../../stores/global'
import { useApiStore } from '../../stores/api'
import { useAgentStore } from '../../stores/agent'
import { useI18n } from 'vue-i18n'
import { chatApi, phraseApi } from '../../composables/useHttp'
import { log } from '../../utils/logger'
import { fetchChatConversationEvents } from '../../utils/authenticatedSse.js'
import { registerIdentityCleanup } from '../../utils/identityLifecycle.js'
import { combineAbortSignals } from '../../utils/abortSignals.js'

// 导入子组件
import ChatMessageList from './ChatMessageList.vue'
import ChatInput from './ChatInput.vue'
import ChatSidebar from './ChatSidebar.vue'

// 配置marked
marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  sanitize: false // 禁用marked内置的sanitize，使用DOMPurify
})

// 错误类型常量 (预留)
// const ERROR_TYPES = {
//   NETWORK: 'network',
//   SERVER: 'server',
//   VALIDATION: 'validation'
// }

// 消息类型常量 (预留)
// const MESSAGE_TYPES = {
//   USER: 'user',
//   BOT: 'bot',
//   SYSTEM: 'system'
// }

// 响应式状态
const messages = ref([])
const messageListRef = ref(null)
const chatInputRef = ref(null)
const isLoading = ref(false)
const isStreaming = ref(false)
const readerRef = ref(null)
const error = ref(null)
const conversationId = ref('')
const conversations = ref([])
const showSidebar = ref(false)
const randomPhrase = ref('输入您的问题或想法，我将尽力为您解答') // 默认文本

// 路由参数
const route = useRoute()
const conversationType = ref(route.query.conversationType || '')

// 工具函数
const utilStore = useUtilStore()
const globalStore = useGlobalStore()
const apiStore = useApiStore()
const agentStore = useAgentStore()
const { t } = useI18n()
let conversationEventController = null
let conversationEventReconnectTimer = null
let activeEventConversationId = ''
let deleteConversationRetryTimers = []
let chatLifecycleGeneration = 0
let chatLifecycleController = new AbortController()
let chatDisposed = false
let conversationEventSignalCleanup = null
let chatStreamController = null
let chatStreamSignalCleanup = null

// 计算属性
const hasMessages = computed(() => messages.value.length > 0)
const isJuyiting = computed(() => conversationType.value === 'juyiting')
// sortedConversations 预留用于未来排序功能
// const sortedConversations = computed(() =>
//   [...conversations.value].sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
// )
const shouldShowEmptyState = computed(() => !hasMessages.value && !isLoading.value)

const apiStreamUrl = (path, params = {}) => {
  const baseURL = import.meta.env.VITE_API_BASE_URL || ''
  const requestPath = baseURL
    ? `${baseURL}${path.startsWith('/') ? path : `/${path}`}`
    : path
  const searchParams = new URLSearchParams(params).toString()
  return searchParams ? `${requestPath}?${searchParams}` : requestPath
}

const normalizeLoadedMessage = (message, currentConversationId) => {
  const senderType = message.senderType || message.messageType || ''
  return {
    sender: senderType === 'agent' ? 'AGENT' : (message.messageType || 'USER'),
    content: message.content || '',
    timestamp: message.createTime || new Date().getTime(),
    conversationId: currentConversationId,
    localId: `${message.id || `${currentConversationId}-${message.createTime || Date.now()}`}`,
    senderName: message.senderName || '',
    senderAvatar: message.senderAvatar || '',
    senderType
  }
}

const appendConversationEventMessage = (event = {}) => {
  if (!event.content || event.conversationId?.toString() !== conversationId.value?.toString()) return

  const localId = `${event.messageId || `${event.senderType || 'event'}-${event.agentId || 'unknown'}-${event.timestamp || Date.now()}`}`
  if (messages.value.some(message => message.localId === localId)) return

  messages.value.push({
    sender: event.senderType === 'agent' ? 'AGENT' : (event.messageType || 'ASSISTANT'),
    content: event.content,
    timestamp: event.timestamp || Date.now(),
    conversationId: conversationId.value,
    localId,
    senderName: event.senderName || '',
    senderAvatar: event.senderAvatar || '',
    senderType: event.senderType || ''
  })
  scrollToBottom()
}

const stopConversationEventStream = () => {
  if (conversationEventReconnectTimer) {
    window.clearTimeout(conversationEventReconnectTimer)
  }
  conversationEventReconnectTimer = null
  if (conversationEventController) {
    conversationEventController.abort(new DOMException('Chat event stream stopped', 'AbortError'))
  }
  conversationEventController = null
  conversationEventSignalCleanup?.()
  conversationEventSignalCleanup = null
  activeEventConversationId = ''
}

const clearDeleteConversationRetries = () => {
  deleteConversationRetryTimers.forEach(timer => window.clearTimeout(timer))
  deleteConversationRetryTimers = []
}

const resetChatLifecycle = () => {
  chatLifecycleGeneration += 1
  chatLifecycleController.abort(new DOMException('Chat identity lifecycle reset', 'AbortError'))
  if (!chatDisposed) chatLifecycleController = new AbortController()
}

const cancelChatStream = reason => {
  chatStreamController?.abort(reason)
  chatStreamController = null
  readerRef.value?.cancel?.(reason)
  readerRef.value = null
  chatStreamSignalCleanup?.()
  chatStreamSignalCleanup = null
}

const clearChatIdentityState = () => {
  resetChatLifecycle()
  stopConversationEventStream()
  clearDeleteConversationRetries()
  cancelChatStream(new DOMException('Chat identity cleared', 'AbortError'))
  isLoading.value = false
  isStreaming.value = false
  error.value = null
  messages.value = []
  conversations.value = []
  conversationId.value = ''
}

const unregisterIdentityCleanup = registerIdentityCleanup(clearChatIdentityState)

const startConversationEventStream = async () => {
  if (chatDisposed || !isJuyiting.value) return
  const generation = chatLifecycleGeneration
  const id = conversationId.value?.toString()
  if (!id || activeEventConversationId === id) return

  stopConversationEventStream()
  activeEventConversationId = id
  conversationEventController = new AbortController()
  const eventSignal = combineAbortSignals({ signals: [chatLifecycleController.signal, conversationEventController.signal] })
  conversationEventSignalCleanup = eventSignal.cleanup

  try {
    const response = await fetchChatConversationEvents({
      apiStore,
      url: apiStreamUrl('/chat/conversation/events', { id }),
      signal: eventSignal.signal
    })
    if (chatDisposed || generation !== chatLifecycleGeneration || !response) {
      conversationEventController = null
      return
    }
    if (!response.ok || !response.body) {
      throw new Error(`Conversation event stream failed: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done || chatDisposed || generation !== chatLifecycleGeneration) break
      buffer += decoder.decode(value, { stream: true })
      let eventEndIndex
      while ((eventEndIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.substring(0, eventEndIndex).trim()
        buffer = buffer.substring(eventEndIndex + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        appendConversationEventMessage(JSON.parse(payload))
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError' && !chatDisposed && generation === chatLifecycleGeneration) {
      log.warn('聚义厅会话事件流中断:', error)
      conversationEventReconnectTimer = window.setTimeout(() => {
        if (chatDisposed || generation !== chatLifecycleGeneration) return
        activeEventConversationId = ''
        startConversationEventStream()
      }, 2500)
    }
  } finally {
    if (generation === chatLifecycleGeneration) {
      conversationEventSignalCleanup?.()
      conversationEventSignalCleanup = null
    }
  }
}

// 初始化
const initializeApp = async () => {
  if (chatDisposed) return
  const generation = chatLifecycleGeneration
  // 同步路由查询参数
  conversationType.value = route.query.conversationType || ''

  if (isJuyiting.value) {
    globalStore.setTitle(t('juyiting.title'))
    globalStore.setShowMore(false)
  } else {
    globalStore.setTitle(t('chat.new_session'))
    globalStore.setShowMore(true)
  }
  globalStore.setShowBack(false)

  // 加载随机短语
  await loadRandomPhrase(generation)
  if (chatDisposed || generation !== chatLifecycleGeneration) return

  loadConversations()
}

// 加载随机短语
const loadRandomPhrase = async (generation = chatLifecycleGeneration) => {
  if (chatDisposed) return
  try {
    await phraseApi.list('/get/random', {
      jiacn: globalStore.getJiacn
    }, {
      signal: chatLifecycleController.signal,
      onSuccess: (data) => {
        if (chatDisposed || generation !== chatLifecycleGeneration) return
        if (data && data.data) {
          randomPhrase.value = data.data.content
          void phraseApi.getById('/read', data.data.id, { signal: chatLifecycleController.signal })
            .catch(error => {
              if (error?.name !== 'AbortError' && !chatDisposed && generation === chatLifecycleGeneration) {
                log.warn('记录随机短语读取失败:', error)
              }
            })
        }
      },
      onError: (error) => {
        if (error?.name !== 'AbortError' && !chatDisposed && generation === chatLifecycleGeneration) {
          log.warn('从服务端加载会话失败:', error)
        }
      }
    })
  } catch (error) {
    if (error?.name !== 'AbortError' && !chatDisposed && generation === chatLifecycleGeneration) {
      log.warn('加载随机短语失败:', error)
    }
  }
}

// 会话管理函数
const loadConversations = async () => {
  if (chatDisposed) return
  const generation = chatLifecycleGeneration
  try {
    const searchFilter = { jiacn: globalStore.getJiacn }
    if (conversationType.value) searchFilter.conversationType = conversationType.value
    await chatApi.list('/conversation/list', {
      pageNum: 1,
      pageSize: 100,
      orderBy: 'update_time desc',
      search: searchFilter
    }, {
      autoLoading: false,
      signal: chatLifecycleController.signal,
      onSuccess: (data) => {
        if (chatDisposed || generation !== chatLifecycleGeneration) return
        if (data && data.data) {
          conversations.value = data.data.map(conv => ({
            id: conv.id.toString(),
            title: conv.title || '新会话',
            lastUpdated: conv.updateTime,
            messages: [],
            conversationType: conv.conversationType || conversationType.value
          }))
          if (isJuyiting.value && conversations.value.length) loadConversation(conversations.value[0].id)
        }
      },
      onError: error => {
        if (error?.name !== 'AbortError' && !chatDisposed && generation === chatLifecycleGeneration) {
          log.warn('从服务端加载会话失败:', error)
        }
      }
    })
  } catch (error) {
    if (error?.name !== 'AbortError' && !chatDisposed && generation === chatLifecycleGeneration) {
      log.warn('加载会话失败:', error)
    }
  }
}

const loadConversation = async (id) => {
  if (chatDisposed) return
  const generation = chatLifecycleGeneration
  const conversation = conversations.value.find((item) => item.id === id)
  if (!conversation) return
  conversationId.value = id
  globalStore.setTitle(conversation.title)
  try {
    await chatApi.getById('/conversation/content', id, {
      autoLoading: false,
      signal: chatLifecycleController.signal,
      onSuccess: (data) => {
        if (chatDisposed || generation !== chatLifecycleGeneration) return
        const msgList = data?.data || []
        messages.value = msgList.map(msg => normalizeLoadedMessage(msg, id))
        scrollToBottom()
        startConversationEventStream()
      },
      onError: error => {
        if (error?.name !== 'AbortError' && !chatDisposed && generation === chatLifecycleGeneration) {
          log.warn('从服务端加载会话内容失败:', error)
          messages.value = []
        }
      }
    })
  } catch (error) {
    if (error?.name !== 'AbortError' && !chatDisposed && generation === chatLifecycleGeneration) {
      log.warn('加载会话内容失败:', error)
      messages.value = []
    }
  }
}

const generateNewConversationId = () => {
  stopConversationEventStream()
  if (isJuyiting.value) {
    globalStore.setTitle(t('juyiting.title'))
  } else {
    globalStore.setTitle(t('chat.new_session'))
  }
  conversationId.value = ''
  messages.value = []
}

// 消息处理函数
const updateBotMessage = async (content) => {
  const lastMessage = messages.value[messages.value.length - 1]
  let botMessage

  if (lastMessage?.sender === 'ASSISTANT') {
    lastMessage.content += content
    botMessage = lastMessage
  } else {
    botMessage = {
      sender: 'ASSISTANT',
      content,
      timestamp: new Date().getTime(),
      senderType: 'assistant'
    }
    messages.value.push(botMessage)
  }
  scrollToBottom()
}

const processBotResponse = (eventData) => {
  log.debug('Received event data:', eventData)

  // 处理多种可能的数据格式
  let payload = ''

  // 如果是SSE格式 (data: {...})
  if (eventData.startsWith('data:')) {
    for (const line of eventData.split(/\n/)) {
      if (line.startsWith('data:')) {
        payload += line.slice(5).trim() + '\n'
      }
    }
  } else {
    // 如果不是SSE格式，直接使用原始数据
    payload = eventData
  }

  payload = payload.trim()

  if (payload === '[DONE]' || payload === '[EOM]' || !payload) {
    log.debug('Stream completed or empty payload')
    return
  }

  try {
    // 尝试解析为JSON
    const data = JSON.parse(payload)
    if (data.v) {
      updateBotMessage(data.v)
    } else if (data.agentDelivery) {
      if (data.agentDelivery.delivered === false) {
        messages.value = [
          ...messages.value,
          {
            sender: 'SYSTEM',
            content: '当前未连接可回话的 Agent，请稍后再试',
            isError: true,
            timestamp: new Date().getTime(),
            senderType: 'system'
          }
        ]
      }
    } else if (data.conversationId) {
      const nextConversationId = data.conversationId?.toString() || ''
      const shouldReconnect = isJuyiting.value && nextConversationId && nextConversationId !== conversationId.value?.toString()
      conversationId.value = nextConversationId
      if (shouldReconnect) {
        startConversationEventStream()
        loadConversations()
      }
    } else if (data.t) {
      globalStore.setTitle(data.t)
      loadConversations()
    } else if (data.senderType && data.content) {
      // 处理带 sender 元数据的消息（聚义厅 agent 消息等）
      const msg = {
        sender: data.senderType === 'agent' ? 'AGENT' : (data.senderType === 'system' ? 'SYSTEM' : 'ASSISTANT'),
        content: data.content,
        timestamp: new Date().getTime(),
        localId: `${data.messageId || `${data.senderType || 'msg'}-${data.timestamp || Date.now()}`}`,
        senderType: data.senderType,
        senderName: data.senderName || '',
        senderAvatar: data.senderAvatar || ''
      }
      messages.value.push(msg)
      scrollToBottom()
    } else {
      log.debug('No message content found in JSON:', data)
    }
  } catch {
    log.debug('Not JSON, treating as plain text:', payload)
    // 如果不是JSON，直接作为文本显示
    updateBotMessage(payload)
  }
}

// 消息发送和流处理
const sendMessage = async (message) => {
  if (chatDisposed || !message || isLoading.value) return
  const generation = chatLifecycleGeneration

  isLoading.value = true
  isStreaming.value = true

  cancelChatStream(new DOMException('Chat stream replaced', 'AbortError'))
  chatStreamController = new AbortController()
  const streamSignal = combineAbortSignals({ signals: [chatLifecycleController.signal, chatStreamController.signal] })
  chatStreamSignalCleanup = streamSignal.cleanup

  try {
    messages.value = [
      ...messages.value,
      {
        sender: 'USER',
        content: message,
        timestamp: new Date().getTime(),
        conversationId: conversationId.value,
        localId: `user-${Date.now()}`,
        senderType: 'user'
      }
    ]
    scrollToBottom()

    await chatApi.create('/stream', {
      content: message,
      conversationId: conversationId.value,
      conversationType: conversationType.value,
      senderType: 'user',
      senderName: globalStore.getJiacn || '用户',
      metadata: conversationType.value === 'juyiting' && agentStore.selectedAgentId
        ? { selectedAgentId: agentStore.selectedAgentId }
        : undefined
    }, {
      responseType: 'stream',
      autoLoading: false,
      timeout: 1800000,
      signal: streamSignal.signal,
      onStreamOpen: handle => {
        if (chatDisposed || generation !== chatLifecycleGeneration) {
          handle.cancel?.(new DOMException('Stale Chat stream', 'AbortError'))
          return
        }
        readerRef.value = handle
      },
      onStream: eventData => {
        if (chatDisposed || generation !== chatLifecycleGeneration) return
        log.debug('Stream data received:', eventData)
        processBotResponse(eventData)
      },
      onStreamEnd: () => {
        if (chatDisposed || generation !== chatLifecycleGeneration) return
        log.debug('Stream ended')
        isStreaming.value = false
        isLoading.value = false
        readerRef.value = null
      },
      onError: (errorMessage, requestError) => {
        if (chatDisposed || generation !== chatLifecycleGeneration || requestError?.name === 'AbortError') return
        log.error('发送消息失败:', errorMessage)
        throw requestError || new Error(errorMessage)
      }
    })
  } catch (requestError) {
    if (requestError?.name === 'AbortError' || chatDisposed || generation !== chatLifecycleGeneration) return
    log.error('发送消息失败:', requestError)
    error.value = requestError?.message || '发送消息失败'
    isStreaming.value = false
    isLoading.value = false
    messages.value = [
      ...messages.value,
      {
        sender: 'SYSTEM',
        content: '发送消息失败，请稍后重试',
        isError: true,
        timestamp: new Date().getTime(),
        senderType: 'system'
      }
    ]
  } finally {
    if (generation === chatLifecycleGeneration) {
      chatStreamController = null
      readerRef.value = null
      chatStreamSignalCleanup?.()
      chatStreamSignalCleanup = null
    }
  }
}

const stopStream = async () => {
  if (!isStreaming.value && !readerRef.value && !chatStreamController) return
  cancelChatStream(new DOMException('Chat request cancelled', 'AbortError'))
  if (chatDisposed) return
  messages.value = [
    ...messages.value,
    {
      sender: 'SYSTEM',
      content: '已取消当前请求',
      isInfo: true,
      timestamp: new Date().getTime(),
      senderType: 'system'
    }
  ]
  isStreaming.value = false
  isLoading.value = false
}

// 处理滚动事件
const handleScroll = () => {
  // 这里可以处理滚动事件，如果需要的话
  // 目前我们不需要做特殊处理，因为滚动逻辑已经在ChatMessageList组件中处理了
}

// UI 交互函数
const scrollToBottom = () => {
  if (messageListRef.value) {
    messageListRef.value.scrollToBottom()
  }
}

const toggleSidebar = () => {
  if (!isJuyiting.value) {
    globalStore.toggleRightSidebar()
  }
}

// 删除会话（带重试机制）
const scheduleDeleteConversationRetry = (id, retryCount, generation) => {
  const timer = window.setTimeout(() => {
    deleteConversationRetryTimers = deleteConversationRetryTimers.filter(item => item !== timer)
    if (chatDisposed || generation !== chatLifecycleGeneration) return
    deleteConversation(id, retryCount)
  }, 1000 * retryCount)
  deleteConversationRetryTimers.push(timer)
}

const deleteConversation = async (id, retryCount = 0) => {
  if (chatDisposed) return
  const generation = chatLifecycleGeneration
  try {
    log.info('删除会话:', id)
    await chatApi.delete('/conversation/delete', id, {
      signal: chatLifecycleController.signal,
      onSuccess: () => {
        if (chatDisposed || generation !== chatLifecycleGeneration) return
        log.debug('删除会话成功:', id)
        const index = conversations.value.findIndex((c) => c.id === id)
        if (index !== -1) {
          conversations.value.splice(index, 1)
        }
        if (id === conversationId.value) {
          log.debug('当前会话被删除，生成新会话ID')
          generateNewConversationId()
        }
      },
      onError: (errorMessage, requestError) => {
        if (requestError?.name === 'AbortError' || chatDisposed || generation !== chatLifecycleGeneration) return
        log.error('删除会话失败:', errorMessage)

        const lastMessage = messages.value[messages.value.length - 1]
        if (!lastMessage || !lastMessage.isError) {
          messages.value = [
            ...messages.value,
            {
              sender: 'SYSTEM',
              content: `删除会话失败${retryCount > 0 ? ` (重试 ${retryCount}/3)` : ''}`,
              isError: true,
              timestamp: new Date().getTime(),
              senderType: 'system'
            }
          ]
        }

        if (retryCount < 3) {
          scheduleDeleteConversationRetry(id, retryCount + 1, generation)
        }
      }
    })
  } catch (error) {
    if (error?.name === 'AbortError' || chatDisposed || generation !== chatLifecycleGeneration) return
    log.error('删除会话失败:', error)

    const lastMessage = messages.value[messages.value.length - 1]
    if (!lastMessage || !lastMessage.isError) {
      messages.value = [
        ...messages.value,
        {
          sender: 'SYSTEM',
          content: `删除会话失败${retryCount > 0 ? ` (重试 ${retryCount}/3)` : ''}`,
          isError: true,
          timestamp: new Date().getTime(),
          senderType: 'system'
        }
      ]
    }

    if (retryCount < 3) {
      scheduleDeleteConversationRetry(id, retryCount + 1, generation)
    }
  }
}

// 修改会话标题
const updateConversationTitle = async (id, newTitle) => {
  if (chatDisposed) return
  const generation = chatLifecycleGeneration
  try {
    log.info('修改会话标题:', id, newTitle)
    await chatApi.update('/conversation/update', { id, title: newTitle }, {
      autoLoading: false,
      signal: chatLifecycleController.signal,
      onSuccess: () => {
        if (chatDisposed || generation !== chatLifecycleGeneration) return
        log.debug('修改会话标题成功:', id)
        // 更新本地会话列表中的标题
        const conversation = conversations.value.find((c) => c.id === id)
        if (conversation) {
          conversation.title = newTitle
        }
        // 如果当前正在查看这个会话，也更新全局标题
        if (id === conversationId.value) {
          globalStore.setTitle(newTitle)
        }
      },
      onError: (errorMessage, requestError) => {
        if (requestError?.name === 'AbortError' || chatDisposed || generation !== chatLifecycleGeneration) return
        log.error('修改会话标题失败:', errorMessage)
        messages.value = [
          ...messages.value,
          {
            sender: 'SYSTEM',
            content: '修改标题失败',
            isError: true,
            timestamp: new Date().getTime(),
            senderType: 'system'
          }
        ]
      }
    })
  } catch (error) {
    if (error?.name !== 'AbortError' && !chatDisposed && generation === chatLifecycleGeneration) {
      log.error('修改会话标题失败:', error)
    }
  }
}

// 监听全局store中的右侧边栏状态变化
watch(
  () => globalStore.showRightSidebar,
  (newValue) => {
    if (!isJuyiting.value) {
      showSidebar.value = newValue
    }
  }
)

// 监听路由查询参数变化（处理从聚义厅跳转过来的情况）
watch(
  () => route.query.conversationType,
  (newType) => {
    if (newType !== conversationType.value) {
      stopConversationEventStream()
      conversationType.value = newType || ''
      // 重新初始化以加载对应类型的会话
      initializeApp()
    }
  }
)

// 生命周期钩子
onMounted(() => {
  initializeApp()
})

onBeforeUnmount(() => {
  chatDisposed = true
  clearChatIdentityState()
  unregisterIdentityCleanup()
  stopConversationEventStream()
})
</script>

<style scoped>
.app-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.chat-container {
  display: flex;
  flex: 1;
  overflow: hidden;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  background: var(--color-background, #ffffff);
}

/* 遮罩层 */
.chat-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.4);
  z-index: 999;
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s ease;
  backdrop-filter: blur(2px);
}

.chat-overlay.show {
  opacity: 1;
  visibility: visible;
}

.chat-main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  grid-template-rows: 1fr auto;
  background: var(--color-background);
  overflow: hidden;
  /* 防止整个容器滚动 */
}

/* 响应式设计 */
@media (max-width: 768px) {
  .chat-container {
    border-radius: 0;
    max-width: 100%;
  }
}
</style>
