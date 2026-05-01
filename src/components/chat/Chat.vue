<template>
  <div class="chat-container">
    <div class="chat-main-content">
      <ChatMessageList
        ref="messageListRef"
        :messages="messages"
        :should-show-empty-state="shouldShowEmptyState"
        :random-phrase="randomPhrase"
        @scroll="handleScroll"
      />
      <ChatInput
        ref="chatInputRef"
        :is-streaming="isStreaming"
        :is-loading="isLoading"
        @send="sendMessage"
        @cancel="stopStream"
      />
    </div>

    <div :class="['chat-overlay', { show: showSidebar }]" @click="toggleSidebar"></div>
    <ChatSidebar
      :show-sidebar="showSidebar"
      :conversations="conversations"
      :active-conversation-id="conversationId"
      :format-date="utilStore.formatDate"
      @new-conversation="generateNewConversationId"
      @select-conversation="loadConversation"
      @delete-conversation="deleteConversation"
    />
  </div>
</template>

<script setup>
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'
import { useUtilStore } from '../../stores/util'
import { useGlobalStore } from '../../stores/global'
// import { useApiStore } from '../../stores/api' // 预留
import { useI18n } from 'vue-i18n'
import { chatApi, phraseApi } from '../../composables/useHttp'
import { log } from '../../utils/logger'

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

// 工具函数
const utilStore = useUtilStore()
const globalStore = useGlobalStore()
// const apiStore = useApiStore() // 预留
const { t } = useI18n()

// 计算属性
const hasMessages = computed(() => messages.value.length > 0)
// sortedConversations 预留用于未来排序功能
// const sortedConversations = computed(() =>
//   [...conversations.value].sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
// )
const shouldShowEmptyState = computed(() => !hasMessages.value && !isLoading.value)

// 初始化
const initializeApp = async () => {
  globalStore.setTitle(t('chat.new_session'))
  globalStore.setShowBack(false)
  globalStore.setShowMore(true)

  // 加载随机短语
  await loadRandomPhrase()

  loadConversations()
}

// 加载随机短语
const loadRandomPhrase = async () => {
  try {
    phraseApi.list('/get/random', {
      jiacn: globalStore.getJiacn
    }, {
      autoLoading: false,
      onSuccess: (data) => {
        if (data && data.data) {
          randomPhrase.value = data.data.content
          phraseApi.getById('/read', data.data.id)
        }
      },
      onError: (error) => {
        log.warn('从服务端加载会话失败:', error)
      }
    })
  } catch (error) {
    log.warn('加载随机短语失败:', error)
    // 保持默认文本
  }
}

// 会话管理函数
const loadConversations = async () => {
  try {
    // 从服务端加载会话列表
    await chatApi.list('/conversation/list', {
      pageNum: 1,
      pageSize: 100,
      orderBy: 'update_time desc',
      search: {
        jiacn: globalStore.getJiacn
      }
    }, {
      autoLoading: false,
      onSuccess: (data) => {
        if (data && data.data) {
          conversations.value = data.data.map(conv => ({
            id: conv.id.toString(),
            title: conv.title || '新会话',
            lastUpdated: conv.updateTime,
            messages: []
          }))
        }
      },
      onError: (error) => {
        log.warn('从服务端加载会话失败:', error)
      }
    })
  } catch (error) {
    log.warn('加载会话失败:', error)
  }
}

const loadConversation = async (id) => {
  const conversation = conversations.value.find((c) => c.id === id)
  if (conversation) {
    conversationId.value = id
    globalStore.setTitle(conversation.title)

    // 从服务端加载会话内容
    try {
      await chatApi.getById('/conversation/content', id, {
        autoLoading: false,
        onSuccess: (data) => {
          if (data && data.data) {
            // 根据接口返回的数据结构处理会话内容
            const msgList = data.data || []

            // 确保消息格式正确
            messages.value = msgList.map(msg => ({
              sender: msg.messageType || 'USER',
              content: msg.content || '',
              timestamp: msg.createTime || new Date().getTime(),
              conversationId: id
            }))

            // 加载完成后自动滚动到底部
            scrollToBottom()
          } else {
            // 如果服务端没有消息，清空消息
            messages.value = []
          }
        },
        onError: (error) => {
          log.warn('从服务端加载会话内容失败:', error)
          messages.value = []
        }
      })
    } catch (error) {
      log.warn('加载会话内容失败:', error)
      messages.value = []
    }
  }
}

