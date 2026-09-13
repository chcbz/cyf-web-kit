<template>
  <section class="artifact-outcome-panel" aria-labelledby="artifact-outcome-heading">
    <header><span>成果裁决</span><h3 id="artifact-outcome-heading">确认权威接受与取代</h3></header>
    <p class="artifact-outcome-note">仅服务端“已接受”记录是权威状态。工作台仅提供当前可见成果引用，未提供历史裁决版本，绝不据此推断接受或取代。</p>

    <section aria-labelledby="accepted-outcomes-heading">
      <div class="artifact-outcome-heading"><h4 id="accepted-outcomes-heading">权威已接受成果</h4><button type="button" :disabled="outcomes.busy" @click="outcomes.refreshAccepted">刷新权威结果</button></div>
      <p
        class="artifact-outcome-status"
        :class="`is-${outcomes.acceptedState}`"
        role="status"
        aria-live="polite"
      >{{ outcomes.acceptedMessage || '尚未读取权威接受结果。' }}</p>
      <p v-if="outcomes.acceptedState === 'inaccessible'" class="artifact-outcome-warning" role="alert">不可访问不等于没有结果。</p>
      <p v-else-if="outcomes.acceptedState === 'unavailable'" class="artifact-outcome-warning" role="alert">服务不可用不等于没有结果。</p>
      <p v-else-if="outcomes.acceptedState === 'conflict'" class="artifact-outcome-warning" role="alert">版本冲突不等于没有结果；请刷新后重新选择。</p>
      <ul v-if="outcomes.accepted.length" class="artifact-outcome-list" aria-label="服务端确认的已接受成果">
        <li v-for="row in outcomes.accepted" :key="`${row.artifactId}:${row.artifactVersion}`">
          <label><input
            type="checkbox"
            :disabled="outcomes.busy || outcomes.refreshRequired"
            :checked="outcomes.supersededSelections.includes(`${row.artifactId}\u0000${row.artifactVersion}`)"
            @change="outcomes.toggleSuperseded(row)"
          />取代</label>
          <strong>{{ row.title }}</strong><span>{{ row.artifactId }} · v{{ row.artifactVersion }} · 裁决 v{{ row.outcomeVersion }}</span><span>{{ row.artifactType }} · {{ row.visibility }} · 产出者 {{ row.producerAgentId }}<template v-if="row.workItemId"> · 工作项 {{ row.workItemId }}</template></span><span>内容哈希 {{ row.contentHash }} · 决策 {{ row.decisionId }}</span><span>由 {{ row.decidedByAgentId }} 于 {{ formatTime(row.decidedAt) }} 接受</span>
        </li>
      </ul>
    </section>

    <form class="artifact-outcome-form" @submit.prevent="outcomes.accept">
      <h4>明确确认一次裁决</h4>
      <label>当前工作台可见成果
        <select
          :disabled="outcomes.busy || outcomes.refreshRequired"
          :value="outcomes.acceptedSelection"
          required
          @change="selectArtifact"
        >
          <option value="">请选择一个当前可见成果</option>
          <option v-for="artifact in outcomes.workspaceArtifacts" :key="artifact.key" :value="artifact.key">{{ artifact.title }} · {{ artifact.artifactId }} · v{{ artifact.artifactVersion }}</option>
        </select>
      </label>
      <p v-if="!outcomes.workspaceArtifacts.length" class="artifact-outcome-warning">当前工作台未提供可选成果；不能猜测历史版本或成果状态。</p>
      <p class="artifact-outcome-note">仅接受尚未裁决的成果：提交以裁决版本 0 为前提，由服务器原子核验，不代表工作台已确认其状态。已经接受或取代的历史成果不能重新接受，请提交新的成果版本。</p>
      <label class="artifact-outcome-confirm"><input v-model="outcomes.confirmed" :disabled="outcomes.busy || outcomes.refreshRequired" type="checkbox" />我确认接受所选成果，并取代勾选的服务端已接受成果。</label>
      <p
        v-if="outcomes.submitMessage"
        class="artifact-outcome-status"
        :class="`is-${outcomes.submitState}`"
        role="status"
        aria-live="polite"
      >{{ outcomes.submitMessage }}</p>
      <p v-if="outcomes.submitState === 'conflict'" class="artifact-outcome-warning" role="alert">请刷新权威结果并重新选择；系统不会盲目重试。</p>
      <p v-if="outcomes.submitState === 'unknown'" class="artifact-outcome-warning" role="alert">网络结果不明确；请刷新权威结果确认，系统不会重发。</p>
      <button type="submit" :disabled="!outcomes.canSubmit">{{ outcomes.submitState === 'submitting' ? '正在确认…' : '确认权威接受' }}</button>
    </form>
  </section>
