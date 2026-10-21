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
            type="search"
            aria-label="查榜号"
            placeholder="查榜号"
            @input="$emit('update:taskKeyword', $event.target.value.trim())"
            @keyup.enter="$emit('load-tasks')"
          />
          <select
            :value="taskAbilityFilter"
            aria-label="筛选所需本领"
            @change="$emit('update:taskAbilityFilter', $event.target.value); $emit('load-tasks')"
          >
            <option value="">不拘本领</option>
            <option v-for="ability in taskAbilityOptions" :key="ability" :value="ability">{{ ability }}</option>
          </select>
        </div>
        <button class="task-refresh" type="button" aria-label="刷新事项" title="刷新事项" @click="$emit('load-tasks')">
          <BountyActionIcon name="refresh" />
          <span class="toolbar-label">重查</span>
        </button>
      </div>

      <section v-if="requirementCreateState && requirementCreateState.status !== 'IDLE'" class="requirement-create-recovery" role="status">
        <strong>原张榜操作待核对</strong>
        <template v-if="requirementCreateState.intent">
          <p>原榜文：{{ requirementCreateState.intent.body.title }}</p>
          <p>原需求：{{ requirementCreateState.intent.body.description || '未填写' }}</p>
          <p>精确资料：{{ requirementCreateInputSummary }}</p>
          <p>当前编辑稿不会替换原需求；核对不会再次创建或启动 Agent。</p>
          <button type="button" :disabled="requirementCreateBusy" @click="$emit('check-requirement-create')">核对原张榜</button>
          <button v-if="!requirementCreateState.intent.receipt" type="button" :disabled="requirementCreateBusy" @click="$emit('resume-requirement-create')">确认继续原张榜</button>
        </template>
        <p v-if="requirementCreateState.error">{{ requirementCreateState.error }}</p>
      </section>

      <section v-if="fundedCreateRecovery" class="funded-create-recovery requirement-create-recovery" role="status">
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

      <p v-if="loading" class="task-data-state" role="status">悬赏榜读取中…</p>
      <p v-else-if="errorMessage" class="task-data-state is-error" role="alert">{{ errorMessage }}</p>
      <p v-if="countsLoading" class="task-data-state" role="status">榜文数目统计中…</p>
      <p v-else-if="countsErrorMessage && countsErrorMessage !== errorMessage" class="task-data-state is-error" role="alert">{{ countsErrorMessage }}</p>

      <div class="task-status-tabs" aria-label="事项状态" @focusin="revealStatusFilter">
        <button
          v-for="item in primaryStatusFilters"
          :key="item.value"
          :class="{ active: taskStatusFilter === item.value }"
          type="button"
          :aria-pressed="taskStatusFilter === item.value"
          @click="$emit('set-status-filter', item.value)"
        >
          {{ item.label }}
          <small>{{ taskStatusCount(item.value) }}</small>
        </button>
        <button
          type="button"
          :class="{ active: secondaryStatusActive }"
          :aria-pressed="secondaryStatusActive"
          :aria-expanded="secondaryStatusActive"
          @click="openSecondaryStatus"
        >异常/历史</button>
      </div>

      <div v-if="secondaryStatusActive" class="task-secondary-filters" aria-label="异常与历史分类">
        <span>异常/历史</span>
        <button
          v-for="item in secondaryStatusFilters"
          :key="item.value"
          type="button"
          :aria-pressed="taskStatusFilter === item.value"
          @click="$emit('set-status-filter', item.value)"
        >{{ item.label }} <small>{{ taskStatusCount(item.value) }}</small></button>
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
              <span :class="taskStateClass(task)">{{ taskStatusText(task) }}</span>
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
          <div v-if="!loading && !errorMessage && !tasks.length" class="empty-list">{{ taskKeyword || taskAbilityFilter || (taskStatusFilter && taskStatusFilter !== 'all') ? '没有符合当前筛选条件的事项，请调整筛选后重查。' : '还没有事项，先提出一个需求吧。' }}</div>
        </div>
      </div>

    </div>
    <transition name="modal">
      <div v-if="detailTask" class="bounty-modal-overlay" :class="{ 'is-embedded-page': embeddedHall }" @click.self="embeddedHall ? null : closeTask()">
        <section class="bounty-modal" :role="embeddedHall ? 'region' : 'dialog'" :aria-label="embeddedHall ? '事项详情' : null" :aria-modal="embeddedHall ? null : 'true'">
          <div class="bounty-modal-header">
            <button v-if="embeddedHall" type="button" class="bounty-back-button" @click="closeTask">← 返回</button>
            <h3>{{ embeddedHall ? '事项详情' : '榜文点将' }}</h3>
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
            <section v-if="pointAndStartForDetail && !isTerminalMatter(detailTask)" class="point-and-start-recovery" role="status">
              <strong>{{ pointAndStartRecoveryTitle }}</strong>
              <p>原点将目标：{{ pointAndStartForDetail.intent.body.targetAgentId || pointAndStartForDetail.intent.body.agentId }}；需求修订：{{ pointAndStartForDetail.intent.body.requirementRevision }}。</p>
              <p>任务资料：{{ pointAndStartInputSummary }}。</p>
              <p>{{ pointAndStartRecoveryHint }}</p>
              <p v-if="pointAndStartForDetail.error" class="point-and-start-error" role="alert">原点将返回：{{ pointAndStartForDetail.error }}</p>
              <button
                type="button"
                :disabled="pointAndStartBusy"
                @click="$emit('check-point-and-start', detailTask)"
              >核对原点将</button>
              <button
                v-if="pointAndStartForDetail.status === 'UNKNOWN'"
                type="button"
                :disabled="pointAndStartBusy"
                @click="$emit('resume-point-and-start', detailTask)"
              >继续原点将</button>
            </section>
            <div class="modal-task-info">
              <section v-if="embeddedHall" class="matter-advice-card" aria-label="事项进展">
                <div class="matter-advice-heading"><span>事项进展</span><strong>{{ simpleMatterStatus(detailTask) }}</strong></div>
                <h3>{{ detailTask.title }}</h3>
                <p class="matter-request">{{ detailTask.description }}</p>
                <dl>
                  <div><dt>{{ hasTaskAction(detailTask, 'ASSIGN') ? '推荐承办' : '承办好汉' }}</dt><dd>{{ matterAgent ? agentDisplayName(matterAgent) : (detailTask.assignedAgentName || (taskAssigneeIds(detailTask).length ? '承办信息待核对' : '尚未确认')) }}</dd></div>
                  <div><dt>资料</dt><dd>{{ Array.isArray(detailTask.attachments) ? `${detailTask.attachments.length} 份` : '可在原议事中查看或补充' }}</dd></div>
                </dl>
                <template v-if="hasTaskAction(detailTask, 'ASSIGN')">
                  <p class="matter-fee-note">按当前可承办候选推荐；选择不会执行，确认后进入同一议事。已有授权与费用规则保持不变。</p>
                  <button
                    type="button"
                    class="matter-agent-toggle"
                    :aria-expanded="showMatterCandidates"
                    :disabled="pointAndStartBusy || Boolean(pointAndStartForDetail)"
                    @click="showMatterCandidates = !showMatterCandidates"
                  >另选承办Agent</button>
                  <div v-if="showMatterCandidates" class="matter-candidates" aria-label="承办候选">
                    <button
                      v-for="agent in matterCandidates"
                      :key="agent.agentId"
                      type="button"
                      :aria-pressed="matterAgent?.agentId === agent.agentId"
                      :disabled="pointAndStartBusy || Boolean(pointAndStartForDetail) || !canAssign(detailTask, agent)"
                      @click="matterCandidateId = agent.agentId"
                    >{{ agentDisplayName(agent) }}</button>
                    <p v-if="!matterCandidates.length" role="status">暂无可承办候选，请刷新名册后核对。</p>
                  </div>
                  <button
                    type="button"
                    class="matter-primary-action"
                    :disabled="!matterAgent || pointAndStartBusy || Boolean(pointAndStartForDetail) || !canAssign(detailTask, matterAgent)"
                    @click="confirmMatterAgent"
                  >确认承办，进入议事</button>
                </template>
                <template v-else>
                  <p class="matter-fee-note">补充要求、查看结果和提出修改，都在原议事中继续。</p>
                  <button
                    v-if="taskPresentation(detailTask).phase === 'PENDING_ACCEPTANCE' && hasTaskAction(detailTask, 'DISCUSS')"
                    type="button"
                    class="matter-primary-action"
                    @click="$emit('review-delivery', detailTask)"
                  >查看成果并验收</button>
                  <button
                    v-if="hasTaskAction(detailTask, 'DISCUSS') && assignedAgentForTask(detailTask)"
                    type="button"
                    :class="taskPresentation(detailTask).phase === 'PENDING_ACCEPTANCE' ? 'matter-secondary-action' : 'matter-primary-action'"
                    @click="$emit('discuss-task', detailTask, assignedAgentForTask(detailTask))"
                  >继续议事</button>
                </template>
                <button
                  v-if="detailTask.status === 'completed' && taskPresentation(detailTask).phase === 'COMPLETED'"
                  type="button"
                  class="matter-archive-action"
                  @click="$emit('archive-task', detailTask)"
                >收入案卷</button>
                <p v-else-if="detailTask.status === 'archived'" class="matter-archive-note">已收入案卷，可在“办事 → 案卷”中查看。</p>
              </section>
              <p v-if="taskPresentation(detailTask).readOnly && !isTerminalMatter(detailTask)" role="status">{{ taskPresentation(detailTask).reason }}；暂仅可查看，刷新核对后再操作。</p>
              <div v-if="!embeddedHall" class="task-detail-head">
                <div>
                  <strong>{{ detailTask.title }}</strong>
                  <small>{{ detailTask.id }} / {{ taskStatusText(detailTask) }}</small>
                </div>
                <span :class="taskStateClass(detailTask)">{{ taskStatusText(detailTask) }}</span>
              </div>

              <p v-if="!embeddedHall">{{ detailTask.description || '榜文尚未写明缘由' }}</p>
              <section v-if="!embeddedHall" class="workspace-shortcut" aria-label="榜文百宝箱入口">
                <div>
                  <strong>资料与交付</strong>
                  <p>资料和成果可在议事中预览、下载；需要保留时存入工作空间，在事项详情核对本次成果并验收。</p>
                </div>
                <button type="button" @click="$emit('open-workspace')">打开百宝箱</button>
              </section>
              <TaskMaterialLinks
                v-if="formalTaskExecutionScope && !embeddedHall && canActOnTask(detailTask)"
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

              <section
                v-if="(canActOnTask(detailTask) && canCancelOrdinaryTask(detailTask)) || cancellationUnresolved"
                class="ordinary-cancellation"
                aria-label="普通事项取消"
              >
                <p>仅取消无资金事实、未实际开始的普通事项；已点将未开工也可申请，最终以服务端核验为准。历史指派与成果保留。</p>
                <button
                  type="button"
                  class="ordinary-cancel-action"
                  :disabled="cancellationBusy || showCancellationDialog || cancellationSubmitting"
                  @click="requestCancellation"
                >
                  {{ cancellationState?.taskId === detailTask.id && cancellationState.status === 'unresolved' ? '核对原取消结果' : '取消未开工事项' }}
                </button>
                <p v-if="cancellationState?.taskId === detailTask.id && cancellationState.status === 'unresolved'" role="status">结果尚未确认；只核对原事项，不重复提交取消。</p>
              </section>

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
                v-if="!embeddedHall && canActOnTask(detailTask)"
                :task="detailTask"
                :authorization-generation="authorizationGeneration"
              />

              <p v-if="detailTask.status === 'cancelled'" role="status">事项已取消；历史指派与成果保留，不再继续办理。</p>
              <section v-if="!embeddedHall || detailTask.status !== 'open'" class="matter-resources" aria-label="资料与成果">
                <h4 v-if="embeddedHall">资料与成果</h4>
                <p v-if="embeddedHall">参考资料在原议事中查看；正式成果以已提交批次为准。</p>
                <button type="button" class="matter-results-action" @click="$emit('open-formal-results', detailTask)">{{ taskPresentation(detailTask).readOnly ? '查看历史成果' : '查看正式成果与验收' }}</button>
              </section>
              <WorkItemPlanPanel v-if="!embeddedHall && canActOnTask(detailTask)" :task="detailTask" :enabled="workItemPlanEnabled" :authorization-generation="authorizationGeneration" />

              <div v-if="!embeddedHall" class="ability-tags">
                <span v-for="ability in detailTask.requiredAbilities || []" :key="ability">{{ ability }}</span>
                <span v-if="!(detailTask.requiredAbilities || []).length">不拘本领</span>
              </div>

              <div v-if="!embeddedHall && canActOnTask(detailTask)" class="task-operation-grid">
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
                  :disabled="isFundedTask(detailTask) || !hasTaskAction(detailTask, 'ASSIGN') || !recommendedAgents.length"
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
                  :disabled="!hasTaskAction(detailTask, 'DISCUSS') || !taskAssigneeIds(detailTask).length"
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

            <div v-if="!embeddedHall && canActOnTask(detailTask)" class="modal-agent-scroll">
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
            </div>
            <section v-if="hasTaskAction(detailTask, 'ASSIGN') && !assignableRecommendedAgents.length" class="no-agent-recruitment" role="status">
              <p>暂未寻得可领令的好汉。</p>
              <button type="button" @click="$emit('recruit-agent', detailTask)">去招贤令</button>
            </section>
          </div>
        </section>
      </div>
    </transition>
    <var-dialog
      v-model:show="showCancellationDialog"
      title="确认取消未开工事项？"
      :message="`即将申请取消“${cancellationCandidate?.task.title || '原事项'}”。仅限无资金事实且未实际开始的事项，最终由服务端核验；历史指派与成果保留。确认后不会继续办理；若结果未确认，只核对原结果，不重复提交。`"
      confirm-button-text="确认取消事项"
      cancel-button-text="保留事项"
      confirm-button-text-type="danger"
      @confirm="confirmCancellation"
      @cancel="dismissCancellation"
      @close="dismissCancellation"
    />
  </div>
