<template>
  <Teleport to="body" :disabled="embedded">
    <component
      :is="embedded ? 'section' : 'dialog'"
      ref="dialogRef"
      class="skill-manager"
      :class="{ 'is-embedded': embedded }"
      aria-labelledby="skill-manager-title"
      @cancel.prevent.stop="escape"
      @keydown="onKeydown"
      @click="backdrop"
      @close="closed"
    >
      <header>
        <div><h2 id="skill-manager-title">技能管理</h2><p>{{ agentName }}</p></div>
        <button
          v-if="!embedded"
          class="ui-close"
          type="button"
          aria-label="关闭技能管理"
          title="关闭技能管理"
          @click="close"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          ><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div class="skill-scroll">
        <p v-if="!market.available" role="status">当前身份不可管理该Agent的技能。</p>
        <p v-if="market.storageError" role="alert">{{ market.storageError }}</p>
        <div v-if="market.error" class="skill-error" role="alert">
          <p>{{ market.error }}</p><button type="button" :disabled="market.loading" @click="refresh">重新读取</button>
        </div>
        <p v-if="market.loading && !market.catalog" role="status">正在读取技能…</p>
        <p v-else-if="market.catalog && !market.items.length" class="skill-empty">暂无已安装或可安装技能。</p>
        <div class="skill-unified-list" :aria-label="agentName + '的技能'" :aria-busy="market.loading">
          <article
            v-for="row in market.items"
            :key="row.skillKey"
            class="skill-unified-row"
            :data-skill-row="row.skillKey"
          >
            <div class="skill-row-summary">
              <span class="skill-row-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                ><path d="M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6" /></svg>
              </span>
              <div class="skill-row-copy">
                <h3>{{ row.name }}<span class="skill-row-status">{{ rowStatus(row) }}</span></h3>
                <p>{{ row.description }}</p>
                <small>{{ versionText(row) }}</small>
              </div>
              <div class="skill-row-actions">
                <button
                  v-if="expanded === row.skillKey"
                  type="button"
                  :aria-controls="panelId(row)"
                  aria-expanded="true"
                  @click="collapse"
                >收起</button>
                <template v-else>
                  <button
                    v-if="row.installed && row.allowedActions.includes('VIEW')"
                    class="skill-secondary-action"
                    type="button"
                    :aria-controls="panelId(row)"
                    aria-expanded="false"
                    @click="expand(row, 'detail', $event)"
                  >详情</button>
                  <button
                    v-if="hasOperation(row)"
                    type="button"
                    :aria-controls="panelId(row)"
                    aria-expanded="false"
                    @click="expand(row, 'progress', $event)"
                  >{{ unknown(row) ? '核对结果' : '查看进度' }}</button>
                  <button
                    v-else-if="row.allowedActions.includes('INSTALL')"
                    type="button"
                    :aria-controls="panelId(row)"
                    aria-expanded="false"
                    @click="expand(row, 'INSTALL', $event)"
                  >安装</button>
                  <button
                    v-else-if="row.allowedActions.includes('UPGRADE')"
                    type="button"
                    :aria-controls="panelId(row)"
                    aria-expanded="false"
                    @click="expand(row, 'UPGRADE', $event)"
                  >升级</button>
                  <button
                    v-else-if="!row.installed && row.allowedActions.includes('VIEW')"
                    class="skill-secondary-action"
                    type="button"
                    @click="expand(row, 'detail', $event)"
                  >详情</button>
                </template>
              </div>
            </div>
            <div v-if="expanded === row.skillKey" :id="panelId(row)" class="skill-inline-panel">
              <h4 ref="inlineTitleRef" tabindex="-1" class="skill-inline-title">{{ modeTitle }} · {{ row.name }}</h4>
              <template v-if="mode === 'detail'">
                <dl class="skill-detail-grid">
                  <dt>输入</dt><dd>{{ details(row)?.inputMimeTypes.join('、') || '未声明输入类型' }}</dd>
                  <dt>权限范围</dt><dd>{{ details(row)?.requiredPermissions.map(formatSkillPermission).join('；') || '无所需权限' }}</dd>
                  <dt>运行依赖</dt><dd>{{ details(row)?.requirements.join('；') || '无额外依赖声明' }}</dd>
                  <dt>运行状态</dt><dd>{{ runtimeLabels[row.runtime.state] }}<template v-if="row.runtime.reasonCode"> · {{ reasonLabels[row.runtime.reasonCode] }}</template></dd>
                  <dt>新调用</dt><dd>{{ row.admissionEnabled ? '已开放，仍需逐任务授权' : '未开放' }}<template v-if="change(row)?.status === 'SUCCEEDED' && !change(row).runtimeSynced"> · Runtime策略待同步</template></dd>
                </dl>
                <section class="skill-section">
                  <h4>使用控制</h4><p>只影响新调用，不中断已获授权任务，不删除成果与历史。</p>
                  <button
                    v-if="row.allowedActions.includes(row.desiredEnabled ? 'DISABLE' : 'ENABLE')"
                    type="button"
                    :disabled="blocked(row)"
                    @click="prepareToggle(row)"
                  >{{ row.desiredEnabled ? '停用新调用' : '启用新调用' }}</button>
                </section>
              </template>
              <template v-else-if="mode === 'INSTALL' || mode === 'UPGRADE'">
                <p v-if="mode === 'INSTALL' && row.runtime.state === 'OFFLINE'" class="skill-note">Agent当前离线；合法接纳后等待连接，沿原操作继续，不重复购买。</p>
                <div v-if="mode === 'UPGRADE'" class="skill-version-compare">
                  <div><small>当前版本</small><strong>{{ row.installed?.version.skillVersion }}</strong></div><span aria-hidden="true">→</span><div><small>本次目标</small><strong>{{ row.candidate?.skillVersion }}</strong></div>
                </div>
                <p v-if="mode === 'UPGRADE'">{{ row.candidate?.changeSummary }}</p>
                <p v-if="mode === 'UPGRADE'" class="skill-note">准备失败保留旧版；旧任务继续原版本，不自动重发旧消息。升级保留当前启停期望。</p>
                <button
                  v-if="market.pending[row.skillKey]?.kind === 'QUOTE'"
                  type="button"
                  :disabled="draft(row)?.quoteBusy || blocked(row)"
                  @click="abandon(row)"
                >放弃未提交报价</button>
                <p v-if="draft(row)?.message" class="skill-error" role="alert">{{ draft(row).message }}</p>
                <p class="skill-install-quote" role="status">
                  <template v-if="draft(row)?.quote">本次报价 {{ money(draft(row).quote.price) }} · {{ draft(row).quote.coverage === 'ENTITLEMENT' ? '现有权益覆盖' : '本次购买' }} · 有效至 {{ dateTime(draft(row).quote.expiresAt) }}</template>
                  <template v-else>获取报价后安装或升级。</template>
                </p>
                <details class="skill-deferred"><summary>技能详情与费用</summary><p class="skill-permission-details"><span v-for="permission in row.candidate?.requiredPermissions || []" :key="permission">{{ formatSkillPermission(permission) }}；</span></p><p>输入：{{ row.candidate?.inputMimeTypes.join('、') || '未声明' }}</p><p>依赖：{{ row.candidate?.requirements.join('；') || '无额外声明' }}</p><p>{{ row.candidate?.executionCostDescription || '执行服务费用未提供说明，不据此认定免费。' }}</p><p>购买费用与执行服务费用分开；安装不自动执行任务。</p></details>
                <footer class="skill-inline-footer">
                  <span>{{ agentName }} · {{ row.name }} · {{ row.candidate?.skillVersion }}</span>
                  <button
                    v-if="!draft(row)?.quote"
                    class="primary"
                    type="button"
                    :disabled="!market.canPrepare(row.skillKey)"
                    @click="quote(row)"
                  >{{ draft(row)?.quoteBusy ? '正在获取报价…' : '获取报价' }}</button>
                  <button
                    v-else
                    ref="confirmRef"
                    class="primary"
                    type="button"
                    :disabled="blocked(row) || market.loading || !!market.error"
                    @click="submit(row)"
                  >{{ market.busy[row.skillKey] ? '正在提交…' : mode === 'INSTALL' ? '确认安装' : '确认升级' }}</button>
                </footer>
              </template>
              <template v-else-if="mode === 'ENABLE' || mode === 'DISABLE'">
                <p>{{ mode === 'DISABLE' ? '停用' : '启用' }} {{ row.name }} 的新调用？不会中断已授权任务，也不删除成果或历史。</p>
                <p v-if="mode === 'ENABLE'" class="skill-note">需要真实安装、策略及当前目录核验后才开放新调用。</p>
                <footer class="skill-inline-footer"><span>{{ agentName }} · {{ row.name }} · {{ row.installed?.version.skillVersion }}</span><button
                  class="primary"
                  type="button"
                  :disabled="blocked(row) || market.loading || !!market.error"
                  @click="submit(row)"
                >{{ market.busy[row.skillKey] ? '正在提交…' : mode === 'DISABLE' ? '确认停用' : '确认启用' }}</button></footer>
              </template>
              <template v-else-if="mode === 'progress'">
                <div role="status"><p>{{ market.pending[row.skillKey]?.kind === 'QUOTE' ? '报价结果待核对；原键重放只恢复报价，不会自动安装。' : unknown(row) ? '结果尚未确认，只核对原操作，不重新购买。' : change(row) ? changeLabels[change(row).status] : '尚未收到操作标识，请原键核对。' }}</p><p v-if="change(row)?.reasonCode">{{ reasonLabels[change(row).reasonCode] }}</p></div>
                <ol v-if="change(row)" class="skill-progress" aria-label="当前操作阶段">
                  <li v-for="(step, index) in progressSteps" :key="step" :class="{ current: progressIndex(row) === index, done: progressIndex(row) > index }"><span>{{ index + 1 }}</span><strong>{{ step }}</strong></li>
                </ol>
                <p v-if="change(row)?.status === 'WAITING_AGENT'" class="skill-note">原操作已接纳，等待Agent连接后继续；无需再次安装或购买。</p>
                <p v-else-if="change(row)?.status === 'FAILED_RETRYABLE'" class="skill-note">已确认本次未生效，可重试原操作，不重新报价、不重复购买。</p>
                <p v-else-if="change(row)?.status === 'RECOVERY_REQUIRED'" class="skill-note">尚不能确认切换结果，不据此退款或判定失败；只核对原记录。</p>
                <p v-else-if="change(row)?.status === 'SUCCEEDED'" class="skill-note">{{ change(row).runtimeSynced ? '该动作已完成；实际运行状态另行核验。' : '已关闭新调用，Runtime策略仍待同步。' }}</p>
                <p v-if="market.queryUnknown[row.skillKey]" class="skill-error" role="alert">{{ market.queryUnknown[row.skillKey] }}</p>
                <details v-if="change(row)"><summary>原操作详情</summary><p>{{ change(row).skillChangeId }} · 第{{ change(row).attempt }}次尝试</p><p>{{ change(row).source?.skillVersion || '首次安装' }} → {{ change(row).target.skillVersion }}</p><p>资金：{{ fundingLabel(change(row).fundingStatus) }}<template v-if="change(row).price"> · {{ money(change(row).price) }}</template></p></details>
                <footer class="skill-inline-footer">
                  <span>{{ agentName }} · {{ row.name }} · {{ change(row)?.target.skillVersion || row.candidate?.skillVersion }}</span>
                  <button
                    v-if="change(row) || market.pending[row.skillKey]?.skillChangeId"
                    type="button"
                    :disabled="blocked(row)"
                    @click="market.checkOriginal(row.skillKey)"
                  >查询原操作</button>
                  <button
                    v-if="market.pending[row.skillKey] && !market.pending[row.skillKey].accepted"
                    type="button"
                    :disabled="blocked(row)"
                    @click="resume(row.skillKey)"
                  >以原键重放</button>
                  <button
                    v-if="market.pending[row.skillKey]?.kind === 'QUOTE'"
                    type="button"
                    :disabled="blocked(row)"
                    @click="abandon(row)"
                  >放弃未提交报价</button>
                  <button
                    v-else-if="change(row)?.retryAllowed && row.allowedActions.includes('RETRY')"
                    class="primary"
                    type="button"
                    :disabled="blocked(row)"
                    @click="market.retry(row.skillKey)"
                  >重试原操作</button>
                  <button
                    v-else-if="row.allowedActions.includes('RECONCILE')"
                    class="primary"
                    type="button"
                    :disabled="blocked(row)"
                    @click="market.reconcile(row.skillKey)"
                  >核对原操作</button>
                </footer>
              </template>
              <p v-for="denial in row.deniedActions" :key="denial.action" class="skill-note">{{ actionLabels[denial.action] }}：{{ reasonLabels[denial.reasonCode] }}</p>
            </div>
          </article>
        </div>
        <section
          v-for="record in orphanedPending"
          :key="record.skillKey"
          class="skill-error"
          role="status"
        >
          <p>{{ record.skillKey }} 的原操作结果尚未确认。</p><button v-if="record.skillChangeId" type="button" @click="market.checkOriginal(record.skillKey)">查询原操作</button><button
            v-if="!record.accepted"
            type="button"
            :disabled="market.busy[record.skillKey]"
            @click="resume(record.skillKey)"
          >以原键重放</button>
        </section>
        <details class="skill-records" @toggle="recordsToggled"><summary>操作记录<span v-if="market.changes.length"> · {{ market.changes.length }}</span></summary>
          <p v-if="market.recordsError" role="alert">{{ market.recordsError }}<button type="button" @click="market.refreshChanges">重读记录</button></p>
          <p v-else-if="!market.changes.length">暂无管理操作；不伪造历史记录。</p>
          <ol><li v-for="record in market.changes" :key="record.skillChangeId"><div><strong>{{ record.skillKey }} · {{ actionLabels[record.action] }} · {{ changeLabels[record.status] }}</strong><small>{{ dateTime(record.createdAt) }} · {{ record.actorLabel }}</small></div><p>{{ record.source?.skillVersion || '首次安装' }} → {{ record.target.skillVersion }}<template v-if="record.reasonCode"> · {{ reasonLabels[record.reasonCode] }}</template></p><small>{{ record.skillChangeId }}</small></li></ol>
        </details>
      </div>
    </component>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, proxyRefs, ref, watch } from 'vue'
