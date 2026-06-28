<template>
  <div class="persona-catalog-panel">
    <div class="catalog-summary">
      <span>{{ personas.length }} 位待请豪杰</span>
      <span>{{ boundToMeCount }} 位已入伙</span>
    </div>

    <section v-if="setupResult" class="setup-result">
      <div class="setup-head">
        <strong>{{ setupResult.message || setupTitle }}</strong>
        <div class="setup-tools">
          <button type="button" class="setup-copy" @click="copySetupResult">
            <var-icon name="content-copy" />
            <span>{{ copied ? '已复制' : '复制' }}</span>
          </button>
          <button type="button" class="setup-close" @click="$emit('clear-setup-result')">
            <var-icon name="close-circle-outline" />
          </button>
        </div>
      </div>
      <dl>
        <div>
          <dt>好汉编号</dt>
          <dd>{{ setupResult.agentId }}</dd>
        </div>
        <div>
          <dt>接应牌</dt>
          <dd>{{ setupResult.profileId }}</dd>
        </div>
        <div>
          <dt>安身处</dt>
          <dd>{{ setupResult.workdir }}</dd>
        </div>
      </dl>
      <div v-if="setupVariables.length" class="setup-variables">
        <strong>接应变量</strong>
        <div class="setup-variable-grid">
          <div v-for="item in setupVariables" :key="item.key">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.value }}</dd>
          </div>
        </div>
      </div>
      <div v-if="isLocalSetup" class="setup-note">
        <strong>
          安装说明
          <a :href="INSTALL_GUIDE_URL" target="_blank" rel="noopener noreferrer">codex-ws-agent-install</a>
        </strong>
        <ol>
          <li v-for="step in installSteps" :key="step">{{ step }}</li>
        </ol>
      </div>
      <div v-if="normalizedEnvExample" class="setup-block">
        <span>.env</span>
        <pre>{{ normalizedEnvExample }}</pre>
      </div>
      <div v-if="setupResult.profileExample" class="setup-block">
        <span>codex-profiles.conf</span>
        <pre>{{ setupResult.profileExample }}</pre>
      </div>
      <ol v-if="displayCommands.length" class="setup-commands">
        <li v-for="command in displayCommands" :key="command">{{ command }}</li>
      </ol>
    </section>

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
            <span v-if="!(persona.abilities || []).length">未录本领</span>
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
              山寨安顿
            </button>
            <button
              class="catalog-action"
              type="button"
              @click="selectAccess(persona, 'local')"
            >
              自家接应
            </button>
            <button
              class="catalog-action subtle"
              type="button"
              @click="activePersonaCode = null"
            >
              且待
            </button>
          </template>
          <button
            v-if="persona.boundToMe && !persona.systemAgent && activePersonaCode !== persona.personaCode"
            class="catalog-action"
            type="button"
            @click="$emit('unbind-persona', persona)"
          >
            除名下山
          </button>
        </div>
        <span v-else class="catalog-state">{{ stateText(persona) }}</span>
      </article>
    </div>
  </div>
</template>

<script setup>
import { computed, onUnmounted, ref } from 'vue'

const PUBLIC_AGENT_WS_URL = 'wss://api.chaoyoufan.cn/ws/agent/channel'
const INSTALL_GUIDE_URL = 'https://gitee.com/chcbz/isp-install/blob/master/skills/codex-ws-agent-install/SKILL.md'
const LOCAL_API_KEY_PLACEHOLDER = '<key>'

const props = defineProps({
  personas: { type: Array, default: () => [] },
  portraitName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true },
  setupResult: { type: Object, default: null }
})

const emit = defineEmits(['bind-persona', 'unbind-persona', 'clear-setup-result'])

const activePersonaCode = ref(null)
const copied = ref(false)
let copiedTimer = null
const boundToMeCount = computed(() => props.personas.filter(persona => persona.boundToMe).length)
const setupTitle = computed(() => props.setupResult?.mode === 'server' ? '山寨安顿文书已备' : '自家接应文书已备')
const isLocalSetup = computed(() => props.setupResult?.mode === 'local')
const normalizedEnvExample = computed(() => normalizeEnvExample(props.setupResult))
const installSteps = computed(() => [
  '目标机器需已有 Node.js >= 20，并可执行 codex CLI。',
  '在 isp-install 仓库执行 sudo ./install.sh --profile agent，或直接执行 sudo ./shell/codex_ws_agent_install.sh。',
  '编辑 /home/isp/apps/codex-ws-agent/.env，填入 OPENCLAW_API_KEY，并确认 WS_URL、DEFAULT_CODEX_PROFILE、CODEX_PROFILES_FILE。',
  '把下方 profile 追加到 /home/isp/apps/codex-ws-agent/codex-profiles.conf。',
  '执行 node agent-client.mjs --validate 校验，通过后用 /home/isp/bin/codex_ws_agent.sh start 启动。'
])
const displayCommands = computed(() => {
  if (!isLocalSetup.value) return props.setupResult?.commands || []
  return [
    'sudo ./install.sh --profile agent',
    '或 sudo ./shell/codex_ws_agent_install.sh',
    'cd /home/isp/apps/codex-ws-agent && node agent-client.mjs --validate',
    '/home/isp/bin/codex_ws_agent.sh start',
    'systemctl status codex-ws-agent',
    'journalctl -u codex-ws-agent -f'
  ]
})
const setupVariables = computed(() => buildSetupVariables(props.setupResult, normalizedEnvExample.value))
const setupCopyText = computed(() => {
  if (!props.setupResult) return ''
  const sections = [
    setupVariables.value.length ? [
      'variables',
      ...setupVariables.value.map(item => `${item.key}=${item.value}`)
    ].join('\n') : '',
    isLocalSetup.value ? ['install guide', INSTALL_GUIDE_URL].join('\n') : '',
    normalizedEnvExample.value ? ['.env', normalizedEnvExample.value].join('\n') : '',
    props.setupResult.profileExample ? ['codex-profiles.conf', props.setupResult.profileExample].join('\n') : '',
    displayCommands.value.length ? ['commands', displayCommands.value.join('\n')].join('\n') : ''
  ].filter(Boolean)
  return sections.join('\n\n')
})

