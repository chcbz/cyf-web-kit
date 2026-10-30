<template>
  <div class="agent-panel" :class="{ 'is-compact-roster': isCompactRoster, 'is-agent-detail': canGoBack }">
    <div v-show="!canGoBack" class="panel-toolbar">
      <div class="status-filter">
        <button
          v-for="item in statusFilters"
          :key="item.value"
          :class="{ active: agentFilter === item.value }"
          @click="$emit('set-agent-filter', item.value)"
         class="hall-filter" :aria-pressed="agentFilter === item.value">
          {{ item.label }}
        </button>
      </div>
      <button type="button" @click="$emit('open-catalog')" class="hall-action-surface">招贤令</button>
      <span>名册 {{ agents.length }} 位 · 场景中 {{ mapAgents.length }} 位</span>
    </div>
    <p v-if="loading" class="panel-data-state" role="status">正在加载好汉名册…</p>
    <p v-else-if="errorMessage" class="panel-data-state is-error" role="alert">{{ errorMessage }}</p>

    <div class="agent-panel-body">
      <div
        v-show="listVisible"
        ref="listRef"
        class="agent-list"
        :inert="!listVisible ? '' : null"
        :aria-hidden="!listVisible ? 'true' : null"
      >
        <button
          v-for="agent in filteredAgents"
          :key="agent.agentId"
          class="agent-row"
          :class="{ active: selectedAgent?.agentId === agent.agentId }"
          :data-agent-id="agent.agentId"
          @click="openAgent(agent)"
        >
          <span
            class="mini-avatar portrait-avatar"
            :style="portraitStyle(agent)"
            :title="portraitName(agent)"
          ></span>
          <span>
            <strong>{{ agent.name || agent.personaName || agent.agentId }}</strong>
            <small>{{ portraitName(agent) }} / {{ agent.currentTaskTitle || abilityText(displayAgent(agent)) }}</small>
          </span>
          <em :class="statusClass(agent.status)">{{ statusText(agent.status) }}</em>
        </button>
      </div>

      <div
        v-show="detailVisible"
        class="detail-card"
        :inert="!detailVisible ? '' : null"
        :aria-hidden="!detailVisible ? 'true' : null"
      >
        <template v-if="selectedAgent">
          <div class="agent-detail-scroll">
            <div class="detail-head">
              <span
                class="large-avatar portrait-avatar"
                :style="portraitStyle(selectedAgent)"
                :title="portraitName(selectedAgent)"
              ></span>
              <div>
                <strong ref="detailTitleRef" tabindex="-1">{{ selectedAgent.name || selectedAgent.personaName || selectedAgent.agentId }}</strong>
                <small>{{ portraitName(selectedAgent) }}</small>
              </div>
            </div>
            <div v-if="canManagePolicy" class="external-policy" aria-label="接外单设置">
              <div class="external-policy-row">
                <span>接受平台其他用户的委派</span>
                <button
                  v-if="externalPolicy"
                  type="button"
                  role="switch"
                  :aria-checked="externalPolicy.enabled"
                  aria-describedby="external-policy-hint"
                  :disabled="!externalPolicyCanWrite"
                  @click="$emit('set-external-policy', !externalPolicy.enabled)"
                 class="hall-switch-control" aria-label="接受平台其他用户的委派" :aria-busy="externalPolicyBusy"><span class="hall-switch-track" aria-hidden="true"><span></span></span><span class="hall-switch-status">{{ externalPolicyBusy ? '核对中…' : externalPolicy.enabled ? '已开启' : '已关闭' }}</span></button>
                <span v-else role="status">{{ externalPolicyBusy ? '正在核对…' : '设置不可用' }}</span>
              </div>
              <p id="external-policy-hint" class="profile-note">面向同平台所有用户；关闭不影响已接任务，不要求当前在线。</p>
              <p v-if="externalPolicyError" class="profile-error" role="alert">{{ externalPolicyError }}</p>
              <p v-if="externalPolicyStatus === 'UNKNOWN'" role="status">原修改结果未知，暂不能另开修改。</p>
              <div v-if="externalPolicyStatus === 'UNKNOWN'" class="external-policy-recovery">
                <button type="button" :disabled="externalPolicyBusy" @click="$emit('check-external-policy')">查询结果</button>
                <button type="button" :disabled="externalPolicyBusy" @click="$emit('resume-external-policy')">继续核对</button>
              </div>
              <button
                v-else-if="externalPolicyStatus === 'UNAVAILABLE'"
                type="button"
                :disabled="externalPolicyBusy"
                @click="$emit('refresh-external-policy')"
              >重查设置</button>
            </div>
            <section class="profile-section" aria-label="技能">
              <div class="profile-heading">
                <h3>技能</h3>
                <small v-if="profile?.skills.status === 'AVAILABLE'">已核验安装 {{ installedCount }} 项</small>
                <button
                  v-if="canManagePolicy"
                  class="skill-manage-entry hall-tool"
                  type="button"
                  @click="skillManagementOpen = true"
                 aria-label="管理技能" title="管理技能"><svg class="hall-control-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M17 13v8m-4-4h8"/></svg></button>
              </div>
              <p v-if="!canReadProfile" role="status">仅拥有者可查看技能</p>
              <p v-else-if="profileCapabilitiesLoading" role="status">正在核对技能…</p>
              <p v-else-if="profileCapabilitiesError" class="profile-error" role="status">{{ profileCapabilitiesError }}</p>
              <p v-else-if="profile?.skills.status === 'UNAVAILABLE'" class="profile-error" role="status">技能读取失败，可重试</p>
              <template v-else-if="profile?.skills.status === 'AVAILABLE'">
                <p v-if="!profile.skills.items.length">暂无已登记技能</p>
                <div v-for="skill in profile.skills.items" :key="JSON.stringify([skill.skillKey, skill.skillVersion])" class="skill-item">
                  <div class="skill-title"><strong>{{ skill.title }}</strong><small>{{ skill.skillVersion }}</small></div>
                  <div class="skill-states">
                    <span>{{ skill.installationVerified ? '已核验安装' : '安装未核验' }}</span>
                    <span :class="{ 'is-ready': skill.runtimeState === 'RUNTIME_READY' }">{{ skill.runtimeState === 'RUNTIME_READY' ? '运行就绪' : profileReasonText(skill.reasonCode) }}</span>
                  </div>
                </div>
              </template>
              <p v-else role="status">技能资料尚未读取</p>
              <p class="profile-note">运行就绪不代表当前任务已获执行授权。</p>
            </section>
            <section class="profile-section" aria-label="本领">
              <div class="profile-heading">
                <h3>本领</h3>
                <button
                  v-if="profile && abilityEditor && !abilityEditor.editing.value"
                  ref="abilityEditButton"
                  class="ability-edit-link hall-tool"
                  type="button"
                  aria-label="编辑这位好汉的本领"
                  @click="abilityEditor.begin"
                 title="编辑这位好汉的本领"><svg class="hall-control-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m16 3 5 5M4 20l4-1L21 6l-3-3L5 16Z"/></svg></button>
              </div>
              <form v-if="abilityEditor?.editing.value" class="ability-editor" @submit.prevent="abilityEditor.save">
                <label for="hall-ability-editor">本领介绍</label>
                <p id="hall-ability-editor-hint">每行填写一项，例如：资料整理、方案撰写。留空表示暂不填写。</p>
                <textarea
                  id="hall-ability-editor"
                  ref="abilityTextarea"
                  v-model="abilityDraft.value"
                  rows="4"
                  placeholder="每行填写一项本领"
                  aria-describedby="hall-ability-editor-hint hall-ability-editor-note"
                  :disabled="abilityEditor.busy.value"
                ></textarea>
                <p id="hall-ability-editor-note">仅维护这位好汉的能力介绍，不会安装技能或改变技能状态。</p>
                <p v-if="abilityEditor.message.value" class="ability-editor-error" role="status">{{ abilityEditor.message.value }}</p>
                <div class="ability-editor-actions">
                  <button type="button" :disabled="abilityEditor.busy.value" @click="abilityEditor.cancel">取消</button>
                  <button
                    v-if="abilityEditor.needsCheck.value"
                    type="button"
                    :disabled="abilityEditor.busy.value"
                    @click="abilityEditor.checkLatest"
                  >核对最新本领</button>
                  <button class="ability-save" type="submit" :disabled="abilityEditor.busy.value || abilityEditor.needsCheck.value">{{ abilityEditor.busy.value ? '处理中…' : '保存' }}</button>
                </div>
              </form>
              <div v-else class="ability-tags">
                <span v-for="ability in displayedAbilities" :key="ability">{{ ability }}</span>
                <span v-if="!displayedAbilities.length">暂无能力介绍</span>
              </div>
              <p v-if="abilityEditor && !abilityEditor.editing.value && abilityEditor.message.value" role="status">{{ abilityEditor.message.value }}</p>
              <p v-if="!abilityEditor?.editing.value" class="profile-note">由你维护的能力介绍，仅供参考，不代表已安装技能或运行就绪。</p>
            </section>
            <div v-if="canReadProfile" class="profile-refresh">
              <button type="button" :disabled="profileCapabilitiesLoading" @click="$emit('refresh-profile-capabilities')" class="hall-tool" :aria-busy="profileCapabilitiesLoading" aria-label="刷新技能与本领" title="刷新技能与本领"><svg class="hall-control-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/></svg></button>
              <small v-if="profile" role="status">最近读取 {{ new Date(profile.observedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) }}</small>
            </div>
            <p v-if="canReadProfile" class="profile-note">只刷新当前好汉详情；读取最新已上报记录，不触发重新扫描或重注册。</p>
            <p v-if="selectedAgent.errorMessage || selectedAgent.currentTaskTitle" class="profile-note">{{ selectedAgent.errorMessage || selectedAgent.currentTaskTitle }}</p>
          </div>
          <div class="agent-detail-actions">
            <button
              v-if="canStartConversation(selectedAgent)"
              type="button"
              @click="$emit('start-conversation', selectedAgent)"
            >与这位好汉密议</button>
            <button
              v-if="hasPendingTask"
              class="point-and-deliberate"
              type="button"
              :disabled="pointAndStartBusy || !canPointAndDeliberate(selectedAgent)"
              @click="$emit('point-and-deliberate', selectedAgent)"
            >{{ pointAndStartBusy ? '正在点将…' : '点将并议事' }}</button>
          </div>
        </template>
        <p v-else>点一位厅中好汉，查看动静、本领与所领榜文。</p>
      </div>
    </div>
    <SkillManagement
      v-if="canManagePolicy"
      v-model:show="skillManagementOpen"
      :target-agent="selectedAgent"
      :actor-scope-key="actorScopeKey"
      :identity-key="identityKey"
      :enabled="active && canManagePolicy"
      @changed="$emit('refresh-profile-capabilities')"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import SkillManagement from '../economy/SkillManagement.vue'

