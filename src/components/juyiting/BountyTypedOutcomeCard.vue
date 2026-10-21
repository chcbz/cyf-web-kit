<template>
  <article class="typed-outcome-card" :class="`typed-${outcome.kind.toLowerCase()}`">
    <header><strong>{{ heading }}</strong><small>{{ inspection ? '资料答复' : 'Agent 答复' }}</small></header>
    <p class="typed-outcome-text">{{ body }}</p>
    <small v-if="submission?.state === 'FAILED' || outcome.kind === 'SUBMISSION_REQUEST'" class="typed-submission-note" role="status">{{ submissionHint }}</small>
    <small v-if="reviewHint" class="typed-submission-note" role="status">{{ reviewHint }}</small>
    <template v-if="outcome.kind === 'CLARIFY'">
      <p class="typed-question">{{ outcome.clarification.question }}</p>
      <button v-if="outcome.clarification.state === 'OPEN' && !readOnly" type="button" @click="$emit('reply', projection)">回答此问</button>
      <small v-else class="typed-state">{{ outcome.clarification.state === 'OPEN' ? '事项已结束，保留历史问题' : '已收到补充' }}</small>
    </template>
    <template v-else-if="outcome.kind === 'EXECUTION_PROPOSAL'">
      <small>如需调整，请在会话中继续说明。</small>
    </template>
  </article>
</template>

<script setup>
import { computed } from 'vue'
import { revisionProgressHint } from '../../composables/juyiting/hallTypedDeliberation.js'
const props = defineProps({ projection: { type: Object, required: true }, readOnly: { type: Boolean, default: false } })
defineEmits(['reply'])
const outcome = computed(() => props.projection.outcome)
const inspection = computed(() => props.projection?.purpose === 'INSPECT')
const progress = computed(() => props.projection.actionProgress)
const submission = computed(() => props.projection.submissionProgress)
const reviewHint = computed(() => revisionProgressHint(props.projection.reviewProgress))
const submissionHint = computed(() => outcome.value?.kind === 'SUBMISSION_REQUEST' && submission.value?.state !== 'FAILED'
  ? submission.value?.state === 'COMPLETED' ? '成果已提交，请查看并验收。' : '正在核对提交结果，请勿重复提交。'
  : submission.value?.errorCode === 'DELIVERY_REVIEW_REQUIRED'
  ? '已有成果待验收，本轮答复未替换原批次。需要修改可在原议事继续说明。'
  : '成果提交未完成，原答复和文件已保留；可在原议事继续说明。')
const heading = computed(() => outcome.value?.kind === 'ACTION_REQUEST'
  ? ({ QUEUED: '等待处理', RUNNING: '正在处理', WAITING_PROVIDER: '等待工具结果', RESULT_UNKNOWN: '结果待核实', ARCHIVING: '已生成，登记中', COMPLETED: '本轮完成', FAILED: '未完成', CANCELLED: '已取消' })[progress.value?.state]
  : ({ SUBMISSION_REQUEST: '提交已有成果', REVISION_REQUEST: '修改要求', ANSWER: '议事答复', CLARIFY: '需要补充', EXECUTION_PROPOSAL: 'Agent 建议' })[outcome.value?.kind] || '议事结果')
const body = computed(() => outcome.value?.kind === 'SUBMISSION_REQUEST'
  ? '提交已生成的成果，不重新生成，也不自动验收。'
  : outcome.value?.kind === 'ACTION_REQUEST'
  ? ({ COMPLETED: '请查看会话中的答复或文件。', FAILED: '这次未完成，可以继续补充需求。', CANCELLED: '本次处理已取消。' })[progress.value?.state] || outcome.value.text
  : outcome.value?.text)
</script>

<style scoped>
.typed-outcome-card { margin: 8px 0 12px; padding: 12px; border: 1px solid #b8d4c6; border-radius: 10px; background: #f2faf5; color: #203a2f; }
.typed-outcome-card header { display:flex; justify-content:space-between; gap:12px; } .typed-outcome-card header small,.typed-outcome-card>small { color:#557267; font-size:12px; }
.typed-outcome-text,.typed-question,.typed-proposal { margin:8px 0; white-space:pre-wrap; } .typed-outcome-card button { margin-top:10px; border:0; border-radius:6px; padding:7px 10px; background:#276348; color:#fff; cursor:pointer; }
.typed-execution_proposal { border-color:#d9b56c; background:#fffbeb; }.typed-state{display:block;margin-top:8px}
</style>

<style scoped>
.typed-submission-note { display:block; margin-top:8px; color:#76572b; line-height:1.5; }
</style>
