<template>
  <section class="bounty-acceptance-panel" aria-label="本次成果与验收">
    <p v-if="source.loading.value" role="status">正在读取本事项的成果…</p>
    <p v-if="source.error.value || source.catalog.error.value" role="alert">
      {{ source.error.value || source.catalog.error.value }}
      <button type="button" @click="source.refresh">重新读取</button>
    </p>
    <BountyExecutionOutputs
      v-if="source.scope.value && !source.legacy.value && !source.loading.value"
      acceptance
      :enabled="!source.error.value && !source.catalog.error.value"
      :request="source.catalog.entries.value.at(-1)?.request || null"
      :catalog="source.catalog.entries.value"
      :conversation-id="source.scope.value.conversationId"
      :identity-key="identityKey"
      :task-version="taskVersion"
      @continue-modification="$emit('continue-modification', source.scope.value)"
      @task-completed="$emit('task-completed', $event)"
    />
    <slot v-else-if="source.legacy.value" name="legacy"></slot>
    <button v-else type="button" @click="$emit('continue-modification', null)">返回事项议事</button>
  </section>
</template>
<script setup>
import { createApi } from '../../composables/useHttp.js'
import { useHallBountyAcceptance } from '../../composables/juyiting/useHallBountyAcceptance.js'
import BountyExecutionOutputs from './BountyExecutionOutputs.vue'
const props = defineProps({ taskId: { type: String, required: true }, identityKey: { type: String, required: true },
  taskVersion: { type: [Number, String], default: '' }, conversationId: { type: String, default: '' } })
defineEmits(['continue-modification', 'task-completed'])
const source = useHallBountyAcceptance({ api: createApi('/chat'), taskId: () => props.taskId,
  identityKey: () => props.identityKey, conversationId: () => props.conversationId })
</script>
<style scoped>
.bounty-acceptance-panel { flex: 1; min-height: 0; overflow: auto; padding: 12px; background: #fffaf0; }
</style>
