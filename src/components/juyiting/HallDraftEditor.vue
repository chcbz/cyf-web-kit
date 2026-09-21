<template>
  <section class="hall-draft-editor" aria-labelledby="hall-draft-editor-title">
    <header>
      <div>
        <h3 id="hall-draft-editor-title">起草交办</h3>
        <p>先保存草稿、固定资料版本和受托好汉；私人交办须明确确认授权。正式张榜和正式返工仍使用原入口。</p>
      </div>
      <div class="draft-header-actions">
        <button type="button" :disabled="busy" @click="loadRecoverable">恢复草稿</button>
        <button
          v-if="drafts.submissionRecovery.value"
          type="button"
          :disabled="busy"
          @click="reconcile"
        >核对原交办</button>
        <button type="button" @click="$emit('close')">收起</button>
      </div>
    </header>

    <div v-if="drafts.summaries.value.length" class="draft-recovery" aria-label="可恢复草稿">
      <p>只显示服务端可恢复摘要；打开后才读取正文和固定资料。</p>
      <button
        v-for="item in drafts.summaries.value"
        :key="item.draftId"
        type="button"
        :disabled="busy"
        @click="openDraft(item.draftId)"
      >
        <strong>{{ item.title || '未命名草稿' }}</strong><small>{{ item.draftId }} · 已存 r{{ item.revision }}</small>
      </button>
      <button
        v-if="drafts.nextCursor.value"
        type="button"
        :disabled="busy"
        @click="drafts.loadMore"
      >读取更多</button>
    </div>

    <form @submit.prevent="persist">
      <label><span>交办名目</span><input v-model="form.title" maxlength="16000" placeholder="说明要办的事" /></label>
      <label><span>具体交代</span><textarea v-model="form.instruction" maxlength="16000" placeholder="写明目标、限制和期望成果"></textarea></label>
      <label><span>受托好汉</span>
        <select v-model="form.targetAgentId"><option value="">暂不指定</option><option v-for="agent in agents" :key="agent.agentId" :value="agent.agentId">{{ agentName(agent) }}</option></select>
      </label>
      <label><span>期望格式</span><input v-model="form.outputMime" maxlength="16000" placeholder="例如 text/plain；可稍后补充" /></label>

      <section class="draft-materials" aria-labelledby="hall-draft-materials-title">
        <div><h4 id="hall-draft-materials-title">固定资料版本</h4><p>仅从当前身份的工作空间选取；不会使用样例资料或把“最新版”替代固定版本。</p></div>
        <button type="button" :disabled="workspace.loading.value" @click="workspace.refresh({ state: 'ACTIVE' })">刷新资料</button>
        <p v-if="workspace.error.value" class="draft-error" role="alert">{{ workspace.error.value }}</p>
        <div v-if="workspace.items.value.length" class="draft-file-list">
          <button
            v-for="file in workspace.items.value"
            :key="file.fileId"
            type="button"
            :class="{ selected: selectedFileId === file.fileId }"
            @click="selectFile(file.fileId)"
          >
            <strong>{{ file.displayName }}</strong><small>{{ file.fileId }} · 最新 v{{ file.latestVersion }}</small>
          </button>
        </div>
        <p v-else-if="workspace.listState.value === 'empty'">工作空间没有可选资料；不会用演示数据代替。</p>
        <template v-if="workspace.detail.value?.file?.state === 'ACTIVE'">
          <label><span>版本</span><select v-model.number="selectedVersion"><option v-for="version in workspace.detail.value.versions" :key="version.version" :value="version.version">v{{ version.version }} · {{ version.originalFilename }}</option></select></label>
          <div class="draft-material-actions"><button type="button" :disabled="!canAddInput" @click="addInput">加入本稿</button><button type="button" :disabled="!canAddInput" @click="preview">预览此固定版本</button></div>
        </template>
        <div v-if="form.inputs.length" class="draft-input-list"><span v-for="input in form.inputs" :key="`${input.fileId}:${input.version}`">{{ input.fileId }} · v{{ input.version }} <button type="button" @click="removeInput(input)">移除</button></span></div>
        <p v-if="workspace.preview.value?.kind === 'text'" class="draft-preview">{{ workspace.preview.value.text }}</p>
        <img
          v-else-if="workspace.preview.value?.kind === 'image'"
          class="draft-preview-image"
          :src="workspace.preview.value.url"
          alt="所选固定版本预览"
        />
        <p v-else-if="workspace.preview.value?.message" class="draft-preview">{{ workspace.preview.value.message }}</p>
      </section>

      <p v-if="drafts.error.value" class="draft-error" role="alert">{{ drafts.error.value }}</p>
      <p v-if="drafts.reloadRequired.value" class="draft-error" role="alert">服务端版本已变化；本地输入未覆盖。请先恢复草稿再决定是否重填。</p>
      <p v-else-if="drafts.draft.value?.state === 'EDITING'" class="draft-saved" role="status">草稿 {{ drafts.draft.value.draftId }} 已保存为 r{{ drafts.draft.value.revision }}；尚未交办。</p>
      <section v-if="drafts.draft.value?.state === 'EDITING'" class="draft-confirmation" aria-label="交办确认">
        <label><input v-model="authorizationAcknowledgement" :disabled="!isCurrentDraftSaved" type="checkbox" /> 我已确认本次私人交办会按固定资料版本创建新的执行。</label>
        <p v-if="!isCurrentDraftSaved">草稿内容已修改；请先保存本次修改，确认授权会随修改撤回。</p>
        <p v-else>确认后显示“已受理”；这不表示已完成或已有成果。</p>
        <button type="button" :disabled="busy || !isCurrentDraftSaved || !authorizationAcknowledgement || Boolean(drafts.unresolvedIntent.value)" @click="submit">确认授权并交办</button>
      </section>
      <section v-if="drafts.receipt.value" class="hall-case-detail" aria-label="事项进展">
        <header><div><h4>事项进展</h4><p>来源：{{ drafts.receipt.value.ref.sourceType }} · {{ drafts.receipt.value.ref.sourceId }}</p></div><button
          v-if="drafts.receipt.value.ref.sourceType === 'PRIVATE_CASE'"
          type="button"
          :disabled="busy"
          @click="refreshCase"
        >核对进展</button></header>
        <p v-if="drafts.receipt.value.ref.sourceType === 'TASK'">该正式事项已由原正式服务受理；进展、成果和返工继续使用原正式入口。</p>
        <template v-else>
          <p v-if="drafts.receipt.value.execution">{{ executionSummary(drafts.receipt.value.execution) }} 执行编号 {{ drafts.receipt.value.execution.executionId }} · {{ executionText(drafts.receipt.value.execution.state) }}</p>
          <p v-else>私人交办回执未包含执行信息；请核对原交办。</p>
        </template>
        <div v-if="drafts.receipt.value.ref.sourceType === 'PRIVATE_CASE' && drafts.caseView.value?.executions?.length" class="case-executions">
          <p v-for="item in drafts.caseView.value.executions" :key="`${item.revisionNo}:${item.execution.executionId}`">
            第 {{ item.revisionNo }} 次执行 · {{ item.execution.executionId }} · {{ executionText(item.execution.state) }}
            <button
              v-if="item.execution.state === 'OUTPUT_COMMITTED'"
              type="button"
              :disabled="busy"
              @click="openResults(item.execution)"
            >查看成果</button>
          </p>
        </div>
        <section v-if="drafts.executionResults.value" class="hall-results" aria-label="成果">
          <p v-if="drafts.executionResults.value.items.length">成果来自执行 {{ drafts.executionResults.value.executionId }}；仅可使用固定版本。</p>
          <p v-else>该执行尚无可用成果。</p>
          <article v-for="item in drafts.executionResults.value.items" :key="item.outputId" class="hall-result-item">
            <strong>{{ item.filename }}</strong><small>v{{ item.fileVersion }} · {{ item.mime }} · {{ item.availability === 'AVAILABLE' ? '可用' : '当前不可用' }}</small>
            <div v-if="item.availability === 'AVAILABLE'" class="hall-result-actions">
              <button type="button" :disabled="busy" @click="previewResult(item)">预览</button>
              <button type="button" :disabled="busy" @click="downloadResult(item)">下载</button>
              <button
                v-if="canCreateRevision"
                type="button"
                :disabled="busy"
                @click="startRevision(item)"
              >提出修改</button>
            </div>
          </article>
          <p v-if="drafts.resultsError.value" class="draft-error" role="alert">{{ drafts.resultsError.value }}</p>
        </section>
        <p v-else-if="drafts.resultsState.value === 'loading'" class="case-results-note">正在读取成果。</p>
        <p v-else-if="drafts.resultsError.value" class="draft-error" role="alert">{{ drafts.resultsError.value }}</p>
        <p class="case-results-note">新修改须新建草稿和新执行，旧执行不会重跑。</p>
      </section>
      <footer><button v-if="revisionSource || !drafts.draft.value || drafts.draft.value?.state === 'EDITING'" type="submit" :disabled="busy">{{ revisionSource ? '保存修改草稿' : drafts.draft.value ? '保存修改' : '确认保存草稿' }}</button><button
        v-if="drafts.draft.value?.state === 'EDITING'"
        type="button"
        :disabled="busy"
        @click="discard"
      >放弃草稿</button></footer>
    </form>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { savePersonalWorkspaceBlob, usePersonalWorkspace } from '@/composables/usePersonalWorkspace'
