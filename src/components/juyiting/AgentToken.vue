<template>
  <button
    class="agent-token"
    :class="[statusClass(agent.status), roleClass(agent), motifClass, { active }]"
    :style="agentStyle(agent)"
    @click="$emit('select-agent', agent)"
  >
    <span v-if="bubbleText" class="agent-dialogue">{{ bubbleText }}</span>
    <span class="agent-shadow"></span>
    <span class="agent-figure" :title="portraitName(agent)">
      <span class="agent-weapon"></span>
      <span class="agent-cape"></span>
      <span class="agent-hat"></span>
      <span class="agent-neck"></span>
      <span
        class="agent-costume"
        :class="costumeClass"
        :style="costumeStyle"
      ></span>
      <span
        class="agent-head portrait-avatar"
        :style="portraitStyle(agent)"
      ></span>
      <span class="agent-shoulder agent-shoulder-left"></span>
      <span class="agent-shoulder agent-shoulder-right"></span>
      <span class="agent-arm agent-arm-left"></span>
      <span class="agent-arm agent-arm-right"></span>
      <span class="agent-body">
        <span class="agent-sash"></span>
        <span class="agent-emblem"></span>
      </span>
      <span class="agent-leg agent-leg-left"></span>
      <span class="agent-leg agent-leg-right"></span>
      <span class="agent-boot agent-boot-left"></span>
      <span class="agent-boot agent-boot-right"></span>
      <span class="agent-accessory"></span>
    </span>
    <span class="agent-name-tag">{{ portraitShortName(agent) }}</span>
    <span class="agent-status-badge">{{ statusText(agent.status) }}</span>
  </button>
</template>

<script setup>
import { computed } from 'vue'
import characterAtlas from '@/assets/juyiting/liangshan-character-atlas-v2.png'
import { roleCostumeVisuals } from '@/constants/juyiting'
import { portraitRole } from '@/composables/juyiting/useWaterMarginRoles'

const props = defineProps({
  active: { type: Boolean, default: false },
  agent: { type: Object, required: true },
  agentStyle: { type: Function, required: true },
  bubbleText: { type: String, default: '' },
  portraitName: { type: Function, required: true },
  portraitShortName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true },
  roleClass: { type: Function, required: true },
  statusClass: { type: Function, required: true },
  statusText: { type: Function, required: true }
})

defineEmits(['select-agent'])

const costumeConfig = computed(() => {
  const role = portraitRole(props.agent)
  return roleCostumeVisuals[role.slug] || roleCostumeVisuals[role.motif] || roleCostumeVisuals.default
})

const costumeClass = computed(() => `costume-${portraitRole(props.agent).motif || 'crest'}`)

const motifClass = computed(() => `motif-${portraitRole(props.agent).motif || 'crest'}`)

const costumeStyle = computed(() => {
  const config = costumeConfig.value
  const columns = 4
  const rows = 3
  const x = (config.column / (columns - 1)) * 100
  const y = (config.row / (rows - 1)) * 100
  return {
    '--costume-image': `url("${characterAtlas}")`,
    '--costume-x': `${x}%`,
    '--costume-y': `${y}%`,
    '--costume-scale': config.scale || 1
  }
})
</script>

<style scoped>
.agent-token {
  position: absolute;
  z-index: 4;
  width: 76px;
  height: 108px;
  padding: 0;
  transform: translate(-50%, -50%);
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #2f261c;
  box-shadow: none;
  cursor: pointer;
  font: inherit;
  will-change: left, top;
}

.agent-token.active {
  outline: 0;
}

.agent-token.active .agent-figure {
  filter:
    drop-shadow(0 0 10px rgba(244, 200, 76, 0.78))
    drop-shadow(0 8px 12px rgba(0, 0, 0, 0.24));
}

.agent-dialogue {
  position: absolute;
  left: 50%;
  bottom: 92px;
  z-index: 8;
  width: max-content;
  min-width: 112px;
  max-width: 210px;
  padding: 7px 9px;
  transform: translateX(-50%);
  border: 1px solid rgba(96, 57, 28, 0.22);
  border-radius: 8px;
  background: rgba(255, 250, 236, 0.96);
  color: #3c2716;
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.22);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  pointer-events: none;
  white-space: normal;
  word-break: keep-all;
  overflow-wrap: break-word;
  animation: dialoguePop 0.22s ease-out;
}

