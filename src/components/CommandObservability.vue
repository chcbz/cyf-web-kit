<template>
  <main class="command-observability">
    <header class="page-header">
      <div>
        <h1>协作运行看板</h1>
        <p>仅供内部只读排查。命令投递或回执不等同于 Agent 任务已经完成。</p>
      </div>
      <div class="page-actions"><button type="button" class="refresh-all" :disabled="capabilityState === 'loading'" @click="refresh">刷新全部</button><button type="button" @click="returnToProfile">返回个人中心</button></div>
    </header>

    <section v-if="capabilityState === 'loading'" class="notice" role="status">正在确认看板访问权限…</section>
    <section v-else-if="capabilityState === 'unavailable' || capabilityState === 'error'" class="notice error" role="alert">
      <p>{{ capabilityError }}</p>
      <button v-if="capabilityState === 'error'" type="button" @click="refresh">重试</button>
      <button type="button" @click="returnToProfile">返回个人中心</button>
    </section>

    <template v-else-if="available">
      <p class="refresh-note" role="status">最近刷新：{{ refreshedAt }}</p>
      <section class="card metrics-card" aria-labelledby="metrics-title">
        <div class="card-heading"><h2 id="metrics-title">指标概览</h2><button type="button" :disabled="metrics.status === 'loading'" @click="loadMetrics">刷新</button></div>
        <p v-if="metrics.error" class="block-error" role="alert">{{ metrics.error }} <button type="button" @click="loadMetrics">重试</button></p>
        <p v-if="metrics.status === 'loading'" role="status">正在读取指标…</p>
        <template v-else>
          <dl class="metric-grid">
            <template v-for="key in metricKeys" :key="key"><dt>{{ metricLabels[key] }}</dt><dd>{{ key === 'ackLatencySeconds' ? duration(metrics.data?.[key]) : metricValue(metrics.data?.[key]) }}</dd></template>
            <dt>采集时间</dt><dd>{{ timestamp(metrics.data?.capturedAt) }}</dd>
          </dl>
          <div v-for="key in statusMapKeys" :key="key" class="status-map"><strong>{{ metricLabels[key] }}</strong><span v-if="statusEntries(metrics.data?.[key]).length">{{ statusEntries(metrics.data?.[key]).map(([name, value]) => `${name}: ${metricValue(value)}`).join('；') }}</span><span v-else>未知</span></div>
        </template>
        <p v-if="metrics.status === 'stale'" class="stale">显示的是上次成功读取的数据，可能已过期。</p>
      </section>

      <section class="card" aria-labelledby="dlq-title">
        <div class="card-heading"><h2 id="dlq-title">失败/死信列表</h2><button type="button" :disabled="dlq.status === 'loading'" @click="loadDlq({ reset: true })">刷新</button></div>
        <p v-if="dlq.error" class="block-error" role="alert">{{ dlq.error }} <button type="button" @click="loadDlq({ reset: !dlq.items.length })">重试</button></p>
        <p v-if="dlq.status === 'loading' && !dlq.items.length" role="status">正在读取失败/死信列表…</p>
        <div v-else class="table-scroll"><table><thead><tr><th v-for="key in dlqKeys" :key="key">{{ dlqLabels[key] }}</th></tr></thead><tbody><tr v-for="row in dlq.items" :key="rowKey(row, 'deliveryId')"><td v-for="key in dlqKeys" :key="key" class="long-value">{{ cell(row, key) }}</td></tr><tr v-if="!dlq.items.length && dlq.status === 'ready'"><td :colspan="dlqKeys.length">暂无可显示的失败/死信记录。</td></tr></tbody></table></div>
        <p v-if="dlq.status === 'stale'" class="stale">显示的是上次成功读取的数据，可能已过期。</p>
        <button
          v-if="dlq.hasMore"
          type="button"
          :disabled="dlq.status === 'loading'"
          @click="loadDlq()"
        >{{ dlq.status === 'loading' ? '正在读取…' : '下一页' }}</button>
      </section>

      <section class="card" aria-labelledby="audit-title">
        <div class="card-heading"><h2 id="audit-title">操作审计</h2><button type="button" :disabled="audit.status === 'loading'" @click="loadAudit({ reset: true })">刷新</button></div>
        <p v-if="audit.error" class="block-error" role="alert">{{ audit.error }} <button type="button" @click="loadAudit({ reset: !audit.items.length })">重试</button></p>
        <p v-if="audit.status === 'loading' && !audit.items.length" role="status">正在读取操作审计…</p>
        <div v-else class="table-scroll"><table><thead><tr><th v-for="key in auditKeys" :key="key">{{ auditLabels[key] }}</th></tr></thead><tbody><tr v-for="row in audit.items" :key="rowKey(row, 'id')"><td v-for="key in auditKeys" :key="key" class="long-value">{{ cell(row, key) }}</td></tr><tr v-if="!audit.items.length && audit.status === 'ready'"><td :colspan="auditKeys.length">暂无可显示的操作审计记录。</td></tr></tbody></table></div>
        <p v-if="audit.status === 'stale'" class="stale">显示的是上次成功读取的数据，可能已过期。</p>
        <button
          v-if="audit.hasMore"
          type="button"
          :disabled="audit.status === 'loading'"
          @click="loadAudit()"
        >{{ audit.status === 'loading' ? '正在读取…' : '下一页' }}</button>
      </section>
    </template>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useApiStore } from '@/stores/api'
