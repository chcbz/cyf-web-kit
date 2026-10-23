<template>
  <section class="skill-market-route" aria-label="技能集市预览">
    <p v-if="loading" role="status">正在核对服务端预览能力…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!marketEnabled" role="status">技能集市预览当前未由服务端启用。</p>
    <template v-else>
      <label>
        选择已拥有的 Agent
        <select v-model="selectedAgentId">
          <option value="">请选择 Agent</option>
          <option v-for="agent in ownedAgents" :key="agent.agentId" :value="agent.agentId">
            {{ agent.name || agent.personaName || agent.agentId }}（v{{ agent.version }}）
          </option>
        </select>
      </label>
      <p v-if="!ownedAgents.length" role="status">服务端未返回可购买技能的已拥有 Agent。</p>
      <SkillMarket
        v-if="selectedAgent"
        :preview-enabled="marketEnabled"
        :actor-scope-key="capability.principalScopeSha256"
        :identity-key="capability.principalScopeSha256 + ':' + apiStore.authorizationGeneration"
        :target-agent="selectedAgent"
        @refresh-roster="refreshRoster"
      />
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import { useApiStore } from '@/stores/api'
import { registerIdentityCleanup } from '@/utils/identityLifecycle.js'
import SkillMarket from './SkillMarket.vue'
import { loadSkillMarketRoster } from '@/utils/skillMarketRoster.js'
import { isCanonicalDecimalString } from '@/utils/silverAmount'
import { isSkillMarketplaceCapability, loadEconomyPreviewCapability } from '@/utils/economyPreviewCapability'

const apiStore = useApiStore()
const loading = ref(true)
const error = ref('')
const capability = ref(null)
const ownedAgents = ref([])
const selectedAgentId = ref('')
const marketEnabled = computed(() => isSkillMarketplaceCapability(capability.value))
const selectedAgent = computed(() => ownedAgents.value.find(agent => agent.agentId === selectedAgentId.value) || null)

const controller = new AbortController()
const generation = apiStore.authorizationGeneration
const current = () => !controller.signal.aborted && generation === apiStore.authorizationGeneration
const clearIdentity = () => { controller.abort(); capability.value = null; ownedAgents.value = []; selectedAgentId.value = ''; loading.value = false }
const unregister = registerIdentityCleanup(clearIdentity)
onScopeDispose(() => { clearIdentity(); unregister() })
const rosterItems = payload => Array.isArray(payload) ? payload :
  (Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload?.list) ? payload.list : []))
const ownedRosterAgent = agent => agent?.boundToMe === true && agent?.canOperate === true &&
  typeof agent?.agentId === 'string' && Boolean(agent.agentId.trim()) && isCanonicalDecimalString(agent?.version)

const refreshRoster = async () => {
  const priorSelection = selectedAgentId.value
  const refreshed = rosterItems(await loadSkillMarketRoster({ signal: controller.signal })).filter(ownedRosterAgent)
  if (!current()) return []
  ownedAgents.value = refreshed
  selectedAgentId.value = refreshed.some(agent => agent.agentId === priorSelection) ? priorSelection : ''
  return refreshed
}

onMounted(async () => {
  try {
    const next = await loadEconomyPreviewCapability({ signal: controller.signal })
    if (!current()) return
    capability.value = next
    if (!marketEnabled.value) return
    await refreshRoster()
  } catch (cause) {
    if (!current()) return
    capability.value = null
    error.value = cause?.message || '技能集市预览能力暂不可用。'
  } finally {
    if (current()) loading.value = false
  }
})
</script>
