<template>
  <main class="personal-workspace">
    <header class="workspace-header">
      <div>
        <p class="workspace-eyebrow">个人中心</p>
        <h1>我的工作空间</h1>
        <p>保存自己上传的文件和后续交付件。只有你主动创建私人执行时，当前选定版本才会被授权给已选 Agent。</p>
      </div>
      <button type="button" @click="router.push({ name: 'UserProfile' })">返回个人中心</button>
    </header>

    <section class="workspace-card" aria-labelledby="workspace-upload-title">
      <h2 id="workspace-upload-title">上传文件</h2>
      <p class="workspace-note">支持 PNG、JPEG、纯文本、PDF、DOCX、XLSX、PPTX。图片可直接预览；Office/PDF 提供只读文本预览，原文件始终可下载。当前私人执行仅接受 DOCX，其他格式仍可上传管理。</p>
      <label class="file-picker">
        <span>选择文件</span>
        <input type="file" :accept="acceptTypes" @change="onUploadFile" />
      </label>
      <p v-if="uploadFile" class="selected-file">已选择：{{ uploadFile.name }}（{{ byteText(uploadFile.size) }}）</p>
      <label>
        <span>显示名（可选）</span>
        <input v-model="uploadDisplayName" maxlength="255" placeholder="默认使用原文件名" />
      </label>
      <div class="actions">
        <button type="button" :disabled="!uploadFile || workspace.actionState.value === 'uploading'" @click="upload">
          {{ workspace.actionState.value === 'uploading' ? '上传中…' : '上传到工作空间' }}
        </button>
      </div>
    </section>

    <section class="workspace-card" aria-labelledby="workspace-files-title">
      <div class="section-heading">
        <div><h2 id="workspace-files-title">{{ state === 'TRASHED' ? '回收站' : '我的文件' }}</h2><p>“全部文件”包含本人上传和已归档交付件；来源与执行状态由服务端确认。</p></div>
        <button type="button" :disabled="workspace.loading.value" @click="refresh">刷新</button>
      </div>
      <form class="filters" @submit.prevent="refresh">
        <label><span>搜索</span><input v-model="query" maxlength="100" placeholder="按显示名搜索" /></label>
        <label><span>类型</span><select v-model="mediaFamily"><option value="">全部类型</option><option value="IMAGE">图片</option><option value="TEXT">文本</option><option value="DOCUMENT">Word 文档</option><option value="SPREADSHEET">Excel 表格</option><option value="PRESENTATION">PPT 演示</option><option value="PDF">PDF</option></select></label>
        <div class="filter-actions"><button type="submit">筛选</button><button type="button" :class="{ active: state === 'ACTIVE' }" @click="switchState('ACTIVE')">文件</button><button type="button" :class="{ active: state === 'TRASHED' }" @click="switchState('TRASHED')">回收站</button></div>
      </form>
      <p v-if="workspace.listState.value === 'loading'" role="status">正在读取文件…</p>
      <p v-else-if="workspace.listState.value === 'empty'" class="workspace-empty">{{ state === 'TRASHED' ? '回收站为空。' : '还没有文件。上传后可在这里管理版本和下载。' }}</p>
      <div v-else class="file-list">
        <button
          v-for="file in workspace.items.value"
          :key="file.fileId"
          type="button"
          class="file-row"
          :class="{ selected: selectedId === file.fileId }"
          @click="select(file.fileId)"
        >
          <span class="file-icon" aria-hidden="true">{{ iconFor(file.mediaFamily) }}</span>
          <span class="file-summary"><strong>{{ file.displayName }}</strong><small>版本 {{ file.latestVersion }} · {{ familyText(file.mediaFamily) }} · {{ originText(file.originKind) }} · {{ formatDate(file.createdAt) }}</small></span>
          <span class="file-state">{{ file.state === 'TRASHED' ? '已移入回收站' : originText(file.originKind) }}</span>
        </button>
      </div>
      <button
        v-if="workspace.nextCursor.value"
        type="button"
        class="load-more"
        :disabled="workspace.loading.value"
        @click="loadMore"
      >加载更多</button>
    </section>

    <section v-if="workspace.detail.value?.file.state === 'ACTIVE'" class="workspace-card execution-card" aria-labelledby="workspace-execution-title">
      <div class="section-heading">
        <div><h2 id="workspace-execution-title">交给 Agent 执行</h2><p>受控试行。仅提交当前选择的一个 DOCX 版本给明确 Agent；完成与交付件归档必须由服务端回执确认。</p></div>
        <button type="button" :disabled="execution.rosterState.value === 'loading'" @click="loadExecutionAgents">刷新 Agent</button>
      </div>
      <p class="workspace-note">已选材料：{{ workspace.detail.value.file.displayName }} · v{{ selectedVersion }}<template v-if="selectedExecutionVersion"> · {{ selectedExecutionVersion.contentMimeType }}</template></p>
      <p v-if="!canExecuteSelectedVersion" class="workspace-note">当前受控执行只接受 DOCX；图片、PPT、Excel、PDF 仍可在空间管理，尚未开放给此执行通道。</p>
      <label><span>已有 Agent</span><select :value="execution.selectedAgentId.value" :disabled="execution.rosterState.value === 'loading'" @change="selectExecutionAgent($event.target.value)"><option value="">请选择已有 Agent</option><option v-for="agent in execution.agents.value" :key="agent.agentId" :value="agent.agentId">{{ agent.name }}{{ agent.status ? `（${agent.status}）` : '' }}</option></select></label>
      <p v-if="execution.rosterState.value === 'loading'" role="status">正在读取已有 Agent…</p><p v-else-if="execution.rosterState.value === 'empty'" class="workspace-note">当前没有可选择的 Agent；不会使用演示 Agent 代替。</p><p v-else-if="execution.rosterError.value" class="workspace-error" role="alert">{{ execution.rosterError.value }}</p>
      <label><span>需求说明</span><textarea v-model="executionInstruction" maxlength="4000" placeholder="例如：请按要求处理此文件，并说明保留项。"></textarea></label>
      <div class="actions"><button type="button" :disabled="!canCreateExecution" @click="createExecution">创建私人执行</button></div>
      <section v-if="execution.execution.value" class="execution-status" aria-live="polite"><dl class="file-details"><div><dt>执行状态</dt><dd>{{ execution.execution.value.state }}</dd></div><div><dt>目标 Agent</dt><dd>{{ execution.execution.value.targetAgentId }}</dd></div><div><dt>执行编号</dt><dd>{{ execution.execution.value.executionId }}</dd></div></dl><div class="actions"><button type="button" :disabled="execution.executionState.value === 'creating' || execution.executionState.value === 'revoking'" @click="refreshExecution">刷新进度</button><button type="button" :disabled="execution.executionState.value === 'revoking'" @click="revokeExecutionInputs">撤销尚未开始的输入授权</button></div><p class="workspace-note">撤销请求由服务端确认实际授权与执行状态；已开始的读取不承诺瞬时收回。</p></section>
      <p v-if="execution.completionNotice.value" class="execution-notice" role="status">{{ execution.completionNotice.value }}</p><p v-if="execution.error.value" class="workspace-error" role="alert">{{ execution.error.value }}</p>
    </section>

    <section v-if="workspace.detail.value" class="workspace-card detail-card" aria-labelledby="workspace-detail-title">
      <div class="section-heading">
        <div><h2 id="workspace-detail-title">文件详情</h2><p>当前条目与其历史版本均只属于当前登录用户。</p></div>
        <button type="button" @click="closeDetail">关闭</button>
      </div>
      <dl class="file-details">
        <div><dt>显示名</dt><dd>{{ workspace.detail.value.file.displayName }}</dd></div>
        <div><dt>最新版本</dt><dd>v{{ workspace.detail.value.file.latestVersion }}</dd></div>
        <div><dt>状态</dt><dd>{{ workspace.detail.value.file.state === 'TRASHED' ? '回收站' : '可用' }}</dd></div>
        <div><dt>来源</dt><dd>{{ originText(workspace.detail.value.file.originKind) }}</dd></div>
      </dl>

      <template v-if="workspace.detail.value.file.state === 'ACTIVE'">
        <form class="inline-form" @submit.prevent="rename"><label><span>修改显示名</span><input v-model="renameValue" maxlength="255" /></label><button type="submit" :disabled="workspace.actionState.value === 'saving'">保存名称</button></form>
        <div class="version-upload"><label class="file-picker"><span>追加新版本</span><input type="file" :accept="acceptTypes" @change="onVersionFile" /></label><span v-if="versionFile">将创建 v{{ workspace.detail.value.file.latestVersion + 1 }}：{{ versionFile.name }}</span><button type="button" :disabled="!versionFile || workspace.actionState.value === 'appending-version'" @click="appendVersion">{{ workspace.actionState.value === 'appending-version' ? '保存版本中…' : '上传为新版本' }}</button></div>
      </template>

      <section class="versions" aria-labelledby="workspace-version-title">
        <h3 id="workspace-version-title">版本</h3>
        <div
          v-for="version in workspace.detail.value.versions"
          :key="version.version"
          class="version-row"
          :class="{ active: selectedVersion === version.version }"
        >
          <button type="button" @click="selectedVersion = version.version">v{{ version.version }}</button>
          <span>{{ version.originalFilename }}</span><small>{{ byteText(version.byteLength) }} · {{ formatDate(version.createdAt) }}</small>
          <div class="version-actions"><button type="button" @click="preview(version.version)">预览</button><button type="button" @click="download(version.version)">下载</button></div>
        </div>
      </section>

      <section class="preview" aria-live="polite">
        <p v-if="workspace.actionState.value === 'loading-preview'">正在读取预览…</p>
        <pre v-else-if="workspace.preview.value.kind === 'text'" v-text="workspace.preview.value.text"></pre>
        <p v-if="workspace.preview.value.kind === 'text' && workspace.preview.value.message" class="preview-note">{{ workspace.preview.value.message }}</p>
        <img v-else-if="workspace.preview.value.kind === 'image'" :src="workspace.preview.value.url" :alt="workspace.detail.value.file.displayName" />
        <p v-else-if="workspace.preview.value.kind === 'unsupported'">{{ workspace.preview.value.message }}</p>
        <p v-else-if="workspace.preview.value.kind === 'error'" class="workspace-error">{{ workspace.preview.value.message }}</p>
      </section>

      <div class="danger-zone">
        <template v-if="workspace.detail.value.file.state === 'ACTIVE'"><p>移入回收站后不会永久删除，当前版本和历史版本仍可恢复。</p><button
          type="button"
          class="danger"
          :disabled="workspace.actionState.value === 'saving'"
          @click="trash"
        >移入回收站</button></template>
        <template v-else><p>恢复后重新出现在“我的文件”中；本版没有永久删除。</p><button type="button" :disabled="workspace.actionState.value === 'saving'" @click="restore">恢复文件</button></template>
      </div>
    </section>

    <p v-if="workspace.error.value" class="workspace-error" role="alert">{{ workspace.error.value }}</p>
    <p v-if="workspace.lastOperation.value" class="workspace-receipt" role="status">最近操作：{{ workspace.lastOperation.value.operationId }}（{{ workspace.lastOperation.value.state }}）</p>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApiStore } from '@/stores/api'
