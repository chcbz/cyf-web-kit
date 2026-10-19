<template>
  <section class="hall-material-picker" aria-label="需求资料">
    <div class="quick-request-actions">
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
          <div><h3 id="hall-material-picker-title">选择资料</h3><p>从工作空间选择图片、文档或音频。</p></div>
        </header>
        <div class="quick-material-picker-body">
          <section class="quick-material-list-pane" aria-label="工作空间资料">
            <p v-if="workspace.listState.value === 'loading'" role="status">正在读取你的资料…</p>
            <p v-else-if="workspace.listState.value === 'empty'">暂无资料，也可以直接提需求。</p>
            <div v-if="workspace.items.value.length" class="quick-material-files" aria-label="可选资料">
              <button v-for="file in workspace.items.value" :key="file.fileId" type="button"
                :data-file-id="file.fileId" :class="{ selected: pickerFileId === file.fileId }"
                :aria-pressed="pickerFileId === file.fileId" @click="selectQuickMaterialFile(file.fileId)"
              ><strong>{{ file.displayName }}</strong><small>最新 v{{ file.latestVersion }}</small></button>
            </div>
            <button v-if="workspace.nextCursor.value" type="button" :disabled="workspace.loading.value" @click="loadMoreQuickMaterials">加载更多</button>
          </section>
          <section class="quick-material-detail-pane" aria-label="固定版本与预览">
            <div v-if="pickerDetail" class="quick-material-fields">
              <div class="quick-material-selected-file"><strong>{{ pickerDetail.file.displayName }}</strong><span class="quick-material-version">已固定 v{{ pickerVersion }} · 版本管理在工作空间</span></div>
              <button v-if="isMobile" type="button" class="quick-material-preview-toggle" :disabled="!pickerVersion"
                :aria-expanded="mobilePreviewOpen" aria-controls="hall-material-preview" @click="toggleMobilePreview"
              >{{ mobilePreviewOpen ? '收起预览' : '预览' }}</button>
              <button type="button" class="quick-material-download" :disabled="!pickerVersion" @click="downloadQuickMaterial">下载</button>
              <button type="button" class="primary" :disabled="!pickerVersion" @click="stageQuickMaterial">添加</button>
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
          </section>
        </div>
        <footer>
          <details v-if="draftMaterials.length" class="quick-material-selection">
            <summary>已选 {{ draftMaterials.length }} 份资料</summary>
            <ul class="quick-material-draft" aria-label="已选资料">
              <li v-for="material in draftMaterials" :key="materialKey(material)"><span>{{ material.displayName }} · v{{ material.version }}</span><button type="button" :aria-label="`移除 ${material.displayName} v${material.version}`" @click="removeDraftMaterial(material)">移除</button></li>
            </ul>
          </details>
          <button type="button" class="quick-material-confirm" @click="confirmQuickMaterials">完成（{{ draftMaterials.length }}）</button>
          <button type="button" @click="cancelQuickMaterialPicker">取消</button>
        </footer>
      </dialog>
    </Teleport>
  </section>
</template>