</template>

<script setup>
import { projectHallTask } from '../../composables/juyiting/hallTaskPresentation.js'
import { canCancelOrdinaryTask, ordinaryTaskVersion, isTerminalMatter } from '../../composables/juyiting/useHallOrdinaryCancellation.js'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import BountyActionIcon from './BountyActionIcon.vue'
import WorkItemPlanPanel from './WorkItemPlanPanel.vue'
import TeamRecommendationPanel from './TeamRecommendationPanel.vue'
import TaskMaterialLinks from '@/components/personal-workspace/TaskMaterialLinks.vue'
import { formatSilverMicro, isCanonicalMicroAmount } from '@/utils/silverAmount'

// Native horizontal scrolling also follows keyboard focus without scrolling the page.
const revealStatusFilter = event => {
  const button = event.target?.closest?.('button')
  const row = event.currentTarget
  if (!button || !row) return
  const target = button.getBoundingClientRect()
  const viewport = row.getBoundingClientRect()
  if (target.left < viewport.left) row.scrollLeft += target.left - viewport.left
  else if (target.right > viewport.right) row.scrollLeft += target.right - viewport.right
}

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
  requirementCreateState: { type: Object, default: null },
  requirementCreateBusy: { type: Boolean, default: false },
  pointAndStartState: { type: Object, default: null },
  pointAndStartBusy: { type: Boolean, default: false },
  cancellationBusy: { type: Boolean, default: false },
  cancellationState: { type: Object, default: null },
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
  'cancel-task',
  'confirm-funded-quote',
  'cancel-funded-quote',
  'refresh-funded-claim',
  'recruit-agent',
  'check-requirement-create',
  'resume-requirement-create',
  'open-formal-results',
  'review-delivery',
  'mark-changed',
  'resume-funded-create',
  'check-point-and-start',
  'resume-point-and-start',
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
const selectedAssigneeIds = ref([])
const requirementCreateInputSummary = computed(() => {
  const intent = props.requirementCreateState?.intent
  const refs = (intent?.schemaVersion === 2 ? intent.body?.attachments : intent?.body?.inputRefs) || []
  return refs.length ? refs.map(item => `${item.fileId} v${item.version}`).join('、') : '无资料'
})
watch(() => [props.identityScope, props.authorizationGeneration], () => {
  modalTask.value = null
  selectedAssigneeIds.value = []
}, { flush: 'sync' })
const detailTask = computed(() => modalTask.value)
const showCancellationDialog = ref(false)
const cancellationCandidate = ref(null)
const cancellationSubmitting = ref(false)
const cancellationUnresolved = computed(() => props.cancellationState?.taskId === detailTask.value?.id && props.cancellationState?.status === 'unresolved')
const cancellationFence = computed(() => JSON.stringify([props.identityScope, props.authorizationGeneration,
  props.detailAllowed, props.selectedTask?.id, detailTask.value?.id, ordinaryTaskVersion(detailTask.value),
  detailTask.value?.status, detailTask.value?.startedAt, detailTask.value?.completedAt,
  detailTask.value?.funding, detailTask.value?.reward]))