import { savePersonalWorkspaceBlob, usePersonalWorkspace } from '@/composables/usePersonalWorkspace'
import { usePersonalWorkspaceExecution } from '@/composables/usePersonalWorkspaceExecution'

const router = useRouter()
const apiStore = useApiStore()
const identityEpoch = computed(() => apiStore.authorizationGeneration)
const workspace = usePersonalWorkspace({ identityEpoch })
const execution = usePersonalWorkspaceExecution({ identityEpoch })
const query = ref('')
const mediaFamily = ref('')
const state = ref('ACTIVE')
const selectedId = ref('')
const selectedVersion = ref(1)
const uploadFile = ref(null)
const versionFile = ref(null)
const uploadDisplayName = ref('')
const renameValue = ref('')
const executionInstruction = ref('')
const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const selectedExecutionVersion = computed(() => workspace.detail.value?.versions?.find(version => version.version === selectedVersion.value) || null)
const canExecuteSelectedVersion = computed(() => selectedExecutionVersion.value?.contentMimeType === WORD_MIME)
const canCreateExecution = computed(() => Boolean(workspace.detail.value?.file?.fileId && selectedVersion.value && canExecuteSelectedVersion.value && execution.selectedAgent.value && executionInstruction.value.trim() && execution.executionState.value !== 'creating'))
const acceptTypes = '.png,.jpg,.jpeg,.txt,.pdf,.docx,.xlsx,.pptx,image/png,image/jpeg,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation'

