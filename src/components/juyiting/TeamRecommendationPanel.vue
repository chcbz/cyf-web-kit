<template>
  <section class="team-recommendation" aria-label="团队推荐预览">
    <h4>团队推荐（仅预览）</h4>
    <p class="team-intro">仅供参考，不会自动组队或开始任务。</p>
    <p v-if="!operable" class="team-state">请先完善任务的风险、复核要求和人数上限。</p>
    <template v-else>
      <div class="team-controls">
        <label>最多人数 <input
          v-model.number="maxTeamSize"
          type="number"
          min="1"
          :max="task.maxAgents"
        /></label>
        <label>席位预算 <input v-model.number="budgetUnits" type="number" min="0" /></label>
        <span>风险：{{ highRisk ? '高' : '非高' }}</span>
        <span>产品复核：{{ reviewerRequired ? '需要独立复核人员' : '本榜未要求' }}</span>
        <button type="button" :disabled="state === 'loading'" @click="request">{{ state === 'loading' ? '推荐中…' : '手动获取团队推荐' }}</button>
      </div>
      <p
        v-if="message"
        class="team-state"
        :class="{ 'is-error': state === 'error' }"
        role="status"
      >{{ message }}</p>
      <template v-if="preview">
        <dl class="team-summary">
          <div><dt>推荐能力</dt><dd>{{ names(preview.coveredAbilities) || '未知' }}</dd></div>
          <div><dt>推荐缺少能力</dt><dd>{{ names(preview.missingAbilities) || '无' }}</dd></div>
          <div><dt>已选能力</dt><dd>{{ names(localCoveredAbilities) || '无' }}</dd></div>
          <div><dt>还缺少能力</dt><dd>{{ names(localMissingAbilities) || '无' }}</dd></div>
          <div><dt>人数</dt><dd>{{ localMembers.length }} / {{ preview.maxTeamSize }}</dd></div>
          <div><dt>席位</dt><dd>{{ localMembers.length }} / {{ preview.budgetUnits }}（不代表费用）</dd></div>
        </dl>
        <p v-if="preview.blockingReasons?.length" class="team-warning">约束缺口：{{ names(preview.blockingReasons) }}</p>
        <div class="team-members">
          <h5>已选成员</h5>
          <p v-if="!localMembers.length">当前人数或预算不允许选择成员。</p>
          <ul v-else><li v-for="member in localMembers" :key="member.agentId"><strong>{{ member.name || member.agentId }}</strong> · {{ roleText(member.role) }} · 覆盖 {{ names(member.matchedAbilities) || '未说明' }} · 1 席位</li></ul>
        </div>
        <p class="team-override" :class="{ 'is-error': !localConstraintsSatisfied }">
          {{ localOverride ? '已调整选择，尚未组队。' : '推荐结果仅供参考。' }}
          <span v-if="!localConstraintsSatisfied">当前选择不满足能力、人数、席位或复核要求。</span>
        </p>
        <h5>候选成员</h5>
        <ul class="team-candidates">
          <li v-for="candidate in preview.candidates" :key="candidate.agentId" :class="{ excluded: !candidate.eligible }">
            <label>
              <input
                type="checkbox"
                :checked="localMembers.some(member => member.agentId === candidate.agentId)"
                :disabled="!canToggleCandidate(candidate)"
                @change="toggleCandidate(candidate)"
              />
              <strong>{{ candidate.name || candidate.agentId }}</strong>
            </label>
            <span>{{ candidate.selected ? `原推荐：${roleText(candidate.selectionRole)}` : '未入原推荐' }}</span>
            <span>评分 {{ candidate.score ?? '未知' }}；1 席位</span>
            <p v-if="candidate.matchedAbilities?.length">匹配：{{ names(candidate.matchedAbilities) }}</p>
            <p v-if="candidate.exclusionReasons?.length">不可选原因：{{ names(candidate.exclusionReasons) }}</p>
            <p v-if="candidate.reason">说明：{{ candidate.reason }}</p>
            <p v-if="lockedReviewerIds.has(candidate.agentId)">需保留独立复核人员。</p>
          </li>
        </ul>
        <p class="team-gap">确定人选后，请通过“点将”逐一邀请。</p>
      </template>
    </template>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, toRef } from 'vue'
import { useHallTeamRecommendation } from '@/composables/juyiting/useHallTeamRecommendation'

const props = defineProps({ task: { type: Object, required: true }, authorizationGeneration: { type: Number, default: 0 } })
const plan = useHallTeamRecommendation({ task: toRef(props, 'task'), authorizationGeneration: computed(() => props.authorizationGeneration) })
const { maxTeamSize, budgetUnits, preview, state, message, operable, highRisk, reviewerRequired, localMembers,
  localCoveredAbilities, localMissingAbilities, localOverride, localConstraintsSatisfied, lockedReviewerIds,
  request, toggleCandidate, canToggleCandidate } = plan
const names = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item).join('、') : ''
const roleText = value => value === 'REVIEWER' ? '复核人员' : value === 'PRODUCER' ? '产出成员' : '未说明角色'
onBeforeUnmount(() => plan.dispose())
</script>

<style scoped>
.team-recommendation { margin: 12px 0; padding: 10px; border-radius: 8px; background: #e9f0e7; color: #23483e; font-size: 12px; }
h4, h5 { margin: 0 0 8px; } .team-intro, .team-state, .team-warning, .team-override, .team-gap { margin: 7px 0; line-height: 1.5; }
.team-controls { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; } .team-controls label { display: inline-flex; align-items: center; gap: 4px; }
input { width: 58px; min-width: 0; padding: 6px; border: 1px solid #a9c2aa; border-radius: 6px; background: #fffdf6; color: #2f261c; font: inherit; }
button { padding: 7px 10px; border: 0; border-radius: 6px; background: #23483e; color: #fff8e8; font: inherit; cursor: pointer; } button:disabled { cursor: not-allowed; opacity: .52; }
.team-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 9px 0; } .team-summary div { padding: 7px; border-radius: 6px; background: rgba(255,255,255,.48); } dt { font-weight: 700; } dd { margin: 3px 0 0; overflow-wrap: anywhere; }
.team-members, .team-candidates { margin: 9px 0; } .team-members ul, .team-candidates { padding-left: 18px; } .team-members li { margin: 4px 0; }
.team-candidates li { margin: 7px 0; padding: 7px; border-radius: 6px; background: rgba(255,255,255,.48); overflow-wrap: anywhere; } .team-candidates li.excluded { opacity: .72; } .team-candidates label { display: inline-flex; gap: 6px; align-items: center; } .team-candidates input { width: auto; }
.team-candidates span { display: block; margin: 3px 0; } .team-candidates p { margin: 3px 0; } .team-warning, .team-gap { color: #8a5d26; } .is-error { color: #b3261e; }
@media (max-width: 560px) { .team-summary { grid-template-columns: 1fr; } }
</style>
