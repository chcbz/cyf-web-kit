<template>
  <div ref="messagesRef" class="chat-messages" @scroll="handleScroll">
    <ChatEmptyState
      v-if="shouldShowEmptyState"
      :random-phrase="randomPhrase"
    />
    <template v-for="(msg, index) in messages" :key="index">
      <ChatMessageTime
        v-if="shouldShowTime(index)"
        :timestamp="msg.timestamp"
      />
      <ChatMessage
        :message="msg"
      />
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, defineExpose } from 'vue'
import ChatEmptyState from './ChatEmptyState.vue'
import ChatMessage from './ChatMessage.vue'
import ChatMessageTime from './ChatMessageTime.vue'

const props = defineProps({
  messages: {
    type: Array,
    default: () => []
  },
  shouldShowEmptyState: {
    type: Boolean,
    default: false
  },
  randomPhrase: {
    type: String,
    default: '输入您的问题或想法，我将尽力为您解答'
  }
})

const emit = defineEmits(['scroll'])

const messagesRef = ref(null)
const userScrolledUp = ref(false)
const lastScrollTop = ref(0)

// 判断是否需要显示时间戳
const shouldShowTime = (index) => {
  if (index === 0) return true

  const currentMsg = props.messages[index]
  const prevMsg = props.messages[index - 1]

  if (!currentMsg.timestamp || !prevMsg.timestamp) return false

  const currentTime = new Date(currentMsg.timestamp).getTime()
  const prevTime = new Date(prevMsg.timestamp).getTime()

  // 超过5分钟显示时间戳
  return currentTime - prevTime > 5 * 60 * 1000
}

const handleScroll = () => {
  if (!messagesRef.value) return

  const currentScrollTop = messagesRef.value.scrollTop
  const scrollHeight = messagesRef.value.scrollHeight
  const clientHeight = messagesRef.value.clientHeight

  // 检测用户是否向上滚动
  if (currentScrollTop < lastScrollTop.value) {
    // 用户向上滚动
    userScrolledUp.value = true
  } else if (currentScrollTop + clientHeight >= scrollHeight - 10) {
    // 用户滚动到底部（留10px的容差）
    userScrolledUp.value = false
  }

  lastScrollTop.value = currentScrollTop
  emit('scroll', { currentScrollTop, scrollHeight, clientHeight })
}

const scrollToBottom = () => {
  requestAnimationFrame(() => {
    if (messagesRef.value && !userScrolledUp.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    }
  })
}

// 暴露方法供父组件调用
defineExpose({
  scrollToBottom,
  getElement: () => messagesRef.value
})

// 添加滚动事件监听器
onMounted(() => {
  const setupScrollListener = () => {
    if (messagesRef.value) {
      messagesRef.value.addEventListener('scroll', handleScroll)
    }
  }

  // 使用 nextTick 确保 DOM 已渲染
  setTimeout(setupScrollListener, 100)
})

// 组件卸载时移除事件监听器
onUnmounted(() => {
  if (messagesRef.value) {
    messagesRef.value.removeEventListener('scroll', handleScroll)
  }
})
</script>

<style scoped>
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px 24px 0 24px;
  min-height: 0;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
  height: 100%;
  /* 确保消息区域占据全部可用高度 */
}

.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
  background: transparent;
}

.chat-messages::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-secondary);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .chat-messages {
    padding: 20px 20px 100px 20px;
    /* 底部增加 padding 防止被输入框遮挡 */
    height: 100%;
    /* 确保在移动端也占据全部高度 */
  }
}

@media (max-width: 640px) {
  .chat-messages {
    padding: 16px 16px 90px 16px;
    /* 底部增加 padding 防止被输入框遮挡 */
    height: 100%;
    /* 确保在移动端也占据全部高度 */
  }
}

@media (max-width: 480px) {
  .chat-messages {
    padding: 16px 16px 90px 16px;
    /* 底部增加 padding 防止被输入框遮挡 */
    height: 100%;
    /* 确保在移动端也占据全部高度 */
  }
}
</style>