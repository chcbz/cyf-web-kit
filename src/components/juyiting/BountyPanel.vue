<template>
  <div class="bounty-panel" :class="{ 'is-hall-embedded': embeddedHall }">
    <div
      v-show="!embeddedHall || !detailTask"
      :inert="embeddedHall && detailTask ? '' : null"
      :aria-hidden="embeddedHall && detailTask ? 'true' : null"
      class="bounty-source"
    >
      <div class="panel-toolbar">
        <div class="task-search">
          <input
            :value="taskKeyword"
            placeholder="查榜号"
            @input="$emit('update:taskKeyword', $event.target.value.trim())"
            @keyup.enter="$emit('load-tasks')"
          />
          <select
            :value="taskAbilityFilter"
            @change="$emit('update:taskAbilityFilter', $event.target.value); $emit('load-tasks')"
          >
            <option value="">不拘本领</option>
            <option v-for="ability in taskAbilityOptions" :key="ability" :value="ability">{{ ability }}</option>
          </select>
        </div>
        <button @click="$emit('load-tasks')">
          <BountyActionIcon name="refresh" />
          <span>重查</span>
        </button>
        <div class="task-create-actions">
          <button class="new-task-button" type="button" @click="showCreateForm = !showCreateForm">
            <BountyActionIcon name="plus" />
            <span>张榜</span>
          </button>
          <button
            v-if="embeddedHall"
            class="new-task-button"
            type="button"
            @click="$emit('start-formal-draft')"
          >
            <span>起草正式任务</span>
          </button>
          <button class="new-task-button" type="button" @click="embeddedHall ? $emit('start-private-draft') : showDraftEditor = !showDraftEditor">
            <span>{{ showDraftEditor ? '收起草稿' : '起草交办' }}</span>
          </button>
        </div>
      </div>

      <form v-if="showCreateForm" class="task-create-form" @submit.prevent="submitCreateTask">
        <input v-model.trim="taskForm.title" name="taskTitle" placeholder="榜文名目" />
        <textarea v-model.trim="taskForm.description" name="taskDescription" placeholder="榜文缘由"></textarea>
        <input v-model.trim="taskForm.requiredAbilities" name="requiredAbilities" placeholder="所需本领，逗号分隔" />
        <label v-if="fundedPreviewEnabled" class="funded-create-toggle">
          <input v-model="taskForm.funded" type="checkbox" /> 资金悬赏（开发预览）
        </label>
        <input
          v-if="fundedPreviewEnabled && taskForm.funded"
          v-model.trim="taskForm.grossBountyAmountMicro"
          class="gross-bounty-input"
          name="grossBountyAmountMicro"
          inputmode="numeric"
          placeholder="总额（micro-SILVER）"
        />
        <small v-if="fundedPreviewEnabled && taskForm.funded && !validGrossAmount" class="funded-input-error">请输入规范的非负整数字符串。</small>
        <section v-if="fundedCreateRecovery" class="funded-create-recovery" role="status">
          <strong>发现原资金榜请求，结果未知</strong>
          <p>原榜文名目：{{ fundedCreateRecovery.body.title }}</p>
          <p>原榜文缘由：{{ fundedCreateRecovery.body.description || '未填写' }}</p>
          <p>原所需本领：{{ fundedRecoveryAbilities }}</p>
          <p>原结算规则：{{ fundedCreateRecovery.body.settlementPolicy || '未填写' }}</p>
          <p>原总额：{{ fundedCreateRecovery.body.grossBountyAmountMicro }} micro-SILVER。</p>
          <p>当前编辑稿不会提交或替换原请求。</p>
          <button type="button" @click="$emit('resume-funded-create')">确认按原请求恢复</button>
          <button type="button" @click="$emit('cancel-funded-create-recovery')">暂不恢复</button>
        </section>
        <button type="submit" :disabled="createPending || !taskForm.title || (taskForm.funded && !validGrossAmount)">{{ createPending ? '张榜中…' : '张榜悬赏' }}</button>
      </form>

      <HallDraftEditor
        v-if="showDraftEditor"
        :agents="operableAgents"
        :selected-agent="selectedAgent"
        :identity-epoch="authorizationGeneration"
        :identity-scope="identityScope"
        @close="showDraftEditor = false"
        @open-task="openTask"
        @changed="$emit('mark-changed')"
      />

      <p v-if="loading" class="task-data-state" role="status">悬赏榜读取中…</p>
      <p v-else-if="errorMessage" class="task-data-state is-error" role="alert">{{ errorMessage }}</p>
      <p v-if="countsLoading" class="task-data-state" role="status">榜文数目统计中…</p>
      <p v-else-if="countsErrorMessage" class="task-data-state is-error" role="alert">{{ countsErrorMessage }}</p>

      <div class="task-status-tabs">
        <button
          v-for="item in taskStatusFilters"
          :key="item.value"
          :class="{ active: taskStatusFilter === item.value }"
          @click="$emit('set-status-filter', item.value)"
        >
          {{ item.label }}
          <small>{{ taskStatusCount(item.value) }}</small>
        </button>
      </div>

      <div class="task-panel-body">
        <div class="task-list">
          <article
            v-for="task in tasks"
            :key="task.id"
            class="task-card"
            :class="{ selected: selectedTask?.id === task.id }"
            @click="openTask(task)"
          >
            <div class="task-head">
              <strong>{{ task.title }}</strong>
              <span :class="taskStateClass(task.status)">{{ taskStatusText(task.status) }}</span>
            </div>
            <p>{{ task.description || '榜文尚未写明缘由' }}</p>
            <div class="task-meta">
              <span>{{ task.id }}</span>
              <span v-if="task.assignedAgentName">领令：{{ task.assignedAgentName }}</span>
              <span v-if="task.updatedAt">{{ formatTime(task.updatedAt) }}</span>
            </div>
            <p v-if="isFundedTask(task)" class="funding-summary">已托管：{{ formatMoney(task.funding.remainingMicro || task.funding.grossBountyAmountMicro) }}</p>
            <div class="ability-tags">
              <span v-for="ability in task.requiredAbilities || []" :key="ability">{{ ability }}</span>
              <span v-if="!(task.requiredAbilities || []).length">不拘本领</span>
            </div>
          </article>
          <div v-if="!tasks.length" class="empty-list">榜上暂无悬赏，可换个筛法或重查一遍。</div>
        </div>
      </div>

    </div>
    <transition name="modal">
      <div v-if="detailTask" class="bounty-modal-overlay" :class="{ 'is-embedded-page': embeddedHall }" @click.self="embeddedHall ? null : closeTask()">
        <section class="bounty-modal" :role="embeddedHall ? 'region' : 'dialog'" :aria-label="embeddedHall ? '事项详情' : null" :aria-modal="embeddedHall ? null : 'true'">
          <div class="bounty-modal-header">
            <button v-if="embeddedHall" type="button" class="bounty-back-button" @click="closeTask">← 返回事项</button>
            <h3 v-else>榜文点将</h3>
            <button v-if="!embeddedHall" class="modal-close" @click="closeTask">
              <BountyActionIcon name="close" />
            </button>
          </div>

          <div class="bounty-modal-body">
            <section
              v-if="fundedQuotePreview"
              class="funded-preview-details funded-quote-confirmation"
              role="dialog"
              aria-modal="false"
              aria-label="确认资金榜报价"
            >
              <h3>先看报价，再决定领令</h3>
              <p>{{ fundedQuotePreview.taskTitle }} / {{ fundedQuotePreview.agentName }}</p>
              <p>榜号 {{ fundedQuotePreview.quote.taskId }} / 好汉 {{ fundedQuotePreview.quote.agentId }} / 榜文版本 {{ fundedQuotePreview.quote.taskVersion }}</p>
              <p>价簿 {{ fundedQuotePreview.quote.priceBookVersion }} / 报价 {{ fundedQuotePreview.quote.quoteId }}</p>
              <p>输入 {{ fundedQuotePreview.quote.estimatedTokens.input }} / 缓存输入 {{ fundedQuotePreview.quote.estimatedTokens.cachedInput }} / 输出 {{ fundedQuotePreview.quote.estimatedTokens.output }} / 推理 {{ fundedQuotePreview.quote.estimatedTokens.reasoning }}</p>
              <p>预估/最坏算力：{{ formatMoney(fundedQuotePreview.quote.estimatedComputeMicro) }} / {{ formatMoney(fundedQuotePreview.quote.worstComputeMicro) }}；平台费：{{ formatMoney(fundedQuotePreview.quote.platformFeeMicro) }}</p>
              <p>好汉预估/最坏所得：{{ formatMoney(fundedQuotePreview.quote.estimatedAgentPayoutMicro) }} / {{ formatMoney(fundedQuotePreview.quote.worstAgentPayoutMicro) }}</p>
              <p>建议：{{ fundedQuotePreview.quote.recommendation }}；缘由：{{ fundedQuotePreview.quote.reasonCodes.join('、') || '无' }}</p>
              <p>到期时间：{{ formatTime(fundedQuotePreview.quote.expiresAt) }}（{{ fundedQuotePreview.quote.expiresAt }} ms）</p>
              <p v-if="fundedQuotePreview.recovery">原领令结果未知；仅重放此前确认的原报价和请求，不会重新取价。</p>
              <button type="button" @click="$emit('confirm-funded-quote')">{{ fundedQuotePreview.recovery ? '核对原领令' : '确认此报价并领令' }}</button>
              <button type="button" @click="$emit('cancel-funded-quote')">{{ fundedQuotePreview.recovery ? '暂不核对' : '取消，不领令' }}</button>
            </section>
            <p v-if="fundedClaimState?.taskId === detailTask.id && fundedClaimState.status === 'confirmed'" class="funding-summary" role="status">
              榜文 {{ fundedClaimState.taskId }} 已确认由 {{ fundedClaimState.agentId }} 领令。
              <span v-if="fundedClaimState.refreshPending">榜文刷新待完成，请重查；勿重复领令。<button type="button" @click="$emit('refresh-funded-claim', detailTask)">重查已确认榜文</button></span>
            </p>
            <p v-else-if="fundedClaimState?.taskId === detailTask.id && fundedClaimState.status === 'unresolved'" role="status">原领令结果未知，请由原好汉核对，不要重新取价。</p>
            <div class="modal-task-info">
              <section v-if="embeddedHall" class="matter-advice-card" aria-label="办理建议">
                <div class="matter-advice-heading"><span>办理建议</span><strong>{{ simpleMatterStatus(detailTask) }}</strong></div>
                <p class="matter-request">{{ detailTask.description || detailTask.title }}</p>
                <dl>
                  <div><dt>预计成果</dt><dd>一份可预览、下载和验收的正式 PDF</dd></div>
                  <div><dt>建议承办</dt><dd>{{ preferredAgentName || '吴用或林冲' }}</dd></div>
                  <div><dt>资料</dt><dd>可选；没有资料也可在能力允许时开始办理</dd></div>
                </dl>
                <p class="matter-fee-note">创建事项不会执行。实际开始办理和返工前会再次确认 Agent、资料与外部 Provider 可能产生的未知费用。</p>
                <div v-if="detailTask.status === 'open' && preferredAgents.length" class="matter-agent-actions">
                  <button v-for="agent in preferredAgents" :key="agent.agentId" type="button" :disabled="!canAssign(detailTask, agent)" @click="$emit('assign-task', detailTask, agent)">交给{{ agentDisplayName(agent) }}</button>
                </div>
                <button v-else-if="assignedAgentForTask(detailTask)" type="button" class="matter-primary-action" @click="$emit('discuss-task', detailTask, assignedAgentForTask(detailTask))">与{{ agentDisplayName(assignedAgentForTask(detailTask)) }}进入事项议事</button>
              </section>
              <div v-if="!embeddedHall" class="task-detail-head">
                <div>
                  <strong>{{ detailTask.title }}</strong>
                  <small>{{ detailTask.id }} / {{ taskStatusText(detailTask.status) }}</small>
                </div>
                <span :class="taskStateClass(detailTask.status)">{{ taskStatusText(detailTask.status) }}</span>
              </div>

              <p v-if="!embeddedHall">{{ detailTask.description || '榜文尚未写明缘由' }}</p>
              <section v-if="!embeddedHall" class="workspace-shortcut" aria-label="榜文百宝箱入口">
                <div>
                  <strong>资料与交付</strong>
                  <p>文件、版本和交付件统一收在百宝箱；正式办理只在下方按当前榜文的会话与工作项授权启动。</p>
                </div>
                <button type="button" @click="$emit('open-workspace')">打开百宝箱</button>
              </section>
              <TaskMaterialLinks
                v-if="formalTaskExecutionScope && (!embeddedHall || taskAssigneeIds(detailTask).length)"
                :key="formalTaskExecutionScope.taskId"
                :task-id="formalTaskExecutionScope.taskId"
                :conversation-id="formalTaskExecutionScope.conversationId"
                :target-agent-id="formalTaskExecutionScope.targetAgentId"
                :conversation-confirmed="formalTaskExecutionScope.conversationConfirmed"
                :formal-execution-authorized="formalTaskExecutionScope.formalExecutionAuthorized"
                :formal-execution-authorization-reason="formalTaskExecutionScope.authorizationReason"
                :identity-epoch="authorizationGeneration"
                :identity-scope="identityScope"
                :default-instruction="detailTask.description || detailTask.title"
                @formal-execution-created="$emit('formal-execution-created', $event)"
                @formal-execution-recovered="$emit('formal-execution-recovered', $event)"
              />
              <section v-if="isFundedTask(detailTask)" class="funded-preview-details" aria-label="资金悬赏详情">
                <p class="funding-summary">已托管：{{ formatMoney(detailTask.funding.remainingMicro || detailTask.funding.grossBountyAmountMicro) }}</p>
                <p>仅可由一位明确好汉按报价领令；组队、宋江代点和旧式点将已禁用。</p>
                <button
                  v-if="canCancelFunding(detailTask)"
                  type="button"
                  class="funded-detail-button"
                  @click="$emit('cancel-funding', detailTask)"
                >开工前撤榜并退款</button>
                <button type="button" class="funded-detail-button" @click="$emit('load-settlement', detailTask)">查看结算详情</button>
                <pre v-if="detailTask.settlement" class="settlement-detail">{{ JSON.stringify(detailTask.settlement, null, 2) }}</pre>
              </section>

              <TeamRecommendationPanel
                v-if="!embeddedHall"
                :task="detailTask"
                :authorization-generation="authorizationGeneration"
              />

              <button v-if="!embeddedHall || detailTask.status !== 'open'" type="button" class="matter-results-action" @click="$emit('open-formal-results', detailTask)">查看正式成果与验收</button>
              <WorkItemPlanPanel v-if="!embeddedHall" :task="detailTask" :enabled="workItemPlanEnabled" :authorization-generation="authorizationGeneration" />

              <div v-if="!embeddedHall" class="ability-tags">
                <span v-for="ability in detailTask.requiredAbilities || []" :key="ability">{{ ability }}</span>
                <span v-if="!(detailTask.requiredAbilities || []).length">不拘本领</span>
              </div>

              <div v-if="!embeddedHall" class="task-operation-grid">
                <button
                  :aria-label="agentDisplayName(selectedAgent) ? `点当前好汉 ${agentDisplayName(selectedAgent)} 领令` : '先择好汉再点将'"
                  :disabled="isFundedTask(detailTask) || !canAssign(detailTask, selectedAgent)"
                  :title="agentDisplayName(selectedAgent) ? `点当前好汉领令：${agentDisplayName(selectedAgent)}` : '先择好汉再点将'"
                  @click="$emit('assign-task', detailTask, selectedAgent)"
                >
                  <BountyActionIcon name="assign" />
                  <span class="visually-hidden">{{ agentDisplayName(selectedAgent) ? '点将当前' : '选择好汉' }}</span>
                </button>
                <button
                  aria-label="密议"
                  title="与当前好汉密议"
                  @click="$emit('brief-selected-task', detailTask, selectedAgent)"
                >
                  <BountyActionIcon name="whisper" />
                  <span class="visually-hidden">密议</span>
                </button>
                <button
                  class="assign-selected-agents"
                  type="button"
                  :aria-label="`点已选 ${selectedAssignees.length} 人领令`"
                  :disabled="isFundedTask(detailTask) || !selectedAssignees.length"
                  :title="`点已选 ${selectedAssignees.length} 人领令`"
                  @click="$emit('assign-task', detailTask, selectedAssignees)"
                >
                  <BountyActionIcon name="group" />
                  <span class="count-badge">{{ selectedAssignees.length }}</span>
                  <span class="visually-hidden">点将已选 {{ selectedAssignees.length }}</span>
                </button>
                <button
                  class="auto-assign-task"
                  type="button"
                  aria-label="宋江代为点将"
                  :disabled="isFundedTask(detailTask) || detailTask.status !== 'open' || !recommendedAgents.length"
                  title="宋江代为点将"
                  @click="$emit('auto-assign-task', detailTask)"
                >
                  <BountyActionIcon name="strategist" />
                  <span class="visually-hidden">宋江代为点将</span>
                </button>
                <button
                  class="discuss-task-button"
                  type="button"
                  aria-label="进入议事"
                  :disabled="!taskAssigneeIds(detailTask).length"
                  :title="!taskAssigneeIds(detailTask).length ? unassignedDiscussHint : '进入该悬赏的既有议事入口'"
                  @click="$emit('discuss-task', detailTask, assignedAgentForTask(detailTask))"
                >
                  <BountyActionIcon name="discuss" />
                  <span class="visually-hidden">进入议事</span>
                </button>
                <button
                  class="archive-task-button"
                  type="button"
                  aria-label="收入案卷"
                  title="收入案卷"
                  @click="$emit('archive-task', detailTask)"
                >
                  <BountyActionIcon name="archive" />
                  <span class="visually-hidden">收入案卷</span>
                </button>
              </div>
              <p v-if="!embeddedHall && !taskAssigneeIds(detailTask).length" class="task-operation-hint">
                {{ unassignedDiscussHint }}
              </p>
            </div>

            <div v-if="!embeddedHall" class="modal-agent-scroll">
              <div class="section-label">可点好汉</div>
              <div
                v-for="agent in recommendedAgents"
                :key="agent.agentId"
                class="recommended-agent-row"
                :class="{ active: selectedAgent?.agentId === agent.agentId }"
              >
                <button class="recommended-agent-main" type="button" @click="$emit('select-agent', agent)">
                  <input
                    class="assignee-check"
                    type="checkbox"
                    :checked="selectedAssigneeIds.includes(agent.agentId)"
                    :disabled="isFundedTask(detailTask) || !canAssign(detailTask, agent)"
                    @click.stop
                    @change="toggleAssignee(agent)"
                  />
                  <span class="mini-avatar portrait-avatar" :style="portraitStyle(agent)" :title="portraitName(agent)"></span>
                  <span>
                    <strong>{{ agentDisplayName(agent) }}</strong>
                    <small>{{ abilityText(agent) }}</small>
                  </span>
                  <em>{{ recommendationScore(detailTask, agent) }}%</em>
                </button>
                <p v-if="recommendationReason(agent)" class="recommendation-reason">
                  {{ recommendationReason(agent) }}
                </p>
                <p v-if="recommendationExclusionReasons(agent).length" class="recommendation-reason recommendation-exclusions">
                  不宜点将：{{ recommendationExclusionReasons(agent).join('、') }}
                </p>
                <p v-if="recommendationScoreParts(agent).length" class="recommendation-reason recommendation-score-parts">
                  评分明细：{{ recommendationScoreParts(agent).join(' / ') }}
                </p>
                <div class="recommended-agent-actions">
                  <button
                    type="button"
                    :aria-label="`选定 ${agentDisplayName(agent)}`"
                    :title="`选定 ${agentDisplayName(agent)}`"
                    @click="$emit('select-agent', agent)"
                  >
                    <BountyActionIcon name="select" />
                    <span class="visually-hidden">选定</span>
                  </button>
                  <button
                    type="button"
                    :aria-label="isFundedTask(detailTask) ? `向 ${agentDisplayName(agent)} 预览报价` : `点 ${agentDisplayName(agent)} 领令`"
                    :disabled="isFundedTask(detailTask) ? fundedClaimBlocked(detailTask, agent) : !canAssign(detailTask, agent)"
                    :title="isFundedTask(detailTask) ? `向 ${agentDisplayName(agent)} 预览报价` : `点 ${agentDisplayName(agent)} 领令`"
                    @click="$emit('assign-task', detailTask, agent)"
                  >
                    <BountyActionIcon name="assign" />
                    <span class="visually-hidden">点将</span>
                  </button>
                  <button
                    type="button"
                    :aria-label="`与 ${agentDisplayName(agent)} 密议`"
                    :title="`与 ${agentDisplayName(agent)} 密议`"
                    @click="$emit('brief-selected-task', detailTask, agent)"
                  >
                    <BountyActionIcon name="whisper" />
                    <span class="visually-hidden">密议</span>
                  </button>
                </div>
              </div>
              <p v-if="!recommendedAgents.length">暂未寻得可领令的好汉。</p>
            </div>
          </div>
        </section>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import BountyActionIcon from './BountyActionIcon.vue'
