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
        <template v-for="zone in hallInteractiveZones" :key="zone.key">
          <button
            v-if="zone.panel"
            class="hall-room"
            :class="[`room-${zone.key}`, `object-${zone.object}`, `shape-${zone.hitShape || 'rect'}`]"
            :style="objectHitboxStyle(zone)"
            :aria-label="objectAriaLabel(zone)"
            @pointerdown.stop
            @pointerup.stop
            @click.stop="openZone(zone)"
          >
            <span class="sr-only">{{ objectAriaLabel(zone) }}</span>
            <span class="hall-room-label" aria-hidden="true">
              <span>{{ zone.title }}</span>
              <span class="hall-room-subtitle">{{ zoneSubtitle(zone) }}</span>
            </span>
          </button>
          <div
            v-else
            class="hall-room is-static"
            :class="[`room-${zone.key}`, `object-${zone.object}`, `shape-${zone.hitShape || 'rect'}`]"
            :style="objectHitboxStyle(zone)"
            :aria-label="objectAriaLabel(zone)"
          >
            <span class="sr-only">{{ objectAriaLabel(zone) }}</span>
          </div>
        </template>
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
        <div class="hall-foreground" aria-hidden="true"></div>
        <div v-if="!visibleAgents.length" class="empty-hall">
          厅中暂未见好汉入座，稍后自会传到
        </div>
        <button v-if="hiddenAgentCount" class="hall-overflow" type="button" @pointerdown.stop @pointerup.stop @click.stop="$emit('open-panel', 'agents')">
          另有 {{ hiddenAgentCount }} 位在偏厅候令
        </button>
      </div>
    </div>

    <slot></slot>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import AgentToken from '@/components/juyiting/AgentToken.vue'
import hallBackground from '@/assets/juyiting/liangshan-hall-physical-bg-v1.png'
import hallForeground from '@/assets/juyiting/liangshan-hall-foreground-v1.png'
import roomPropsAtlas from '@/assets/juyiting/liangshan-room-props-v2.png'
import { hallPhysicalScene, hallRoomPropVisuals } from '@/constants/juyiting'
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
  '--hall-foreground-image': `url("${hallForeground}")`,
  '--room-props-image': `url("${roomPropsAtlas}")`
}))

const hallInteractiveZones = computed(() => hallPhysicalScene.interactiveZones)

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

const objectHitboxStyle = (zone) => ({
  left: `${zone.x}%`,
  top: `${zone.y}%`,
  width: `${zone.w}%`,
  height: `${zone.h}%`,
  '--object-tilt': `${zone.tilt || 0}deg`
})

const zoneSubtitle = (zone) => {
  if (zone.key === 'tasks') return `${props.tasksTotal} 件`
  return zone.subtitle
}

const objectAriaLabel = (zone) => `${zone.title}，${zoneSubtitle(zone)}`

const openZone = (zone) => {
  if (zone.panel === 'chat') {
    openPublicDiscussion()
    return
  }
  emit('open-panel', zone.panel)
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




// === melonJS Canvas �������� ===
const melonContainerRef = ref(null)
const melonReady = ref(false)

onMounted(async () => {
  const el = document.getElementById("melon-container")
  if (!el) {
    // Insert container div after hall-board
    const board = document.querySelector(".hall-board")
    if (board) {
      const div = document.createElement("div")
      div.id = "melon-container"
      div.style.cssText = "position:absolute;inset:0;z-index:6;pointer-events:none"
      board.appendChild(div)
    }
  }
  const container = document.getElementById("melon-container")
  if (!container) return

  try {
    await juyitingGame.mount(container, {
      onAgentClick: (agentData) => {
        const full = (props.sceneAgents || []).find(a =>
          a.agentId === agentData.agentId || a.personaCode === agentData.personaCode
        ) || agentData
        emit("select-agent", full)
      },
      onHotspotClick: (hotspot) => {
        emit("open-panel", hotspot.panel)
      },
      onReady: () => {
        melonReady.value = true
        if (props.sceneAgents && props.sceneAgents.length) {
          juyitingGame.syncAgents(props.sceneAgents)
        }
        if (props.selectedAgent) {
          juyitingGame.setSelectedAgent(props.selectedAgent.agentId || null)
        }
      },
    })
    juyitingGame.start()
  } catch (err) {
    console.warn("[HallStage] melonJS:", err.message || err)
  }
})

onBeforeUnmount(() => { juyitingGame.destroy() })

watch(() => props.sceneAgents, (agents) => {
  if (melonReady.value) juyitingGame.syncAgents(agents || [])
}, { deep: true })

watch(() => props.selectedAgent, (agent) => {
  if (melonReady.value) juyitingGame.setSelectedAgent(agent && agent.agentId || null)
})
// === end melonJS ===



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
    linear-gradient(180deg, rgba(27, 20, 16, 0.04), rgba(27, 20, 16, 0.14)),
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
    radial-gradient(ellipse at 50% 54%, transparent 38%, rgba(8, 6, 4, 0.12) 78%, rgba(8, 6, 4, 0.34)),
    linear-gradient(180deg, rgba(255, 236, 190, 0.03), transparent 24%, transparent 72%, rgba(0, 0, 0, 0.18));
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
  display: none;
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
  z-index: 8;
  display: block;
  min-width: 0;
  min-height: 0;
  padding: 0;
  transform: translate(-50%, -50%) rotate(var(--object-tilt, 0deg));
  border: 0;
  border-radius: 0;
  background: transparent;
  color: transparent;
  backdrop-filter: none;
  touch-action: manipulation;
}