import { useHallDrafts } from '@/composables/juyiting/useHallDrafts'

const props = defineProps({
  agents: { type: Array, default: () => [] },
  selectedAgent: { type: Object, default: null },
  identityEpoch: { type: [Number, String], default: 0 },
  identityScope: { type: String, default: '' }
})
defineEmits(['close'])
const drafts = useHallDrafts({
  identityEpoch: () => props.identityEpoch,
  identityScope: () => props.identityScope
})
const workspace = usePersonalWorkspace({ identityEpoch: () => props.identityEpoch })
const form = reactive({ title: '', instruction: '', targetAgentId: '', outputMime: '', inputs: [] })
const revisionSource = ref(null)
const selectedFileId = ref(''); const selectedVersion = ref(null)
const busy = computed(() => ['creating', 'saving', 'loading', 'discarding'].includes(drafts.state.value) || ['submitting', 'reconciling'].includes(drafts.submissionState.value))
const authorizationAcknowledgement = ref(false)
const savedFormSnapshot = ref('')
const formSnapshot = () => JSON.stringify({
  title: form.title,
  instruction: form.instruction,
  targetAgentId: form.targetAgentId,
  outputMime: form.outputMime,
  inputs: form.inputs.map(input => ({ fileId: input.fileId, version: input.version }))
})
const isCurrentDraftSaved = computed(() => drafts.draft.value?.state === 'EDITING' && savedFormSnapshot.value === formSnapshot())
const canCreateRevision = computed(() => drafts.executionResults.value?.allowedActions?.includes('CREATE_REVISION') === true)
const canAddInput = computed(() => workspace.detail.value?.file?.state === 'ACTIVE' && Number.isSafeInteger(selectedVersion.value) && selectedVersion.value > 0)
const agentName = agent => agent?.name || agent?.personaName || agent?.agentId || '未知好汉'
const fill = fields => {
  form.title = fields?.title || ''
  form.instruction = fields?.instruction || ''
  form.targetAgentId = fields?.targetAgentId || ''
  form.outputMime = fields?.outputMime || ''
  form.inputs = Array.isArray(fields?.inputs) ? fields.inputs.map(input => ({ fileId: input.fileId, version: input.version })) : []
  savedFormSnapshot.value = fields ? formSnapshot() : ''
  authorizationAcknowledgement.value = false
}
const selectFile = async fileId => { const detail = await workspace.select(fileId); if (detail?.file?.state === 'ACTIVE') { selectedFileId.value = detail.file.fileId; selectedVersion.value = detail.latestVersion.version } }
const addInput = () => { if (!canAddInput.value) return; const input = { fileId: workspace.detail.value.file.fileId, version: selectedVersion.value }; if (!form.inputs.some(item => item.fileId === input.fileId && item.version === input.version)) form.inputs.push(input) }
const removeInput = input => { form.inputs = form.inputs.filter(item => item.fileId !== input.fileId || item.version !== input.version) }
const preview = () => { if (canAddInput.value) void workspace.previewVersion(selectedVersion.value) }
const persist = async () => {
  const payload = { ...form, inputs: form.inputs.map(input => ({ ...input })) }
  const saved = revisionSource.value
    ? await drafts.create({ kind: 'REVISION', caseId: drafts.caseView.value?.caseId || null, sourceOutputRef: revisionSource.value, ...payload })
    : drafts.draft.value ? await drafts.save(payload) : await drafts.create(payload)
  if (saved) { revisionSource.value = null; fill(saved.editableFields) }
}
const loadRecoverable = () => { void drafts.list() }
const openDraft = async id => { const loaded = await drafts.load(id); if (loaded) fill(loaded.editableFields) }
const discard = async () => { if (await drafts.discard()) fill({}) }
const submit = () => { if (isCurrentDraftSaved.value) void drafts.submit({ authorizationAcknowledgement: authorizationAcknowledgement.value }) }
const reconcile = () => { void drafts.reconcileSubmission() }
const refreshCase = () => { const ref = drafts.receipt.value?.ref; if (ref?.sourceType === 'PRIVATE_CASE') void drafts.loadCase(ref.sourceId) }
const openResults = execution => { if (execution?.executionId) void drafts.loadResults(execution.executionId) }
const previewResult = async item => {
  if (item?.availability === 'AVAILABLE' && await workspace.select(item.fileId)) void workspace.previewVersion(item.fileVersion)
}
const downloadResult = async item => {
  if (item?.availability === 'AVAILABLE' && await workspace.select(item.fileId)) {
    const result = await workspace.download(item.fileVersion)
    if (result) savePersonalWorkspaceBlob(result)
  }
}
const startRevision = item => {
  const executionId = drafts.executionResults.value?.executionId
  if (!executionId || !drafts.caseView.value?.caseId || item?.availability !== 'AVAILABLE' || !canCreateRevision.value) return
  revisionSource.value = { executionId, outputId: item.outputId, fileId: item.fileId, fileVersion: item.fileVersion }
  fill({ title: `修改：${item.filename}`, instruction: '', targetAgentId: resultExecution(executionId)?.targetAgentId || '', outputMime: item.mime, inputs: [] })
}
const resultExecution = executionId => drafts.caseView.value?.executions?.find(item => item.execution.executionId === executionId)?.execution || null
const executionText = state => ({ QUEUED: '等待执行', OUTPUT_COMMITTED: '已有已归档输出', INPUTS_REVOKED: '输入授权已撤销', FAILED: '执行未完成' })[state] || '状态待核对'
const executionSummary = execution => execution?.state === 'OUTPUT_COMMITTED'
  ? '执行已有已归档输出；可查看已登记的固定版本成果。'
  : '已受理，尚未取得成果。'
