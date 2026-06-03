<template>
  <div class="bottom-dock">
    <button
      v-for="item in items"
      :key="item.key"
      :class="{ active: activePanel === item.key }"
      @click="$emit('open-panel', item.key)"
    >
      <var-icon :name="item.icon" />
      <span>{{ item.label }}</span>
    </button>
  </div>
</template>

<script setup>
defineProps({
  activePanel: { type: String, default: '' }
})

defineEmits(['open-panel'])

const items = [
  { key: 'agents', icon: 'account-circle', label: '名册' },
  { key: 'tasks', icon: 'format-list-checkbox', label: '悬赏' },
  { key: 'chat', icon: 'message-text-outline', label: '传令' }
]
</script>

<style scoped>
.bottom-dock {
  position: absolute;
  left: 50%;
  bottom: 18px;
  z-index: 7;
  display: flex;
  gap: 8px;
  transform: translateX(-50%);
  padding: 7px;
  border: 1px solid rgba(255, 244, 212, 0.18);
  border-radius: 8px;
  background: rgba(35, 24, 16, 0.66);
  backdrop-filter: blur(8px);
}

.bottom-dock button {
  display: grid;
  place-items: center;
  min-width: 58px;
  min-height: 48px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #fff4d4;
  cursor: pointer;
  font: inherit;
}

.bottom-dock button.active {
  background: rgba(244, 200, 76, 0.24);
  color: #fff8e8;
}

@media (max-width: 620px) {
  .bottom-dock {
    display: none;
  }
}
</style>