import WorkItemPlanPanel from './WorkItemPlanPanel.vue'
import TeamRecommendationPanel from './TeamRecommendationPanel.vue'
import HallDraftEditor from './HallDraftEditor.vue'
import TaskMaterialLinks from '@/components/personal-workspace/TaskMaterialLinks.vue'
import { formatSilverMicro, isCanonicalMicroAmount } from '@/utils/silverAmount'

const props = defineProps({
  embeddedHall: { type: Boolean, default: false },
  detailAllowed: { type: Boolean, default: true },
  tasks: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
  countsLoading: { type: Boolean, default: false },
  countsErrorMessage: { type: String, default: '' },
  selectedTask: { type: Object, default: null },
  selectedAgent: { type: Object, default: null },
  operableAgents: { type: Array, default: () => [] },
  recommendedAgents: { type: Array, default: () => [] },
  taskAbilityOptions: { type: Array, default: () => [] },
  taskStatusFilters: { type: Array, default: () => [] },
  taskAbilityFilter: { type: String, default: '' },
  taskKeyword: { type: String, default: '' },
  taskStatusFilter: { type: String, default: '' },
  fundedPreviewEnabled: { type: Boolean, default: false },
  workItemPlanEnabled: { type: Boolean, default: false },
  authorizationGeneration: { type: Number, default: 0 },
  identityScope: { type: String, default: '' },
  formalTaskExecutionContext: { type: Object, default: null },
  fundedQuotePreview: { type: Object, default: null },
  fundedClaimState: { type: Object, default: null },
  fundedCreateRecovery: { type: Object, default: null },
  abilityText: { type: Function, required: true },
  canAssign: { type: Function, required: true },
  formatTime: { type: Function, required: true },
  portraitName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true },
  taskAgentMatchScore: { type: Function, required: true },
  taskStateClass: { type: Function, required: true },
  taskStatusCount: { type: Function, required: true },
  taskStatusText: { type: Function, required: true }
})

