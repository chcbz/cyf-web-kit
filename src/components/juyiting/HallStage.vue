<template>
  <section class="hall-stage">
    <div class="stage-header">
      <div class="stage-heading">
        <div class="eyebrow">梁山泊协作中枢</div>
        <h1>聚义厅</h1>
      </div>
      <div class="stage-tools">
        <button
          class="tool-action refresh-action"
          :class="{ 'is-refreshing': refreshing }"
          :disabled="refreshing"
          title="刷新人物状态"
          @click="$emit('refresh-hall')"
        >
          <var-icon name="refresh" />
          <span>{{ refreshing ? '刷新中' : '刷新' }}</span>
        </button>
        <button
          class="tool-action sound-toggle"
          :title="soundEnabled ? '关闭音效' : '开启音效'"
          @click="$emit('toggle-sound')"
        >
          <var-icon :name="soundEnabled ? 'bell' : 'bell-outline'" />
          <span>{{ soundEnabled ? '音效开' : '音效关' }}</span>
        </button>
      </div>
    </div>

    <div
      ref="hallBoardRef"
      class="hall-board"
      :class="{ 'is-dragging': mapDrag.active }"
      @pointerdown="startMapDrag"
      @pointermove="moveMapDrag"
      @pointerup="endMapDrag"
      @pointerleave="endMapDrag"
      @pointercancel="endMapDrag"
    >
      <div ref="mapWorldRef" class="map-world" :style="mapWorldStyle">
        <div class="map-region region-water"></div>
        <div class="map-region region-forest"></div>
        <div class="map-region region-village"></div>
        <div class="map-road road-main"></div>
        <div class="map-road road-branch"></div>
        <button class="hall-room room-main" @click="openPublicDiscussion">
          <strong>聚义厅</strong>
          <small>议事中庭 / 全员议事</small>
        </button>
        <button class="hall-room room-agents" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'agents')">
          <strong>名册房</strong>
          <small>好汉调度</small>
        </button>
        <button class="hall-room room-catalog" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'catalog')">
          <strong>招贤馆</strong>
          <small>人物卡池</small>
        </button>
        <button class="hall-room room-tasks" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'tasks')">
          <strong>悬赏房</strong>
          <small>{{ tasksTotal }} 件</small>
        </button>
        <button class="hall-room room-library" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'library')">
          <strong>藏经阁</strong>
          <small>资料检索</small>
        </button>
        <div class="hall-room room-back">
          <strong>后堂</strong>
          <small>整备</small>
        </div>
        <div class="beam beam-top"></div>
        <div class="banner">替天行道</div>
        <AgentToken
          v-for="agent in visibleAgents"
          :key="agent.agentId"
          :active="selectedAgent?.agentId === agent.agentId"
          :agent="agent"
          :agent-style="agentStyle"
          :bubble-text="agentBubbles[agentKey(agent)]"
          :portrait-name="portraitName"
          :portrait-short-name="portraitShortName"
          :portrait-style="portraitStyle"
          :role-class="roleClass"
          :status-class="statusClass"
          :status-text="statusText"
          @select-agent="$emit('select-agent', $event)"
        />
        <div v-if="!visibleAgents.length" class="empty-hall">
          暂无 Agent 入厅，稍后会自动同步
        </div>
        <button v-if="hiddenAgentCount" class="hall-overflow" type="button" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'agents')">
          另有 {{ hiddenAgentCount }} 位在偏厅候命
        </button>
        <button class="scene-hotspot hotspot-agents" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'agents')">
          <var-icon name="account-circle" />
          <span>名册</span>
        </button>
        <button class="scene-hotspot hotspot-catalog" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'catalog')">
          <var-icon name="account-plus" />
          <span>招募</span>
        </button>
        <button class="scene-hotspot hotspot-tasks" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'tasks')">
          <var-icon name="format-list-checkbox" />
          <span>悬赏</span>
        </button>
        <button class="scene-hotspot hotspot-library" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'library')">
          <var-icon name="notebook" />
          <span>藏经阁</span>
        </button>
      </div>
    </div>

    <slot></slot>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import AgentToken from '@/components/juyiting/AgentToken.vue'

