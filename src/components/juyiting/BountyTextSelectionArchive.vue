<template>
  <details v-if="eligible" class="text-selection-archive">
    <summary>保存文字片段</summary>
    <label>选择要保存的原文片段
      <textarea
        ref="source"
        :value="message.content"
        readonly
        rows="4"
        @select="captureSelection"
      ></textarea>
    </label>
    <button type="button" :disabled="state.busy || !selection || ['saved', 'pending', 'unknown'].includes(state.state)" @click="archive(false)">
      {{ state.busy ? '正在保存…' : '保存选中文字到工作空间' }}
    </button>
    <button
      v-if="['unknown', 'pending'].includes(state.state)"
      type="button"
      :disabled="state.busy"
      @click="archive(true)"
    >重试原保存</button>
    <p v-if="selection" class="selection-summary">已选择 {{ selection.codePoints }} 个字符</p>
    <p v-if="state.message" :role="state.state === 'saved' ? 'status' : 'alert'">{{ state.message }}</p>
  </details>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { createApi } from '../../composables/useHttp.js'

const props = defineProps({
  conversationId: { type: String, default: '' },
  identityKey: { type: String, default: '' },
  message: { type: Object, required: true }
})
const api = createApi('/chat')
const source = ref(null)
const selection = ref(null)
const state = ref({ state: 'idle', busy: false, message: '', intent: null })
const archiveGeneration = ref(0)
const exactMessageId = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && (value.length < 19 || value <= '9223372036854775807')
const eligible = computed(() => Boolean(props.identityKey && props.conversationId && exactMessageId(props.message?.localId)
  && typeof props.message?.content === 'string' && props.message.content && !props.message?.streaming))