const emit = defineEmits([
  'assign-task',
  'archive-task',
  'auto-assign-task',
  'brief-selected-task',
  'cancel-funding',
  'confirm-funded-quote',
  'cancel-funded-quote',
  'refresh-funded-claim',
  'create-task',
  'start-formal-draft',
  'start-private-draft',
  'open-formal-results',
  'mark-changed',
  'resume-funded-create',
  'cancel-funded-create-recovery',
  'discuss-task',
  'load-settlement',
  'open-workspace',
  'formal-execution-created',
  'formal-execution-recovered',
  'load-tasks',
  'select-agent',
  'select-task',
  'set-status-filter',
  'update:taskAbilityFilter',
  'update:taskKeyword'
])

const modalTask = ref(null)
const showCreateForm = ref(false)
const createPending = ref(false)
const selectedAssigneeIds = ref([])
const taskForm = ref({
  title: '',
  description: '',
  requiredAbilities: '',
  funded: false,
  grossBountyAmountMicro: ''
})
const detailTask = computed(() => modalTask.value)
// The parent is the only authority for task-scoped discussion/workspace facts.  A
// detail may never borrow the context of whichever task was previously selected.
const assignedAgentForTask = task => {
  const assignedIds = [...new Set(taskAssigneeIds(task).filter(Boolean))]
  if (assignedIds.length !== 1) return null
  return props.operableAgents.find(agent => agent.agentId === assignedIds[0]) || null
}
const preferredAgents = computed(() => props.recommendedAgents.filter(agent => ['吴用', '林冲'].some(name => `${agent.name || ''}${agent.displayName || ''}${agent.personaName || ''}`.includes(name))).slice(0, 2))
const preferredAgentName = computed(() => {
  const assignedId = taskAssigneeIds(detailTask.value)[0]
  const assigned = props.operableAgents.find(agent => agent.agentId === assignedId)
  return agentDisplayName(assigned || preferredAgents.value[0])
})
const simpleMatterStatus = task => ({ open: '待确认', assigned: '已受理', claimed: '已受理', queued: '已受理', running: '办理中', in_progress: '办理中', submitted: '待验收', review: '待验收', changes_requested: '待返工确认', completed: '已完成', accepted: '已完成', archived: '已归档', failed: '受阻' })[task?.status] || (taskAssigneeIds(task).length ? '已受理' : '状态待核对')

