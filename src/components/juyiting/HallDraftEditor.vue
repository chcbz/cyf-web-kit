<template>
  <section class="hall-draft-editor" aria-labelledby="hall-draft-editor-title">
    <header>
      <div>
        <h3 id="hall-draft-editor-title">{{ initialRef ? '继续办理' : isTaskCreate ? '起草正式任务' : '起草交办' }}</h3>
        <p v-if="isTaskCreate">仅创建无悬赏金额、未指派的正式任务。请填写任务名目与简述；点将、进展和交付随后在正式事项中办理。</p>
        <p v-else>先保存草稿、固定资料版本和受托好汉；私人交办须明确确认授权。正式返工仍使用原入口。</p>
      </div>
      <div class="draft-header-actions">
        <button
          v-if="!initialRef"
          type="button"
          :disabled="busy"
          @click="loadRecoverable"
        >恢复草稿</button>
        <button
          v-if="initialRef && !showDraftFields"
          type="button"
          :disabled="busy"
          @click="openInitial"
        >重新读取事项</button>
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

    <p v-if="sourceReadState === 'loading'" role="status">正在核对原事项…</p>
    <p v-else-if="sourceReadState === 'error'" role="alert">原事项未能读取，不会另建事项代替。请重试。</p>
    <p v-if="initialContext?.sourceRef?.sourceType === 'FILE'">来源资料：{{ initialContext.sourceRef.sourceId }} · v{{ initialContext.sourceRef.version }}；返回后仍保留原文件位置。</p>
    <form @submit.prevent="persist">
      <template v-if="showDraftFields">
        <label><span>{{ isTaskCreate ? '任务名目' : '交办名目' }}</span><input v-model="form.title" :maxlength="isTaskCreate ? 30 : null" :placeholder="isTaskCreate ? '最多30字' : '说明要办的事'" /></label>
        <label><span>{{ isTaskCreate ? '简述' : '具体交代' }}</span><textarea v-model="form.instruction" :maxlength="isTaskCreate ? 200 : null" :placeholder="isTaskCreate ? '最多200字；不代替后续正式办理' : '写明目标、限制和期望成果'"></textarea></label>
        <p v-if="!isTaskCreate">名目最多200字，具体交代最多20000字；超出时保留原文，不会截短保存。</p>
        <template v-if="isTaskCreate">
          <p>此入口不收取悬赏金额，也不启动执行。长说明或资金悬赏请使用原张榜入口；不会把长文截短后提交。</p>
          <p v-if="formalValidationError" class="draft-error" role="alert">{{ formalValidationError }}</p>
          <section v-if="hasUnsupportedFormalFields" class="draft-formal-existing" aria-label="原有内容保留">
            <p>原稿包含此入口不支持的选人、格式或附件，已原样保留，尚不能确认提交。</p>
            <p v-if="form.targetAgentId">原受托好汉：{{ form.targetAgentId }}</p>
            <p v-if="form.outputMime">原期望格式：{{ form.outputMime }}</p>
            <p v-for="input in form.inputs" :key="`${input.fileId}:${input.version}`">原附件：{{ input.fileId }} · v{{ input.version }}</p>
            <button type="button" :disabled="busy" @click="removeUnsupportedFormalFields">明确移除原选人、格式和附件</button>
          </section>
          <p v-if="hasUnsupportedFormalSource" role="alert">原稿关联了资料来源或议事会话，此处不能改变该关联。原稿已保留，请回原正式入口处理，不会另建副本代替。</p>
        </template>
        <template v-else>
          <label><span>受托好汉</span>
            <select v-model="form.targetAgentId"><option value="">暂不指定</option><option v-for="agent in agents" :key="agent.agentId" :value="agent.agentId">{{ agentName(agent) }}</option></select>
          </label>
          <label><span>期望格式</span>
            <select v-model="form.outputMime" aria-label="期望格式">
              <option value="">暂不选择</option>
              <option v-if="form.outputMime && !drafts.allowedMimeTypes.value.includes(form.outputMime)" :value="form.outputMime">保留原格式：{{ deliveryTypeText(form.outputMime) }} · {{ form.outputMime }}（未确认支持）</option>
              <option v-for="mime in drafts.allowedMimeTypes.value" :key="mime" :value="mime">{{ deliveryTypeText(mime) }}</option>
            </select>
          </label>
          <button type="button" :disabled="drafts.capabilityState.value === 'loading'" @click="drafts.loadCapabilities">刷新交付格式</button>
          <p v-if="formatHint" role="status">{{ formatHint }}</p>

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
        </template>
      </template>
      <p v-if="drafts.error.value" class="draft-error" role="alert">{{ drafts.error.value }}</p>
      <p v-if="drafts.reloadRequired.value" class="draft-error" role="alert">服务端版本已变化；本地输入未覆盖。请先恢复草稿再决定是否重填。</p>
      <p v-else-if="needsSave" role="status">当前修改尚未保存到账号。</p>
      <p v-else-if="drafts.draft.value?.state === 'EDITING'" class="draft-saved" role="status">草稿 {{ drafts.draft.value.draftId }} 已保存为 r{{ drafts.draft.value.revision }}；尚未交办。</p>
      <p v-if="isTaskAction" role="status">这是正式事项草稿；此处只保存编辑。正式张榜和返工请使用原正式入口。</p>
      <section v-if="drafts.draft.value?.state === 'EDITING' && !isTaskAction" class="draft-confirmation" aria-label="交办确认">
        <label><input v-model="authorizationAcknowledgement" :disabled="!canConfirm" type="checkbox" /> {{ isTaskCreate ? '我已确认创建无悬赏金额、未指派的正式任务；这不会启动执行，也不是私人交办。' : '我已确认本次私人交办会按固定资料版本创建新的执行。' }}</label>
        <p v-if="!isCurrentDraftSaved">草稿内容已修改；请先保存本次修改，确认授权会随修改撤回。</p>
        <p v-else>确认后显示“已受理”；这不表示已完成或已有成果。</p>
        <button type="button" :disabled="busy || !canConfirm || !authorizationAcknowledgement || Boolean(drafts.unresolvedIntent.value)" @click="submit">{{ isTaskCreate ? '确认创建正式任务' : '确认授权并交办' }}</button>
      </section>
      <section v-if="displayedRef" class="hall-case-detail" aria-label="事项进展">
        <header><div><h4>事项进展</h4><p>来源：{{ sourceTypeLabel(displayedRef.sourceType) }} · {{ displayedRef.sourceId }}</p></div><button
          v-if="['PRIVATE_CASE', 'LEGACY_EXECUTION'].includes(displayedRef.sourceType)"
          type="button"
          :disabled="busy"
          @click="refreshCase"
        >核对进展</button></header>
        <template v-if="displayedRef.sourceType === 'TASK'">
          <p>{{ drafts.receipt.value?.task ? '正式任务已创建，尚未指派或启动执行。' : '该正式事项已由原正式服务受理。' }} 进展、成果和返工继续使用原正式入口。</p>
          <button type="button" :disabled="busy" @click="openFormalTask">打开正式事项</button>
        </template>
        <template v-else>
          <p v-if="currentExecution">{{ executionSummary(currentExecution) }} 执行编号 {{ currentExecution.executionId }} · {{ executionText(currentExecution.state) }}</p>
          <p v-else>私人交办回执未包含执行信息；请核对原交办。</p>
        </template>
        <div v-if="displayedRef.sourceType === 'PRIVATE_CASE' && drafts.caseView.value?.executions?.length" class="case-executions">
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
        <button
          v-if="displayedRef.sourceType === 'LEGACY_EXECUTION' && currentExecution?.state === 'OUTPUT_COMMITTED'"
          type="button"
          :disabled="busy"
          @click="openResults(currentExecution)"
        >查看成果</button>
        <HallPrivateMark
          v-if="['PRIVATE_CASE', 'LEGACY_EXECUTION'].includes(displayedRef.sourceType)"
          :source-ref="displayedRef"
          :result-ref="markableResult"
          :identity-scope="identityScope"
          :identity-epoch="identityEpoch"
          @changed="$emit('changed')"
        />
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
          <p v-if="!showDraftFields && workspace.preview.value?.kind === 'text'" class="draft-preview">{{ workspace.preview.value.text }}</p>
          <img
            v-else-if="!showDraftFields && workspace.preview.value?.kind === 'image'"
            class="draft-preview-image"
            :src="workspace.preview.value.url"
            alt="成果固定版本预览"
          />
          <p v-else-if="!showDraftFields && workspace.preview.value?.message">{{ workspace.preview.value.message }}</p>
          <p v-if="drafts.resultsError.value" class="draft-error" role="alert">{{ drafts.resultsError.value }}</p>
        </section>
        <p v-else-if="drafts.resultsState.value === 'loading'" class="case-results-note">正在读取成果。</p>
        <p v-else-if="drafts.resultsError.value" class="draft-error" role="alert">{{ drafts.resultsError.value }}</p>
        <p v-if="displayedRef.sourceType !== 'TASK'" class="case-results-note">新修改须新建草稿和新执行，旧执行不会重跑。</p>
      </section>
      <footer v-if="showDraftFields"><button v-if="revisionSource || !drafts.draft.value || drafts.draft.value?.state === 'EDITING'" type="submit" :disabled="busy">{{ revisionSource ? '保存修改草稿' : drafts.draft.value ? '保存修改' : '确认保存草稿' }}</button><button
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
import HallPrivateMark from './HallPrivateMark.vue'
import { deliveryTypeText } from '@/utils/executionFormats'

