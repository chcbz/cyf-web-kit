<template>
  <section class="hall-conversation-history" aria-label="话头记录">
    <div v-if="loading" class="history-state" role="status">正在翻检话头…</div>
    <div v-else-if="error" class="history-state is-error" role="alert">{{ error }}</div>
    <div v-else-if="!conversations.length" class="history-state">此处暂无旧话头。</div>
    <template v-else>
      <ul class="history-list">
        <li v-for="conversation in conversations" :key="conversation.id">
          <button
          type="button"
          class="history-item"
          :class="{ selected: conversation.id === selectedId }"
          :aria-current="conversation.id === selectedId ? 'page' : null"
          :disabled="disabled"
          @click="$emit('select', conversation.id)"
        >
          <strong>{{ conversation.title }}</strong>
          <small>{{ formatTime(conversation.updateTime) }}</small>
          </button>
        </li>
      </ul>
      <button
        v-if="hasMore"
        class="history-load-more"
        type="button"
        :disabled="disabled || loading"
        @click="$emit('load-more')"
      >
        {{ loading ? '正在翻检…' : '再取旧话头' }}
      </button>
    </template>
  </section>
</template>

<script setup>
defineProps({
  conversations: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  error: { type: String, default: '' },
  hasMore: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  selectedId: { type: String, default: '' }
})

defineEmits(['load-more', 'select'])

const formatTime = value => {
  if (value === null || value === undefined || value === '') return '时间未记'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未记'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
</script>

<style scoped>
.hall-conversation-history {
  flex: 0 0 auto;
  max-height: min(34vh, 250px);
  overflow-y: auto;
  border-bottom: 1px solid rgba(116, 75, 35, 0.14);
  background: #f8edda;
}

.history-list {
  margin: 0;
  padding: 5px 8px;
  list-style: none;
}

.history-item {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 9px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #4a3423;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.history-item:hover:not(:disabled),
.history-item:focus-visible {
  background: rgba(200, 169, 110, 0.24);
  outline: none;
}

.history-item.selected {
  background: #ead2a4;
  box-shadow: inset 3px 0 0 #7f4a22;
}

.history-item:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.history-item strong,
.history-item small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item strong {
  font-size: 13px;
}

.history-item small,
.history-state {
  color: #8a6f4b;
  font-size: 12px;
}

.history-state {
  padding: 12px 16px;
}

.history-state.is-error {
  color: #a23f32;
}

.history-load-more {
  display: block;
  width: calc(100% - 16px);
  margin: 3px 8px 8px;
  padding: 8px;
  border: 1px solid rgba(116, 75, 35, 0.2);
  border-radius: 7px;
  background: #fff8e8;
  color: #765f40;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}

.history-load-more:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
