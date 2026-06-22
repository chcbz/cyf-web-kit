<template>
  <div class="persona-catalog-panel">
    <div class="catalog-summary">
      <span>{{ personas.length }} 位好汉</span>
      <span>{{ boundToMeCount }} 位已入名册</span>
    </div>

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
            <span v-if="!(persona.abilities || []).length">未登记能力</span>
          </div>
        </div>
        <button
          v-if="persona.canBind"
          class="catalog-action primary"
          type="button"
          @click="$emit('bind-persona', persona)"
        >
          绑定
        </button>
        <button
          v-else-if="persona.boundToMe && !persona.systemAgent"
          class="catalog-action"
          type="button"
          @click="$emit('unbind-persona', persona)"
        >
          解绑
        </button>
        <span v-else class="catalog-state">{{ stateText(persona) }}</span>
      </article>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  personas: { type: Array, default: () => [] },
  portraitName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true }
})

defineEmits(['bind-persona', 'unbind-persona'])

const boundToMeCount = computed(() => props.personas.filter(persona => persona.boundToMe).length)

const stateText = (persona) => {
  if (persona.systemAgent) return '中控'
  if (persona.boundToMe) return '已入名册'
  if (persona.bound) return '已被绑定'
  return '不可绑定'
}
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
.catalog-state {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 58px;
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
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

.catalog-state {
  color: #765f40;
}

@media (max-width: 620px) {
  .catalog-grid {
    grid-template-columns: 1fr;
  }

  .persona-card {
    grid-template-columns: 44px minmax(0, 1fr);
  }

  .catalog-action,
  .catalog-state {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