const formalTaskExecutionScope = computed(() => {
  const taskId = detailTask.value?.id
  if (!taskId) return null
  const context = props.formalTaskExecutionContext
  if (context?.taskId === taskId) return context
  return {
    taskId,
    conversationId: '',
    targetAgentId: '',
    conversationConfirmed: false,
    formalExecutionAuthorized: false,
    authorizationReason: '当前榜文的正式议事与必需工作项尚未核对；请先进入本榜文议事并明确选择已指派好汉。'
  }
})
const validGrossAmount = computed(() => isCanonicalMicroAmount(taskForm.value.grossBountyAmountMicro))
const fundedRecoveryAbilities = computed(() => {
  const abilities = props.fundedCreateRecovery?.body?.requiredAbilities
  return Array.isArray(abilities) ? abilities.join('、') || '未填写' : abilities || '未填写'
})
const showDraftEditor = ref(false)
const unassignedDiscussHint = '此榜文尚未点将，暂不可开议'
const isFundedTask = task => task?.funding?.mode === 'FUNDED_SINGLE_AGENT'
const fundedClaimBlocked = (task, agent) => {
  if (!props.fundedPreviewEnabled || props.fundedQuotePreview) return true
  const state = props.fundedClaimState
  if (state?.taskId === task.id) {
    if (state.status === 'confirmed' || state.status === 'confirming') return true
    if (state.status === 'unresolved') return state.agentId !== agent.agentId
  }
  return !props.canAssign(task, agent)
}
const formatMoney = value => formatSilverMicro(typeof value === 'string' && isCanonicalMicroAmount(value) ? value : '0')
const canCancelFunding = task => isFundedTask(task) && task.status === 'open' && typeof (task.version ?? task.taskVersion) === 'string'
const selectedAssignees = computed(() => {
  const selected = new Set(selectedAssigneeIds.value)
  return props.recommendedAgents.filter(agent =>
    selected.has(agent.agentId) && props.canAssign(detailTask.value, agent))
})