const props = defineProps({
  initialRef: { type: Object, default: null },
  initialContext: { type: Object, default: null },
  initialKind: { type: String, default: 'CREATE', validator: value => ['CREATE', 'TASK_CREATE'].includes(value) },
  agents: { type: Array, default: () => [] },
  selectedAgent: { type: Object, default: null },
  identityEpoch: { type: [Number, String], default: 0 },
  identityScope: { type: String, default: '' }
})
const emit = defineEmits(['close', 'open-task', 'changed'])
const drafts = useHallDrafts({
  identityEpoch: () => props.identityEpoch,
  identityScope: () => props.identityScope
})
const workspace = usePersonalWorkspace({ identityEpoch: () => props.identityEpoch })
const form = reactive({ title: '', instruction: '', targetAgentId: '', outputMime: '', inputs: [] })
const revisionSource = ref(null)
const sourceReadState = ref('idle')
const draftKind = computed(() => revisionSource.value ? 'REVISION' : drafts.draft.value?.kind || props.initialKind)
const isTaskCreate = computed(() => draftKind.value === 'TASK_CREATE')
const isTaskAction = computed(() => draftKind.value === 'TASK_ACTION')
const showDraftFields = computed(() => Boolean(revisionSource.value || drafts.draft.value?.state === 'EDITING' ||
  (!props.initialRef && !drafts.draft.value && !drafts.receipt.value)))