defineProps({
  agentBubbles: { type: Object, default: () => ({}) },
  agentKey: { type: Function, required: true },
  agentStyle: { type: Function, required: true },
  hiddenAgentCount: { type: Number, default: 0 },
  portraitName: { type: Function, required: true },
  portraitShortName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true },
  refreshing: { type: Boolean, default: false },
  roleClass: { type: Function, required: true },
  selectedAgent: { type: Object, default: null },
  soundEnabled: { type: Boolean, default: true },
  statusClass: { type: Function, required: true },
  statusText: { type: Function, required: true },
  tasksTotal: { type: Number, default: 0 },
  visibleAgents: { type: Array, default: () => [] }
})

const emit = defineEmits(['new-conversation', 'open-panel', 'refresh-hall', 'select-agent', 'toggle-sound'])

const hallBoardRef = ref(null)
const mapWorldRef = ref(null)
const viewportOffset = ref({ x: 0, y: 0 })
const mapDrag = ref({ active: false, dragging: false, pointerId: null, startX: 0, startY: 0, originX: 0, originY: 0 })

const mapPanPadding = 2
const mapDragThreshold = 3

const mapWorldStyle = computed(() => ({
  '--map-offset-x': `${viewportOffset.value.x}px`,
  '--map-offset-y': `${viewportOffset.value.y}px`
}))

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const mapOffsetBounds = () => {
  const board = hallBoardRef.value?.getBoundingClientRect()
  const world = mapWorldRef.value?.getBoundingClientRect()
  if (!board || !world) {
    return { x: 0, y: 0 }
  }
  return {
    x: Math.max(0, (world.width - board.width) / 2 - mapPanPadding),
    y: Math.max(0, (world.height - board.height) / 2 - mapPanPadding)
  }
}

const applyMapOffset = (next) => {
  const bounds = mapOffsetBounds()
  viewportOffset.value = {
    x: clamp(next.x, -bounds.x, bounds.x),
    y: clamp(next.y, -bounds.y, bounds.y)
  }
}

const resetMap = () => {
  viewportOffset.value = { x: 0, y: 0 }
}

const openPublicDiscussion = () => {
  resetMap()
  emit('open-panel', 'chat')
}

const startMapDrag = (event) => {
  if (event.button !== undefined && event.button !== 0) return
  mapDrag.value = {
    active: true,
    dragging: false,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: viewportOffset.value.x,
    originY: viewportOffset.value.y
  }
  event.currentTarget?.setPointerCapture?.(event.pointerId)
}

const moveMapDrag = (event) => {
  if (!mapDrag.value.active || mapDrag.value.pointerId !== event.pointerId) return
  const deltaX = event.clientX - mapDrag.value.startX
  const deltaY = event.clientY - mapDrag.value.startY
  if (!mapDrag.value.dragging && Math.hypot(deltaX, deltaY) < mapDragThreshold) return
  mapDrag.value.dragging = true
  applyMapOffset({
    x: mapDrag.value.originX + deltaX,
    y: mapDrag.value.originY + deltaY
  })
  event.preventDefault()
}

const endMapDrag = (event) => {
  if (!mapDrag.value.active || mapDrag.value.pointerId !== event.pointerId) return
  event.currentTarget?.releasePointerCapture?.(event.pointerId)
  const wasDragging = mapDrag.value.dragging
  mapDrag.value = { active: false, dragging: false, pointerId: null, startX: 0, startY: 0, originX: 0, originY: 0 }
  if (wasDragging) {
    event.preventDefault()
  }
}
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
  z-index: 5;
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

.stage-heading {
  min-width: 0;
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
  cursor: grab;
  touch-action: none;
  background:
    radial-gradient(circle at 50% 48%, rgba(255, 238, 180, 0.16), transparent 32%),
    linear-gradient(135deg, #17231d, #1b271f 50%, #0e1411);
}

.hall-board.is-dragging {
  cursor: grabbing;
}

.hall-board::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  box-shadow: inset 0 0 90px rgba(0, 0, 0, 0.58);
}

