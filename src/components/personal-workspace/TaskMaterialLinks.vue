<template>
  <section class="task-material-links" aria-labelledby="task-material-links-title">
    <div class="task-material-heading">
      <div>
        <h4 id="task-material-links-title">资料与成果</h4>
        <p>资料关联只固定当前文件版本，不会启动 Agent 执行或改变悬赏交付状态。</p>
      </div>
      <div class="task-material-heading-actions">
        <button type="button" @click="refresh">刷新</button>
        <button type="button" class="open-material-picker" @click="openMaterialPicker">选择资料（可选）</button>
      </div>
    </div>

    <p v-if="links.listState.value === 'loading'" class="task-material-note" role="status">正在读取已关联资料…</p>
    <p v-else-if="links.error.value" class="task-material-error" role="alert">{{ links.error.value }}</p>

    <div v-if="links.links.value.length" class="task-link-list" aria-label="已关联资料">
      <article v-for="link in links.links.value" :key="link.relationId" class="task-link-row" :class="link.role.toLowerCase()">
        <div>
          <strong>{{ roleText(link.role) }}</strong>
          <span>{{ link.fileId }} · v{{ link.version }}</span>
          <small>{{ link.state === 'ACTIVE' ? '当前关联' : '已解除关联' }}</small>
        </div>
        <div class="task-link-actions">
          <button type="button" class="open-linked-file" @click="openLinkedFile(link)">在工作空间查看</button>
          <button
            v-if="link.state === 'ACTIVE' && link.role !== 'OUTPUT'"
            type="button"
            :disabled="links.actionState.value === 'removing'"
            @click="detach(link)"
          >解除关联</button>
          <small v-else-if="link.role === 'OUTPUT'">成果关联由执行流程管理</small>
        </div>
      </article>
    </div>
    <p v-else-if="links.listState.value === 'empty'" class="task-material-note">当前悬赏还没有关联资料。</p>
    <button v-if="links.nextCursor.value" type="button" class="load-more" :disabled="links.loading.value" @click="links.loadMore">读取更多关联</button>

    <Teleport to="body">
    <section v-if="materialPickerOpen" class="task-material-picker" role="region" aria-labelledby="task-material-picker-title">
      <header class="material-picker-header">
        <button type="button" class="material-picker-back" @click="closeMaterialPicker">返回</button>
        <div>
          <h5 id="task-material-picker-title">选择资料（可选）</h5>
          <p>可不选资料直接返回；选择时固定到明确文件版本。</p>
        </div>
      </header>
      <div class="material-picker-body">
        <p v-if="workspace.listState.value === 'loading'" class="task-material-note" role="status">正在读取工作空间…</p>
        <p v-else-if="workspace.error.value" class="task-material-error" role="alert">{{ workspace.error.value }}</p>
        <div v-else-if="workspace.items.value.length" class="workspace-file-list" aria-label="可选资料">
          <button
            v-for="file in workspace.items.value"
            :key="file.fileId"
            type="button"
            :class="{ selected: selectedFileId === file.fileId }"
            @click="selectFile(file.fileId)"
          >
            <strong>{{ file.displayName }}</strong><small>最新 v{{ file.latestVersion }}</small>
          </button>
        </div>
        <p v-else-if="workspace.listState.value === 'empty'" class="task-material-note">工作空间暂无资料。可以直接返回，不影响无资料办理。</p>
        <button v-if="workspace.nextCursor.value" type="button" class="load-more" :disabled="workspace.loading.value" @click="workspace.loadMore({ state: 'ACTIVE' })">读取更多文件</button>
      </div>
      <footer class="material-picker-footer">
        <template v-if="workspace.detail.value?.file?.state === 'ACTIVE'">
          <div class="material-picker-fields">
            <label><span>文件版本</span><select v-model.number="selectedVersion"><option v-for="version in workspace.detail.value.versions" :key="version.version" :value="version.version">v{{ version.version }} · {{ version.originalFilename }}</option></select></label>
            <label><span>资料用途</span><select v-model="selectedRole"><option value="INPUT">用于办理</option><option value="REFERENCE">仅供参考</option></select></label>
          </div>
          <button type="button" class="attach-material" :disabled="!canAttach" @click="attach">确认使用此版本</button>
        </template>
        <p v-else class="task-material-note">尚未选择资料。资料不是开始办理的前置条件。</p>
        <button type="button" class="use-no-material" @click="closeMaterialPicker">{{ activeInputLinks.length ? '完成选择' : '不使用资料，返回事项' }}</button>
        <p v-if="links.actionState.value === 'saving'" class="task-material-note" role="status">正在确认关联…</p>
        <p v-else-if="links.error.value && links.actionState.value === 'error'" class="task-material-error" role="alert">{{ links.error.value }}</p>
      </footer>
    </section>
    </Teleport>

    <section class="formal-task-execution" aria-labelledby="formal-task-execution-title">
      <div>
        <h5 id="formal-task-execution-title">明确开始正式办理</h5>
        <p>资料可选。只会为当前事项、已确认议事和明确承办 Agent 创建 PDF 办理请求；绝不回退为私人交办。</p>
      </div>
      <p class="task-material-note">承办 Agent：{{ targetAgentId || '未确认' }}；成果：正式 PDF；资料：{{ selectedInputs.length }} 份固定版本。</p>
      <p v-if="formal.readyReason.value" class="task-material-error" role="status">{{ formal.readyReason.value }}</p>
      <template v-else>
        <fieldset class="formal-inputs">
          <legend>本次使用的资料（可选）</legend>
          <p v-if="!activeInputLinks.length" class="task-material-note">当前不使用资料；执行能力允许时可直接开始办理。</p>
          <label v-for="link in activeInputLinks" :key="link.relationId">
            <input v-model="selectedInputKeys" type="checkbox" :value="inputKey(link)" :disabled="isOtherVersionSelected(link)">
            <span>{{ link.fileId }} · v{{ link.version }}</span>
          </label>
        </fieldset>
        <label class="formal-instruction">
          <span>办理说明</span>
          <textarea v-model="instruction" maxlength="4000" placeholder="说明正式交付要求；附件内容不复制到这里。"></textarea>
        </label>
        <p class="formal-risk-note">点击确认后，将由上述 Agent 按当前要求开始办理，仅使用已勾选资料，并可能调用产生未知费用的外部 Provider。</p>
        <button type="button" class="begin-formal-execution" :disabled="!canBegin" @click="beginFormalExecution">确认并开始办理（PDF）</button>
      </template>
      <p v-if="formal.scopeError.value" class="task-material-error" role="alert">{{ formal.scopeError.value }}</p>
      <p class="task-material-note" role="status">{{ formal.stateText.value }}</p>
      <dl v-if="formal.activeExecution.value" class="formal-execution-facts">
        <div><dt>执行编号</dt><dd>{{ formal.activeExecution.value.executionId }}</dd></div>
        <div><dt>运行编号</dt><dd>{{ formal.activeExecution.value.runId }}</dd></div>
        <div><dt>状态</dt><dd>{{ formal.activeExecution.value.state }}</dd></div>
      </dl>
      <label v-if="formal.activeExecution.value?.state === 'QUEUED'" class="formal-confirmation revoke-confirmation">
        <input v-model="revokeConfirmed" type="checkbox" :disabled="formal.revoking.value">
        <span>确认撤销本次执行的输入授权；不会自动重跑，不代表已取消外部调用或免除费用。</span>
      </label>
      <div class="formal-execution-actions">
        <button v-if="formal.activeExecution.value?.state === 'QUEUED'" type="button" :disabled="!revokeConfirmed || !formal.canRevoke.value" @click="revokeFormalExecution">撤销本次输入授权</button>
        <button type="button" :disabled="formal.revoking.value" @click="recoverFormalExecution">恢复原请求</button>
        <button type="button" :disabled="formal.execution.pending.value" @click="loadFormalHistory">读取本任务执行历史</button>
      </div>
      <p v-if="formal.historyState.value === 'loading'" class="task-material-note" role="status">正在核对执行历史…</p>
      <p v-else-if="formal.historyError.value" class="task-material-error" role="alert">{{ formal.historyError.value }}</p>
      <ul v-else-if="formal.formalHistory.value.length" class="formal-history">
        <li v-for="item in formal.formalHistory.value" :key="item.executionId">
          <button type="button" @click="formal.selectFormalHistory(item.executionId)">{{ item.executionId }} · {{ item.state }} · PDF</button>
        </li>
      </ul>
      <p class="task-material-note">创建 TASK 执行不等于 Agent 或 Provider 已运行；PDF 是否成为正式 submitted/accepted 交付，仍须以正式交付回执为准。</p>
    </section>

    <section class="task-execution-fact" aria-label="执行和成果状态">
      <h5>执行和成果</h5>
      <p>{{ executionFact }}</p>
      <p class="task-material-note">正式待验收、已验收或要求修改只以正式交付接口回执为准；文件关联本身不表示已执行、已交付或已验收。</p>
    </section>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePersonalWorkspace } from '@/composables/usePersonalWorkspace'
