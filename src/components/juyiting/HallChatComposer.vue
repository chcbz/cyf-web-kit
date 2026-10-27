<template>
  <div ref="composerRef" class="hall-chat-composer chat-composer" :class="composerClass">
    <form class="composer-submit" @submit.prevent="submit">
      <div v-if="!hideFixedContext" class="composer-context" :class="`is-${discussionVariant}`">
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

      <div class="composer-body">
        <div class="composer-input-area">
          <slot name="attachments"></slot>
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
              @click="toggleMore"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button
              ref="materialsButtonRef"
              class="composer-add-materials"
              type="button"
              title="添加资料"
              aria-label="添加资料"
              :disabled="inputLocked"
              :aria-expanded="String(materialActionsOpen || materialsOpen)"
              @click="openMaterials"
            ><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m8 12 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9M7 14l8-8" /></svg></button>
            <div ref="voiceActionRef" class="composer-inline-voice"></div>
            <button
              v-if="stopTarget"
              class="composer-send composer-stop"
              type="button"
              :disabled="replyCancellationState?.inFlight || actionsDisabled || voice?.voiceInteractionLocked"
              :title="stopLabel"
              :aria-label="stopLabel"
              :aria-busy="Boolean(replyCancellationState?.inFlight)"
              @click="$emit('cancel-deliberation', stopTarget)"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                aria-hidden="true"
                focusable="false"
              ><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
            </button>
            <button
              v-else
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
        <p v-if="replyCancellationState?.inFlight || replyCancellationState?.unknown" class="composer-stop-status" role="status">{{ replyCancellationState.inFlight ? stopLabel : '停止结果尚未确认，请核对；不会重复提交。' }}</p>
        <p v-if="typedPendingQuestion" class="typed-pending-question">正在回答：{{ typedPendingQuestion.question }}</p>

      </div>

      <section
        v-show="moreOpen || voiceHasDetail"
        :id="moreId"
        ref="morePanelRef"
        class="composer-more-panel"
        aria-label="语音设置与状态"
      >
        <HallVoiceControls
          ref="voiceControlsRef"
          class="composer-voice-controls"
          :recording-target="voiceActionRef"
          :settings-visible="moreOpen"
          :draft-only="true"
          :disabled="actionsDisabled"
          :voice="voice"
          @activate-input="activateInput"
          @apply="$emit('voice-apply', $event)"
        />
      </section>

      <div ref="materialsRef" class="composer-materials">
        <section v-if="materialActionsOpen" class="composer-material-actions" aria-label="添加资料方式">
          <button type="button" :disabled="inputLocked" @click="chooseImage(cameraInput)">拍照</button>
          <button type="button" :disabled="inputLocked" @click="chooseImage(albumInput)">相册</button>
          <button type="button" :disabled="inputLocked" @click="chooseMaterials">资料</button>
        </section>
        <input
          ref="cameraInput"
          hidden
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="拍照添加资料"
          @change="importImages"
        />
        <input
          ref="albumInput"
          hidden
          type="file"
          accept="image/*"
          multiple
          aria-label="从相册添加资料"
          @change="importImages"
        />
        <slot name="materials"></slot>
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
        <span v-if="isStreaming || isAwaitingReply">等待回复…</span>
        <span v-else>{{ hintText }}</span>
      </div>
    </form>

  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import HallVoiceControls from './HallVoiceControls.vue'

const props = defineProps({
  materialsOpen: { type: Boolean, default: false },
  sendBlocked: { type: Boolean, default: false },
  agents: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
  durableCancelTarget: { type: Object, default: null },
  replyCancellationState: { type: Object, default: null },
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
  'cancel-deliberation',
  'clear-target',
  'mention-agent',
  'send-message',
  'update:draft',
  'voice-apply',
  'open-tools',
  'close-materials',
  'open-materials',
  'import-images'
])

