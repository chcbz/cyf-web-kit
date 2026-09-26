<template>
  <section class="hall-overview" :class="{ 'is-messages': messagesOnly }" :aria-label="messagesOnly ? '消息' : '办事概览'">
    <template v-if="!messagesOnly">
      <header class="overview-hero">
        <p class="overview-eyebrow">聚义厅 · 轻量工作台</p>
        <h2>今天，想办成什么事？</h2>
        <p>不必独自忙碌，让合适的好汉与你一起。</p>
      </header>
      <form class="overview-start-card overview-quick-request" aria-label="一句话提出需求" @submit.prevent="submitQuickRequest">
        <span class="overview-start-mark" aria-hidden="true">事</span>
        <div class="overview-start-copy">
          <h3>说一句你想办成的事</h3>
          <p>资料不是必选。发送只建立事项，不会自动调用 Agent 或产生办理费用。</p>
          <label class="quick-request-field">
            <span class="visually-hidden">一句话需求</span>
            <span class="quick-request-input">
              <textarea v-model="quickRequest" maxlength="200" rows="3" placeholder="例如：整理一份明天活动的执行方案，要能直接发给团队。" :disabled="quickPending"></textarea>
              <small>{{ [...quickRequest].length }}/200</small>
            </span>
          </label>
          <div class="quick-request-actions">
            <button type="button" class="quick-material-open" :disabled="quickPending || !enabled" @click="openQuickMaterialPicker"><var-icon name="paperclip" aria-hidden="true" />资料（可选）<span v-if="selectedMaterials.length">{{ selectedMaterials.length }}</span></button>
            <button class="primary" type="submit" :disabled="quickPending || !quickRequest.trim()"><var-icon name="send" aria-hidden="true" />{{ quickPending ? '正在建立事项…' : '开始办事' }}</button>
          </div>
          <ul v-if="selectedMaterials.length" class="quick-material-summary" aria-label="已选固定版本资料">
            <li v-for="material in selectedMaterials" :key="materialKey(material)">
              <span><strong>{{ material.displayName }}</strong><small>v{{ material.version }} · {{ material.role === 'INPUT' ? '用于办理' : '仅供参考' }}</small></span>
              <button type="button" :disabled="quickPending" :aria-label="`取消选择 ${material.displayName} v${material.version}`" @click="removeSelectedMaterial(material)">取消</button>
            </li>
          </ul>
          <p v-if="quickMessage" :class="{ 'quick-request-error': quickMessage.includes('未关联') || quickMessage.includes('待核对') }" role="status">{{ quickMessage }}</p>
          <Teleport to="body">
            <section v-if="materialPickerOpen" class="quick-material-picker" role="region" aria-labelledby="quick-material-picker-title">
              <header><button type="button" @click="cancelQuickMaterialPicker">返回</button><div><h3 id="quick-material-picker-title">为新事项选择资料</h3><p>每份资料固定到明确版本；返回不会改变已确认选择。</p></div></header>
              <div class="quick-material-picker-body">
                <p v-if="workspace.listState.value === 'loading'" role="status">正在读取你的资料…</p>
                <p v-else-if="workspace.error.value" class="quick-request-error" role="alert">{{ workspace.error.value }}</p>
                <div v-else-if="workspace.items.value.length" class="quick-material-files" aria-label="可选资料">
                  <button v-for="file in workspace.items.value" :key="file.fileId" type="button" :class="{ selected: pickerFileId === file.fileId }" @click="selectQuickMaterialFile(file.fileId)"><strong>{{ file.displayName }}</strong><small>最新 v{{ file.latestVersion }}</small></button>
                </div>
                <p v-else-if="workspace.listState.value === 'empty'">百宝箱暂无资料；可不选资料直接建立事项。</p>
                <button v-if="workspace.nextCursor.value" type="button" :disabled="workspace.loading.value" @click="workspace.loadMore({ state: 'ACTIVE' })">读取更多资料</button>
              </div>
              <footer>
                <div v-if="pickerDetail" class="quick-material-fields">
                  <label><span>固定版本</span><select v-model.number="pickerVersion"><option v-for="version in pickerDetail.versions" :key="version.version" :value="version.version">v{{ version.version }} · {{ version.originalFilename }}</option></select></label>
                  <label><span>资料用途</span><select v-model="pickerRole"><option value="INPUT">用于办理</option><option value="REFERENCE">仅供参考</option></select></label>
                  <button type="button" class="primary" :disabled="!pickerVersion" @click="stageQuickMaterial">加入选择</button>
                </div>
                <ul v-if="draftMaterials.length" class="quick-material-draft" aria-label="待确认资料">
                  <li v-for="material in draftMaterials" :key="materialKey(material)"><span>{{ material.displayName }} · v{{ material.version }} · {{ material.role === 'INPUT' ? '用于办理' : '仅供参考' }}</span><button type="button" @click="removeDraftMaterial(material)">移除</button></li>
                </ul>
                <button type="button" class="quick-material-confirm" @click="confirmQuickMaterials">确认选择（{{ draftMaterials.length }}）</button>
                <button type="button" @click="cancelQuickMaterialPicker">取消，不更改原选择</button>
              </footer>
            </section>
          </Teleport>
        </div>
      </form>
    </template>
    <p v-else class="overview-intro">只列出需要你处理的事项。打开不代表已读、验收或归档。</p>
    <div class="overview-columns"><div class="overview-main">
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
    <section v-if="!messagesOnly" class="overview-resource" aria-label="资料入口"><var-icon class="overview-resource-icon" name="file-document-outline" aria-hidden="true" /><div><strong>资料留在这里，下次不用重找</strong><p>引用已有资料，查看固定版本的成果。</p></div><button type="button" @click="emit('open-workspace')">打开百宝箱 →</button></section>
    </div><aside v-if="!messagesOnly" class="overview-aside" aria-label="快捷入口">
      <button class="overview-map-link" type="button" @click="emit('set-home-mode', 'map')"><span aria-hidden="true">聚义厅</span>厅中实景 · 去梁山走一走 →</button>
      <section class="overview-aside-card"><h3>需要你看一眼</h3><p v-if="model.state.value === 'loading'">正在核对待处理事项…</p><p v-else-if="model.sections.value.needsAction.status !== 'complete'">待处理列表可能不完整，请在事项页核对。</p>
        <p v-if="!attentionItems.length">{{ model.sections.value.needsAction.status === 'complete' ? '当前没有需要处理的事项。' : '当前没有已确认的待处理项。' }}</p>
        <button v-for="item in attentionItems" :key="`${item.ref.sourceType}:${item.ref.sourceId}`" type="button" :disabled="!canOpenHallItem(item) || Boolean(model.openingRef.value)" @click="openItem(item)"><span>{{ item.title || '未命名事项' }}<small>{{ item.review ? '交付待验收' : statusText(item.status.code) }}</small></span>→</button>
        <button class="overview-aside-link" type="button" @click="openView('needsAction')">查看待处理列表 →</button>
      </section>
      <section class="overview-aside-card"><h3>找位好汉</h3><p>通过点将册核对实际本领和可用状态。</p><button type="button" @click="emit('open-agents')">打开点将册 →</button></section>
    </aside></div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { canOpenHallItem, HALL_SOURCES, useHallOverview } from '@/composables/juyiting/useHallOverview'