const hasUnsupportedFormalFields = computed(() => Boolean(form.targetAgentId || form.outputMime || form.inputs.length))
const hasUnsupportedFormalSource = computed(() => Boolean(drafts.draft.value?.sourceSummary?.sourceRef ||
  drafts.draft.value?.sourceSummary?.conversationId))
const formalValidationError = computed(() => {
  if (!isTaskCreate.value) return ''
  if (!form.title.trim()) return '请填写任务名目。'
  if (form.title.length > 30 || form.instruction.length > 200) return '任务名目最多30字、简述最多200字；原文仍保留，请自行修改或回原张榜入口处理。'
  return ''
})
const formatSupported = computed(() => drafts.capabilityState.value === 'ready' && drafts.allowedMimeTypes.value.includes(form.outputMime))
const formatHint = computed(() => {
  if (drafts.capabilityState.value === 'loading') return '正在读取当前支持的交付格式…'
  if (drafts.capabilityError.value) return drafts.capabilityError.value
  if (!drafts.allowedMimeTypes.value.length) return '当前未取得可用交付格式，可保留草稿，尚不能交办。'
  if (form.outputMime && !formatSupported.value) return '原格式当前不受支持，仍原样保留；请明确选择支持的格式后再交办。'
  if (!form.inputs.length && !drafts.generationEnabled.value) return '当前尚未开放无资料生成；请选取固定资料后再交办。'
  return '仅列出当前服务端确认支持的交付格式。'
})
const canConfirm = computed(() => isCurrentDraftSaved.value && !isTaskAction.value && (isTaskCreate.value
  ? !formalValidationError.value && !hasUnsupportedFormalFields.value && !hasUnsupportedFormalSource.value
  : formatSupported.value && (form.inputs.length > 0 || drafts.generationEnabled.value)))