const props = defineProps({
  active: { type: Boolean, default: true },
  identityKey: { type: String, default: '' },
  actorScopeKey: { type: String, default: '' },
  panelSessionKey: { type: Number, default: 0 },
  externalPolicy: { type: Object, default: null },
  externalPolicyStatus: { type: String, default: 'IDLE' },
  externalPolicyBusy: { type: Boolean, default: false },
  externalPolicyCanWrite: { type: Boolean, default: false },
  externalPolicyError: { type: String, default: '' },
  profileCapabilities: { type: Object, default: null },
  profileCapabilitiesLoading: { type: Boolean, default: false },
  profileCapabilitiesError: { type: String, default: '' },
  profileReasonText: { type: Function, default: () => '暂不可用' },
  abilityEditor: { type: Object, default: null },
  hasPendingTask: { type: Boolean, default: false },
  pointAndStartBusy: { type: Boolean, default: false },
  canPointAndDeliberate: { type: Function, default: () => false },
  canStartConversation: { type: Function, default: () => false },
  agents: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  errorMessage: { type: String, default: '' },
  filteredAgents: { type: Array, default: () => [] },
  mapAgents: { type: Array, default: () => [] },
  selectedAgent: { type: Object, default: null },
  agentFilter: { type: String, default: 'all' },
  statusFilters: { type: Array, default: () => [] },
  abilityText: { type: Function, required: true },
  portraitName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true },
  statusClass: { type: Function, required: true },
  statusText: { type: Function, required: true }
})

