<template>
  <section v-if="model.enabled.value" class="hall-private-mark" aria-label="个人整理">
    <header><h4>个人整理</h4><button type="button" :disabled="model.busy.value" @click="model.load">重读整理状态</button></header>
    <p>仅整理自己的事项；已查看和收入案卷都不代表正式验收，也不会停止执行。</p>
    <p v-if="model.busy.value" role="status">正在核对…</p>
    <p v-if="model.error.value" role="alert">{{ model.error.value }}</p>
    <p v-if="model.mark.value">{{ model.mark.value.archived ? '已收入案卷' : '未收入案卷' }}{{ model.currentKnown.value ? '' : '（最新状态待核对）' }}。事项有新变化时可重新出现在最近事项。</p>
    <p v-if="viewedCurrent">当前这批固定成果已标记查看；有新成果时须再次核对。</p>
    <template v-if="model.pending.value">
      <p>原标记结果待核对。将使用同一个操作标识和原选择，不发起执行。</p>
      <button type="button" :disabled="model.busy.value" @click="reconcile">按原请求核对标记</button>
    </template>
    <template v-else-if="model.conflict.value">
      <p>保留的选择：{{ model.conflict.value.archived ? '收入案卷' : '不收入案卷' }}{{ model.conflict.value.viewedResultRef ? '，并标记这批成果已查看' : '' }}。</p>
      <button type="button" :disabled="model.busy.value || !model.currentKnown.value" @click="retryConflict">按当前版本重新确认</button>
      <button type="button" :disabled="model.busy.value" @click="model.cancelConflict">取消本次选择</button>
    </template>
    <template v-else-if="model.mark.value">
      <button type="button" :disabled="!canChange" @click="archive">{{ model.mark.value.archived ? '撤销收入案卷' : '收入案卷' }}</button>
      <button
        v-if="resultRef && !viewedCurrent"
        type="button"
        :disabled="!canChange"
        @click="viewResult"
      >明确标记这批成果已查看</button>
    </template>
  </section>
</template>
<script setup>
import { computed, watch } from 'vue'
import { sameMarkResult, useHallPrivateMark } from '@/composables/juyiting/useHallPrivateMark'

const props = defineProps({
  sourceRef: { type: Object, required: true },
  resultRef: { type: Object, default: null },
  identityScope: { type: String, default: '' },
  identityEpoch: { type: [Number, String], default: 0 }
})
const emit = defineEmits(['changed'])
const model = useHallPrivateMark({ sourceRef: () => props.sourceRef, identityScope: () => props.identityScope, identityEpoch: () => props.identityEpoch })
const canChange = computed(() => model.currentKnown.value && !model.busy.value && !model.pending.value)
const viewedCurrent = computed(() => props.resultRef && sameMarkResult(model.mark.value?.viewedResultRef, props.resultRef))
const notify = async operation => { if (await operation) emit('changed') }
const archive = () => notify(model.change({ archived: !model.mark.value.archived, viewedResultRef: null }))
const viewResult = () => notify(model.change({ archived: model.mark.value.archived, viewedResultRef: props.resultRef }))
const reconcile = () => notify(model.reconcile())
const retryConflict = () => notify(model.retryConflict())
watch([() => props.identityScope, () => props.identityEpoch, () => props.sourceRef.sourceType, () => props.sourceRef.sourceId], () => {
  void model.load()
}, { immediate: true })
</script>
<style scoped>
.hall-private-mark { display:flex; flex-wrap:wrap; gap:8px; padding:12px; border:1px solid #d7c3a2; border-radius:8px; }
.hall-private-mark header { display:flex; justify-content:space-between; align-items:center; width:100%; gap:8px; }
.hall-private-mark h4,.hall-private-mark p { margin:0; width:100%; }
.hall-private-mark p { font-size:13px; line-height:1.5; }
.hall-private-mark button { padding:6px 10px; min-height:34px; border:1px solid #b29a79; border-radius:6px; color:#5a3923; background:#fff8e8; }
.hall-private-mark button:disabled { opacity:.55; }
</style>