import { formatSkillMoney, useSkillMarket } from '@/composables/useSkillMarket.js'
import { formatSkillPermission, SKILL_CHANGE_LABELS, SKILL_REASON_LABELS, SKILL_RUNTIME_LABELS, skillChangeTerminal } from '@/utils/skillManagementContract.js'
const props = defineProps({ show: Boolean, embedded: Boolean, targetAgent: { type: Object, default: null }, actorScopeKey: { type: String, default: '' }, identityKey: { type: String, default: '' }, enabled: { type: Boolean, default: true }, agentApi: { type: Object, default: null } })
const emit = defineEmits(['update:show', 'changed'])
const market = proxyRefs(useSkillMarket({ agentApi: props.agentApi || undefined, enabled: () => props.enabled, actorScopeKey: () => props.actorScopeKey, identityKey: () => props.identityKey, targetAgent: () => props.targetAgent, onChanged: change => emit('changed', change) }))
const dialogRef = ref(null); const inlineTitleRef = ref(null); const confirmRef = ref(null); const expanded = ref(''); const mode = ref('detail')
const agentName = computed(() => props.targetAgent?.name || props.targetAgent?.personaName || props.targetAgent?.agentId || '')
const actionLabels = { INSTALL: '安装', UPGRADE: '升级', ENABLE: '启用', DISABLE: '停用', RETRY: '重试', RECONCILE: '核对' }
const modeTitle = computed(() => ({ detail: '技能详情', progress: '操作进度', INSTALL: '确认安装', UPGRADE: '确认升级', ENABLE: '启用新调用', DISABLE: '停用新调用' })[mode.value])
const changeLabels = SKILL_CHANGE_LABELS; const reasonLabels = SKILL_REASON_LABELS; const runtimeLabels = SKILL_RUNTIME_LABELS; const money = formatSkillMoney
const progressSteps = ['后台接纳', '下载与校验', '安全切换', '回执与运行核验']
const progressIndex = row => ({ ACCEPTED: 0, WAITING_AGENT: 0, PREPARING: 1, PREPARED: 1, ACTIVATING: 2, VERIFYING: 3, SUCCEEDED: 4 })[change(row)?.status] ?? -1
const dateTime = at => new Date(at).toLocaleString('zh-CN', { hour12: false })
const fundingLabel = status => ({ NONE: '无资金冻结', HELD: '资金保留', CAPTURED: '已结算', REFUNDED: '已退款' })[status]
const draft = row => market.drafts[row.skillKey]
const change = row => market.latestChange(row)
const details = row => row.installed?.version || row.candidate
const panelId = row => `skill-inline-${row.skillKey}`
const blocked = row => !!market.busy[row.skillKey] || !!market.storageError || !market.available
const unknown = row => !!market.queryUnknown[row.skillKey] || (market.pending[row.skillKey] && !market.pending[row.skillKey].accepted) || change(row)?.status === 'RECOVERY_REQUIRED'
const hasOperation = row => !!market.pending[row.skillKey] || (change(row) && (!skillChangeTerminal(change(row)) || change(row).status === 'RECOVERY_REQUIRED' || (change(row).status === 'FAILED_RETRYABLE' && row.allowedActions.includes('RETRY')) || (change(row).status === 'FAILED_FINAL' && !row.allowedActions.some(action => ['INSTALL', 'UPGRADE'].includes(action)))))
const rowStatus = row => unknown(row) ? '待核对' : hasOperation(row) && change(row) ? changeLabels[change(row).status] : !row.installed ? '未安装' : row.desiredEnabled ? row.admissionEnabled ? '已启用' : '已启用，待核验' : '已停用新调用'
const versionText = row => row.installed ? `${row.installed.version.skillVersion}${row.candidate && row.candidate.productVersionId !== row.installed.version.productVersionId ? ` → ${row.candidate.skillVersion} 可升级` : ''}` : row.candidate?.skillVersion || '暂无批准候选'
const orphanedPending = computed(() => Object.values(market.pending).filter(record => !market.items.some(row => row.skillKey === record.skillKey)))
let trigger = null; let rowTrigger = null
const first = value => Array.isArray(value) ? value[0] : value
const focusHeading = () => nextTick(() => first(inlineTitleRef.value)?.focus({ preventScroll: true }))
const expand = (row, nextMode, event) => {
  rowTrigger = event?.currentTarget || document.activeElement
  if (['INSTALL', 'UPGRADE'].includes(nextMode)) {
    if (!market.prepare(row, nextMode)) return
    // Choosing the fixed candidate authorizes its declared permissions. A valid
    // existing quote is retained; no separate permission checkbox/confirmation.
    if (!draft(row)?.quote) market.setApprovedPermissions(row.skillKey, row.candidate?.requiredPermissions || [])
  }
  expanded.value = row.skillKey; mode.value = nextMode; void focusHeading()
}
const collapse = () => {
  const key = expanded.value; expanded.value = ''
  void nextTick(() => {
    const el = rowTrigger?.isConnected ? rowTrigger : Array.from(dialogRef.value?.querySelectorAll('[data-skill-row]') || []).find(el => el.dataset.skillRow === key)?.querySelector('button')
    el?.focus({ preventScroll: true })
  })
}
const close = () => { if (props.embedded) return; emit('update:show', false) }
const closed = () => { if (props.show && !dialogRef.value?.open) emit('update:show', false) }
const escape = () => { if (expanded.value) collapse(); else close() }
const backdrop = event => {
  if (props.embedded || event.target !== dialogRef.value) return
  const r = dialogRef.value.getBoundingClientRect()
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close()
}
const onKeydown = event => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); escape(); return }
  if (event.key !== 'Tab' || props.embedded) return
  const targets = Array.from(dialogRef.value?.querySelectorAll('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]') || []).filter(el => {
    if (!el.getClientRects().length) return false
    for (let parent = el.parentElement; parent && parent !== dialogRef.value; parent = parent.parentElement) if (parent.matches('details:not([open])') && !parent.querySelector(':scope > summary')?.contains(el)) return false
    return true
  })
  const current = document.activeElement
  if (targets.length && (!targets.includes(current) || (event.shiftKey ? current === targets[0] : current === targets.at(-1)))) { event.preventDefault(); (event.shiftKey ? targets.at(-1) : targets[0]).focus() }
}
const quote = async row => {
  const result = await market.requestQuote(row.skillKey)
  if (result && expanded.value === row.skillKey && ['INSTALL', 'UPGRADE'].includes(mode.value) && (props.show || props.embedded)) await nextTick(() => { first(confirmRef.value)?.focus(); first(confirmRef.value)?.scrollIntoView?.({ block: 'nearest' }) })
}
const submit = async row => { const result = await market.submit(row.skillKey); if ((result || market.pending[row.skillKey]) && expanded.value === row.skillKey) { mode.value = 'progress'; void focusHeading() } }
const resume = async key => {
  const quote = await market.resumeOriginal(key)
  if (quote?.quoteId && expanded.value === key) { mode.value = quote.action; await nextTick(() => first(confirmRef.value)?.focus()) }
}
const abandon = async row => { if (await market.abandonQuote(row.skillKey)) { mode.value = draft(row)?.action || 'detail'; void focusHeading() } }
const prepareToggle = row => { const action = row.desiredEnabled ? 'DISABLE' : 'ENABLE'; if (market.prepare(row, action)) { mode.value = action; void focusHeading() } }
const refresh = async () => { await market.refresh(); await market.refreshChanges() }
const recordsToggled = event => { if (event.target.open) void market.refreshChanges() }
watch([() => props.actorScopeKey, () => props.identityKey, () => props.targetAgent?.agentId, () => props.enabled], () => { expanded.value = ''; rowTrigger = null }, { flush: 'sync' })
watch(() => [props.show, props.embedded], async () => {
  await nextTick()
  if (props.show || props.embedded) {
    if (!props.embedded && !dialogRef.value?.open) { trigger = document.activeElement; dialogRef.value?.showModal?.(); if (!dialogRef.value?.showModal) dialogRef.value?.setAttribute('open', '') }
    market.setPolling(true)
    if (!props.embedded) dialogRef.value?.querySelector('button')?.focus()
  } else {
    market.setPolling(false)
    dialogRef.value?.close?.(); dialogRef.value?.removeAttribute('open')
    if (trigger?.isConnected) trigger.focus()
  }
}, { immediate: true })
onBeforeUnmount(() => { market.setPolling(false); if (trigger?.isConnected) trigger.focus() })
</script>