const emit = defineEmits(['set-agent-filter', 'select-agent', 'start-conversation', 'open-catalog', 'point-and-deliberate', 'refresh-profile-capabilities', 'set-external-policy', 'check-external-policy', 'resume-external-policy', 'refresh-external-policy'])
const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 720px)') : null
const isCompactRoster = ref(media?.matches || false)
const mobileDetailOpen = ref(false)
const skillManagementOpen = ref(false)
const listRef = ref(null)
const detailTitleRef = ref(null)
const abilityEditButton = ref(null)
const abilityTextarea = ref(null)
// Keep the editor-owned mutable Ref; this component does not replace its prop.
const abilityDraft = computed(() => props.abilityEditor?.draft)
watch(() => props.abilityEditor?.editing.value, async (editing, wasEditing) => {
  const agentId = props.selectedAgent?.agentId
  const identity = props.identityKey
  await nextTick()
  if (!props.active || agentId !== props.selectedAgent?.agentId || identity !== props.identityKey) return
  if (editing) abilityTextarea.value?.focus()
  else if (wasEditing && profile.value) abilityEditButton.value?.focus({ preventScroll: true })
})
let listScrollTop = 0
let focusAgentId = null
const canGoBack = computed(() => props.active && isCompactRoster.value && mobileDetailOpen.value)
const profileVisible = computed(() => props.active && Boolean(props.selectedAgent?.agentId) && (!isCompactRoster.value || mobileDetailOpen.value))
const listVisible = computed(() => props.active && (!isCompactRoster.value || !mobileDetailOpen.value))
const detailVisible = computed(() => props.active && (!isCompactRoster.value || mobileDetailOpen.value))
const windowTitle = computed(() => canGoBack.value ? '好汉详情' : '好汉名册')
const canManagePolicy = computed(() => props.selectedAgent?.boundToMe === true && props.selectedAgent?.canOperate === true && !props.selectedAgent?.systemAgent)
const canReadProfile = computed(() => props.selectedAgent?.boundToMe === true && props.selectedAgent?.systemAgent !== true)
const profile = computed(() => !props.profileCapabilitiesLoading && !props.profileCapabilitiesError && canReadProfile.value && props.profileCapabilities?.agentId === props.selectedAgent?.agentId ? props.profileCapabilities : null)
const displayedAbilities = computed(() => profile.value?.abilities || props.selectedAgent?.abilities || [])
const installedCount = computed(() => profile.value?.skills.items.filter(item => item.installationVerified).length || 0)
const displayAgent = agent => profile.value?.agentId === agent.agentId ? { ...agent, abilities: profile.value.abilities } : agent
const session = () => `${props.identityKey}:${props.panelSessionKey}`
const openAgent = async agent => {
  const origin = session()
  listScrollTop = listRef.value?.scrollTop || 0
  focusAgentId = agent.agentId
  mobileDetailOpen.value = true
  emit('select-agent', agent)
  await nextTick()
  if (origin === session() && canGoBack.value) detailTitleRef.value?.focus()
}
const back = () => {
  if (!canGoBack.value) return false
  const origin = session()
  mobileDetailOpen.value = false
  void nextTick(() => {
    if (origin !== session() || !listVisible.value) return
    if (listRef.value) {
      listRef.value.scrollTop = listScrollTop
      Array.from(listRef.value.querySelectorAll('[data-agent-id]')).find(row => row.dataset.agentId === focusAgentId)?.focus({ preventScroll: true })
    }
  })
  return true
}
watch(() => [props.identityKey, props.panelSessionKey], () => { mobileDetailOpen.value = false; listScrollTop = 0; focusAgentId = null }, { flush: 'sync' })
watch(() => props.selectedAgent?.agentId, id => { if (!id) mobileDetailOpen.value = false }, { flush: 'sync' })
watch([() => props.identityKey, () => props.selectedAgent?.agentId, () => props.active, canManagePolicy], () => { skillManagementOpen.value = false }, { flush: 'sync' })
const updateMedia = event => { isCompactRoster.value = event.matches }
onMounted(() => media?.addEventListener('change', updateMedia))
onUnmounted(() => media?.removeEventListener('change', updateMedia))
defineExpose({ canGoBack, back, windowTitle, profileVisible })
</script>

