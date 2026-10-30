<template>
  <section class="task-material-links" aria-labelledby="task-material-links-title">
    <div class="task-material-heading">
      <div>
        <h4 id="task-material-links-title">资料与成果</h4>
        <p>添加资料不会自动开始办理。</p>
      </div>
      <div class="task-material-heading-actions">
        <button type="button" @click="refresh" class="hall-tool" aria-label="刷新资料关联" title="刷新资料关联"><svg class="hall-control-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/></svg></button>
        <button type="button" class="open-material-picker" @click="openMaterialPicker">选择资料（可选）</button>
      </div>
    </div>

    <p v-if="links.listState.value === 'loading'" class="task-material-note" role="status">正在读取已关联资料…</p>
    <p v-else-if="links.error.value" class="task-material-error" role="alert">{{ links.error.value }}</p>

    <WorkspaceWriteRecovery :pending="links.pendingWrites.value" @retry="links.retryWrite" />
    <p v-if="links.writeNotice.value" class="task-material-note" role="status">{{ links.writeNotice.value }}</p>

    <div v-if="links.links.value.length" class="task-link-list" aria-label="已关联资料">
      <article v-for="link in links.links.value" :key="link.relationId" class="task-link-row" :class="link.role.toLowerCase()">
        <div>
          <strong>{{ roleText(link.role) }}</strong>
          <span>{{ materialName(link) }} · v{{ link.version }}</span>
          <small>{{ link.state === 'ACTIVE' ? '当前关联' : '已解除关联' }}</small>
        </div>
        <div class="task-link-actions">
          <button type="button" class="open-linked-file hall-tool" @click="openLinkedFile(link)" aria-label="在工作空间查看此资料" title="在工作空间查看此资料"><svg class="hall-control-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7"/></svg></button>
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
          <p>将使用所选版本，之后更新文件不会替换本次资料。</p>
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
        <WorkspaceWriteRecovery :pending="links.pendingWrites.value" @retry="links.retryWrite" />
        <template v-if="workspace.detail.value?.file?.state === 'ACTIVE'">
          <div class="material-picker-fields">
            <label><span>文件版本</span><select v-model="selectedVersion"><option v-for="version in workspace.detail.value.versions" :key="version.version" :value="version.version">v{{ version.version }} · {{ version.originalFilename }}</option></select></label>
            <label><span>资料用途</span><select v-model="selectedRole"><option value="INPUT">用于办理</option><option value="REFERENCE">仅供参考</option></select></label>
          </div>
            <template v-if="workspace.hasMoreVersions.value"><button type="button" :disabled="workspace.versionsState.value === 'loading'" @click="workspace.loadMoreVersions">{{ workspace.versionsState.value === 'loading' ? '正在读取历史版本…' : '读取更早版本' }}</button></template><p v-if="workspace.versionsError.value" role="alert">{{ workspace.versionsError.value }}</p>
          <button type="button" class="attach-material" :disabled="!canAttach" @click="attach">确认使用此版本</button>
        </template>
        <p v-else class="task-material-note">尚未选择资料。资料不是开始办理的前置条件。</p>
        <button type="button" class="use-no-material" @click="closeMaterialPicker">{{ activeExecutionLinks.length ? '完成选择' : '不使用资料，返回事项' }}</button>
        <p v-if="links.actionState.value === 'saving'" class="task-material-note" role="status">正在确认关联…</p>
        <p v-else-if="links.error.value && links.actionState.value === 'error'" class="task-material-error" role="alert">{{ links.error.value }}</p>
      </footer>
    </section>
    </Teleport>

    <section class="formal-task-execution" aria-labelledby="formal-task-execution-title">
      <div>
        <h5 id="formal-task-execution-title">开始办理</h5>
        <p>为当前事项生成 PDF 成果，可选择附上资料。</p>
      </div>
      <p class="task-material-note">成果：PDF；资料：{{ selectedInputs.length }} 份固定版本。</p>
      <p v-if="formal.readyReason.value" class="task-material-error" role="status">{{ formal.readyReason.value }}</p>
      <template v-else>
        <fieldset class="formal-inputs">
          <legend>本次使用的资料（可选）</legend>
          <p v-if="!activeExecutionLinks.length" class="task-material-note">当前不使用资料；执行能力允许时可直接开始办理。</p>
          <label v-for="link in activeExecutionLinks" :key="link.relationId">
            <input v-model="selectedInputKeys" type="checkbox" :value="inputKey(link)" :disabled="isOtherVersionSelected(link)">
            <span>{{ materialName(link) }} · v{{ link.version }} · {{ roleText(link.role) }}</span>
          </label>
          <p v-if="activeExecutionLinks.some(link => link.role === 'REFERENCE')" class="task-material-note">只有勾选的资料会用于本次办理。</p>
        </fieldset>
        <label class="formal-instruction">
          <span>办理说明</span>
          <textarea v-model="instruction" maxlength="4000" placeholder="说明正式交付要求；附件内容不复制到这里。"></textarea>
        </label>
        <p class="formal-risk-note">确认后开始办理，仅使用勾选的资料；可能调用外部服务并产生额外费用，金额尚未确定。</p>
        <button type="button" class="begin-formal-execution" :disabled="!canBegin" @click="beginFormalExecution">确认并开始办理（PDF）</button>
      </template>
      <p v-if="formal.scopeError.value" class="task-material-error" role="alert">{{ formal.scopeError.value }}</p>
      <p class="task-material-note" role="status">{{ formal.stateText.value }}</p>
      <dl v-if="formal.activeExecution.value" class="formal-execution-facts">
        <div><dt>状态</dt><dd>{{ executionLabel(formal.activeExecution.value.state) }}</dd></div>
      </dl>
      <label v-if="formal.activeExecution.value?.state === 'QUEUED'" class="formal-confirmation revoke-confirmation">
        <input v-model="revokeConfirmed" type="checkbox" :disabled="formal.revoking.value">
        <span>确认撤销本次执行的输入授权；不会自动重跑，不代表已取消外部调用或免除费用。</span>
      </label>
      <div class="formal-execution-actions">
        <button v-if="formal.activeExecution.value?.state === 'QUEUED'" type="button" :disabled="!revokeConfirmed || !formal.canRevoke.value" @click="revokeFormalExecution">撤销本次输入授权</button>
        <button type="button" :disabled="formal.revoking.value" @click="recoverFormalExecution">查询进度</button>
        <button type="button" :disabled="formal.execution.pending.value" @click="loadFormalHistory">读取本任务执行历史</button>
      </div>
      <p v-if="formal.historyState.value === 'loading'" class="task-material-note" role="status">正在核对执行历史…</p>
      <p v-else-if="formal.historyError.value" class="task-material-error" role="alert">{{ formal.historyError.value }}</p>
      <ul v-else-if="formal.formalHistory.value.length" class="formal-history">
        <li v-for="item in formal.formalHistory.value" :key="item.executionId">
          <button type="button" @click="formal.selectFormalHistory(item.executionId)">{{ executionLabel(item.state) }} · PDF</button>
        </li>
      </ul>
      <p class="task-material-note">提交后请查看交付进度。</p>
    </section>

    <section class="task-execution-fact" aria-label="执行和成果状态">
      <h5>执行和成果</h5>
      <p>{{ executionFact }}</p>
      <p class="task-material-note">添加资料不会自动开始执行或完成验收。</p>
    </section>
  </section>
