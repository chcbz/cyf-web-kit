<template>
  <div ref="composerRef" class="hall-chat-composer chat-composer" :class="composerClass">
    <form class="composer-submit" @submit.prevent="submit">
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
            :disabled="chip.locked || inputLocked"
            @click="removeTarget(chip)"
          >
            <span>@{{ chip.label }}</span>
            <var-icon v-if="!chip.locked" class="composer-target-remove" name="close-circle-outline" />
          </button>
        </div>
      </div>

      <div class="composer-body" :class="{ 'has-supported-voice': voiceSupported, 'has-voice-detail': voiceHasDetail }">
        <div class="composer-input-area">
          <textarea
            ref="textareaRef"
            class="composer-textarea"
            :value="draft"
            :disabled="inputLocked"
            :maxlength="maxLength"
            :placeholder="placeholder"
            rows="1"
            @focus="handleFocus"
            @input="handleInput"
            @keydown="handleKeydown"
          ></textarea>

          <div class="composer-actions">
            <button
              ref="moreButtonRef"
              class="composer-more"
              type="button"
              title="更多操作"
              aria-label="更多操作"
              :aria-expanded="String(moreOpen)"
              :aria-controls="moreId"
              :disabled="actionsDisabled"
              @click="moreOpen = !moreOpen"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button
              class="composer-add-materials"
              type="button"
              title="添加资料"
              aria-label="添加资料"
              :disabled="inputLocked"
              @click="openMaterials"
            ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m8 12 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9M7 14l8-8" /></svg></button>
            <div ref="voiceActionRef" class="composer-inline-voice"></div>
            <button
              class="composer-send"
              type="submit"
              :disabled="!canSend"
              :title="isStreaming || isAwaitingReply ? '处理中' : '发送'"
              :aria-label="isStreaming || isAwaitingReply ? '处理中' : '发送'"
            >
              <svg v-if="isStreaming || isAwaitingReply" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2" /></svg>
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>
            </button>
          </div>
        </div>
        <p v-if="typedPendingQuestion" class="typed-pending-question">正在回答：{{ typedPendingQuestion.question }}</p>

      </div>

      <section
        v-show="moreOpen || voiceHasDetail"
        :id="moreId"
        class="composer-more-panel"
        aria-label="语音设置与状态"
      >
        <HallVoiceControls
          class="composer-voice-controls"
          :recording-target="voiceActionRef"
          :settings-visible="moreOpen"
          :draft-only="true"
          :disabled="actionsDisabled"
          :voice="voice"
          @apply="$emit('voice-apply', $event)"
        />
      </section>

      <div class="composer-materials"><slot name="materials"></slot></div>

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
        <span v-if="isStreaming || isAwaitingReply">候回话</span>
        <span v-else>{{ hintText }}</span>
      </div>
    </form>

  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import HallVoiceControls from './HallVoiceControls.vue'

const props = defineProps({
  agents: { type: Array, default: () => [] },
  discussionVariant: { type: String, default: 'public' },
  draft: { type: String, default: '' },
  hasTypedAttachments: { type: Boolean, default: false },
  interactionLocked: { type: Boolean, default: false },
  isAwaitingReply: { type: Boolean, default: false },
  isStreaming: { type: Boolean, default: false },
  mentionLabel: { type: Function, required: true },
  placeholder: { type: String, default: '向聚义厅传话，或 @某位好汉' },
  selectedAgent: { type: Object, default: null },
  targetText: { type: String, default: '众好汉' },
  maxLength: { type: Number, default: 1200 },
  voice: { type: Object, default: null },
  typedPendingQuestion: { type: Object, default: null },
  contextKey: { type: String, default: '' },
  actionsDisabled: { type: Boolean, default: false }
})

const emit = defineEmits([
  'clear-target',
  'mention-agent',
  'send-message',
  'update:draft',
  'voice-apply',
  'open-materials',
  'open-workspace'
])

const composerRef = ref(null)
const moreButtonRef = ref(null)
const moreOpen = ref(false)
const moreId = `hall-composer-more-${useId()}`
const voiceActionRef = ref(null)
const textareaRef = ref(null)
const closeMore = () => {
  if (!moreOpen.value) return
  moreOpen.value = false
  nextTick(() => moreButtonRef.value?.focus())
}
const handleOutside = event => {
  if (!composerRef.value?.contains(event.target)) closeMore()
}
const handleEscape = event => {
  if (event.key !== 'Escape' || !moreOpen.value || event.defaultPrevented) return
  event.preventDefault()
  closeMore()
}
const openMaterials = () => { emit('open-materials') }
const openWorkspace = () => { closeMore(); emit('open-workspace') }
onMounted(() => {
  document.addEventListener('pointerdown', handleOutside)
  document.addEventListener('keydown', handleEscape)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutside)
  document.removeEventListener('keydown', handleEscape)
})
const isFocused = ref(false)

