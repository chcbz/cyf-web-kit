<template>
  <section class="task-material-links" aria-labelledby="task-material-links-title">
    <div class="task-material-heading">
      <div>
        <h4 id="task-material-links-title">资料与成果</h4>
        <p>资料关联只固定当前文件版本，不会启动 Agent 执行或改变悬赏交付状态。</p>
      </div>
      <button type="button" @click="refresh">刷新资料</button>
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

    <section class="task-material-picker" aria-labelledby="task-material-picker-title">
      <div>
        <h5 id="task-material-picker-title">从工作空间添加资料</h5>
        <p>先选自己的文件，再选精确版本与用途。回收站文件不会显示为可选资料。</p>
      </div>
      <p v-if="workspace.listState.value === 'loading'" class="task-material-note" role="status">正在读取工作空间…</p>
      <p v-else-if="workspace.error.value" class="task-material-error" role="alert">{{ workspace.error.value }}</p>
      <div v-else-if="workspace.items.value.length" class="workspace-file-list">
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
      <p v-else-if="workspace.listState.value === 'empty'" class="task-material-note">工作空间没有可关联文件；不会用演示资料代替。</p>
      <button v-if="workspace.nextCursor.value" type="button" class="load-more" :disabled="workspace.loading.value" @click="workspace.loadMore({ state: 'ACTIVE' })">读取更多文件</button>

      <template v-if="workspace.detail.value?.file?.state === 'ACTIVE'">
        <label><span>文件版本</span><select v-model.number="selectedVersion"><option v-for="version in workspace.detail.value.versions" :key="version.version" :value="version.version">v{{ version.version }} · {{ version.originalFilename }}</option></select></label>
        <label><span>资料用途</span><select v-model="selectedRole"><option value="INPUT">输入资料</option><option value="REFERENCE">参考资料</option></select></label>
        <button type="button" class="attach-material" :disabled="!canAttach" @click="attach">关联此精确版本</button>
      </template>
      <p v-if="links.actionState.value === 'saving'" class="task-material-note" role="status">正在确认关联…</p>
      <p v-else-if="links.error.value && links.actionState.value === 'error'" class="task-material-error" role="alert">{{ links.error.value }}</p>
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

const props = defineProps({
  taskId: { type: String, required: true },
  identityEpoch: { type: [Number, String], default: 0 }
})

const selectedFileId = ref('')
const selectedVersion = ref(null)
const selectedRole = ref('INPUT')
const workspace = usePersonalWorkspace({ identityEpoch: () => props.identityEpoch })
const links = usePersonalWorkspaceTaskLinks({ taskId: () => props.taskId, identityEpoch: () => props.identityEpoch })
const selectedFile = computed(() => workspace.detail.value?.file?.fileId === selectedFileId.value ? workspace.detail.value.file : null)
const canAttach = computed(() => Boolean(selectedFile.value?.state === 'ACTIVE' && Number.isSafeInteger(selectedVersion.value) && selectedVersion.value > 0 && links.actionState.value !== 'saving'))
const outputLinks = computed(() => links.links.value.filter(link => link.state === 'ACTIVE' && link.role === 'OUTPUT'))
const executionFact = computed(() => {
  if (links.listState.value === 'error') return '资料关联目录不可用，当前不能确认执行或成果状态。'
  if (outputLinks.value.length) return `已读取 ${outputLinks.value.length} 条 OUTPUT 关联；它们是执行流程记录的成果引用，正式交付状态仍需以正式交付回执确认。`
  return '当前已接入的 file-links 合同只提供资料关联，不提供 execution 或 deliverable 查询；尚不能确认本悬赏已有执行或交付。'
})

const roleText = role => ({ INPUT: '输入资料', REFERENCE: '参考资料', OUTPUT: '成果引用' })[role] || '未知用途'
const resetSelection = () => { selectedFileId.value = ''; selectedVersion.value = null; selectedRole.value = 'INPUT' }
const refresh = () => { void workspace.refresh({ state: 'ACTIVE' }); void links.load() }
const selectFile = async fileId => {
  const detail = await workspace.select(fileId)
  if (!detail || detail.file.state !== 'ACTIVE') return
  selectedFileId.value = detail.file.fileId
  selectedVersion.value = detail.latestVersion.version
}
const openLinkedFile = async link => {
  const detail = await workspace.select(link.fileId)
  if (!detail || detail.file.state !== 'ACTIVE') return
  selectedFileId.value = detail.file.fileId
  selectedVersion.value = detail.versions.some(version => version.version === link.version) ? link.version : null
}
const attach = async () => {
  if (!canAttach.value) return
  const saved = await links.attach({ fileId: selectedFile.value.fileId, version: selectedVersion.value, role: selectedRole.value })
  if (saved) resetSelection()
}
const detach = link => { void links.detach(link) }

watch(() => `${props.identityEpoch}\u0000${props.taskId}`, resetSelection, { flush: 'sync' })
onMounted(refresh)
onBeforeUnmount(() => { workspace.dispose(); links.dispose() })
</script>

<style scoped>
.task-material-links { display: grid; gap: 12px; margin: 14px 0; padding: 12px; border: 1px solid rgba(109,78,39,.28); border-radius: 9px; background: rgba(255,250,238,.56); color: #4a3423; }
.task-material-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }.task-material-heading h4,.task-material-picker h5,.task-execution-fact h5 { margin: 0; }.task-material-heading p,.task-material-picker p,.task-execution-fact p { margin: 5px 0 0; font-size: 12px; line-height: 1.5; }.task-material-links button,.task-material-links select { min-height: 32px; border: 1px solid #d7c3a2; border-radius: 7px; background: #fffdf6; color: #4a3423; font: inherit; }.task-material-links button { padding: 0 9px; cursor: pointer; }.task-material-links button:disabled { cursor: not-allowed; opacity: .55; }.task-link-list,.workspace-file-list { display: grid; gap: 7px; }.task-link-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px; border-radius: 7px; background: rgba(239,224,198,.68); }.task-link-row > div:first-child { display: grid; gap: 2px; min-width: 0; }.task-link-actions { display: grid; justify-items: end; gap: 5px; flex: 0 0 auto; }.task-link-row strong,.task-link-row span,.task-link-row small { overflow-wrap: anywhere; }.task-link-row span,.task-link-row small { color: #765f40; font-size: 12px; }.task-link-row.output { border-left: 3px solid #4d6b4b; }.workspace-file-list button { display: grid; gap: 2px; width: 100%; padding: 8px; text-align: left; }.workspace-file-list button.selected { border-color: #7c1f1b; background: #f3e0bc; }.workspace-file-list small { color: #765f40; overflow-wrap: anywhere; }.task-material-picker { display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid rgba(109,78,39,.2); }.task-material-picker label { display: grid; gap: 4px; font-size: 12px; }.attach-material { justify-self: start; background: #7c1f1b !important; color: #fff8e8 !important; }.task-execution-fact { padding-top: 12px; border-top: 1px solid rgba(109,78,39,.2); }.task-material-note { color: #765f40; }.task-material-error { color: #a1261d; }.load-more { justify-self: start; }
@media (max-width: 620px) { .task-material-heading { flex-direction: column; }.task-material-heading > button { width: fit-content; } }
</style>
