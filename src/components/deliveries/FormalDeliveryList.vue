<template>
  <section class="formal-delivery-list" aria-label="正式交付">
    <header>
      <strong>正式交付</strong>
      <button type="button" :disabled="deliveries.loading.value || Boolean(deliveries.busyDeliveryId.value)" @click="deliveries.refresh">刷新</button>
    </header>
    <p v-if="deliveries.state.value === 'loading'" class="formal-delivery-state" role="status">正式交付读取中…</p>
    <p v-else-if="deliveries.state.value === 'empty'" class="formal-delivery-state">暂无正式交付批次。</p>
    <p v-else-if="deliveries.state.value === 'forbidden'" class="formal-delivery-state is-error">无访问权限。</p>
    <p v-else-if="deliveries.message.value" class="formal-delivery-state" :class="{ 'is-error': ['conflict', 'unknown', 'error'].includes(deliveries.state.value) }" role="status">{{ deliveries.message.value }} <button v-if="deliveries.refreshRequired.value || deliveries.state.value === 'conflict' || deliveries.state.value === 'unknown'" type="button" @click="deliveries.refresh">刷新确认</button></p>

    <article v-for="delivery in deliveries.items.value" :key="delivery.deliveryId" class="formal-delivery-card">
      <div class="formal-delivery-head">
        <strong>{{ stateText(delivery.state) }}</strong>
        <span>批次 {{ delivery.deliveryId }} · r{{ delivery.revision }}</span>
      </div>
      <p class="formal-delivery-summary">{{ delivery.summary || '未提供交付摘要。' }}</p>
      <p>工作项 {{ delivery.workItemId }} · 任务版本 {{ delivery.taskVersion }} · 工作项版本 {{ delivery.workItemVersion }}</p>
      <p>提交于 {{ formatTime(delivery.submittedAt) }} · 运行 {{ delivery.runId }} · 交付 Agent {{ delivery.producerAgentId }}</p>
      <p>清单 {{ delivery.manifestArtifactId }} · v{{ delivery.manifestArtifactVersion }}</p>
      <section class="formal-artifacts" aria-label="固定 artifact 列表">
        <h4>固定 artifact 列表</h4>
        <ul>
          <li v-for="artifact in delivery.items" :key="`${artifact.artifactId}:${artifact.artifactVersion}`">
            <strong>{{ artifact.artifactId }} · v{{ artifact.artifactVersion }}</strong>
            <span>{{ artifact.purpose }}</span>
            <span>内容哈希 {{ artifact.contentHash }}</span>
          </li>
        </ul>
      </section>
      <section v-if="delivery.reviewedAt || delivery.reviewReason" class="formal-review" aria-label="验收意见">
        <h4>验收意见</h4>
        <p v-if="delivery.reviewedAt">{{ formatTime(delivery.reviewedAt) }}</p>
        <p>{{ delivery.reviewReason || '未填写验收意见。' }}</p>
      </section>
      <form v-if="delivery.state === 'submitted'" class="formal-decision" @submit.prevent="submitDecision(delivery)">
        <h4>验收此正式交付</h4>
        <label>验收意见（可选）<textarea v-model="reviewReasons[delivery.deliveryId]" maxlength="4000" :disabled="isBusy(delivery) || deliveries.refreshRequired.value" /></label>
        <div>
          <button type="submit" name="decision" value="accepted" :disabled="isBusy(delivery) || deliveries.refreshRequired.value">{{ isBusy(delivery) ? '提交中…' : '验收通过' }}</button>
          <button type="submit" name="decision" value="changes_requested" :disabled="isBusy(delivery) || deliveries.refreshRequired.value">要求修改</button>
        </div>
      </form>
    </article>
  </section>
</template>

<script setup>
import { onBeforeUnmount, reactive } from 'vue'
import { useFormalDeliveries } from '../../composables/useFormalDeliveries.js'

const props = defineProps({ taskId: { type: [String, Number], default: '' }, identityFingerprint: { type: [String, Object, Function], default: '' }, adapter: { type: Object, default: undefined } })
const deliveries = useFormalDeliveries({ taskId: () => String(props.taskId || ''), identityFingerprint: () => props.identityFingerprint, adapter: props.adapter })
const reviewReasons = reactive({})
const isBusy = delivery => deliveries.busyDeliveryId.value === delivery.deliveryId
const formatTime = value => { const time = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(time) ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '时间不可用' }
const stateText = state => ({ submitted: '待验收', accepted: '已验收', changes_requested: '要求修改' })[state] || state
const submitDecision = (delivery, event) => {
  const decision = event.submitter?.value
  if (!['accepted', 'changes_requested'].includes(decision)) return
  void deliveries.decide({ delivery, decision, reviewReason: String(reviewReasons[delivery.deliveryId] || '').trim() })
}
onBeforeUnmount(() => deliveries.dispose())
</script>

<style scoped>
.formal-delivery-list{display:grid;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(117,67,11,.22)}.formal-delivery-list header{display:flex;justify-content:space-between;align-items:center;gap:8px}.formal-delivery-list button{border:1px solid #315d4e;border-radius:5px;padding:5px 9px;color:#fff;background:#315d4e}.formal-delivery-list button[disabled]{opacity:.55}.formal-delivery-state{margin:0;padding:8px;border-radius:6px;background:#f7edcf;color:#765d2d}.formal-delivery-state.is-error{background:#fae7e1;color:#7a3026}.formal-delivery-card{display:grid;gap:6px;padding:10px;border:1px solid #ded3bf;border-radius:8px;background:#fffdf7}.formal-delivery-card p,.formal-delivery-card h4{margin:0}.formal-delivery-head{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.formal-delivery-head span,.formal-delivery-card>p{font-size:12px;color:#6c6258;overflow-wrap:anywhere}.formal-delivery-summary{font-size:14px!important;color:#3d332a!important}.formal-artifacts,.formal-review,.formal-decision{display:grid;gap:6px;padding-top:8px;border-top:1px solid #eee3d0}.formal-artifacts ul{display:grid;gap:5px;margin:0;padding-left:18px}.formal-artifacts li{display:grid;gap:2px;font-size:12px;overflow-wrap:anywhere}.formal-artifacts li span{color:#6c6258}.formal-review{font-size:13px}.formal-decision label{display:grid;gap:4px;font-size:13px}.formal-decision textarea{min-height:58px;padding:6px;border:1px solid #b8aa94;border-radius:4px;resize:vertical}.formal-decision>div{display:flex;gap:8px;flex-wrap:wrap}.formal-decision button:last-child{background:#7c1f1b;border-color:#7c1f1b}
</style>
