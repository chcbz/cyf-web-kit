<template>
  <main class="personal-workspace" :class="{ 'is-hall-treasure': embedded }">
    <header class="workspace-header">
      <div>
        <p class="workspace-eyebrow">聚义厅 · 内堂收纳</p>
        <h1>百宝箱</h1>
        <p>资料、版本和交付件都在这里收纳；选定资料后即可交给 Agent 继续办事。</p>
      </div>
      <p class="workspace-header-note">资料只在你明确提交时，才会授权给所选 Agent。</p>
    </header>

    <section class="treasure-workbench" aria-label="百宝箱工作台">
      <div class="workbench-toolbar">
        <div class="toolbar-copy">
          <strong>收纳、调用、交付</strong>
          <span>先放入资料，再从右侧发起交付；文件详情会在下方接续展开。</span>
        </div>
        <div class="toolbar-upload">
          <label class="file-picker">
            <span>添入资料</span>
            <input type="file" :accept="acceptTypes" @change="onUploadFile" />
          </label>
          <label class="inline-name">
            <span class="sr-only">显示名（可选）</span>
            <input v-model="uploadDisplayName" maxlength="255" placeholder="显示名（可选）" />
          </label>
          <button type="button" :disabled="!uploadFile || workspace.actionState.value === 'uploading'" @click="upload">
            {{ workspace.actionState.value === 'uploading' ? '收入箱中…' : '收入百宝箱' }}
          </button>
        </div>
        <p v-if="uploadFile" class="selected-file">待收入：{{ uploadFile.name }}（{{ byteText(uploadFile.size) }}）</p>
      </div>

      <div class="workbench-layout">
        <section class="workbench-library" aria-labelledby="workspace-files-title">
          <div class="section-heading">
            <div>
              <p class="section-kicker">资料柜</p>
              <h2 id="workspace-files-title">{{ state === 'TRASHED' ? '回收站' : '我的文件' }}</h2>
              <p>本人上传和已归档交付件统一按版本保管。</p>
            </div>
            <button
              type="button"
              class="quiet-action"
              :disabled="workspace.loading.value"
              @click="refresh"
            >刷新</button>
          </div>
          <form class="filters" @submit.prevent="refresh">
            <label><span>搜索</span><input v-model="query" maxlength="100" placeholder="按显示名搜索" /></label>
            <label><span>类型</span><select v-model="mediaFamily"><option value="">全部类型</option><option value="IMAGE">图片</option><option value="TEXT">文本</option><option value="DOCUMENT">Word 文档</option><option value="SPREADSHEET">Excel 表格</option><option value="PRESENTATION">PPT 演示</option><option value="PDF">PDF</option></select></label>
            <div class="filter-actions"><button type="submit">筛选</button><button type="button" :class="{ active: state === 'ACTIVE' }" @click="switchState('ACTIVE')">文件</button><button type="button" :class="{ active: state === 'TRASHED' }" @click="switchState('TRASHED')">回收站</button></div>
          </form>
          <p v-if="workspace.listState.value === 'loading'" class="workspace-note" role="status">正在翻看资料…</p>
          <p v-else-if="workspace.listState.value === 'empty'" class="workspace-empty">{{ state === 'TRASHED' ? '回收站为空。' : '还没有文件。先添入一份资料，或直接发起交付。' }}</p>
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
            class="load-more quiet-action"
            :disabled="workspace.loading.value"
            @click="loadMore"
          >加载更多</button>
        </section>

        <section class="workbench-composer" aria-labelledby="workspace-generation-title">
          <div class="section-heading">
            <div>
              <p class="section-kicker">交付台</p>
              <h2 id="workspace-generation-title">直接生成交付件</h2>
              <p>无需先上传；可用类型、执行与归档均以服务端回执为准。</p>
            </div>
            <button
              type="button"
              class="quiet-action"
              :disabled="execution.capabilityState.value === 'loading'"
              @click="loadExecutionCapabilities"
            >刷新能力</button>
          </div>
          <p v-if="execution.capabilityState.value === 'loading'" class="workspace-note">正在读取可执行交付类型…</p>
          <p v-else-if="execution.capabilityError.value" class="workspace-error" role="alert">{{ execution.capabilityError.value }}</p>
          <template v-else-if="execution.allowedMimeTypes.value.length">
            <label><span>交付类型</span><select v-model="generationMime"><option v-for="mime in execution.allowedMimeTypes.value" :key="mime" :value="mime">{{ deliveryTypeText(mime) }}</option></select></label>
            <label><span>已有 Agent</span><select :value="execution.selectedAgentId.value" :disabled="execution.rosterState.value === 'loading'" @change="selectExecutionAgent($event.target.value)"><option value="">请选择已有 Agent</option><option v-for="agent in execution.agents.value" :key="agent.agentId" :value="agent.agentId">{{ agent.name }}{{ agent.status ? `（${agent.status}）` : '' }}</option></select></label>
            <label><span>需求说明</span><textarea v-model="generationInstruction" maxlength="4000" placeholder="例如：生成一份面向客户的项目介绍 PPT，包含目标、方案和时间表。"></textarea></label>
            <p class="workspace-note consent-note">提交会将本轮需求交给所选 Agent 及其配置的 Provider；资料可能外发并产生费用，费用未知。</p>
            <div class="actions"><button type="button" :disabled="!canCreateGeneration" @click="createGeneration">生成交付件</button></div>
          </template>
          <p v-else class="workspace-note">当前没有已确认开放的直接生成类型，不会用演示内容代替。</p>
        </section>
      </div>

      <section v-if="workspace.detail.value" class="workbench-detail" aria-labelledby="workspace-detail-title">
        <div class="section-heading detail-heading">
          <div>
            <p class="section-kicker">已取出的资料</p>
            <h2 id="workspace-detail-title">{{ workspace.detail.value.file.displayName }}</h2>
            <p>当前条目与其历史版本均只属于当前登录用户。</p>
          </div>
          <button type="button" class="quiet-action" @click="closeDetail">收起详情</button>
        </div>

        <dl class="file-details">
          <div><dt>最新版本</dt><dd>v{{ workspace.detail.value.file.latestVersion }}</dd></div>
          <div><dt>状态</dt><dd>{{ workspace.detail.value.file.state === 'TRASHED' ? '回收站' : '可用' }}</dd></div>
          <div><dt>来源</dt><dd>{{ originText(workspace.detail.value.file.originKind) }}</dd></div>
        </dl>

        <template v-if="workspace.detail.value.file.state === 'ACTIVE'">
          <div class="detail-maintenance">
            <form class="inline-form" @submit.prevent="rename"><label><span>显示名</span><input v-model="renameValue" maxlength="255" /></label><button type="submit" :disabled="workspace.actionState.value === 'saving'">保存名称</button></form>
            <div class="version-upload"><label class="file-picker"><span>追加新版本</span><input type="file" :accept="acceptTypes" @change="onVersionFile" /></label><span v-if="versionFile">将创建 v{{ workspace.detail.value.file.latestVersion + 1 }}：{{ versionFile.name }}</span><button type="button" :disabled="!versionFile || workspace.actionState.value === 'appending-version'" @click="appendVersion">{{ workspace.actionState.value === 'appending-version' ? '保存版本中…' : '上传为新版本' }}</button></div>
          </div>
        </template>

        <section class="versions" aria-labelledby="workspace-version-title">
          <h3 id="workspace-version-title">版本与查看</h3>
          <div
            v-for="version in workspace.detail.value.versions"
            :key="version.version"
            class="version-row"
            :class="{ active: selectedVersion === version.version }"
          >
            <button type="button" @click="selectedVersion = version.version">v{{ version.version }}</button>
            <span>{{ version.originalFilename }}</span><small>{{ byteText(version.byteLength) }} · {{ formatDate(version.createdAt) }}</small>
            <div class="version-actions"><button type="button" :disabled="!canAddVersionAsMaterial(version)" @click="addExecutionMaterial({ fileId: workspace.detail.value.file.fileId, version: version.version, displayName: workspace.detail.value.file.displayName, contentMimeType: version.contentMimeType })">{{ isExecutionMaterial(workspace.detail.value.file.fileId) ? '已选资料' : '加入资料' }}</button><button type="button" @click="preview(version.version)">预览</button><button type="button" @click="download(version.version)">下载</button></div>
          </div>
        </section>

        <section class="preview" aria-live="polite">
          <p v-if="workspace.actionState.value === 'loading-preview'">正在读取预览…</p>
          <template v-else-if="workspace.preview.value.kind === 'parts'">
            <div class="preview-navigation" aria-label="预览分片导航"><button type="button" :disabled="workspace.preview.value.selectedIndex === 0" @click="workspace.selectPreviewPart(workspace.preview.value.selectedIndex - 1)">上一页</button><span>第 {{ workspace.preview.value.selectedIndex + 1 }} / {{ workspace.preview.value.parts.length }} {{ selectedPreviewPart?.kind === 'text' ? '项' : '页' }}</span><button type="button" :disabled="workspace.preview.value.selectedIndex >= workspace.preview.value.parts.length - 1" @click="workspace.selectPreviewPart(workspace.preview.value.selectedIndex + 1)">下一页</button></div>
            <pre v-if="selectedPreviewPart?.kind === 'text'" v-text="selectedPreviewPart.text"></pre>
            <img v-else-if="selectedPreviewPart?.kind === 'image'" :src="selectedPreviewPart.url" :alt="`${workspace.detail.value.file.displayName} 第 ${workspace.preview.value.selectedIndex + 1} 页`" />
            <p v-if="workspace.preview.value.message" class="preview-note">{{ workspace.preview.value.message }}</p>
          </template>
          <pre v-else-if="workspace.preview.value.kind === 'text'" v-text="workspace.preview.value.text"></pre>
          <p v-if="['text', 'image'].includes(workspace.preview.value.kind) && workspace.preview.value.message" class="preview-note">{{ workspace.preview.value.message }}</p>
          <img v-else-if="workspace.preview.value.kind === 'image'" :src="workspace.preview.value.url" :alt="workspace.detail.value.file.displayName" />
          <p v-else-if="workspace.preview.value.kind === 'unsupported'">{{ workspace.preview.value.message }}</p>
          <p v-else-if="workspace.preview.value.kind === 'error'" class="workspace-error">{{ workspace.preview.value.message }}</p>
        </section>

        <section v-if="workspace.detail.value.file.state === 'ACTIVE'" class="detail-execution" aria-labelledby="workspace-execution-title">
          <div class="section-heading"><div><p class="section-kicker">办事笺</p><h3 id="workspace-execution-title">交给 Agent 执行</h3><p>只提交你加入的固定版本资料；未列入的其他文件不会被读取。</p></div><button
            type="button"
            class="quiet-action"
            :disabled="execution.rosterState.value === 'loading'"
            @click="loadExecutionAgents"
          >刷新 Agent</button></div>
          <p class="workspace-note">当前版本：{{ workspace.detail.value.file.displayName }} · v{{ selectedVersion }}<template v-if="selectedExecutionVersion"> · {{ selectedExecutionVersion.contentMimeType }}</template></p>
          <div class="material-actions"><button type="button" :disabled="!canAddSelectedMaterial" @click="addSelectedMaterial">加入执行资料</button><button
            v-for="item in executionMaterials"
            :key="item.fileId"
            type="button"
            @click="removeExecutionMaterial(item.fileId)"
          >{{ materialLabel(item) }} ×</button></div>
          <p v-if="!executionMaterials.length" class="workspace-note">请从版本列表将至少一份资料加入本次执行；同一文件仅能选择一个固定版本。</p>
          <p v-else class="workspace-note">本次已授权 {{ executionMaterials.length }} 份固定版本资料。</p>
          <p v-if="!canExecuteSelectedVersion" class="workspace-note">当前文件类型未被服务端确认可作为本次执行资料；文件仍可在空间管理和下载。</p>
          <div class="execution-form"><label><span>已有 Agent</span><select :value="execution.selectedAgentId.value" :disabled="execution.rosterState.value === 'loading'" @change="selectExecutionAgent($event.target.value)"><option value="">请选择已有 Agent</option><option v-for="agent in execution.agents.value" :key="agent.agentId" :value="agent.agentId">{{ agent.name }}{{ agent.status ? `（${agent.status}）` : '' }}</option></select></label><label><span>交付类型</span><select v-model="executionOutputMime"><option v-for="mime in execution.allowedMimeTypes.value" :key="mime" :value="mime">{{ deliveryTypeText(mime) }}</option></select></label></div>
          <label><span>需求说明</span><textarea v-model="executionInstruction" maxlength="4000" placeholder="例如：请根据所选资料制作 PPT，或按要求修改指定文件，并说明保留项。"></textarea></label>
          <p v-if="execution.rosterState.value === 'loading'" class="workspace-note" role="status">正在读取已有 Agent…</p><p v-else-if="execution.rosterState.value === 'empty'" class="workspace-note">当前没有可选择的 Agent；不会使用演示 Agent 代替。</p><p v-else-if="execution.rosterError.value" class="workspace-error" role="alert">{{ execution.rosterError.value }}</p>
          <div class="actions"><button type="button" :disabled="!canCreateExecution" @click="createExecution">创建私人执行</button></div>
          <section v-if="execution.execution.value" class="execution-status" aria-live="polite"><dl class="file-details"><div><dt>执行状态</dt><dd>{{ execution.execution.value.state }}</dd></div><div><dt>目标 Agent</dt><dd>{{ execution.execution.value.targetAgentId }}</dd></div><div><dt>执行编号</dt><dd>{{ execution.execution.value.executionId }}</dd></div><div v-if="execution.execution.value.failureCode"><dt>失败说明</dt><dd>{{ execution.execution.value.failureMessage }}</dd></div></dl><div class="actions"><button type="button" :disabled="execution.executionState.value === 'creating' || execution.executionState.value === 'revoking'" @click="refreshExecution">刷新进度</button><button type="button" :disabled="execution.executionState.value === 'revoking' || execution.execution.value.state !== 'QUEUED'" @click="revokeExecutionInputs">撤销尚未开始的输入授权</button></div></section>
          <p v-if="execution.completionNotice.value" class="execution-notice" role="status">{{ execution.completionNotice.value }}</p><p v-if="execution.error.value" class="workspace-error" role="alert">{{ execution.error.value }}</p>
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
    </section>

    <p v-if="workspace.error.value" class="workspace-error workspace-page-message" role="alert">{{ workspace.error.value }}</p>
    <p v-if="workspace.lastOperation.value" class="workspace-receipt" role="status">最近操作：{{ workspace.lastOperation.value.operationId }}（{{ workspace.lastOperation.value.state }}）</p>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useApiStore } from '@/stores/api'