const displayedRef = computed(() => drafts.receipt.value?.ref ||
  (props.initialRef?.sourceType === 'PRIVATE_CASE' && drafts.caseView.value?.caseId === props.initialRef.sourceId ? props.initialRef : null) ||
  (props.initialRef?.sourceType === 'LEGACY_EXECUTION' && drafts.executionView?.value?.executionId === props.initialRef.sourceId ? props.initialRef : null))
const currentExecution = computed(() => drafts.receipt.value?.execution || drafts.executionView?.value ||
  [...(drafts.caseView.value?.executions || [])].sort((a, b) => b.revisionNo - a.revisionNo)[0]?.execution || null)
// Old results stay readable, but only the latest private execution can mark its current manifest viewed.
const markableResult = computed(() => {
  const results = drafts.executionResults.value
  const latest = [...(drafts.caseView.value?.executions || [])].sort((a, b) => b.revisionNo - a.revisionNo)[0]?.execution || currentExecution.value
  if (!results || results.state !== 'OUTPUT_COMMITTED' || !results.manifestId || !results.items.length ||
    results.items.some(item => item.availability !== 'AVAILABLE') || results.executionId !== latest?.executionId) return null
  return { executionId: results.executionId, manifestId: results.manifestId }
})
const sourceTypeLabel = value => ({ PRIVATE_CASE: '私人事项', LEGACY_EXECUTION: '原私人交办', TASK: '正式事项' })[value] || '事项'

const selectedFileId = ref('')
const selectedVersion = ref(null)
const busy = computed(() => sourceReadState.value === 'loading' || ['creating', 'saving', 'loading', 'discarding'].includes(drafts.state.value) || ['submitting', 'reconciling'].includes(drafts.submissionState.value))
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
const canCreateRevision = computed(() => Boolean(drafts.caseView.value?.caseId) && drafts.executionResults.value?.allowedActions?.includes('CREATE_REVISION') === true)
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
  if (!showDraftFields.value || busy.value || drafts.unresolvedIntent.value) return false
  const payload = { ...form, inputs: form.inputs.map(input => ({ ...input })) }
  const saved = revisionSource.value
    ? await drafts.create({ kind: 'REVISION', caseId: drafts.caseView.value?.caseId || null, sourceOutputRef: revisionSource.value, ...payload })
    : drafts.draft.value ? await drafts.save(payload) : await drafts.create({ kind: props.initialKind, originRef: props.initialContext?.originRef || 'juyiting', sourceRef: props.initialContext?.sourceRef || null, ...payload })
  if (!saved) return false
  revisionSource.value = null
  // A save acknowledgement belongs to the submitted snapshot, not subsequent keystrokes.
  const savedSnapshot = JSON.stringify({
    title: saved.editableFields.title || '',
    instruction: saved.editableFields.instruction || '',
    targetAgentId: saved.editableFields.targetAgentId || '',
    outputMime: saved.editableFields.outputMime || '',
    inputs: saved.editableFields.inputs.map(input => ({ fileId: input.fileId, version: input.version }))
  })
  if (JSON.stringify(payload) === formSnapshot()) fill(saved.editableFields)
  else savedFormSnapshot.value = savedSnapshot
  return isCurrentDraftSaved.value
}
const needsSave = computed(() => showDraftFields.value && !isCurrentDraftSaved.value &&
  Boolean(revisionSource.value || form.title || form.instruction || form.targetAgentId || form.outputMime || form.inputs.length || drafts.draft.value))
