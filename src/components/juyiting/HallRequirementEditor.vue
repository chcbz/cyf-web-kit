<template>
  <p v-if="error && !dialogOpen" class="requirement-edit-error" role="alert">{{ error }} <button type="button" :disabled="busy" @click="open(lastField)">重试</button></p>
  <HallMaterialPicker ref="picker" dialog-only :model-value="materials" :enabled="enabled" :disabled="blocked"
    :identity-scope="identityScope" :identity-epoch="identityEpoch" @update:model-value="saveMaterials" />
  <Teleport to="body">
    <dialog v-if="dialogOpen" ref="dialog" class="requirement-edit-dialog" :aria-label="dialogTitle" @cancel.prevent="close">
      <header><h3>{{ dialogTitle }}</h3><button type="button" aria-label="关闭编辑" :disabled="busy" @click="close">关闭</button></header>
      <label v-if="lastField !== 'files'">{{ lastField === 'title' ? '事项标题' : '需求描述' }}
        <input v-if="lastField === 'title'" ref="field" v-model="title" maxlength="200" :disabled="blocked" />
        <textarea v-else ref="field" v-model="description" rows="7" maxlength="20000" :disabled="blocked" />
      </label>
      <p v-else>所选资料修改尚待保存，请核对原保存结果。</p>
      <p>保存后重新推荐承办，不会自动开始办理。</p>
      <p v-if="error" class="requirement-edit-error" role="alert">{{ error }}</p>
      <footer>
        <button type="button" :disabled="busy" @click="close">{{ pending ? '关闭' : '取消' }}</button>
        <button v-if="pending" type="button" :disabled="busy" @click="checkSave">查询保存结果</button>
        <button type="button" :disabled="busy" @click="saveText">{{ busy ? '正在保存…' : pending ? '继续原保存' : '保存' }}</button>
      </footer>
    </dialog>
  </Teleport>
</template>
<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { agentApi } from '@/composables/useHttp'
import { useHallRequirementEdit } from '@/composables/juyiting/useHallRequirementEdit.js'
import HallMaterialPicker from './HallMaterialPicker.vue'
const props = defineProps({ task: { type: Object, required: true }, enabled: Boolean, identityScope: { type: String, default: '' }, identityEpoch: { type: [Number, String], default: 0 } })
const emit = defineEmits(['saved', 'busy'])
const picker = ref(null), dialog = ref(null), field = ref(null), dialogOpen = ref(false), lastField = ref('title')
const title = ref(''), description = ref(''), materials = ref([])
let returnFocus = null
const { snapshot, busy, error, pending, blocked, load, save, check } = useHallRequirementEdit({
  agentApi, task: () => props.task, identity: () => `${props.identityScope}\u0000${props.identityEpoch}`,
  enabled: () => props.enabled, onSaved: value => emit('saved', value)
})
watch(blocked, value => emit('busy', value), { flush: 'sync' })
watch(() => [props.identityScope, props.identityEpoch, props.task.id, props.enabled], () => {
  dialog.value?.close(); dialogOpen.value = false
})
const dialogTitle = computed(() => lastField.value === 'files' ? '保存资料' : `修改${lastField.value === 'title' ? '事项标题' : '需求描述'}`)
const showDialog = async () => { dialogOpen.value = true; await nextTick(); dialog.value?.showModal(); field.value?.focus() }
const open = async name => {
  if (!props.enabled || busy.value) return
  returnFocus = document.activeElement; lastField.value = name
  if (pending.value) { await showDialog(); return }
  if (!await load()) return
  title.value = snapshot.value.title; description.value = snapshot.value.description || ''
  materials.value = snapshot.value.attachments.map(a => ({ ...a, displayName: `资料 ${a.fileId}` }))
  if (name === 'files') { await nextTick(); picker.value?.open() } else await showDialog()
}
const close = () => { if (busy.value) return; dialog.value?.close(); dialogOpen.value = false; returnFocus?.isConnected && returnFocus.focus() }
const saveText = async () => {
  if (await save({ title: title.value, description: description.value, attachments: materials.value })) close()
}
const checkSave = async () => { if (await check()) close() }
const saveMaterials = async selected => {
  materials.value = selected
  if (!await save({ title: title.value, description: description.value, attachments: selected })) await showDialog()
}
defineExpose({ open })
</script>
<style scoped>
.requirement-edit-dialog{box-sizing:border-box;width:min(560px,calc(100vw - 24px));max-height:calc(100dvh - 32px);overflow:auto;padding:20px;border:1px solid var(--hall-border,#ddd);border-radius:12px;background:var(--hall-surface,#fff);color:var(--hall-text,#293c34)}
.requirement-edit-dialog::backdrop{background:#0006}.requirement-edit-dialog header,.requirement-edit-dialog footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.requirement-edit-dialog h3{margin:0}.requirement-edit-dialog footer{justify-content:flex-end;flex-wrap:wrap}.requirement-edit-dialog label{display:grid;gap:8px;margin-top:16px}.requirement-edit-dialog input,.requirement-edit-dialog textarea{box-sizing:border-box;width:100%;min-width:0;padding:10px;font:inherit}.requirement-edit-dialog button{min-height:44px;padding:8px 14px}.requirement-edit-error{color:var(--hall-danger,#a3342b)}
</style>
