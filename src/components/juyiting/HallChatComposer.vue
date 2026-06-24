<template>
  <form class="hall-chat-composer chat-composer" :class="composerClass" @submit.prevent="submit">
    <div class="composer-context" :class="`is-${discussionVariant}`">
      <span class="composer-context-label">{{ contextLabel }}</span>
      <div v-if="targetChips.length" class="composer-targets" aria-label="传话对象">
        <button
          v-for="chip in targetChips"
          :key="chip.id"
          class="composer-target-chip"
          :class="{ 'is-locked': chip.locked }"
          type="button"
          :title="chip.label"
          :disabled="chip.locked || isStreaming"
          @click="removeTarget(chip)"
        >
          <span>@{{ chip.label }}</span>
          <var-icon v-if="!chip.locked" class="composer-target-remove" name="close-circle-outline" />
        </button>
      </div>
    </div>

    <div class="composer-body">
      <textarea
        ref="textareaRef"
        class="composer-textarea"
        :value="draft"
        :disabled="isStreaming"
        :maxlength="maxLength"
        :placeholder="placeholder"
        rows="1"
        @focus="handleFocus"
        @input="handleInput"
        @keydown="handleKeydown"
      />
      <div class="composer-actions">
        <button
          v-if="canClear"
          class="composer-clear"
          type="button"
          title="清空话头"
          aria-label="清空话头"
          @click="clearDraft"
        >
          <var-icon name="close-circle-outline" />
        </button>
        <button
          class="composer-send"
          type="submit"
          :disabled="!canSend"
          :title="isStreaming ? '回话中' : '传令'"
          :aria-label="isStreaming ? '回话中' : '传令'"
        >
          <var-icon :name="isStreaming ? 'refresh' : 'chevron-right'" />
        </button>
      </div>
    </div>

    <div v-if="showMentionMenu" class="composer-mention-menu" aria-label="选择要点名的好汉">
      <button
        v-for="agent in orderedAgents"
        :key="agent.agentId"
        class="composer-mention-option"
        type="button"
        @click="selectMention(agent)"
      >
        <span>@{{ mentionLabel(agent) }}</span>
        <small>{{ agent.status === 'online' ? '候令' : '候选' }}</small>
      </button>
    </div>

    <div class="composer-meta">
      <span>{{ draftLength }}/{{ maxLength }}</span>
      <span v-if="isStreaming">候回话</span>
      <span v-else>{{ hintText }}</span>
    </div>
  </form>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  agents: { type: Array, default: () => [] },
  discussionVariant: { type: String, default: 'public' },
  draft: { type: String, default: '' },
  isStreaming: { type: Boolean, default: false },
  mentionLabel: { type: Function, required: true },
  placeholder: { type: String, default: '向聚义厅传话，或 @某位好汉' },
  selectedAgent: { type: Object, default: null },
  targetText: { type: String, default: '众好汉' },
  maxLength: { type: Number, default: 1200 }
})

const emit = defineEmits([
  'clear-target',
  'mention-agent',
  'send-message',
  'update:draft'
])

const textareaRef = ref(null)
const isFocused = ref(false)

const draftLength = computed(() => String(props.draft || '').length)
const canClear = computed(() => Boolean(String(props.draft || '').length) && !props.isStreaming)
const canSend = computed(() => Boolean(String(props.draft || '').trim()) && !props.isStreaming)
const composerClass = computed(() => ({
  'is-streaming': props.isStreaming,
  'has-draft': Boolean(String(props.draft || '').trim())
}))

const orderedAgents = computed(() => {
  const selectedId = props.selectedAgent?.agentId
  return [...props.agents].sort((a, b) => {
    if (a.agentId === selectedId) return -1
    if (b.agentId === selectedId) return 1
    if (a.status === 'online' && b.status !== 'online') return -1
    if (b.status === 'online' && a.status !== 'online') return 1
    return props.mentionLabel(a).localeCompare(props.mentionLabel(b), 'zh-Hans-CN')
  })
})

const showMentionMenu = computed(() => {
  if (props.isStreaming || !orderedAgents.value.length) return false
  const value = String(props.draft || '')
  if (!isFocused.value && value !== '@') return false
  return /(^|\s)@[\S]*$/.test(value)
})

const targetChips = computed(() => {
  if (props.discussionVariant === 'private' && props.selectedAgent) {
    return [{
      id: props.selectedAgent.agentId,
      label: props.mentionLabel(props.selectedAgent),
      locked: true
    }]
  }
  if (props.discussionVariant === 'bounty') {
    return props.agents.map(agent => ({
      id: agent.agentId,
      label: props.mentionLabel(agent),
      locked: true
    }))
  }
  if (props.selectedAgent) {
    return [{
      id: props.selectedAgent.agentId,
      label: props.mentionLabel(props.selectedAgent),
      locked: false
    }]
  }
  return []
})

