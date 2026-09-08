<template>
  <section class="hall-live-map-preview" aria-label="聚义厅地图只读预览">
    <div class="preview-frame" :style="{ aspectRatio }">
      <div ref="mapSlot" class="preview-map-slot" aria-label="聚义厅地图只读预览" inert>
        <slot />
      </div>

      <div class="preview-orientation-controls">
        <button
          class="preview-landscape-entry"
          type="button"
          :disabled="orientationRequestPending"
          @click="emit('request-landscape')"
        >
          {{ orientationRequestPending ? '正在请求横屏…' : '横屏看全景' }}
        </button>
        <p v-if="orientationHint" class="orientation-hint" role="status">{{ orientationHint }}</p>
      </div>

      <div class="preview-map-controls">
        <slot name="controls" />
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
const aspectRatio = computed(() => {
  if (!isPositiveFinite(props.mapWidth) || !isPositiveFinite(props.mapHeight)) return String(fallbackAspectRatio)
  const ratio = props.mapWidth / props.mapHeight
  return isPositiveFinite(ratio) ? String(ratio) : String(fallbackAspectRatio)
})

let disposed = false
let observer = null
let lastVisibility = null
const notifyVisibility = visible => {
  if (lastVisibility === visible) return
  lastVisibility = visible
  emit('visibility-change', visible)
}

onMounted(() => {
  disposed = false
  if (typeof IntersectionObserver === 'undefined') {
    // Visibility APIs are unavailable: retain the documented visible fallback.
    notifyVisibility(true)
    return
  }
  if (!mapSlot.value) return

  observer = new IntersectionObserver(entries => {
    if (disposed) return
    const entry = entries.find(candidate => candidate.target === mapSlot.value)
    if (entry) notifyVisibility(entry.isIntersecting)
  })
  observer.observe(mapSlot.value)
})

onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  observer = null
})
</script>

<style scoped>
.hall-live-map-preview {
  width: 100%;
  box-sizing: border-box;
}

.preview-frame {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 14px;
  background: #161715;
}

.preview-map-slot {
  position: absolute;
  z-index: 0;
  isolation: isolate;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  pointer-events: none;
}

/* The inert slot is display-only: it cannot take focus or consume map input. */
.preview-map-slot :deep(*) { pointer-events: none; }

.preview-orientation-controls {
  position: absolute;
  z-index: 4;
  top: 12px;
  right: 12px;
  display: grid;
  justify-items: end;
  gap: 5px;
  max-width: min(56%, 220px);
}

.preview-landscape-entry,
.preview-status-layer button {
  min-height: 40px;
  border: 1px solid rgba(247, 204, 112, 0.58);
  border-radius: 9px;
  background: #a84928;
  color: #fff4dc;
  font-weight: 700;
}

.preview-landscape-entry { padding: 0 12px; }
.preview-landscape-entry:disabled { cursor: wait; opacity: 0.62; }

.orientation-hint {
  margin: 0;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(27, 20, 15, 0.78);
  color: rgba(255, 237, 199, 0.88);
  font-size: 12px;
  text-align: right;
}

.preview-map-controls {
  position: absolute;
  z-index: 3;
  right: 0;
  bottom: 0;
  left: 0;
  overflow-x: auto;
  pointer-events: none;
  scrollbar-width: thin;
}

.preview-map-controls :slotted(*) { pointer-events: auto; }

.preview-status-layer {
  position: absolute;
  z-index: 2;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 72px 16px 62px;
  color: #fff4dc;
  text-align: center;
  pointer-events: none;
}

.preview-status-layer p { margin: 0; }
.preview-status-layer button { padding: 0 14px; pointer-events: auto; }

@media (max-width: 360px) {
  .preview-orientation-controls {
    left: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: none;
  }

  .orientation-hint {
    min-width: 0;
    max-width: calc(100% - 100px);
    max-height: 40px;
    overflow: auto;
    white-space: nowrap;
  }

  .preview-status-layer {
    top: 60px;
    bottom: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 4px 12px;
    overflow: hidden;
  }

  .preview-status-layer p {
    flex: 1 1 auto;
    min-width: 0;
    max-height: 40px;
    overflow: auto;
    line-height: 1.2;
    text-align: left;
  }

  .preview-status-layer button { flex: 0 0 auto; }
}
</style>