<style scoped>
.skill-manager { box-sizing: border-box; width: min(780px, calc(100vw - 40px)); max-width: none; max-height: calc(100dvh - 48px); height: fit-content; padding: 0; margin: auto; overflow: hidden; border: 1px solid var(--hall-border, #e3e5dc); border-radius: 12px; background: var(--hall-surface, #fffefa); color: var(--hall-text, #242e2b); font: 15px/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.skill-manager[open], .skill-manager.is-embedded { display: flex; flex-direction: column; }
.skill-manager::backdrop { background: #18252066; backdrop-filter: blur(3px); }
.skill-manager * { box-sizing: border-box; min-width: 0; }
header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 24px; border-bottom: 1px solid var(--hall-border, #e3e5dc); }
h2, h3, h4, p { margin: 0; } h2 { font-size: 18px; } header p, small, .skill-note { font-size: 13px; color: var(--hall-text-muted, #68716b); }
button { font: inherit; min-height: 44px; padding: 8px 14px; border: 1px solid var(--hall-border, #e3e5dc); border-radius: 7px; color: inherit; background: var(--hall-surface, #fffefa); cursor: pointer; white-space: normal; line-height: 1.5; }
button:hover:not(:disabled) { background: var(--hall-surface-subtle, #f3f3ed); } button.primary { background: var(--hall-brand, #923f30); border-color: var(--hall-brand, #923f30); color: #fffefa; } button.primary:hover:not(:disabled) { background: var(--hall-brand-hover, #793326); } button:disabled { opacity: .5; cursor: not-allowed; }
:is(button, input, summary):focus-visible { outline: 3px solid var(--hall-focus-ring, #923f3052); outline-offset: 2px; } .ui-close { width: 44px; height: 44px; padding: 10px; border-color: transparent; flex-shrink: 0; display: grid; place-items: center; } .ui-close svg { width: 20px; height: 20px; }
.skill-scroll { padding: 0 24px 8px; overflow-y: auto; min-height: 0; overscroll-behavior: contain; overflow-wrap: anywhere; }
.skill-unified-row { border-bottom: 1px solid var(--hall-border, #e3e5dc); }.skill-row-summary { display: flex; align-items: center; gap: 14px; padding: 20px 0; }.skill-row-icon { flex-shrink: 0; width: 40px; height: 40px; display: grid; place-items: center; border-radius: 9px; background: var(--hall-surface-subtle, #f3f3ed); color: #607064; }.skill-row-icon svg { width: 22px; height: 22px; }.skill-row-copy { flex: 1; }.skill-row-copy h3 { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 15px; font-weight: 600; }.skill-row-copy p { font-size: 13px; margin-top: 3px; color: var(--hall-text-muted, #68716b); }.skill-row-copy small { display: block; margin-top: 3px; }.skill-row-status { font-size: 13px; font-weight: 400; color: var(--hall-text-muted, #68716b); }.skill-row-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }.skill-row-actions button { padding: 6px 14px; font-size: 14px; color: var(--hall-brand, #923f30); border-color: #ddc8be; }.skill-row-actions .skill-secondary-action { border-color: transparent; color: var(--hall-text-muted, #68716b); background: transparent; }
.skill-inline-panel { padding: 0 0 20px 54px; }.skill-inline-title { padding: 14px 0; margin: 0; border-top: 1px dashed var(--hall-border, #e3e5dc); font-size: 14px; }.skill-inline-title:focus { outline: none; }.skill-detail-grid { display: grid; grid-template-columns: 100px 1fr; margin: 0; font-size: 14px; }.skill-detail-grid dt, .skill-detail-grid dd { margin: 0; padding: 12px 0; border-bottom: 1px solid var(--hall-border, #e3e5dc); }.skill-section { margin: 16px 0; }.skill-section h4 { font-size: 15px; }.skill-section p { margin-bottom: 12px; font-size: 14px; }.skill-install-permissions { margin: 12px 0; }.skill-install-permissions h4 { font-size: 14px; }.skill-install-permissions label { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 14px; cursor: pointer; }.skill-install-permissions input { width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--hall-brand, #923f30); }.skill-install-quote, .skill-deferred { font-size: 14px; }.skill-version-compare { display: grid; grid-template-columns: 1fr auto 1fr; gap: 16px; align-items: center; padding: 12px 16px; background: var(--hall-surface-subtle, #f3f3ed); border-radius: 10px; margin-bottom: 16px; }.skill-version-compare small { display: block; }.skill-version-compare strong { font-size: 22px; }.skill-inline-footer { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 16px; flex-wrap: wrap; }.skill-inline-footer > span { margin-right: auto; font-size: 13px; color: var(--hall-text-muted, #68716b); }
summary { cursor: pointer; min-height: 44px; padding: 10px 0; } .skill-records { font-size: 13px; color: var(--hall-text-muted, #68716b); }.skill-records ol, .skill-progress { list-style: none; padding: 0; margin: 0; }.skill-records li { padding: 16px 0; border-bottom: 1px solid var(--hall-border, #e3e5dc); color: var(--hall-text, #242e2b); }.skill-records li > div { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }.skill-progress { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }.skill-progress li { display: flex; gap: 8px; align-items: center; padding: 12px 0; border-top: 2px solid var(--hall-border, #e3e5dc); font-size: 13px; }.skill-progress li > span { background: var(--hall-surface-subtle, #f3f3ed); border-radius: 50%; width: 28px; height: 28px; flex-shrink: 0; text-align: center; line-height: 28px; }.skill-progress .current { border-color: var(--hall-brand, #923f30); }.skill-progress .done { border-color: var(--hall-positive, #36643b); }.skill-error { color: var(--hall-danger, #a13f35); padding: 8px 0; font-size: 14px; }.skill-empty { padding: 24px 0; }
.is-embedded { width: 100%; max-height: none; margin: 0; }
@media (max-width: 720px) { .skill-manager { width: calc(100vw - 24px); max-height: calc(100dvh - 24px); } header { padding: 14px 16px; }.skill-scroll { padding: 0 16px 8px; }.skill-row-summary { gap: 10px; padding: 16px 0; }.skill-row-icon { display: none; }.skill-row-copy h3 { font-size: 14px; gap: 6px; }.skill-row-actions { flex-direction: column; gap: 0; }.skill-row-actions button { padding: 6px 10px; }.skill-row-actions .skill-secondary-action { order: 2; }.skill-inline-panel { padding-left: 0; }.skill-detail-grid { grid-template-columns: 78px 1fr; gap: 0 10px; }.skill-progress { grid-template-columns: 1fr 1fr; gap: 8px; }.is-embedded { width: 100%; } }
</style>
