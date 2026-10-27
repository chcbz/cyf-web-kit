<template>
  <section class="task-workspace-panel" aria-labelledby="task-workspace-heading">
    <header class="task-workspace-header">
      <div class="task-workspace-heading">
        <span class="task-workspace-eyebrow">任务协作工作台</span>
        <h2 id="task-workspace-heading" >{{ task?.title || '任务协作' }}</h2>
      </div>
      <span class="task-connection-badge" :class="`is-${connectionState}`">{{ connectionLabel }}</span>
    </header>

    <p v-if="connectionMessage" class="task-connection-message" role="status" aria-live="polite">{{ connectionMessage }}</p>
    <p v-if="connectionState === 'error'" class="task-workspace-error" role="alert">{{ errorMessage }}</p>
    <button
      v-if="canRetry"
      class="task-workspace-retry"
      type="button"
      @click="$emit('retry')"
    >
      重新载入协作状态
    </button>

    <p v-if="!task" class="task-empty-state">请先明确选择任务与可访问的好汉，再查看协作状态。</p>

    <template v-else>
      <section class="task-workspace-summary" aria-labelledby="task-workspace-summary-heading">
        <div class="task-section-heading">
          <h3 id="task-workspace-summary-heading">任务摘要</h3>
          <span class="task-status">{{ statusText(task.status) }}</span>
        </div>
        <dl class="task-summary-grid">

          <div>
            <dt>协作方式</dt>
            <dd>{{ ({ solo: '独立办理', team: '团队协作', sequential: '依次办理', parallel: '并行办理' })[String(task.collaborationMode).toLowerCase()] || '待确认' }}</dd>
          </div>
          <div>
            <dt>风险</dt>
            <dd>{{ ({ low: '低', medium: '中', high: '高' })[String(task.riskLevel).toLowerCase()] || '待确认' }}</dd>
          </div>
          <div>
            <dt>最大成员</dt>
            <dd>{{ task.maxAgents }}</dd>
          </div>

        </dl>
        <div class="task-abilities" aria-label="所需本领">
          <span v-if="requiredAbilitiesPresentation.kind === 'empty'" class="task-muted">未声明所需本领</span>
          <span v-else-if="requiredAbilitiesPresentation.kind === 'invalid'" class="task-muted">所需本领格式不可用</span>
          <template v-else>
            <span
              v-for="ability in requiredAbilitiesPresentation.abilities"
              :key="ability.full"
              :title="ability.full"
              class="task-tag"
            >{{ ability.display }}</span>
            <span v-if="requiredAbilitiesPresentation.truncated" class="task-truncation" role="status">仅显示前 12 项本领</span>
          </template>
        </div>
      </section>

      <section class="task-workspace-section" aria-labelledby="task-members-heading">
        <div class="task-section-heading">
          <h3 id="task-members-heading">成员</h3>
          <span>{{ workspace.members.length }} 人</span>
        </div>
        <p v-if="!workspace.members.length" class="task-empty-state">暂未载入成员。</p>
        <ul v-else class="task-data-list" aria-label="协作成员">
          <li v-for="(member, index) in workspace.members" :key="member.agentId" class="task-data-row">
            <strong>{{ member.name || member.personaName || `成员 ${index + 1}` }}</strong>
            <span>{{ roleText(member.role) }}</span>
            <span>{{ statusText(member.status) }}</span>
          </li>
        </ul>
      </section>

      <section class="task-workspace-section" aria-labelledby="task-work-items-heading">
        <div class="task-section-heading">
          <h3 id="task-work-items-heading">工作项</h3>
          <span>{{ workspace.workItems.length }} 项</span>
        </div>
        <WorkItemBoard :workspace="workspace" />
        <details v-if="workspace.workItems.length" class="task-work-item-details">
          <summary>查看工作项详情（{{ workspace.workItems.length }} 项）</summary>
          <ul class="task-card-list" aria-label="工作项详情">
            <li v-for="item in workspace.workItems" :key="item.workItemId" class="task-work-card">
              <div class="task-card-heading">
                <strong :title="item.title">{{ item.title }}</strong>
                <span class="task-status">{{ statusText(item.status) }}</span>
              </div>
              <p>{{ item.description || '未提供工作项说明。' }}</p>
              <dl class="task-card-meta">
                <div><dt>类型</dt><dd>{{ ({ analysis: '分析', implementation: '制作', verification: '验证', review: '复核', coordination: '协调', documentation: '文档' })[item.workType] || '其他' }}</dd></div>
                <div><dt>承办</dt><dd>{{ assigneeName(item.assigneeAgentId) }}</dd></div>
                <div><dt>进度</dt><dd>{{ item.attemptCount }} / {{ item.maxAttempts }}</dd></div>
                <div><dt>必要</dt><dd>{{ item.requiredItem ? '是' : '否' }}</dd></div>
              </dl>
            </li>
          </ul>
        </details>
      </section>

      <section class="task-workspace-section" aria-labelledby="task-requests-heading">
        <div class="task-section-heading">
          <h3 id="task-requests-heading">待处理诉求</h3>
          <span>{{ workspace.openRequests.length }} 条</span>
        </div>
        <p v-if="!workspace.openRequests.length" class="task-empty-state">暂无待处理诉求。</p>
        <ul v-else class="task-card-list" aria-label="待处理诉求">
          <li v-for="request in workspace.openRequests" :key="request.requestId" class="task-work-card">
            <div class="task-card-heading">
              <strong :title="request.title">{{ request.title }}</strong>
              <span class="task-status">{{ statusText(request.status) }}</span>
            </div>
            <p>{{ request.description || '未提供诉求说明。' }}</p>
          </li>
        </ul>
      </section>

      <section class="task-workspace-section" aria-labelledby="task-artifacts-heading">
        <div class="task-section-heading">
          <h3 id="task-artifacts-heading">最近成果</h3>
          <span v-if="workspace.recentArtifactsTruncated" class="task-truncation" role="status">仅显示最近 100 条成果</span>
        </div>
        <p v-if="!workspace.recentArtifacts.length" class="task-empty-state">暂无可见成果。</p>
        <ul v-else class="task-data-list" aria-label="最近成果">
          <li v-for="artifact in workspace.recentArtifacts" :key="`${artifact.artifactId}:${artifact.artifactVersion}`" class="task-data-row">
            <strong :title="artifact.title">{{ artifact.title }}</strong>
            <span>{{ ({ document: '文档', file: '文件', text: '文字', image: '图片' })[String(artifact.artifactType).toLowerCase()] || '成果' }}</span>
            <span>{{ ({ public: '公开', private: '私有', team: '团队可见', task: '本事项可见' })[String(artifact.visibility).toLowerCase()] || '可见范围待确认' }}</span>
          </li>
        </ul>
      </section>

      <section class="task-workspace-section" aria-labelledby="task-conversation-heading">
        <h3 id="task-conversation-heading">关联会话</h3>
        <p v-if="workspace.conversationId" class="task-conversation-association">已关联议事记录</p>
        <p v-else class="task-empty-state">当前任务没有关联会话。</p>
      </section>

      <TaskTimeline :events="workspace.recentEvents" :truncated="workspace.timelineTruncated" />
    </template>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import TaskTimeline from './TaskTimeline.vue'