const agentDisplayName = (agent) => agent?.name || agent?.personaName || agent?.agentId || ''
const recommendationReason = (agent) => agent?.recommendationReason || ''
const recommendationExclusionReasons = (agent) => Array.isArray(agent?.exclusionReasons)
  ? agent.exclusionReasons.filter(reason => typeof reason === 'string' && reason)
  : []
const scorePartLabels = {
  ability: '本领',
  availability: '可用',
  success: '成功',
  load: '负载',
  context: '上下文',
  riskPenalty: '风险扣减'
}
const recommendationScoreParts = (agent) => {
  const parts = agent?.scoreParts
  if (!parts || typeof parts !== 'object' || Array.isArray(parts)) return []
  return Object.entries(parts)
    .filter(([key, value]) => scorePartLabels[key] && typeof value === 'number')
    .map(([key, value]) => `${scorePartLabels[key]} ${value}`)
}
const recommendationScore = (task, agent) => agent?.recommendationScore ?? props.taskAgentMatchScore(task, agent)
const taskAssigneeIds = (task) => {
  if (!task) return []
  if (Array.isArray(task.assignedAgentIds)) return task.assignedAgentIds
  return task.assignedAgentId ? [task.assignedAgentId] : []
}

const submitCreateTask = () => {
  if (!taskForm.value.title) return
  if (taskForm.value.funded && !validGrossAmount.value) return
  const payload = {
    title: taskForm.value.title,
    description: taskForm.value.description,
    requiredAbilities: taskForm.value.requiredAbilities
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  }
  if (props.fundedPreviewEnabled && taskForm.value.funded) {
    payload.grossBountyAmountMicro = taskForm.value.grossBountyAmountMicro
    payload.settlementPolicy = 'GROSS_INCLUSIVE'
  }
  if (createPending.value) return
  createPending.value = true
  emit('create-task', payload, (created) => {
    createPending.value = false
    // Reset only after the parent receives a definitive success acknowledgement.
    // Recoverable/ambiguous failures retain the exact funded draft for retry.
    if (created) {
      taskForm.value = { title: '', description: '', requiredAbilities: '', funded: false, grossBountyAmountMicro: '' }
      showCreateForm.value = false
    }
  })
}

