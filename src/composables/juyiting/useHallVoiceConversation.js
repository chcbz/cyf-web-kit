import { computed, getCurrentInstance, onBeforeUnmount, reactive, ref } from 'vue'

export const HALL_VOICE_MAX_DURATION_MS = 45_000
export const HALL_VOICE_MAX_AUDIO_BYTES = 5 * 1024 * 1024
export const HALL_VOICE_MAX_REPLY_CODE_POINTS = 2_000
export const HALL_VOICE_MAX_TTS_BYTES = 8 * 1024 * 1024
export const HALL_VOICE_AUTO_SEND_DELAY_MS = 1_500

const runtimeEnv = import.meta.env ?? {}
const supportedMimes = ['audio/webm;codecs=opus', 'audio/mp4']
const captureStates = new Set(['requesting_permission', 'recording', 'stopping', 'transcribing', 'pending_send'])
const exactStringFields = [
  'conversationId',
  'conversationScopeType',
  'conversationScopeKey',
  'mode'
]
const optionalExactIdFields = ['targetAgentId', 'selectedAgentId', 'selectedTaskId', 'taskId']
const exactStringArrayFields = ['targetAgentIds', 'participantAgentIds', 'mentionAgentIds']
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const codePointLength = value => Array.from(String(value || '')).length
const safeRequestId = cryptoObject => (cryptoObject?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128)
const utf16Sort = values => [...values].sort((left, right) => left < right ? -1 : (left > right ? 1 : 0))

const cloneJson = value => {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('metadata number must be finite')
    return value
  }
  if (Array.isArray(value)) return value.map(cloneJson)
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('metadata must be JSON-compatible')
  }
  return Object.keys(value).reduce((result, key) => {
    if (value[key] === undefined) throw new TypeError('metadata cannot contain undefined')
    result[key] = cloneJson(value[key])
    return result
  }, {})
}

export const canonicalizeHallVoiceValue = value => {
  if (value === undefined) return ['undefined']
  if (value === null) return ['null']
  if (Array.isArray(value)) return ['array', value.map(canonicalizeHallVoiceValue)]
  if (typeof value === 'object') {
    return ['object', Object.keys(value).sort().map(key => [key, canonicalizeHallVoiceValue(value[key])])]
  }
  return [typeof value, value]
}

const normalizeExactStringArray = value => {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new TypeError('ID arrays require exact strings')
  return utf16Sort([...new Set(value)])
}

export const captureHallVoiceSnapshot = ({ context, draft, draftRevision }) => {
  if (!context || typeof context !== 'object' || typeof draft !== 'string' || !Number.isSafeInteger(draftRevision) || draftRevision < 0) return null
  const snapshot = { draft, draftRevision }
  try {
    for (const key of exactStringFields) {
      if (!hasOwn(context, key) || typeof context[key] !== 'string') return null
      snapshot[key] = context[key]
    }
    for (const key of optionalExactIdFields) {
      if (!hasOwn(context, key)) continue
      if (context[key] !== null && typeof context[key] !== 'string') return null
      snapshot[key] = context[key]
    }
    for (const key of exactStringArrayFields) {
      if (!hasOwn(context, key)) continue
      snapshot[key] = normalizeExactStringArray(context[key])
    }
    if (!hasOwn(snapshot, 'targetAgentIds') || !hasOwn(snapshot, 'participantAgentIds')) return null
    if (hasOwn(context, 'outgoingMetadata')) snapshot.outgoingMetadata = cloneJson(context.outgoingMetadata)
    if (hasOwn(context, 'targetLabel')) {
      if (typeof context.targetLabel !== 'string') return null
      snapshot.targetLabel = context.targetLabel
    }
  } catch {
    return null
  }
  snapshot.cas = JSON.stringify(canonicalizeHallVoiceValue(snapshot))
  return Object.freeze(snapshot)
}

const defaultBrowser = () => ({
  navigator: globalThis.navigator,
  MediaRecorder: globalThis.MediaRecorder,
  Audio: globalThis.Audio,
  URL: globalThis.URL,
  fetch: globalThis.fetch,
  document: globalThis.document,
  window: globalThis.window,
  crypto: globalThis.crypto
})

