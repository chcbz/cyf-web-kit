<template>
  <div
    v-if="voice?.supported"
    ref="controlsRef"
    class="hall-voice-controls"
    :class="[`state-${voice.state}`, { 'is-compact': compact }]"
    @pointerdown.stop
    @keydown="handleKeydown"
  >
    <span v-if="compact" class="voice-target" :title="voice.targetLabel">{{ voice.targetLabel }}</span>
    <div class="voice-action-row">
      <button
        v-if="voice.state === 'idle'"
        type="button"
        class="voice-start"
        :disabled="!voice.canRecord"
        aria-label="开始录音"
        title="开始录音"
        @click="startRecording"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <rect
            x="9"
            y="2"
            width="6"
            height="12"
            rx="3"
          />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
        </svg><span class="voice-action-label">语音</span>
      </button>
      <button
        v-else-if="voice.state === 'recording'"
        type="button"
        class="is-recording"
        aria-label="停止录音并转写"
        @click="voice.stopRecording()"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <rect
            x="6"
            y="6"
            width="12"
            height="12"
            rx="1"
            fill="currentColor"
          />
        </svg><span>停止并转写 {{ seconds }}s</span>
      </button>
      <button
        ref="settingsButtonRef"
        type="button"
        class="voice-settings-trigger"
        :aria-controls="settingsId"
        :aria-expanded="String(settingsOpen)"
        aria-label="语音设置"
        title="语音设置"
        @click="toggleSettings"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M10 2h4v3l2 1 2.6-1.5 2 3.5L18 9.5v5l2.6 1.5-2 3.5L16 18l-2 1v3h-4v-3l-2-1-2.6 1.5-2-3.5L6 14.5v-5L3.4 8l2-3.5L8 6l2-1Z" />
          <circle cx="12" cy="12" r="3" />
        </svg><span class="voice-action-label">设置</span>
      </button>
    </div>

    <section
      v-if="settingsOpen"
      :id="settingsId"
      class="voice-settings"
      aria-label="语音设置"
      role="group"
    >
      <label v-if="!draftOnly" class="voice-toggle">
        <input
          :checked="voice.autoSendEnabled"
          type="checkbox"
          :disabled="voice.recording"
          @change="voice.setAutoSendEnabled($event.target.checked)"
        /> 自动发送
      </label>
      <div class="voice-reply-setting">
        <label class="voice-toggle">
          <input
            :checked="voice.replyVoiceEnabled"
            type="checkbox"
            aria-label="语音回答；播放内容为 AI 生成语音"
            @change="voice.setReplyVoiceEnabled($event.target.checked)"
          />
          <span>语音回答</span>
        </label>
        <span class="voice-disclosure" role="note">播放内容为 AI 生成语音</span>
      </div>
    </section>

    <div v-if="inlineStatus" class="voice-inline-status" role="status">
      <span>{{ inlineStatus }}</span>
      <span v-if="['synthesizing', 'speaking'].includes(voice.state)" class="voice-ai-note">AI 生成语音</span>
      <button
        v-if="canCancelCapture"
        type="button"
        class="voice-cancel"
        :aria-label="cancelLabel"
        @click="voice.cancel()"
      >{{ cancelLabel }}</button>
    </div>
    <div v-if="voice.state === 'pending_send'" class="voice-countdown" role="status">
      {{ (voice.countdownMs / 1000).toFixed(1) }} 秒后发送
      <button type="button" @click="voice.cancel({ preserveReview: true })">取消</button>
      <button type="button" @click="voice.sendTranscript()">立即发送</button>
    </div>
    <div v-if="['sending', 'waiting_reply'].includes(voice.state)" class="voice-sending" role="status">
      <span>传令可能已经送达；停止等待不会撤回文字发送。</span>
      <button type="button" class="voice-stop-waiting" @click="voice.stopWaiting()">停止等待</button>
    </div>
    <div v-if="['review', 'conflict', 'error'].includes(voice.state)" class="voice-review" role="status">
      <strong>{{ reviewTitle }}</strong>
      <p>{{ voice.transcript || voice.error }}</p>
      <button v-if="voice.transcript && voice.detached" type="button" @click="voice.adoptCurrentContext()">按当前议事采用</button>
      <div v-if="voice.transcript && !voice.detached">
        <button
          v-if="!draftOnly"
          type="button"
          aria-label="确认发送语音转写"
          @click="voice.sendTranscript()"
        >确认发送</button>
        <button type="button" @click="$emit('apply', 'append')">追加</button>
        <button type="button" @click="$emit('apply', 'replace')">替换</button>
      </div>
      <button type="button" @click="voice.discard()">丢弃</button>
    </div>
  </div>