const toggleAssignee = (agent) => {
  if (isFundedTask(detailTask.value) || !props.canAssign(detailTask.value, agent)) return
  const id = agent?.agentId
  if (!id) return
  if (selectedAssigneeIds.value.includes(id)) {
    selectedAssigneeIds.value = selectedAssigneeIds.value.filter(item => item !== id)
  } else {
    selectedAssigneeIds.value = [...selectedAssigneeIds.value, id]
  }
}

const openTask = (task) => {
  if (props.embeddedHall && !props.detailAllowed && !modalTask.value) return false
  modalTask.value = task
  selectedAssigneeIds.value = taskAssigneeIds(task)
  emit('select-task', task)
}

const closeTask = () => {
  modalTask.value = null
  emit('select-task', null)
}

watch(() => props.selectedTask, (task) => {
  if (!task) {
    modalTask.value = null
    return
  }

  if (modalTask.value?.id === task.id) {
    modalTask.value = task
    selectedAssigneeIds.value = taskAssigneeIds(task)
  }
})
const canGoBack = computed(() => Boolean(modalTask.value))
const back = () => {
  if (!canGoBack.value) return false
  closeTask()
  return true
}
defineExpose({ openTask, canGoBack, back })
</script>
<style scoped>
.bounty-panel {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  flex-direction: column;
  overflow: hidden;
}

button {
  border: 0;
  cursor: pointer;
  font: inherit;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.panel-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  color: #765f40;
  font-size: 13px;
}

.task-create-actions { display: inline-flex; flex: 0 0 auto; gap: 8px; }

.panel-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  background: #efe0c6;
  color: #4a3423;
}

.task-search {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(118px, 150px);
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.task-search input,
.task-search select,
.task-create-form input,
.task-create-form textarea {
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  background: #fffdf6;
  color: #3f2815;
  outline: none;
}

.task-create-form {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(150px, 1fr) minmax(180px, 1.4fr) minmax(140px, 0.8fr) auto;
  gap: 8px;
  padding: 0 16px 12px;
}

.task-create-form textarea {
  height: 36px;
  padding-top: 8px;
  resize: vertical;
}

.task-create-form button {
  min-height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  background: #7c1f1b;
  color: #fff8e8;
}

.task-data-state {
  margin: 0 16px 8px;
  color: #765f40;
  font-size: 13px;
}

.task-data-state.is-error { color: #b3261e; }

.task-status-tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  padding: 0 12px 12px;
  overflow-x: auto;
}

.task-status-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  background: #efe0c6;
  color: #4a3423;
  white-space: nowrap;
}

.task-status-tabs button.active {
  background: #7c1f1b;
  color: #fff8e8;
}

.task-status-tabs small {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
  font-size: 11px;
}

.task-panel-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 0 12px 12px;
  box-sizing: border-box;
  overflow: hidden;
}

.task-list {
  overflow: auto;
  min-width: 0;
  min-height: 0;
  padding: 0;
}

.task-card {
  box-sizing: border-box;
  max-width: 100%;
  padding: 12px;
  margin-bottom: 10px;
  border-radius: 8px;
  background: #f7ecd7;
}

.task-card.selected {
  background: #ead3a9;
}

.task-card p {
  color: #765f40;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.task-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
}

.task-head strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-head span {
  font-size: 12px;
  white-space: nowrap;
}

.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
  color: #8b6b44;
  font-size: 12px;
}

.ability-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ability-tags span {
  padding: 3px 7px;
  border-radius: 8px;
  background: rgba(35, 72, 62, 0.12);
  color: #23483e;
  font-size: 12px;
}

.task-detail-card {
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  padding: 12px;
  box-sizing: border-box;
  overflow: auto;
  border-radius: 8px;
  background: #f4e2c3;
}

.task-detail-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  margin-bottom: 10px;
}

.task-detail-head > div {
  min-width: 0;
}

.task-detail-head strong,
.task-detail-head small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-detail-head small {
  margin-top: 3px;
  color: #765f40;
  font-size: 12px;
}

.task-operation-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0;
}

.task-operation-grid button {
  position: relative;
  display: inline-grid;
  place-items: center;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  padding: 0;
  border-radius: 8px;
  background: #7c1f1b;
  color: #fff8e8;
  line-height: 1;
}

.task-operation-grid button + button {
  background: #23483e;
}

