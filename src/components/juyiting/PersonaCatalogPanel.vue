<template>
  <div class="persona-catalog-panel">
    <div class="catalog-summary">
      <span>{{ personas.length }} 位待请豪杰</span>
      <span>{{ boundToMeCount }} 位已入伙</span>
    </div>
    <p v-if="hostedPointFlow" class="catalog-flow-note" role="status">先为原榜文请一位平台托管的好汉；安顿确认后仍须等点将册显示本人可操作且在线，才会回到原榜文供你明确点将。</p>
    <p v-if="loading" class="catalog-data-state" role="status">招贤令读取中…</p>
    <p v-else-if="errorMessage" class="catalog-data-state is-error" role="alert">{{ errorMessage }}</p>

    <section v-if="setupResult" class="setup-result">
      <div class="setup-head">
        <strong>{{ setupResult.message || setupTitle }}</strong>
        <button type="button" class="setup-close hall-tool" aria-label="关闭接应文书" @click="$emit('clear-setup-result')" title="关闭接应文书"><svg class="hall-control-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </div>
      <template v-if="isLocalSetup">
        <p>Runtime {{ runtimeSetup.runtimeProtocolVersion }} 自行部署；安装授权不代表 Runtime 在线或事项可办理。</p>
        <dl class="runtime-scope">
          <div><dt>Tenant</dt><dd>{{ runtimeSetup.tenantId }}</dd></div>
          <div><dt>Client</dt><dd>{{ runtimeSetup.clientId }}</dd></div>
          <div><dt>Agent</dt><dd>{{ runtimeSetup.canonicalAgentId }}</dd></div>
          <div><dt>Manifest 版本</dt><dd>{{ runtimeSetup.manifestVersion }}</dd></div>
        </dl>
        <div class="setup-note">
          <div class="runtime-guide-head">
            <strong>Runtime 指引</strong>
            <button type="button" class="setup-copy" @click="copyRuntimeGuide">{{ runtimeCopied ? '已复制文书' : '复制接入说明' }}</button>
          </div>
          <a :href="runtimeSetup.guideUrl" target="_blank" rel="noopener noreferrer">打开自托管 Runtime v1 指引</a>
          <p class="runtime-layout">统一目录：程序放 apps/cyf-agent-runtime-v1，配置与策略放 conf/cyf-agent-runtime-v1，各角色 HOME 放 state/cyf-agent-runtime-v1/INSTANCE/agents/SUBJECT/codex-home；路径基目录使用目标机本人获授权的位置。</p>
          <p class="runtime-upgrade-note">已有统一 Runtime：升级或整理目录时沿用 installation、manifest、hostId、授权和完整会话，不重新生成交接材料、不重复登记或 enroll。按指引第9节迁移 HOME 与会话路径索引，核验后再退役旧入口；本页不会自动更新目标机。</p>
          <ol>
            <li>首次接入：在目标机安装 isp-install，并确认运行用户、文件 UID 与权限；系统模板 root 不可由非 root 运行用户直接使用。</li>
            <li>在 isp-install 仓库准备交接材料（有效期参数为 Unix 毫秒）：</li>
          </ol>
          <pre class="runtime-command">{{ prepareCommand }}</pre>
          <p>将目标机生成的 handoff.json 安全传回本页；不要粘贴或传送 enrollment-secret、subject-key、JWT 或 API Key。</p>
          <label class="handoff-import">导入 handoff.json<input type="file" accept="application/json,.json" @change="importHandoff" /></label>
          <p v-if="handoffMessage" role="status">{{ handoffMessage }}</p>
          <p v-if="runtimeError" class="runtime-error" role="alert">{{ runtimeError }}</p>
          <div class="runtime-actions">
            <button type="button" class="catalog-action primary" :disabled="!canCreateInstallation" @click="createInstallation">明确登记安装</button>
            <button type="button" class="catalog-action subtle" :disabled="!(importedHandoff || lastInstallationId) || runtimeBusy" @click="lookupInstallation">手动查询同一安装</button>
          </div>
          <p v-if="installationStatus" role="status">安装授权状态：{{ installationStatus }}。PENDING / ACTIVE 不代表在线；请继续完成 profile/host 配置、validate、enroll、服务切换，并以新事项验收。</p>
        </div>
      </template>
      <dl v-else>
        <div><dt>好汉编号</dt><dd>{{ setupResult.agentId }}</dd></div>
        <div><dt>接应牌</dt><dd>{{ setupResult.profileId }}</dd></div>
        <div><dt>安身处</dt><dd>{{ setupResult.workdir }}</dd></div>
      </dl>
    </section>

    <HostingRentPanel
      v-if="hostingPersona"
      :persona="hostingPersona"
      :resolve-persona="resolveHostingPersona"
      @close="hostingPersonaCode = null"
      @hosting-changed="$emit('hosting-changed')"
      @hosting-confirmed="handleHostingConfirmed"
    />

    <div class="catalog-grid">
      <article
        v-for="persona in personas"
        :key="persona.personaCode"
        class="persona-card"
        :class="{ 'is-bound': persona.bound, 'is-mine': persona.boundToMe, 'is-system': persona.systemAgent }"
      >
        <span
          class="persona-avatar portrait-avatar"
          :style="portraitStyle(persona)"
          :title="portraitName(persona)"
        ></span>
        <div class="persona-main">
          <div class="persona-head">
            <strong>{{ persona.name || persona.personaName }}</strong>
            <em>{{ persona.rankNo ? `第 ${persona.rankNo} 位` : '梁山好汉' }}</em>
          </div>
          <small>{{ portraitName(persona) }} / {{ persona.starName || '星号未载' }}</small>
          <div class="ability-tags">
            <span v-for="ability in (persona.abilities || []).slice(0, 3)" :key="ability">{{ ability }}</span>
            <span v-if="!(persona.abilities || []).length">暂无能力介绍</span>
          </div>
        </div>
        <div
          v-if="canShowActions(persona)"
          class="catalog-actions"
        >
          <button
            v-if="activePersonaCode !== persona.personaCode"
            class="catalog-action primary"
            type="button"
            @click="activePersonaCode = persona.personaCode"
          >
            {{ persona.boundToMe ? '重整接应' : '请上梁山' }}
          </button>
          <template v-else>
            <span class="access-prompt">择个接应去处</span>
            <button
              class="catalog-action primary"
              type="button"
              @click="selectAccess(persona, 'server')"
            >
              平台托管
            </button>
            <button
              v-if="!hostedPointFlow"
              class="catalog-action"
              type="button"
              @click="selectAccess(persona, 'local')"
            >
              自行部署
            </button>
            <button
              class="catalog-action subtle"
              type="button"
              @click="activePersonaCode = null"
            >
              暂不选择
            </button>
          </template>
          <button
            v-if="persona.boundToMe && !persona.systemAgent && activePersonaCode !== persona.personaCode"
            class="catalog-action"
            type="button"
            :disabled="unbindBusy"
            @click="$emit('request-unbind-persona', persona)"
          >
            移除好汉
          </button>
        </div>
        <span v-else class="catalog-state">{{ stateText(persona) }}</span>
      </article>
    </div>
  </div>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { agentApi } from '../../composables/useHttp.js'