const dismissCancellation = () => { showCancellationDialog.value = false; cancellationCandidate.value = null }
watch(cancellationFence, () => { dismissCancellation(); cancellationSubmitting.value = false }, { flush: 'sync' })
watch(() => [props.cancellationBusy, props.cancellationState], () => {
  if (!props.cancellationBusy) cancellationSubmitting.value = false
}, { flush: 'sync' })
onBeforeUnmount(dismissCancellation)
const requestCancellation = () => {
  if (!props.identityScope || !props.detailAllowed || props.cancellationBusy || cancellationSubmitting.value ||
      showCancellationDialog.value || !detailTask.value) return false
  // Uncertainty belongs to the existing scoped cancellation client. This path
  // only checks its original record; it must not create another POST intent.
  if (cancellationUnresolved.value) {
    cancellationSubmitting.value = true
    emit('cancel-task', detailTask.value)
    return true
  }
  if (!canCancelOrdinaryTask(detailTask.value)) return false
  const task = JSON.parse(JSON.stringify(detailTask.value))
  task.taskVersion = ordinaryTaskVersion(task)
  cancellationCandidate.value = Object.freeze({ task, fence: cancellationFence.value })
  showCancellationDialog.value = true
  return true
}
const confirmCancellation = () => {
  const candidate = cancellationCandidate.value
  dismissCancellation()
  if (!candidate || candidate.fence !== cancellationFence.value || props.cancellationBusy ||
      cancellationSubmitting.value || !canCancelOrdinaryTask(detailTask.value)) return false
  cancellationSubmitting.value = true
  emit('cancel-task', candidate.task)
  return true
}
const pointAndStartForDetail = computed(() => {
  const state = props.pointAndStartState
  return state?.intent?.taskId === detailTask.value?.id && state.intent?.body ? state : null
})
const pointAndStartRecoveryTitle = computed(() => ({
  UNKNOWN: '正在确认点将结果',
  PREPARING: '正在准备会话',
  ADMITTED: '需求已发送',
  ATTACHED: '已进入悬赏议事',
  HISTORICAL: '历史指派',
  FAILED: '点将未完成'
}[pointAndStartForDetail.value?.status] || '正在确认点将结果'))
const pointAndStartRecoveryHint = computed(() => ({
  UNKNOWN: '请刷新状态查看进度。',
  PREPARING: '准备完成后即可继续交流。',
  ADMITTED: '需求已发送，可从事项操作进入原议事。',
  ATTACHED: '可在会话中查看答复或继续修改。',
  HISTORICAL: '本次指派已结束，可查看历史记录。',
  FAILED: '请刷新状态查看详情。'
}[pointAndStartForDetail.value?.status] || '正在确认点将结果。'))
const pointAndStartInputSummary = computed(() => {
  const state = pointAndStartForDetail.value
  const refs = state?.projection?.inputs || state?.intent?.projection?.inputs || state?.intent?.body?.inputRefs
  if (!refs) return '本次需求添加的资料'
  return refs.length ? refs.map(ref => `${ref.fileId} v${ref.version}`).join('、') : '无资料'
})
// The parent is the only authority for task-scoped discussion/workspace facts.  A
// detail may never borrow the context of whichever task was previously selected.
const assignedAgentForTask = task => {
  const assignedIds = [...new Set(taskAssigneeIds(task).filter(Boolean))]
  if (assignedIds.length !== 1) return null
  return props.operableAgents.find(agent => agent.agentId === assignedIds[0]) || null
}
const assignableRecommendedAgents = computed(() => props.recommendedAgents.filter(agent => props.canAssign(detailTask.value, agent)))
const matterCandidateId = ref('')
const showMatterCandidates = ref(false)
const matterCandidates = computed(() => {
  const seen = new Set()
  return [...assignableRecommendedAgents.value, ...props.operableAgents]
    .filter(agent => agent?.agentId && props.canAssign(detailTask.value, agent) && !seen.has(agent.agentId) && seen.add(agent.agentId))
})
const matterAgent = computed(() => {
  if (!hasTaskAction(detailTask.value, 'ASSIGN')) return assignedAgentForTask(detailTask.value)
  return matterCandidateId.value ? matterCandidates.value.find(agent => agent.agentId === matterCandidateId.value) || null : matterCandidates.value[0] || null
})
watch(() => [props.identityScope, props.authorizationGeneration, detailTask.value?.id, detailTask.value?.taskVersion], () => { matterCandidateId.value = ''; showMatterCandidates.value = false }, { flush: 'sync' })
const confirmMatterAgent = () => {
  const agent = matterAgent.value
  if (!agent || props.pointAndStartBusy || pointAndStartForDetail.value || !hasTaskAction(detailTask.value, 'ASSIGN') || !props.canAssign(detailTask.value, agent)) return
  emit('assign-task', detailTask.value, agent)
}
const primaryStatusFilters = computed(() => props.taskStatusFilters.filter(item => !['HISTORY', 'UNKNOWN'].includes(item.value)))
const secondaryStatusFilters = computed(() => props.taskStatusFilters.filter(item => ['HISTORY', 'UNKNOWN'].includes(item.value)))
const secondaryStatusActive = computed(() => ['HISTORY', 'UNKNOWN'].includes(props.taskStatusFilter))
const openSecondaryStatus = () => { if (!secondaryStatusActive.value) emit('set-status-filter', Number(props.taskStatusCount('UNKNOWN')) > 0 ? 'UNKNOWN' : 'HISTORY') }
const simpleMatterStatus = task => props.taskStatusText(task)
const taskPresentation = task => projectHallTask({ task })
const hasTaskAction = (task, action) => taskPresentation(task).actions.includes(action)
const canActOnTask = task => hasTaskAction(task, 'ASSIGN') || hasTaskAction(task, 'DISCUSS')

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
const fundedRecoveryAbilities = computed(() => {
  const abilities = props.fundedCreateRecovery?.body?.requiredAbilities
  return Array.isArray(abilities) ? abilities.join('、') || '未填写' : abilities || '未填写'
})
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
const canCancelFunding = task => isFundedTask(task) && hasTaskAction(task, 'ASSIGN') && typeof (task.version ?? task.taskVersion) === 'string'
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