import { savePersonalWorkspaceBlob, usePersonalWorkspace } from '@/composables/usePersonalWorkspace'
import { usePersonalWorkspaceExecution } from '@/composables/usePersonalWorkspaceExecution'

const { embedded } = defineProps({ embedded: { type: Boolean, default: false } })
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
const generationInstruction = ref('')
const generationMime = ref('')
const executionOutputMime = ref('')
const executionMaterials = ref([])
const selectedExecutionVersion = computed(() => workspace.detail.value?.versions?.find(version => version.version === selectedVersion.value) || null)
const canExecuteSelectedVersion = computed(() => Boolean(selectedExecutionVersion.value?.contentMimeType && execution.inputMimeTypes.value.includes(selectedExecutionVersion.value.contentMimeType)))
const canAddSelectedMaterial = computed(() => Boolean(workspace.detail.value?.file?.fileId && selectedExecutionVersion.value && canExecuteSelectedVersion.value && !executionMaterials.value.some(item => item.fileId === workspace.detail.value.file.fileId)))
const canCreateExecution = computed(() => Boolean(executionMaterials.value.length && executionOutputMime.value && execution.allowedMimeTypes.value.includes(executionOutputMime.value) && execution.selectedAgent.value && executionInstruction.value.trim() && execution.executionState.value !== 'creating'))
const canCreateGeneration = computed(() => Boolean(execution.generationEnabled.value && generationMime.value && execution.allowedMimeTypes.value.includes(generationMime.value) && execution.selectedAgent.value && generationInstruction.value.trim() && execution.executionState.value !== 'creating'))
const acceptTypes = '.png,.jpg,.jpeg,.txt,.pdf,.docx,.xlsx,.pptx,image/png,image/jpeg,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation'

