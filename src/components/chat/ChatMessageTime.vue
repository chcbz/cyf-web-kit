<template>
  <div class="chat-message-time">
    <span class="time-text">{{ formattedTime }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  timestamp: {
    type: Number,
    required: true
  }
})

const formattedTime = computed(() => {
  const date = new Date(props.timestamp)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const timeStr = `${hours}:${minutes}`

  if (messageDate.getTime() === today.getTime()) {
    return timeStr
  } else if (messageDate.getTime() === yesterday.getTime()) {
    return `昨天 ${timeStr}`
  } else {
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${month}月${day}日 ${timeStr}`
  }
})
</script>

<style scoped>
.chat-message-time {
  display: flex;
  justify-content: center;
  margin: 16px 0 8px 0;
  position: relative;
}

.chat-message-time::before,
.chat-message-time::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-border, #e5e7eb);
  align-self: center;
}

.time-text {
  padding: 0 12px;
  font-size: 12px;
  color: var(--color-text-secondary, #9ca3af);
  background: var(--color-background, #ffffff);
  white-space: nowrap;
}

/* 响应式设计 */
@media (max-width: 480px) {
  .chat-message-time {
    margin: 12px 0 6px 0;
  }

  .time-text {
    font-size: 11px;
    padding: 0 10px;
  }
}
</style>
