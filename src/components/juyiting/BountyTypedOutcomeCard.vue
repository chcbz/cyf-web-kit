<template>
  <article class="typed-outcome-card" :class="`typed-${outcome.kind.toLowerCase()}`">
    <header><strong>{{ heading }}</strong><small>{{ inspection ? '查阅结果（不等于资料理解已验）' : '结构化议事结果' }}</small></header>
    <p class="typed-outcome-text">{{ outcome.text }}</p>
    <template v-if="outcome.kind === 'CLARIFY'">
      <p class="typed-question">{{ outcome.clarification.question }}</p>
      <small>待补充：{{ outcome.clarification.requiredFacts.join('、') }}</small>
      <button v-if="outcome.clarification.state === 'OPEN'" type="button" @click="$emit('reply', projection)">回答此问</button>
      <small v-else class="typed-state">已收到补充</small>
    </template>
    <template v-else-if="outcome.kind === 'EXECUTION_PROPOSAL'">
      <p class="typed-proposal">{{ operationLabel }}</p>
      <small>提议不会自行办理、扣费或开始 Provider 请求；确认后仍需核对预览并明确同意。</small>
      <button type="button" @click="$emit('confirm-proposal', projection)">确认办理并查看预览</button>
    </template>
  </article>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ projection: { type: Object, required: true } })
defineEmits(['reply', 'confirm-proposal'])
const outcome = computed(() => props.projection.outcome)
const inspection = computed(() => props.projection?.purpose === 'INSPECT')
const heading = computed(() => ({ ANSWER: '议事答复', CLARIFY: '需要补充', EXECUTION_PROPOSAL: '办理提议' })[outcome.value?.kind] || '议事结果')
const operationLabel = computed(() => outcome.value?.proposal?.operation === 'EDIT_IMAGE' ? '建议修改上一稿图像' : '建议生成一张图像')
</script>

<style scoped>
.typed-outcome-card { margin: 8px 0 12px; padding: 12px; border: 1px solid #b8d4c6; border-radius: 10px; background: #f2faf5; color: #203a2f; }
.typed-outcome-card header { display:flex; justify-content:space-between; gap:12px; } .typed-outcome-card header small,.typed-outcome-card>small { color:#557267; font-size:12px; }
.typed-outcome-text,.typed-question,.typed-proposal { margin:8px 0; white-space:pre-wrap; } .typed-outcome-card button { margin-top:10px; border:0; border-radius:6px; padding:7px 10px; background:#276348; color:#fff; cursor:pointer; }
.typed-execution_proposal { border-color:#d9b56c; background:#fffbeb; }.typed-state{display:block;margin-top:8px}
</style>