const canShowActions = (persona) => Boolean(persona.canBind || (persona.boundToMe && !persona.systemAgent))

const normalizeEnvExample = (setupResult) => {
  if (!setupResult) return ''
  if (!setupResult.envExample && setupResult.mode !== 'local') return ''
  const rawEnv = setupResult.envExample || [
    `WS_URL=${PUBLIC_AGENT_WS_URL}`,
    `OPENCLAW_API_KEY=${LOCAL_API_KEY_PLACEHOLDER}`,
    'DEFAULT_CODEX_PROFILE=codex-default',
    'CODEX_PROFILES_FILE=/home/isp/apps/codex-ws-agent/codex-profiles.conf',
    'HEARTBEAT_MS=30000',
    'RECONNECT_MAX_MS=1800000'
  ].join('\n')
  const lines = rawEnv.split(/\r?\n/)
  upsertEnvLine(lines, 'WS_URL', PUBLIC_AGENT_WS_URL)
  if (setupResult.mode === 'local') {
    upsertEnvLine(lines, 'OPENCLAW_API_KEY', parseConfigValue(rawEnv, 'OPENCLAW_API_KEY') || LOCAL_API_KEY_PLACEHOLDER)
    upsertEnvLine(lines, 'DEFAULT_CODEX_PROFILE', 'codex-default')
    upsertEnvLine(lines, 'CODEX_PROFILES_FILE', '/home/isp/apps/codex-ws-agent/codex-profiles.conf')
  }
  return lines.join('\n').trim()
}

const upsertEnvLine = (lines, key, value) => {
  const index = lines.findIndex(line => line.trim().startsWith(`${key}=`))
  const nextLine = `${key}=${value}`
  if (index >= 0) {
    lines[index] = nextLine
  } else {
    lines.unshift(nextLine)
  }
}

const parseConfigValue = (text = '', key) => {
  const line = String(text || '').split(/\r?\n/).find(item => item.trim().startsWith(`${key}=`))
  if (!line) return ''
  return line.slice(line.indexOf('=') + 1).trim()
}

const buildSetupVariables = (setupResult, envText) => {
  if (!setupResult) return []
  const agent = setupResult.agent || {}
  const profileText = setupResult.profileExample || ''
  const apiKey = parseConfigValue(profileText, 'apiKey') ||
    parseConfigValue(envText, 'OPENCLAW_API_KEY') ||
    LOCAL_API_KEY_PLACEHOLDER
  const variables = [
    ['agentId', 'agentId', setupResult.agentId || agent.agentId || parseConfigValue(profileText, 'agentId')],
    ['agentName', 'agentName', agent.name || parseConfigValue(profileText, 'agentName')],
    ['personaName', 'personaName', agent.personaName || parseConfigValue(profileText, 'personaName')],
    ['profileId', 'profileId', setupResult.profileId],
    ['apiKey', 'apiKey', apiKey],
    ['WS_URL', 'WS_URL', parseConfigValue(envText, 'WS_URL') || PUBLIC_AGENT_WS_URL],
    ['DEFAULT_CODEX_PROFILE', 'DEFAULT_CODEX_PROFILE', parseConfigValue(envText, 'DEFAULT_CODEX_PROFILE')],
    ['CODEX_PROFILES_FILE', 'CODEX_PROFILES_FILE', parseConfigValue(envText, 'CODEX_PROFILES_FILE')]
  ]
  return variables
    .filter(([, , value]) => value)
    .map(([key, label, value]) => ({ key, label, value }))
}

const copyText = async (text) => {
  if (!text) return false
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return true
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  return ok
}

const copySetupResult = async () => {
  let ok = false
  try {
    ok = await copyText(setupCopyText.value)
  } catch {
    ok = false
  }
  if (!ok) {
    copied.value = false
    return
  }
  copied.value = true
  if (copiedTimer) window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => {
    copied.value = false
  }, 1800)
}

const selectAccess = (persona, mode) => {
  activePersonaCode.value = null
  emit('bind-persona', persona, mode)
}

const stateText = (persona) => {
  if (persona.systemAgent) return '头领'
  if (persona.boundToMe) return '已上山'
  if (persona.bound) return '别处入伙'
  return '未到请时'
}

onUnmounted(() => {
  if (copiedTimer) window.clearTimeout(copiedTimer)
})
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
  padding: 0 12px 12px;
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
