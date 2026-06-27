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
        <div class="room-prop-layer" aria-hidden="true">
          <span
            v-for="prop in hallRoomPropVisuals"
            :key="prop.key"
            class="room-prop"
            :class="prop.className"
            :style="roomPropStyle(prop)"
          ></span>
        </div>
        <button class="hall-room room-main" @click="openPublicDiscussion">
          <strong>聚义厅</strong>
          <small>厅前公议 / 众好汉</small>
        </button>
        <button class="hall-room room-agents" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'agents')">
          <strong>好汉簿</strong>
          <small>点将调遣</small>
        </button>
        <button class="hall-room room-catalog" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'catalog')">
          <strong>招贤馆</strong>
          <small>遍请豪杰</small>
        </button>
        <button class="hall-room room-tasks" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'tasks')">
          <strong>榜文房</strong>
          <small>{{ tasksTotal }} 件</small>
        </button>
        <button class="hall-room room-library" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'library')">
          <strong>藏书阁</strong>
          <small>查卷问典</small>
        </button>
        <div class="hall-room room-back">
          <strong>后堂</strong>
          <small>整装</small>
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
          厅中暂未见好汉入座，稍后自会传到
        </div>
        <button v-if="hiddenAgentCount" class="hall-overflow" type="button" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'agents')">
          另有 {{ hiddenAgentCount }} 位在偏厅候令
        </button>
        <button class="scene-hotspot hotspot-agents" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'agents')">
          <var-icon name="account-circle" />
          <span>好汉簿</span>
        </button>
        <button class="scene-hotspot hotspot-catalog" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'catalog')">
          <var-icon name="account-plus" />
          <span>招贤</span>
        </button>
        <button class="scene-hotspot hotspot-tasks" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'tasks')">
          <var-icon name="format-list-checkbox" />
          <span>榜文</span>
        </button>
        <button class="scene-hotspot hotspot-library" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'library')">
          <var-icon name="notebook" />
          <span>藏书阁</span>
        </button>
      </div>
    </div>

    <slot></slot>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import AgentToken from '@/components/juyiting/AgentToken.vue'
import hallBackground from '@/assets/juyiting/liangshan-hall-bg-v2.png'
import roomPropsAtlas from '@/assets/juyiting/liangshan-room-props-v2.png'
import { hallRoomPropVisuals } from '@/constants/juyiting'

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
  '--map-offset-y': `${viewportOffset.value.y}px`,
  '--hall-bg-image': `url("${hallBackground}")`,
  '--room-props-image': `url("${roomPropsAtlas}")`
}))

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const roomPropStyle = (prop) => {
  const { columns, rows, column, row } = prop.atlas
  const x = columns === 1 ? 0 : (column / (columns - 1)) * 100
  const y = rows === 1 ? 0 : (row / (rows - 1)) * 100
  return {
    left: `${prop.style.left}%`,
    top: `${prop.style.top}%`,
    width: `${prop.style.width}%`,
    height: `${prop.style.height}%`,
    backgroundPosition: `${x}% ${y}%`,
    backgroundSize: `${columns * 100}% ${rows * 100}%`
  }
}

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
    radial-gradient(circle at 50% 48%, rgba(239, 197, 118, 0.2), transparent 34%),
    linear-gradient(135deg, #14100c, #23170f 54%, #0d0b09);
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
    radial-gradient(ellipse at 50% 53%, rgba(255, 231, 177, 0.13), transparent 34%),
    linear-gradient(180deg, rgba(27, 20, 16, 0.08), rgba(27, 20, 16, 0.22)),
    var(--hall-bg-image) center / cover no-repeat;
  will-change: transform;
}

.map-world::before,
.map-world::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.map-world::before {
  inset: 0;
  border: 1px solid rgba(255, 236, 190, 0.12);
  border-radius: 0;
  background:
    radial-gradient(ellipse at 50% 54%, transparent 34%, rgba(8, 6, 4, 0.18) 74%, rgba(8, 6, 4, 0.42)),
    linear-gradient(180deg, rgba(255, 236, 190, 0.05), transparent 22%, transparent 72%, rgba(0, 0, 0, 0.2));
}