</template>
<script setup>
import { onBeforeUnmount, reactive } from 'vue'
import { useHallArtifactOutcomes } from '@/composables/juyiting/useHallArtifactOutcomes'
const props = defineProps({ subject: { type: Object, default: null }, workspace: { type: Object, default: null }, identityEpoch: { type: [Number, String], default: 0 }, api: { type: Object, default: null } })
const outcomes = reactive(useHallArtifactOutcomes({ api: props.api || undefined, subject: () => props.subject, workspace: () => props.workspace, identityEpoch: () => props.identityEpoch }))
const selectArtifact = event => { const artifact = outcomes.workspaceArtifacts.find(item => item.key === event.target.value); if (artifact) outcomes.selectArtifact(artifact); else outcomes.acceptedSelection = '' }
const formatTime = value => Number.isSafeInteger(value) ? new Date(value).toLocaleString() : '时间不可用'
onBeforeUnmount(() => outcomes.dispose())
</script>
<style scoped>
.artifact-outcome-panel{display:grid;gap:12px;padding:16px;border-top:1px solid #ded3bf;color:#3d332a;background:#fffdf7}.artifact-outcome-panel header h3,.artifact-outcome-panel header span,.artifact-outcome-panel h4,.artifact-outcome-panel p{margin:0}.artifact-outcome-panel header span,.artifact-outcome-note{color:#6c6258;font-size:13px}.artifact-outcome-panel h3{font-size:18px;color:#213d34}.artifact-outcome-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.artifact-outcome-heading button,.artifact-outcome-form button{border:1px solid #315d4e;border-radius:4px;padding:6px 10px;color:#fff;background:#315d4e}.artifact-outcome-heading button[disabled],.artifact-outcome-form button[disabled]{opacity:.55}.artifact-outcome-status,.artifact-outcome-warning{padding:8px;border-radius:6px;background:#e8f2ed}.artifact-outcome-status.is-inaccessible,.artifact-outcome-status.is-conflict,.artifact-outcome-status.is-error,.artifact-outcome-status.is-unknown,.artifact-outcome-warning{color:#7a3026;background:#fae7e1}.artifact-outcome-status.is-unavailable{color:#765d2d;background:#f7edcf}.artifact-outcome-list{display:grid;gap:7px;margin:8px 0 0;padding:0;list-style:none}.artifact-outcome-list li{display:grid;grid-template-columns:auto 1fr;gap:3px 8px;padding:8px;border:1px solid #ded3bf;border-radius:6px}.artifact-outcome-list li>span{grid-column:2;color:#6c6258;font-size:12px;overflow-wrap:anywhere}.artifact-outcome-form{display:grid;gap:8px;padding:12px;border:1px solid #ded3bf;border-radius:8px}.artifact-outcome-form label{display:grid;gap:4px;font-size:13px}.artifact-outcome-form select,.artifact-outcome-form input{min-width:0;padding:6px;border:1px solid #b8aa94;border-radius:4px}.artifact-outcome-form .artifact-outcome-confirm{display:flex;align-items:start;gap:7px}.artifact-outcome-confirm input{min-width:auto;margin-top:2px}
</style>