<script setup>
import { validMaterialVersion } from '../../composables/juyiting/materialVersion.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { savePersonalWorkspaceBlob, usePersonalWorkspace } from '@/composables/usePersonalWorkspace'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
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
const mobileQuery = typeof window !== 'undefined' ? window.matchMedia?.('(max-width: 600px)') : null
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
  const targets = [...(pickerDialog.value?.querySelectorAll('button:not(:disabled), summary, audio[controls]') || [])]
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
const pickerFileId = ref('')
const pickerVersion = ref(null)
const pickerDetail = computed(() => {
  const detail = workspace.detail.value
  if (detail?.file?.fileId !== pickerFileId.value || detail.file.state !== 'ACTIVE' || !Array.isArray(detail.versions)) return null
  const versions = detail.versions
  return versions.length ? { ...detail, versions } : null
})
const materialKey = material => `${material.fileId}:${material.version}`
const resetMaterialPicker = () => { mobilePreviewOpen.value = false; pickerGeneration += 1; pickerFileId.value = ''; pickerVersion.value = null; workspace.closeDetail() }
const openQuickMaterialPicker = async () => {
  if (!props.enabled || !props.identityScope || props.disabled) return
  pickerReturnFocus = typeof document !== 'undefined' ? document.activeElement : null
  draftMaterials.value = selectedMaterials.value.map(material => ({ ...material }))
  resetMaterialPicker()
  materialPickerOpen.value = true
  await workspace.refresh({ state: 'ACTIVE' })
}
const cancelQuickMaterialPicker = () => { materialPickerOpen.value = false; draftMaterials.value = []; resetMaterialPicker() }
const loadMoreQuickMaterials = () => workspace.loadMore({ state: 'ACTIVE' })
const selectQuickMaterialFile = async fileId => {
  const operationIdentity = materialIdentityKey.value, generation = ++pickerGeneration
  pickerFileId.value = ''; pickerVersion.value = null
  const detail = await workspace.select(fileId)
  if (!detail || props.disabled || generation !== pickerGeneration || materialIdentityKey.value !== operationIdentity || !materialPickerOpen.value || detail.file.state !== 'ACTIVE') return
  const versions = Array.isArray(detail.versions)
    ? detail.versions
    : []
  if (!versions.length) return
  pickerFileId.value = detail.file.fileId
  pickerVersion.value = versions.some(version => version.version === detail.latestVersion?.version) ? detail.latestVersion.version : versions[versions.length - 1].version
  const existing = draftMaterials.value.find(material => material.fileId === detail.file.fileId)
  if (existing) pickerVersion.value = existing.version
  if (!isMobile.value || mobilePreviewOpen.value) await previewQuickMaterial()
}
// Product selections carry no image-specific purpose or execution authority.
const materialPreview = computed(() => workspace.preview?.value || { kind: 'none' })
const materialPreviewPart = computed(() => materialPreview.value.kind === 'parts'
  ? materialPreview.value.parts[materialPreview.value.selectedIndex] : materialPreview.value)
const previewQuickMaterial = () => workspace.previewVersion(pickerVersion.value)
const downloadQuickMaterial = async () => {
  const identity = materialIdentityKey.value, generation = pickerGeneration
  const content = await workspace.download(pickerVersion.value)
  if (!content || props.disabled || generation !== pickerGeneration || identity !== materialIdentityKey.value || !materialPickerOpen.value) return
  try { savePersonalWorkspaceBlob(content) } catch (cause) { workspace.error.value = cause.message }
}
watch(pickerVersion, () => workspace.revokePreview?.(), { flush: 'sync' })
const previewSelectedMaterial = async material => {
  const identity = materialIdentityKey.value
  await openQuickMaterialPicker()
  if (identity !== materialIdentityKey.value || !materialPickerOpen.value) return
  await selectQuickMaterialFile(material.fileId)
  if (identity !== materialIdentityKey.value || !materialPickerOpen.value || pickerFileId.value !== material.fileId) return
  if (!pickerDetail.value?.versions.some(version => version.version === material.version)) {
    workspace.error.value = '这个版本暂时无法打开，请稍后重试。'
    return
  }
  const needsPreview = pickerVersion.value !== material.version || materialPreview.value.kind === 'none'
  pickerVersion.value = material.version
  mobilePreviewOpen.value = isMobile.value
  if (needsPreview) await previewQuickMaterial()
}
const stageQuickMaterial = () => {
  if (props.disabled || !materialPickerOpen.value) return
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
  if (props.disabled || !materialPickerOpen.value) return
  selectedMaterials.value = draftMaterials.value.map(material => ({ ...material }))
  materialPickerOpen.value = false
  draftMaterials.value = []
  resetMaterialPicker()
}
const removeSelectedMaterial = material => { selectedMaterials.value = selectedMaterials.value.filter(item => materialKey(item) !== materialKey(material)) }

