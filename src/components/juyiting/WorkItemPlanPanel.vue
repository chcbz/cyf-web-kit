<template>
  <section class="work-item-plan" aria-label="任务计划">
    <h4>任务计划（人工确认）</h4>
    <p v-if="!available" class="plan-state">此环境尚未启用任务计划；不会自动探测或提交。</p>
    <p v-else-if="!operable" class="plan-state">未取得此榜文的明确协调者身份，不能代猜或操作。</p>
    <template v-else>
      <div class="plan-controls">
        <textarea v-model.trim="objective" placeholder="拆解目标"></textarea>
        <select v-model="dependencyMode"><option value="sequential">按顺序</option><option value="parallel">可并行</option></select>
        <input v-model.number="maxItems" type="number" min="1" :max="MAX_ITEMS" aria-label="最大条目" />
        <button type="button" :disabled="state === 'suggesting' || state === 'confirming' || !objective" @click="suggest">手动获取建议</button>
      </div>
      <p v-if="message" class="plan-state" :class="{ 'is-error': state === 'error' }" role="status">{{ message }}</p>
      <div v-if="items.length" class="plan-editor">
        <article v-for="item in items" :key="item.itemKey">
          <strong>{{ item.itemKey }}</strong>
          <input v-model.trim="item.title" aria-label="工作项标题" placeholder="标题" />
          <textarea v-model.trim="item.description" aria-label="工作项描述" placeholder="描述"></textarea>
          <select v-model="item.workType"><option v-for="type in workTypes" :key="type" :value="type">{{ type }}</option></select>
          <input :value="item.requiredAbilities.join(', ')" aria-label="所需本领" placeholder="所需本领，逗号分隔" @input="item.requiredAbilities = $event.target.value.split(',').map(v => v.trim()).filter(Boolean)" />
          <input v-model.number="item.priority" type="number" aria-label="优先级" />
          <input v-model.number="item.maxAttempts" type="number" min="1" max="10" aria-label="最大尝试次数" />
          <label><input v-model="item.requiredItem" type="checkbox" /> 必需项</label>
          <input :value="item.dependsOn.join(', ')" aria-label="依赖工作项" placeholder="依赖项 key，逗号分隔" @input="item.dependsOn = $event.target.value.split(',').map(v => v.trim()).filter(Boolean)" />
        </article>
        <p class="plan-preview">确认将创建 {{ items.length }} 个未分配工作项；不会自动点将或派发。</p>
        <button type="button" :disabled="state === 'confirming' || stale" @click="confirm">显式确认提交</button>
        <button v-if="stale" type="button" :disabled="state === 'confirming'" @click="suggest">重新获取建议</button>
      </div>
      <ul v-if="confirmedItems.length" class="confirmed-items"><li v-for="item in confirmedItems" :key="item.workItemId || item.itemKey">{{ item.title }}（{{ item.status || 'pending' }}，未分配）</li></ul>
    </template>
  </section>
</template>
<script setup>
import { computed, onBeforeUnmount, toRef } from 'vue'
import { useHallWorkItemPlan } from '@/composables/juyiting/useHallWorkItemPlan'
const props = defineProps({ task: { type: Object, required: true }, enabled: { type: Boolean, default: false },
  authorizationGeneration: { type: Number, default: 0 } })
const actorAgentId = computed(() => props.task?.coordinatorAgentId || '')
const plan = useHallWorkItemPlan({ enabled: toRef(props, 'enabled'), task: toRef(props, 'task'), actorAgentId,
  authorizationGeneration: computed(() => props.authorizationGeneration) })
const { MAX_ITEMS, objective, maxItems, dependencyMode, items, state, message, confirmedItems, stale, available, operable, suggest, confirm } = plan
const workTypes = ['analysis', 'implementation', 'verification', 'review', 'coordination', 'documentation']
onBeforeUnmount(() => plan.dispose())
</script>
<style scoped>
.work-item-plan { margin: 12px 0; padding: 10px; border-radius: 8px; background: #e9f0e7; color: #23483e; font-size: 12px; }
h4 { margin: 0 0 8px; } .plan-controls, .plan-editor { display: grid; gap: 7px; } input, textarea, select { min-width: 0; padding: 7px; border: 1px solid #a9c2aa; border-radius: 6px; background: #fffdf6; color: #2f261c; font: inherit; } textarea { min-height: 48px; resize: vertical; } button { width: fit-content; padding: 7px 10px; border-radius: 6px; background: #23483e; color: #fff8e8; } article { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 8px; border-radius: 6px; background: rgba(255,255,255,.48); } article strong, article textarea { grid-column: 1 / -1; } .plan-state { margin: 6px 0; } .is-error { color: #b3261e; } .plan-preview { margin: 4px 0; } .confirmed-items { margin: 8px 0 0; padding-left: 20px; }
</style>
