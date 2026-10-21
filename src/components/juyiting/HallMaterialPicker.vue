<template>
  <section class="hall-material-picker" :aria-label="readOnly ? '关联资料' : '需求资料'">
    <div v-if="!readOnly" class="quick-request-actions">
      <button
        type="button"
        class="quick-material-open"
        :disabled="disabled || !enabled"
        @click="openQuickMaterialPicker"
      ><var-icon name="paperclip" aria-hidden="true" />添加资料（可选）<span v-if="selectedMaterials.length">{{ selectedMaterials.length }}</span></button>
      <slot></slot>
    </div>
    <ul v-if="selectedMaterials.length" class="quick-material-summary" aria-label="已选资料">
      <li v-for="material in selectedMaterials" :key="materialKey(material)">
        <span><strong>{{ material.displayName }}</strong><small>v{{ material.version }}</small></span>
        <button type="button" :disabled="disabled" @click="previewSelectedMaterial(material)">预览</button>
        <button
          type="button"
          :disabled="disabled"
          v-if="!readOnly"
          :aria-label="`移除 ${material.displayName} v${material.version}`"
          @click="removeSelectedMaterial(material)"
        >移除</button>
      </li>
    </ul>
    <Teleport to="body">
      <dialog
        v-if="materialPickerOpen"
        ref="pickerDialog"
        class="quick-material-picker"
        :class="{ 'is-mobile-preview': mobilePreviewOpen }"
        aria-labelledby="hall-material-picker-title"
        @cancel.prevent="backFromPicker"
        @keydown="handlePickerKeydown"
      >
        <header>
          <button type="button" class="quick-material-back" @click="backFromPicker"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>返回</button>
          <div><h3 id="hall-material-picker-title">选择资料</h3><p>从工作空间选择或上传资料，完成后带入。</p></div>
        </header>
        <div class="quick-material-picker-body">
          <section class="quick-material-list-pane" aria-label="工作空间资料">
            <p v-if="workspace.listState.value === 'loading'" role="status">正在读取你的资料…</p>
            <p v-else-if="workspace.listState.value === 'empty' && !pickerFiles.length">暂无资料，也可以直接提需求。</p>
            <div v-if="pickerFiles.length" class="quick-material-files" aria-label="可选资料">
              <button v-for="file in pickerFiles" :key="file.fileId" type="button"
                :data-file-id="file.fileId" :class="{ selected: pickerFileId === file.fileId }"
                :aria-pressed="pickerFileId === file.fileId" :disabled="uploading" @click="selectQuickMaterialFile(file.fileId)"
              ><span><strong>{{ file.displayName }}</strong><small>最新 v{{ file.latestVersion }}</small></span><span v-if="draftMaterials.some(item => item.fileId === file.fileId)" class="quick-material-added">已添加</span><span v-else class="quick-material-chevron" aria-hidden="true">›</span></button>
            </div>
            <button v-if="workspace.nextCursor.value" type="button" :disabled="workspace.loading.value" @click="loadMoreQuickMaterials">加载更多</button>
          </section>
          <section class="quick-material-detail-pane" aria-label="固定版本与预览">
            <div v-if="pickerDetail" class="quick-material-fields">
              <div class="quick-material-selected-file"><strong>{{ pickerDetail.file.displayName }}</strong><span class="quick-material-version">已固定 v{{ pickerVersion }} · 版本管理在工作空间</span></div>

            </div>
            <p v-if="workspace.error.value" class="quick-request-error" role="alert">{{ workspace.error.value }}</p>
            <section id="hall-material-preview" class="quick-material-preview" aria-label="资料预览" :aria-busy="workspace.actionState?.value === 'loading-preview'">
              <p v-if="!pickerDetail" class="quick-material-empty">选择左侧资料，在这里查看完整预览。</p>
              <p v-else-if="workspace.actionState?.value === 'loading-preview'" role="status">正在读取固定版本预览…</p>
              <template v-else>
                <div v-if="materialPreview.kind === 'parts'" class="quick-material-pagination">
                  <button type="button" :disabled="materialPreview.selectedIndex === 0" @click="workspace.selectPreviewPart(materialPreview.selectedIndex - 1)">上一页</button>
                  <span>第 {{ materialPreview.selectedIndex + 1 }} / {{ materialPreview.parts.length }} 页</span>
                  <button type="button" :disabled="materialPreview.selectedIndex >= materialPreview.parts.length - 1" @click="workspace.selectPreviewPart(materialPreview.selectedIndex + 1)">下一页</button>
                </div>
                <img v-if="materialPreviewPart?.kind === 'image'" :src="materialPreviewPart.url" alt="资料预览" />
                <audio v-else-if="materialPreviewPart?.kind === 'audio'" :src="materialPreviewPart.url" controls preload="none" aria-label="音频预览"></audio>
                <pre v-else-if="materialPreviewPart?.kind === 'text'" v-text="materialPreviewPart.text"></pre>
                <p v-if="materialPreview.message" role="status">{{ materialPreview.message }}</p>
                <button v-if="pickerDetail && materialPreview.kind === 'error'" type="button" @click="previewQuickMaterial">重试预览</button>
              </template>
            </section>
            <div v-if="pickerDetail" class="quick-material-version-actions">
              <button v-if="isMobile" type="button" class="quick-material-preview-toggle" :disabled="!pickerVersion"
                :aria-expanded="mobilePreviewOpen" aria-controls="hall-material-preview" @click="toggleMobilePreview"
              >{{ mobilePreviewOpen ? '收起预览' : '预览' }}</button>
              <button type="button" class="primary" :disabled="!pickerVersion || pickerAlreadyAdded || uploading" @click="stageQuickMaterial">{{ pickerAlreadyAdded ? '已添加' : '添加' }}</button>
            </div>
          </section>
        </div>
        <footer>
          <div class="quick-material-selection-row">
            <button type="button" class="quick-material-count" :aria-expanded="selectionExpanded" aria-controls="quick-material-staged" @click="selectionExpanded = !selectionExpanded">已选 {{ draftMaterials.length }} 份资料 {{ selectionExpanded ? '⌄' : '⌃' }}</button>
            <label class="quick-material-upload">上传资料<input type="file" multiple aria-label="上传资料" :disabled="uploading || uploadUnresolved" @change="uploadQuickMaterials" /></label>
          </div>
          <p v-if="uploading || uploadMessage" class="quick-material-upload-status" :role="uploading ? 'status' : 'alert'">{{ uploading ? '正在上传资料…' : uploadMessage }}</p>
          <button v-if="uploadUnresolved" type="button" :disabled="uploading" @click="retryQuickUpload">核对原上传</button>
          <section v-if="selectionExpanded" id="quick-material-staged" class="quick-material-selection" aria-label="已选资料">
            <ul class="quick-material-draft">
              <li v-for="material in draftMaterials" :key="materialKey(material)"><span>{{ material.displayName }} · v{{ material.version }}</span><button type="button" :disabled="uploading" :aria-label="`移除 ${material.displayName} v${material.version}`" @click="removeDraftMaterial(material)">移除</button></li>
              <li v-if="!draftMaterials.length">尚未选择资料</li>
            </ul>
          </section>
          <div class="quick-material-footer-actions">
            <button type="button" @click="cancelQuickMaterialPicker">取消</button>
            <button type="button" class="quick-material-confirm" :disabled="uploading" @click="confirmQuickMaterials">完成（{{ draftMaterials.length }}）</button>
          </div>
        </footer>
      </dialog>

      <dialog v-if="selectedPreview" ref="selectedPreviewDialog" class="quick-material-standalone" aria-labelledby="selected-material-title" @cancel.prevent="closeSelectedPreview" @click="event => { if (event.target === selectedPreviewDialog) closeSelectedPreview() }">
        <header><h3 id="selected-material-title">{{ selectedPreview.displayName }}</h3><button type="button" class="quick-material-close" aria-label="关闭预览" @click="closeSelectedPreview"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></header>
        <section class="quick-material-preview" aria-label="资料预览" :aria-busy="workspace.actionState?.value === 'loading-preview'">
          <div v-if="workspace.error.value" role="alert"><p>{{ workspace.error.value }}</p><button type="button" @click="previewSelectedMaterial(selectedPreview)">重试预览</button></div>
          <p v-else-if="!pickerDetail || workspace.actionState?.value === 'loading-preview'" role="status">正在读取固定版本预览…</p>
              <template v-else>
                <div v-if="materialPreview.kind === 'parts'" class="quick-material-pagination">
                  <button type="button" :disabled="materialPreview.selectedIndex === 0" @click="workspace.selectPreviewPart(materialPreview.selectedIndex - 1)">上一页</button>
                  <span>第 {{ materialPreview.selectedIndex + 1 }} / {{ materialPreview.parts.length }} 页</span>
                  <button type="button" :disabled="materialPreview.selectedIndex >= materialPreview.parts.length - 1" @click="workspace.selectPreviewPart(materialPreview.selectedIndex + 1)">下一页</button>
                </div>
                <img v-if="materialPreviewPart?.kind === 'image'" :src="materialPreviewPart.url" alt="资料预览" />
                <audio v-else-if="materialPreviewPart?.kind === 'audio'" :src="materialPreviewPart.url" controls preload="none" aria-label="音频预览"></audio>
                <pre v-else-if="materialPreviewPart?.kind === 'text'" v-text="materialPreviewPart.text"></pre>
                <p v-if="materialPreview.message" role="status">{{ materialPreview.message }}</p>
                <button v-if="pickerDetail && materialPreview.kind === 'error'" type="button" @click="previewQuickMaterial">重试预览</button>
              </template>
        </section>
        <footer><button type="button" class="quick-material-download" :disabled="!pickerVersion || previewDownloading" @click="downloadSelectedMaterial"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5" /></svg>{{ previewDownloading ? '正在下载…' : '下载文件' }}</button></footer>
      </dialog>
    </Teleport>
  </section>