watch(materialIdentityKey, () => {
  selectedMaterials.value = []
  cancelQuickMaterialPicker()
}, { flush: 'sync' })
watch(() => [props.disabled, props.enabled], ([disabled, enabled]) => {
  if (disabled || !enabled) cancelQuickMaterialPicker()
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
.quick-material-picker { --material-ground: #f3f3ed; --material-paper: #fffefa; --material-ink: #242e2b; --material-muted: #68716b; --material-line: #d8d8ce; --material-brand: #923f30; position: fixed; inset: 0; z-index: 1400; margin: 0; padding: 0; border: 0; width: 100%; max-width: none; height: 100%; height: 100dvh; max-height: none; box-sizing: border-box; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: var(--material-ground); color: var(--material-ink); font: 400 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
.quick-material-picker::backdrop { background: #242e2b66; }
.quick-material-picker header { display: flex; align-items: center; gap: 12px; padding: max(8px, env(safe-area-inset-top)) 16px 8px; border-bottom: 1px solid var(--material-line); background: var(--material-paper); }
.quick-material-picker h3, .quick-material-picker p { margin: 0; }
.quick-material-picker h3 { font-size: 18px; }
.quick-material-picker header p { color: var(--material-muted); font-size: 13px; }
.quick-material-picker button { flex: none; min-height: 44px; border: 1px solid var(--material-line); border-radius: 8px; padding: 8px 12px; background: var(--material-paper); color: var(--material-ink); font: inherit; cursor: pointer; }
.quick-material-picker .quick-material-back { display: inline-flex; align-items: center; justify-content: center; gap: 4px; background: transparent; border-color: transparent; }
.quick-material-back svg { width: 20px; height: 20px; }
.quick-material-picker button.primary, .quick-material-picker .quick-material-confirm { background: var(--material-brand); border-color: var(--material-brand); color: var(--material-paper); }
.quick-material-picker .quick-material-download { color: var(--material-brand); border-color: var(--material-brand); }
.quick-material-picker-body { display: grid; grid-template-columns: minmax(240px, .8fr) minmax(0, 1.6fr); min-height: 0; min-width: 0; overflow: hidden; }
.quick-material-list-pane { min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; padding: 16px; border-right: 1px solid var(--material-line); }
.quick-material-files { display: grid; gap: 8px; }
.quick-material-files button { display: grid; gap: 2px; width: 100%; min-width: 0; text-align: left; overflow-wrap: anywhere; }
.quick-material-files button.selected { background: #f6eee8; border-color: var(--material-brand); }
.quick-material-files small, .quick-material-version { color: var(--material-muted); font-size: 12px; }
.quick-material-detail-pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; padding: 12px 16px; gap: 8px; }
.quick-material-fields { display: flex; flex: none; align-items: center; gap: 8px; min-width: 0; }
.quick-material-selected-file { display: grid; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.quick-material-selected-file strong { max-height: 3.1em; overflow: auto; }
.quick-material-preview { flex: 1; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 12px; background: var(--material-paper); border: 1px solid var(--material-line); border-radius: 8px; }
.quick-material-preview img { display: block; width: 100%; height: auto; min-height: 0; flex: 1; object-fit: contain; }
.quick-material-preview audio { width: 100%; max-width: 100%; flex: none; }
.quick-material-preview pre { align-self: stretch; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.quick-material-pagination { display: flex; flex: none; align-items: center; gap: 8px; }
.quick-material-empty { margin: auto !important; color: var(--material-muted); }
.quick-material-picker footer { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding: 8px max(16px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); border-top: 1px solid var(--material-line); background: var(--material-paper); }
.quick-material-selection { flex: 1 1 100%; min-width: 0; }
.quick-material-selection summary { min-height: 44px; line-height: 44px; cursor: pointer; color: var(--material-muted); }
.quick-material-draft { max-height: min(120px, 20dvh); overflow: auto; }
.quick-request-error { color: #a13f35; }
.quick-material-picker button:focus-visible, .quick-material-picker summary:focus-visible, .quick-material-open:focus-visible { outline: 3px solid #923f3080; outline-offset: 2px; }
.quick-material-picker button:hover:not(:disabled), .quick-material-open:hover:not(:disabled) { box-shadow: inset 0 0 0 1px var(--material-brand, #923f30); }
.quick-material-picker button:disabled, .quick-material-open:disabled { opacity: .55; cursor: not-allowed; }
@media (max-width: 600px) {
  .quick-material-picker-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .quick-material-list-pane { border-right: 0; }
  .quick-material-detail-pane { padding: 8px 12px; border-top: 1px solid var(--material-line); }
  .quick-material-fields { flex-wrap: wrap; }
  .quick-material-selected-file { flex-basis: 100%; }
  .quick-material-preview { display: none; }
  .is-mobile-preview .quick-material-picker-body { grid-template-rows: minmax(0, 1fr); }
  .is-mobile-preview .quick-material-list-pane { display: none; }
  .is-mobile-preview .quick-material-detail-pane { min-height: 0; }
  .is-mobile-preview .quick-material-preview { display: flex; }
  .quick-material-picker header { padding-inline: 8px; }
  .quick-material-picker footer { padding-inline: 12px; }
}
</style>