import { usePersonalWorkspaceTaskLinks } from '@/composables/usePersonalWorkspaceTaskLinks'
import { useFormalTaskExecution } from '@/composables/useFormalTaskExecution'

const emit = defineEmits(['formal-execution-created', 'formal-execution-recovered'])
const props = defineProps({
  taskId: { type: String, required: true },
  conversationId: { type: String, default: '' },
  targetAgentId: { type: String, default: '' },
  conversationConfirmed: { type: Boolean, default: false },
  formalExecutionAuthorized: { type: Boolean, default: false },
  formalExecutionAuthorizationReason: { type: String, default: '' },
  identityEpoch: { type: [Number, String], default: 0 },
  identityScope: { type: String, default: '' },
  defaultInstruction: { type: String, default: '' }
})

const selectedFileId = ref('')
const selectedVersion = ref(null)
const selectedRole = ref('INPUT')
const selectedInputKeys = ref([])
const materialPickerOpen = ref(false)
const instruction = ref('')
const workspace = usePersonalWorkspace({ identityEpoch: () => props.identityEpoch })
const links = usePersonalWorkspaceTaskLinks({ taskId: () => props.taskId, identityEpoch: () => props.identityEpoch })
const formal = useFormalTaskExecution({
  taskId: () => props.taskId,
  conversationId: () => props.conversationId,
  targetAgentId: () => props.targetAgentId,
  conversationConfirmed: () => props.conversationConfirmed,
  executionAuthorized: () => props.formalExecutionAuthorized,
  executionAuthorizationReason: () => props.formalExecutionAuthorizationReason,
  identityEpoch: () => props.identityEpoch,
  identityScope: () => props.identityScope || String(props.identityEpoch)
})
const selectedFile = computed(() => workspace.detail.value?.file?.fileId === selectedFileId.value ? workspace.detail.value.file : null)
const canAttach = computed(() => Boolean(selectedFile.value?.state === 'ACTIVE' && Number.isSafeInteger(selectedVersion.value) && selectedVersion.value > 0 && links.actionState.value !== 'saving'))
const outputLinks = computed(() => links.links.value.filter(link => link.state === 'ACTIVE' && link.role === 'OUTPUT'))
const activeInputLinks = computed(() => links.links.value.filter(link => link.state === 'ACTIVE' && link.role === 'INPUT'))
const selectedInputs = computed(() => activeInputLinks.value
  .filter(link => selectedInputKeys.value.includes(inputKey(link)))
  .map(link => ({ fileId: link.fileId, version: link.version })))