.map-world {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 162%;
  height: 148%;
  transform: translate3d(calc(-50% + var(--map-offset-x, 0px)), calc(-50% + var(--map-offset-y, 0px)), 0);
  transform-origin: center;
  transition: transform 0.28s ease;
  background:
    linear-gradient(90deg, rgba(99, 61, 31, 0.24) 1px, transparent 1px) 0 0 / 72px 72px,
    linear-gradient(0deg, rgba(99, 61, 31, 0.22) 1px, transparent 1px) 0 0 / 72px 72px,
    repeating-linear-gradient(90deg, rgba(169, 114, 58, 0.12) 0 18px, rgba(89, 54, 28, 0.12) 18px 36px),
    radial-gradient(ellipse at 52% 54%, rgba(229, 177, 92, 0.34), transparent 28%),
    linear-gradient(145deg, #8a6032 0%, #5b3923 38%, #6f4a2a 68%, #3a291f 100%);
  will-change: transform;
}

.map-world::before,
.map-world::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.map-world::before {
  inset: 8% 10%;
  border: 8px solid rgba(64, 35, 18, 0.62);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(64, 35, 18, 0.46) 2px, transparent 2px) 0 0 / 25% 100%,
    linear-gradient(0deg, rgba(64, 35, 18, 0.44) 2px, transparent 2px) 0 0 / 100% 34%,
    rgba(255, 238, 194, 0.08);
}

.map-world::after {
  left: 15%;
  right: 15%;
  top: 46%;
  height: 18px;
  border-radius: 999px;
  background: rgba(238, 190, 111, 0.48);
  box-shadow:
    0 -116px 0 rgba(238, 190, 111, 0.24),
    0 116px 0 rgba(238, 190, 111, 0.2);
}

.map-region,
.map-road {
  position: absolute;
  pointer-events: none;
}

.map-region {
  z-index: 0;
  opacity: 0.88;
}

.region-water {
  left: 13%;
  bottom: 14%;
  width: 22%;
  height: 22%;
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(255, 239, 188, 0.18) 1px, transparent 1px) 0 0 / 18px 18px,
    linear-gradient(135deg, rgba(87, 51, 27, 0.58), rgba(48, 31, 22, 0.5));
}

.region-forest {
  right: 13%;
  top: 14%;
  width: 24%;
  height: 24%;
  border-radius: 8px;
  background:
    radial-gradient(circle at 28% 36%, rgba(244, 200, 76, 0.24), transparent 16%),
    linear-gradient(135deg, rgba(35, 72, 62, 0.64), rgba(28, 52, 44, 0.56));
}

.region-village {
  left: 13%;
  top: 14%;
  width: 24%;
  height: 24%;
  border-radius: 8px;
  background:
    repeating-linear-gradient(45deg, rgba(255, 239, 188, 0.16) 0 10px, transparent 10px 20px),
    linear-gradient(135deg, rgba(124, 31, 27, 0.46), rgba(92, 45, 99, 0.42));
}

.map-road {
  z-index: 1;
  height: 16px;
  border-radius: 999px;
  background: rgba(239, 195, 115, 0.56);
  box-shadow: 0 0 0 5px rgba(83, 55, 29, 0.1);
}

.road-main {
  left: 20%;
  top: 50%;
  width: 62%;
  transform: rotate(-13deg);
}

.road-branch {
  left: 45%;
  top: 42%;
  width: 32%;
  transform: rotate(42deg);
}

.hall-room {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  min-height: 0;
  padding: 10px;
  border: 2px solid rgba(64, 35, 18, 0.68);
  border-radius: 8px;
  background:
    linear-gradient(90deg, rgba(255, 244, 212, 0.14) 1px, transparent 1px) 0 0 / 20px 20px,
    linear-gradient(145deg, rgba(255, 237, 190, 0.72), rgba(188, 132, 67, 0.64));
  color: #3c2716;
  text-align: center;
  box-shadow:
    inset 0 0 0 1px rgba(255, 250, 232, 0.22),
    0 12px 26px rgba(0, 0, 0, 0.18);
}

button.hall-room {
  cursor: pointer;
}