const byteText = size => Number.isFinite(size) ? size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KiB` : `${(size / (1024 * 1024)).toFixed(1)} MiB` : '大小未知'
const formatDate = value => Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间未知'
const familyText = value => ({ IMAGE: '图片', TEXT: '文本', DOCUMENT: 'Word 文档', SPREADSHEET: 'Excel 表格', PRESENTATION: 'PPT 演示', PDF: 'PDF' })[value] || '文件'
const originText = value => ({ USER_UPLOAD: '本人上传', AGENT_DELIVERY: 'Agent 交付' })[value] || '来源待确认'
const deliveryTypeText = value => ({ 'image/png': 'PNG 图片', 'image/jpeg': 'JPEG 图片', 'application/pdf': 'PDF', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word（DOCX）', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel（XLSX）', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPT（PPTX）' })[value] || '未知交付类型'
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
const selectedPreviewPart = computed(() => workspace.preview.value?.parts?.[workspace.preview.value?.selectedIndex] || null)
const preview = version => { selectedVersion.value = version; void workspace.previewVersion(version) }
const download = async version => { const result = await workspace.download(version); if (result) savePersonalWorkspaceBlob(result) }
const trash = async () => { const usage = await workspace.usage(); if (!usage) return; const references = (usage.taskReferences?.length || 0) + (usage.activeExecutions?.length || 0); const message = references ? `该文件仍有 ${references} 个关联引用，确认移入回收站吗？` : '确认将该文件移入回收站吗？'; if (!globalThis.confirm?.(message)) return; const result = await workspace.trash(usage); if (result) { closeDetail(); await refresh() } }
const restore = async () => { const result = await workspace.restore(); if (result) { closeDetail(); await refresh() } }
const loadExecutionAgents = () => execution.loadAgents()
const loadExecutionCapabilities = async () => {
  const result = await execution.loadCapabilities()
  if (result?.allowedMimeTypes?.length) {
    if (!result.allowedMimeTypes.includes(generationMime.value)) generationMime.value = result.allowedMimeTypes[0]
    if (!result.allowedMimeTypes.includes(executionOutputMime.value)) executionOutputMime.value = result.allowedMimeTypes[0]
  }
}
const selectExecutionAgent = agentId => execution.selectAgent(agentId)
const materialLabel = item => `${item.displayName || item.fileId} · v${item.version}`
const isExecutionMaterial = fileId => executionMaterials.value.some(item => item.fileId === fileId)
const canAddVersionAsMaterial = version => Boolean(version?.contentMimeType && execution.inputMimeTypes.value.includes(version.contentMimeType) && !isExecutionMaterial(workspace.detail.value.file.fileId))
const addExecutionMaterial = item => { if (!item?.fileId || !Number.isSafeInteger(Number(item.version)) || isExecutionMaterial(item.fileId) || !execution.inputMimeTypes.value.includes(item.contentMimeType)) return; executionMaterials.value = [...executionMaterials.value, { fileId: item.fileId, version: String(item.version), displayName: item.displayName, contentMimeType: item.contentMimeType }]; if (!executionOutputMime.value) executionOutputMime.value = execution.allowedMimeTypes.value[0] || '' }
const addSelectedMaterial = () => addExecutionMaterial({ fileId: workspace.detail.value.file.fileId, version: selectedVersion.value, displayName: workspace.detail.value.file.displayName, contentMimeType: selectedExecutionVersion.value?.contentMimeType })
const removeExecutionMaterial = fileId => { executionMaterials.value = executionMaterials.value.filter(item => item.fileId !== fileId) }
const createExecution = () => execution.create({ inputs: executionMaterials.value.map(({ fileId, version }) => ({ fileId, version })), instruction: executionInstruction.value, outputContentMimeType: executionOutputMime.value })
const createGeneration = () => execution.create({ instruction: generationInstruction.value, outputContentMimeType: generationMime.value })
const refreshExecution = () => execution.refreshExecution()
const revokeExecutionInputs = () => execution.revokeInputs()

onMounted(() => { void refresh(); void loadExecutionAgents(); void loadExecutionCapabilities() })
onBeforeUnmount(() => { workspace.dispose(); execution.dispose() })
</script>

<style scoped>
.personal-workspace {
  --treasure-ink: #3f2818;
  --treasure-muted: #806542;
  --treasure-wood: #6d3f1f;
  --treasure-wood-dark: #452817;
  --treasure-line: #d7c3a2;
  --treasure-paper: #fff8e8;
  --treasure-paper-deep: #f1dfba;
  --treasure-red: #8c2f20;
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 20px;
  color: var(--treasure-ink);
  background: radial-gradient(circle at 14% 0, rgba(255,255,255,.7), transparent 27%), linear-gradient(135deg, rgba(114,70,35,.12), transparent 36%), #e7d5b5;
}
.personal-workspace.is-hall-treasure { border-top: 2px solid rgba(109,63,31,.5); box-shadow: inset 0 10px 22px rgba(64,37,20,.1); }
.workspace-header,
.treasure-workbench,
.workspace-page-message,
.workspace-receipt { max-width: 1080px; margin-inline: auto; }
.workspace-header { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding: 8px 4px 18px; }
.workspace-header h1 { margin: 5px 0; color: var(--treasure-wood-dark); font-family: serif; font-size: clamp(26px, 4vw, 34px); letter-spacing: .16em; }
.workspace-header p { margin: 0; color: var(--treasure-muted); line-height: 1.65; }
.workspace-eyebrow,.section-kicker { color: var(--treasure-red) !important; font-size: 12px; font-weight: 700; letter-spacing: .12em; }
.workspace-header-note { max-width: 260px; padding-left: 15px; border-left: 2px solid #b88940; font-size: 13px; }
.treasure-workbench { overflow: hidden; border: 1px solid var(--treasure-line); border-radius: 7px; background: linear-gradient(90deg, rgba(136,90,45,.06) 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(rgba(136,90,45,.04) 1px, transparent 1px) 0 0 / 28px 28px, var(--treasure-paper); box-shadow: 0 4px 0 rgba(86,47,25,.12), 0 12px 28px rgba(65,39,21,.14); }
.workbench-toolbar { display: grid; grid-template-columns: minmax(220px,1fr) auto; gap: 12px 20px; align-items: center; padding: 18px 22px; border-bottom: 1px solid var(--treasure-line); background: linear-gradient(90deg, rgba(112,70,33,.1), transparent 48%); }
.toolbar-copy { display: grid; gap: 4px; }.toolbar-copy strong { color: var(--treasure-wood-dark); font-family: serif; font-size: 18px; letter-spacing: .06em; }.toolbar-copy span,.workspace-note,.section-heading p { color: var(--treasure-muted); font-size: 13px; line-height: 1.65; }
.toolbar-upload { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }.selected-file { grid-column: 1 / -1; margin: -3px 0 0; color: #694b2a; font-size: 13px; }
.workbench-layout { display: grid; grid-template-columns: minmax(0,1.55fr) minmax(300px,.9fr); }
.workbench-library,.workbench-composer,.workbench-detail { padding: 22px; }
.workbench-composer { border-left: 1px solid var(--treasure-line); background: rgba(244,230,201,.34); }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }.section-heading h2,.section-heading h3 { margin: 3px 0 5px; color: var(--treasure-wood-dark); font-family: serif; letter-spacing: .06em; }.section-heading p { margin: 0; }.section-kicker { margin: 0; }
.personal-workspace button { min-height: 35px; padding: 0 11px; border: 1px solid #56331b; border-radius: 5px; background: linear-gradient(#82502a, var(--treasure-wood)); box-shadow: inset 0 1px rgba(255,239,194,.3), 0 1px 1px rgba(74,42,20,.24); color: #fff8e8; cursor: pointer; font: inherit; }.personal-workspace button:hover { background: linear-gradient(#956033, #59331b); }.personal-workspace button:disabled { cursor: not-allowed; opacity: .58; }.personal-workspace button:focus-visible,.personal-workspace input:focus-visible,.personal-workspace select:focus-visible,.personal-workspace textarea:focus-visible { outline: 2px solid #bd8633; outline-offset: 2px; }
.quiet-action { border-color: #b99761 !important; background: rgba(255,248,232,.8) !important; box-shadow: none !important; color: #654122 !important; }.quiet-action:hover { background: #f1dfb6 !important; }
.personal-workspace label { display: grid; gap: 6px; margin-top: 14px; color: #644526; font-size: 13px; font-weight: 700; }.personal-workspace input,.personal-workspace select,.personal-workspace textarea { min-height: 37px; padding: 0 10px; border: 1px solid #c5a978; border-radius: 4px; background: rgba(255,253,246,.9); box-shadow: inset 0 1px 3px rgba(88,51,25,.1); color: var(--treasure-ink); font: inherit; }.personal-workspace textarea { min-height: 104px; padding: 10px; resize: vertical; }
.file-picker { display: inline-flex !important; width: fit-content; position: relative; overflow: hidden; margin: 0 !important; padding: 8px 11px; border: 1px dashed #9a6d36; border-radius: 4px; background: #f5e8c7; color: #5a3519 !important; cursor: pointer; }.file-picker:hover { background: #ecd7a8; }.file-picker input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }.inline-name { display: block !important; margin: 0 !important; }.inline-name input { width: min(190px, 36vw); }
.filters { display: grid; grid-template-columns: minmax(0,1fr) 150px auto; align-items: end; gap: 10px; margin: 15px 0 10px; padding: 12px 0; border-top: 1px solid rgba(191,159,108,.5); border-bottom: 1px solid rgba(191,159,108,.5); }.filters label { margin: 0; }.filter-actions,.actions,.version-actions,.material-actions { display: flex; flex-wrap: wrap; gap: 7px; }.filter-actions { align-items: end; }.filter-actions .active { border-color: #412516; background: #442717; color: #fff8e8; }
.file-list { display: grid; gap: 7px; }.file-row { display: grid; grid-template-columns: 30px minmax(0,1fr) auto; align-items: center; width: 100%; border-color: #dac69f !important; background: rgba(255,253,246,.56) !important; color: var(--treasure-ink) !important; text-align: left; }.file-row:hover { border-color: #a8773a !important; background: #f7e9ca !important; }.file-row.selected { border-color: #8b5a2b !important; background: #f1dfb6 !important; box-shadow: inset 4px 0 #8c2f20; }.file-icon { color: var(--treasure-red); font-size: 17px; }.file-summary { display: grid; min-width: 0; gap: 3px; }.file-summary strong,.file-summary small,.version-row > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.file-summary strong { color: #4b2d19; }.file-summary small,.file-state,.version-row small { color: var(--treasure-muted); }.file-state { font-size: 12px; }.workspace-empty { padding: 25px 0; color: var(--treasure-muted); }.load-more { margin-top: 11px; }
.consent-note { padding-left: 10px; border-left: 2px solid #c59a55; }.actions { margin-top: 14px; }.workbench-detail { border-top: 1px solid var(--treasure-line); background: linear-gradient(90deg, rgba(244,230,201,.38), transparent 65%); }.detail-heading { padding-bottom: 15px; border-bottom: 1px solid rgba(191,159,108,.5); }.file-details { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; margin: 15px 0; }.file-details div { padding: 9px; border: 1px solid rgba(202,177,130,.5); border-radius: 4px; background: rgba(244,230,201,.62); }.file-details dt { color: var(--treasure-muted); font-size: 12px; }.file-details dd { margin: 4px 0 0; color: #4b2d19; word-break: break-word; }
.detail-maintenance { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 14px; padding-bottom: 15px; border-bottom: 1px solid rgba(191,159,108,.5); }.inline-form,.version-upload { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; }.inline-form label { flex: 1; min-width: 180px; margin: 0; }.version-upload { align-items: center; }.versions { margin-top: 18px; }.versions h3 { margin: 0 0 8px; color: #58361e; font-family: serif; }.version-row { display: grid; grid-template-columns: auto minmax(0,1fr) auto auto; align-items: center; gap: 9px; padding: 9px 0; border-bottom: 1px solid #decba7; }.version-row.active { margin-inline: -8px; padding-inline: 8px; background: #f2e1b9; }.version-actions { justify-content: flex-end; }
.preview { margin-top: 15px; overflow: auto; border: 1px solid #d4bc91; border-radius: 4px; background: #f5e8cc; }.preview pre { margin: 0; padding: 12px; white-space: pre-wrap; overflow-wrap: anywhere; color: #4d301d; }.preview img { display: block; max-width: 100%; max-height: 460px; margin: auto; object-fit: contain; }.preview p { padding: 12px; color: var(--treasure-muted); }.preview .preview-note { margin: 0; padding-top: 0; font-size: 13px; }.preview-navigation { display: flex; align-items: center; gap: 8px; padding: 10px 12px 0; color: #654122; }.preview-navigation button { min-height: 30px; padding: 0 8px; }
.detail-execution { margin-top: 20px; padding-top: 18px; border-top: 1px solid rgba(191,159,108,.6); }.execution-form { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }.execution-form label { min-width: 0; }.material-actions { margin: 10px 0; }.execution-status { margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--treasure-line); }.execution-notice { margin-top: 14px; padding: 11px; border: 1px solid #9da877; border-radius: 4px; background: #e8efd6; color: #405322; }.danger-zone { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--treasure-line); }.danger-zone p { margin: 0; color: var(--treasure-muted); }.danger-zone .danger { border-color: #76271c; background: linear-gradient(#9d3e2b, var(--treasure-red)); }
.workspace-error { padding: 11px; border: 1px solid #c88174; border-radius: 4px; background: #f7e1d9; color: #7e271c; }.workspace-page-message { margin-top: 14px; }.workspace-receipt { margin-top: 12px; padding: 8px 12px; border-left: 3px solid #b88940; background: rgba(255,248,232,.72); color: #694b2a; font-size: 14px; }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@media (max-width: 800px) { .workbench-layout { grid-template-columns: 1fr; }.workbench-composer { border-top: 1px solid var(--treasure-line); border-left: 0; }.toolbar-upload { justify-content: flex-start; }.detail-maintenance { grid-template-columns: 1fr; }.execution-form { grid-template-columns: 1fr; } }
@media (max-width: 620px) { .personal-workspace { padding: 13px; }.workspace-header { align-items: flex-start; flex-direction: column; gap: 7px; }.workspace-header-note { max-width: none; }.workbench-toolbar,.workbench-library,.workbench-composer,.workbench-detail { padding: 16px; }.workbench-toolbar { grid-template-columns: 1fr; }.toolbar-upload { align-items: stretch; }.toolbar-upload > button { flex: 1; }.inline-name input { width: 100%; }.filters { grid-template-columns: 1fr; }.file-details { grid-template-columns: 1fr; }.version-row { grid-template-columns: auto minmax(0,1fr); }.version-row small,.version-actions { grid-column: 2; justify-content: flex-start; }.file-state { display: none; } }
</style>
