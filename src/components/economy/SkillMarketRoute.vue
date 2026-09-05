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
        :actor-scope-key="capability.principalScopeFingerprint"
        :target-agent="selectedAgent"
      />
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import SkillMarket from './SkillMarket.vue'
import { agentApi } from '@/composables/useHttp'
import { isCanonicalDecimalString } from '@/utils/silverAmount'
import { isSkillMarketplaceCapability, loadEconomyPreviewCapability } from '@/utils/economyPreviewCapability'

const loading = ref(true)
const error = ref('')
const capability = ref(null)
const ownedAgents = ref([])
const selectedAgentId = ref('')
const marketEnabled = computed(() => isSkillMarketplaceCapability(capability.value))
const selectedAgent = computed(() => ownedAgents.value.find(agent => agent.agentId === selectedAgentId.value) || null)

const unwrap = result => {
  const body = result?.data ?? result
  if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'code')) {
    if (body.code !== 'E0' && body.code !== '0' && body.code !== 0 && body.code !== '200' && body.code !== 200) return null
    return body.data
  }
  return body?.data ?? body
}
const rosterItems = payload => Array.isArray(payload) ? payload :
  (Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload?.list) ? payload.list : []))
const ownedRosterAgent = agent => typeof agent?.agentId === 'string' && Boolean(agent.agentId.trim()) &&
  isCanonicalDecimalString(agent?.version)

onMounted(async () => {
  try {
    capability.value = await loadEconomyPreviewCapability()
    if (!marketEnabled.value) return
    ownedAgents.value = rosterItems(unwrap(await agentApi.get('/roster', undefined, { autoLoading: false })))
      .filter(ownedRosterAgent)
  } catch (cause) {
    capability.value = null
    error.value = cause?.message || '技能集市预览能力暂不可用。'
  } finally {
    loading.value = false
  }
})
</script>
