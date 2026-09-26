<template>
  <section class="formal-delivery-list" aria-label="正式交付">
    <header>
      <strong>正式交付</strong>
      <button type="button" :disabled="deliveries.loading.value || Boolean(deliveries.busyDeliveryId.value)" @click="deliveries.refresh">刷新</button>
    </header>
    <p v-if="deliveries.state.value === 'loading'" class="formal-delivery-state" role="status">正式交付读取中…</p>
    <p v-else-if="deliveries.state.value === 'empty'" class="formal-delivery-state">暂无正式交付批次。</p>
    <p v-else-if="deliveries.state.value === 'forbidden'" class="formal-delivery-state is-error">无访问权限。</p>
    <p
      v-else-if="deliveries.message.value"
      class="formal-delivery-state"
      :class="{ 'is-error': ['conflict', 'unknown', 'error'].includes(deliveries.state.value) }"
      role="status"
    >{{ deliveries.message.value }} <button v-if="deliveries.refreshRequired.value || deliveries.state.value === 'conflict' || deliveries.state.value === 'unknown'" type="button" @click="deliveries.refresh">刷新确认</button></p>

    <p v-if="focusDeliveryId && !deliveries.loading.value && !deliveries.items.value.some(item => item.deliveryId === focusDeliveryId)" role="status">提示中的交付尚未在当前列表核对到，请刷新正式交付；不会用消息摘要代替验收依据。</p>
    <article
      v-for="delivery in deliveries.items.value"
      :key="delivery.deliveryId"
      class="formal-delivery-card"
      :class="{ 'is-requested-delivery': delivery.deliveryId === focusDeliveryId }"
    >
      <strong v-if="delivery.deliveryId === focusDeliveryId">本次待核对的交付</strong>
      <div class="formal-delivery-head">
        <strong>{{ stateText(delivery.state) }}</strong>
        <span>第 {{ delivery.revision }} 版</span>
      </div>
      <p class="formal-delivery-summary">{{ delivery.summary || '未提供交付摘要。' }}</p>
      <p>提交于 {{ formatTime(delivery.submittedAt) }} · 交付 Agent {{ delivery.producerAgentId }}</p>
      <section class="formal-artifacts" aria-label="交付文件">
        <h4>交付文件</h4>
        <ul>
          <li v-for="artifact in delivery.items" :key="`${artifact.artifactId}:${artifact.artifactVersion}`">
            <div class="formal-artifact-copy">
              <strong>{{ readableArtifact(delivery, artifact)?.title || artifact.purpose || '正式成果' }}</strong>
              <span>{{ artifact.purpose || '正式成果' }} · 固定版本 v{{ artifact.artifactVersion }}</span>
            </div>
            <div v-if="readableArtifact(delivery, artifact)" class="formal-artifact-actions">
              <button
                v-if="canPreview(readableArtifact(delivery, artifact))"
                type="button"
                :aria-label="`预览第 ${delivery.revision} 版${artifact.purpose || '正式成果'}`"
                :aria-pressed="isPreviewing(delivery, artifact)"
                @click="$emit('preview-output', readableArtifact(delivery, artifact))"
              >{{ isPreviewing(delivery, artifact) ? '收起预览' : '预览' }}</button>
              <button
                type="button"
                :disabled="!readableArtifact(delivery, artifact).canDownload"
                :aria-label="`下载第 ${delivery.revision} 版${artifact.purpose || '正式成果'}`"
                @click="$emit('download-output', readableArtifact(delivery, artifact))"
              >下载</button>
            </div>
            <div v-if="isPreviewing(delivery, artifact)" class="formal-inline-preview">
              <slot name="preview" :output="readableArtifact(delivery, artifact)" />
            </div>
          </li>
        </ul>
      </section>
      <details class="formal-technical"><summary>技术信息</summary>
        <p>批次 {{ delivery.deliveryId }} · 工作项 {{ delivery.workItemId }} · 运行 {{ delivery.runId }}</p>
        <p>任务版本 {{ delivery.taskVersion }} · 工作项版本 {{ delivery.workItemVersion }}</p>
        <p>清单 {{ delivery.manifestArtifactId }} · v{{ delivery.manifestArtifactVersion }}</p>
        <ul><li v-for="artifact in delivery.items" :key="`tech:${artifact.artifactId}:${artifact.artifactVersion}`">{{ artifact.artifactId }} · {{ artifact.contentHash }}</li></ul>
      </details>
      <section v-if="delivery.reviewedAt || delivery.reviewReason" class="formal-review" aria-label="验收意见">
        <h4>验收意见</h4>
        <p v-if="delivery.reviewedAt">{{ formatTime(delivery.reviewedAt) }}</p>
        <p>{{ delivery.reviewReason || '未填写验收意见。' }}</p>
      </section>
      <form v-if="delivery.state === 'submitted'" class="formal-decision" @submit.prevent="submitDecision(delivery, $event)">
        <h4>验收此正式交付</h4>
        <p>验收通过不会记录说明；要求修改时必须填写说明。</p>
        <label>要求修改说明（要求修改时必填）<textarea v-model="reviewReasons[delivery.deliveryId]" maxlength="4000" :disabled="isBusy(delivery) || deliveries.refreshRequired.value"></textarea></label>
        <div>
          <button
            type="submit"
            name="decision"
            value="accepted"
            :disabled="isBusy(delivery) || deliveries.refreshRequired.value"
          >{{ isBusy(delivery) ? '提交中…' : '验收通过' }}</button>
          <button
            type="submit"
            name="decision"
            value="changes_requested"
            :disabled="isBusy(delivery) || deliveries.refreshRequired.value"
          >要求修改</button>
        </div>
      </form>
      <form v-else-if="delivery.state === 'changes_requested' && reworkSource(delivery) && !reworkCreated[delivery.deliveryId]" class="formal-rework" @submit.prevent="submitRework(delivery)">
        <h4>按指定版本返工</h4>
        <p>源成果 {{ reworkSource(delivery).outputId }} / 工作空间文件 {{ reworkSource(delivery).fileRef.fileId }} · v{{ reworkSource(delivery).fileRef.fileVersion }}。系统只发送这一固定版本。</p>
        <label>返工说明<textarea
          v-model="reworkInstructions[delivery.deliveryId]"
          maxlength="4000"
          :disabled="isReworkBusy(delivery) || deliveries.refreshRequired.value"
          placeholder="例如：按验收意见缩短第 3 页，并增加总结页。"
        ></textarea></label>
        <p>交付格式：{{ reworkSource(delivery).mimeType }}</p>
        <button type="submit" :disabled="isReworkBusy(delivery) || deliveries.refreshRequired.value || !reworkInstructions[delivery.deliveryId]?.trim()">{{ isReworkBusy(delivery) ? '创建返工中…' : '明确交给 Agent 返工' }}</button>
      </form>
      <p v-else-if="reworkCreated[delivery.deliveryId]" role="status">返工执行已创建，等待 Agent 交付新的正式成果；不会自动重复创建。</p>
      <section v-else-if="delivery.state === 'changes_requested'" class="formal-rework formal-rework-hint">
        <h4>要求修改已记录</h4>
        <p>请进入该悬赏的议事，选择负责 Agent 后基于指定成果版本明确创建返工；不会自动重新调用模型。</p>
      </section>
    </article>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, watch } from 'vue'
