<template>
  <div v-if="voice?.supported" class="hall-voice-controls" @pointerdown.stop @keydown.stop>
    <span v-if="compact" class="voice-target" :title="voice.targetLabel">{{ voice.targetLabel }}</span>
    <button v-if="voice.state !== 'recording'" type="button" :disabled="!voice.canRecord" aria-label="开始录音" @click="voice.startRecording()">
      <var-icon name="microphone" /><span>语音</span>
    </button>
    <button v-else type="button" class="is-recording" aria-label="停止录音并转写" @click="voice.stopRecording()">
      <var-icon name="stop" /><span>停止并转写 {{ seconds }}s</span>
    </button>
    <button v-if="canCancelCapture" type="button" class="voice-cancel" aria-label="取消并丢弃录音" @click="voice.cancel()">取消并丢弃</button>
    <label class="voice-toggle">
      <input :checked="voice.autoSendEnabled" type="checkbox" :disabled="voice.recording" @change="voice.setAutoSendEnabled($event.target.checked)" /> 自动发送
    </label>
    <label class="voice-toggle">
      <input :checked="voice.replyVoiceEnabled" type="checkbox" @change="voice.setReplyVoiceEnabled($event.target.checked)" /> 语音回答
    </label>
    <div v-if="voice.state === 'pending_send'" class="voice-countdown">
      {{ (voice.countdownMs / 1000).toFixed(1) }} 秒后发送
      <button type="button" @click="voice.cancel({ preserveReview: true })">取消</button>
      <button type="button" @click="voice.sendTranscript()">立即发送</button>
    </div>
    <div v-if="voice.state === 'sending'" class="voice-sending" role="status">
      <span>传令可能已经送达；停止等待不会撤回文字发送。</span>
      <button type="button" class="voice-stop-waiting" @click="voice.stopWaiting()">停止等待</button>
    </div>
    <div v-if="['review', 'conflict', 'error'].includes(voice.state)" class="voice-review" role="status">
      <strong>{{ voice.detached ? '上下文已变化，请手动处理转写' : '语音转写' }}</strong>
      <p>{{ voice.transcript || voice.error }}</p>
      <button v-if="voice.transcript && voice.detached" type="button" @click="voice.adoptCurrentContext()">按当前议事采用</button>
      <div v-if="voice.transcript && !voice.detached">
        <button type="button" @click="$emit('apply', 'append')">追加</button>
        <button type="button" @click="$emit('apply', 'replace')">替换</button>
      </div>
      <button type="button" @click="voice.discard()">丢弃</button>
    </div>
  </div>
</template>
<script setup>
import { computed } from 'vue'
const props = defineProps({ compact: { type: Boolean, default: false }, voice: { type: Object, default: null } })
defineEmits(['apply'])
const seconds = computed(() => Math.ceil((props.voice?.elapsedMs || 0) / 1000))
const canCancelCapture = computed(() => ['requesting_permission', 'recording', 'stopping', 'transcribing'].includes(props.voice?.state))
</script>
<style scoped>
.hall-voice-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.hall-voice-controls button{border:1px solid #d7c3a2;border-radius:7px;background:#fffdf6;color:#654122;padding:6px 8px;font:inherit}.hall-voice-controls button.is-recording{background:#8d2d22;color:#fff}.voice-target{max-width:150px;overflow:hidden;color:#654122;font-size:12px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.voice-toggle{font-size:11px;color:#765f40;white-space:nowrap}.voice-countdown,.voice-sending,.voice-review{width:100%;font-size:12px;color:#765f40}.voice-review{padding:8px;border:1px dashed #c8a96e;background:#fff8e8}.voice-review p{margin:4px 0;white-space:pre-wrap}.voice-review button,.voice-countdown button,.voice-sending button{margin-right:5px}
</style>