</template>
<script>
let voiceSettingsSequence = 0
</script>
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
const props = defineProps({ draftOnly: { type: Boolean, default: false }, compact: { type: Boolean, default: false }, voice: { type: Object, default: null } })
const emit = defineEmits(['apply'])
const settingsOpen = ref(false)
const controlsRef = ref(null)
const settingsButtonRef = ref(null)
const settingsId = `hall-voice-settings-${useId()}-${++voiceSettingsSequence}`
const seconds = computed(() => Math.ceil((props.voice?.elapsedMs || 0) / 1000))
const canCancelCapture = computed(() => ['requesting_permission', 'recording', 'stopping', 'transcribing', 'synthesizing', 'speaking'].includes(props.voice?.state))
const cancelLabel = computed(() => props.voice?.state === 'synthesizing' ? '取消语音生成' : (props.voice?.state === 'speaking' ? '停止朗读' : '取消并丢弃录音'))
const inlineStatus = computed(() => ({
  requesting_permission: '正在请求麦克风权限',
  recording: `正在录音 ${seconds.value}s`,
  stopping: '正在整理录音',
  transcribing: '正在转写语音',
  synthesizing: '正在生成语音回答',
  speaking: '正在朗读 AI 语音回答'
}[props.voice?.state] || ''))
const reviewTitle = computed(() => {
  if (props.voice?.detached) return '上下文已变化，请手动处理转写'
  if (props.voice?.state === 'error') return /^语音(?:回答|播放)/.test(String(props.voice?.error || '')) ? '语音服务提示（AI 朗读）' : '语音未完成'
  return '语音转写'
})
const startRecording = () => {
  settingsOpen.value = false
  if (props.draftOnly) void props.voice.startRecording({ draftOnly: true })
  else void props.voice.startRecording()
}
watch(() => props.voice?.state, state => {
  if (props.draftOnly && state === 'review' && props.voice?.transcript && !props.voice?.detached) emit('apply', 'append')
})
const toggleSettings = () => { settingsOpen.value = !settingsOpen.value }
const closeSettings = ({ restoreFocus = false } = {}) => {
  settingsOpen.value = false
  if (restoreFocus) nextTick(() => settingsButtonRef.value?.focus())
}
const handleDocumentPointerdown = event => {
  if (settingsOpen.value && !controlsRef.value?.contains(event.target)) closeSettings()
}
onMounted(() => document.addEventListener('pointerdown', handleDocumentPointerdown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleDocumentPointerdown, true))
const handleKeydown = event => {
  if (event.key !== 'Escape' || !settingsOpen.value) return
  event.preventDefault()
  event.stopPropagation()
  closeSettings({ restoreFocus: true })
}
</script>
<style scoped>
.hall-voice-controls{position:relative;display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap}.voice-action-row{display:inline-flex;align-items:center;gap:5px}.hall-voice-controls button{border:1px solid #d7c3a2;border-radius:7px;background:#fffdf6;color:#654122;padding:6px 8px;font:inherit}.voice-action-label{display:none}.voice-start,.voice-settings-trigger{display:inline-flex;align-items:center;justify-content:center;gap:3px;min-height:28px}.voice-settings-trigger[aria-expanded="true"]{border-color:#7f4a22;background:#fff3de}.hall-voice-controls button:disabled{cursor:not-allowed;opacity:.5}.hall-voice-controls button.is-recording{background:#8d2d22;color:#fff}.voice-target{max-width:150px;overflow:hidden;color:#654122;font-size:12px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.voice-settings{position:absolute;right:0;bottom:calc(100% + 6px);z-index:4;display:grid;min-width:190px;gap:7px;padding:9px;border:1px solid rgba(116,75,35,.24);border-radius:8px;background:#fffdf6;box-shadow:0 10px 24px rgba(54,35,18,.18)}.voice-toggle{font-size:12px;color:#765f40;white-space:nowrap}.voice-reply-setting{display:grid;gap:4px}.voice-disclosure{padding:2px 5px;border:1px solid rgba(118,95,64,.28);border-radius:4px;color:#765f40;font-size:10px;line-height:1.3}.voice-inline-status,.voice-countdown,.voice-sending,.voice-review{font-size:12px;color:#765f40}.voice-inline-status{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}.voice-ai-note{padding:1px 4px;border:1px solid rgba(118,95,64,.28);border-radius:4px;font-size:10px}.voice-review,.voice-countdown,.voice-sending{width:100%;box-sizing:border-box}.voice-countdown,.voice-sending{padding:7px 8px;border:1px solid rgba(116,75,35,.18);border-radius:7px;background:#fff8e8}.voice-review{padding:8px;border:1px dashed #c8a96e;background:#fff8e8}.voice-review p{margin:4px 0;white-space:pre-wrap}.voice-review button,.voice-countdown button,.voice-sending button,.voice-inline-status button{margin-right:5px}.state-pending_send,.state-sending,.state-waiting_reply,.state-review,.state-conflict,.state-error{display:grid;align-items:stretch}.state-pending_send .voice-action-row,.state-sending .voice-action-row,.state-waiting_reply .voice-action-row,.state-review .voice-action-row,.state-conflict .voice-action-row,.state-error .voice-action-row{justify-content:flex-end}.is-compact{max-width:100%;flex-wrap:wrap}.is-compact .voice-settings{right:0;left:auto}.is-compact .voice-inline-status,.is-compact .voice-countdown,.is-compact .voice-sending,.is-compact .voice-review{white-space:normal}@media (max-width:640px){.voice-settings{right:0;min-width:176px}.voice-start,.voice-settings-trigger{min-width:30px;padding:6px}.voice-target{max-width:112px}}
</style>
