<template>
  <section class="hall-stage">
    <div class="stage-header">
      <div class="stage-heading">
        <div class="eyebrow">梁山泊传令中枢</div>
        <h1>聚义厅</h1>
      </div>
      <div class="stage-tools">
        <button
          class="tool-action refresh-action"
          :class="{ 'is-refreshing': refreshing }"
          :disabled="refreshing"
          title="点验厅中动静"
          @click="$emit('refresh-hall')"
        >
          <var-icon name="refresh" />
          <span>{{ refreshing ? '点验中' : '点验' }}</span>
        </button>
        <button
          class="tool-action sound-toggle"
          :title="soundEnabled ? '歇下声响' : '开起声响'"
          @click="$emit('toggle-sound')"
        >
          <var-icon :name="soundEnabled ? 'bell' : 'bell-outline'" />
          <span>{{ soundEnabled ? '声响开' : '声响歇' }}</span>
        </button>
      </div>
    </div>

    <div
      class="hall-board"
      :class="{ 'is-melon-ready': melonReady, 'has-scene-error': Boolean(sceneError) }"
      aria-label="聚义厅 melonJS 场景"
    >
      <div ref="melonContainerRef" class="melon-layer" aria-hidden="true"></div>
      <div v-if="sceneError" class="scene-error" role="status">
        <strong>聚义厅场景暂不可用</strong>
        <span>{{ sceneError }}</span>
        <button type="button" @click="retryScene">重试</button>
      </div>
    </div>

    <slot></slot>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { juyitingGame } from '@/game/index.js'

const props = defineProps({
  agentBubbles: { type: Object, default: () => ({}) },
  agentKey: { type: Function, required: true },
  agentStyle: { type: Function, required: true },
  hiddenAgentCount: { type: Number, default: 0 },
  portraitName: { type: Function, required: true },
  portraitShortName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true },
  refreshing: { type: Boolean, default: false },
  roleClass: { type: Function, required: true },
  sceneAgents: { type: Array, default: () => [] },
  sceneHotspots: { type: Array, default: () => [] },
  selectedAgent: { type: Object, default: null },
  soundEnabled: { type: Boolean, default: true },
  statusClass: { type: Function, required: true },
  statusText: { type: Function, required: true },
  tasksTotal: { type: Number, default: 0 },
  visibleAgents: { type: Array, default: () => [] }
})

const emit = defineEmits(['new-conversation', 'open-panel', 'refresh-hall', 'select-agent', 'toggle-sound'])

const melonContainerRef = ref(null)
const melonReady = ref(false)
const sceneError = ref('')

const handleAgentClick = (agentData) => {
  const full = (props.sceneAgents || []).find(a =>
    a.agentId === agentData.agentId || a.personaCode === agentData.personaCode
  ) || agentData
  emit('select-agent', full)
}

const handleHotspotClick = (hotspot) => {
  emit('open-panel', hotspot.panel)
}

const handleSceneReady = () => {
  sceneError.value = ''
  melonReady.value = true
  juyitingGame.syncAgents(props.sceneAgents)
  juyitingGame.syncHotspots?.(props.sceneHotspots)
  juyitingGame.setSelectedAgent(props.selectedAgent?.agentId || null)
}

const mountScene = async () => {
  const container = melonContainerRef.value
  if (!container) return

  try {
    await juyitingGame.mount(container, {
      onAgentClick: handleAgentClick,
      onHotspotClick: handleHotspotClick,
      onReady: handleSceneReady
    })
    juyitingGame.start()
  } catch (err) {
    melonReady.value = false
    sceneError.value = err?.message || '请稍后重试'
    console.warn('[HallStage] melonJS:', err?.message || err)
  }
}

const retryScene = async () => {
  melonReady.value = false
  juyitingGame.destroy()
  await mountScene()
}

onMounted(() => {
  mountScene()
})

onBeforeUnmount(() => {
  juyitingGame.destroy()
})

