<template>
  <section class="hall-overview" :aria-label="messagesOnly ? '消息' : '办事概览'">
    <header v-if="!messagesOnly" class="overview-hero">
      <div><p class="overview-eyebrow">开始，也能接着上次</p><h2>今天，想办成什么事？</h2><p>说清目标，交给合适的好汉。资料、进展与成果，留在同一件事里。</p>
        <div class="overview-hero-actions"><button class="primary" type="button" @click="emit('start-draft')">提出需求</button><button type="button" @click="emit('start-chat')">先聊一聊</button></div>
      </div>
      <button class="overview-map-link" type="button" @click="emit('set-home-mode', 'map')"><span aria-hidden="true">聚义厅</span>回到厅中实景 →</button>
    </header>
    <p v-else class="overview-intro">只列出需要你处理的事项。打开不代表已读、验收或归档。</p>
    <div class="overview-list-heading"><h3>{{ messagesOnly ? '需要我处理' : archiveView ? '案卷' : selectedView === 'needsAction' ? '需要我处理' : '接着上次办' }}</h3><div><button v-if="!messagesOnly" type="button" @click="emit('open-board')">悬赏榜</button><button type="button" :disabled="!enabled || model.state.value === 'loading'" @click="refresh">刷新</button></div></div>
    <nav v-if="!messagesOnly" class="overview-tabs" aria-label="事项范围">
      <button type="button" :aria-pressed="!archiveView && selectedView === 'recent'" @click="openView('recent')">最近事项</button>
      <button type="button" :aria-pressed="!archiveView && selectedView === 'needsAction'" @click="openView('needsAction')">需要我处理</button>
      <button type="button" :aria-pressed="archiveView" @click="showArchive">案卷</button>
    </nav>
    <p v-if="!enabled" role="status">身份确认后读取你的事项。</p><p v-if="model.openError.value" role="alert">{{ model.openError.value }}</p>
    <section v-for="view in views" :key="view" class="overview-section" :aria-label="viewLabels[view]">
      <p v-if="model.state.value === 'loading'" role="status">正在读取事项…</p>
      <div v-for="source in issuesFor(view)" :key="source" class="overview-source-error" role="alert"><span>{{ sourceLabels[source] }}：{{ model.sections.value[view].partitions[source].readError || sourceError(model.sections.value[view].partitions[source].errorCode) }}</span><button type="button" :disabled="model.sections.value[view].partitions[source].loading" @click="model.loadPartition(view, source)">重试此来源</button></div>
      <article v-for="item in rowsFor(view)" :key="`${item.ref.sourceType}:${item.ref.sourceId}`" class="overview-item">
        <div class="overview-item-copy"><div class="overview-item-title"><strong>{{ item.title || '未命名事项' }}</strong><span class="overview-status">{{ item.review ? '交付待验收' : statusText(item.status.code) }}</span></div>
          <p>{{ typeLabels[item.ref.sourceType] }} · {{ agentLabel(item) }}<span v-if="item.personalMark?.archived"> · 已收入案卷</span></p>
          <details class="overview-technical"><summary>事项信息</summary><small>状态核对于 {{ formatTime(item.status.observedAt) }}</small><small v-if="item.targetAgent">好汉标识：{{ item.targetAgent.agentId }}</small></details>
        </div>
        <button v-if="canOpenHallItem(item)" type="button" :disabled="Boolean(model.openingRef.value)" @click="openItem(item)">{{ nextLabel(item) }}</button><span v-else>当前无可用办理入口</span>
      </article>
      <p v-if="enabled && isComplete(view) && !rowsFor(view).length" class="overview-empty">{{ hasMore(view) ? '这一页没有事项，可继续读取。' : view === 'archive' ? '暂时没有收入案卷的事项。' : view === 'needsAction' ? '暂时没有需要你处理的事项。' : '还没有开始的事项，先提出一个需求吧。' }}</p>
      <button v-if="hasMore(view)" type="button" @click="loadMore(view)">读取更多事项</button>
    </section>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { canOpenHallItem, HALL_SOURCES, useHallOverview } from '@/composables/juyiting/useHallOverview'