watch(() => props.selectedAgent?.agentId, id => { if (!drafts.draft.value && id) form.targetAgentId = id }, { immediate: true })
watch(form, () => { if (savedFormSnapshot.value !== formSnapshot()) authorizationAcknowledgement.value = false }, { deep: true })
watch([() => props.identityEpoch, () => props.identityScope], () => { revisionSource.value = null; fill({}); selectedFileId.value = ''; selectedVersion.value = null }, { flush: 'sync' })
onMounted(() => { void workspace.refresh({ state: 'ACTIVE' }) })
onBeforeUnmount(() => { workspace.dispose(); drafts.dispose() })
</script>

<style scoped>
.hall-draft-editor {
  max-height: min(60vh, 560px);
  display:grid;
  gap:12px;
  padding:14px 16px 18px;
  overflow:auto;
  color:#4a3423;
}
.hall-draft-editor header,.draft-header-actions,.hall-draft-editor footer,.draft-material-actions {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
}
.hall-draft-editor h3,.hall-draft-editor h4 {
  margin:0;
}
.hall-draft-editor p {
  margin:4px 0 0;
  font-size:12px;
  line-height:1.5;
  color:#765f40;
}
.hall-draft-editor form,.draft-materials {
  display:grid;
  gap:10px;
}
.hall-draft-editor label {
  display:grid;
  gap:4px;
  font-size:13px;
}
.hall-draft-editor input,.hall-draft-editor textarea,.hall-draft-editor select,.hall-draft-editor button {
  border:1px solid #d7c3a2;
  border-radius:7px;
  background:#fffdf6;
  color:#4a3423;
  font:inherit;
}
.hall-draft-editor input,.hall-draft-editor textarea,.hall-draft-editor select {
  padding:8px;
}
.hall-draft-editor textarea {
  min-height:88px;
  resize:vertical;
}
.hall-draft-editor button {
  min-height:32px;
  padding:0 9px;
  cursor:pointer;
}
.hall-draft-editor button:disabled {
  opacity:.55;
  cursor:not-allowed;
}
.draft-materials,.draft-recovery,.draft-confirmation,.hall-case-detail {
  padding:10px;
  border:1px solid rgba(109,78,39,.25);
  border-radius:8px;
  background:rgba(255,250,238,.65);
}
.draft-file-list,.draft-recovery {
  display:grid;
  gap:6px;
}
.draft-file-list button,.draft-recovery button {
  display:grid;
  gap:2px;
  text-align:left;
  padding:7px;
}
.draft-file-list button.selected {
  border-color:#7c1f1b;
  background:#f3e0bc;
}
.draft-file-list small,.draft-recovery small {
  color:#765f40;
  overflow-wrap:anywhere;
}
.draft-input-list {
  display:flex;
  flex-wrap:wrap;
  gap:6px;
}
.draft-input-list span {
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:4px 6px;
  border-radius:6px;
  background:#efe0c6;
  font-size:12px;
}
.draft-input-list button {
  min-height:24px;
}
.draft-preview-image {
  max-width:100%;
  max-height:240px;
  object-fit:contain;
  border-radius:6px;
  background:#fffdf6;
}
.draft-preview {
  max-height:150px;
  overflow:auto;
  white-space:pre-wrap;
  padding:8px;
  background:#fffdf6;
  border-radius:6px;
}
.draft-error {
  color:#a1261d !important;
}
.draft-saved {
  color:#3d6641 !important;
}
.draft-confirmation,.hall-case-detail {
  display:grid;
  gap:8px;
}
.draft-confirmation label {
  display:flex;
  align-items:flex-start;
  gap:6px;
}
.draft-confirmation button {
  justify-self:start;
  background:#7c1f1b;
  color:#fff8e8;
}
.hall-case-detail header {
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:8px;
}
.case-executions {
  display:grid;
  gap:4px;
}
.case-executions p {
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:6px;
}
.case-executions button,.hall-result-actions button {
  min-height:26px;
}
.hall-results {
  display:grid;
  gap:8px;
}
.hall-result-item {
  display:grid;
  gap:4px;
  padding:8px;
  border-radius:6px;
  background:#fffdf6;
}
.hall-result-item small {
  color:#765f40;
  overflow-wrap:anywhere;
}
.hall-result-actions {
  display:flex;
  flex-wrap:wrap;
  gap:6px;
}
.case-results-note {
  border-top:1px solid rgba(109,78,39,.2);
  padding-top:8px;
}
.hall-draft-editor footer {
  justify-content:flex-start;
}
.hall-draft-editor footer button:first-child {
  background:#7c1f1b;
  color:#fff8e8;
}
@media (max-width:620px) {
  .hall-draft-editor header {
    align-items:flex-start;
    flex-direction:column;
  }
  .draft-header-actions {
    width:100%;
    justify-content:flex-start;
  }
}
</style>