export const useHallVoiceConversation = ({
  apiStore,
  chatApi,
  enabled,
  getContext,
  getDraft,
  getDraftRevision,
  isReplyBusy,
  onOpenReview,
  onSendVoice,
  onCaptureStateChange,
  onReplyTurnTerminal,
  showToast,
  browser: browserOverride
}) => {
  const browser = { ...defaultBrowser(), ...(browserOverride || {}) }
  const browserSupported = Boolean(enabled && browser.navigator?.mediaDevices?.getUserMedia && browser.MediaRecorder)
  const stateRef = ref(browserSupported ? 'idle' : 'unsupported')
  const transcriptRef = ref('')
  const errorRef = ref('')
  const elapsedMsRef = ref(0)
  const countdownMsRef = ref(0)
  const autoSendEnabledRef = ref(false)
  const replyVoiceEnabledRef = ref(false)
  const detachedRef = ref(false)
  const frozenRef = ref(null)
  const voiceTurnActiveRef = ref(false)
  const supportedRef = ref(browserSupported)
  let generation = 0
  let mediaStream = null
  let mediaRecorder = null
  let chunks = []
  let bytes = 0
  let ticker = null
  let hardStopTimer = null
  let countdownTimer = null
  let replyTimer = null
  let uploadController = null
  let ttsController = null
  let playback = null
  let playbackUrl = ''
  let pendingFinalReply = null
  let replyTurnId = ''

  const voiceInteractionLockedRef = computed(() => captureStates.has(stateRef.value))
  const recordingRef = computed(() => stateRef.value === 'recording')
  const canRecordRef = computed(() => supportedRef.value && !['requesting_permission', 'recording', 'stopping', 'transcribing', 'pending_send', 'waiting_reply', 'synthesizing'].includes(stateRef.value) && !isReplyBusy())
  const targetLabelRef = computed(() => frozenRef.value?.targetLabel || getContext()?.targetLabel || '当前议事对象')

  const setState = next => {
    const wasCapturing = captureStates.has(stateRef.value)
    stateRef.value = next
    const isCapturing = captureStates.has(next)
    if (wasCapturing !== isCapturing) onCaptureStateChange?.(isCapturing)
  }
  const stopTracks = stream => {
    stream?.getTracks?.().forEach(track => {
      track.onended = null
      track.stop?.()
    })
  }
  const clearCaptureTimers = () => {
    if (ticker !== null) browser.window?.clearInterval?.(ticker)
    if (hardStopTimer !== null) browser.window?.clearTimeout?.(hardStopTimer)
    if (countdownTimer !== null) browser.window?.clearInterval?.(countdownTimer)
    ticker = hardStopTimer = countdownTimer = null
  }
  const clearReplyTimer = () => {
    if (replyTimer !== null) browser.window?.clearTimeout?.(replyTimer)
    replyTimer = null
  }
  const stopPlayback = () => {
    if (playback) {
      playback.onended = null
      playback.onerror = null
      playback.pause?.()
      playback.src = ''
      playback = null
    }
    if (playbackUrl) browser.URL?.revokeObjectURL?.(playbackUrl)
    playbackUrl = ''
  }
  const invalidateAsyncWork = ({ stopAudio = true } = {}) => {
    generation += 1
    uploadController?.abort(new DOMException('Voice turn cancelled', 'AbortError'))
    ttsController?.abort(new DOMException('Voice turn cancelled', 'AbortError'))
    uploadController = ttsController = null
    clearCaptureTimers()
    clearReplyTimer()
    const recorder = mediaRecorder
    mediaRecorder = null
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onerror = null
      recorder.onstop = null
      try { if (recorder.state !== 'inactive') recorder.stop() } catch {}
    }
    stopTracks(mediaStream)
    mediaStream = null
    chunks = []
    bytes = 0
    pendingFinalReply = null
    if (stopAudio) stopPlayback()
    return generation
  }
  const closeReplyTurn = reason => {
    if (!replyTurnId) return
    const turnId = replyTurnId
    replyTurnId = ''
    onReplyTurnTerminal?.({ reason, turnId })
  }
  const terminal = (next, { clearTranscript = false, clearTurn = true, detached = false, replyReason = 'cancelled' } = {}) => {
    invalidateAsyncWork()
    if (clearTranscript) transcriptRef.value = ''
    frozenRef.value = clearTranscript ? null : frozenRef.value
    detachedRef.value = detached
    countdownMsRef.value = 0
    if (clearTurn) {
      voiceTurnActiveRef.value = false
      closeReplyTurn(replyReason)
    }
    setState(next)
  }
  const openReview = (conflict = false) => {
    clearCaptureTimers()
    countdownMsRef.value = 0
    detachedRef.value = conflict
    setState(conflict ? 'conflict' : 'review')
    onOpenReview?.()
  }
  const snapshotNow = () => captureHallVoiceSnapshot({
    context: getContext(),
    draft: getDraft(),
    draftRevision: getDraftRevision()
  })
  const matchesFrozen = () => {
    const current = snapshotNow()
    return Boolean(current && frozenRef.value && current.cas === frozenRef.value.cas)
  }
  const failCapture = message => {
    errorRef.value = message
    terminal('error', { clearTranscript: false, clearTurn: true })
  }
  const finishReplyTurn = (next, reason = 'reply_complete') => {
    clearReplyTimer()
    pendingFinalReply = null
    frozenRef.value = null
    voiceTurnActiveRef.value = false
    closeReplyTurn(reason)
    setState(next)
  }
  const cancel = ({ preserveReview = false } = {}) => {
    const hadTranscript = Boolean(transcriptRef.value)
    const conflict = preserveReview && hadTranscript
    terminal(conflict ? 'conflict' : (supportedRef.value ? 'idle' : 'unsupported'), {
      clearTranscript: !conflict,
      clearTurn: true,
      detached: conflict
    })
    if (conflict) onOpenReview?.()
  }
  const discard = () => terminal(supportedRef.value ? 'idle' : 'unsupported', { clearTranscript: true, clearTurn: true, replyReason: 'discarded' })

  const upload = async (current, blob, mimeType) => {
    if (current !== generation) return false
    stopTracks(mediaStream)
    mediaStream = null
    mediaRecorder = null
    chunks = []
    bytes = 0
    if (!blob.size || blob.size > HALL_VOICE_MAX_AUDIO_BYTES) {
      failCapture('录音无效或超过 5MiB')
      return false
    }
    setState('transcribing')
    uploadController = new AbortController()
    const body = new FormData()
    body.append('audio', blob, mimeType.includes('mp4') ? 'juyiting-voice.m4a' : 'juyiting-voice.webm')
    body.append('requestId', safeRequestId(browser.crypto))
    body.append('language', 'zh-CN')
    body.append('durationMs', String(elapsedMsRef.value))
    try {
      const response = await chatApi.create('/speech/transcriptions', body, { autoLoading: false, signal: uploadController.signal })
      if (current !== generation) return false
      const text = String(response?.data?.data?.text || response?.data?.text || '').trim()
      if (!text) throw new Error('未识别到语音内容')
      transcriptRef.value = text
      if (autoSendEnabledRef.value && matchesFrozen() && !isReplyBusy()) startCountdown(current)
      else openReview(!matchesFrozen())
      return true
    } catch (cause) {
      if (current !== generation || cause?.name === 'AbortError') return false
      errorRef.value = cause?.message || '语音转写失败，仍可使用文字传令'
      openReview(false)
      return false
    } finally {
      if (current === generation) uploadController = null
    }
  }

  const startRecording = async () => {
    if (!canRecordRef.value) return false
    invalidateAsyncWork()
    closeReplyTurn('superseded_by_capture')
    const current = generation
    const frozen = snapshotNow()
    if (!frozen) {
      errorRef.value = '当前议事上下文不完整，请使用文字传令'
      setState('error')
      return false
    }
    frozenRef.value = frozen
    transcriptRef.value = ''
    errorRef.value = ''
    detachedRef.value = false
    elapsedMsRef.value = 0
    voiceTurnActiveRef.value = false
    setState('requesting_permission')
    try {
      const capture = await browser.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } })
      if (current !== generation) {
        stopTracks(capture)
        return false
      }
      mediaStream = capture
      const mimeType = supportedMimes.find(type => !browser.MediaRecorder.isTypeSupported || browser.MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw new Error('当前浏览器没有可用的录音格式')
      const recorder = new browser.MediaRecorder(capture, { mimeType })
      mediaRecorder = recorder
      chunks = []
      bytes = 0
      recorder.ondataavailable = event => {
        if (current !== generation || !event.data?.size) return
        bytes += event.data.size
        if (bytes > HALL_VOICE_MAX_AUDIO_BYTES) {
          failCapture('录音超过 5MiB，已停止')
          return
        }
        chunks.push(event.data)
      }
      recorder.onerror = () => {
        if (current === generation) failCapture('录音设备出错，已停止')
      }
      recorder.onstop = () => {
        if (current !== generation) return
        clearCaptureTimers()
        const blob = new Blob(chunks, { type: mimeType })
        void upload(current, blob, mimeType)
      }
      recorder.start(250)
      setState('recording')
      const startedAt = Date.now()
      ticker = browser.window.setInterval(() => { elapsedMsRef.value = Math.min(HALL_VOICE_MAX_DURATION_MS, Date.now() - startedAt) }, 100)
      hardStopTimer = browser.window.setTimeout(() => stopRecording(), HALL_VOICE_MAX_DURATION_MS)
      capture.getTracks().forEach(track => {
        track.onended = () => {
          if (current === generation && ['requesting_permission', 'recording', 'stopping'].includes(stateRef.value)) failCapture('录音设备已断开')
        }
      })
      return true
    } catch (cause) {
      if (current !== generation) return false
      const message = cause?.name === 'NotAllowedError'
        ? '未获麦克风权限，仍可使用文字传令'
        : (cause?.message || '当前浏览器无法录音，仍可使用文字传令')
      failCapture(message)
      return false
    }
  }

  const stopRecording = () => {
    if (stateRef.value !== 'recording' || !mediaRecorder) return false
    setState('stopping')
    clearCaptureTimers()
    stopTracks(mediaStream)
    try {
      mediaRecorder.stop()
      return true
    } catch (cause) {
      failCapture(cause?.message || '录音停止失败')
      return false
    }
  }

  const startCountdown = current => {
    setState('pending_send')
    countdownMsRef.value = HALL_VOICE_AUTO_SEND_DELAY_MS
    const startedAt = Date.now()
    countdownTimer = browser.window.setInterval(() => {
      if (current !== generation) return
      countdownMsRef.value = Math.max(0, HALL_VOICE_AUTO_SEND_DELAY_MS - (Date.now() - startedAt))
      if (!matchesFrozen() || isReplyBusy()) {
        openReview(true)
        return
      }
      if (!countdownMsRef.value) {
        clearCaptureTimers()
        void sendTranscript(current)
      }
    }, 50)
  }

  const sendTranscript = async (current = generation) => {
    if (current !== generation || !transcriptRef.value || !matchesFrozen() || isReplyBusy()) {
      openReview(true)
      return false
    }
    const content = `${frozenRef.value.draft}${frozenRef.value.draft ? '\n' : ''}${transcriptRef.value}`
    if (codePointLength(content) > 1200) {
      errorRef.value = '合并内容超过 1200 字符，请手动整理'
      openReview(false)
      return false
    }
    clearCaptureTimers()
    setState('sending')
    voiceTurnActiveRef.value = true
    const frozen = frozenRef.value
    const turnId = safeRequestId(browser.crypto)
    replyTurnId = turnId
    replyTimer = browser.window.setTimeout(() => {
      if (current === generation && voiceTurnActiveRef.value) {
        generation += 1
        finishReplyTurn('idle', 'reply_timeout')
        showToast?.('回话超时，文字传令仍可继续')
      }
    }, 120_000)
    let accepted = false
    try {
      accepted = await onSendVoice?.({
        content,
        contextSnapshot: frozen,
        draftRevision: frozen.draftRevision,
        turnId
      })
    } catch (cause) {
      if (current !== generation || cause?.name === 'AbortError') return false
      errorRef.value = cause?.message || '语音传令失败，请稍后再试'
    }
    if (current !== generation) return false
    if (!accepted) {
      clearReplyTimer()
      pendingFinalReply = null
      voiceTurnActiveRef.value = false
      closeReplyTurn('send_rejected')
      openReview(true)
      return false
    }
    transcriptRef.value = ''
    const finalizedDuringSend = pendingFinalReply
    pendingFinalReply = null
    if (voiceTurnActiveRef.value) {
      setState('waiting_reply')
      if (finalizedDuringSend) {
        void completeReply(finalizedDuringSend)
      }
    }
    return true
  }

  const adoptCurrentContext = () => {
    if (!transcriptRef.value || !detachedRef.value) return false
    const current = snapshotNow()
    if (!current) return false
    frozenRef.value = current
    detachedRef.value = false
    errorRef.value = ''
    setState('review')
    return true
  }

  const applyTranscript = mode => {
    if (!transcriptRef.value || detachedRef.value) return false
    if (!matchesFrozen()) {
      openReview(true)
      return false
    }
    const currentDraft = getDraft()
    if (typeof currentDraft !== 'string') return false
    const next = mode === 'append' ? `${currentDraft}${currentDraft ? '\n' : ''}${transcriptRef.value}` : transcriptRef.value
    if (codePointLength(next) > 1200) {
      errorRef.value = '内容超过 1200 字符，请手动整理'
      return false
    }
    return next
  }

  const synthesize = async text => {
    if (!replyVoiceEnabledRef.value) {
      finishReplyTurn('idle')
      return false
    }
    if (codePointLength(text) > HALL_VOICE_MAX_REPLY_CODE_POINTS) {
      showToast?.('回话较长，已保留文字，未自动朗读')
      finishReplyTurn('idle')
      return false
    }
    const current = ++generation
    voiceTurnActiveRef.value = false
    setState('synthesizing')
    ttsController = new AbortController()
    try {
      const token = await apiStore.token()
      if (current !== generation || !token) throw new Error('语音回答需要登录')
      const response = await browser.fetch(`${runtimeEnv.VITE_API_BASE_URL || ''}/chat/speech/synthesis`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: safeRequestId(browser.crypto), text, voice: 'juyiting-default', format: 'mp3' }),
        signal: ttsController.signal
      })
      const declaredLength = Number(response.headers.get('content-length') || 0)
      if (!response.ok || !response.body || declaredLength > HALL_VOICE_MAX_TTS_BYTES) throw new Error('语音回答暂不可用')
      const reader = response.body.getReader()
      const parts = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > HALL_VOICE_MAX_TTS_BYTES) {
          await reader.cancel()
          throw new Error('语音回答过大')
        }
        parts.push(value)
      }
      if (current !== generation || !total) return false
      playbackUrl = browser.URL.createObjectURL(new Blob(parts, { type: response.headers.get('content-type') || 'audio/mpeg' }))
      const player = new browser.Audio(playbackUrl)
      playback = player
      const finishPlayback = nextState => {
        if (current !== generation) return
        stopPlayback()
        finishReplyTurn(nextState)
      }
      player.onended = () => finishPlayback('idle')
      player.onerror = () => {
        errorRef.value = '语音播放失败，文字已保留'
        finishPlayback('error')
      }
      try {
        await player.play()
      } catch (cause) {
        if (current === generation) {
          errorRef.value = cause?.message || '语音播放失败，文字已保留'
          finishPlayback('error')
        }
        return false
      }
      if (current !== generation) return false
      setState('speaking')
      return true
    } catch (cause) {
      if (current === generation && cause?.name !== 'AbortError') {
        errorRef.value = cause?.message || '语音回答失败，文字已保留'
        stopPlayback()
        finishReplyTurn('error')
      }
      return false
    } finally {
      if (current === generation) ttsController = null
    }
  }

  const completeReply = message => {
    if (!voiceTurnActiveRef.value || typeof message?.content !== 'string' || !message.content.trim()) {
      clearReplyTimer()
      finishReplyTurn('idle')
      return false
    }
    if (stateRef.value === 'sending') {
      pendingFinalReply = message
      return true
    }
    clearReplyTimer()
    return synthesize(message.content)
  }
  const onVisibility = () => {
    if (!browser.document?.hidden || !captureStates.has(stateRef.value)) return
    const preserve = Boolean(transcriptRef.value)
    terminal(preserve ? 'conflict' : (supportedRef.value ? 'idle' : 'unsupported'), {
      clearTranscript: !preserve,
      clearTurn: true,
      detached: preserve
    })
    if (preserve) onOpenReview?.()
  }
  browser.window?.addEventListener?.('pagehide', cancel)
  browser.document?.addEventListener?.('visibilitychange', onVisibility)
  const dispose = () => {
    browser.window?.removeEventListener?.('pagehide', cancel)
    browser.document?.removeEventListener?.('visibilitychange', onVisibility)
    terminal(supportedRef.value ? 'idle' : 'unsupported', { clearTranscript: true, clearTurn: true, replyReason: 'disposed' })
  }
  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return reactive({
    state: stateRef,
    transcript: transcriptRef,
    error: errorRef,
    elapsedMs: elapsedMsRef,
    countdownMs: countdownMsRef,
    autoSendEnabled: autoSendEnabledRef,
    replyVoiceEnabled: replyVoiceEnabledRef,
    detached: detachedRef,
    supported: supportedRef,
    recording: recordingRef,
    canRecord: canRecordRef,
    voiceInteractionLocked: voiceInteractionLockedRef,
    voiceTurnActive: voiceTurnActiveRef,
    targetLabel: targetLabelRef,
    startRecording,
    stopRecording,
    cancel,
    discard,
    adoptCurrentContext,
    applyTranscript,
    sendTranscript,
    completeReply,
    stopPlayback,
    dispose,
    setAutoSendEnabled: value => { autoSendEnabledRef.value = value === true },
    setReplyVoiceEnabled: value => { replyVoiceEnabledRef.value = value === true }
  })
}
