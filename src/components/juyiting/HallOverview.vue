<template>
  <section class="hall-overview" :aria-label="messagesOnly ? '消息' : '办事概览'">
    <header>
      <h2>{{ messagesOnly ? '消息 · 需要处理' : '办事概览' }}</h2>
      <button type="button" :disabled="!enabled || model.state.value === 'loading'" @click="model.refresh">刷新</button>
    </header>
    <p v-if="messagesOnly">这里列出仍需处理的事项。打开或查看不代表已读、验收或归档。</p>
    <p v-if="!enabled" role="status">身份确认后读取你的事项。</p>
    <p v-if="model.openError.value" role="alert">{{ model.openError.value }}</p>
    <section
      v-for="view in views"
      :key="view"
      class="overview-section"
      :aria-label="viewLabels[view]"
    >
      <h3>{{ viewLabels[view] }}</h3>
      <p v-if="model.state.value === 'loading'" role="status">正在读取事项…</p>
      <p v-else-if="model.sections.value[view].status === 'partial'" role="status">部分来源尚不完整，不能据此判断所有事项均已处理。</p>
      <p v-else-if="model.sections.value[view].status === 'error'" role="alert">本次未能确认事项，请按来源重试。</p>
      <section
        v-for="source in sources"
        :key="source"
        class="overview-source"
        :data-source="source"
      >
        <header><h4>{{ sourceLabels[source] }}</h4></header>
        <template v-for="(part, index) in [model.sections.value[view].partitions[source]]" :key="index">
          <p v-if="part.loading" role="status">正在读取此来源…</p>
          <p v-if="part.readError || part.errorCode" :role="part.status === 'error' ? 'alert' : 'status'">{{ part.readError || sourceError(part.errorCode) }}</p>
          <p v-if="part.status === 'complete' && !part.items.length && !part.loading" class="overview-empty">{{ view === 'recent' ? '此来源暂无最近事项。' : '此来源暂无需要处理的事项。' }}</p>
          <article v-for="item in part.items" :key="`${item.ref.sourceType}:${item.ref.sourceId}`" class="overview-item">
            <strong>{{ item.title || '未命名事项' }}</strong>
            <span>{{ typeLabels[item.ref.sourceType] }} · {{ statusText(item.status.code) }}</span>
            <small v-if="item.targetAgent">受托好汉：{{ item.targetAgent.agentId }}</small>
            <small>状态核对于 {{ formatTime(item.status.observedAt) }}</small>
            <button
              v-if="canOpenHallItem(item)"
              type="button"
              :disabled="Boolean(model.openingRef.value)"
              @click="openItem(item)"
            >{{ actionLabels[item.nextAction] }}</button>
            <span v-else>当前无可用办理入口。</span>
          </article>
          <div class="overview-source-actions">
            <button
              v-if="['complete', 'partial', 'error'].includes(part.status)"
              type="button"
              :disabled="part.loading || model.state.value === 'loading'"
              @click="model.loadPartition(view, source)"
            >{{ part.status === 'complete' ? '刷新此来源' : '重试此来源' }}</button>
            <button
              v-if="part.nextCursor"
              type="button"
              :disabled="part.loading"
              @click="model.loadPartition(view, source, { append: true })"
            >读取此来源更多记录</button>
          </div>
        </template>
      </section>
    </section>
  </section>
</template>

<script setup>
import { computed, watch } from 'vue'
import { canOpenHallItem, HALL_SOURCES, useHallOverview } from '@/composables/juyiting/useHallOverview'

const props = defineProps({
  identityScope: { type: String, default: '' },
  identityEpoch: { type: [Number, String], default: 0 },
  enabled: { type: Boolean, default: false },
  messagesOnly: { type: Boolean, default: false }
})
const emit = defineEmits(['open-item', 'open-task'])
const model = useHallOverview({ identityScope: () => props.identityScope, identityEpoch: () => props.identityEpoch })
const views = computed(() => props.messagesOnly ? ['needsAction'] : ['recent', 'needsAction'])
const sources = HALL_SOURCES
const viewLabels = { recent: '最近事项', needsAction: '需要处理' }
const sourceLabels = { private: '私人交办', task: '正式悬赏', draft: '未交办草稿' }
const typeLabels = { PRIVATE_CASE: '私人事项', LEGACY_EXECUTION: '原私人交办', TASK: '正式事项', DRAFT: '草稿' }
const actionLabels = { OPEN_CASE: '查看事项', OPEN_EXECUTION: '查看原交办', OPEN_TASK: '打开原悬赏', EDIT_DRAFT: '继续草稿' }
const statusText = code => ({
  EDITING: '尚未交办', SUBMITTED: '已交办', QUEUED: '等待执行', OUTPUT_COMMITTED: '成果已归档',
  FAILED: '执行未完成', INPUTS_REVOKED: '资料授权已撤销', open: '待领令', assigned: '已领令',
  running: '办理中', completed: '已完成', failed: '未完成', archived: '已归档'
})[code] || '状态待核对'
const formatTime = value => new Date(value).toLocaleString('zh-CN')
const sourceError = code => ({
  VIEWED_RESULT_NOT_TRACKED: '成果查看记录尚未纳入，已查看的成果仍可能列在这里。',
  TASK_REVIEW_NOT_PROJECTED: '正式成果的待验收情况尚未完整纳入，请到原悬赏核对。',
  ACCESS_UNAVAILABLE: '当前身份无法访问，请重新授权后刷新。'
})[code] || '此来源暂未完整读取，请重试；不能视为空列表。'
const openItem = async item => {
  if (!canOpenHallItem(item)) return
  if (item.ref.sourceType === 'TASK') {
    const task = await model.loadTask(item)
    if (task) emit('open-task', task)
  } else emit('open-item', { ...item.ref })
}
watch([() => props.enabled, () => props.identityScope, () => props.identityEpoch], () => {
  if (props.enabled && props.identityScope) void model.refresh()
  else model.reset()
}, { immediate: true })
</script>

<style scoped>
.hall-overview,.overview-section,.overview-source,.overview-item { display:grid; gap:10px; }
.hall-overview { padding:12px; color:#4a3423; }
.hall-overview header,.overview-source-actions { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.hall-overview h2,.hall-overview h3,.hall-overview h4,.hall-overview p { margin:0; }
.overview-source { padding:12px; border:1px solid #d7c3a2; border-radius:8px; background:#fff8e8; }
.overview-item { padding:10px; background:#fffdf6; border-radius:6px; overflow-wrap:anywhere; }
.hall-overview button { min-height:36px; border:1px solid #b29a79; border-radius:6px; background:#f5e8cd; color:#5a3923; padding:6px 10px; cursor:pointer; }
.hall-overview button:disabled { opacity:.55; cursor:default; }
.overview-empty,.overview-item small { color:#765f40; }
</style>
