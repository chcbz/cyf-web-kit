<template>
  <aside v-if="enabled && (candidates.length || relevantStatus)" class="execution-termination" aria-label="未交付执行处理">
    <details :open="Boolean(relevantStatus)">
      <summary>本轮操作</summary>
      <template v-if="!status.intent || status.state === 'completed'">
        <div v-for="candidate in candidates" :key="candidate.requestId" class="termination-action">
          <button type="button" :disabled="status.busy || status.state === 'recovery_error' || status.receipt?.requestId === candidate.requestId" @click="askConfirmation(candidate, $event)">放弃本轮未交付结果</button>
        </div>
      </template>
      <div v-if="relevantStatus && status.intent && status.state !== 'completed'" class="termination-recovery">
        <small>正在核对结果，请勿重复提交。</small>
        <button type="button" :disabled="status.busy" @click="abandonment.check">查询结果</button>
        <button type="button" :disabled="status.busy || status.state === 'recovery_error'" @click="abandonment.resume">继续原放弃操作</button>
      </div>
      <p v-if="relevantStatus && status.message" :role="status.state === 'completed' || status.busy ? 'status' : 'alert'">{{ status.message }}</p>
    </details>
    <Teleport to="body">
      <dialog
        v-if="confirmation"
        ref="confirmDialog"
        class="termination-confirm"
        aria-label="确认放弃本轮未交付结果"
        @cancel.prevent="closeConfirmation"
        @click="closeOnBackdrop"
      >
        <strong>放弃本轮未交付结果？</strong>
        <p>放弃后不再接收本轮结果。不会撤销已发生的生成费用，也不表示服务商已停止执行；已上传的成果不能通过此操作丢弃。</p>
        <div class="termination-action">
          <button type="button" @click="closeConfirmation">继续等待</button>
          <button type="button" @click="confirmAbandonment">确认放弃</button>
        </div>
      </dialog>
    </Teleport>
  </aside>
</template>
<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { abandonmentCommand, useHallExecutionAbandonment } from '../../composables/juyiting/useHallExecutionAbandonment.js'
const props = defineProps({ enabled: { type: Boolean, default: false }, requests: { type: Array, default: () => [] },
  conversationId: { type: String, default: '' }, identityKey: { type: String, default: '' },
  controller: { type: Object, default: null }, requestIds: { type: Array, default: null }, excludedRequestIds: { type: Array, default: () => [] } })
const emit = defineEmits(['settled'])
// The discussion owns one controller for all rows: one durable intent/key per conversation.
const abandonment = props.controller || useHallExecutionAbandonment({ conversationId: () => props.enabled ? props.conversationId : null,
  identityKey: () => props.identityKey })
const status = abandonment.status
const accepts = requestId => props.requestIds ? props.requestIds.includes(requestId) : !props.excludedRequestIds.includes(requestId)
const relevantStatus = computed(() => status.value.intent ? accepts(status.value.intent.requestId) : !props.requestIds && Boolean(status.value.message))
const candidates = computed(() => props.requests.filter(request => accepts(request.requestId) && abandonmentCommand(request, props.conversationId)))
const confirmation = ref('')
const confirmDialog = ref(null)
let returnFocus = null
const closeConfirmation = () => {
  confirmation.value = ''
  if (returnFocus?.isConnected) returnFocus.focus()
  returnFocus = null
}
const closeOnBackdrop = event => { if (event.target === confirmDialog.value) closeConfirmation() }
const askConfirmation = async (candidate, event) => {
  returnFocus = event.currentTarget
  confirmation.value = candidate.requestId
  await nextTick()
  if (!confirmation.value) return
  confirmDialog.value?.showModal?.()
  confirmDialog.value?.querySelector('button')?.focus()
}
const confirmAbandonment = () => {
  const request = candidates.value.find(candidate => candidate.requestId === confirmation.value)
  closeConfirmation()
  if (props.enabled && request) abandonment.submit(request)
}
// Identity/conversation changes invalidate an open confirmation, not merely the network response.
watch(() => [props.enabled, props.identityKey, props.conversationId], closeConfirmation, { flush: 'sync' })
let notified = ''
watch(() => status.value.receipt, receipt => {
  if (!props.enabled || !relevantStatus.value || status.value.state !== 'completed' || !receipt || receipt.conversationId !== props.conversationId) return
  const key = JSON.stringify([props.identityKey, receipt.conversationId, receipt.operationId])
  if (key === notified) return
  notified = key
  emit('settled', receipt)
}, { flush: 'sync' })
</script>
<style scoped>
.execution-termination { margin-top: 8px; color: var(--hall-text-muted, #68716b); font-size: 12px; }
.execution-termination summary { cursor: pointer; padding: 6px 0; }
.execution-termination p, .termination-confirm p { margin: 8px 0; line-height: 1.6; overflow-wrap: anywhere; }
.termination-action, .termination-recovery { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0; }
.execution-termination small { min-width: 0; overflow-wrap: anywhere; flex-basis: 100%; }
.execution-termination button, .termination-confirm button { min-height: 40px; padding: 8px 12px; border: 1px solid var(--hall-border, #e3e5dc); border-radius: 6px; background: var(--hall-surface, #fffefa); color: var(--hall-text, #242e2b); font: inherit; cursor: pointer; }
.execution-termination button:disabled { opacity: .55; cursor: default; }
.termination-confirm { box-sizing: border-box; width: min(460px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 20px; border: 1px solid var(--hall-border, #e3e5dc); border-radius: 10px; background: var(--hall-surface, #fffefa); color: var(--hall-text, #242e2b); }
.termination-confirm::backdrop { background: #242e2baa; }
</style>