import { useGlobalStore } from '@/stores/global'
import { useCommandObservability } from '@/composables/useCommandObservability'
import { observationDuration, observationString, observationTimestamp, observationValue } from '@/utils/commandObservabilityPolicy'
import { returnToProfile as navigateToProfile } from '@/utils/profileNavigation'

const router = useRouter()
const apiStore = useApiStore()
const globalStore = useGlobalStore()
const identity = () => [globalStore.user?.id, globalStore.user?.username, globalStore.user?.openid].map(value => value == null ? '' : String(value)).join('\u0000')
const board = useCommandObservability({ getAuthGeneration: () => apiStore.authorizationGeneration, getIdentity: identity })
const { capabilityState, capabilityError, available, metrics, dlq, audit, refresh, loadMetrics, loadDlq, loadAudit, resetForIdentity, dispose } = board
const metricKeys = ['ackLatencySeconds', 'outboxBacklog', 'outboxOldestAgeSeconds', 'publishFailureTotal', 'rabbitDlqCount', 'waitingDueCount', 'sentUnacknowledgedCount', 'reconnectQueueDepth', 'expiryProximityCount']
const metricLabels = Object.freeze({ ackLatencySeconds: '确认延迟秒数', deliveryByStatus: '投递状态统计', inboxByStatus: 'Inbox 状态统计', inboxByResult: 'Inbox 结果统计', outboxByStatus: 'Outbox 状态统计', operationsByTypeAndOutcome: '操作结果统计', outboxBacklog: 'Outbox 积压', outboxOldestAgeSeconds: '最旧 Outbox 秒数', publishFailureTotal: '发布失败总数', rabbitDlqCount: 'Rabbit 死信数', waitingDueCount: '待处理到期数', sentUnacknowledgedCount: '已发送未确认数', reconnectQueueDepth: '重连队列深度', expiryProximityCount: '接近过期数' })
const statusMapKeys = ['deliveryByStatus', 'inboxByStatus', 'inboxByResult', 'outboxByStatus', 'operationsByTypeAndOutcome']
const dlqKeys = ['deliveryId', 'commandId', 'eventId', 'messageId', 'taskId', 'targetAgentId', 'deliveryStatus', 'outboxStatus', 'inboxStatus', 'inboxResultStatus', 'activeAttempt', 'publishAttemptCount', 'publishedAt', 'processedAt', 'expiresAt', 'updatedAt']
const dlqLabels = Object.freeze({ deliveryId: '投递 ID', commandId: '命令 ID', eventId: '事件 ID', messageId: '消息 ID', taskId: '任务 ID', targetAgentId: '目标 Agent', deliveryStatus: '投递状态', outboxStatus: 'Outbox', inboxStatus: 'Inbox', inboxResultStatus: '结果', activeAttempt: '活动尝试', publishAttemptCount: '发布次数', publishedAt: '发布时间', processedAt: '处理时间', expiresAt: '到期时间', updatedAt: '更新时间' })
const auditKeys = ['id', 'operationId', 'phase', 'operationType', 'taskId', 'targetAgentId', 'deliveryId', 'sourceAttempt', 'newAttempt', 'requestedAt', 'completedAt', 'outcome', 'errorCode', 'createdAt']
const auditLabels = Object.freeze({ id: '审计 ID', operationId: '操作 ID', phase: '阶段', operationType: '类型', taskId: '任务 ID', targetAgentId: '目标 Agent', deliveryId: '投递 ID', sourceAttempt: '来源尝试', newAttempt: '新尝试', requestedAt: '请求时间', completedAt: '完成时间', outcome: '结果', errorCode: '错误码', createdAt: '创建时间' })
const timestampKeys = new Set(['publishedAt', 'processedAt', 'expiresAt', 'updatedAt', 'requestedAt', 'completedAt', 'createdAt'])
const numericKeys = new Set(['activeAttempt', 'publishAttemptCount', 'sourceAttempt', 'newAttempt'])
const duration = observationDuration
const metricValue = observationValue
const timestamp = observationTimestamp
const statusEntries = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value).filter(([key]) => typeof key === 'string' && key.length > 0) : []
const cell = (row, key) => timestampKeys.has(key) ? observationTimestamp(row?.[key]) : numericKeys.has(key) ? observationValue(row?.[key]) : observationString(row?.[key])
const rowKey = (row, field) => observationString(row?.[field])
const refreshedAt = computed(() => {
  const values = [metrics.value.updatedAt, dlq.value.updatedAt, audit.value.updatedAt].filter(Boolean)
  return values.length ? observationTimestamp(Math.max(...values)) : '尚未成功读取'
})
const returnToProfile = () => navigateToProfile(router)