const saveBeforeLeave = async () => {
  if (busy.value) return false
  if (!needsSave.value) return true
  return persist()
}
const discardLocalChanges = () => {
  revisionSource.value = null
  fill(drafts.draft.value?.editableFields || {})
}
defineExpose({ needsSave, busy, saveBeforeLeave, discardLocalChanges })
const loadRecoverable = () => { void drafts.list() }
const openDraft = async id => {
  const loaded = await drafts.load(id)
  if (loaded) {
    fill(loaded.editableFields)
    if (!isTaskCreate.value) void drafts.loadCapabilities()
  }
}
const discard = async () => { if (await drafts.discard()) fill({}) }
const submit = () => {
  if (canConfirm.value) void drafts.submit({ authorizationAcknowledgement: authorizationAcknowledgement.value })
}
const removeUnsupportedFormalFields = () => {
  form.targetAgentId = ''
  form.outputMime = ''
  form.inputs = []
}
const openFormalTask = async () => {
  const task = await drafts.loadFormalTask()
  if (task) emit('open-task', task)
}
const reconcile = () => { void drafts.reconcileSubmission() }
const refreshCase = () => {
  const ref = displayedRef.value
  if (ref?.sourceType === 'PRIVATE_CASE') void drafts.loadCase(ref.sourceId)
  else if (ref?.sourceType === 'LEGACY_EXECUTION') void drafts.loadExecution(ref.sourceId)
}
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
watch(() => props.selectedAgent?.agentId, id => { if (!isTaskCreate.value && !drafts.draft.value && id) form.targetAgentId = id }, { immediate: true })
watch(form, () => { if (savedFormSnapshot.value !== formSnapshot()) authorizationAcknowledgement.value = false }, { deep: true, flush: 'sync' })
watch([() => props.identityEpoch, () => props.identityScope], () => { revisionSource.value = null; fill({}); selectedFileId.value = ''; selectedVersion.value = null }, { flush: 'sync' })
const openInitial = async () => {
  const ref = props.initialRef
  if (!ref || !props.identityScope || sourceReadState.value === 'loading') return
  sourceReadState.value = 'loading'
  let loaded = null
  if (ref.sourceType === 'DRAFT') {
    loaded = await drafts.load(ref.sourceId)
    if (loaded) fill(loaded.editableFields)
  } else if (ref.sourceType === 'PRIVATE_CASE') loaded = await drafts.loadCase(ref.sourceId)
  else if (ref.sourceType === 'LEGACY_EXECUTION') loaded = await drafts.loadExecution(ref.sourceId)
  sourceReadState.value = loaded ? 'ready' : 'error'
}
watch([showDraftFields, isTaskCreate, () => props.identityScope, () => props.identityEpoch], () => {
  if (showDraftFields.value && !isTaskCreate.value && props.identityScope && drafts.capabilityState.value === 'idle') void drafts.loadCapabilities()
}, { immediate: true })
onMounted(async () => {
  if (!props.initialRef && props.initialContext) {
    fill(props.initialContext)
    savedFormSnapshot.value = ''
  }
  await openInitial()
  if (showDraftFields.value && !isTaskCreate.value) {
    void workspace.refresh({ state: 'ACTIVE' })
    void drafts.loadCapabilities()
  }
})
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