import { usePersonalWorkspace } from '@/composables/usePersonalWorkspace'

const props = defineProps({
  identityScope: { type: String, default: '' },
  identityEpoch: { type: [Number, String], default: 0 },
  enabled: { type: Boolean, default: false },
  messagesOnly: { type: Boolean, default: false },
  refreshKey: { type: Number, default: 0 },
  agents: { type: Array, default: () => [] },
  quickPending: { type: Boolean, default: false },
  quickMessage: { type: String, default: '' }
})
const emit = defineEmits(['open-item', 'open-task', 'quick-request', 'start-draft', 'start-chat', 'open-board', 'open-workspace', 'open-agents', 'set-home-mode'])
const model = useHallOverview({ identityScope: () => props.identityScope, identityEpoch: () => props.identityEpoch })
const materialIdentityKey = computed(() => `${props.identityEpoch}\u0000${props.identityScope}`)
const workspace = usePersonalWorkspace({ identityEpoch: materialIdentityKey })
const quickRequest = ref('')
const materialPickerOpen = ref(false)
const selectedMaterials = ref([])
const draftMaterials = ref([])
const pickerFileId = ref('')
const pickerVersion = ref(null)
const pickerRole = ref('INPUT')
const pickerDetail = computed(() => workspace.detail.value?.file?.fileId === pickerFileId.value && workspace.detail.value.file.state === 'ACTIVE' ? workspace.detail.value : null)
const materialKey = material => `${material.fileId}:${material.version}:${material.role}`
const resetMaterialPicker = () => { pickerFileId.value = ''; pickerVersion.value = null; pickerRole.value = 'INPUT'; workspace.detail.value = null }
const openQuickMaterialPicker = async () => {
  if (!props.enabled || !props.identityScope || props.quickPending) return
  draftMaterials.value = selectedMaterials.value.map(material => ({ ...material }))
  resetMaterialPicker()
  materialPickerOpen.value = true
  await workspace.refresh({ state: 'ACTIVE' })
}
const cancelQuickMaterialPicker = () => { materialPickerOpen.value = false; draftMaterials.value = []; resetMaterialPicker() }
const selectQuickMaterialFile = async fileId => {
  const operationIdentity = materialIdentityKey.value
  const detail = await workspace.select(fileId)
  if (!detail || materialIdentityKey.value !== operationIdentity || !materialPickerOpen.value || detail.file.state !== 'ACTIVE') return
  pickerFileId.value = detail.file.fileId
  pickerVersion.value = detail.latestVersion.version
  const existing = draftMaterials.value.find(material => material.fileId === detail.file.fileId)
  if (existing) { pickerVersion.value = existing.version; pickerRole.value = existing.role }
}
const stageQuickMaterial = () => {
  const detail = pickerDetail.value
  const version = Number(pickerVersion.value)
  if (!detail || !Number.isSafeInteger(version) || !detail.versions.some(item => item.version === version)) return
  const material = { fileId: detail.file.fileId, version, role: pickerRole.value, displayName: detail.file.displayName }
  draftMaterials.value = [...draftMaterials.value.filter(item => item.fileId !== material.fileId), material]
}
const removeDraftMaterial = material => { draftMaterials.value = draftMaterials.value.filter(item => materialKey(item) !== materialKey(material)) }
const confirmQuickMaterials = () => {
  selectedMaterials.value = draftMaterials.value.map(material => ({ ...material }))
  materialPickerOpen.value = false
  draftMaterials.value = []
  resetMaterialPicker()
}
const removeSelectedMaterial = material => { selectedMaterials.value = selectedMaterials.value.filter(item => materialKey(item) !== materialKey(material)) }
const submitQuickRequest = () => {
  const value = quickRequest.value.trim()
  if (value) emit('quick-request', { request: value, materials: selectedMaterials.value.map(material => ({ ...material })) })
}
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
const attentionItems = computed(() => rowsFor('needsAction').slice(0, 2))
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
watch(materialIdentityKey, () => {
  materialPickerOpen.value = false
  selectedMaterials.value = []
  draftMaterials.value = []
  resetMaterialPicker()
}, { flush: 'sync' })
onBeforeUnmount(() => workspace.dispose())
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
.overview-map-link { flex:0 0 220px; height:132px; background:linear-gradient(0deg,rgba(32,22,15,.9),rgba(32,22,15,.15)),url('../../assets/juyiting/liangshan-hall-physical-bg-v1.png') center/cover !important; color:#ecd7aa !important; }
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
@media(max-width:600px) { .hall-overview.is-messages { padding:20px 16px; } }
@media(max-height:500px) { .hall-overview.is-messages { padding-top:16px; } }
/* Genuine hall overview projections in the lightweight workbench. */
.hall-overview:not(.is-messages) {
  width: min(1320px, 100%); margin: 0 auto; min-height: 100%;
  padding: 30px 36px 36px; background: #f5f4f0; color: #242e2b;
  font: 400 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
}
.hall-overview:not(.is-messages) .overview-hero {
  display: block; padding: 0 0 26px; border: 0;
}
.hall-overview:not(.is-messages) .overview-eyebrow { color: #923f30; font-size: 11px; letter-spacing: .08em; margin-bottom: 8px !important; }
.hall-overview:not(.is-messages) .overview-hero h2 { color: #242e2b; font: 500 28px/1.5 "Noto Serif CJK SC", "Songti SC", STSong, serif; letter-spacing: .8px; margin: 0 0 6px; }
.hall-overview:not(.is-messages) .overview-hero p:not(.overview-eyebrow) { color: #68716b; font-size: 14px; }
.hall-overview:not(.is-messages) .overview-hero { padding: 0; margin-bottom: 26px; }
.hall-overview:not(.is-messages) .overview-start-card { display: flex; align-items: center; gap: 24px; min-width: 0; padding: 27px 28px; border: 1px solid #e3e5dc; border-radius: 12px; background: #fffefa; margin-bottom: 26px; }
.hall-overview:not(.is-messages) .overview-start-mark { flex: 0 0 64px; display: grid; place-items: center; width: 64px; height: 72px; border: 1px solid #e9ded2; border-radius: 50% 50% 8px 8px; background: #faf4ef; color: #923f30; font: 500 34px/1 "Noto Serif CJK SC", "Songti SC", STSong, serif; }
.hall-overview:not(.is-messages) .overview-start-copy { flex: 1 1 auto; min-width: 0; }
.hall-overview:not(.is-messages) .overview-start-copy h3 { font-size: 17px; font-weight: 600; }
.hall-overview:not(.is-messages) .overview-start-copy p { margin-top: 4px; font-size: 13px; color: #68716b; }
.hall-overview:not(.is-messages) .overview-start-steps { display: flex; flex: none; align-items: center; gap: 22px; margin: 0; padding: 0; list-style: none; }
.hall-overview:not(.is-messages) .overview-start-steps li { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 70px; color: #68716b; font-size: 12px; }
.hall-overview:not(.is-messages) .overview-start-steps strong { color: #89918c; font: 400 22px/1.3 "Noto Serif CJK SC", "Songti SC", STSong, serif; }
.hall-overview:not(.is-messages) .overview-hero-actions { margin-top: 16px; gap: 10px; }
.hall-overview:not(.is-messages) .overview-hero-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
.hall-overview:not(.is-messages) .overview-hero-actions .var-icon { font-size: 16px; }
.hall-overview:not(.is-messages) button { min-height: 42px; border-radius: 7px; border-color: #e3e5dc; color: #242e2b; font-size: 14px; font-weight: 500; }
.hall-overview:not(.is-messages) button:hover:not(:disabled) { background: #f0f1ea; border-color: #c4cabe; }
.hall-overview:not(.is-messages) button.primary { background: #923f30; border-color: #923f30; color: #fffefa; }
.hall-overview:not(.is-messages) button.primary:hover { background: #793326; }
.hall-overview:not(.is-messages) button:focus-visible { outline: 3px solid #923f3080; outline-offset: 3px; }
.hall-overview .overview-columns { display: grid; grid-template-columns: minmax(0,1fr) 300px; gap: 24px; align-items: start; }
.hall-overview.is-messages .overview-columns { grid-template-columns: minmax(0,1fr); }
.hall-overview .overview-main, .hall-overview .overview-aside { min-width: 0; }
.hall-overview .overview-main { background: #fffefa; border: 1px solid #e3e5dc; border-radius: 11px; padding: 22px 24px 0; }
.hall-overview .overview-aside { display: grid; gap: 18px; }
.hall-overview .overview-list-heading { margin: 0 0 8px; }
.hall-overview .overview-list-heading h3, .hall-overview .overview-aside h3 { font-size: 16px; font-weight: 500; }
.hall-overview .overview-list-heading button { font-size: 12px; min-height: 34px; }
.hall-overview .overview-tabs { gap: 10px; border-color: #e3e5dc; overflow-x: auto; }
.hall-overview .overview-tabs button { flex: none; font-size: 13px; padding: 12px 8px; white-space: nowrap; }
.hall-overview .overview-tabs button[aria-pressed=true] { color: #923f30; border-bottom-color: #923f30; }
.hall-overview .overview-item { padding: 17px 0; border-color: #e3e5dc; }
.hall-overview .overview-item-title strong { font-size: 15px; font-weight: 500; line-height: 1.55; }
.hall-overview .overview-item p { font-size: 12px; color: #68716b; margin-top: 7px; }
.hall-overview .overview-status { font-size: 11px; background: #f9efde; color: #87551c; padding: 3px 7px; border-radius: 4px; }
.hall-overview .overview-technical { font-size: 11px; color: #68716b; }
.hall-overview .overview-item > button { font-size: 12px; color: #68716b; }
.hall-overview .overview-map-link {
  display: flex; flex-direction: column; align-items: flex-start; justify-content: end;
  width: 100%; height: 176px; padding: 20px 18px; text-align: left;
  background: linear-gradient(0deg,#211b13e8,transparent 100%),url('../../assets/juyiting/liangshan-hall-physical-bg-v1.png') center 53%/cover !important;
  color: #fff9e9 !important; border: 1px solid #cac7b5 !important; border-radius: 11px !important;
  font: 500 15px/1.5 "Noto Serif CJK SC", "Songti SC", STSong, serif !important;
}
.hall-overview .overview-map-link span { margin-bottom: 5px; font-size: 20px; letter-spacing: 3px; }
.hall-overview .overview-aside-card, .hall-overview .overview-resource { padding: 20px; border: 1px solid #e3e5dc; border-radius: 11px; background: #fffefa; }
.hall-overview .overview-aside-card h3 { margin: 0 0 8px; }
.hall-overview .overview-aside-card p, .hall-overview .overview-resource p { color: #68716b; font-size: 12px; line-height: 1.65; margin: 0 0 8px; }
.hall-overview .overview-aside-card button { display: flex; justify-content: space-between; width: 100%; min-height: 36px; padding: 7px 0; border: 0; background: transparent; text-align: left; font-size: 13px; }
.hall-overview .overview-aside-card button + button { border-top: 1px solid #e3e5dc; border-radius: 0; }
.hall-overview .overview-aside-card button span { min-width: 0; overflow-wrap: anywhere; }
.hall-overview .overview-aside-card button small { display: block; margin-top: 4px; color: #68716b; font-weight: 400; font-size: 11px; }
.hall-overview .overview-aside-card .overview-aside-link { color: #923f30; }
.hall-overview .overview-resource { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 18px; }
.hall-overview .overview-resource-icon { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 9px; background: #eaf2ed; color: #21604d; font-size: 22px; }
.hall-overview .overview-resource strong { display: block; font-size: 14px; font-weight: 500; }
.hall-overview .overview-resource p { margin: 3px 0 0; }
.hall-overview .overview-resource button { flex: none; font-size: 12px; }
.hall-overview .overview-source-error { background: #faeae6; color: #a13f35; }
.hall-overview .overview-empty { color: #68716b; }
@media (max-width: 1200px) {
  .hall-overview:not(.is-messages) { padding: 26px; }
  .hall-overview .overview-columns { grid-template-columns: minmax(0,1fr) 264px; gap: 18px; }
}
@media (max-width: 1000px) {
  .hall-overview .overview-start-steps { display: none !important; }
  .hall-overview .overview-columns { grid-template-columns: minmax(0,1fr); }
  .hall-overview .overview-aside { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .hall-overview .overview-map-link { grid-column: 1/-1; height: 165px; }
}
@media (max-width: 600px) {
  .hall-overview:not(.is-messages) { padding: 22px 16px; }
  .hall-overview:not(.is-messages) .overview-hero { margin-bottom: 20px; }
  .hall-overview:not(.is-messages) .overview-start-card { align-items: flex-start; gap: 12px; padding: 20px 18px; margin-bottom: 20px; }
  .hall-overview:not(.is-messages) .overview-start-mark { flex-basis: 36px; width: 36px; height: 44px; font-size: 24px; }
  .hall-overview:not(.is-messages) .overview-start-copy h3 { font-size: 16px; }
  .hall-overview:not(.is-messages) .overview-start-copy p { font-size: 12px; }
  .hall-overview:not(.is-messages) .overview-hero-actions { flex-wrap: wrap; gap: 8px; }
  .hall-overview:not(.is-messages) .overview-hero h2 { font-size: 25px; letter-spacing: 0; }
  .hall-overview .overview-hero-actions button { font-size: 12px; padding: 9px 10px; }
  .hall-overview .overview-main { padding: 18px 16px 0; }
  .hall-overview .overview-aside { grid-template-columns: minmax(0,1fr); }
  .hall-overview .overview-map-link { height: 185px; }
  .hall-overview .overview-item { flex-wrap: wrap; row-gap: 3px; }
  .hall-overview .overview-item-copy { flex: 1 1 100%; }
  .hall-overview .overview-item > button { margin-left: auto; }
  .hall-overview .overview-aside-card { padding: 18px; }
  .hall-overview .overview-resource { flex-wrap: wrap; padding: 18px 16px; }
  .hall-overview .overview-resource button { margin-left: auto; }
}
</style>

<style scoped>
.overview-quick-request{align-items:flex-start!important}.overview-quick-request .overview-start-copy{width:100%}.quick-request-field{display:block;margin-top:14px}.quick-request-input{position:relative;display:block}.quick-request-field textarea{display:block;width:100%;min-height:92px;box-sizing:border-box;padding:13px 14px 34px;border:1px solid #ccd2c5;border-radius:10px;background:#fff;color:#242e2b;font:400 16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;resize:none}.quick-request-field textarea:focus{outline:3px solid #923f3033;border-color:#923f30}.quick-request-field small{position:absolute;right:12px;bottom:9px;padding-left:4px;border-radius:3px;background:var(--hall-surface,#fff);color:#7a827d;font-size:12px;line-height:1;pointer-events:none}.quick-request-actions{display:flex;justify-content:space-between;gap:10px;margin-top:14px}.quick-request-actions button{display:inline-flex;align-items:center;justify-content:center;gap:6px}.quick-request-actions .primary{margin-left:auto}.quick-request-error{color:#a13f35!important}.overview-tabs button,.overview-tabs button:hover,.overview-tabs button[aria-pressed=true]{background:transparent!important;box-shadow:none!important}.overview-tabs button[aria-pressed=true]{color:var(--hall-brand,#923f30)!important;border-bottom-color:var(--hall-brand,#923f30)!important}@media(max-width:600px){.overview-quick-request{display:block!important}.overview-quick-request .overview-start-mark{display:none!important}.quick-request-actions button{flex:1 1 0;padding-inline:8px}}
</style>

<style scoped>
.quick-material-open>span{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#923f30;color:#fff;font-size:11px}.quick-material-summary,.quick-material-draft{display:grid;gap:7px;margin:12px 0 0;padding:0;list-style:none}.quick-material-summary li,.quick-material-draft li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border:1px solid #e3e5dc;border-radius:8px;background:#f8f6f0}.quick-material-summary li>span{display:grid;min-width:0}.quick-material-summary strong,.quick-material-summary small{overflow-wrap:anywhere}.quick-material-summary small{color:#68716b;font-size:11px}.quick-material-summary button,.quick-material-draft button{min-height:34px!important;padding:5px 9px!important;flex:none}.quick-material-picker{position:fixed;inset:0;z-index:1400;display:grid;grid-template-rows:auto minmax(0,1fr) auto;width:100%;height:100%;height:100dvh;box-sizing:border-box;background:#f5f4f0;color:#242e2b;font:400 14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}.quick-material-picker header{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #e3e5dc;background:#fffefa}.quick-material-picker h3,.quick-material-picker p{margin:0}.quick-material-picker header p{color:#68716b;font-size:12px}.quick-material-picker button,.quick-material-picker select{min-height:42px;border:1px solid #cfc8ba;border-radius:8px;background:#fff;color:#242e2b;font:inherit}.quick-material-picker button{padding:8px 12px;cursor:pointer}.quick-material-picker button.primary,.quick-material-confirm{background:#923f30!important;border-color:#923f30!important;color:#fff!important}.quick-material-picker-body{min-height:0;overflow-y:auto;padding:14px 16px}.quick-material-files{display:grid;gap:8px}.quick-material-files button{display:grid;gap:3px;text-align:left}.quick-material-files button.selected{border-color:#923f30;background:#f6eee8}.quick-material-files small{color:#68716b}.quick-material-picker footer{display:grid;gap:9px;padding:12px 16px max(12px,env(safe-area-inset-bottom));border-top:1px solid #e3e5dc;background:#fffefa;box-shadow:0 -8px 24px #242e2b14}.quick-material-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:end}.quick-material-fields label{display:grid;gap:4px}.quick-material-fields select{min-width:0;padding:0 8px}@media(max-width:600px){.quick-material-fields{grid-template-columns:1fr}.quick-material-picker header{padding-top:max(12px,env(safe-area-inset-top))}.quick-material-picker footer{max-height:48dvh;overflow-y:auto}}
</style>