const contextLabel = computed(() => {
  if (props.discussionVariant === 'bounty') return props.targetText || '榜文议事'
  if (props.discussionVariant === 'private') return props.targetText || '当前好汉'
  return targetChips.value.length ? '点名回话' : '厅前公议'
})

const hintText = computed(() => {
  if (props.discussionVariant === 'bounty') return '只点本榜领令人'
  if (props.discussionVariant === 'private') return '密议对象已定'
  return '输入 @ 可点名回话'
})

const resizeTextarea = () => {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 132)}px`
}

const handleFocus = () => {
  isFocused.value = true
}

const handleInput = (event) => {
  emit('update:draft', event.target.value)
  nextTick(resizeTextarea)
}

const handleKeydown = (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}

const clearDraft = () => {
  emit('update:draft', '')
  nextTick(resizeTextarea)
}

const removeTarget = (chip) => {
  if (chip.locked) return
  emit('clear-target', chip.id)
}

const selectMention = (agent) => {
  emit('mention-agent', agent)
  nextTick(() => {
    resizeTextarea()
    textareaRef.value?.focus()
  })
}

const submit = () => {
  if (!canSend.value) return
  emit('send-message')
}

watch(() => props.draft, () => nextTick(resizeTextarea), { immediate: true })
</script>

<style scoped>
.hall-chat-composer {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  padding: 9px 12px 8px;
  border-top: 1px solid rgba(116, 75, 35, 0.16);
  background: #fffaf0;
}

.composer-context {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.composer-context-label {
  flex: 0 0 auto;
  color: #765f40;
  font-size: 12px;
  font-weight: 700;
}

.composer-context.is-bounty .composer-context-label {
  color: #23483e;
}

.composer-context.is-private .composer-context-label {
  color: #7c1f1b;
}

.composer-targets {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.composer-target-chip {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 128px;
  height: 26px;
  flex: 0 0 auto;
  gap: 4px;
  padding: 0 8px;
  border: 1px solid #d7c3a2;
  border-radius: 999px;
  background: #fffdf6;
  color: #5b432a;
  font-size: 12px;
  white-space: nowrap;
}

.composer-target-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.composer-target-chip.is-locked {
  border-color: rgba(116, 75, 35, 0.12);
  background: #efe0c6;
  color: #765f40;
}

.composer-target-remove {
  flex: 0 0 auto;
  font-size: 14px;
}

.composer-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  min-width: 0;
}

.composer-textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 42px;
  max-height: 132px;
  min-width: 0;
  resize: none;
  padding: 11px 12px;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  background: #fffdf6;
  color: #3f2815;
  font: inherit;
  line-height: 1.45;
  outline: none;
  overflow-y: auto;
}

.composer-textarea:focus {
  border-color: #7f4a22;
  box-shadow: 0 0 0 2px rgba(127, 74, 34, 0.12);
}

.composer-actions {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.composer-clear,
.composer-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  min-height: 42px;
  border: 0;
  border-radius: 8px;
  color: #fff8e8;
  cursor: pointer;
}

.composer-clear {
  border: 1px solid #d7c3a2;
  background: #fffdf6;
  color: #765f40;
}

.composer-send {
  background: #7f4a22;
}

.composer-clear:disabled,
.composer-send:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.composer-mention-menu {
  position: absolute;
  right: 12px;
  bottom: calc(100% - 4px);
  left: 12px;
  z-index: 3;
  display: grid;
  max-height: 178px;
  gap: 6px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid rgba(116, 75, 35, 0.16);
  border-radius: 8px;
  background: #fffdf6;
  box-shadow: 0 14px 34px rgba(54, 35, 18, 0.18);
}

.composer-mention-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  min-height: 32px;
  gap: 8px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: #f5ead6;
  color: #3f2815;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.composer-mention-option span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-mention-option small {
  flex: 0 0 auto;
  color: #8a6f4b;
  font-size: 11px;
}

.composer-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #9a825f;
  font-size: 11px;
}

@media (max-width: 640px) {
  .hall-chat-composer {
    padding: 8px 10px;
  }

  .composer-context {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .composer-targets {
    width: 100%;
  }

  .composer-clear,
  .composer-send {
    width: 38px;
  }

  .composer-mention-menu {
    right: 10px;
    left: 10px;
    max-height: 150px;
  }
}
</style>