import { useFormalDeliveries } from '../../composables/useFormalDeliveries.js'

const props = defineProps({
  focusDeliveryId: { type: String, default: '' },
  taskId: { type: [String, Number], default: '' },
  identityFingerprint: { type: [String, Object, Function], default: '' },
  adapter: { type: Object, default: undefined },
  conversationId: { type: String, default: '' },
  targetAgentId: { type: String, default: '' },
  outputs: { type: Array, default: () => [] },
  readOutputs: { type: Array, default: () => [] },
  previewOutputKey: { type: String, default: '' }
})
const emit = defineEmits(['rework-created', 'refreshed', 'preview-output', 'download-output'])
const deliveries = useFormalDeliveries({ taskId: () => String(props.taskId || ''), identityFingerprint: () => props.identityFingerprint, adapter: props.adapter })
const reviewReasons = reactive({})
const reworkInstructions = reactive({})
const reworkCreated = reactive({})
watch(() => deliveries.items.value, () => emit('refreshed'))
watch(() => `${props.taskId}:${props.identityFingerprint}:${props.conversationId}:${props.targetAgentId}`, () => {
  for (const values of [reviewReasons, reworkInstructions, reworkCreated]) {
    for (const key of Object.keys(values)) delete values[key]
  }
})
const safeOutputs = computed(() => Array.isArray(props.outputs) ? props.outputs : [])
const safeReadOutputs = computed(() => Array.isArray(props.readOutputs) ? props.readOutputs : [])
const isBusy = delivery => deliveries.busyDeliveryId.value === delivery.deliveryId
const isReworkBusy = delivery => deliveries.reworkBusyDeliveryId.value === delivery.deliveryId
const readableArtifact = (delivery, artifact) => safeReadOutputs.value.find(output => output &&
  output.artifactId === artifact.artifactId && String(output.artifactVersion) === String(artifact.artifactVersion) &&
  output.sha256 === artifact.contentHash && output.state === 'AVAILABLE') || null