const generateNewConversationId = () => {
  globalStore.setTitle(t('chat.new_session'))
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
      timestamp: new Date().getTime()
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
    } else if (data.conversationId) {
      conversationId.value = data.conversationId
    } else if (data.t) {
      globalStore.setTitle(data.t)
      loadConversations()
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
  if (!message || isLoading.value) return

  isLoading.value = true
  isStreaming.value = true

  try {
    // 添加用户消息
    const userMessage = {
      sender: 'USER',
      content: message,
      timestamp: new Date().getTime(),
      conversationId: conversationId.value
    }

    messages.value = [
      ...messages.value,
      userMessage
    ]

    scrollToBottom()

    // 使用新的 useHttp 流式功能
    const streamResult = await chatApi.create('/stream',
      {
        content: message,
        conversationId: conversationId.value
      },
      {
        responseType: 'stream',
        autoLoading: false,
        timeout: 1800000,
        onStream: (eventData) => {
          log.debug('Stream data received:', eventData)
          processBotResponse(eventData)
        },
        onStreamEnd: () => {
          log.debug('Stream ended')
          isStreaming.value = false
          isLoading.value = false
          readerRef.value = null
        },
        onError: (errorMessage) => {
          log.error('发送消息失败:', errorMessage)
          throw new Error(errorMessage)
        }
      }
    )

    // 保存reader引用以便后续取消
    if (streamResult && streamResult.stream) {
      readerRef.value = streamResult.stream.reader
    }
  } catch (err) {
    log.error('发送消息失败:', err)
    isStreaming.value = false
    isLoading.value = false
    error.value = '发送消息失败，请重试'
    messages.value = [
      ...messages.value,
      {
        sender: 'SYSTEM',
        content: '消息发送失败',
        isError: true,
        timestamp: new Date().getTime()
      }
    ]
  }
}

const stopStream = async () => {
  if (readerRef.value) {
    try {
      await readerRef.value.cancel()
      messages.value = [
        ...messages.value,
        {
          sender: 'SYSTEM',
          content: '已取消当前请求',
          isInfo: true,
          timestamp: new Date().getTime()
        }
      ]
    } catch (err) {
      log.error('取消请求失败:', err)
    } finally {
      isStreaming.value = false
      isLoading.value = false
      readerRef.value = null
    }
  }
}

// 处理滚动事件
const handleScroll = (scrollData) => {
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
  globalStore.toggleRightSidebar()
}

// 删除会话（带重试机制）
const deleteConversation = async (id, retryCount = 0) => {
  try {
    log.info('删除会话:', id)
    await chatApi.delete('/conversation/delete', id, {
      onSuccess: () => {
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
      onError: (errorMessage) => {
        log.error('删除会话失败:', errorMessage)

        const lastMessage = messages.value[messages.value.length - 1]
        if (!lastMessage || !lastMessage.isError) {
          messages.value = [
            ...messages.value,
            {
              sender: 'SYSTEM',
              content: `删除会话失败${retryCount > 0 ? ` (重试 ${retryCount}/3)` : ''}`,
              isError: true,
              timestamp: new Date().getTime()
            }
          ]
        }

        if (retryCount < 3) {
          setTimeout(() => deleteConversation(id, retryCount + 1), 1000 * (retryCount + 1))
        }
      }
    })
  } catch (error) {
    log.error('删除会话失败:', error)

    const lastMessage = messages.value[messages.value.length - 1]
    if (!lastMessage || !lastMessage.isError) {
      messages.value = [
        ...messages.value,
        {
          sender: 'SYSTEM',
          content: `删除会话失败${retryCount > 0 ? ` (重试 ${retryCount}/3)` : ''}`,
          isError: true,
          timestamp: new Date().getTime()
        }
      ]
    }

    if (retryCount < 3) {
      setTimeout(() => deleteConversation(id, retryCount + 1), 1000 * (retryCount + 1))
    }
  }
}

// 监听全局store中的右侧边栏状态变化
watch(
  () => globalStore.showRightSidebar,
  (newValue) => {
    showSidebar.value = newValue
  }
)

// 生命周期钩子
onMounted(() => {
  initializeApp()
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
