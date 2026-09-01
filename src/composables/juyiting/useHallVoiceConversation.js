import { computed, onBeforeUnmount, ref } from 'vue'

const MAX_DURATION_MS = 45_000
const MAX_AUDIO_BYTES = 5 * 1024 * 1024
const MAX_REPLY_CODE_POINTS = 2_000
const MAX_TTS_BYTES = 8 * 1024 * 1024
const AUTO_SEND_DELAY_MS = 1_500
const supportedMimes = ['audio/webm;codecs=opus', 'audio/mp4']

const codePointLength = value => Array.from(String(value || '')).length
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const canonical = value => {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonical)
  return Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: canonical(value[key]) }), {})
}
const normalizedIds = value => [...new Set((Array.isArray(value) ? value : []).map(item => String(item)))].sort()
const safeRequestId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128)

export const useHallVoiceConversation = ({ apiStore, chatApi, enabled, getContext, getDraft, getDraftRevision, isReplyBusy, onOpenReview, onSendVoice, showToast }) => {
  const state = ref(enabled ? 'idle' : 'unsupported')
  const transcript = ref('')
  const error = ref('')
  const elapsedMs = ref(0)
  const countdownMs = ref(0)
  const autoSendEnabled = ref(false)
  const replyVoiceEnabled = ref(false)
  const detached = ref(false)
  const frozen = ref(null)
  const supported = ref(Boolean(enabled && navigator?.mediaDevices?.getUserMedia && globalThis.MediaRecorder))
  const voiceTurnActive = ref(false)
  let generation = 0
  let stream = null
  let recorder = null
  let chunks = []
  let bytes = 0
  let ticker = null
  let hardStop = null
  let countdown = null
  let replyTimeout = null
  let uploadController = null
  let ttsController = null
  let audio = null
  let objectUrl = ''

  const voiceInteractionLocked = computed(() => ['requesting_permission', 'recording', 'stopping', 'transcribing', 'pending_send', 'review', 'conflict', 'sending', 'waiting_reply', 'synthesizing', 'speaking'].includes(state.value))
  const recording = computed(() => state.value === 'recording')
  const canRecord = computed(() => supported.value && enabled && !voiceTurnActive.value && !isReplyBusy())

  const stopTracks = () => {
    stream?.getTracks?.().forEach(track => track.stop?.())
    stream = null
  }
  const stopPlayback = () => {
    if (audio) { audio.pause?.(); audio.src = ''; audio = null }
    if (objectUrl) URL.revokeObjectURL?.(objectUrl)
    objectUrl = ''
  }
  const clearTimers = () => {
    if (ticker) window.clearInterval(ticker)
    if (hardStop) window.clearTimeout(hardStop)
    if (countdown) window.clearInterval(countdown)
    if (replyTimeout) window.clearTimeout(replyTimeout)
    ticker = hardStop = countdown = replyTimeout = null
  }
  const cleanupCapture = () => {
    clearTimers()
    if (recorder?.state !== 'inactive') recorder?.stop?.()
    recorder = null
    stopTracks()
    chunks = []; bytes = 0
  }
  const cancel = ({ preserveReview = false } = {}) => {
    generation += 1
    uploadController?.abort(new DOMException('Voice turn cancelled', 'AbortError'))
    uploadController = null
    ttsController?.abort(new DOMException('Voice turn cancelled', 'AbortError'))
    ttsController = null
    cleanupCapture()
    stopPlayback()
    countdownMs.value = 0
    if (!preserveReview) {
      transcript.value = ''
      frozen.value = null
      detached.value = false
      if (!voiceTurnActive.value) state.value = supported.value ? 'idle' : 'unsupported'
    }
  }
  const snapshot = () => {
    const context = getContext() || {}
    return Object.freeze({
      draft: String(getDraft() || ''),
      draftRevision: getDraftRevision(),
      conversationId: context.conversationId || '',
      conversationScopeType: context.conversationScopeType || 'public',
      conversationScopeKey: context.conversationScopeKey || 'public',
      mode: context.mode || 'public',
      targetAgentIds: normalizedIds(context.targetAgentIds),
      targetAgentId: context.targetAgentId == null ? null : String(context.targetAgentId),
      participantAgentIds: normalizedIds(context.participantAgentIds),
      mentionAgentIds: normalizedIds(context.mentionAgentIds),
      selectedAgentId: context.selectedAgentId == null ? null : String(context.selectedAgentId),
      selectedTaskId: context.selectedTaskId == null ? null : String(context.selectedTaskId),
      taskId: context.taskId == null ? null : String(context.taskId),
      outgoingMetadata: canonical(clone(context.outgoingMetadata || {}))
    })
  }
  const matchesFrozen = () => {
    const current = snapshot()
    const previous = frozen.value
    return Boolean(previous && previous.draft === current.draft && previous.draftRevision === current.draftRevision && JSON.stringify(previous) === JSON.stringify(current))
  }
  const openReview = (conflict = false) => {
    state.value = conflict ? 'conflict' : 'review'
    detached.value = conflict
    onOpenReview?.()
  }
  const startRecording = async () => {
    if (!canRecord.value) return false
    cancel()
    const current = ++generation
    frozen.value = snapshot()
    error.value = ''; detached.value = false; elapsedMs.value = 0
    state.value = 'requesting_permission'
    try {
      const capture = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
      if (current !== generation) { capture.getTracks().forEach(track => track.stop()); return false }
      stream = capture
      const mimeType = supportedMimes.find(type => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type)) || ''
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunks = []; bytes = 0
      recorder.ondataavailable = event => {
        if (current !== generation || !event.data?.size) return
        bytes += event.data.size
        if (bytes > MAX_AUDIO_BYTES) { error.value = '录音超过 5MiB'; recorder?.stop?.(); return }
        chunks.push(event.data)
      }
      recorder.onerror = () => { if (current === generation) { error.value = '录音设备出错'; openReview() } }
      recorder.onstop = () => { if (current === generation) void upload(current, new Blob(chunks, { type: recorder?.mimeType || mimeType || 'audio/webm' })) }
      recorder.start(250)
      state.value = 'recording'
      const started = Date.now()
      ticker = window.setInterval(() => { elapsedMs.value = Math.min(MAX_DURATION_MS, Date.now() - started) }, 100)
      hardStop = window.setTimeout(() => stopRecording(), MAX_DURATION_MS)
      stream.getTracks().forEach(track => { track.onended = () => { if (current === generation && state.value === 'recording') { error.value = '录音设备已断开'; cancel() } } })
      return true
    } catch (cause) {
      if (current !== generation) return false
      error.value = cause?.name === 'NotAllowedError' ? '未获麦克风权限，仍可使用文字传令' : '当前浏览器无法录音，仍可使用文字传令'
      state.value = supported.value ? 'error' : 'unsupported'
      return false
    }
  }
  const stopRecording = () => {
    if (state.value !== 'recording') return
    state.value = 'stopping'
    clearTimers()
    recorder?.stop?.()
    stopTracks()
  }
  const upload = async (current, blob) => {
    if (current !== generation) return
    if (!blob.size || blob.size > MAX_AUDIO_BYTES || error.value === '录音超过 5MiB') { error.value = '录音无效或超过 5MiB'; openReview(); return }
    state.value = 'transcribing'
    uploadController = new AbortController()
    const body = new FormData()
    body.append('audio', blob, 'juyiting-voice.webm')
    body.append('requestId', safeRequestId())
    body.append('language', 'zh-CN')
    body.append('durationMs', String(elapsedMs.value))
    try {
      const response = await chatApi.create('/speech/transcriptions', body, { autoLoading: false, signal: uploadController.signal })
      if (current !== generation) return
      const text = String(response?.data?.data?.text || response?.data?.text || '').trim()
      if (!text) throw new Error('未识别到语音内容')
      transcript.value = text
      if (autoSendEnabled.value && matchesFrozen() && !isReplyBusy()) startCountdown(current)
      else openReview(!matchesFrozen())
    } catch (cause) {
      if (current !== generation || cause?.name === 'AbortError') return
      error.value = cause?.message || '语音转写失败，仍可使用文字传令'
      openReview()
    } finally { if (current === generation) uploadController = null }
  }
  const startCountdown = current => {
    state.value = 'pending_send'; countdownMs.value = AUTO_SEND_DELAY_MS
    const start = Date.now()
    countdown = window.setInterval(() => {
      if (current !== generation) return
      countdownMs.value = Math.max(0, AUTO_SEND_DELAY_MS - (Date.now() - start))
      if (!matchesFrozen() || isReplyBusy()) { clearTimers(); openReview(true); return }
      if (!countdownMs.value) { clearTimers(); void sendTranscript(current) }
    }, 50)
  }
  const sendTranscript = async (current = generation) => {
    if (current !== generation || !matchesFrozen() || !transcript.value || isReplyBusy()) { openReview(true); return false }
    const content = `${frozen.value.draft}${frozen.value.draft ? '\n' : ''}${transcript.value}`
    if (codePointLength(content) > 1200) { error.value = '合并内容超过 1200 字符，请手动整理'; openReview(); return false }
    state.value = 'sending'; voiceTurnActive.value = true
    const accepted = await onSendVoice?.({ content, contextSnapshot: frozen.value, turnId: safeRequestId() })
    if (current !== generation) return false
    if (!accepted) { voiceTurnActive.value = false; openReview(true); return false }
    if (voiceTurnActive.value) {
      state.value = 'waiting_reply'
      replyTimeout = window.setTimeout(() => {
        if (current === generation && voiceTurnActive.value) { voiceTurnActive.value = false; state.value = 'idle'; showToast?.('回话超时，文字传令仍可继续') }
      }, 120_000)
    }
    transcript.value = ''; frozen.value = null
    return true
  }
  const applyTranscript = mode => {
    if (!transcript.value || detached.value) return false
    const next = mode === 'append' ? `${getDraft() || ''}${getDraft() ? '\n' : ''}${transcript.value}` : transcript.value
    if (codePointLength(next) > 1200) { error.value = '内容超过 1200 字符，请手动整理'; return false }
    return next
  }
  const synthesize = async text => {
    if (!replyVoiceEnabled.value || !voiceTurnActive.value) return false
    if (codePointLength(text) > MAX_REPLY_CODE_POINTS) { showToast?.('回话较长，已保留文字，未自动朗读'); voiceTurnActive.value = false; state.value = 'idle'; return false }
    const current = ++generation
    state.value = 'synthesizing'; ttsController = new AbortController()
    try {
      const token = await apiStore.token()
      if (current !== generation || !token) throw new Error('语音回答需要登录')
      const base = import.meta.env.VITE_API_BASE_URL || ''
      const response = await fetch(`${base}/chat/speech/synthesis`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: safeRequestId(), text, voice: 'juyiting-default', format: 'mp3' }), signal: ttsController.signal })
      if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > MAX_TTS_BYTES) throw new Error('语音回答暂不可用')
      const reader = response.body.getReader(); const parts = []; let total = 0
      while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_TTS_BYTES) { await reader.cancel(); throw new Error('语音回答过大') } parts.push(value) }
      if (current !== generation || !total) return false
      objectUrl = URL.createObjectURL(new Blob(parts, { type: response.headers.get('content-type') || 'audio/mpeg' }))
      audio = new Audio(objectUrl); audio.onended = () => { if (current === generation) { stopPlayback(); voiceTurnActive.value = false; state.value = 'idle' } }; audio.onerror = () => { if (current === generation) { error.value = '语音播放失败，文字已保留'; voiceTurnActive.value = false; state.value = 'idle' } }
      await audio.play(); state.value = 'speaking'; return true
    } catch (cause) { if (current === generation && cause?.name !== 'AbortError') { error.value = cause?.message || '语音回答失败，文字已保留'; voiceTurnActive.value = false; state.value = 'idle' } return false } finally { if (current === generation) ttsController = null }
  }
  const completeReply = message => {
    if (replyTimeout) window.clearTimeout(replyTimeout)
    replyTimeout = null
    if (!replyVoiceEnabled.value) { voiceTurnActive.value = false; state.value = 'idle'; return }
    if (message?.content) void synthesize(message.content); else { voiceTurnActive.value = false; state.value = 'idle' }
  }
  const discard = () => { transcript.value = ''; frozen.value = null; detached.value = false; state.value = supported.value ? 'idle' : 'unsupported' }
  const onVisibility = () => { if (document.hidden && ['recording', 'pending_send'].includes(state.value)) { cancel({ preserveReview: true }); openReview(true) } }
  addEventListener?.('pagehide', cancel); document?.addEventListener?.('visibilitychange', onVisibility)
  onBeforeUnmount(() => { removeEventListener?.('pagehide', cancel); document?.removeEventListener?.('visibilitychange', onVisibility); cancel() })
  return { applyTranscript, autoSendEnabled, canRecord, cancel, completeReply, countdownMs, detached, discard, elapsedMs, error, replyVoiceEnabled, recording, startRecording, state, stopRecording, supported, transcript, voiceInteractionLocked, voiceTurnActive, sendTranscript }
}