import WorkItemBoard from './WorkItemBoard.vue'

const props = defineProps({
  actorAgentId: { type: String, default: '' },
  connectionState: { type: String, default: 'idle' },
  error: { type: Object, default: null },
  workspace: {
    type: Object,
    default: () => ({
      task: null,
      members: [],
      workItems: [],
      openRequests: [],
      recentArtifacts: [],
      recentArtifactsTruncated: false,
      conversationId: null,
      recentEvents: [],
      timelineTruncated: false,
      currentVersion: '0'
    })
  }
})

defineEmits(['retry'])

const MAX_REQUIRED_ABILITIES_JSON_BYTES = 65535
const MAX_REQUIRED_ABILITIES_DISPLAY = 12
const MAX_REQUIRED_ABILITY_CODE_POINTS = 64

const hasBoundedUtf8Length = (value, maximum) => {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index)
    if (codePoint > 0xffff) index += 1
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
    if (bytes > maximum) return false
  }
  return true
}

const boundedAbilityText = value => {
  let text = ''
  let count = 0
  for (const codePoint of value) {
    if (count === MAX_REQUIRED_ABILITY_CODE_POINTS) return `${text}…`
    text += codePoint
    count += 1
  }
  return text
}

const parseRequiredAbilities = value => {
  if (value == null || value === '') return { kind: 'empty', abilities: [], truncated: false }
  if (typeof value !== 'string' || !hasBoundedUtf8Length(value, MAX_REQUIRED_ABILITIES_JSON_BYTES)) {
    return { kind: 'invalid', abilities: [], truncated: false }
  }
  if (value.trim() === '') return { kind: 'empty', abilities: [], truncated: false }

  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    return { kind: 'invalid', abilities: [], truncated: false }
  }
  if (!Array.isArray(parsed)) return { kind: 'invalid', abilities: [], truncated: false }

  const abilities = []
  const seen = new Set()
  let truncated = false
  for (const item of parsed) {
    if (typeof item !== 'string') return { kind: 'invalid', abilities: [], truncated: false }
    const normalized = item.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    if (abilities.length < MAX_REQUIRED_ABILITIES_DISPLAY) {
      abilities.push({ full: normalized, display: boundedAbilityText(normalized) })
    }
    else truncated = true
  }
  return abilities.length === 0
    ? { kind: 'empty', abilities, truncated: false }
    : { kind: 'ready', abilities, truncated }
}

