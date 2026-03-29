<template>
  <div class="chat-input">
    <var-input
      v-model="inputMessage"
      placeholder="给我发消息"
      textarea
      rows="3"
      @keydown.enter="handleEnterKey"
    />
    <var-button
      :disabled="isSendButtonDisabled"
      type="success"
      round
      icon-container
      @click="handleSendOrCancel"
    >
      <var-icon :name="isStreaming ? 'close' : 'chevron-up'" class="send-icon" />
    </var-button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  isStreaming: {
    type: Boolean,
    default: false
  },
  isLoading: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['send', 'cancel', 'update:modelValue'])

const inputMessage = ref('')

const isSendButtonDisabled = computed(() => props.isLoading || !inputMessage.value.trim())

const handleEnterKey = (event) => {
  // 如果按下了 Shift 键，允许换行
  if (event.shiftKey) {
    return // 允许默认行为（换行）
  }

  // 否则，阻止默认行为（换行）并发送消息
  event.preventDefault()
  handleSendOrCancel()
}

const handleSendOrCancel = () => {
  if (props.isStreaming) {
    emit('cancel')
  } else {
    emit('send', inputMessage.value.trim())
    inputMessage.value = ''
  }
}

// 暴露方法供父组件调用
defineExpose({
  clearInput: () => {
    inputMessage.value = ''
  },
  setInput: (value) => {
    inputMessage.value = value
  }
})
</script>

<style scoped>
.chat-input {
  display: flex;
  padding: 24px 24px;
  border-top: 1px solid var(--color-border);
  background: var(--color-card);
  gap: 16px;
  align-items: flex-end;
  backdrop-filter: blur(10px);
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
  min-height: 80px;
  /* 确保最小高度 */
}

.chat-input .var-input {
  flex: 1;
  width: 100%;
  min-height: 48px;
  /* 确保输入框有最小高度 */
}

.chat-input .var-input textarea {
  min-height: 48px !important;
  /* 确保textarea有最小高度 */
  resize: vertical;
  /* 允许垂直调整大小 */
}

.chat-input .var-button {
  flex-shrink: 0;
  margin-bottom: 8px;
  /* 与输入框底部对齐 */
}

.send-icon {
  display: block;
  font-size: 18px;
}

/* 响应式设计 */
@media (max-width: 1024px) {
  .chat-input {
    padding: 20px;
    gap: 14px;
  }
}

@media (max-width: 768px) {
  .chat-input {
    padding: 16px;
    gap: 12px;
    min-height: 70px;
    /* 移动端最小高度调整 */
  }

  .chat-input .var-input {
    min-height: 42px;
    /* 移动端输入框最小高度 */
  }

  .chat-input .var-input textarea {
    min-height: 42px !important;
    /* 移动端textarea最小高度 */
  }

  .chat-input .var-button {
    min-width: 48px;
    height: 48px;
    border-radius: 50%;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    visibility: visible !important;
    opacity: 1 !important;
  }

  .send-icon {
    display: inline;
    font-size: 20px;
    margin: 0;
  }
}

@media (max-width: 640px) {
  .chat-input {
    padding: 14px;
    gap: 10px;
    min-height: 65px;
    /* 小屏幕最小高度调整 */
  }

  .chat-input .var-input {
    min-height: 40px;
    /* 小屏幕输入框最小高度 */
  }

  .chat-input .var-input textarea {
    min-height: 40px !important;
    /* 小屏幕textarea最小高度 */
  }

  .chat-input .var-button {
    min-width: 44px;
    height: 44px;
    border-radius: 50%;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .send-icon {
    display: inline;
    font-size: 18px;
  }
}

@media (max-width: 480px) {
  .chat-input {
    padding: 12px;
    gap: 8px;
    min-height: 60px;
    /* 超小屏幕最小高度调整 */
  }

  .chat-input .var-input {
    min-height: 38px;
    /* 超小屏幕输入框最小高度 */
  }

  .chat-input .var-input textarea {
    min-height: 38px !important;
    /* 超小屏幕textarea最小高度 */
  }

  .chat-input .var-button {
    min-width: 40px;
    height: 40px;
    border-radius: 50%;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .send-icon {
    display: inline;
    font-size: 16px;
  }
}
</style>