<template>
  <section class="hall-reference-picker" aria-label="需求草稿参考图片">
    <header class="reference-picker-head">
      <div>
        <strong>参考图片（可选）</strong>
        <p>仅加入当前需求草稿；不会创建事项、关联资料、授权 Agent 或调用外部 Provider。</p>
      </div>
      <button
        type="button"
        class="reference-close"
        aria-label="关闭参考图片选择"
        @click="closePicker"
      >×</button>
    </header>

    <div class="reference-toolbar">
      <button type="button" :disabled="disabled || state === 'loading-list'" @click="refresh">
        {{ state === 'loading-list' ? '读取中…' : '从个人工作空间选择' }}
      </button>
      <span>{{ selected.length }}/{{ HALL_REFERENCE_MAX_ITEMS }}</span>
    </div>

    <p v-if="error" class="reference-error" role="alert">{{ error }}</p>
    <p v-if="!selected.length" class="reference-empty" role="status">不选参考图也可以继续填写并提交需求。</p>

    <div v-if="selected.length" class="reference-selected" aria-label="已选精确版本">
      <article v-for="item in selected" :key="`${item.fileId}:${item.version}`" class="reference-card">
        <img :src="item.previewUrl" :alt="`${item.displayName} 第 ${item.version} 版预览`" />
        <div>
          <strong>{{ item.displayName }}</strong>
          <small>固定版本 v{{ item.version }} · {{ item.contentMimeType }}</small>
        </div>
        <button type="button" :disabled="disabled" @click="removeReference(item.fileId, item.version)">移除</button>
      </article>
    </div>

    <div v-if="items.length" class="reference-workspace-list" aria-label="工作空间图片">
      <button
        v-for="file in items"
        :key="file.fileId"
        type="button"
        :class="{ active: currentDetail?.fileId === file.fileId }"
        :disabled="disabled"
        @click="openFile(file.fileId)"
      >
        <span>{{ file.displayName }}</span>
        <small>当前 v{{ file.latestVersion }}</small>
      </button>
    </div>
    <p v-else-if="listState === 'empty'" class="reference-empty">当前工作空间没有可选择的有效图片。</p>

    <section v-if="currentDetail" class="reference-version-list" aria-label="选择固定图片版本">
      <h4>{{ currentDetail.displayName }}</h4>
      <p>请选择明确版本；以后出现新版本也不会替换已选旧版本。</p>
      <button
        v-for="version in currentDetail.versions"
        :key="version.version"
        type="button"
        :disabled="disabled || !version.supported || state === 'loading-preview'"
        @click="addReference(currentDetail.fileId, version.version)"
      >
        v{{ version.version }} · {{ version.contentMimeType || '未知格式' }}
        <span v-if="!version.supported">（仅支持 JPEG/PNG）</span>
      </button>
    </section>
  </section>
</template>

<script setup>
import { computed, toRef, watch } from 'vue'
import {
  HALL_REFERENCE_MAX_ITEMS,
  useHallReferenceImageSelection
} from '../../composables/juyiting/hallReferenceImageSelection.js'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  identityScope: { type: String, default: '' },
  identityEpoch: { type: Number, default: 0 },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'close'])
const identityGeneration = computed(() => `${props.identityScope}\u0000${props.identityEpoch}`)

const {
  items,
  listState,
  currentDetail,
  selected,
  draftReferences,
  state,
  error,
  refresh,
  openFile,
  addReference,
  replaceReferences,
  removeReference,
  close
} = useHallReferenceImageSelection({
  identityEpoch: identityGeneration
})

let syncingModel = false
let modelSyncRequest = 0
const signature = references => Array.isArray(references)
  ? JSON.stringify(references.map(reference => [reference?.fileId, reference?.version, reference?.purpose]))
  : 'invalid'

watch(() => props.modelValue, async references => {
  if (signature(references) === signature(draftReferences.value)) return
  const request = ++modelSyncRequest
  syncingModel = true
  const validated = await replaceReferences(references)
  if (request !== modelSyncRequest) return
  syncingModel = false
  emit('update:modelValue', (validated || []).map(reference => ({ ...reference })))
}, { deep: true, immediate: true })

watch(draftReferences, references => {
  if (!syncingModel) emit('update:modelValue', references.map(reference => ({ ...reference })))
})

watch(toRef(props, 'disabled'), value => {
  if (value) currentDetail.value = null
})

const closePicker = () => {
  close()
  emit('close')
}
</script>

<style scoped>
.hall-reference-picker {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(103, 76, 42, 0.24);
  border-radius: 12px;
  background: rgba(255, 252, 242, 0.96);
  color: #332719;
}
.reference-picker-head,
.reference-toolbar,
.reference-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.reference-picker-head p,
.reference-version-list p {
  margin: 4px 0 0;
  color: #735f47;
  font-size: 12px;
}
.reference-close {
  font-size: 20px;
}
.reference-error {
  margin: 0;
  color: #a52b20;
}
.reference-empty {
  margin: 0;
  color: #735f47;
}
.reference-selected,
.reference-workspace-list,
.reference-version-list {
  display: grid;
  gap: 8px;
}
.reference-card {
  padding: 8px;
  border: 1px solid rgba(103, 76, 42, 0.18);
  border-radius: 9px;
}
.reference-card img {
  width: 64px;
  height: 64px;
  flex: none;
  border-radius: 7px;
  object-fit: cover;
}
.reference-card div {
  display: grid;
  flex: 1;
  gap: 4px;
  min-width: 0;
}
.reference-card strong,
.reference-card small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reference-workspace-list button,
.reference-version-list button {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 9px;
  border: 1px solid rgba(103, 76, 42, 0.2);
  border-radius: 8px;
  background: #fffdf7;
  text-align: left;
}
.reference-workspace-list button.active {
  border-color: #9a632c;
  background: #fff4d9;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