const uuid = () => { const value = globalThis.crypto?.randomUUID?.(); if (!value) throw new Error('当前环境不能生成安全幂等键。'); return `conversation-text-archive-${value}` }
const sha256 = async value => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('')
const resetArchiveState = () => {
  archiveGeneration.value += 1
  state.value = { state: 'idle', busy: false, message: '', intent: null }
}
const captureSelection = () => {
  const element = source.value
  if (!element || element.selectionEnd <= element.selectionStart) { selection.value = null; resetArchiveState(); return }
  const content = String(props.message.content)
  const splitsSurrogate = index => index > 0 && index < content.length
    && /[\uD800-\uDBFF]/.test(content[index - 1]) && /[\uDC00-\uDFFF]/.test(content[index])
  if (splitsSurrogate(element.selectionStart) || splitsSurrogate(element.selectionEnd)) {
    selection.value = null; resetArchiveState()
    state.value.message = '请选择完整字符，不要拆分表情等 Unicode 字符。'
    return
  }
  const selectedText = content.slice(element.selectionStart, element.selectionEnd)
  const nextSelection = {
    startCodePoint: Array.from(content.slice(0, element.selectionStart)).length,
    endCodePoint: Array.from(content.slice(0, element.selectionEnd)).length,
    codePoints: Array.from(selectedText).length,
    text: selectedText
  }
  const previous = selection.value
  if (previous && previous.startCodePoint === nextSelection.startCodePoint
    && previous.endCodePoint === nextSelection.endCodePoint && previous.text === nextSelection.text) return
  selection.value = nextSelection
  resetArchiveState()
}
const archive = async retry => {
  if (!eligible.value || state.value.busy || (!selection.value && !state.value.intent)) return
  const generation = archiveGeneration.value
  let intent = state.value.intent?.body ? state.value.intent : null
  let requestStarted = false
  const ownsAttempt = () => archiveGeneration.value === generation && state.value.intent?.idempotencyKey === intent?.idempotencyKey
  try {
    if (!intent) {
      const selected = selection.value
      const snapshot = { messageId: props.message.localId, startCodePoint: selected.startCodePoint,
        endCodePoint: selected.endCodePoint, text: selected.text }
      intent = { idempotencyKey: uuid(), body: null }
      state.value = { state: 'saving', busy: true, message: '正在从服务端持久正文冻结选区…', intent }
      const digest = await sha256(snapshot.text)
      if (!ownsAttempt()) return
      intent = { idempotencyKey: intent.idempotencyKey, body: { mode: 'create', items: [{
        textSelection: { messageId: snapshot.messageId, startCodePoint: snapshot.startCodePoint,
          endCodePoint: snapshot.endCodePoint, sha256: digest }
      }] } }
    }
    if (!ownsAttempt()) return
    state.value = { state: 'saving', busy: true, message: retry ? '正在重放原保存操作…' : '正在从服务端持久正文冻结选区…', intent }
    requestStarted = true
    const response = await api.execute({ url: `/conversations/${encodeURIComponent(props.conversationId)}/archive-operations`, method: 'POST', headers: { 'Idempotency-Key': intent.idempotencyKey }, data: intent.body, autoLoading: false, needAuth: true })
    if (!ownsAttempt()) return
    const value = response?.data?.data ?? response?.data
    const expected = intent.body.items[0].textSelection
    const item = Array.isArray(value?.items) && value.items.length === 1 ? value.items[0] : null
    const selected = item?.textSelection
    const expectedItemState = { pending: 'pending', saving: 'saving', saved: 'saved', partial_failed: 'failed' }[value?.state]
    const receiptUnknown = () => Object.assign(new Error('保存回执无法确认冻结文字选区。'), { archiveOutcomeUnknown: true })
    if (!/^arc_[0-9a-f]{32}$/.test(value?.operationId || '') || !exactMessageId(value?.revision)
      || !expectedItemState || item?.sourceKind !== 'textSelection' || item.state !== expectedItemState
      || selected?.messageId !== expected.messageId || !exactMessageId(selected?.messageRevision)
      || selected?.startCodePoint !== expected.startCodePoint || selected?.endCodePoint !== expected.endCodePoint
      || selected?.sha256 !== expected.sha256) throw receiptUnknown()
    if (intent.receipt && (value.operationId !== intent.receipt.operationId
      || selected.messageRevision !== intent.receipt.messageRevision
      || BigInt(value.revision) < BigInt(intent.receipt.revision))) throw receiptUnknown()
    intent = { ...intent, receipt: { operationId: value.operationId, revision: value.revision,
      messageRevision: selected.messageRevision } }
    if (value.state === 'pending' || value.state === 'saving') {
      state.value = { state: 'pending', busy: false, message: '保存操作已受理，尚未确认完成；可重试原保存继续核对。', intent }
    } else if (value.state === 'partial_failed') {
      state.value = { state: 'error', busy: false, message: typeof item.message === 'string' && item.message ? item.message : '服务端确认文字片段未保存。', intent }
    } else {
      if (typeof item.fileId !== 'string' || !item.fileId.trim() || !Number.isSafeInteger(item.version) || item.version < 1) throw receiptUnknown()
      state.value = { state: 'saved', busy: false, message: `文字片段已保存：${item.fileId} v${item.version}`, intent }
    }
  } catch (cause) {
    if (!ownsAttempt()) return
    const unknown = requestStarted && (cause?.archiveOutcomeUnknown || cause?.requestErrorClass === 'network' || cause instanceof TypeError || cause?.status >= 500 || cause?.response?.status >= 500)
    state.value = { state: unknown ? 'unknown' : 'error', busy: false, message: unknown ? '保存结果不明确；请重试原操作，核对冻结文字选区。' : (cause?.message || '文字片段保存失败。'), intent: requestStarted ? intent : null }
  }
}
onBeforeUnmount(() => { archiveGeneration.value += 1 })
watch(() => `${props.identityKey}\u0000${props.conversationId}\u0000${props.message?.localId}\u0000${props.message?.content}\u0000${props.message?.streaming}`, () => {
  selection.value = null; resetArchiveState()
}, { flush: 'sync' })
</script>

<style scoped>
.text-selection-archive { margin-top: 6px; font-size: 12px; }
.text-selection-archive summary { cursor: pointer; color: #355f52; }
.text-selection-archive label, .text-selection-archive textarea { display: block; width: 100%; }
.text-selection-archive textarea { box-sizing: border-box; margin: 6px 0; resize: vertical; }
.text-selection-archive button { margin-right: 6px; }
.text-selection-archive p { margin: 4px 0 0; }
</style>
