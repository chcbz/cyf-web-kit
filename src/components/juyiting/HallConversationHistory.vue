<template>
  <section ref="historyRef" class="hall-conversation-history" aria-label="议事记录">
    <div v-if="loading" class="history-state" role="status">正在加载议事记录…</div>
    <div v-else-if="error" class="history-state is-error" role="alert">{{ error }}</div>
    <div v-else-if="!conversations.length" class="history-state">还没有议事记录。</div>
    <template v-else>
      <ul class="history-list">
        <li v-for="conversation in conversations" :key="conversation.id" class="history-row">
          <button
            type="button"
            class="history-item"
            :class="{ selected: conversation.id === selectedId }"
            :aria-current="conversation.id === selectedId ? 'page' : null"
            :disabled="disabled || conversation.id === deletingId"
            @click="$emit('select', conversation.id)"
          >
            <strong>{{ conversation.title }}</strong>
            <small>{{ formatTime(conversation.updateTime) }}</small>
          </button>
          <button
            type="button"
            v-if="!readOnly"
            class="history-delete"
            :title="`删除议事记录：${conversation.title}`"
            :aria-label="conversation.id === deletingId ? `正在删除议事记录：${conversation.title}` : `删除议事记录：${conversation.title}`"
            :disabled="disabled || loading || Boolean(deletingId)"
            @click.stop="requestDelete(conversation)"
          >
            <span v-if="conversation.id === deletingId" role="status" aria-live="polite">删除中</span>
            <var-icon v-else name="delete" />
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
        {{ loading ? '正在翻检…' : '加载更多记录' }}
      </button>
    </template>

    <var-dialog
      v-model:show="showDeleteDialog"
      title="删除议事记录"
      :message="deleteDialogMessage"
      confirm-button
      confirm-button-text="删除"
      cancel-button
      cancel-button-text="取消"
      :close-on-click-overlay="false"
      @confirm="confirmDelete"
      @closed="clearDeleteCandidate"
    />
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  dismissTrigger: { type: Object, default: null },
  conversations: { type: Array, default: () => [] },
  deletingId: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false },
  error: { type: String, default: '' },
  hasMore: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  selectedId: { type: String, default: '' }
})

const emit = defineEmits(['delete', 'dismiss', 'load-more', 'select'])
const showDeleteDialog = ref(false)
const historyRef = ref(null)
const dismissBlocked = computed(() => showDeleteDialog.value || Boolean(props.deletingId))
// A nested/teleported modal owns its dismissal; an enclosing discussion dialog does not.
const hasChildDialog = () => [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')]
  .some(dialog => !dialog.contains(historyRef.value) && !dialog.closest('[hidden]') && window.getComputedStyle(dialog).display !== 'none')
const dismiss = (restoreFocus = false) => {
  if (dismissBlocked.value || hasChildDialog()) return
  emit('dismiss')
  if (restoreFocus) nextTick(() => props.dismissTrigger?.focus())
}
const handleOutside = event => {
  if (!historyRef.value?.contains(event.target) && !props.dismissTrigger?.contains(event.target)) dismiss()
}
const handleEscape = event => {
  const discussion = event.target?.closest?.('.chat-panel')
  if (discussion && !discussion.contains(historyRef.value)) return
  if (event.key !== 'Escape' || event.defaultPrevented || dismissBlocked.value || hasChildDialog()) return
  event.preventDefault()
  dismiss(true)
}
onMounted(() => {
  document.addEventListener('pointerdown', handleOutside)
  document.addEventListener('keydown', handleEscape)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutside)
  document.removeEventListener('keydown', handleEscape)
})
defineExpose({ dismissBlocked })
const deleteCandidate = ref(null)
const deleteDialogMessage = computed(() => `确认删除“${deleteCandidate.value?.title || '未命名议事'}”吗？删除后无法恢复。`)

const requestDelete = conversation => {
  if (props.readOnly || props.disabled || props.loading || props.deletingId || !conversation?.id) return
  deleteCandidate.value = conversation
  showDeleteDialog.value = true
}

const clearDeleteCandidate = () => {
  if (!showDeleteDialog.value) deleteCandidate.value = null
}

const confirmDelete = () => {
  const id = deleteCandidate.value?.id
  showDeleteDialog.value = false
  deleteCandidate.value = null
  if (id && !props.readOnly && !props.disabled && !props.loading && !props.deletingId) emit('delete', id)
}

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

.history-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px;
  align-items: stretch;
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

.history-delete {
  display: inline-flex;
  min-width: 38px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #a14b3e;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}

.history-delete:hover:not(:disabled),
.history-delete:focus-visible {
  background: rgba(161, 75, 62, 0.12);
  outline: none;
}

.history-delete:disabled {
  cursor: not-allowed;
  opacity: 0.45;
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