watch(() => [apiStore.authorizationGeneration, identity()], () => { resetForIdentity(); void refresh() }, { flush: 'sync' })
onMounted(() => { globalStore.setTitle('协作运行看板'); globalStore.setShowBack(false); globalStore.setShowMore(false); void refresh() })
onBeforeUnmount(dispose)
</script>

<style scoped>
.command-observability { flex: 1; overflow: auto; padding: 16px; background: var(--color-body, #f8fafc); color: #172033; }
.page-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.page-header, .card-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.page-header { flex-wrap: wrap; margin-bottom: 16px; }.page-header h1, .card h2 { margin: 0; }.page-header p { margin: 6px 0 0; color: #475569; }
.card, .notice { margin-bottom: 16px; padding: 16px; border: 1px solid #dbe3ee; border-radius: 10px; background: #fff; }.error, .block-error { color: #991b1b; }.block-error button { margin-left: 8px; }.refresh-note, .stale { color: #64748b; font-size: .9rem; }.stale { margin-bottom: 0; }.metric-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px 16px; }.metric-grid dt { color: #475569; }.metric-grid dd { margin: 2px 0 0; font-weight: 600; }
.status-map { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; overflow-wrap: anywhere; }.table-scroll { overflow: auto; max-width: 100%; margin: 12px 0; } table { border-collapse: collapse; width: 100%; min-width: 960px; } th, td { border: 1px solid #dbe3ee; padding: 8px; vertical-align: top; text-align: left; } th { background: #f1f5f9; white-space: nowrap; }.long-value { max-width: 220px; overflow-wrap: anywhere; word-break: break-word; } button { min-height: 36px; }
@media (max-width: 600px) { .command-observability { padding: 12px; }.card, .notice { padding: 12px; }.page-header { align-items: flex-start; }.card-heading { align-items: flex-start; } }
</style>