const byteText = size => Number.isFinite(size) ? size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KiB` : `${(size / (1024 * 1024)).toFixed(1)} MiB` : '大小未知'
const formatDate = value => Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间未知'
const familyText = value => ({ IMAGE: '图片', TEXT: '文本', DOCUMENT: 'Word 文档', SPREADSHEET: 'Excel 表格', PRESENTATION: 'PPT 演示', PDF: 'PDF' })[value] || '文件'
const originText = value => ({ USER_UPLOAD: '本人上传', AGENT_DELIVERY: 'Agent 交付' })[value] || '来源待确认'
const iconFor = value => ({ IMAGE: '🖼', TEXT: '📝', DOCUMENT: '📄', SPREADSHEET: '📊', PRESENTATION: '📽', PDF: '📕' })[value] || '📁'
const currentFilters = () => ({ q: query.value.trim(), mediaFamily: mediaFamily.value, state: state.value })
const refresh = () => workspace.refresh(currentFilters())
const loadMore = () => workspace.loadMore(currentFilters())
const switchState = next => { if (state.value === next) return; state.value = next; closeDetail(); void refresh() }
const onUploadFile = event => { uploadFile.value = event.target.files?.[0] || null }
const onVersionFile = event => { versionFile.value = event.target.files?.[0] || null }
const upload = async () => { const result = await workspace.upload(uploadFile.value, uploadDisplayName.value); if (result) { uploadFile.value = null; uploadDisplayName.value = ''; selectedId.value = result.file.fileId; selectedVersion.value = result.version.version; await refresh() } }
const select = async fileId => { const detail = await workspace.select(fileId); if (detail) { selectedId.value = fileId; selectedVersion.value = detail.latestVersion.version; renameValue.value = detail.file.displayName; versionFile.value = null } }
const closeDetail = () => { selectedId.value = ''; versionFile.value = null; workspace.revokePreview(); workspace.detail.value = null }
const rename = async () => { const result = await workspace.rename(renameValue.value); if (result) renameValue.value = result.displayName }
const appendVersion = async () => { const result = await workspace.appendVersion(versionFile.value); if (result) { versionFile.value = null; selectedVersion.value = result.version.version; await refresh() } }
const preview = version => { selectedVersion.value = version; void workspace.previewVersion(version) }
const download = async version => { const result = await workspace.download(version); if (result) savePersonalWorkspaceBlob(result) }
const trash = async () => { const usage = await workspace.usage(); if (!usage) return; const references = (usage.taskReferences?.length || 0) + (usage.activeExecutions?.length || 0); const message = references ? `该文件仍有 ${references} 个关联引用，确认移入回收站吗？` : '确认将该文件移入回收站吗？'; if (!globalThis.confirm?.(message)) return; const result = await workspace.trash(usage); if (result) { closeDetail(); await refresh() } }
const restore = async () => { const result = await workspace.restore(); if (result) { closeDetail(); await refresh() } }
const loadExecutionAgents = () => execution.loadAgents()
const selectExecutionAgent = agentId => execution.selectAgent(agentId)
const createExecution = () => execution.create({ fileId: workspace.detail.value.file.fileId, version: String(selectedVersion.value), instruction: executionInstruction.value })
const refreshExecution = () => execution.refreshExecution()
const revokeExecutionInputs = () => execution.revokeInputs()

onMounted(() => { void refresh(); void loadExecutionAgents() })
onBeforeUnmount(() => { workspace.dispose(); execution.dispose() })
</script>

<style scoped>
.personal-workspace { flex: 1; overflow: auto; padding: 16px; background: #f7f8fc; color: #1f2937; }
.workspace-header,.workspace-card { max-width: 980px; margin: 0 auto 16px; border: 1px solid #e2e8f0; border-radius: 14px; background: #fff; box-shadow: 0 4px 16px rgba(15,23,42,.06); }
.workspace-header { display: flex; justify-content: space-between; gap: 20px; padding: 20px; }
.workspace-header h1,.workspace-header p,.workspace-card h2,.workspace-card h3 { margin-top: 0; }
.workspace-header h1 { margin-bottom: 6px; }.workspace-header p { margin-bottom: 0; color: #64748b; }.workspace-eyebrow { color: #4f46e5 !important; font-weight: 700; }
.workspace-header button,.workspace-card button { min-height: 38px; padding: 0 12px; border: 1px solid #6366f1; border-radius: 8px; background: #fff; color: #4338ca; cursor: pointer; }
.workspace-header button:hover,.workspace-card button:hover { background: #eef2ff; }.workspace-card button:disabled { cursor: not-allowed; opacity: .6; }.workspace-card { padding: 18px; }
.workspace-note,.section-heading p { color: #64748b; font-size: 14px; }.workspace-card label { display: grid; gap: 6px; margin-top: 12px; color: #475569; font-size: 14px; }
.workspace-card input,.workspace-card select,.workspace-card textarea { min-height: 38px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.workspace-card textarea { min-height: 96px; padding: 10px; resize: vertical; }.file-picker { display: inline-flex !important; width: fit-content; position: relative; overflow: hidden; padding: 9px 12px; border-radius: 8px; background: #eef2ff; color: #3730a3 !important; cursor: pointer; }.file-picker input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.selected-file,.workspace-receipt { color: #475569; font-size: 14px; }.actions,.filter-actions,.version-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }.section-heading { display: flex; justify-content: space-between; gap: 16px; }.section-heading h2 { margin-bottom: 6px; }
.filters { display: grid; grid-template-columns: minmax(0,1fr) 180px auto; align-items: end; gap: 12px; padding: 12px 0; border-top: 1px solid #e2e8f0; }.filter-actions { margin: 0; }.filter-actions .active { background: #4f46e5; color: #fff; }.file-list { display: grid; gap: 8px; }
.file-row { display: grid; grid-template-columns: 32px minmax(0,1fr) auto; align-items: center; width: 100%; text-align: left; border-color: #e2e8f0 !important; color: #1f2937 !important; }.file-row.selected { border-color: #4f46e5 !important; background: #eef2ff !important; }.file-summary { display: grid; min-width: 0; gap: 3px; }.file-summary strong,.file-summary small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.file-summary small,.file-state { color: #64748b; }.file-state { font-size: 12px; }.workspace-empty { padding: 24px 0; color: #64748b; }.load-more { margin-top: 12px; }
.file-details { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 10px; }.file-details div { padding: 10px; border-radius: 8px; background: #f8fafc; }.file-details dt { color: #64748b; font-size: 12px; }.file-details dd { margin: 4px 0 0; word-break: break-word; }.inline-form,.version-upload { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; margin-top: 16px; padding-top: 16px; border-top: 1px solid #e2e8f0; }.inline-form label { flex: 1; min-width: 220px; margin: 0; }.version-upload .file-picker { margin: 0; }
.versions { margin-top: 20px; }.version-row { display: grid; grid-template-columns: auto minmax(0,1fr) auto auto; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #e2e8f0; }.version-row.active { background: #f8fafc; }.version-row > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.version-row small { color: #64748b; }.version-actions { justify-content: flex-end; margin: 0; }
.execution-status { margin-top: 16px; padding-top: 16px; border-top: 1px solid #e2e8f0; }.execution-notice { margin-top: 14px; padding: 12px; border-radius: 8px; background: #ecfdf5; color: #166534; }
.preview { margin-top: 16px; overflow: auto; border-radius: 8px; background: #f8fafc; }.preview pre { margin: 0; padding: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }.preview img { display: block; max-width: 100%; max-height: 460px; margin: auto; object-fit: contain; }.preview p { padding: 12px; color: #64748b; }.preview .preview-note { margin: 0; padding-top: 0; font-size: 13px; }
.danger-zone { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #e2e8f0; }.danger-zone p { margin: 0; color: #64748b; }.danger-zone .danger { border-color: #dc2626; color: #b91c1c; }.workspace-error { max-width: 980px; margin: 0 auto 16px; padding: 12px; border-radius: 8px; background: #fef2f2; color: #b91c1c; }.workspace-receipt { max-width: 980px; margin: 0 auto; }
@media (max-width: 700px) { .workspace-header,.section-heading { align-items: flex-start; flex-direction: column; }.filters { grid-template-columns: 1fr; }.file-details { grid-template-columns: 1fr; }.version-row { grid-template-columns: auto minmax(0,1fr); }.version-row small,.version-actions { grid-column: 2; justify-content: flex-start; }.file-state { display: none; } }
</style>