const props = defineProps({
  identityScope: { type: String, default: '' },
  identityEpoch: { type: [Number, String], default: 0 },
  enabled: { type: Boolean, default: false },
  messagesOnly: { type: Boolean, default: false },
  refreshKey: { type: Number, default: 0 },
  agents: { type: Array, default: () => [] }
})
const emit = defineEmits(['open-item', 'open-task', 'start-draft', 'start-chat', 'open-board', 'set-home-mode'])
const model = useHallOverview({ identityScope: () => props.identityScope, identityEpoch: () => props.identityEpoch })
const archiveView = ref(false)
const selectedView = ref('recent')
const views = computed(() => props.messagesOnly ? ['needsAction'] : archiveView.value ? ['archive'] : [selectedView.value])
const sourcesFor = view => view === 'archive' ? ['private', 'task'] : HALL_SOURCES
const viewLabels = { recent: '最近事项', needsAction: '需要处理', archive: '案卷' }
const sourceLabels = { private: '私人交办', task: '正式悬赏', draft: '未交办草稿' }
const typeLabels = { PRIVATE_CASE: '私人事项', LEGACY_EXECUTION: '原私人交办', TASK: '正式事项', DRAFT: '草稿' }
const actionLabels = { OPEN_CASE: '查看事项', OPEN_EXECUTION: '查看原交办', OPEN_TASK: '打开原悬赏', EDIT_DRAFT: '继续草稿' }
const statusText = code => ({
  EDITING: '尚未交办', SUBMITTED: '已交办', QUEUED: '等待执行', OUTPUT_COMMITTED: '成果可查看',
  FAILED: '执行未完成', INPUTS_REVOKED: '资料授权已撤销', open: '待领令', assigned: '已领令',
  running: '办理中', completed: '已完成', failed: '未完成', archived: '已归档'
})[code] || '状态待核对'
const rowsFor = view => sourcesFor(view).flatMap(source => model.sections.value[view].partitions[source].items).sort((a, b) => b.updatedAt - a.updatedAt)
const hasMore = view => sourcesFor(view).some(source => model.sections.value[view].partitions[source].nextCursor)
const isComplete = view => sourcesFor(view).every(source => model.sections.value[view].partitions[source].status === 'complete')
const issuesFor = view => sourcesFor(view).filter(source => {
  const part = model.sections.value[view].partitions[source]
  return part.readError || part.errorCode || part.status === 'error' || part.status === 'partial'
})
const openView = view => { archiveView.value = false; selectedView.value = view }
const loadMore = view => Promise.all(sourcesFor(view).filter(source => model.sections.value[view].partitions[source].nextCursor).map(source => model.loadPartition(view, source, { append: true })))
const agentLabel = item => {
  const agent = props.agents.find(agent => agent.agentId === item.targetAgent?.agentId)
  return agent?.name || agent?.displayName || agent?.personaName || (item.targetAgent ? '已指定好汉' : '待安排')
}
const nextLabel = item => item.review ? '查看待验收交付' : item.ref.sourceType === 'DRAFT' ? '继续填写' : item.status.code === 'OUTPUT_COMMITTED' ? '查看成果' : ['FAILED','UNKNOWN','failed'].includes(item.status.code) ? '处理异常' : '查看进展'
const formatTime = value => new Date(value).toLocaleString('zh-CN')
const sourceError = code => ({
  VIEWED_RESULT_NOT_TRACKED: '成果查看记录尚未纳入，已查看的成果仍可能列在这里。',
  TASK_REVIEW_NOT_PROJECTED: '正式成果的待验收情况尚未完整纳入，请到原悬赏核对。',
  HALL_DRAFT_ARCHIVE_UNAVAILABLE: '草稿不支持案卷筛选，请回最近事项继续填写。',
  FORMAL_REVIEW_UNAVAILABLE: '当前暂不能读取正式待验收情况，请进入正式事项核对。',
  ACCESS_UNAVAILABLE: '当前身份无法访问，请重新授权后刷新。'
})[code] || '此来源暂未完整读取，请重试；不能视为空列表。'
const openItem = async item => {
  if (!canOpenHallItem(item)) return
  if (item.ref.sourceType === 'TASK') {
    const task = await model.loadTask(item)
    if (task) emit('open-task', task, item.review || null)
  } else emit('open-item', { ...item.ref })
}
const refreshArchive = () => Promise.all(['private', 'task'].map(source => model.loadPartition('archive', source)))
const showArchive = () => {
  archiveView.value = true
  if (model.state.value !== 'loading') void refreshArchive()
}
const refresh = async () => {
  if (!props.enabled || !props.identityScope) { model.reset(); return }
  await model.refresh()
  if (archiveView.value && !props.messagesOnly) await refreshArchive()
}
watch([() => props.enabled, () => props.identityScope, () => props.identityEpoch, () => props.refreshKey], refresh, { immediate: true })
</script>

