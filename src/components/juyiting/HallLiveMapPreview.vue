<template>
  <section class="hall-live-map-preview" aria-labelledby="hall-live-map-preview-title">
    <header class="preview-heading">
      <div>
        <h2 id="hall-live-map-preview-title">厅中实景</h2>
        <p>只读预览 · 横屏可探索</p>
      </div>
      <button
        class="preview-landscape-entry"
        type="button"
        :disabled="orientationRequestPending"
        @click="emit('request-landscape')"
      >
        {{ orientationRequestPending ? '正在请求横屏…' : '横屏看全景' }}
      </button>
    </header>

    <p v-if="orientationHint" class="orientation-hint" role="status">{{ orientationHint }}</p>

    <div class="preview-frame" :style="{ aspectRatio }">
      <div ref="mapSlot" class="preview-map-slot" aria-label="聚义厅地图只读预览" inert>
        <slot />
      </div>
      <div class="preview-status-layer" aria-live="polite" aria-atomic="true">
        <p v-if="state === 'loading'">地图预览加载中…</p>
        <template v-else-if="state === 'error'">
          <p>{{ errorMessage || '地图预览暂不可用。' }}</p>
          <button type="button" @click="emit('retry')">重试地图预览</button>
        </template>
        <template v-else-if="state === 'paused'">
          <p>预览已暂停</p>
          <button type="button" @click="emit('retry')">恢复预览</button>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  errorMessage: { type: String, default: '' },
  mapHeight: { type: Number, default: 0 },
  mapWidth: { type: Number, default: 0 },
  orientationHint: { type: String, default: '' },
  orientationRequestPending: Boolean,
  state: { type: String, default: 'loading' }
})

const emit = defineEmits(['request-landscape', 'retry', 'visibility-change'])
const mapSlot = ref(null)
const fallbackAspectRatio = 1664 / 928
const isPositiveFinite = value => Number.isFinite(value) && value > 0
const aspectRatio = computed(() => (
  isPositiveFinite(props.mapWidth) && isPositiveFinite(props.mapHeight)
    ? String(props.mapWidth / props.mapHeight)
    : String(fallbackAspectRatio)
))

let observer = null
let lastVisibility = null
const notifyVisibility = visible => {
  if (lastVisibility === visible) return
  lastVisibility = visible
  emit('visibility-change', visible)
}

onMounted(() => {
  // A first visible signal makes the fallback deterministic and is de-duplicated
  // when IntersectionObserver later reports the same state.
  notifyVisibility(true)
  if (typeof IntersectionObserver === 'undefined' || !mapSlot.value) return

  observer = new IntersectionObserver(entries => {
    const entry = entries.find(candidate => candidate.target === mapSlot.value)
    if (entry) notifyVisibility(entry.isIntersecting)
  })
  observer.observe(mapSlot.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<style scoped>
.hall-live-map-preview {
  display: grid;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
}

.preview-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.preview-heading h2,
.preview-heading p,
.preview-status-layer p,
.orientation-hint { margin: 0; }
.preview-heading h2 { color: #fff5df; font-size: 18px; }
.preview-heading p,
.orientation-hint { color: rgba(255, 237, 199, 0.72); font-size: 12px; }

.preview-landscape-entry,
.preview-status-layer button {
  min-height: 40px;
  border: 1px solid rgba(247, 204, 112, 0.58);
  border-radius: 9px;
  background: #a84928;
  color: #fff4dc;
  font-weight: 700;
}

.preview-landscape-entry { flex: 0 0 auto; padding: 0 12px; }
.preview-landscape-entry:disabled { cursor: wait; opacity: 0.62; }

.preview-frame {
  position: relative;
  width: 100%;
  overflow: hidden;
  border: 1px solid rgba(247, 204, 112, 0.42);
  border-radius: 14px;
  background: #161715;
}

.preview-map-slot {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  pointer-events: none;
}

/* The inert slot is display-only: it cannot take focus or consume map input. */
.preview-map-slot :deep(*) { pointer-events: none; }

.preview-status-layer {
  position: absolute;
  z-index: 1;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 16px;
  color: #fff4dc;
  text-align: center;
  pointer-events: none;
}

.preview-status-layer button { padding: 0 14px; pointer-events: auto; }
</style>