</template>

<script setup>
import WorkspaceWriteRecovery from './WorkspaceWriteRecovery.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePersonalWorkspace } from '@/composables/usePersonalWorkspace'
import { usePersonalWorkspaceTaskLinks } from '@/composables/usePersonalWorkspaceTaskLinks'
import { validMaterialVersion } from '../../composables/juyiting/materialVersion.js'
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
const linkNames = ref({})
const materialIdentityKey = computed(() => `${props.identityEpoch}\u0000${props.identityScope}`)
const workspace = usePersonalWorkspace({ identityEpoch: materialIdentityKey })
const links = usePersonalWorkspaceTaskLinks({ taskId: () => props.taskId, identityEpoch: materialIdentityKey })
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
const canAttach = computed(() => Boolean(selectedFile.value?.state === 'ACTIVE' && validMaterialVersion(selectedVersion.value) && links.actionState.value !== 'saving'))
const outputLinks = computed(() => links.links.value.filter(link => link.state === 'ACTIVE' && link.role === 'OUTPUT'))
const activeExecutionLinks = computed(() => links.links.value.filter(link => link.state === 'ACTIVE' && ['INPUT', 'REFERENCE'].includes(link.role)))
const selectedInputs = computed(() => activeExecutionLinks.value
  .filter(link => selectedInputKeys.value.includes(inputKey(link)))
  .map(link => ({ fileId: link.fileId, version: link.version })))