.map-world::after {
  left: 32%;
  right: 32%;
  top: 49%;
  height: 26%;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(244, 200, 76, 0.08), transparent 72%);
}

.map-region,
.map-road {
  position: absolute;
  pointer-events: none;
}

.map-region {
  z-index: 0;
  display: none;
  opacity: 0;
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
  display: none;
  height: 16px;
  border-radius: 999px;
  background: rgba(239, 195, 115, 0.56);
  box-shadow: 0 0 0 5px rgba(83, 55, 29, 0.1);
}

.room-prop-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}

.room-prop {
  position: absolute;
  display: block;
  transform: translate(-50%, -50%);
  background-image: var(--room-props-image);
  background-repeat: no-repeat;
  filter:
    drop-shadow(0 12px 18px rgba(0, 0, 0, 0.28))
    saturate(0.9)
    contrast(1.02);
  opacity: 0.82;
}

.prop-main-seat {
  opacity: 0.42;
}

.prop-roster-rack,
.prop-bounty-board,
.prop-library-shelf {
  opacity: 0.46;
}

.prop-recruit-drum,
.prop-rear-armory {
  opacity: 0.52;
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
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  min-height: 0;
  padding: 8px;
  border: 1px solid rgba(249, 218, 144, 0.34);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 248, 218, 0.2), rgba(96, 57, 28, 0.18)),
    rgba(29, 20, 14, 0.52);
  color: #fff3c9;
  text-align: center;
  box-shadow:
    inset 0 0 0 1px rgba(255, 250, 232, 0.12),
    0 10px 22px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(2px);
}

button.hall-room {
  cursor: pointer;
}

.hall-room:hover {
  border-color: rgba(244, 200, 76, 0.88);
  background:
    linear-gradient(180deg, rgba(255, 248, 218, 0.28), rgba(96, 57, 28, 0.24)),
    rgba(45, 28, 17, 0.62);
  box-shadow:
    inset 0 0 0 1px rgba(255, 250, 232, 0.18),
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
  color: rgba(255, 231, 179, 0.78);
  font-size: 12px;
}

.room-main {
  left: 43%;
  top: 35%;
  width: 14%;
  height: 9%;
  background:
    linear-gradient(180deg, rgba(175, 49, 34, 0.32), rgba(64, 35, 18, 0.34)),
    rgba(39, 26, 17, 0.58);
}

.room-agents {
  left: 20%;
  top: 43%;
  width: 13%;
  height: 9%;
}

.room-catalog {
  left: 22%;
  top: 74%;
  width: 12%;
  height: 8%;
  background:
    linear-gradient(180deg, rgba(196, 49, 35, 0.28), rgba(64, 35, 18, 0.2)),
    rgba(39, 26, 17, 0.54);
}

.room-tasks {
  right: 17%;
  top: 42%;
  width: 13%;
  height: 9%;
}

.room-library {
  left: 69%;
  top: 73%;
  width: 12%;
  height: 8%;
  background:
    linear-gradient(180deg, rgba(69, 111, 96, 0.28), rgba(64, 35, 18, 0.2)),
    rgba(39, 26, 17, 0.54);
}

.room-back {
  left: 43%;
  bottom: 15%;
  width: 14%;
  height: 8%;
  background:
    linear-gradient(180deg, rgba(112, 76, 47, 0.3), rgba(35, 24, 16, 0.2)),
    rgba(39, 26, 17, 0.54);
}

.beam {
  position: absolute;
  left: 0;
  right: 0;
  height: 18px;
  z-index: 3;
  background: linear-gradient(180deg, rgba(32, 19, 12, 0.72), rgba(67, 39, 22, 0.55));
}

.beam-top {
  top: 0;
}

.banner {
  position: absolute;
  top: 8.5%;
  left: 50%;
  width: 116px;
  padding: 10px 0;
  transform: translateX(-50%);
  border-radius: 0 0 8px 8px;
  z-index: 3;
  background: rgba(148, 42, 28, 0.86);
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