.task-operation-grid button:disabled,
.recommended-agent-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.count-badge {
  position: absolute;
  right: -4px;
  top: -5px;
  display: inline-grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border: 1px solid #fff8e8;
  border-radius: 999px;
  background: #d8a33a;
  color: #2f261c;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
}

.task-operation-hint {
  margin: -2px 0 10px;
  color: #8a5d26;
  font-size: 12px;
}

.recommended-agents {
  display: grid;
  gap: 8px;
}

.section-label {
  color: #765f40;
  font-size: 12px;
  font-weight: 700;
}

.recommended-agent-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border-radius: 8px;
  background: #f7ecd7;
}

.recommended-agent-row.active {
  outline: 2px solid #7c1f1b;
}

.recommended-agent-main {
  display: grid;
  grid-template-columns: 22px 38px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 253, 246, 0.72);
  color: #2f261c;
  text-align: left;
}

.assignee-check {
  width: 16px;
  height: 16px;
  accent-color: #7c1f1b;
}

.recommended-agent-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  width: 100%;
}

.recommendation-reason {
  grid-column: 1 / -1;
  margin: -2px 4px 0 68px;
  overflow-wrap: anywhere;
}

.recommended-agent-actions button {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  min-width: 30px;
  padding: 0;
  border-radius: 7px;
  background: #efe0c6;
  color: #4a3423;
  line-height: 1;
}

.recommended-agent-actions button:nth-child(2) {
  background: #7c1f1b;
  color: #fff8e8;
}

.recommended-agents strong,
.recommended-agents small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recommended-agents small,
.recommended-agents p {
  color: #765f40;
  font-size: 12px;
}

.recommended-agents em {
  white-space: nowrap;
  font-style: normal;
  color: #23483e;
  font-weight: 700;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.mini-avatar {
  display: inline-grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #7c1f1b;
  color: #fff4d4;
  font-weight: 700;
}

.portrait-avatar {
  position: relative;
  overflow: hidden;
  background-repeat: no-repeat;
  background-color: #7c1f1b;
  box-shadow:
    inset 0 0 0 2px rgba(255, 244, 212, 0.72),
    inset 0 -4px 0 rgba(0, 0, 0, 0.14);
}

.portrait-avatar::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(circle at 35% 23%, rgba(255, 255, 255, 0.22), transparent 34%);
  pointer-events: none;
}

.task-state-open,
.task-state-planning,
.task-state-assigned,
.task-state-running,
.task-state-reviewing,
.task-state-blocked,
.task-state-done,
.task-state-failed,
.task-state-cancelled,
.task-state-archived,
.task-state-unknown {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.task-state-open,
.task-state-planning {
  background: rgba(124, 31, 27, 0.12);
  color: #7c1f1b;
}

.task-state-assigned,
.task-state-running,
.task-state-reviewing {
  background: rgba(154, 91, 0, 0.14);
  color: #875200;
}

.task-state-blocked,
.task-state-unknown {
  background: rgba(111, 78, 35, 0.14);
  color: #6f4e23;
}

.task-state-done,
.task-state-archived {
  background: rgba(46, 125, 50, 0.14);
  color: #2e7d32;
}

.task-state-failed,
.task-state-cancelled {
  background: rgba(179, 38, 30, 0.14);
  color: #b3261e;
}

.empty-list {
  padding: 16px;
  color: #765f40;
}

/* Modal Styles */
.bounty-modal-overlay {
  position: absolute;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  background: transparent;
  padding: 16px;
  isolation: isolate;
  contain: layout paint;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
}

.bounty-modal-overlay,
.bounty-modal,
.bounty-modal * {
  box-sizing: border-box;
}

.bounty-modal-overlay::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  background: rgba(15, 10, 6, 0.72);
  opacity: 1;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  pointer-events: none;
}

.bounty-modal {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 560px;
  max-height: min(90vh, 720px);
  border: 1px solid rgba(255, 240, 202, 0.28);
  border-radius: 12px;
  background:
    linear-gradient(155deg, #fdf6ea 0%, #f2e0bd 100%);
  color: #2f261c;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.18),
    0 18px 48px rgba(0, 0, 0, 0.42);
  overflow: hidden;
  opacity: 1;
  transform: translate3d(0, 0, 0);
  transform-origin: center bottom;
  backface-visibility: hidden;
  contain: layout paint;
  will-change: transform, opacity;
  isolation: isolate;
}

.bounty-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(124, 31, 27, 0.16);
  background: linear-gradient(135deg, rgba(124, 31, 27, 0.06), transparent);
}

.bounty-modal-header h3 {
  margin: 0;
  font-size: 18px;
  color: #7c1f1b;
}

.modal-close {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(124, 31, 27, 0.1);
  color: #7c1f1b;
  transition: background 0.18s;
}

.modal-close:hover {
  background: rgba(124, 31, 27, 0.2);
}

.bounty-modal-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
}

.workspace-shortcut {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 14px 0;
  padding: 12px;
  border: 1px solid #d7c3a2;
  border-radius: 8px;
  background: #fff8e8;
}

.workspace-shortcut strong,
.workspace-shortcut p {
  display: block;
  margin: 0;
}

.workspace-shortcut p {
  margin-top: 3px;
  color: #765f40;
  font-size: 12px;
}

.workspace-shortcut button {
  flex: 0 0 auto;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 7px;
  background: #6d3f1f;
  color: #fff8e8;
}

.modal-task-info {
  flex: 0 0 auto;
  padding: 14px 16px 0;
}

.modal-agent-scroll {
  flex: 0 0 auto;
  margin-top: 12px;
  padding: 0 16px 16px;
}

/* Modal Transition */
.modal-enter-active,
.modal-leave-active {
  transition: none;
}

.modal-enter-active::before,
.modal-leave-active::before {
  transition: opacity 0.16s ease-out;
  will-change: opacity;
}