const canBegin = computed(() => !formal.readyReason.value &&
  (selectedInputs.value.length > 0 || formal.execution.generationEnabled.value === true) &&
  instruction.value.trim().length > 0 && !formal.execution.pending.value)
const executionFact = computed(() => {
  if (links.listState.value === 'error') return '资料关联目录不可用，当前不能确认执行或成果状态。'
  if (outputLinks.value.length) return `已读取 ${outputLinks.value.length} 条 OUTPUT 关联；它们是执行流程记录的成果引用，正式交付状态仍需以正式交付回执确认。`
  return '尚未确认本悬赏有正式交付；资料关联本身不表示已执行。'
})

const roleText = role => ({ INPUT: '输入资料', REFERENCE: '参考资料', OUTPUT: '成果引用' })[role] || '未知用途'
const inputKey = link => `${link.fileId}\u0000${link.version}`
const isOtherVersionSelected = link => selectedInputKeys.value.some(key => key.startsWith(`${link.fileId}\u0000`) && key !== inputKey(link))
const resetPickerSelection = () => { selectedFileId.value = ''; selectedVersion.value = null; selectedRole.value = 'INPUT' }
const resetSelection = () => {
  resetPickerSelection(); materialPickerOpen.value = false; selectedInputKeys.value = []
  instruction.value = String(props.defaultInstruction || '').trim().slice(0, 4000)
}
const openMaterialPicker = () => { materialPickerOpen.value = true }
const closeMaterialPicker = () => { materialPickerOpen.value = false; resetPickerSelection() }
const refresh = () => {
  void workspace.refresh({ state: 'ACTIVE' }); void links.load(); void formal.refreshReadiness()
}
const selectFile = async fileId => {
  const detail = await workspace.select(fileId)
  if (!detail || detail.file.state !== 'ACTIVE') return
  selectedFileId.value = detail.file.fileId
  selectedVersion.value = detail.latestVersion.version
}
const openLinkedFile = async link => {
  const detail = await workspace.select(link.fileId)
  if (!detail || detail.file.state !== 'ACTIVE') return
  materialPickerOpen.value = true
  selectedFileId.value = detail.file.fileId
  selectedVersion.value = detail.versions.some(version => version.version === link.version) ? link.version : null
}
const attach = async () => {
  if (!canAttach.value) return
  const saved = await links.attach({ fileId: selectedFile.value.fileId, version: selectedVersion.value, role: selectedRole.value })
  if (saved) {
    if (saved.role === 'INPUT' && !selectedInputKeys.value.includes(inputKey(saved))) selectedInputKeys.value = [...selectedInputKeys.value, inputKey(saved)]
    closeMaterialPicker()
  }
}
const detach = link => { void links.detach(link) }
const revokeConfirmed = ref(false)
const revokeFormalExecution = async () => {
  const result = await formal.revokeOriginal({ confirmed: revokeConfirmed.value })
  revokeConfirmed.value = false
  if (result) emit('formal-execution-recovered', result)
}
watch(() => `${props.identityEpoch}\u0000${props.taskId}\u0000${props.conversationId}\u0000${props.targetAgentId}`, () => { revokeConfirmed.value = false }, { flush: 'sync' })
const beginFormalExecution = async () => {
  const result = await formal.begin({ inputs: selectedInputs.value, instruction: instruction.value, confirmed: true })
  if (result) emit('formal-execution-created', result)
}
const recoverFormalExecution = async () => {
  const result = await formal.recoverOriginalRequest()
  if (result) emit('formal-execution-recovered', result)
}
const loadFormalHistory = () => { void formal.loadFormalHistory() }