.agent-dialogue::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -7px;
  width: 12px;
  height: 12px;
  transform: translateX(-50%) rotate(45deg);
  border-right: 1px solid rgba(96, 57, 28, 0.18);
  border-bottom: 1px solid rgba(96, 57, 28, 0.18);
  background: rgba(255, 250, 236, 0.96);
}

.agent-shadow {
  position: absolute;
  left: 50%;
  bottom: 14px;
  width: calc(48px * var(--body-scale, 1) * 0.76);
  height: 12px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.25);
  filter: blur(2px);
  animation: agentShadowPulse var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-figure {
  position: absolute;
  left: 50%;
  bottom: 19px;
  width: 68px;
  height: 98px;
  transform: translateX(-50%) scaleX(var(--face, 1)) scale(calc(var(--body-scale, 1) * 0.76));
  transform-origin: 50% 100%;
  animation:
    agentStepBob var(--step-speed, 0.72s) ease-in-out infinite,
    agentBreath var(--idle-speed, 2.8s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running), running;
}

.agent-head {
  position: absolute;
  left: 50%;
  top: 3px;
  width: 40px;
  height: 40px;
  transform: translateX(-50%) scaleX(var(--face, 1));
  border-radius: 50% 50% 46% 46%;
  z-index: 8;
  animation: agentLook var(--idle-speed, 2.8s) ease-in-out infinite;
}

.agent-hat {
  position: absolute;
  left: 50%;
  top: -6px;
  z-index: 9;
  display: none;
  transform: translateX(-50%);
  animation: agentLook var(--idle-speed, 2.8s) ease-in-out infinite;
}

.agent-cape {
  position: absolute;
  left: 50%;
  top: 35px;
  z-index: 0;
  display: none;
  transform: translateX(-50%);
  animation: capeSway var(--idle-speed, 2.8s) ease-in-out infinite;
}

.agent-neck {
  position: absolute;
  left: 50%;
  top: 35px;
  z-index: 5;
  width: 14px;
  height: 11px;
  transform: translateX(-50%);
  border-radius: 0 0 8px 8px;
  background: #b98258;
  box-shadow: inset 0 -2px 0 rgba(72, 38, 22, 0.18);
}

.agent-costume {
  position: absolute;
  left: 50%;
  top: 31px;
  z-index: 4;
  width: 78px;
  height: 58px;
  transform: translateX(-50%) scale(calc(var(--costume-scale, 1) * 0.78));
  transform-origin: 50% 18%;
  background-image: var(--costume-image);
  background-position: var(--costume-x) var(--costume-y);
  background-repeat: no-repeat;
  background-size: 400% 300%;
  border-radius: 18px 18px 16px 16px;
  filter:
    drop-shadow(0 5px 6px rgba(0, 0, 0, 0.26))
    saturate(0.92)
    contrast(1.04);
  opacity: 0.72;
  pointer-events: none;
  mix-blend-mode: multiply;
  animation: costumeSettle var(--idle-speed, 2.8s) ease-in-out infinite;
}

.agent-weapon,
.agent-accessory,
.agent-shoulder,
.agent-emblem {
  position: absolute;
  display: none;
}

.agent-weapon {
  z-index: 1;
}

.agent-accessory {
  z-index: 7;
  animation: propGesture var(--idle-speed, 2.8s) ease-in-out infinite;
}

.agent-shoulder {
  top: 36px;
  z-index: 6;
  width: 13px;
  height: 12px;
  border-radius: 50%;
  background: var(--trim-color);
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.18);
}

.agent-shoulder-left {
  left: 9px;
}

.agent-shoulder-right {
  right: 9px;
}