/* The list needs a bounded flex parent so it can own scrolling inside the Hall panel. */
.bounty-source {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

button {
  border: 0;
  cursor: pointer;
  font: inherit;
}

.ordinary-cancellation {
  display: grid;
  gap: 12px;
  min-width: 0;
  margin: 16px 0;
  padding-top: 16px;
  border-top: 1px solid var(--hall-border, #eadfd4);
}

.ordinary-cancellation > p {
  margin: 0;
  color: var(--hall-text-secondary, #68716b);
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.ordinary-cancel-action {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  box-sizing: border-box;
  padding: 9px 14px;
  border: 1px solid var(--hall-brand, #923f30);
  border-radius: 8px;
  background: var(--hall-surface, #fffefa);
  color: var(--hall-brand, #923f30);
  font-weight: 500;
  white-space: normal;
  overflow-wrap: anywhere;
}
.ordinary-cancel-action:hover:not(:disabled) { background: #f6eee8; border-color: #793326; }
.ordinary-cancel-action:focus-visible { outline: 3px solid #923f3080; outline-offset: 3px; }
.ordinary-cancel-action:disabled { opacity: .55; cursor: not-allowed; }

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.panel-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr) 44px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  color: #765f40;
  font-size: 13px;
}


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

.task-search { display: contents; }

.task-search input,
.task-search select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 44px;
  padding: 0 10px;
  border: 1px solid var(--hall-border-strong, #d7c3a2);
  border-radius: 8px;
  background: var(--work-paper, #fffdf6);
  color: var(--work-ink, #3f2815);
  font: inherit;
}

.task-search input:focus-visible,
.task-search select:focus-visible,
.task-refresh:focus-visible {
  outline: 2px solid var(--work-brand, #a44330);
  outline-offset: 2px;
}

.panel-toolbar .task-refresh {
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid var(--work-line, #d7c3a2);
}

.task-refresh .toolbar-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.requirement-create-recovery {
  flex: 0 1 auto;
  min-height: 0;
  max-height: min(35vh, 14rem);
  margin: 0 16px 12px;
  padding: 10px;
  overflow-y: auto;
  overflow-wrap: anywhere;
  border: 1px solid #b99358;
  border-radius: 8px;
  background: #fff4da;
  color: #4a3423;
}

.requirement-create-recovery p { margin: 6px 0; }
.requirement-create-recovery button { margin-right: 8px; padding: 6px 10px; border-radius: 6px; }

.task-data-state {
  margin: 0 16px 8px;
  color: #765f40;
  font-size: 13px;
}

.task-data-state.is-error { color: #b3261e; }

.task-status-tabs {
  display: flex;
  flex-wrap: nowrap;
  min-width: 0;
  overscroll-behavior-x: contain;
  flex: 0 0 auto;
  gap: 8px;
  padding: 0 12px 12px;
  overflow-x: auto;
}

.task-status-tabs button {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 10px;
  border-radius: 8px;
  background: #efe0c6;
  color: #4a3423;
  white-space: nowrap;
}

.task-status-tabs button:focus-visible { outline: 2px solid var(--hall-brand, #8d2d22); outline-offset: -2px; }

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
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 0;
  -webkit-overflow-scrolling: touch;
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

.no-agent-recruitment { display: grid; gap: 8px; margin: 12px 0; padding: 12px; border: 1px solid #d4bd97; border-radius: 6px; background: #fff8e7; }
.no-agent-recruitment p { margin: 0; }
.no-agent-recruitment button { justify-self: start; }
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

  .bounty-modal {
    width: 100%;
    max-width: 100%;
    max-height: 100%;
  }
}

/* ECO-V0 funded-preview additions; legacy bounty layout stays intact. */
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
.point-and-start-recovery { margin: 12px 0; padding: 12px; border: 1px solid #d6bb7f; border-radius: 8px; background: #fff9e9; color: #624a20; }
.point-and-start-recovery p { margin: 6px 0; }
.point-and-start-recovery button + button { margin-left: 8px; }
.matter-candidates,.task-secondary-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}.matter-candidates button,.task-secondary-filters button,.matter-agent-toggle,.matter-secondary-action{min-height:44px;padding:8px 12px;border:1px solid var(--hall-border,#e3e5dc);border-radius:8px;background:var(--hall-surface,#fffefa);color:var(--hall-text,#242e2b)}.matter-candidates button[aria-pressed="true"],.task-secondary-filters button[aria-pressed="true"]{border-color:var(--hall-brand,#923f30);color:var(--hall-brand,#923f30)}.matter-agent-toggle{margin-bottom:10px}.matter-secondary-action{width:100%;margin-top:8px}.matter-advice-card h3{margin:12px 0;overflow-wrap:anywhere}
.matter-resources h4{margin:12px 0 6px}.matter-resources p{color:var(--hall-text-muted,#68716b);font-size:13px;line-height:1.5}
</style>

<style scoped>
.bounty-modal-overlay.is-embedded-page{position:static;display:block;width:100%;height:auto;min-height:100%;padding:0;background:#f5f4f0;overflow:visible}.bounty-modal-overlay.is-embedded-page .bounty-modal{width:100%;max-width:none;min-height:100%;max-height:none;border:0;border-radius:0;box-shadow:none;background:#f5f4f0}.bounty-modal-overlay.is-embedded-page .bounty-modal-header{position:sticky;top:0;z-index:3;min-height:48px;padding:6px 16px;border-bottom:1px solid #e3e5dc;background:#fffefa}.bounty-modal-overlay.is-embedded-page .bounty-modal-header h3{font-size:17px;font-weight:500}.bounty-back-button{min-height:44px;padding:0 4px 0 0;border:0!important;background:transparent!important;color:#923f30!important;font:500 14px/1 inherit;cursor:pointer;white-space:nowrap}.bounty-modal-overlay.is-embedded-page .bounty-modal-header h3{flex:1;margin:0;color:#242e2b;text-align:left}.bounty-modal-overlay.is-embedded-page .bounty-modal-body{padding:0 0 96px}.bounty-modal-overlay.is-embedded-page .modal-task-info{padding:16px 16px 0}.matter-advice-card{display:grid;gap:12px;padding:16px;border:1px solid #eadfd4;border-radius:12px;background:#fffefa}.matter-advice-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.matter-advice-heading span{color:#923f30;font-size:13px;font-weight:600}.matter-advice-heading strong{padding:4px 8px;border-radius:999px;background:#f9efde;color:#87551c;font-size:12px}.matter-request{margin:0!important;padding-bottom:12px;border-bottom:1px solid #ece5dd;font-size:16px!important;line-height:1.75!important;color:#242e2b!important}.matter-advice-card dl{display:grid;gap:9px;margin:0}.matter-advice-card dl div{display:grid;grid-template-columns:70px minmax(0,1fr);gap:8px}.matter-advice-card dt{color:#68716b;font-size:12px}.matter-advice-card dd{margin:0;font-size:13px}.matter-fee-note{margin:0!important;padding:11px 12px;border-left:3px solid #c7a092;border-radius:8px;background:#f6eee8;color:#65473f!important;font-size:13px!important;line-height:1.65!important}.matter-agent-actions{display:flex;gap:8px;flex-wrap:wrap}.matter-primary-action,.matter-results-action{width:100%;min-height:46px;border-radius:8px!important;background:#923f30!important;color:#fffefa!important;border-color:#923f30!important}.matter-archive-action{width:100%;min-height:44px;border:1px solid #923f30!important;border-radius:8px!important;background:#fffefa!important;color:#923f30!important;font-weight:600}.matter-archive-note{margin:0!important;padding:10px;border-radius:8px;background:#eef5ec;color:#36643b!important;font-size:13px!important}.matter-agent-actions button{min-height:44px;padding:8px 14px;background:#923f30!important;color:#fffefa!important;border-color:#923f30!important}@media(max-width:620px){.bounty-modal-overlay.is-embedded-page .bounty-modal-body{display:block}.bounty-modal-overlay.is-embedded-page .modal-task-info{padding:12px 12px 0}.bounty-modal-overlay.is-embedded-page .modal-agent-scroll{margin-top:14px;max-height:none}.matter-advice-card dl div{grid-template-columns:64px minmax(0,1fr)}}
.matter-candidates,.task-secondary-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}.matter-candidates button,.task-secondary-filters button,.matter-agent-toggle,.matter-secondary-action{min-height:44px;padding:8px 12px;border:1px solid var(--hall-border,#e3e5dc);border-radius:8px;background:var(--hall-surface,#fffefa);color:var(--hall-text,#242e2b)}.matter-candidates button[aria-pressed="true"],.task-secondary-filters button[aria-pressed="true"]{border-color:var(--hall-brand,#923f30);color:var(--hall-brand,#923f30)}.matter-agent-toggle{margin-bottom:10px}.matter-secondary-action{width:100%;margin-top:8px}.matter-advice-card h3{margin:12px 0;overflow-wrap:anywhere}
.matter-resources h4{margin:12px 0 6px}.matter-resources p{color:var(--hall-text-muted,#68716b);font-size:13px;line-height:1.5}
</style>
