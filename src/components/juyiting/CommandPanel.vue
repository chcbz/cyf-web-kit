<template>
  <div class="command-panel">
    <section class="chief-card">
      <span class="chief-avatar" :style="portraitStyle(chiefAgent)"></span>
      <div>
        <small>寨主坐镇</small>
        <strong>{{ chiefName }}</strong>
        <p>总看榜文、好汉簿与厅前话头。</p>
      </div>
    </section>

    <div class="command-stats">
      <button type="button" @click="$emit('open-panel', 'tasks')">
        <small>榜文在榜</small>
        <strong>{{ tasksTotal }}</strong>
      </button>
      <button type="button" @click="$emit('open-panel', 'agents')">
        <small>好汉入簿</small>
        <strong>{{ agentsTotal }}</strong>
      </button>
      <button type="button" @click="$emit('open-panel', 'chat')">
        <small>厅前话头</small>
        <strong>可传</strong>
      </button>
    </div>

    <div class="section-label">将令</div>
    <div class="command-grid">
      <button
        v-for="item in commands"
        :key="item.key"
        type="button"
        @click="$emit('issue-command', item.key)"
      >
        <var-icon :name="item.icon" />
        <span>
          <strong>{{ item.label }}</strong>
          <small>{{ item.description }}</small>
        </span>
      </button>
    </div>

    <div class="section-label">眼下所指</div>
    <div class="context-list">
      <button type="button" @click="$emit('open-panel', selectedAgent ? 'chat' : 'agents')">
        <small>所点好汉</small>
        <strong>{{ selectedAgent ? agentDisplayName(selectedAgent) : '未点好汉' }}</strong>
      </button>
      <button type="button" @click="$emit('open-panel', selectedTask ? 'chat' : 'tasks')">
        <small>所看榜文</small>
        <strong>{{ selectedTask?.title || '未选榜文' }}</strong>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  agentsTotal: { type: Number, default: 0 },
  chiefAgent: { type: Object, default: null },
  portraitStyle: { type: Function, required: true },
  selectedAgent: { type: Object, default: null },
  selectedTask: { type: Object, default: null },
  tasksTotal: { type: Number, default: 0 }
})

defineEmits(['issue-command', 'open-panel'])

const commands = [
  { key: 'reviewBounties', icon: 'format-list-checkbox', label: '巡看榜文', description: '梳理榜文、险处与领令人手' },
  { key: 'reviewRoster', icon: 'account-circle', label: '整点好汉簿', description: '查候令、办事、失联与本领缺口' },
  { key: 'broadcastOrder', icon: 'message-text-outline', label: '厅前发话', description: '向众好汉起一个话头' },
  { key: 'summonReport', icon: 'account-circle-outline', label: '收拢回报', description: '催当前好汉就榜文回话' }
]

const chiefName = computed(() => agentDisplayName(props.chiefAgent) || '宋江')

const agentDisplayName = (agent) => agent?.name || agent?.personaName || agent?.agentId || ''
</script>

<style scoped>
.command-panel {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  overflow: auto;
}

button {
  border: 0;
  cursor: pointer;
  font: inherit;
}

.chief-card,
.context-list button,
.command-grid button,
.command-stats button {
  border-radius: 8px;
  background: #fff8e8;
  color: #3f2815;
}

.chief-card {
  display: flex;
  gap: 12px;
  padding: 14px;
  border: 1px solid #ddc79f;
}

.chief-avatar {
  flex: 0 0 auto;
  width: 56px;
  height: 56px;
  border: 2px solid #8c2f20;
  border-radius: 8px;
  background-position: center;
  background-size: cover;
}

.chief-card small,
.context-list small,
.command-grid small,
.command-stats small {
  display: block;
  color: #8a6f4b;
  font-size: 12px;
}

.chief-card strong {
  display: block;
  font-size: 20px;
}

.chief-card p {
  margin: 4px 0 0;
  color: #765f40;
}

.command-stats,
.context-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.command-stats button,
.context-list button {
  min-width: 0;
  padding: 12px;
  text-align: left;
}

.command-stats strong {
  display: block;
  margin-top: 4px;
  color: #7c1f1b;
  font-size: 22px;
}

.section-label {
  color: #765f40;
  font-size: 13px;
  font-weight: 700;
}

.command-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.command-grid button {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-height: 74px;
  padding: 12px;
  text-align: left;
}

.command-grid .var-icon {
  flex: 0 0 auto;
  color: #8c2f20;
  font-size: 22px;
}

.command-grid strong,
.context-list strong {
  display: block;
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 680px) {
  .command-stats,
  .command-grid,
  .context-list {
    grid-template-columns: 1fr;
  }
}
</style>