button.hall-room {
  cursor: pointer;
}

.hall-room.is-static {
  pointer-events: none;
}

.hall-room::before,
.hall-room::after {
  content: '';
  position: absolute;
  pointer-events: none;
  opacity: 0.38;
  transition:
    opacity 0.16s ease,
    transform 0.16s ease,
    filter 0.16s ease;
}

.hall-room::before {
  inset: 8%;
  border-radius: 9px;
  background:
    radial-gradient(ellipse at 50% 45%, rgba(255, 232, 159, 0.34), rgba(255, 207, 87, 0.12) 48%, transparent 74%);
  box-shadow:
    inset 0 0 16px rgba(255, 238, 178, 0.24),
    0 0 18px rgba(235, 178, 62, 0.2);
  mix-blend-mode: screen;
  transform: scale(0.96);
}

.hall-room::after {
  left: 50%;
  bottom: 8%;
  width: 56%;
  height: 8%;
  transform: translateX(-50%) scaleX(0.82);
  border-radius: 50%;
  background: rgba(255, 221, 130, 0.26);
  filter: blur(8px);
}

.hall-room-label {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 2px);
  z-index: 2;
  display: grid;
  min-width: 52px;
  max-width: 94px;
  padding: 3px 6px 4px;
  transform: translateX(-50%) rotate(calc(var(--object-tilt, 0deg) * -1));
  border: 1px solid rgba(91, 52, 24, 0.4);
  border-radius: 4px;
  background:
    linear-gradient(180deg, rgba(255, 250, 226, 0.94), rgba(230, 199, 139, 0.88));
  color: #432813;
  box-shadow:
    inset 0 0 0 1px rgba(255, 244, 210, 0.36),
    0 5px 10px rgba(48, 28, 14, 0.2);
  font-family: serif;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: 0;
  opacity: 0.86;
  pointer-events: none;
  text-align: center;
  text-shadow: 0 1px 0 rgba(255, 244, 210, 0.72);
  transition:
    opacity 0.16s ease,
    transform 0.16s ease,
    filter 0.16s ease;
}

.hall-room-label::before,
.hall-room-label::after {
  content: '';
  position: absolute;
  left: 7px;
  right: 7px;
  height: 1px;
  background: rgba(91, 52, 24, 0.42);
}

.hall-room-label::before {
  top: 2px;
}

.hall-room-label::after {
  bottom: 2px;
}

.hall-room-subtitle {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  color: rgba(67, 40, 19, 0.76);
  font-size: 9px;
  font-weight: 700;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button.hall-room:hover::before,
button.hall-room:focus-visible::before,
button.hall-room:active::before {
  opacity: 0.95;
  transform: scale(1);
}

button.hall-room:hover::after,
button.hall-room:focus-visible::after,
button.hall-room:active::after {
  opacity: 0.9;
  transform: translateX(-50%) scaleX(1);
}

button.hall-room:hover .hall-room-label,
button.hall-room:focus-visible .hall-room-label,
button.hall-room:active .hall-room-label {
  opacity: 1;
  filter: saturate(1.08);
  transform: translateX(-50%) translateY(-2px) rotate(calc(var(--object-tilt, 0deg) * -1));
}

button.hall-room:focus-visible {
  outline: 2px solid rgba(255, 232, 159, 0.84);
  outline-offset: 3px;
}

.shape-ellipse {
  border-radius: 50%;
  clip-path: ellipse(50% 50% at 50% 50%);
}

.shape-plaque {
  clip-path: polygon(6% 12%, 94% 12%, 100% 50%, 94% 88%, 6% 88%, 0 50%);
}

.object-plaque::before {
  inset: 5% 2%;
  border-radius: 6px;
  background:
    linear-gradient(90deg, transparent, rgba(255, 232, 159, 0.36) 50%, transparent),
    radial-gradient(ellipse at 50% 50%, rgba(255, 214, 113, 0.2), transparent 68%);
}

.object-ledger::before,
.object-notice-rack::before,
.object-scroll-shelf::before {
  inset: 4% 7%;
  border-radius: 7px;
}

.object-drum::before {
  inset: 2%;
  border-radius: 50%;
  background:
    radial-gradient(circle at 45% 42%, rgba(255, 232, 159, 0.38), rgba(182, 58, 36, 0.12) 52%, transparent 74%);
}

.object-rear-gear::before {
  inset: 6% 10%;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
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
  z-index: 4;
  background: rgba(148, 42, 28, 0.86);
  color: #fff1c1;
  text-align: center;
  font-weight: 700;
}

.hall-foreground {
  position: absolute;
  inset: 0;
  z-index: 7;
  background: var(--hall-foreground-image) center / cover no-repeat;
  pointer-events: none;
  filter:
    drop-shadow(0 8px 12px rgba(0, 0, 0, 0.26))
    saturate(0.96)
    contrast(1.02);
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
}

</style>
