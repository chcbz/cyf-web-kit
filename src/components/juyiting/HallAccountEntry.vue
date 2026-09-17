<template>
  <button
    class="hall-account-entry"
    type="button"
    :disabled="disabled"
    aria-label="个人中心"
    title="个人中心"
    @pointerdown.stop
    @pointerup.stop
    @keydown.stop
    @click.stop="emit('open-profile')"
  >
    <span class="hall-account-avatar" aria-hidden="true">
      <img
        v-if="safeAvatar && !avatarFailed"
        :src="safeAvatar"
        alt=""
        @error="avatarFailed = true"
      />
      <span v-else class="hall-account-fallback">我</span>
    </span>
    <span class="hall-account-copy">
      <span class="hall-account-label">个人中心</span>
      <span class="hall-account-name">{{ safeDisplayName }}</span>
    </span>
  </button>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  avatar: { type: String, default: '' },
  disabled: Boolean,
  displayName: { type: String, default: '' }
})

const emit = defineEmits(['open-profile'])
const avatarFailed = ref(false)
const safeAvatar = computed(() => String(props.avatar || '').trim())
const safeDisplayName = computed(() => String(props.displayName || '').trim() || '个人中心')

watch(safeAvatar, () => {
  avatarFailed.value = false
}, { immediate: true })
</script>

<style scoped>
.hall-account-entry {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  min-height: 36px;
  gap: 7px;
  padding: 4px 8px 4px 4px;
  border: 1px solid rgba(255, 240, 202, 0.3);
  border-radius: 9px;
  background: rgba(35, 24, 16, 0.58);
  color: #fff4d4;
  font: inherit;
  text-align: left;
}

.hall-account-entry:focus-visible {
  outline: 2px solid #f5ca72;
  outline-offset: 2px;
}

.hall-account-entry:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.hall-account-avatar {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 28px;
  height: 28px;
  overflow: hidden;
  border: 1px solid rgba(255, 240, 202, 0.42);
  border-radius: 50%;
  background: #6d3f1f;
  color: #fff8e8;
  font-weight: 700;
}

.hall-account-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hall-account-copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.hall-account-label {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.15;
}

.hall-account-name {
  max-width: 12em;
  overflow: hidden;
  color: rgba(255, 244, 212, 0.76);
  font-size: 11px;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .hall-account-copy { display: none; }
  .hall-account-entry { min-width: 36px; padding: 4px; justify-content: center; }
}
</style>