.modal-enter-active .bounty-modal,
.modal-leave-active .bounty-modal {
  transition:
    transform 0.18s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.14s ease-out;
  will-change: transform, opacity;
}

.modal-enter-from::before,
.modal-leave-to::before {
  opacity: 0;
}

.modal-enter-from .bounty-modal {
  opacity: 0;
  transform: translate3d(0, 10px, 0);
}

.modal-leave-to .bounty-modal {
  opacity: 0;
  transform: translate3d(0, 10px, 0);
}

@media (prefers-reduced-motion: reduce) {
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active::before,
  .modal-leave-active::before,
  .modal-enter-active .bounty-modal,
  .modal-leave-active .bounty-modal {
    transition: none;
  }
}

@media (max-width: 900px) {
  .bounty-modal-overlay {
    padding: 10px;
  }

  .panel-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .task-search,
  .task-panel-body {
    grid-template-columns: 1fr;
  }

  .task-panel-body {
    overflow: auto;
  }

  .task-list,
  .task-detail-card {
    overflow: visible;
  }

  .task-operation-grid {
    justify-content: flex-start;
  }

  .recommended-agent-row {
    grid-template-columns: 1fr;
  }

  .recommended-agent-main {
    grid-template-columns: 22px 38px minmax(0, 1fr) auto;
  }

  .recommended-agent-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    justify-content: stretch;
  }

  .recommended-agent-actions button {
    width: 100%;
    min-width: 0;
    height: 34px;
  }

  .task-create-form {
    grid-template-columns: 1fr;
  }

  .bounty-modal {
    width: 100%;
    max-width: 100%;
    max-height: 100%;
  }
}

/* ECO-V0 funded-preview additions; legacy bounty layout stays intact. */
.funded-create-toggle { display: inline-flex; align-items: center; gap: 6px; color: #765f40; font-size: 12px; }
.gross-bounty-input { min-width: 180px; }
.funded-input-error { color: #b42318; font-size: 12px; }
.funded-quote-confirmation { max-height: 50vh; overflow-y: auto; flex-shrink: 0; padding: 12px; }
.funding-summary { margin: 8px 0 0; color: #75430b !important; font-weight: 700; }
.funded-preview-details { margin: 10px 0; padding: 10px; border-radius: 8px; background: #fff3cc; color: #6b4a12; font-size: 12px; }
.funded-preview-details p { margin: 6px 0; }
.funded-detail-button { margin: 4px 6px 4px 0; padding: 7px 9px; border-radius: 7px; background: #7c1f1b; color: #fff8e8; font-size: 12px; }
.quote-summary { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(117, 67, 11, .22); }
.settlement-detail { max-height: 180px; margin: 8px 0 0; overflow: auto; white-space: pre-wrap; font-size: 11px; }

.is-hall-embedded .bounty-modal-overlay {
  position: static;
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  padding: 0;
  contain: none;
  transform: none;
}
.is-hall-embedded .bounty-modal-overlay::before { display: none; }
.is-hall-embedded .bounty-modal {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  max-width: none;
  max-height: 100%;
  box-shadow: none;
}
</style>

<style scoped>
.bounty-modal-overlay.is-embedded-page{position:static;display:block;width:100%;height:auto;min-height:100%;padding:0;background:#f5f4f0;overflow:visible}.bounty-modal-overlay.is-embedded-page .bounty-modal{width:100%;max-width:none;min-height:100%;max-height:none;border:0;border-radius:0;box-shadow:none;background:#f5f4f0}.bounty-modal-overlay.is-embedded-page .bounty-modal-header{position:sticky;top:0;z-index:3;min-height:48px;padding:6px 16px;border-bottom:1px solid #e3e5dc;background:#fffefa}.bounty-modal-overlay.is-embedded-page .bounty-modal-header h3{font-size:14px;font-weight:500}.bounty-back-button{min-height:44px;padding:0;border:0!important;background:transparent!important;color:#923f30!important;font:500 14px/1 inherit;cursor:pointer}.bounty-modal-overlay.is-embedded-page .bounty-modal-body{padding:16px 16px 96px}.matter-advice-card{display:grid;gap:12px;padding:16px;border:1px solid #eadfd4;border-radius:12px;background:#fffefa}.matter-advice-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.matter-advice-heading span{color:#923f30;font-size:13px;font-weight:600}.matter-advice-heading strong{padding:4px 8px;border-radius:999px;background:#f9efde;color:#87551c;font-size:12px}.matter-request{margin:0!important;font-size:16px!important;color:#242e2b!important}.matter-advice-card dl{display:grid;gap:9px;margin:0}.matter-advice-card dl div{display:grid;grid-template-columns:70px minmax(0,1fr);gap:8px}.matter-advice-card dt{color:#68716b;font-size:12px}.matter-advice-card dd{margin:0;font-size:13px}.matter-fee-note{margin:0!important;padding:10px;border-radius:8px;background:#f6eee8;color:#6f493f!important;font-size:12px!important}.matter-agent-actions{display:flex;gap:8px;flex-wrap:wrap}.matter-primary-action,.matter-results-action{width:100%;min-height:46px;border-radius:8px!important;background:#923f30!important;color:#fffefa!important;border-color:#923f30!important}.matter-agent-actions button{min-height:44px;padding:8px 14px;background:#923f30!important;color:#fffefa!important;border-color:#923f30!important}@media(max-width:620px){.bounty-modal-overlay.is-embedded-page .bounty-modal-body{display:block;padding-inline:12px}.bounty-modal-overlay.is-embedded-page .modal-agent-scroll{margin-top:14px;max-height:none}.matter-advice-card dl div{grid-template-columns:64px minmax(0,1fr)}}
</style>