const draftLength = computed(() => String(props.draft || '').length)
const inputLocked = computed(() => props.interactionLocked || props.isStreaming || props.isAwaitingReply || Boolean(props.voice?.voiceInteractionLocked))
const canSend = computed(() => (Boolean(String(props.draft || '').trim()) || (props.discussionVariant === 'bounty' && props.hasTypedAttachments)) && !inputLocked.value)
const composerClass = computed(() => ({
  'is-streaming': props.isStreaming,
  'has-draft': Boolean(String(props.draft || '').trim())
}))
const voiceSupported = computed(() => Boolean(props.voice?.supported))
const voiceHasDetail = computed(() => voiceSupported.value && props.voice?.state !== 'idle')

const selectedAgentInAgents = computed(() => props.selectedAgent && props.agents.some(agent => agent.agentId === props.selectedAgent.agentId))

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
  if (inputLocked.value || !orderedAgents.value.length) return false
  const value = String(props.draft || '')
  if (!isFocused.value && value !== '@') return false
  return /(^|\s)@[\S]*$/.test(value)
})

const targetChips = computed(() => {
  if (props.discussionVariant === 'private' && selectedAgentInAgents.value) {
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
  if (selectedAgentInAgents.value) {
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

watch(() => props.contextKey, () => { moreOpen.value = false })

watch(() => props.draft, () => nextTick(resizeTextarea), { immediate: true })
</script>

<style scoped>
.composer-more-panel {
  display: grid;
  gap: 8px;
  max-height: 45vh;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  background: #fffdf6;
}

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

.composer-submit {
  display: contents;
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
  gap: 7px;
  min-width: 0;
}

.composer-input-area {
  min-width: 0;
  padding: 6px;
  border: 1px solid #d7c3a2;
  border-radius: 12px;
  background: #fffdf6;
}

.composer-input-area:focus-within {
  border-color: #7f4a22;
  box-shadow: 0 0 0 2px rgba(127, 74, 34, 0.12);
}

.composer-textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 42px;
  max-height: 132px;
  min-width: 0;
  resize: none;
  padding: 8px 6px;
  border: 0;
  background: transparent;
  color: #3f2815;
  font: inherit;
  line-height: 1.45;
  outline: none;
  overflow-y: auto;
}

.typed-pending-question { grid-column: 1 / -1; margin: 0 0 4px; color: #466c5a; font-size: 12px; }

.composer-body.has-voice-detail .typed-pending-question { grid-column: 1 / -1; }

.composer-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.composer-inline-voice {
  display: flex;
  flex: 0 0 auto;
  min-width: 0;
  margin-left: auto;
}

.composer-more,
.composer-add-materials,
.composer-send,
.composer-inline-voice :deep(button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  min-height: 38px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #765f40;
  font: inherit;
  cursor: pointer;
}

.composer-actions svg,
.composer-inline-voice :deep(svg) {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
}

.composer-more:hover:not(:disabled),
.composer-add-materials:hover:not(:disabled),
.composer-inline-voice :deep(.voice-start:hover:not(:disabled)) {
  background: #f2e8d8;
}

.composer-actions button:focus-visible,
.composer-inline-voice :deep(button:focus-visible) {
  outline: 2px solid #7f4a22;
  outline-offset: 2px;
}

.composer-inline-voice :deep(button:disabled) {
  cursor: not-allowed;
  opacity: 0.5;
}

.composer-inline-voice :deep(.is-recording) {
  width: auto;
  gap: 4px;
  padding: 0 8px;
  border-radius: 8px;
  background: #8d2d22;
  color: #fff;
  font-size: 12px;
}

.composer-inline-voice :deep(.voice-action-label) {
  display: none;
}

.composer-send {
  background: #7f4a22;
  color: #fff8e8;
}

.composer-materials {
  display: contents;
}

.composer-execute {
  border: 1px solid #7f4a22;
  border-radius: 6px;
  background: #fff3de;
  color: #6a3719;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}

.composer-more:disabled,
.composer-add-materials:disabled,
.composer-send:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.composer-more-panel {
  position: absolute;
  right: 12px;
  bottom: calc(100% - 4px);
  left: 12px;
  z-index: 3;
  display: grid;
  gap: 8px;
  max-height: min(50vh, 320px);
  overflow-y: auto;
  padding: 10px;
  border: 1px solid #d7c3a2;
  border-radius: 10px;
  background: #fffdf6;
  box-shadow: 0 10px 24px rgba(54, 35, 18, 0.18);
}

.composer-voice-controls :deep(.voice-settings) {
  position: static;
  width: 100%;
  box-sizing: border-box;
  box-shadow: none;
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

  .composer-mention-menu {
    right: 10px;
    left: 10px;
    max-height: 150px;
  }
}
</style>
