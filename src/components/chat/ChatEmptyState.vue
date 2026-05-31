<template>
  <div class="chat-empty-state">
    <p v-if="isJuyiting">聚义厅中，各位兄弟齐聚，有何高见尽管道来！</p>
    <p v-else>开始与JiA智能助手对话吧！</p>
    <ChatCapabilities />
    <p class="chat-empty-hint">{{ randomPhrase }}</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import ChatCapabilities from './ChatCapabilities.vue'

const props = defineProps({
  randomPhrase: {
    type: String,
    default: '输入您的问题或想法，我将尽力为您解答'
  },
  conversationType: {
    type: String,
    default: ''
  }
})

const isJuyiting = computed(() => props.conversationType === 'juyiting')
</script>

<style scoped>
.chat-empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-secondary);
  font-size: 18px;
  font-weight: 500;
  animation: fadeInUp 0.6s ease-out;
}

.chat-empty-hint {
  margin-top: 20px;
  font-size: 14px;
  color: var(--color-text-tertiary);
  font-weight: 400;
  line-height: 1.4;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 响应式设计 */
@media (max-width: 768px) {
  .chat-empty-state {
    padding: 60px 20px;
    font-size: 18px;
  }

  .chat-empty-hint {
    font-size: 14px;
  }
}

@media (max-width: 480px) {
  .chat-empty-state {
    padding: 20px 16px;
    font-size: 16px;
  }

  .chat-empty-hint {
    font-size: 13px;
  }
}
</style>