import HostingRentPanel from './HostingRentPanel.vue'

const props = defineProps({
  personas: { type: Array, default: () => [] }, loading: { type: Boolean, default: false },
  unbindBusy: { type: Boolean, default: false }, errorMessage: { type: String, default: '' },
  portraitName: { type: Function, required: true }, portraitStyle: { type: Function, required: true },
  setupResult: { type: Object, default: null }, hostedPointFlow: { type: Boolean, default: false },
  identityScope: { type: [String, Number], default: '' }, identityEpoch: { type: [String, Number], default: '' },
  runtimeRole: { type: [String, Number], default: '' }
})
const emit = defineEmits(['bind-persona', 'request-unbind-persona', 'clear-setup-result', 'hosting-changed', 'hosting-confirmed'])
const activePersonaCode = ref(null)
const hostingPersonaCode = ref(null)
const hostingPersona = computed(() => props.personas.find(persona => persona.personaCode === hostingPersonaCode.value) || null)
const resolveHostingPersona = persona => props.personas.find(item => item.personaCode === persona.personaCode) || null
const boundToMeCount = computed(() => props.personas.filter(persona => persona.boundToMe).length)
const setupTitle = computed(() => props.setupResult?.mode === 'server' ? '平台托管文书已备' : '自行部署文书已备')
const isLocalSetup = computed(() => props.setupResult?.mode === 'local' && Boolean(props.setupResult?.runtimeSetup))
const runtimeSetup = computed(() => props.setupResult?.runtimeSetup || {})
const importedHandoff = ref(null)
const handoffMessage = ref('')
const runtimeError = ref('')
const installationStatus = ref('')
const runtimeBusy = ref(false)
const runtimeCopied = ref(false)
const createAttempted = ref(false)
const lastInstallationId = ref('')
const lastInstallationRequest = ref(null)
const requestKeys = ['installationId', 'canonicalAgentId', 'manifestVersion', 'manifestSha256', 'enrollmentSecretSha256', 'enrollmentExpiresAt']
const scopeKeys = ['tenantId', 'clientId', 'canonicalAgentId']
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`
const prepareCommand = computed(() => `"$ARTIFACT/node/bin/node" "$REPO/shell/cyf_runtime_enrollment_prepare.mjs" --tenant-id ${shellQuote(runtimeSetup.value.tenantId || '')} --client-id ${shellQuote(runtimeSetup.value.clientId || '')} --agent-id ${shellQuote(runtimeSetup.value.canonicalAgentId || '')} --output ABS_NEW_DIR --expires-at EPOCH_MS`)
const runtimeCopyText = computed(() => [
  'Runtime v1 自行部署文书',
  '统一目录：apps/cyf-agent-runtime-v1；conf/cyf-agent-runtime-v1；state/cyf-agent-runtime-v1/INSTANCE/agents/SUBJECT/codex-home（使用目标机本人获授权的基目录）。',
  '已有统一 Runtime 升级/迁移：保留身份、授权和完整会话，按指引第9节迁移路径索引，不重复登记或 enroll；下面 prepare 仅用于首次接入。',
  `Tenant: ${runtimeSetup.value.tenantId || ''}`, `Client: ${runtimeSetup.value.clientId || ''}`,
  `Agent: ${runtimeSetup.value.canonicalAgentId || ''}`, `Manifest version: ${runtimeSetup.value.manifestVersion || ''}`,
  `Guide: ${runtimeSetup.value.guideUrl || ''}`, prepareCommand.value,
  '安装 -> prepare -> 网页登记 -> profile/host 配置 -> validate -> enroll -> 服务切换 -> 新事项验收',
  'PENDING / ACTIVE 是安装授权状态，不代表 Runtime 在线。'
].join('\n'))
const canCreateInstallation = computed(() => Boolean(importedHandoff.value && !runtimeBusy.value && !createAttempted.value && importedHandoff.value.request.enrollmentExpiresAt > Date.now()))
let operationGeneration = 0
let mounted = true
const contextKey = computed(() => `${props.identityScope}\u0000${props.identityEpoch}\u0000${props.runtimeRole}\u0000${runtimeSetup.value.tenantId || ''}\u0000${runtimeSetup.value.clientId || ''}\u0000${runtimeSetup.value.canonicalAgentId || ''}`)
const clearRuntimeState = () => {
  operationGeneration += 1; importedHandoff.value = null; handoffMessage.value = ''; runtimeError.value = ''; installationStatus.value = ''; runtimeBusy.value = false; createAttempted.value = false; lastInstallationId.value = ''; lastInstallationRequest.value = null; runtimeCopied.value = false
}
watch(contextKey, clearRuntimeState, { flush: 'sync' })
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000')
const validHandoff = (value) => {
  if (!exactKeys(value, ['scope', 'request']) || !exactKeys(value.scope, scopeKeys) || !exactKeys(value.request, requestKeys)) return false
  const scope = runtimeSetup.value
  if (value.scope.tenantId !== scope.tenantId || value.scope.clientId !== scope.clientId || value.scope.canonicalAgentId !== scope.canonicalAgentId) return false
  const r = value.request
  if (r.canonicalAgentId !== scope.canonicalAgentId || r.manifestVersion !== scope.manifestVersion) return false
  if (!requestKeys.filter(key => key !== 'enrollmentExpiresAt').every(key => typeof r[key] === 'string' && r[key].length > 0)) return false
  if (!Number.isSafeInteger(r.enrollmentExpiresAt) || r.enrollmentExpiresAt <= 0) return false
  if (!/^rti_[0-9a-f]{32}$/.test(r.installationId)) return false
  if (!/^[a-f0-9]{64}$/.test(r.manifestSha256) || !/^[a-f0-9]{64}$/.test(r.enrollmentSecretSha256)) return false
  return true
}
const importHandoff = async event => {
  const file = event.target.files?.[0]
  event.target.value = ''
  clearRuntimeState()
  if (!file) return
  const generation = operationGeneration
  const context = contextKey.value
  try {
    const text = await file.text()
    if (!currentOperation(generation, context)) return
    const value = JSON.parse(text)
    if (!validHandoff(value)) throw new Error('invalid handoff')
    if (!currentOperation(generation, context)) return
    importedHandoff.value = { scope: { ...value.scope }, request: Object.fromEntries(requestKeys.map(key => [key, value.request[key]])) }
    handoffMessage.value = '交接材料已验证；原文件内容不会回显。'
  } catch {
    if (!currentOperation(generation, context)) return
    handoffMessage.value = ''
    runtimeError.value = '无法导入：仅接受当前 scope 匹配且不含额外字段或凭据的 handoff.json。'
  }
}
const currentOperation = (generation, context) => mounted && generation === operationGeneration && context === contextKey.value
const matchesInstallationView = (view, request) => Boolean(view && request &&
  view.runtimeInstallationId === request.installationId &&
  view.tenantId === runtimeSetup.value.tenantId && view.clientId === runtimeSetup.value.clientId &&
  view.canonicalAgentId === request.canonicalAgentId && view.manifestVersion === request.manifestVersion &&
  view.manifestSha256 === request.manifestSha256 && view.enrollmentExpiresAt === request.enrollmentExpiresAt)
const statusLabel = status => ['PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED'].includes(status) ? status : '状态未知'
const createInstallation = async () => {
  if (!importedHandoff.value || runtimeBusy.value || createAttempted.value) return
  const request = Object.fromEntries(requestKeys.map(key => [key, importedHandoff.value.request[key]]))
  lastInstallationId.value = request.installationId
  lastInstallationRequest.value = request
  if (request.enrollmentExpiresAt <= Date.now()) {
    runtimeError.value = '登记材料已过期；不会创建安装，可手动查询同一 installationId。'
    return
  }
  createAttempted.value = true
  const generation = ++operationGeneration; const context = contextKey.value
  const { installationId, ...registration } = request
  const body = { ...registration, runtimeInstallationId: installationId }
  runtimeBusy.value = true; runtimeError.value = ''; installationStatus.value = ''
  try {
    const result = await agentApi.post('/runtime/v1/installations', body, { autoLoading: false })
    if (!currentOperation(generation, context)) return
    const view = result
    if (!matchesInstallationView(view, request)) throw new Error('registration not confirmed')
    installationStatus.value = statusLabel(view.status)
    importedHandoff.value = null
  } catch {
    if (currentOperation(generation, context)) runtimeError.value = '登记结果未确认。不要重复创建；请先手动查询同一 installationId。'
  } finally { if (currentOperation(generation, context)) runtimeBusy.value = false }
}
const lookupInstallation = async () => {
  const request = importedHandoff.value?.request || lastInstallationRequest.value
  const id = request?.installationId || lastInstallationId.value
  if (!id || runtimeBusy.value) return
  const generation = ++operationGeneration; const context = contextKey.value
  runtimeBusy.value = true; runtimeError.value = ''
  try {
    const result = await agentApi.get(`/runtime/v1/installations/${encodeURIComponent(id)}`, undefined, { autoLoading: false })
    if (!currentOperation(generation, context)) return
    const view = result
    if (!matchesInstallationView(view, request)) throw new Error('lookup not confirmed')
    // A matching registration already exists; only query/enroll it, never offer create again.
    createAttempted.value = true
    installationStatus.value = statusLabel(view.status)
  } catch { if (currentOperation(generation, context)) runtimeError.value = '查询未确认：响应与当前 scope/installation 不匹配，或请求失败。' }
  finally { if (currentOperation(generation, context)) runtimeBusy.value = false }
}
const copyRuntimeGuide = async () => {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(runtimeCopyText.value)
    else {
      const input = document.createElement('textarea'); input.value = runtimeCopyText.value; input.setAttribute('readonly', ''); input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select(); let copied = false; try { copied = document.execCommand('copy') } finally { document.body.removeChild(input) }; if (!copied) throw new Error('copy failed')
    }
    runtimeCopied.value = true
  } catch { runtimeCopied.value = false }
}
const canShowActions = persona => Boolean(persona.canBind || (persona.boundToMe && !persona.systemAgent))
const handleHostingConfirmed = receipt => {
  emit('hosting-confirmed', receipt)
}

const selectAccess = (persona, mode) => {
  activePersonaCode.value = null
  if (mode === 'server') {
    hostingPersonaCode.value = persona.personaCode
    return
  }
  hostingPersonaCode.value = null
  emit('bind-persona', persona, mode)
}

const stateText = (persona) => {
  if (persona.systemAgent) return '头领'
  if (persona.boundToMe) return '已上山'
  if (persona.bound) return '别处入伙'
  return '未到请时'
}

onUnmounted(() => { mounted = false; clearRuntimeState() })
</script>

<style scoped>
.persona-catalog-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.catalog-summary {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  color: #765f40;
  font-size: 13px;
}

.catalog-data-state {
  flex: 0 0 auto;
  margin: 0 16px 8px;
  color: #765f40;
  font-size: 13px;
}

.catalog-data-state.is-error { color: #b3261e; }
.catalog-flow-note { flex: 0 0 auto; margin: 0 16px 12px; padding: 10px; border: 1px solid #d4bd97; border-radius: 8px; color: #6f493f; background: #fff8e7; font-size: 13px; }

.setup-result {
  flex: 0 0 auto;
  margin: 0 12px 12px;
  padding: 12px;
  border: 1px solid rgba(35, 72, 62, 0.22);
  border-radius: 8px;
  background: #edf1df;
  color: #2f3d33;
}

.setup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.setup-head strong {
  min-width: 0;
  font-size: 14px;
}

.setup-tools {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.setup-copy,
.setup-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 30px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: rgba(35, 72, 62, 0.1);
  color: #23483e;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.setup-close {
  width: 30px;
  padding: 0;
}

.setup-result dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 10px 0;
}

.setup-result dt {
  color: #6b7055;
  font-size: 12px;
}

.setup-result dd {
  margin: 2px 0 0;
  overflow: hidden;
  color: #23362f;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setup-note {
  margin: 8px 0 0;
  padding: 10px;
  border-radius: 8px;
  background: rgba(35, 72, 62, 0.08);
}

.setup-variables {
  margin: 8px 0 0;
  padding: 10px;
  border-radius: 8px;
  background: rgba(255, 248, 232, 0.56);
}

.setup-note strong,
.setup-variables > strong,
.setup-block span {
  display: block;
  color: #23483e;
  font-size: 12px;
  font-weight: 700;
}

.runtime-guide-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.runtime-command { white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.runtime-scope dd { white-space: normal; overflow-wrap: anywhere; user-select: text; }
.runtime-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.runtime-actions .catalog-action { min-height: 34px; padding: 7px 12px; }
.runtime-actions .catalog-action:disabled { opacity: .55; cursor: not-allowed; }
.setup-note a {
  margin-left: 6px;
  color: #7c3b20;
  text-decoration: none;
}

.setup-note a:hover {
  text-decoration: underline;
}

.setup-variable-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 8px;
}

.setup-variable-grid div {
  min-width: 0;
}

.setup-note ol {
  margin: 6px 0 0;
  padding-left: 20px;
  color: #4c5a4f;
  font-size: 12px;
  line-height: 1.55;
}

.setup-block {
  margin-top: 8px;
}

.setup-block pre,
.setup-commands {
  margin: 8px 0 0;
  padding: 10px;
  border-radius: 8px;
  background: rgba(255, 248, 232, 0.72);
  color: #3f3327;
  font-size: 12px;
  line-height: 1.5;
  overflow: auto;
}

.setup-commands {
  padding-left: 28px;
}

.catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  min-height: 0;
  padding: 12px 12px 12px;
  overflow: auto;
}

.persona-card {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(112, 76, 47, 0.16);
  border-radius: 8px;
  background: #f7ecd7;
}

.persona-card.is-mine {
  border-color: rgba(35, 72, 62, 0.36);
  background: #edf1df;
}

.persona-card.is-system {
  background: #ead3a9;
}

.persona-avatar {
  width: 46px;
  height: 46px;
  border-radius: 50%;
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

.persona-main {
  min-width: 0;
}

.persona-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.persona-head strong,
.persona-main small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.persona-head em,
.persona-main small {
  color: #765f40;
  font-size: 12px;
  font-style: normal;
}

.ability-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 7px;
}

.ability-tags span {
  padding: 2px 6px;
  border-radius: 8px;
  background: rgba(35, 72, 62, 0.12);
  color: #23483e;
  font-size: 12px;
}

.catalog-action,
.catalog-state,
.access-prompt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 32px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
}

.catalog-actions {
  display: flex;
  max-width: 100%;
  gap: 5px;
  align-items: center;
  justify-content: flex-end;
  white-space: nowrap;
}

.catalog-action {
  cursor: pointer;
  background: #efe0c6;
  color: #4a3423;
}

.catalog-action.primary {
  background: #23483e;
  color: #fff8e8;
}

.catalog-action.subtle {
  background: rgba(74, 52, 35, 0.08);
}

.catalog-state {
  color: #765f40;
}

.access-prompt {
  overflow: hidden;
  min-height: 22px;
  color: #765f40;
  font-size: 12px;
  text-overflow: ellipsis;
}

@media (max-width: 620px) {
  .setup-result dl {
    grid-template-columns: 1fr;
  }

  .setup-variable-grid {
    grid-template-columns: 1fr;
  }

  .catalog-grid {
    grid-template-columns: 1fr;
  }

  .persona-card {
    grid-template-columns: 44px minmax(0, 1fr);
  }

  .catalog-action,
  .catalog-actions,
  .catalog-state,
  .access-prompt {
    grid-column: 2;
    justify-self: start;
  }

  .catalog-actions {
    width: 100%;
    justify-content: flex-start;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .catalog-actions::-webkit-scrollbar {
    display: none;
  }
}
</style>