.hall-room:hover {
  border-color: rgba(244, 200, 76, 0.84);
  box-shadow:
    inset 0 0 0 1px rgba(255, 250, 232, 0.3),
    0 0 0 3px rgba(244, 200, 76, 0.18),
    0 14px 28px rgba(0, 0, 0, 0.2);
}

.hall-room strong,
.hall-room small {
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hall-room strong {
  font-size: 16px;
  font-weight: 800;
}

.hall-room small {
  color: rgba(60, 39, 22, 0.78);
  font-size: 12px;
}

.room-main {
  left: 37%;
  top: 35%;
  width: 26%;
  height: 32%;
  background:
    radial-gradient(circle at 50% 52%, rgba(244, 200, 76, 0.28), transparent 44%),
    linear-gradient(145deg, rgba(255, 239, 188, 0.82), rgba(192, 138, 70, 0.74));
}

.room-agents {
  left: 14%;
  top: 36%;
  width: 19%;
  height: 24%;
}

.room-catalog {
  left: 18%;
  top: 64%;
  width: 16%;
  height: 15%;
  background:
    linear-gradient(145deg, rgba(230, 222, 202, 0.78), rgba(126, 80, 57, 0.55));
}

.room-tasks {
  right: 14%;
  top: 36%;
  width: 19%;
  height: 24%;
}

.room-library {
  left: 64%;
  top: 62%;
  width: 16%;
  height: 15%;
  background:
    linear-gradient(145deg, rgba(226, 235, 224, 0.78), rgba(69, 111, 96, 0.58));
}

.room-back {
  left: 40%;
  bottom: 13%;
  width: 20%;
  height: 16%;
  background:
    linear-gradient(145deg, rgba(235, 218, 184, 0.74), rgba(112, 76, 47, 0.56));
}

.beam {
  position: absolute;
  left: 0;
  right: 0;
  height: 18px;
  background: #4a2716;
}

.beam-top {
  top: 0;
}

.banner {
  position: absolute;
  top: 86px;
  left: 50%;
  width: 116px;
  padding: 10px 0;
  transform: translateX(-50%);
  border-radius: 0 0 8px 8px;
  background: #b93622;
  color: #fff1c1;
  text-align: center;
  font-weight: 700;
}

.empty-hall {
  color: #856d4a;
  text-align: center;
  padding: 18px;
}

.hall-overflow {
  position: absolute;
  right: 18px;
  bottom: 118px;
  z-index: 5;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid rgba(255, 244, 212, 0.2);
  border-radius: 999px;
  background: rgba(35, 24, 16, 0.72);
  color: #fff4d4;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(8px);
}

.scene-hotspot {
  position: absolute;
  z-index: 3;
  display: none;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid rgba(255, 240, 202, 0.3);
  border-radius: 8px;
  background: rgba(255, 250, 240, 0.9);
  color: #4a3423;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
}

.hotspot-agents {
  left: 8%;
  top: 58%;
}

.hotspot-catalog {
  left: 24%;
  bottom: 18%;
}

.hotspot-tasks {
  left: 50%;
  bottom: 25%;
  transform: translateX(-50%);
}

.hotspot-library {
  right: 8%;
  bottom: 25%;
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

  .banner {
    top: 92px;
  }

  .scene-hotspot {
    min-height: 32px;
    padding: 0 8px;
    font-size: 12px;
  }

  .hotspot-agents {
    left: 5%;
    top: 63%;
  }

  .hotspot-library {
    right: 5%;
    bottom: 20%;
  }

  .map-world {
    width: 164%;
    height: 146%;
  }

  .room-main {
    left: 35%;
    top: 36%;
    width: 30%;
    height: 31%;
  }

  .room-agents {
    left: 15%;
    top: 38%;
    width: 18%;
    height: 22%;
  }

  .room-tasks {
    right: 15%;
    top: 38%;
    width: 18%;
    height: 22%;
  }

  .room-library {
    left: 66%;
    top: 62%;
    width: 17%;
    height: 14%;
  }

  .room-back {
    left: 39%;
    bottom: 13%;
    width: 22%;
    height: 15%;
  }

  .hall-room {
    padding: 7px;
  }

  .hall-room strong {
    font-size: 13px;
  }

  .hall-room small {
    font-size: 10px;
  }
}
</style>