const materialActionsOpen = ref(false)
const cameraInput = ref(null)
const albumInput = ref(null)
const mobileQuery = typeof window !== 'undefined' ? window.matchMedia?.('(max-width: 720px)') : null
const isMobile = ref(mobileQuery?.matches === true)
const syncViewport = event => { isMobile.value = event.matches; materialActionsOpen.value = false }
let imageContextKey = null
const chooseImage = input => {
  if (inputLocked.value) return
  imageContextKey = props.contextKey
  materialActionsOpen.value = false
  input?.click()
}
const importImages = event => {
  const files = [...(event.target.files || [])]
  event.target.value = ''
  if (files.length && imageContextKey === props.contextKey && !inputLocked.value) emit('import-images', files)
  imageContextKey = null
}
const chooseMaterials = () => { materialActionsOpen.value = false; emit('open-materials') }
const composerRef = ref(null)
const moreButtonRef = ref(null)
const moreOpen = ref(false)
const moreId = `hall-composer-more-${useId()}`
const voiceActionRef = ref(null)
const voiceControlsRef = ref(null)
const textareaRef = ref(null)
const morePanelRef = ref(null)
const materialsRef = ref(null)
const materialsButtonRef = ref(null)
const closeMore = (restoreFocus = false) => {
  voiceControlsRef.value?.closeSettings?.()
  if (!moreOpen.value) return
  moreOpen.value = false
  if (restoreFocus) nextTick(() => moreButtonRef.value?.focus())
}
const toggleMore = () => {
  materialActionsOpen.value = false
  if (!moreOpen.value) emit('open-tools')
  if (!moreOpen.value && props.materialsOpen) emit('close-materials')
  moreOpen.value = !moreOpen.value
}
const openMaterials = () => {
  emit('open-tools')
  closeMore()
  if (isMobile.value) materialActionsOpen.value = !materialActionsOpen.value
  else chooseMaterials()
}
const closeTools = () => {
  materialActionsOpen.value = false
  closeMore()
  if (props.materialsOpen) emit('close-materials')
}
defineExpose({ closeTools })
const activateInput = () => {
  if (hasChildDialog()) return
  emit('open-tools')
  closeTools()
}
const hasChildDialog = () => [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')]
  .some(dialog => !dialog.contains(composerRef.value) && !dialog.closest('[hidden]') && window.getComputedStyle(dialog).display !== 'none')
const handleOutside = event => {
  if ((!moreOpen.value && !props.materialsOpen && !materialActionsOpen.value) || hasChildDialog()) return
  if (!morePanelRef.value?.contains(event.target) && !moreButtonRef.value?.contains(event.target)) closeMore()
  if (!materialsRef.value?.contains(event.target) && !materialsButtonRef.value?.contains(event.target)) {
    materialActionsOpen.value = false
    if (props.materialsOpen) emit('close-materials')
  }
}
const handleEscape = event => {
  const discussion = event.target?.closest?.('.chat-panel')
  if (discussion && !discussion.contains(composerRef.value)) return
  if (event.key !== 'Escape' || event.defaultPrevented || hasChildDialog()) return
  if (props.materialsOpen || materialActionsOpen.value) {
    materialActionsOpen.value = false
    event.preventDefault()
    event.stopPropagation()
    emit('close-materials')
    nextTick(() => materialsButtonRef.value?.focus())
  } else if (moreOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    closeMore(true)
  }
}
onMounted(() => {
  mobileQuery?.addEventListener?.('change', syncViewport)
  document.addEventListener('pointerdown', handleOutside)
  document.addEventListener('click', handleOutside)
  document.addEventListener('keydown', handleEscape, true)
})
onBeforeUnmount(() => {
  mobileQuery?.removeEventListener?.('change', syncViewport)
  document.removeEventListener('pointerdown', handleOutside)
  document.removeEventListener('click', handleOutside)
  document.removeEventListener('keydown', handleEscape, true)
})
const isFocused = ref(false)

const stopTarget = computed(() => props.replyCancellationState?.target || props.durableCancelTarget)
const stopLabel = computed(() => props.replyCancellationState?.inFlight
  ? (props.replyCancellationState.unknown ? '正在核对停止结果' : '正在停止本轮回复')
  : props.replyCancellationState?.unknown ? '核对停止结果' : '停止本轮回复')
const draftText = computed(() => String(props.draft || ''))
const draftLength = computed(() => draftText.value.length)
const hasDraft = computed(() => Boolean(draftText.value.trim()))
const inputLocked = computed(() => props.interactionLocked || props.isStreaming || props.isAwaitingReply || Boolean(props.voice?.voiceInteractionLocked))
const canSend = computed(() => (hasDraft.value || (props.discussionVariant === 'bounty' && props.hasTypedAttachments)) && !inputLocked.value && !props.sendBlocked && !stopTarget.value)
const composerClass = computed(() => ({
  'is-streaming': props.isStreaming,
  'has-draft': hasDraft.value,
  'is-compact': props.compact
}))
const voiceHasDetail = computed(() => Boolean(props.voice?.supported) && props.voice?.state !== 'idle')

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
  const value = draftText.value
  if (!isFocused.value && value !== '@') return false
  return /(^|\s)@[\S]*$/.test(value)
})

const targetChips = computed(() => {
  const targets = props.discussionVariant === 'bounty'
    ? props.agents
    : selectedAgentInAgents.value ? [props.selectedAgent] : []
  const locked = props.discussionVariant === 'private' || props.discussionVariant === 'bounty'
  return targets.map(agent => ({ id: agent.agentId, label: props.mentionLabel(agent), locked }))
})

