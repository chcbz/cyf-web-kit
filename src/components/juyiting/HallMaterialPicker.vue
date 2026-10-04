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
      <section
        v-if="materialPickerOpen"
        class="quick-material-picker"
        role="region"
        aria-label="选择资料"
      >
        <header><button type="button" @click="cancelQuickMaterialPicker">返回</button><div><h3>选择资料</h3><p>从工作空间选择图片、文档或音频。</p></div></header>
        <div class="quick-material-picker-body">
          <p v-if="workspace.listState.value === 'loading'" role="status">正在读取你的资料…</p>
          <p v-else-if="workspace.error.value" class="quick-request-error" role="alert">{{ workspace.error.value }}</p>
          <div v-else-if="workspace.items.value.length" class="quick-material-files" aria-label="可选资料">
            <button
              v-for="file in workspace.items.value"
              :key="file.fileId"
              type="button"
              :class="{ selected: pickerFileId === file.fileId }"
              @click="selectQuickMaterialFile(file.fileId)"
            ><strong>{{ file.displayName }}</strong><small>最新 v{{ file.latestVersion }}</small></button>
          </div>
          <p v-else-if="workspace.listState.value === 'empty'">暂无资料，也可以直接提需求。</p>
          <button
            v-if="workspace.nextCursor.value"
            type="button"
            :disabled="workspace.loading.value"
            @click="loadMoreQuickMaterials"
          >加载更多</button>
        </div>
        <footer>
          <div v-if="pickerDetail" class="quick-material-fields">
            <span class="quick-material-version">已固定 v{{ pickerVersion }} · 版本管理在工作空间</span>
            <button type="button" :disabled="!pickerVersion" @click="previewQuickMaterial">预览</button><button type="button" :disabled="!pickerVersion" @click="downloadQuickMaterial">下载</button><button
              type="button"
              class="primary"
              :disabled="!pickerVersion"
              @click="stageQuickMaterial"
            >添加</button>
          </div>
          <section v-if="materialPreview.kind !== 'none'" class="quick-material-preview" v-bind="{ 'aria-label': '资料预览', 'aria-live': 'polite' }">
            <div v-if="materialPreview.kind === 'parts'"><button type="button" :disabled="materialPreview.selectedIndex === 0" @click="workspace.selectPreviewPart(materialPreview.selectedIndex - 1)">上一项</button><span>{{ materialPreview.selectedIndex + 1 }}/{{ materialPreview.parts.length }}</span><button type="button" :disabled="materialPreview.selectedIndex >= materialPreview.parts.length - 1" @click="workspace.selectPreviewPart(materialPreview.selectedIndex + 1)">下一项</button></div>
            <img v-if="materialPreviewPart?.kind === 'image'" :src="materialPreviewPart.url" alt="资料预览" />
            <audio v-else-if="materialPreviewPart?.kind === 'audio'" :src="materialPreviewPart.url" v-bind="{ controls: true, preload: 'none', 'aria-label': '音频预览' }"></audio>
            <pre v-else-if="materialPreviewPart?.kind === 'text'" v-text="materialPreviewPart.text"></pre>
            <p v-if="materialPreview.message">{{ materialPreview.message }}</p>
          </section>
          <ul v-if="draftMaterials.length" class="quick-material-draft" aria-label="已选资料">
            <li v-for="material in draftMaterials" :key="materialKey(material)"><span>{{ material.displayName }} · v{{ material.version }}</span><button type="button" @click="removeDraftMaterial(material)">移除</button></li>
          </ul>
          <button type="button" class="quick-material-confirm" @click="confirmQuickMaterials">完成（{{ draftMaterials.length }}）</button>
          <button type="button" @click="cancelQuickMaterialPicker">取消</button>
        </footer>
      </section>
    </Teleport>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
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
const resetMaterialPicker = () => { pickerGeneration += 1; pickerFileId.value = ''; pickerVersion.value = null; workspace.detail.value = null; workspace.revokePreview?.() }
const openQuickMaterialPicker = async () => {
  if (!props.enabled || !props.identityScope || props.disabled) return
  draftMaterials.value = selectedMaterials.value.map(material => ({ ...material }))
  resetMaterialPicker()
  materialPickerOpen.value = true
  await workspace.refresh({ state: 'ACTIVE' })
}
const cancelQuickMaterialPicker = () => { materialPickerOpen.value = false; draftMaterials.value = []; resetMaterialPicker() }
const loadMoreQuickMaterials = () => workspace.loadMore({ state: 'ACTIVE' })
const selectQuickMaterialFile = async fileId => {
  const operationIdentity = materialIdentityKey.value, generation = pickerGeneration
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
  pickerVersion.value = material.version
  await previewQuickMaterial()
}
const stageQuickMaterial = () => {
  if (props.disabled || !materialPickerOpen.value) return
  const detail = pickerDetail.value
  const version = Number(pickerVersion.value)
  if (!detail || !Number.isSafeInteger(version) || !detail.versions.some(item => item.version === version)) return
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
onBeforeUnmount(() => { pickerGeneration += 1; workspace.dispose() })
</script>

<style scoped>

.quick-material-preview { max-height: 300px; overflow: auto; min-width: 0; }
.quick-material-preview img, .quick-material-preview audio { max-width: 100%; }
.quick-material-preview pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.quick-material-open>span{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#923f30;color:#fff;font-size:11px}.quick-material-summary,.quick-material-draft{display:grid;gap:7px;margin:12px 0 0;padding:0;list-style:none}.quick-material-summary li,.quick-material-draft li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border:1px solid #e3e5dc;border-radius:8px;background:#f8f6f0}.quick-material-summary li>span{display:grid;min-width:0}.quick-material-summary strong,.quick-material-summary small{overflow-wrap:anywhere}.quick-material-summary small{color:#68716b;font-size:11px}.quick-material-summary button,.quick-material-draft button{min-height:34px!important;padding:5px 9px!important;flex:none}
.quick-material-picker{--material-ground:#f3f3ed;--material-paper:#fffefa;--material-ink:#242e2b;--material-muted:#68716b;--material-line:#d8d8ce;--material-brand:#923f30;--material-brand-surface:#f6eee8;position:fixed;inset:0;z-index:1400;display:grid;grid-template-rows:auto minmax(0,1fr) auto;width:100%;height:100%;height:100dvh;box-sizing:border-box;background:var(--material-ground);color:var(--material-ink);font:400 14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}.quick-material-picker header{display:flex;align-items:center;gap:12px;padding:max(12px,env(safe-area-inset-top)) 16px 12px;border-bottom:1px solid var(--material-line);background:var(--material-paper);box-shadow:0 1px 2px rgba(36,46,43,.04)}.quick-material-picker h3,.quick-material-picker p{margin:0}.quick-material-picker h3{font-size:18px;line-height:1.35}.quick-material-picker header p{margin-top:3px;color:var(--material-muted);font-size:13px;line-height:1.5}.quick-material-picker button,.quick-material-picker select{min-height:42px;border:1px solid var(--material-line);border-radius:8px;background:var(--material-paper);color:var(--material-ink);font:inherit}.quick-material-picker header>button{flex:none;min-width:56px}.quick-material-picker button{padding:8px 12px;cursor:pointer}.quick-material-picker button.primary,.quick-material-confirm{background:var(--material-brand)!important;border-color:var(--material-brand)!important;color:var(--material-paper)!important}.quick-material-picker-body{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:16px max(16px,env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}.quick-material-files{display:grid;gap:10px}.quick-material-files button{display:grid;gap:4px;width:100%;min-height:64px;padding:12px 14px;text-align:left;box-shadow:0 1px 2px rgba(36,46,43,.04)}.quick-material-files button.selected{border-color:var(--material-brand);background:var(--material-brand-surface)}.quick-material-files small{color:var(--material-muted)}.quick-material-picker footer{display:grid;gap:10px;padding:12px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));border-top:1px solid var(--material-line);background:var(--material-paper);box-shadow:0 -8px 24px rgba(36,46,43,.08)}.quick-material-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:10px;align-items:end}.quick-reference-note{margin:0;color:var(--material-muted);font-size:12px;line-height:1.5}.quick-material-fields label{display:grid;gap:5px;color:var(--material-muted);font-size:12px}.quick-material-fields select{min-width:0;padding:0 10px}.quick-material-picker button:focus-visible,.quick-material-picker select:focus-visible{outline:3px solid color-mix(in srgb,var(--material-brand) 52%,transparent);outline-offset:2px}@media(max-width:600px){.quick-material-fields{grid-template-columns:1fr}.quick-material-picker footer{max-height:48dvh;overflow-y:auto}}

.hall-material-picker { min-width: 0; }
.quick-request-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; margin-top: 14px; }
.quick-request-actions button { display: inline-flex; gap: 6px; align-items: center; min-height: 42px; padding: 8px 12px; }
.quick-request-error { color: #a13f35; }
.quick-material-open { border: 1px solid #d8d8ce; border-radius: 8px; background: #fffefa; color: #242e2b; font: inherit; cursor: pointer; }
.quick-material-picker button:disabled, .quick-material-open:disabled { cursor: not-allowed; opacity: .55; }
.quick-material-summary li > span, .quick-material-draft li > span { overflow-wrap: anywhere; }
@media(max-width:600px) { .quick-material-summary li { flex-wrap: wrap; } }
</style>