</template>

<script setup>
import { validMaterialVersion } from '../../composables/juyiting/materialVersion.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePersonalWorkspace, savePersonalWorkspaceBlob } from '@/composables/usePersonalWorkspace'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  readOnly: { type: Boolean, default: false },
  identityScope: { type: String, default: '' },
  identityEpoch: { type: [Number, String], default: 0 },
  enabled: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])
const materialIdentityKey = computed(() => `${props.identityEpoch}\u0000${props.identityScope}`)
const workspace = usePersonalWorkspace({ identityEpoch: materialIdentityKey })
let pickerGeneration = 0
const materialPickerOpen = ref(false)
const pickerDialog = ref(null)
const selectedPreview = ref(null)
const selectedPreviewDialog = ref(null)
const previewDownloading = ref(false)
let previewReturnFocus = null
const mobileQuery = typeof window !== 'undefined' ? window.matchMedia?.('(max-width: 720px)') : null
const isMobile = ref(mobileQuery?.matches === true)
const mobilePreviewOpen = ref(false)
let pickerReturnFocus = null
const syncPickerViewport = event => {
  const wasMobile = isMobile.value
  isMobile.value = event.matches
  // Retain the fixed selection and preview when resizing; desktop has no toggle.
  if (wasMobile && !event.matches && materialPickerOpen.value && pickerVersion.value && materialPreview.value.kind === 'none') void previewQuickMaterial()
}
onMounted(() => mobileQuery?.addEventListener?.('change', syncPickerViewport))
watch(materialPickerOpen, async opened => {
  if (!opened) {
    const target = pickerReturnFocus
    await nextTick()
    if (target?.isConnected) target.focus()
    return
  }
  await nextTick()
  if (!materialPickerOpen.value) return
  const dialog = pickerDialog.value
  if (typeof dialog?.showModal === 'function') dialog.showModal()
  else dialog?.setAttribute('open', '')
  dialog?.querySelector('header button')?.focus()
}, { flush: 'post' })
const backFromPicker = () => {
  if (isMobile.value && mobilePreviewOpen.value) {
    mobilePreviewOpen.value = false
    nextTick(() => pickerDialog.value?.querySelector('.quick-material-preview-toggle')?.focus())
  } else cancelQuickMaterialPicker()
}
const handlePickerKeydown = event => {
  event.stopPropagation()
  if (event.key !== 'Tab') return
  const targets = [...(pickerDialog.value?.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, audio[controls]') || [])]
    .filter(element => element.getClientRects().length && !element.closest('[hidden]'))
  if (!targets.length) return
  const first = targets[0], last = targets[targets.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
const toggleMobilePreview = async () => {
  mobilePreviewOpen.value = !mobilePreviewOpen.value
  if (mobilePreviewOpen.value && materialPreview.value.kind === 'none') await previewQuickMaterial()
}
const selectedMaterials = computed({ get: () => props.modelValue, set: value => emit('update:modelValue', value) })
const draftMaterials = ref([])
const selectionExpanded = ref(false)
const uploading = ref(false)
const uploadMessage = ref('')
const uploadUnresolved = computed(() => workspace.pendingWrites?.value?.some(item => item.target === 'CREATE') === true)
const uploadedFiles = ref([])
const pickerFiles = computed(() => [...new Map([...uploadedFiles.value, ...workspace.items.value].map(file => [file.fileId, file])).values()])
const pickerAlreadyAdded = computed(() => draftMaterials.value.some(item => item.fileId === pickerFileId.value && item.version === pickerVersion.value))
const adoptUploadedMaterial = data => {
  if (!data?.file?.fileId || !validMaterialVersion(data.version?.version) || data.file.fileId !== data.version.fileId || data.operation?.state !== 'COMMITTED') return false
  const material = { fileId: data.file.fileId, version: data.version.version, displayName: data.file.displayName, contentMimeType: data.version.contentMimeType }
  if (!draftMaterials.value.some(item => materialKey(item) === materialKey(material))) draftMaterials.value.push(material)
  uploadedFiles.value = [{ ...data.file, latestVersion: data.version.version }, ...uploadedFiles.value.filter(file => file.fileId !== data.file.fileId)]
  return true
}
const refreshUploadedList = async current => {
  if (!current() || !uploadedFiles.value.length) return
  await workspace.refresh({ state: 'ACTIVE' })
}
const runPickerUpload = async (operation, input = null) => {
  if (uploading.value || props.disabled || !materialPickerOpen.value) return
  const generation = pickerGeneration, identity = materialIdentityKey.value
  const current = () => materialPickerOpen.value && !props.disabled && generation === pickerGeneration && identity === materialIdentityKey.value
  uploading.value = true; uploadMessage.value = ''
  try { await operation(current) }
  catch { if (current()) uploadMessage.value = '上传未完成，请核对原上传后再试；已有选择保留。' }
  finally { uploading.value = false; if (input) input.value = '' }
}
const uploadQuickMaterials = event => {
  const input = event.target, files = [...(input.files || [])]
  if (!files.length) return
  if (files.length + draftMaterials.value.length > 32) { uploadMessage.value = '最多选择32份资料，请减少本次文件数量。'; input.value = ''; return }
  return runPickerUpload(async current => {
    for (const file of files) {
      if (!current()) break
      const data = await workspace.upload(file)
      if (!current()) break
      if (!adoptUploadedMaterial(data)) { uploadMessage.value = workspace.error.value || '上传结果尚未确认，已有选择保留。'; break }
      // Only the authoritative COMMITTED receipt can add a fixed version.
      pickerFileId.value = data.file.fileId; pickerVersion.value = data.version.version
    }
    await refreshUploadedList(current)
    if (current() && pickerDetail.value && !isMobile.value) await previewQuickMaterial()
  }, input)
}
const retryQuickUpload = () => runPickerUpload(async current => {
  const data = await workspace.retryWrite('CREATE')
  if (!current()) return
  if (!adoptUploadedMaterial(data)) { uploadMessage.value = workspace.error.value || '原上传尚未确认，请稍后核对。'; return }
  pickerFileId.value = data.file.fileId; pickerVersion.value = data.version.version
  await refreshUploadedList(current)
  if (current() && pickerDetail.value && !isMobile.value) await previewQuickMaterial()
})
const pickerFileId = ref('')
const pickerVersion = ref(null)
const pickerDetail = computed(() => {
  const detail = workspace.detail.value
  if (detail?.file?.fileId !== pickerFileId.value || detail.file.state !== 'ACTIVE' || !Array.isArray(detail.versions)) return null
  const versions = detail.versions
  return versions.length ? { ...detail, versions } : null
})
const materialKey = material => `${material.fileId}:${material.version}`
const resetMaterialPicker = () => { selectionExpanded.value = false; uploadMessage.value = ''; mobilePreviewOpen.value = false; pickerGeneration += 1; pickerFileId.value = ''; pickerVersion.value = null; workspace.closeDetail() }
const openQuickMaterialPicker = async () => {
  if (props.readOnly || !props.enabled || !props.identityScope || props.disabled) return
  pickerReturnFocus = typeof document !== 'undefined' ? document.activeElement : null
  closeSelectedPreview()
  uploadedFiles.value = []
  draftMaterials.value = selectedMaterials.value.map(material => ({ ...material }))
  resetMaterialPicker()
  materialPickerOpen.value = true
  await workspace.refresh({ state: 'ACTIVE' })
}
const cancelQuickMaterialPicker = () => { materialPickerOpen.value = false; draftMaterials.value = []; resetMaterialPicker() }
const loadMoreQuickMaterials = () => workspace.loadMore({ state: 'ACTIVE' })
const selectQuickMaterialFile = async (fileId, fixedVersion = null) => {
  const operationIdentity = materialIdentityKey.value, generation = ++pickerGeneration
  const current = () => !props.disabled && generation === pickerGeneration && materialIdentityKey.value === operationIdentity && (materialPickerOpen.value || selectedPreview.value)
  pickerFileId.value = ''; pickerVersion.value = null
  let detail = await workspace.select(fileId)
  if (!current()) return
  if (!detail || detail.file.state !== 'ACTIVE') {
    if (selectedPreview.value && !workspace.error.value) workspace.error.value = '这份资料暂时无法读取，请重试。'
    return
  }
  const existing = draftMaterials.value.find(material => material.fileId === detail.file.fileId)
  const preferredVersion = fixedVersion || existing?.version || detail.latestVersion?.version
  // Restored draft inputs may refer to an older page. Never silently substitute latest.
  while (preferredVersion && !detail.versions?.some(version => version.version === preferredVersion) && workspace.hasMoreVersions?.value) {
    if (!await workspace.loadMoreVersions() || !current()) return
    detail = workspace.detail.value
    if (!detail || detail.file.fileId !== fileId || detail.file.state !== 'ACTIVE') return
  }
  if (!current()) return
  const versions = Array.isArray(detail.versions) ? detail.versions : []
  if (!versions.length || !validMaterialVersion(preferredVersion) || !versions.some(version => version.version === preferredVersion)) {
    workspace.error.value = '这个固定版本暂时无法打开；已选资料保持原版本，请稍后重试。'
    return
  }
  pickerFileId.value = detail.file.fileId
  pickerVersion.value = preferredVersion
  if (selectedPreview.value || !isMobile.value || mobilePreviewOpen.value) await previewQuickMaterial()
}
// Product selections carry no image-specific purpose or execution authority.
const materialPreview = computed(() => workspace.preview?.value || { kind: 'none' })
const materialPreviewPart = computed(() => materialPreview.value.kind === 'parts'
  ? materialPreview.value.parts[materialPreview.value.selectedIndex] : materialPreview.value)
const previewQuickMaterial = () => workspace.previewVersion(pickerVersion.value)
watch(pickerVersion, () => workspace.revokePreview?.(), { flush: 'sync' })
const closeSelectedPreview = () => {
  if (!selectedPreview.value) return
  selectedPreview.value = null
  resetMaterialPicker()
}
watch(selectedPreview, async opened => {
  await nextTick()
  if (opened && selectedPreview.value) {
    selectedPreviewDialog.value?.showModal?.()
    selectedPreviewDialog.value?.querySelector('button')?.focus()
  } else if (!opened && previewReturnFocus?.isConnected) previewReturnFocus.focus()
})
const previewSelectedMaterial = async material => {
  if (props.disabled || !props.enabled || !props.identityScope || materialPickerOpen.value) return
  previewReturnFocus = typeof document !== 'undefined' ? document.activeElement : null
  resetMaterialPicker()
  selectedPreview.value = { ...material }
  await selectQuickMaterialFile(material.fileId, material.version)
}
const downloadSelectedMaterial = async () => {
  if (!selectedPreview.value || !pickerVersion.value || previewDownloading.value) return
  const identity = materialIdentityKey.value, generation = pickerGeneration
  previewDownloading.value = true
  try {
    const result = await workspace.download(pickerVersion.value)
    if (result && selectedPreview.value && identity === materialIdentityKey.value && generation === pickerGeneration) savePersonalWorkspaceBlob(result)
  } catch {
    if (selectedPreview.value && identity === materialIdentityKey.value && generation === pickerGeneration) workspace.error.value = '下载未完成，请重试。'
  } finally { previewDownloading.value = false }
}
const stageQuickMaterial = () => {
  if (props.disabled || uploading.value || pickerAlreadyAdded.value || !materialPickerOpen.value) return
  const detail = pickerDetail.value
  const version = pickerVersion.value
  if (!detail || !validMaterialVersion(version) || !detail.versions.some(item => item.version === version)) return
  const material = { fileId: detail.file.fileId, version, displayName: detail.file.displayName, contentMimeType: detail.versions.find(item => item.version === version).contentMimeType }
  const others = draftMaterials.value.filter(item => materialKey(item) !== materialKey(material))
  if (others.length >= 32) { workspace.error.value = '最多添加 32 份资料。'; return }
  draftMaterials.value = [...others, material]
}
const removeDraftMaterial = material => { draftMaterials.value = draftMaterials.value.filter(item => materialKey(item) !== materialKey(material)) }
const confirmQuickMaterials = () => {
  if (uploading.value || props.disabled || !materialPickerOpen.value) return
  selectedMaterials.value = draftMaterials.value.map(material => ({ ...material }))
  materialPickerOpen.value = false
  draftMaterials.value = []
  resetMaterialPicker()
}
const removeSelectedMaterial = material => { if (props.readOnly) return; selectedMaterials.value = selectedMaterials.value.filter(item => materialKey(item) !== materialKey(material)) }

watch(materialIdentityKey, () => {
  selectedMaterials.value = []
  closeSelectedPreview()
  cancelQuickMaterialPicker()
}, { flush: 'sync' })
watch(() => [props.disabled, props.enabled], ([disabled, enabled]) => {
  if (disabled || !enabled) { closeSelectedPreview(); cancelQuickMaterialPicker() }
}, { flush: 'sync' })
onBeforeUnmount(() => { pickerGeneration += 1; mobileQuery?.removeEventListener?.('change', syncPickerViewport); workspace.dispose() })
</script>

<style scoped>
.hall-material-picker { min-width: 0; }
.quick-request-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; }
.quick-material-open { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 8px 12px; border: 1px solid var(--hall-line, #d8d8ce); border-radius: 8px; background: var(--hall-paper, #fffefa); color: var(--hall-ink, #242e2b); font: inherit; cursor: pointer; }
.quick-material-open > span { display: inline-grid; place-items: center; min-width: 20px; padding: 0 5px; border-radius: 10px; background: #923f30; color: #fffefa; font-size: 11px; }
.quick-material-summary, .quick-material-draft { display: grid; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; min-width: 0; }
.quick-material-summary { max-height: 136px; overflow: auto; }
.quick-material-summary li, .quick-material-draft li { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border: 1px solid #d8d8ce; border-radius: 8px; background: #f3f3ed; min-width: 0; }
.quick-material-summary li > span, .quick-material-draft li > span { flex: 1; display: grid; min-width: 0; overflow-wrap: anywhere; }
.quick-material-summary small { color: #68716b; }
.quick-material-summary button { min-height: 44px; flex: none; border: 0; background: transparent; color: #923f30; font: inherit; cursor: pointer; }
.quick-material-picker { --material-ground: #f5f4f0; --material-paper: #fffefa; --material-ink: #242e2b; --material-muted: #68716b; --material-line: #d8d8ce; --material-brand: #923f30; position: fixed; inset: 0; z-index: 1400; margin: auto; padding: 0; border: 1px solid #e3e5dc; border-radius: 16px; width: min(980px, calc(100vw - 48px)); max-width: none; height: min(760px, calc(100dvh - 48px)); max-height: calc(100dvh - 48px); overflow: hidden; box-sizing: border-box; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--material-ground); color: var(--material-ink); font: 400 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
.quick-material-picker::backdrop { background: #242e2b66; }
.quick-material-picker header { display: flex; align-items: center; gap: 16px; padding: 12px 20px; border-bottom: 1px solid var(--material-line); background: var(--material-paper); }
.quick-material-picker header, .quick-material-picker footer { padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); }
.quick-material-picker h3, .quick-material-picker p { margin: 0; }
.quick-material-picker h3 { font-size: 17px; }
.quick-material-picker header p { color: var(--material-muted); font-size: 12px; margin-top: 3px; }
.quick-material-picker button { flex: none; min-height: 44px; border: 1px solid var(--material-line); border-radius: 8px; padding: 8px 12px; background: #f3f4ee; color: var(--material-ink); font: inherit; cursor: pointer; }
.quick-material-picker .quick-material-back { display: inline-flex; align-items: center; justify-content: center; gap: 4px; background: transparent; border-color: transparent; color: var(--material-brand); padding-inline: 4px; }
.quick-material-back svg { width: 20px; height: 20px; }
.quick-material-picker button.primary, .quick-material-picker .quick-material-confirm { background: var(--material-brand); border-color: var(--material-brand); color: var(--material-paper); }
.quick-material-picker-body { display: grid; grid-template-columns: minmax(220px, .8fr) minmax(0, 1.2fr); min-height: 0; min-width: 0; overflow: hidden; }
.quick-material-list-pane { min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; padding: 16px; border-right: 1px solid #e3e5dc; scrollbar-gutter: stable; }
.quick-material-files { display: grid; gap: 10px; }
.quick-material-files button { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-width: 0; padding: 14px; background: var(--material-paper); border-radius: 10px; text-align: left; overflow-wrap: anywhere; }
.quick-material-files button > span:first-child { min-width: 0; flex: 1; }
.quick-material-files strong, .quick-material-files small { display: block; }
.quick-material-files small { margin-top: 6px; }
.quick-material-added { color: var(--material-muted); font-size: 12px; white-space: nowrap; }
.quick-material-chevron { color: var(--material-muted); font-size: 22px; }
.quick-material-files button.selected { background: #f6eee8; border-color: var(--material-brand); }
.quick-material-files small, .quick-material-version { color: var(--material-muted); font-size: 12px; }
.quick-material-detail-pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; background: var(--material-paper); }
.quick-material-fields { flex: none; min-width: 0; padding: 16px 20px 8px; }
.quick-material-version-actions { display: flex; flex: none; align-items: center; gap: 8px; padding: 8px 20px 12px; }
.quick-material-version-actions .primary { margin-left: auto; min-width: 64px; }
.quick-material-selected-file { display: grid; gap: 4px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.quick-material-selected-file strong { max-height: 3.1em; overflow: auto; font-size: 15px; }
.quick-material-preview { flex: 1; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px; margin: 8px 16px; background: #f5f4f0; border: 0; border-radius: 8px; box-sizing: border-box; }
.quick-material-preview img { display: block; width: 100%; height: 100%; max-width: 100%; min-height: 0; flex: 1; object-fit: contain; object-position: center; }
.quick-material-preview audio { width: 100%; max-width: 100%; flex: none; }
.quick-material-preview pre { align-self: stretch; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.quick-material-pagination { display: flex; flex: none; align-items: center; gap: 8px; }
.quick-material-empty { margin: auto !important; color: var(--material-muted); }
.quick-material-picker footer { position:relative; display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--material-line); background: var(--material-paper); }
.quick-material-selection { position:absolute; bottom:100%; left:12px; right:12px; padding:8px 12px; border:1px solid var(--material-line); border-radius:8px 8px 0 0; background:var(--material-paper); min-width:0; box-shadow:0 -6px 20px #242e2b15; }
.quick-material-selection-row { display:flex; align-items:center; gap:12px; margin-right:auto; min-width:0; }
.quick-material-picker .quick-material-count { border:0; background:transparent; padding:6px 0; font-size:13px; color:var(--material-muted); }
.quick-material-upload { position:relative; display:inline-flex; align-items:center; justify-content:center; height:36px; box-sizing:border-box; flex:none; padding:0 12px; border:1px solid var(--material-line); border-radius:7px; background:var(--material-ground); font-size:13px; cursor:pointer; overflow:hidden; }
.quick-material-upload input { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; }
.quick-material-upload:focus-within { outline:2px solid var(--material-brand); outline-offset:2px; }
.quick-material-upload:has(input:disabled) { opacity:.55; cursor:wait; }
.quick-material-footer-actions { display:flex; gap:10px; }
.quick-material-footer-actions button { min-width:100px; }
.quick-material-upload-status { flex-basis:100%; font-size:12px; color:#a13f35; }
.quick-material-selection summary { min-height: 44px; line-height: 44px; cursor: pointer; color: var(--material-muted); }
.quick-material-draft { max-height: min(120px, 20dvh); overflow: auto; }
.quick-request-error { color: #a13f35; }
.quick-material-picker button:focus-visible, .quick-material-picker summary:focus-visible, .quick-material-open:focus-visible { outline: 3px solid #923f3080; outline-offset: 2px; }
.quick-material-picker button:hover:not(:disabled), .quick-material-open:hover:not(:disabled) { box-shadow: inset 0 0 0 1px var(--material-brand, #923f30); }
.quick-material-picker button:disabled { background: #f1f0e9; color: #68716b; border-color: #e3e5dc; opacity: 1; cursor: default; }
.quick-material-open:disabled { opacity: .55; cursor: not-allowed; }
.quick-material-picker button:not(.quick-material-files button):not(.quick-material-footer-actions button) { min-height: 36px; font-size: 13px; line-height: 1.4; padding: 6px 12px; border-radius: 7px; }
.quick-material-picker .quick-material-back { padding-inline: 4px !important; }
.quick-material-standalone { position: fixed; inset: 0; margin: auto; padding: 24px; width: min(680px, calc(100vw - 32px)); max-width: none; max-height: calc(100dvh - 32px); box-sizing: border-box; border: 1px solid #d8d8ce; border-radius: 16px; background: #fffefa; color: #242e2b; font: 400 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
.quick-material-standalone[open] { display: flex; flex-direction: column; }
.quick-material-standalone::backdrop { background: #242e2b66; }
.quick-material-standalone header { display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #e3e5dc; padding-bottom: 16px; flex: none; }
.quick-material-standalone h3 { flex: 1; min-width: 0; overflow-wrap: anywhere; margin: 0; font-size: 18px; }
.quick-material-standalone button { font: inherit; min-height: 44px; border: 1px solid #d8d8ce; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
.quick-material-standalone button:focus-visible { outline: 2px solid #923f30; outline-offset: 2px; }
.quick-material-standalone .quick-material-close { display: grid; place-items: center; background: transparent; border: 0; width: 44px; padding: 0; color: #68716b; }
.quick-material-standalone svg { width: 20px; height: 20px; flex: none; }
.quick-material-standalone .quick-material-preview { flex: 0 1 auto; margin: 16px 0; min-height: 80px; max-height: calc(100dvh - 240px); }
.quick-material-standalone .quick-material-preview img { flex: 0 1 auto; height: auto; max-height: calc(100dvh - 272px); object-fit: contain; }
.quick-material-standalone footer { flex: none; padding-top: 16px; border-top: 1px solid #e3e5dc; }
.quick-material-standalone .quick-material-download { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; background: #923f30; border-color: #923f30; color: #fffefa; }
.quick-material-standalone button:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 720px) {
  .quick-material-picker { width: 100vw; height: 100dvh; max-height: 100dvh; max-width: 100vw; margin: 0; border: 0; border-radius: 0; }
  .quick-material-picker-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .quick-material-list-pane { border-right: 0; padding: 12px; }
  .quick-material-detail-pane { border-top: 1px solid #e3e5dc; }
  .quick-material-fields { padding: 10px 16px 0; }
  .quick-material-selected-file strong { display: none; }
  .quick-material-version-actions { padding: 6px 16px 8px; }
  .quick-material-selected-file { flex-basis: 100%; }
  .quick-material-preview { display: none; }
  .is-mobile-preview .quick-material-picker-body { grid-template-rows: minmax(0, 1fr); }
  .is-mobile-preview .quick-material-list-pane { display: none; }
  .is-mobile-preview .quick-material-detail-pane { min-height: 0; border: 0; }
  .is-mobile-preview .quick-material-selected-file strong { display: block; }
  .is-mobile-preview .quick-material-preview { display: flex; }
  .quick-material-picker header { padding: 10px 12px; gap: 10px; }
  .quick-material-picker footer { padding: 8px 16px max(12px, env(safe-area-inset-bottom)); gap: 6px; }
  .quick-material-picker button:not(.quick-material-files button):not(.quick-material-footer-actions button) { min-height: 40px; }
  .quick-material-selection-row, .quick-material-footer-actions { width:100%; }
  .quick-material-footer-actions button { flex:1; min-width:0; }
  .quick-material-upload { height:40px; }
  .quick-material-standalone .quick-material-preview { display: flex; }
}
</style>