watch(() => props.sceneAgents, (agents) => {
  if (melonReady.value) juyitingGame.syncAgents(agents || [])
}, { deep: true })

watch(() => props.sceneHotspots, (hotspots) => {
  if (melonReady.value) juyitingGame.syncHotspots?.(hotspots || [])
}, { deep: true })

watch(() => props.selectedAgent, (agent) => {
  if (melonReady.value) juyitingGame.setSelectedAgent(agent?.agentId || null)
})
</script>

<style scoped>
.hall-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  background: #211812;
}

.stage-header {
  position: absolute;
  top: 10px;
  left: 18px;
  right: 18px;
  z-index: 12;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 240, 202, 0.22);
  border-radius: 8px;
  background: rgba(35, 24, 16, 0.72);
  color: #fff4d4;
  backdrop-filter: blur(8px);
}

.stage-heading {
  min-width: 0;
}

.eyebrow {
  font-size: 12px;
  color: #d7b875;
}

h1 {
  margin: 2px 0 0;
  font-size: 28px;
  line-height: 1.1;
  letter-spacing: 0;
}

.stage-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  margin-top: 1px;
}

button {
  border: 0;
  cursor: pointer;
  font: inherit;
}

.tool-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgba(255, 244, 212, 0.16);
  color: #fff4d4;
  white-space: nowrap;
}

.sound-toggle {
  background: rgba(215, 184, 117, 0.24);
  color: #fff8de;
}

.refresh-action {
  background: rgba(255, 244, 212, 0.2);
}

.tool-action:disabled {
  cursor: default;
  opacity: 0.72;
}

.refresh-action.is-refreshing :deep(.var-icon) {
  animation: refreshSpin 0.8s linear infinite;
}

.tool-action :deep(.var-icon) {
  font-size: 18px;
}

.tool-action span {
  font-size: 13px;
  font-weight: 600;
}

.hall-board {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  border-radius: 0;
  background:
    radial-gradient(circle at 50% 48%, rgba(239, 197, 118, 0.2), transparent 34%),
    linear-gradient(135deg, #14100c, #23170f 54%, #0d0b09);
}

.hall-board::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  box-shadow: inset 0 0 90px rgba(0, 0, 0, 0.58);
}

.melon-layer {
  position: absolute;
  inset: 0;
  z-index: 6;
  width: 100%;
  height: 100%;
}

.melon-layer :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.scene-error {
  position: absolute;
  left: 50%;
  top: 52%;
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: min(320px, calc(100% - 32px));
  padding: 18px;
  border: 1px solid rgba(255, 215, 145, 0.32);
  border-radius: 8px;
  background: rgba(31, 22, 16, 0.88);
  color: #fff4d4;
  text-align: center;
  transform: translate(-50%, -50%);
  backdrop-filter: blur(8px);
}

.scene-error strong {
  font-size: 16px;
  line-height: 1.35;
}

.scene-error span {
  font-size: 13px;
  line-height: 1.5;
  color: #d7b875;
}

.scene-error button {
  min-height: 34px;
  padding: 0 16px;
  border-radius: 8px;
  background: #d7b875;
  color: #24170f;
  font-size: 14px;
  font-weight: 700;
}

@keyframes refreshSpin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .stage-header {
    top: 4px;
    left: 8px;
    right: 8px;
    padding: 12px;
    align-items: flex-start;
  }

  h1 {
    font-size: 24px;
  }

  .stage-tools {
    gap: 6px;
  }

  .tool-action {
    min-height: 34px;
    padding: 0 9px;
  }

  .tool-action span {
    display: none;
  }

  .tool-action :deep(.var-icon) {
    font-size: 17px;
  }
}

@media (max-width: 420px) {
  .stage-header {
    top: 2px;
  }

  .stage-tools {
    align-self: flex-end;
  }

  .eyebrow {
    font-size: 11px;
  }

  h1 {
    font-size: 22px;
    min-height: 34px;
  }
}
</style>