watch(() => `${props.identityEpoch}\u0000${props.taskId}\u0000${props.conversationId}\u0000${props.targetAgentId}\u0000${props.formalExecutionAuthorized}\u0000${props.formalExecutionAuthorizationReason}\u0000${props.defaultInstruction}`, resetSelection, { immediate: true, flush: 'sync' })
watch(activeInputLinks, values => {
  selectedInputKeys.value = selectedInputKeys.value.filter(key => values.some(link => inputKey(link) === key))
})
onMounted(() => {
  refresh()
  void formal.recoverOriginalRequest().then(result => { if (result) emit('formal-execution-recovered', result) })
})
onBeforeUnmount(() => { workspace.dispose(); links.dispose(); formal.dispose() })
</script>

<style scoped>
.task-material-links{display:grid;gap:14px;margin:14px 0;padding:14px;border:1px solid #ded8cc;border-radius:12px;background:#fffefa;color:#303733;min-width:0}.task-material-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.task-material-heading h4,.task-material-picker h5,.task-execution-fact h5{margin:0}.task-material-heading p,.task-execution-fact p{margin:5px 0 0;font-size:12px;line-height:1.55}.task-material-heading-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.task-material-links button,.task-material-links select{min-height:40px;border:1px solid #cfc8ba;border-radius:8px;background:#fff;color:#303733;font:inherit}.task-material-links button{padding:0 11px;cursor:pointer}.task-material-links button:disabled{cursor:not-allowed;opacity:.55}.open-material-picker,.begin-formal-execution,.attach-material{background:#923f30!important;border-color:#923f30!important;color:#fffefa!important}.task-link-list{display:grid;gap:8px}.task-link-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border-radius:9px;background:#f5f2ea}.task-link-row>div:first-child{display:grid;gap:2px;min-width:0}.task-link-actions{display:grid;justify-items:end;gap:5px;flex:0 0 auto}.task-link-row strong,.task-link-row span,.task-link-row small{overflow-wrap:anywhere}.task-link-row span,.task-link-row small{color:#68716b;font-size:12px}.task-link-row.output{border-left:3px solid #4d6b4b}.formal-task-execution{display:grid;gap:10px;padding:14px;border:1px solid #eadfd4;border-radius:12px;background:#fff}.formal-task-execution h5,.formal-task-execution p{margin:0}.formal-inputs{display:grid;gap:8px;margin:0;padding:10px;border:1px solid #ded8cc;border-radius:8px}.formal-inputs label,.formal-confirmation{display:flex;gap:8px;align-items:flex-start;font-size:13px}.formal-inputs input,.formal-confirmation input{width:20px;height:20px;flex:none}.formal-instruction{display:grid;gap:5px;font-size:13px}.formal-instruction textarea{min-height:82px;padding:10px;border:1px solid #cfc8ba;border-radius:8px;font:inherit;font-size:16px;resize:vertical}.formal-risk-note{padding:10px;border-radius:8px;background:#f6eee8;color:#6f493f;font-size:12px;line-height:1.55}.begin-formal-execution{justify-self:stretch;min-height:48px!important;font-weight:600}.formal-execution-actions{display:flex;gap:8px;flex-wrap:wrap}.formal-history{display:grid;gap:7px;margin:0;padding-left:18px}.formal-history button{min-height:32px;text-align:left}.formal-execution-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:0}.formal-execution-facts div{display:grid;gap:2px}.formal-execution-facts dt{font-size:11px;color:#68716b}.formal-execution-facts dd{margin:0;overflow-wrap:anywhere;font-size:12px}.task-execution-fact{padding-top:12px;border-top:1px solid #ded8cc}.task-material-note{color:#68716b}.task-material-error{color:#a1261d}.load-more{justify-self:start}.task-material-picker{position:fixed;inset:0;z-index:1200;display:grid;grid-template-rows:auto minmax(0,1fr) auto;box-sizing:border-box;width:100%;height:100%;height:100dvh;background:#f5f4f0;color:#242e2b}.material-picker-header{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #e3e5dc;background:#fffefa}.material-picker-header>div{min-width:0}.material-picker-header h5{font-size:17px}.material-picker-header p{margin:2px 0 0;color:#68716b;font-size:12px}.material-picker-back{flex:none}.material-picker-body{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 14px calc(20px + env(safe-area-inset-bottom))}.workspace-file-list{display:grid;gap:8px}.workspace-file-list button{display:grid;gap:3px;width:100%;min-height:58px;padding:10px 12px;text-align:left}.workspace-file-list button.selected{border-color:#923f30;background:#f6eee8;box-shadow:0 0 0 2px #923f3026}.workspace-file-list small{color:#68716b;overflow-wrap:anywhere}.material-picker-footer{display:grid;gap:9px;padding:10px 14px max(12px,env(safe-area-inset-bottom));border-top:1px solid #e3e5dc;background:#fffefa;box-shadow:0 -8px 24px #242e2b14}.material-picker-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}.material-picker-fields label{display:grid;gap:4px;font-size:12px}.material-picker-fields select{width:100%;min-width:0;padding:0 8px}.attach-material,.use-no-material{width:100%;min-height:46px!important}.use-no-material{background:#fffefa!important}.material-picker-footer p{margin:0;font-size:12px}.material-picker-footer .attach-material+.use-no-material{display:none}@media(max-width:620px){.task-material-links{margin-inline:0;padding:12px}.task-material-heading{display:grid}.task-material-heading-actions{justify-content:stretch}.task-material-heading-actions button{flex:1}.task-link-row{align-items:flex-start;flex-direction:column}.task-link-actions{width:100%;grid-template-columns:1fr 1fr;justify-items:stretch}.task-link-actions button{width:100%}.formal-execution-facts{grid-template-columns:1fr}.material-picker-header{padding-top:max(10px,env(safe-area-inset-top))}.material-picker-fields{grid-template-columns:1fr}.material-picker-footer{max-height:46dvh;overflow-y:auto}}
</style>