.agent-body {
  position: absolute;
  left: 50%;
  top: 34px;
  width: 36px;
  height: 44px;
  transform: translateX(-50%);
  border-radius: 16px 16px 10px 10px;
  background:
    linear-gradient(135deg, transparent 42%, rgba(255, 255, 255, 0.26) 43%, transparent 47%),
    linear-gradient(180deg, color-mix(in srgb, var(--robe-color) 78%, #ffffff), var(--robe-color));
  box-shadow:
    inset 0 0 0 2px rgba(255, 244, 212, 0.34),
    0 6px 10px rgba(0, 0, 0, 0.18);
  z-index: 3;
  opacity: 0.88;
}

.agent-sash {
  position: absolute;
  left: 4px;
  right: 4px;
  top: 18px;
  height: 7px;
  border-radius: 8px;
  background: var(--trim-color);
  transform: rotate(-10deg);
}

.agent-emblem {
  left: 50%;
  top: 7px;
  width: 10px;
  height: 10px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: rgba(255, 248, 220, 0.82);
  box-shadow: inset 0 0 0 2px var(--trim-color);
}

.agent-arm,
.agent-leg {
  position: absolute;
  display: block;
  background: color-mix(in srgb, var(--robe-color) 82%, #000000);
  opacity: 0.82;
}

.agent-arm {
  top: 42px;
  width: 10px;
  height: 30px;
  border-radius: 8px;
  transform-origin: 50% 4px;
  z-index: 5;
  box-shadow: inset 0 -8px 0 rgba(255, 237, 200, 0.12);
}

.agent-arm::after {
  content: '';
  position: absolute;
  left: 1px;
  bottom: -5px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #bf875e;
  box-shadow: inset -1px -2px 0 rgba(66, 36, 22, 0.18);
}

.agent-arm-left {
  left: 8px;
  animation: agentArmLeft var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-arm-right {
  right: 8px;
  animation: agentArmRight var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-leg {
  top: 72px;
  width: 11px;
  height: 22px;
  border-radius: 8px 8px 6px 6px;
  transform-origin: 50% 2px;
  z-index: 2;
}

.agent-leg-left {
  left: 19px;
  animation: agentLegLeft var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-leg-right {
  right: 19px;
  animation: agentLegRight var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-boot {
  position: absolute;
  top: 91px;
  z-index: 7;
  width: 18px;
  height: 8px;
  border-radius: 50% 50% 6px 6px;
  background: #251711;
  box-shadow:
    inset 0 -2px 0 rgba(0, 0, 0, 0.24),
    0 1px 0 rgba(255, 244, 212, 0.18);
}

.agent-boot-left {
  left: 15px;
  transform-origin: 75% 50%;
  animation: agentBootLeft var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-boot-right {
  right: 15px;
  transform-origin: 25% 50%;
  animation: agentBootRight var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.role-songjiang .agent-hat {
  display: block;
  width: 40px;
  height: 13px;
  border-radius: 12px 12px 6px 6px;
  background: #1f1712;
  box-shadow: inset 0 4px 0 rgba(255, 244, 212, 0.18);
}

.role-songjiang .agent-hat::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -7px;
  width: 12px;
  height: 12px;
  transform: translateX(-50%);
  border-radius: 50% 50% 3px 3px;
  background: #1f1712;
}

.role-songjiang .agent-cape {
  display: block;
  width: 46px;
  height: 50px;
  border-radius: 18px 18px 14px 14px;
  background: linear-gradient(180deg, rgba(122, 31, 27, 0.86), rgba(63, 24, 18, 0.64));
}

.role-songjiang .agent-emblem {
  display: block;
}

.role-wuyong .agent-accessory {
  display: block;
  right: -10px;
  top: 38px;
  width: 28px;
  height: 24px;
  transform: rotate(-22deg);
  border-radius: 100% 0 100% 0;
  background:
    repeating-linear-gradient(90deg, rgba(35, 72, 62, 0.34) 0 2px, transparent 2px 5px),
    linear-gradient(135deg, #fff8e8, #d7b875);
  box-shadow: inset -3px -3px 0 rgba(0, 0, 0, 0.08);
}

.role-wuyong .agent-body {
  width: 32px;
  border-radius: 20px 20px 12px 12px;
}

.role-linchong .agent-weapon {
  display: block;
  left: -2px;
  top: -10px;
  width: 5px;
  height: 106px;
  transform: rotate(13deg);
  border-radius: 5px;
  background: linear-gradient(180deg, #d9d0be 0 10px, #51341d 10px 100%);
  box-shadow: 7px 0 0 -3px rgba(0, 0, 0, 0.24);
}

.role-linchong .agent-weapon::before {
  content: '';
  position: absolute;
  left: -6px;
  top: -9px;
  width: 17px;
  height: 18px;
  clip-path: polygon(50% 0, 100% 68%, 58% 58%, 50% 100%, 42% 58%, 0 68%);
  background: #e8dfc8;
}

.role-linchong .agent-shoulder {
  display: block;
}

.role-luzhishen .agent-body {
  width: 42px;
  height: 46px;
  border-radius: 18px 18px 12px 12px;
}

.role-luzhishen .agent-weapon {
  display: block;
  right: -2px;
  top: 5px;
  width: 7px;
  height: 86px;
  transform: rotate(-10deg);
  border-radius: 6px;
  background: linear-gradient(180deg, #d9d0be, #6d3f1f 34%, #3a2418);
}

.role-luzhishen .agent-weapon::after {
  content: '';
  position: absolute;
  left: -6px;
  top: -8px;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  border: 4px solid #d9d0be;
  border-bottom-color: transparent;
}

.role-yanqing .agent-cape {
  display: block;
  top: 38px;
  width: 38px;
  height: 38px;
  border-radius: 14px 14px 20px 20px;
  background: linear-gradient(180deg, rgba(92, 45, 99, 0.74), rgba(35, 72, 62, 0.58));
}

.role-yanqing .agent-body {
  width: 30px;
  height: 39px;
}

.role-yanqing .agent-leg {
  height: 25px;
}

.role-yanqing .agent-sash {
  transform: rotate(14deg);
}

.role-husanniang .agent-cape {
  display: block;
  top: 32px;
  width: 44px;
  height: 44px;
  border-radius: 18px 18px 24px 24px;
  background: linear-gradient(180deg, rgba(47, 111, 106, 0.78), rgba(22, 56, 52, 0.52));
}

.role-husanniang .agent-hat {
  display: block;
  width: 18px;
  height: 32px;
  border-radius: 14px 14px 6px 6px;
  background: linear-gradient(180deg, #1d1713, #4b3020 42%, rgba(29, 23, 19, 0));
}

.role-husanniang .agent-hat::before,
.role-husanniang .agent-hat::after {
  content: '';
  position: absolute;
  top: 14px;
  width: 15px;
  height: 7px;
  border-radius: 7px;
  background: linear-gradient(90deg, #d4a949, #f0ddb0);
}

.role-husanniang .agent-hat::before {
  right: 11px;
  transform: rotate(-34deg);
}

.role-husanniang .agent-hat::after {
  left: 11px;
  transform: rotate(34deg);
}

.role-husanniang .agent-body {
  width: 34px;
  height: 42px;
  border-radius: 18px 18px 12px 12px;
}

.role-husanniang .agent-sash {
  top: 16px;
  height: 6px;
  transform: rotate(9deg);
}

.role-husanniang .agent-weapon {
  display: block;
  right: -6px;
  top: 12px;
  width: 34px;
  height: 34px;
  transform: rotate(18deg);
}

.role-husanniang .agent-weapon::before {
  content: '';
  position: absolute;
  left: 14px;
  top: 6px;
  width: 6px;
  height: 28px;
  border-radius: 5px;
  background: linear-gradient(180deg, #784e23, #3c2417);
}

.role-husanniang .agent-weapon::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 5px solid #e4dcc4;
  border-top-color: transparent;
  border-left-color: transparent;
  border-radius: 50%;
  box-shadow: inset -1px -1px 0 rgba(0, 0, 0, 0.16);
}

.role-likui .agent-body {
  width: 41px;
  height: 45px;
  border-radius: 15px 15px 11px 11px;
}

.role-likui .agent-accessory,
.role-likui .agent-weapon {
  display: block;
  top: 38px;
  width: 20px;
  height: 26px;
}

.role-likui .agent-weapon {
  left: -8px;
  transform: rotate(-24deg);
}

.role-likui .agent-accessory {
  right: -8px;
  transform: rotate(24deg);
}

.role-likui .agent-weapon::before,
.role-likui .agent-accessory::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 0;
  width: 5px;
  height: 26px;
  border-radius: 4px;
  background: #4a2716;
}

.role-likui .agent-weapon::after,
.role-likui .agent-accessory::after {
  content: '';
  position: absolute;
  left: 1px;
  top: -2px;
  width: 18px;
  height: 16px;
  clip-path: polygon(50% 0, 100% 28%, 82% 100%, 50% 78%, 18% 100%, 0 28%);
  background: #d9d0be;
}

.motif-scroll .agent-accessory,
.motif-craft .agent-accessory {
  animation-name: propGestureScroll;
}

.motif-weapon .agent-weapon,
.motif-spirit .agent-weapon {
  animation: weaponGuard var(--idle-speed, 2.8s) ease-in-out infinite;
}

.motif-wave .agent-cape,
.motif-wind .agent-cape,
.motif-flourish .agent-cape {
  animation-name: capeSwayWide;
}

.motif-beast .agent-body {
  transform: translateX(-50%) scaleX(1.08);
}

.motif-beast .agent-shoulder {
  display: block;
}

.motif-spirit .agent-costume {
  filter:
    drop-shadow(0 0 7px rgba(179, 63, 31, 0.38))
    saturate(1.03)
    contrast(1.08);
}

.motif-wind .agent-figure {
  animation-duration: var(--step-speed, 0.72s), calc(var(--idle-speed, 2.8s) * 0.82);
}

.motif-wave .agent-boot {
  background: #1f2929;
}

.agent-name-tag,
.agent-status-badge {
  position: absolute;
  left: 50%;
  max-width: 76px;
  transform: translateX(-50%);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 8px;
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.18);
}

.agent-name-tag {
  bottom: 0;
  padding: 2px 6px;
  background: rgba(255, 247, 224, 0.95);
  color: #2f261c;
  font-size: 11px;
  font-weight: 700;
}

.agent-status-badge {
  top: 6px;
  padding: 1px 5px;
  background: rgba(35, 24, 16, 0.78);
  color: #fff4d4;
  font-size: 10px;
}

.portrait-avatar {
  position: relative;
  overflow: hidden;
  background-repeat: no-repeat;
  background-color: #7c1f1b;
  box-shadow:
    inset 0 0 0 2px rgba(255, 244, 212, 0.82),
    inset 0 -4px 0 rgba(0, 0, 0, 0.14),
    0 3px 8px rgba(0, 0, 0, 0.24);
}

.portrait-avatar::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(circle at 35% 23%, rgba(255, 255, 255, 0.22), transparent 34%);
  pointer-events: none;
}

.is-idle {
  color: #2e7d32;
}

.is-idle .agent-costume {
  filter:
    drop-shadow(0 5px 6px rgba(0, 0, 0, 0.26))
    saturate(0.96)
    contrast(1.04);
}

.is-busy {
  color: #9a5b00;
}

.is-busy .agent-costume {
  filter:
    drop-shadow(0 5px 6px rgba(0, 0, 0, 0.28))
    saturate(0.86)
    sepia(0.12)
    contrast(1.04);
}

.is-busy .agent-head,
.is-busy .agent-hat {
  animation-duration: calc(var(--idle-speed, 2.8s) * 0.78);
}

.is-error {
  color: #b3261e;
}

.is-error .agent-costume {
  filter:
    drop-shadow(0 0 8px rgba(179, 38, 30, 0.42))
    saturate(0.75)
    contrast(1.08);
}

.is-error .agent-figure {
  animation:
    agentStepBob var(--step-speed, 0.72s) ease-in-out infinite,
    agentAlert 0.82s steps(2, end) infinite;
}

.is-offline {
  color: #777;
}

.is-offline .agent-costume,
.is-offline .portrait-avatar {
  filter: grayscale(0.86) saturate(0.62);
  opacity: 0.76;
}

.is-offline .agent-figure,
.is-offline .agent-head,
.is-offline .agent-hat,
.is-offline .agent-cape,
.is-offline .agent-costume,
.is-offline .agent-accessory {
  animation-play-state: paused;
}

@keyframes agentStepBob {
  0%,
  100% {
    transform: translateX(-50%) translateY(0) scaleX(var(--face, 1)) scale(calc(var(--body-scale, 1) * 0.76));
  }
  50% {
    transform: translateX(-50%) translateY(calc(var(--step-lift, 3px) * -1)) scaleX(var(--face, 1)) scale(calc(var(--body-scale, 1) * 0.76));
  }
}

@keyframes agentShadowPulse {
  0%,
  100% {
    transform: translateX(-50%) scaleX(var(--shadow-scale, 1));
    opacity: 0.72;
  }
  50% {
    transform: translateX(-50%) scaleX(calc(var(--shadow-scale, 1) * 0.82));
    opacity: 0.5;
  }
}

@keyframes agentBreath {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -1.4px;
  }
}

@keyframes agentLook {
  0%,
  100% {
    translate: 0 0;
  }
  42% {
    translate: 1px -0.5px;
  }
  72% {
    translate: -1px 0;
  }
}

@keyframes capeSway {
  0%,
  100% {
    transform: translateX(-50%) rotate(-1deg);
  }
  50% {
    transform: translateX(-50%) rotate(2deg);
  }
}

@keyframes capeSwayWide {
  0%,
  100% {
    transform: translateX(-50%) skewX(-2deg) rotate(-2deg);
  }
  50% {
    transform: translateX(-50%) skewX(3deg) rotate(3deg);
  }
}

@keyframes costumeSettle {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 1px;
  }
}

@keyframes agentArmLeft {
  0%,
  100% {
    transform: rotate(24deg);
  }
  50% {
    transform: rotate(-26deg);
  }
}

@keyframes agentArmRight {
  0%,
  100% {
    transform: rotate(-26deg);
  }
  50% {
    transform: rotate(24deg);
  }
}

@keyframes agentLegLeft {
  0%,
  100% {
    transform: rotate(-18deg);
  }
  50% {
    transform: rotate(20deg);
  }
}

@keyframes agentLegRight {
  0%,
  100% {
    transform: rotate(20deg);
  }
  50% {
    transform: rotate(-18deg);
  }
}

@keyframes agentBootLeft {
  0%,
  100% {
    transform: translateX(-2px) rotate(-7deg);
  }
  50% {
    transform: translateX(3px) rotate(8deg);
  }
}

@keyframes agentBootRight {
  0%,
  100% {
    transform: translateX(3px) rotate(8deg);
  }
  50% {
    transform: translateX(-2px) rotate(-7deg);
  }
}

@keyframes propGesture {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -2px;
  }
}

@keyframes propGestureScroll {
  0%,
  100% {
    transform: rotate(-22deg) translateY(0);
  }
  50% {
    transform: rotate(-15deg) translateY(-3px);
  }
}

@keyframes weaponGuard {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -1px;
  }
}

@keyframes agentAlert {
  0%,
  100% {
    filter: drop-shadow(0 0 6px rgba(179, 38, 30, 0.32));
  }
  50% {
    filter: drop-shadow(1px 0 8px rgba(179, 38, 30, 0.48));
  }
}

@keyframes dialoguePop {
  from {
    transform: translateX(-50%) translateY(6px) scale(0.94);
    opacity: 0;
  }
  to {
    transform: translateX(-50%) translateY(0) scale(1);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-token,
  .agent-figure,
  .agent-shadow,
  .agent-head,
  .agent-hat,
  .agent-cape,
  .agent-costume,
  .agent-arm,
  .agent-leg,
  .agent-boot,
  .agent-accessory,
  .agent-weapon {
    animation: none !important;
  }

  .agent-dialogue {
    animation: none;
  }
}

@media (max-width: 640px) {
  .agent-token {
    width: 66px;
    height: 96px;
  }

  .agent-figure {
    width: 60px;
    height: 88px;
  }

  .agent-head {
    width: 36px;
    height: 36px;
  }

  .agent-costume {
    top: 29px;
    width: 70px;
    height: 52px;
  }

  .agent-body {
    top: 31px;
    width: 32px;
    height: 41px;
  }

  .agent-arm {
    top: 38px;
    height: 27px;
  }

  .agent-leg {
    top: 67px;
    height: 20px;
  }

  .agent-boot {
    top: 84px;
    width: 16px;
    height: 7px;
  }

  .agent-boot-left {
    left: 13px;
  }

  .agent-boot-right {
    right: 13px;
  }

  .agent-name-tag,
  .agent-status-badge {
    max-width: 70px;
    font-size: 10px;
  }

  .agent-dialogue {
    bottom: 84px;
    min-width: 104px;
    max-width: min(190px, 62vw);
    padding: 6px 8px;
    font-size: 11px;
  }
}
</style>