// The bounty header already names its single fixed target. Public and multi-target
// controls are functional, and must not disappear as a visual simplification.
const hideFixedContext = computed(() => props.compact && props.discussionVariant === 'bounty' && targetChips.value.length === 1)

const contextLabel = computed(() => {
  if (props.discussionVariant === 'bounty') return props.targetText || '事项议事'
  if (props.discussionVariant === 'private') return props.targetText || '当前好汉'
  return targetChips.value.length ? '指定好汉回复' : '厅前公议'
})

const hintText = computed(() => {
  if (props.discussionVariant === 'bounty') return '只点本榜领令人'
  if (props.discussionVariant === 'private') return '私聊对象已选定'
  return '输入 @ 可指定好汉回复'
})

const resizeTextarea = () => {
  const el = textareaRef.value
  if (!el) return
  if (props.compact) {
    el.style.height = '44px'
    return
  }
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 132)}px`
}

const handleFocus = () => {
  isFocused.value = true
  activateInput()
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

watch([stopTarget, inputLocked, () => props.contextKey], ([target, locked, context], [previous, , previousContext]) => {
  if (previous && !target && !locked && context === previousContext) {
    nextTick(() => {
      if (!stopTarget.value && !inputLocked.value && props.contextKey === context) textareaRef.value?.focus()
    })
  }
})

watch(() => props.contextKey, () => { closeTools(); imageContextKey = null })
watch(inputLocked, locked => { if (locked) materialActionsOpen.value = false })

watch([() => props.draft, () => props.compact], () => nextTick(resizeTextarea), { immediate: true })
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
  color: var(--hall-text-muted,#68716b);
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
  border: 1px solid var(--hall-border,#e3e5dc);
  border-radius: 999px;
  background: var(--hall-surface,#fffefa);
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
  color: var(--hall-text-muted,#68716b);
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
  border: 1px solid var(--hall-border,#e3e5dc);
  border-radius: 12px;
  background: var(--hall-surface,#fffefa);
}

.composer-input-area:focus-within {
  border-color: var(--hall-brand,#923f30);
  box-shadow: 0 0 0 2px var(--hall-focus-ring,#923f3052);
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
  color: var(--hall-text,#242e2b);
  font: inherit;
  line-height: 1.45;
  outline: none;
  overflow-y: auto;
}

.typed-pending-question { grid-column: 1 / -1; margin: 0 0 4px; color: #466c5a; font-size: 12px; }

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
  width: 44px;
  height: 44px;
  min-height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--hall-text-muted,#68716b);
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
  width: 44px;
  height: 44px;
  min-height: 44px;
  background: #7f4a22;
  color: #fff8e8;
}

.composer-stop {
  background: #eee8df;
  color: var(--hall-text,#242e2b);
}

.composer-stop:hover:not(:disabled) { background: #e4dbcf; }
.composer-stop-status { margin: 0; color: var(--hall-text-muted,#68716b); font-size: 12px; line-height: 1.5; }

.composer-materials {
  display: contents;
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
  border: 1px solid var(--hall-border,#e3e5dc);
  border-radius: 10px;
  background: var(--hall-surface,#fffefa);
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
  background: var(--hall-surface,#fffefa);
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
  color: var(--hall-text,#242e2b);
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
/* Only formal discussions opt into fixed-height editing; text scrolls inside the
   input rather than consuming the message viewport. Voice review stays reachable. */
.is-compact .composer-textarea {
  height: 44px;
  min-height: 44px;
  max-height: 44px;
}
.is-compact .composer-input-area {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 4px;
}
.is-compact .composer-textarea { flex: 1 0 100%; width: 100%; box-sizing: border-box; }
.is-compact .composer-actions { flex: 1 0 100%; gap: 6px; width: 100%; }
.is-compact .composer-inline-voice { margin-left: auto; }
@media (max-width: 360px) {
  .is-compact .composer-input-area { flex-wrap: wrap; }
  .is-compact .composer-textarea { flex-basis: 100%; width: 100%; }
  .is-compact .composer-actions { margin-left: auto; }
}
/* Shared workbench palette; no changes to voice/target/stop semantics. */
.discussion-surface .composer-textarea { color: var(--hall-text,#242e2b); background:var(--hall-surface,#fffefa); border-color:var(--hall-border,#e3e5dc); }
.composer-more,.composer-add-materials,.composer-stop { color:var(--hall-text,#242e2b); }
.composer-send:not(.composer-stop){background:var(--hall-brand,#923f30);color:var(--hall-surface,#fffefa)}
.composer-material-actions { display: flex; gap: 12px; padding: 12px 0; }
.composer-material-actions button { flex: 1; min-height: 64px; border: 1px solid var(--hall-border, #e3e5dc); border-radius: 10px; background: var(--hall-surface, #fffefa); color: inherit; font: inherit; cursor: pointer; }
</style>
