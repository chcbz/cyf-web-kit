<template>
  <section class="hall-task-resources" :aria-label="completed ? '事项资料' : '资料与成果'">
    <h4>{{ completed ? '事项资料' : '资料与成果' }}</h4>
    <p v-if="loading" role="status">正在读取资料与成果…</p>
    <div v-else-if="error" role="alert"><p>{{ error }}</p><button type="button" @click="load">重试</button></div>
    <template v-else>
      <HallMaterialPicker :model-value="materials" read-only :identity-scope="identityScope" :identity-epoch="identityEpoch" />
      <p v-if="!materials.length">暂无关联资料。</p>
      <p v-if="completed">成果及验收情况请在“查看成果与验收记录”中核对。</p>
      <p v-else-if="resultCount != null">{{ resultCount ? `本轮已有 ${resultCount} 份成果，可在议事中查看。` : '当前尚无正式成果。' }}</p>
      <p v-else>{{ outputCount ? `已有 ${outputCount} 份成果引用，可在议事中查看。` : '尚无成果引用；正式成果数量待核对。' }}</p>
      <p v-if="outputCount && !completed" class="resource-note">正式提交与验收状态以验收页面为准。</p>
    </template>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { usePersonalWorkspaceTaskLinks } from '@/composables/usePersonalWorkspaceTaskLinks'
import { usePersonalWorkspace } from '@/composables/usePersonalWorkspace'
import HallMaterialPicker from './HallMaterialPicker.vue'

const props = defineProps({ completed: { type: Boolean, default: false }, resultCount: { type: Number, default: null }, taskId: { type: String, required: true }, identityScope: { type: String, default: '' }, identityEpoch: { type: [Number, String], default: 0 } })
const emit = defineEmits(['summary'])
const identity = computed(() => `${props.identityScope}\u0000${props.identityEpoch}`)
const links = usePersonalWorkspaceTaskLinks({ taskId: () => props.taskId, identityEpoch: identity })
const workspace = usePersonalWorkspace({ identityEpoch: identity })
const materials = ref([]), outputCount = ref(0), loading = ref(true), error = ref('')
let generation = 0
const load = async () => {
  const token = ++generation
  materials.value = []; outputCount.value = 0; loading.value = true; error.value = ''
  emit('summary', null)
  const rows = await links.loadAll()
  if (token !== generation) return
  if (!rows) { error.value = links.error.value || '资料与成果暂无法读取，请重试。'; loading.value = false; return }
  const active = rows.filter(row => row.state === 'ACTIVE')
  const inputs = [...new Map(active.filter(row => ['INPUT', 'REFERENCE'].includes(row.role)).map(row => [`${row.fileId}:${row.version}`, row])).values()]
  outputCount.value = new Set(active.filter(row => row.role === 'OUTPUT').map(row => `${row.fileId}:${row.version}`)).size
  materials.value = inputs.map(row => ({ fileId: row.fileId, version: row.version, displayName: `资料 ${row.fileId}` }))
  loading.value = false
  emit('summary', { taskId: props.taskId, materials: materials.value.length, outputs: outputCount.value })
  const names = new Map()
  for (const row of inputs) {
    if (token !== generation) return
    if (!names.has(row.fileId)) {
      const detail = await workspace.select(row.fileId)
      if (token !== generation) return
      names.set(row.fileId, detail?.file?.displayName || `资料 ${row.fileId}`)
    }
    materials.value = materials.value.map(item => item.fileId === row.fileId ? { ...item, displayName: names.get(row.fileId) } : item)
  }
}
watch(() => [props.taskId, identity.value], () => { void load() }, { immediate: true, flush: 'post' })
onBeforeUnmount(() => { generation += 1 })
</script>
<style scoped>
.hall-task-resources { margin-top: 16px; padding: 16px; border: 1px solid #e8e4da; border-radius: 14px; background: #fffefb; min-width: 0; }
h4 { margin: 0 0 12px; color: #29352f; }
p { color: #758078; line-height: 1.6; font-size: 13px; }
.resource-note { font-size: 12px; }
button { border: 1px solid #e2e5dc; border-radius: 8px; background: #f5f5f0; color: #29352f; padding: 8px 12px; }
:deep(.quick-material-summary) { margin: 0; }
:deep(.quick-material-summary li) { min-width: 0; }
:deep(.quick-material-summary strong) { white-space: normal; overflow-wrap: anywhere; }
</style>