<style scoped>
.hall-overview { padding:32px clamp(16px,6vw,86px); background:#fff9ec; color:#3c2b1d; font-size:16px; box-sizing:border-box; }
.hall-overview h2,.hall-overview h3,.hall-overview p { margin:0; }
.overview-hero { display:flex; gap:24px; align-items:center; justify-content:space-between; padding-bottom:28px; border-bottom:1px solid #d9c5a4; }
.overview-eyebrow { color:#94472f; font-size:14px; margin-bottom:8px !important; }
.overview-hero h2 { font-size:28px; font-weight:500; line-height:1.4; margin-bottom:12px; }
.overview-hero p:not(.overview-eyebrow) { font-size:14px; color:#7b634b; line-height:1.7; }
.overview-hero-actions { display:flex; gap:12px; margin-top:20px; }
.hall-overview button { font:inherit; padding:9px 14px; min-height:44px; color:#583e28; background:transparent; border:1px solid #d4bc97; border-radius:4px; cursor:pointer; }
.hall-overview button:focus-visible { outline:3px solid #bb793f; outline-offset:2px; }
.hall-overview button.primary { background:#8d402c; color:#fff9ee; border-color:#8d402c; }
.hall-overview button:disabled { opacity:.55; cursor:default; }
.overview-map-link { flex:0 0 220px; height:132px; background:linear-gradient(140deg,#493423,#20160f) !important; color:#ecd7aa !important; }
.overview-map-link span { display:block; font-size:28px; letter-spacing:8px; margin-bottom:18px; }
.overview-list-heading { display:flex; justify-content:space-between; align-items:center; margin:24px 0 8px; gap:12px; }
.overview-list-heading h3 { font-size:21px; font-weight:500; }
.overview-list-heading>div { display:flex; gap:8px; }
.overview-list-heading button { border:0; font-size:14px; }
.overview-tabs { display:flex; gap:8px; border-bottom:1px solid #d9c5a4; }
.overview-tabs button { border:0; border-radius:0; }
.overview-tabs button[aria-pressed=true] { color:#8d402c; border-bottom:2px solid #8d402c; }
.overview-item { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:20px 0; border-bottom:1px solid #d9c5a4; }
.overview-item-copy { min-width:0; }
.overview-item-title { display:flex; align-items:center; gap:8px; flex-wrap:wrap; overflow-wrap:anywhere; }
.overview-status { font-size:13px; padding:3px 6px; background:#efe2c5; border-radius:3px; }
.overview-item p { font-size:14px; color:#7b634b; margin-top:8px; }
.overview-item>button { flex:0 0 auto; }
.overview-technical { font-size:12px; color:#87725c; margin-top:6px; }
.overview-technical summary { cursor:pointer; }
.overview-technical small { display:block; margin-top:5px; overflow-wrap:anywhere; }
.overview-source-error { display:flex; justify-content:space-between; align-items:center; gap:12px; background:#f7eadb; padding:12px; margin:12px 0; font-size:14px; }
.overview-empty { padding:36px 0; color:#80674a; }
@media(max-width:600px) { .hall-overview { padding:20px 16px; }.overview-hero h2 { font-size:24px; }.overview-map-link { display:none; }.overview-item { gap:8px; padding:16px 0; }.overview-item>button { padding:8px; font-size:14px; } }
@media(max-height:500px) { .hall-overview { padding-top:16px; }.overview-hero { padding-bottom:16px; }.overview-map-link { display:none; }.overview-hero h2 { font-size:23px; }.overview-hero-actions { margin-top:12px; } }
</style>