const task = computed(() => props.workspace?.task || null)
const requiredAbilitiesPresentation = computed(() => parseRequiredAbilities(task.value?.requiredAbilities))
const connectionLabels = {
  idle: '等待选择',
  loading: '正在载入',
  snapshot_ready: '已加载',
  live: '实时同步',
  reconnecting: '正在恢复',
  degraded: '服务暂不可用',
  resyncing: '正在校准',
  error: '无法访问'
}
const statusText = value => ({ pending: '待处理', open: '待办理', ready: '可办理', claimed: '已领取', running: '办理中', active: '参与中', blocked: '暂时受阻', submitted: '待验收', completed: '已完成', failed: '失败', cancelled: '已取消', accepted: '已接受', resolved: '已解决', rejected: '已拒绝', left: '已退出' })[String(value).toLowerCase()] || '状态待确认'
const roleText = value => ({ coordinator: '协调', producer: '承办', reviewer: '复核', member: '成员' })[String(value).toLowerCase()] || '成员'
const assigneeName = id => { const i = props.workspace.members.findIndex(member => member.agentId === id); return i < 0 ? (id ? '承办信息待确认' : '未指派') : (props.workspace.members[i].name || props.workspace.members[i].personaName || `成员 ${i + 1}`) }
const connectionMessages = {
  idle: '',
  loading: '正在加载…',
  snapshot_ready: '正在连接…',
  live: '',
  reconnecting: '连接中断，正在重连…',
  degraded: '协作服务暂不可用，稍后可手动重新载入。',
  resyncing: '正在更新…',
  error: '当前选择无法读取协作状态。'
}
const connectionLabel = computed(() => connectionLabels[props.connectionState] || '状态未知')
const connectionMessage = computed(() => connectionMessages[props.connectionState] ?? '协作状态未知。')
const errorMessage = computed(() => props.error?.message || '当前选择无权查看此协作工作台。')
const canRetry = computed(() => ['degraded', 'error'].includes(props.connectionState))
</script>

