<template>
  <div
    :class="[
      'chat-message',
      message.sender === 'USER' ? 'chat-user-message' : 'chat-bot-message',
      { streaming: message.isStreaming, error: message.isError, info: message.isInfo }
    ]"
    v-html="sanitizedContent"
  ></div>
</template>

<script setup>
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// 配置marked
marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  sanitize: false // 禁用marked内置的sanitize，使用DOMPurify
})

const props = defineProps({
  message: {
    type: Object,
    required: true,
    default: () => ({
      sender: 'USER',
      content: '',
      isStreaming: false,
      isError: false,
      isInfo: false
    })
  }
})

const sanitizedContent = computed(() => {
  return DOMPurify.sanitize(marked(props.message.content || ''))
})
</script>

<style scoped>
.chat-message {
  margin-bottom: 20px;
  padding: 16px 20px;
  border-radius: 20px;
  max-width: fit-content;
  min-width: auto;
  width: auto;
  word-break: break-word;
  line-height: 1.6;
  animation: messageSlideIn 0.3s ease-out;
  position: relative;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

@keyframes messageSlideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.chat-user-message {
  background: #eff6ff;
  color: #1e40af;
  margin-left: auto;
  margin-right: 0;
  border-bottom-right-radius: 8px;
  text-align: left;
  box-shadow: 0 4px 12px rgba(var(--color-primary-rgb, 59, 130, 246), 0.15);
}

.chat-bot-message {
  background: var(--color-card, #f8fafc);
  color: var(--color-text, #374151);
  margin-right: auto;
  margin-left: 0;
  border-bottom-left-radius: 8px;
  text-align: left;
  border: 1px solid var(--color-border, #e5e7eb);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  max-width: fit-content;
  min-width: auto;
  width: auto;
}

/* 高亮当前正在输入的消息 */
.chat-message.streaming {
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
  100% {
    opacity: 1;
  }
}

/* 错误消息样式 */
.chat-message.error {
  background: var(--color-danger-light);
  border-color: var(--color-danger);
  color: var(--color-danger);
}

/* 信息消息样式 */
.chat-message.info {
  background: var(--color-info-light);
  border-color: var(--color-info);
  color: var(--color-info);
}

/* 消息内容样式优化 */
.chat-message :deep(p) {
  margin: 0.5em 0;
  white-space: pre-wrap; /* 保持空格和换行 */
}

.chat-message :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
}

.chat-message :deep(code) {
  background: rgba(0, 0, 0, 0.1);
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.9em;
}

.chat-message :deep(pre) {
  background: rgba(0, 0, 0, 0.05);
  padding: 1em;
  border-radius: 8px;
  overflow-x: auto;
  margin: 1em 0;
}

.chat-message :deep(blockquote) {
  border-left: 4px solid var(--color-border);
  margin: 1em 0;
  padding-left: 1em;
  color: var(--color-text-secondary);
}

.chat-message :deep(ul),
.chat-message :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.5em;
}

.chat-message :deep(li) {
  margin: 0.25em 0;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .chat-message {
    padding: 14px 18px;
    font-size: 15px;
    border-radius: 18px;
  }
}

@media (max-width: 640px) {
  .chat-message {
    padding: 12px 16px;
    font-size: 14px;
    border-radius: 16px;
  }
}

@media (max-width: 480px) {
  .chat-message {
    padding: 10px 14px;
    font-size: 13px;
    border-radius: 14px;
  }
}
</style>