const canBegin = computed(() => !formal.readyReason.value &&
  (selectedInputs.value.length > 0 || formal.execution.generationEnabled.value === true) &&
  instruction.value.trim().length > 0 && !formal.execution.pending.value)
const executionFact = computed(() => {
  if (links.listState.value === 'error') return '资料关联目录不可用，当前不能确认执行或成果状态。'
  if (outputLinks.value.length) return `共 ${outputLinks.value.length} 项成果；验收情况请查看交付状态。`
  return '尚未确认本悬赏有正式交付；资料关联本身不表示已执行。'
})

const executionLabel = state => ({ QUEUED: '等待办理', OUTPUT_COMMITTED: '成果已生成', INPUTS_REVOKED: '资料授权已撤销', FAILED: '办理失败' })[state] || '状态待确认'
const roleText = role => ({ INPUT: '输入资料', REFERENCE: '参考资料', OUTPUT: '成果引用' })[role] || '未知用途'
const materialName = link => linkNames.value[link.fileId] || workspace.items.value.find(file => file.fileId === link.fileId)?.displayName || `资料 ${link.fileId}`
const resolveLinkNames = async operationKey => {
  for (const link of links.links.value) {
    if (linkNames.value[link.fileId] || workspace.items.value.some(file => file.fileId === link.fileId)) continue
    const detail = await workspace.select(link.fileId)
    if (operationKey !== `${materialIdentityKey.value}\u0000${props.taskId}`) return
    if (detail?.file?.state === 'ACTIVE' && detail.file.fileId === link.fileId) linkNames.value = { ...linkNames.value, [link.fileId]: detail.file.displayName }
  }
}
const inputKey = link => `${link.fileId}\u0000${link.version}`
const isOtherVersionSelected = link => selectedInputKeys.value.some(key => key.startsWith(`${link.fileId}\u0000`) && key !== inputKey(link))
let pickerGeneration = 0
const resetPickerSelection = () => { pickerGeneration += 1; selectedFileId.value = ''; selectedVersion.value = null; selectedRole.value = 'INPUT' }
const resetSelection = () => {
  resetPickerSelection(); materialPickerOpen.value = false; selectedInputKeys.value = []
  instruction.value = String(props.defaultInstruction || '').trim().slice(0, 4000)
}
const openMaterialPicker = () => { materialPickerOpen.value = true }
const closeMaterialPicker = () => { materialPickerOpen.value = false; resetPickerSelection(); workspace.closeDetail() }
const refresh = async () => {
  const operationKey = `${materialIdentityKey.value}\u0000${props.taskId}`
  const [, loaded] = await Promise.all([workspace.refresh({ state: 'ACTIVE' }), links.load(), formal.refreshReadiness()])
  if (loaded && operationKey === `${materialIdentityKey.value}\u0000${props.taskId}`) await resolveLinkNames(operationKey)
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
  const epoch = pickerGeneration
  const input = { fileId: selectedFile.value.fileId, version: selectedVersion.value, role: selectedRole.value }
  const saved = await links.attach(input)
  if (saved?.state === 'ACTIVE' && epoch === pickerGeneration && selectedFile.value?.fileId === input.fileId && selectedVersion.value === input.version && selectedRole.value === input.role) {
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

watch(() => `${materialIdentityKey.value}\u0000${props.taskId}\u0000${props.conversationId}\u0000${props.targetAgentId}\u0000${props.formalExecutionAuthorized}\u0000${props.formalExecutionAuthorizationReason}\u0000${props.defaultInstruction}`, () => { linkNames.value = {}; resetSelection() }, { immediate: true, flush: 'sync' })
watch(activeExecutionLinks, values => {
  selectedInputKeys.value = selectedInputKeys.value.filter(key => values.some(link => inputKey(link) === key))
})
onMounted(() => {
  void refresh()
  void formal.recoverOriginalRequest().then(result => { if (result) emit('formal-execution-recovered', result) })
})
onBeforeUnmount(() => { workspace.dispose(); links.dispose(); formal.dispose() })
</script>

<style scoped>
.task-material-links{display:grid;gap:14px;margin:14px 0;padding:14px;border:1px solid #ded8cc;border-radius:12px;background:#fffefa;color:#303733;min-width:0}.task-material-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.task-material-heading h4,.task-material-picker h5,.task-execution-fact h5{margin:0}.task-material-heading p,.task-execution-fact p{margin:5px 0 0;font-size:12px;line-height:1.55}.task-material-heading-actions{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.task-material-links button,.task-material-links select{min-height:40px;border:1px solid #cfc8ba;border-radius:8px;background:#fff;color:#303733;font:inherit}.task-material-links button{padding:0 11px;cursor:pointer}.task-material-links button:disabled{cursor:not-allowed;opacity:.55}.open-material-picker,.begin-formal-execution,.attach-material{background:#923f30!important;border-color:#923f30!important;color:#fffefa!important}.task-link-list{display:grid;gap:8px}.task-link-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border-radius:9px;background:#f5f2ea}.task-link-row>div:first-child{display:grid;gap:2px;min-width:0}.task-link-actions{display:grid;justify-items:end;gap:5px;flex:0 0 auto}.task-link-row strong,.task-link-row span,.task-link-row small{overflow-wrap:anywhere}.task-link-row span,.task-link-row small{color:#68716b;font-size:12px}.task-link-row.output{border-left:3px solid #4d6b4b}.formal-task-execution{display:grid;gap:10px;padding:14px;border:1px solid #eadfd4;border-radius:12px;background:#fff}.formal-task-execution h5,.formal-task-execution p{margin:0}.formal-inputs{display:grid;gap:8px;margin:0;padding:10px;border:1px solid #ded8cc;border-radius:8px}.formal-inputs label,.formal-confirmation{display:flex;gap:8px;align-items:flex-start;font-size:13px}.formal-inputs input,.formal-confirmation input{width:20px;height:20px;flex:none}.formal-instruction{display:grid;gap:5px;font-size:13px}.formal-instruction textarea{min-height:82px;padding:10px;border:1px solid #cfc8ba;border-radius:8px;font:inherit;font-size:16px;resize:vertical}.formal-risk-note{padding:10px;border-radius:8px;background:#f6eee8;color:#6f493f;font-size:12px;line-height:1.55}.begin-formal-execution{justify-self:stretch;min-height:48px!important;font-weight:600}.formal-execution-actions{display:flex;gap:8px;flex-wrap:wrap}.formal-history{display:grid;gap:7px;margin:0;padding-left:18px}.formal-history button{min-height:32px;text-align:left}.formal-execution-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:0}.formal-execution-facts div{display:grid;gap:2px}.formal-execution-facts dt{font-size:11px;color:#68716b}.formal-execution-facts dd{margin:0;overflow-wrap:anywhere;font-size:12px}.task-execution-fact{padding-top:12px;border-top:1px solid #ded8cc}.task-material-note{color:#68716b}.task-material-error{color:#a1261d}.load-more{justify-self:start}.task-material-picker{--material-ground:#f3f3ed;--material-paper:#fffefa;--material-ink:#242e2b;--material-muted:#68716b;--material-line:#d8d8ce;--material-brand:#923f30;--material-brand-surface:#f6eee8;position:fixed;inset:0;z-index:1200;display:grid;grid-template-rows:auto minmax(0,1fr) auto;box-sizing:border-box;width:100%;height:100%;height:100dvh;background:var(--material-ground);color:var(--material-ink);font:400 14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}.material-picker-header{display:flex;align-items:center;gap:12px;padding:max(12px,env(safe-area-inset-top)) 16px 12px;border-bottom:1px solid var(--material-line);background:var(--material-paper);box-shadow:0 1px 2px rgba(36,46,43,.04)}.material-picker-header>div{min-width:0}.material-picker-header h5{font-size:18px;line-height:1.35}.material-picker-header p{margin:3px 0 0;color:var(--material-muted);font-size:13px;line-height:1.5}.material-picker-back{flex:none;min-width:56px;background:var(--material-paper)!important;border-color:var(--material-line)!important;color:var(--material-ink)!important}.material-picker-body{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:16px max(16px,env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}.workspace-file-list{display:grid;gap:10px}.workspace-file-list button{display:grid;gap:4px;width:100%;min-height:64px;padding:12px 14px;border-color:var(--material-line)!important;border-radius:10px!important;background:var(--material-paper)!important;color:var(--material-ink)!important;text-align:left;box-shadow:0 1px 2px rgba(36,46,43,.04)}.workspace-file-list button.selected{border-color:var(--material-brand)!important;background:var(--material-brand-surface)!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--material-brand) 16%,transparent)}.workspace-file-list small{color:var(--material-muted);overflow-wrap:anywhere}.material-picker-footer{display:grid;gap:10px;padding:12px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));border-top:1px solid var(--material-line);background:var(--material-paper);box-shadow:0 -8px 24px rgba(36,46,43,.08)}.material-picker-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.material-picker-fields label{display:grid;gap:5px;color:var(--material-muted);font-size:12px}.material-picker-fields select{width:100%;min-width:0;padding:0 10px;border-color:var(--material-line)!important;border-radius:8px!important;background:var(--material-paper)!important;color:var(--material-ink)!important}.attach-material,.use-no-material{width:100%;min-height:46px!important;border-radius:8px!important}.attach-material{background:var(--material-brand)!important;border-color:var(--material-brand)!important;color:var(--material-paper)!important}.use-no-material{background:var(--material-paper)!important;border-color:var(--material-line)!important;color:var(--material-ink)!important}.material-picker-footer p{margin:0;color:var(--material-muted);font-size:12px;line-height:1.5}.material-picker-footer .attach-material+.use-no-material{display:none}.task-material-picker button:focus-visible,.task-material-picker select:focus-visible{outline:3px solid color-mix(in srgb,var(--material-brand) 52%,transparent);outline-offset:2px}@media(max-width:620px){.task-material-links{margin-inline:0;padding:12px}.task-material-heading{display:grid}.task-material-heading-actions{justify-content:stretch}.task-material-heading-actions button{flex:1}.task-link-row{align-items:flex-start;flex-direction:column}.task-link-actions{width:100%;grid-template-columns:1fr 1fr;justify-items:stretch}.task-link-actions button{width:100%}.formal-execution-facts{grid-template-columns:1fr}.material-picker-fields{grid-template-columns:1fr}.material-picker-footer{max-height:46dvh;overflow-y:auto}}
</style>