const outputKey = output => output ? `${output.artifactId}:${output.artifactVersion}:${output.sha256}` : ''
const isPreviewing = (delivery, artifact) => Boolean(props.previewOutputKey && props.previewOutputKey === outputKey(readableArtifact(delivery, artifact)))
const previewMimeTypes = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'application/json', 'image/png', 'image/jpeg', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
])
const canPreview = output => Boolean(output?.canPreview && previewMimeTypes.has(output.mimeType) &&
  (output.mimeType.includes('officedocument') || (Number.isSafeInteger(output.byteLength) && output.byteLength <= 1024 * 1024)))
const reworkSource = delivery => props.conversationId && props.targetAgentId && safeOutputs.value.find(output => output && output.formalDeliveryId === delivery.deliveryId && output.formalDecisionVersion === delivery.deliveryVersion && output.formalDeliveryState === 'changes_requested' && output.outputId && output.fileRef?.fileId && output.fileRef?.fileVersion && output.mimeType) || null
const formatTime = value => { const time = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '时间不可用' }
const stateText = state => ({ submitted: '待验收', accepted: '已验收', changes_requested: '要求修改' })[state] || state
const submitDecision = (delivery, event) => {
  const decision = event.submitter?.value
  if (!['accepted', 'changes_requested'].includes(decision)) return
  void deliveries.decide({ delivery, decision, reviewReason: String(reviewReasons[delivery.deliveryId] || '').trim() })
}
const submitRework = async delivery => {
  const source = reworkSource(delivery)
  if (!source) return
  const result = await deliveries.createRework({
    delivery, source, conversationId: props.conversationId, targetAgentId: props.targetAgentId,
    instruction: String(reworkInstructions[delivery.deliveryId] || '').trim(), outputContentMimeType: source.mimeType
  })
  if (result) {
    reworkCreated[delivery.deliveryId] = result.executionId
    reworkInstructions[delivery.deliveryId] = ''
    emit('rework-created', result)
  }
}
onBeforeUnmount(() => deliveries.dispose())
</script>

<style scoped>
.is-requested-delivery{outline:2px solid #7c1f1b;outline-offset:2px}.formal-delivery-list{display:grid;gap:10px;align-content:start;min-width:0;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;margin-top:12px;padding:12px 2px 12px 0;border-top:1px solid rgba(117,67,11,.22)}.formal-delivery-list header{display:flex;justify-content:space-between;align-items:center;gap:8px}.formal-delivery-list button{min-height:36px;border:1px solid #315d4e;border-radius:5px;padding:5px 9px;color:#fff;background:#315d4e}.formal-delivery-list button[disabled]{opacity:.55}.formal-delivery-state{margin:0;padding:8px;border-radius:6px;background:#f7edcf;color:#765d2d}.formal-delivery-state.is-error{background:#fae7e1;color:#7a3026}.formal-delivery-card{display:grid;gap:6px;min-width:0;padding:10px;border:1px solid #ded3bf;border-radius:8px;background:#fffdf7}.formal-delivery-card p,.formal-delivery-card h4{margin:0}.formal-delivery-head{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.formal-delivery-head span,.formal-delivery-card>p{font-size:12px;color:#6c6258;overflow-wrap:anywhere}.formal-delivery-summary{font-size:14px!important;color:#3d332a!important}.formal-artifacts,.formal-review,.formal-decision,.formal-rework{display:grid;gap:6px;padding-top:8px;border-top:1px solid #eee3d0}.formal-artifacts ul{display:grid;gap:7px;margin:0;padding:0;list-style:none}.formal-artifacts li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;min-width:0;padding:7px;border-radius:6px;background:#f8f3e9;font-size:12px;overflow-wrap:anywhere}.formal-artifact-copy{display:grid;gap:2px;min-width:0}.formal-artifacts li span{color:#6c6258}.formal-artifact-actions{display:flex;gap:6px}.formal-artifact-actions button{min-width:52px}.formal-inline-preview{grid-column:1/-1;min-width:0}.formal-inline-preview :deep(.output-preview){margin-top:0;max-height:320px;background:#fffdf8}.formal-review{font-size:13px}.formal-decision label,.formal-rework label{display:grid;gap:4px;font-size:13px}.formal-decision textarea,.formal-rework textarea{min-height:58px;padding:6px;border:1px solid #b8aa94;border-radius:4px;resize:vertical}.formal-decision>div{display:flex;gap:8px;flex-wrap:wrap}.formal-decision button:last-child{background:#7c1f1b;border-color:#7c1f1b}.formal-rework-hint{font-size:13px;color:#765d2d}.formal-technical{font-size:11px;color:#6c6258}.formal-technical summary{cursor:pointer}.formal-technical ul{margin:6px 0 0;padding-left:18px;overflow-wrap:anywhere}
@media (max-width:420px){.formal-artifacts li{grid-template-columns:minmax(0,1fr);align-items:stretch}.formal-artifact-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.formal-artifact-actions button{width:100%;min-height:44px}.formal-inline-preview{grid-column:1}}
</style>
