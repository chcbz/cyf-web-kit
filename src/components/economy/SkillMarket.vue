<template>
  <!-- Existing market consumer now delegates to the same SM-C1 list and write owner. -->
  <SkillManagement
    embedded
    :target-agent="targetAgent"
    :actor-scope-key="actorScopeKey"
    :identity-key="identityKey"
    :enabled="previewEnabled"
    :agent-api="agentApi"
    @changed="$emit('refresh-roster')"
  />
</template>
<script setup>
import SkillManagement from './SkillManagement.vue'
defineEmits(['refresh-roster'])
defineProps({ previewEnabled: Boolean, targetAgent: { type: Object, default: null }, actorScopeKey: { type: String, default: '' }, identityKey: { type: String, default: '' }, agentApi: { type: Object, default: null } })
</script>
