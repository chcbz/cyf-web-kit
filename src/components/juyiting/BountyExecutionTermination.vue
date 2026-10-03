<template>
  <aside v-if="enabled && (candidates.length || status.intent || status.message)" class="execution-termination" aria-label="未交付执行处理">
    <strong>处理未交付的一轮</strong>
    <p>放弃后不再接收本轮结果。不会撤销已发生的生成费用，也不表示服务商已停止执行；已上传的成果不能通过此操作丢弃。</p>
    <template v-if="!status.intent || status.state === 'completed'">
      <div v-for="candidate in candidates" :key="candidate.requestId" class="termination-action">
        <small>请求 {{ candidate.requestId }}</small>
        <button type="button" :disabled="status.busy || status.state === 'recovery_error' || status.receipt?.requestId === candidate.requestId" @click="abandonment.submit(candidate)">放弃本轮未交付结果</button>
      </div>
    </template>
    <div v-if="status.intent && status.state !== 'completed'" class="termination-recovery">
      <small>正在核对原请求 {{ status.intent.requestId }}，不会创建新的生成任务。</small>
      <button type="button" :disabled="status.busy" @click="abandonment.check">查询原操作结果</button>
      <button type="button" :disabled="status.busy || status.state === 'recovery_error'" @click="abandonment.resume">继续原放弃操作</button>
    </div>
    <p v-if="status.message" :role="status.state === 'completed' || status.busy ? 'status' : 'alert'">{{ status.message }}</p>
  </aside>
</template>
<script setup>
import { computed, watch } from 'vue'
import { abandonmentCommand, useHallExecutionAbandonment } from '../../composables/juyiting/useHallExecutionAbandonment.js'
const props = defineProps({ enabled: { type: Boolean, default: false }, requests: { type: Array, default: () => [] },
  conversationId: { type: String, default: '' }, identityKey: { type: String, default: '' } })
const emit = defineEmits(['settled'])
const abandonment = useHallExecutionAbandonment({ conversationId: () => props.enabled ? props.conversationId : null,
  identityKey: () => props.identityKey })
const status = abandonment.status
const candidates = computed(() => props.requests.filter(request => abandonmentCommand(request, props.conversationId)))
let notified = ''
watch(() => status.value.receipt, receipt => {
  if (!props.enabled || status.value.state !== 'completed' || !receipt || receipt.conversationId !== props.conversationId) return
  const key = JSON.stringify([props.identityKey, receipt.conversationId, receipt.operationId])
  if (key === notified) return
  notified = key
  // A validated receipt is a refresh hint; the parent re-reads the authoritative request.
  emit('settled', receipt)
}, { flush: 'sync' })
</script>
<style scoped>
.execution-termination { padding: 12px; border: 1px solid #a76317; border-radius: 8px; background: #fff6de; color: #563810; font-size: 13px; }
.execution-termination strong { font-size: 15px; }
.execution-termination p { margin: 8px 0; line-height: 1.5; }
.termination-action, .termination-recovery { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 8px 0; }
.execution-termination small { min-width: 0; overflow-wrap: anywhere; flex-basis: 100%; }
.execution-termination button { flex: 0 1 auto; min-width: 0; padding: 8px 12px; border: 1px solid #935214; border-radius: 6px; background: #fff; color: #743c0f; cursor: pointer; }
.execution-termination button:disabled { opacity: .55; cursor: default; }
</style>