<style scoped>
.agent-panel .profile-heading .skill-manage-entry { margin-left: auto; min-height: 44px; padding: 4px 10px; border: 1px solid var(--hall-border, #e3e5dc); border-radius: 7px; color: var(--hall-text, #242e2b); background: #f3f4ee; font: inherit; font-size: 13px; line-height: 1.65; }
.skill-manage-entry:focus-visible { outline: 3px solid var(--hall-focus-ring, #923f3052); outline-offset: 2px; }
.agent-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

button {
  border: 0;
  cursor: pointer;
  font: inherit;
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

.status-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.status-filter button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  background: #efe0c6;
  color: #4a3423;
}

.status-filter button.active {
  background: #23483e;
  color: #fff;
}

.panel-data-state {
  margin: 0 16px 8px;
  color: #765f40;
  font-size: 13px;
}

.panel-data-state.is-error { color: #b3261e; }

.agent-panel-body {
  display: grid;
  grid-template-columns: minmax(0, 43fr) minmax(0, 57fr);
  gap: 12px;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 0 12px 12px;
  overflow: hidden;
}

.agent-list {
  overflow: auto;
  min-width: 0;
  min-height: 0;
  padding: 0;
}

.agent-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 10px;
  margin-bottom: 8px;
  border-radius: 8px;
  background: #f7ecd7;
  color: inherit;
  text-align: left;
}

.agent-row.active {
  background: #ead3a9;
}

.agent-row strong,
.agent-row small,
.detail-head small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-row small,
.detail-head small {
  color: #765f40;
  font-size: 12px;
}

.agent-row em {
  font-style: normal;
  font-size: 12px;
}

.mini-avatar,
.large-avatar {
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  background: #7c1f1b;
  color: #fff4d4;
  font-weight: 700;
}

.mini-avatar {
  width: 38px;
  height: 38px;
}

.large-avatar {
  flex: none;
  width: 68px;
  height: 68px;
  font-size: 22px;
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

.detail-card {
  min-width: 0;
  min-height: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  box-sizing: border-box;
  border-radius: 8px;
  background: var(--hall-surface, #fffefa);
  font-size: 14px;
}

/* The dock participates in layout; it never overlays scrollable details. */
.agent-detail-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  flex: none;
  margin-top: 0;
  padding: 12px 16px;
  padding-bottom: max(12px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--hall-border, #e3e5dc);
  background: var(--hall-surface, #fffefa);
  font-size: 14px;
  line-height: 1.6;
}

.agent-detail-actions button {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  max-width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--hall-brand, #923f30);
  border-radius: 7px;
  background: var(--hall-brand, #923f30);
  color: var(--hall-surface, #fffefa);
  white-space: normal;
}

.agent-detail-actions:has(.point-and-deliberate) button:not(.point-and-deliberate) {
  border-color: var(--hall-border, #e3e5dc);
  background: var(--hall-surface-subtle, #f3f3ed);
  color: var(--hall-text, #242e2b);
}

.agent-detail-actions button:hover:not(:disabled),
.agent-detail-actions button:focus-visible {
  filter: brightness(0.94);
}

.agent-detail-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}

.agent-detail-actions button:focus-visible {
  outline: 2px solid var(--hall-brand, #923f30);
  outline-offset: 2px;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  overflow-wrap: anywhere;
}

.detail-head > div {
  min-width: 0;
}

.detail-head small {
  white-space: normal;
  overflow-wrap: anywhere;
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

.agent-detail-scroll {
  flex: 1;
  min-height: 0;
  min-width: 0;
  padding: 16px;
  overflow: auto;
  overscroll-behavior: contain;
  overflow-wrap: anywhere;
}
.profile-section { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--hall-border, #e3e5dc); }
.profile-heading, .skill-title { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.profile-heading h3 { margin: 0; font-size: 14px; font-weight: 600; }
.profile-heading small, .skill-title small, .profile-note, .profile-refresh small { color: var(--hall-text-muted, #68716b); font-size: 12px; line-height: 1.6; }
.profile-note { margin: 8px 0; overflow-wrap: anywhere; }
.skill-item { padding: 12px; border: 1px solid var(--hall-border, #e3e5dc); border-radius: 8px; background: var(--hall-surface, #fffefa); }
.skill-item + .skill-item { margin-top: 8px; }
.skill-states { display: flex; gap: 6px; flex-wrap: wrap; font-size: 12px; }
.skill-states span { padding: 3px 7px; border-radius: 4px; color: #65665e; background: #f1f0eb; }
.skill-states .is-ready { color: #31644b; background: #eaf2e9; }
.profile-error { color: var(--hall-danger, #a13f35); }
.profile-refresh { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--hall-border, #e3e5dc); }
.profile-refresh button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--hall-border-strong, #ccd2c5); border-radius: 7px; background: var(--hall-surface, #fffefa); color: var(--hall-text-muted, #68716b); font-size: 13px; }
.profile-refresh button:disabled { opacity: 0.6; cursor: default; }
.agent-panel button:focus-visible { outline: 2px solid var(--hall-brand, #923f30); outline-offset: 2px; }
.detail-card > p { padding: 12px; }

@media (max-width: 720px) {
  .agent-panel-body { display: flex; flex-direction: column; overflow: hidden; }
  .agent-list, .detail-card { flex: 1; min-height: 0; max-height: none; }
  .panel-toolbar { align-items: stretch; flex-wrap: wrap; padding: 10px 12px; }
  .status-filter { flex: 1 0 100%; }
  .agent-detail-scroll { padding: 16px; }
}
.external-policy { margin: 0; padding: 8px 0; min-width: 0; }
.external-policy-row, .external-policy-recovery { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.external-policy button { font: inherit; min-height: 44px; padding: 8px 12px; border: 1px solid var(--hall-border-strong, #ccd2c5); border-radius: 7px; background: var(--hall-surface, #fffefa); color: var(--hall-text, #242e2b); }
.external-policy button[aria-checked="true"] { background: var(--hall-brand, #923f30); color: white; }
.external-policy button:disabled { opacity: .6; cursor: default; }
.external-policy button:focus-visible { outline: 2px solid var(--hall-focus-ring, #923f3052); outline-offset: 2px; }
</style>

<style scoped>
/* Match the accepted prototype after its complete workbench cascade, not browser defaults. */
.agent-panel .profile-section .ability-edit-link { min-height: 44px; padding: 6px 12px; border: 1px solid #e3e5dc; border-radius: 7px; background: #f3f4ee; color: #242e2b; font: inherit; font-size: 13px; line-height: 1.65; cursor: pointer; }
.agent-panel .profile-section .ability-editor { display: grid; gap: 8px; margin-top: 12px; }
.agent-panel .ability-editor label { color: #242e2b; font-size: 13px; font-weight: 600; }
.agent-panel .ability-editor p { margin: 0; color: #68716b; font-size: 12px; line-height: 1.6; }
.agent-panel .ability-editor textarea { width: 100%; min-height: 104px; box-sizing: border-box; resize: vertical; padding: 10px 12px; border: 1px solid #cbd1c8; border-radius: 8px; background: #fffefa; color: #242e2b; font: inherit; font-size: 14px; line-height: 1.6; }
.agent-panel .ability-editor textarea:focus-visible, .agent-panel .profile-section .ability-edit-link:focus-visible { outline: 3px solid #923f3080; outline-offset: 2px; }
.agent-panel .ability-editor-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.agent-panel .profile-section .ability-editor-actions button { min-height: 44px; padding: 8px 16px; border: 1px solid #e3e5dc; border-radius: 7px; background: #f3f4ee; color: #242e2b; font: inherit; font-size: 14px; line-height: 1.65; cursor: pointer; }
.agent-panel .ability-editor-actions button.ability-save { background: #923f30; border-color: #923f30; color: #fffefa; }
.agent-panel .ability-editor-actions button.ability-save:hover:not(:disabled) { background: #793326; border-color: #793326; color: #fffefa; }
.agent-panel .ability-editor-actions button:focus-visible { outline: 3px solid #923f3080; outline-offset: 2px; }
.agent-panel .ability-editor-actions button.ability-save:focus-visible { outline: 2px solid #923f30; outline-offset: 3px; }
.agent-panel .ability-editor-actions button:disabled, .agent-panel .ability-editor textarea:disabled { opacity: .6; cursor: default; }
.agent-panel .ability-editor p.ability-editor-error { color: var(--hall-danger, #a13f35); }
</style>

<style scoped>
.profile-heading { align-items: center; flex-wrap: nowrap; }
.profile-heading h3 { flex-shrink: 0; }
.profile-heading small { flex: 1; min-width: 0; }
.profile-heading :is(.skill-manage-entry, .ability-edit-link) { margin-left: auto; }
.external-policy-row { flex-wrap: nowrap; }
.external-policy-row > span:first-child { flex: 1; min-width: 0; }
.external-policy-row > .hall-switch-control { margin-left: auto; }
.external-policy-row .hall-switch-status { white-space: nowrap; }
</style>