<style scoped>
.task-workspace-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
  padding: 16px;
  color: #3d332a;
  background: #fffaf0;
}

.task-workspace-header,
.task-section-heading,
.task-card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.task-workspace-heading {
  min-width: 0;
}

.task-workspace-eyebrow,
.task-workspace-heading h2,
.task-workspace-section h3 {
  margin: 0;
}

.task-workspace-eyebrow {
  display: block;
  color: #6c6258;
  font-size: 12px;
}

.task-workspace-heading h2 {
  overflow-wrap: anywhere;
  color: #213d34;
  font-size: 20px;
}

.task-connection-badge,
.task-status,
.task-tag {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 12px;
}

.task-connection-badge,
.task-status {
  color: #315d4e;
  background: #e8f2ed;
}

.task-connection-badge.is-error,
.task-connection-badge.is-degraded {
  color: #7a4638;
  background: #f8e6dc;
}

.task-connection-badge.is-snapshot_ready,
.task-connection-badge.is-reconnecting,
.task-connection-badge.is-resyncing,
.task-connection-badge.is-loading {
  color: #765d2d;
  background: #f7edcf;
}

.task-connection-message,
.task-workspace-error,
.task-empty-state,
.task-work-card p,
.task-conversation-association {
  margin: 0;
  overflow-wrap: anywhere;
}

.task-connection-message,
.task-empty-state {
  color: #6c6258;
}

.task-workspace-error {
  color: #8a3d30;
}

.task-workspace-retry {
  align-self: flex-start;
  border: 1px solid #315d4e;
  border-radius: 6px;
  padding: 7px 10px;
  color: #fffaf0;
  background: #315d4e;
  cursor: pointer;
}

.task-workspace-summary,
.task-workspace-section {
  min-width: 0;
  border: 1px solid rgba(55, 79, 67, 0.16);
  border-radius: 10px;
  padding: 12px;
  background: #fffdf7;
}

.task-section-heading h3,
.task-workspace-section h3 {
  color: #213d34;
  font-size: 15px;
}

.task-summary-grid,
.task-card-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  margin: 12px 0 0;
}

.task-summary-grid div,
.task-card-meta div {
  min-width: 0;
}

.task-summary-grid dt,
.task-card-meta dt {
  color: #786c60;
  font-size: 11px;
}

.task-summary-grid dd,
.task-card-meta dd {
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}

.task-abilities {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.task-tag {
  color: #4c463f;
  background: #efe0c6;
}

.task-muted,
.task-truncation {
  color: #76624b;
  font-size: 12px;
}

.task-data-list,
.task-card-list {
  display: grid;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.task-data-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 9px;
  border-radius: 7px;
  background: #f7f1e6;
}

.task-data-row > * {
  min-width: 0;
  overflow-wrap: anywhere;
}

.task-work-card {
  min-width: 0;
  border-radius: 8px;
  padding: 10px;
  background: #f7f1e6;
}

.task-work-card strong,
.task-work-card span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.task-work-card p {
  margin-top: 8px;
  color: #64594d;
}

.task-card-meta {
  margin-top: 9px;
}

.task-conversation-association {
  color: #315d4e;
}
</style>

<style scoped>
.task-workspace-retry:focus-visible {
  outline: 3px solid #c8952e;
  outline-offset: 2px;
}

@media (max-width: 640px) {
  .task-workspace-panel {
    gap: 12px;
    padding: 12px;
  }

  .task-workspace-header,
  .task-section-heading,
  .task-card-heading {
    align-items: flex-start;
  }

  .task-workspace-header,
  .task-section-heading {
    flex-direction: column;
  }

  .task-summary-grid,
  .task-card-meta,
  .task-data-row {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-workspace-panel {
    scroll-behavior: auto;
  }
}
</style>
