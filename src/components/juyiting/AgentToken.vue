<template>
  <button
    class="agent-token"
    :class="[statusClass(agent.status), roleClass(agent), motifClass, { active }]"
    :style="agentStyle(agent)"
    @click="$emit('select-agent', agent)"
  >
    <span v-if="bubbleText" class="agent-dialogue">{{ bubbleText }}</span>
    <span class="agent-shadow"></span>
    <span class="agent-figure" :style="rigStyle" :title="portraitName(agent)">
      <span
        class="agent-body-sprite agent-rig-part rig-body-sprite"
        :class="bodyClass"
        :style="bodySpriteStyle"
      ></span>
      <span class="agent-weapon agent-rig-part rig-prop"></span>
      <span class="agent-cape agent-rig-part rig-cape"></span>
      <span class="agent-hat agent-rig-part rig-headwear"></span>
      <span class="agent-neck agent-rig-part rig-neck"></span>
      <span
        class="agent-costume agent-rig-part rig-costume"
        :class="costumeClass"
        :style="costumeStyle"
      ></span>
      <span
        class="agent-head portrait-avatar agent-rig-part rig-head"
        :style="portraitStyle(agent)"
      ></span>
      <span class="agent-shoulder agent-shoulder-left agent-rig-part rig-shoulder-left"></span>
      <span class="agent-shoulder agent-shoulder-right agent-rig-part rig-shoulder-right"></span>
      <span class="agent-arm agent-arm-left agent-rig-part rig-arm-left"></span>
      <span class="agent-arm agent-arm-right agent-rig-part rig-arm-right"></span>
      <span class="agent-body agent-rig-part rig-torso">
        <span class="agent-sash"></span>
        <span class="agent-emblem"></span>
      </span>
      <span class="agent-leg agent-leg-left agent-rig-part rig-leg-left"></span>
      <span class="agent-leg agent-leg-right agent-rig-part rig-leg-right"></span>
      <span class="agent-boot agent-boot-left agent-rig-part rig-foot-left"></span>
      <span class="agent-boot agent-boot-right agent-rig-part rig-foot-right"></span>
      <span class="agent-accessory agent-rig-part rig-prop-secondary"></span>
    </span>
    <span class="agent-name-tag">{{ portraitShortName(agent) }}</span>
    <span class="agent-status-badge">{{ statusText(agent.status) }}</span>
  </button>
</template>

<script setup>
import { computed } from 'vue'
import characterBodyAtlas from '@/assets/juyiting/liangshan-character-body-atlas-v1.png'
import characterAtlas from '@/assets/juyiting/liangshan-character-atlas-v2.png'
import { roleBodyRigs, roleBodyVisuals, roleCostumeVisuals } from '@/constants/juyiting'
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

const bodyConfig = computed(() => {
  const role = portraitRole(props.agent)
  return roleBodyVisuals[role.bodyType] || roleBodyVisuals.leader
})

const rigConfig = computed(() => {
  const role = portraitRole(props.agent)
  return roleBodyRigs[role.bodyType] || roleBodyRigs.leader
})

const bodyClass = computed(() => `body-${portraitRole(props.agent).bodyType || 'leader'}`)

const rigStyle = computed(() => {
  const rig = rigConfig.value
  return {
    '--head-x': `${rig.head.x}%`,
    '--head-y': `${rig.head.y}px`,
    '--head-turn': `${rig.head.turn}deg`,
    '--torso-x': `${rig.torso.x}%`,
    '--torso-y': `${rig.torso.y}px`,
    '--torso-width': `${rig.torso.width}px`,
    '--torso-height': `${rig.torso.height}px`,
    '--torso-tilt': `${rig.torso.tilt}deg`,
    '--left-arm-x': `${rig.leftArm.x}px`,
    '--left-arm-y': `${rig.leftArm.y}px`,
    '--left-arm-length': `${rig.leftArm.length}px`,
    '--left-arm-rest': `${rig.leftArm.rest}deg`,
    '--left-arm-swing': `${rig.leftArm.swing}deg`,
    '--right-arm-x': `${rig.rightArm.x}px`,
    '--right-arm-y': `${rig.rightArm.y}px`,
    '--right-arm-length': `${rig.rightArm.length}px`,
    '--right-arm-rest': `${rig.rightArm.rest}deg`,
    '--right-arm-swing': `${rig.rightArm.swing}deg`,
    '--left-leg-x': `${rig.leftLeg.x}px`,
    '--left-leg-y': `${rig.leftLeg.y}px`,
    '--left-leg-length': `${rig.leftLeg.length}px`,
    '--left-leg-rest': `${rig.leftLeg.rest}deg`,
    '--left-leg-stride': `${rig.leftLeg.stride}deg`,
    '--right-leg-x': `${rig.rightLeg.x}px`,
    '--right-leg-y': `${rig.rightLeg.y}px`,
    '--right-leg-length': `${rig.rightLeg.length}px`,
    '--right-leg-rest': `${rig.rightLeg.rest}deg`,
    '--right-leg-stride': `${rig.rightLeg.stride}deg`,
    '--left-foot-x': `${rig.leftFoot.x}px`,
    '--left-foot-y': `${rig.leftFoot.y}px`,
    '--left-foot-step': `${rig.leftFoot.step}px`,
    '--right-foot-x': `${rig.rightFoot.x}px`,
    '--right-foot-y': `${rig.rightFoot.y}px`,
    '--right-foot-step': `${rig.rightFoot.step}px`,
    '--prop-anchor-x': `${rig.prop.x}px`,
    '--prop-anchor-y': `${rig.prop.y}px`,
    '--prop-angle': `${rig.prop.angle}deg`,
    '--prop-swing': `${rig.prop.swing}deg`
  }
})

const bodySpriteStyle = computed(() => {
  const config = bodyConfig.value
  const columns = 3
  const rows = 3
  const x = (config.column / (columns - 1)) * 100
  const y = (config.row / (rows - 1)) * 100
  return {
    '--body-image': `url("${characterBodyAtlas}")`,
    '--body-x': `${x}%`,
    '--body-y': `${y}%`,
    '--real-body-width': config.width,
    '--real-body-height': config.height,
    '--head-scale': config.headScale,
    '--shoulder-width': config.shoulderWidth,
    '--body-stance': config.stance,
    '--body-gait-weight': config.gaitWeight
  }
})

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
  width: 88px;
  height: 146px;
  padding: 0;
  transform: translate(-50%, -100%);
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
  bottom: 126px;
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
  bottom: 3px;
  width: calc(34px * var(--body-scale, 1) * var(--depth-scale, 1));
  height: 9px;
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
  bottom: 8px;
  width: 76px;
  height: 128px;
  transform: translateX(-50%) scaleX(var(--face, 1)) scale(calc(var(--body-scale, 1) * var(--depth-scale, 1) * 0.78));
  transform-origin: 50% 100%;
  animation:
    agentStepShift var(--step-speed, 0.72s) ease-in-out infinite,
    agentBreath var(--idle-speed, 2.8s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running), running;
}

.agent-body-sprite {
  position: absolute;
  left: 50%;
  bottom: 0;
  z-index: 3;
  width: calc(92px * var(--real-body-width, 0.6));
  height: calc(124px * var(--real-body-height, 1));
  transform: translateX(-50%);
  transform-origin: 50% 100%;
  background-image: var(--body-image);
  background-position: var(--body-x) var(--body-y);
  background-repeat: no-repeat;
  background-size: 300% 300%;
  filter:
    drop-shadow(0 9px 9px rgba(0, 0, 0, 0.24))
    saturate(0.94)
    contrast(1.02);
  animation: bodyWeightShift var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
  pointer-events: none;
}

.agent-rig-part {
  pointer-events: none;
}

.agent-head {
  position: absolute;
  left: var(--head-x, 50%);
  top: var(--head-y, 10px);
  width: calc(17px * var(--head-scale, 0.9));
  height: calc(20px * var(--head-scale, 0.9));
  transform: translateX(-50%) scaleX(var(--face, 1));
  border-radius: 48% 48% 46% 46%;
  z-index: 8;
  animation: agentLook var(--idle-speed, 2.8s) ease-in-out infinite;
  opacity: 0.88;
}

.agent-hat {
  position: absolute;
  left: 50%;
  top: 5px;
  z-index: 9;
  display: none;
  transform: translateX(-50%);
  animation: agentLook var(--idle-speed, 2.8s) ease-in-out infinite;
}

.agent-cape {
  position: absolute;
  left: 50%;
  top: 40px;
  z-index: 0;
  display: none;
  transform: translateX(-50%);
  animation: capeSway var(--idle-speed, 2.8s) ease-in-out infinite;
}

.agent-neck {
  position: absolute;
  left: var(--head-x, 50%);
  top: calc(var(--head-y, 10px) + 19px);
  z-index: 5;
  width: 8px;
  height: 8px;
  transform: translateX(-50%);
  border-radius: 0 0 8px 8px;
  background: #b98258;
  box-shadow: inset 0 -2px 0 rgba(72, 38, 22, 0.18);
}

.agent-costume {
  position: absolute;
  left: 50%;
  top: 29px;
  z-index: 4;
  width: 58px;
  height: 82px;
  transform: translateX(-50%) scale(calc(var(--costume-scale, 1) * 0.82));
  transform-origin: 50% 18%;
  background-image: var(--costume-image);
  background-position: var(--costume-x) var(--costume-y);
  background-repeat: no-repeat;
  background-size: 400% 300%;
  border-radius: 15px 15px 22px 22px;
  filter:
    drop-shadow(0 5px 6px rgba(0, 0, 0, 0.26))
    saturate(0.92)
    contrast(1.04);
  opacity: 0.2;
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
  left: var(--prop-anchor-x, 0);
  top: var(--prop-anchor-y, 14px);
  transform-origin: 50% 88%;
}

.agent-accessory {
  z-index: 7;
  left: var(--prop-anchor-x, 54px);
  top: var(--prop-anchor-y, 42px);
  transform-origin: 50% 88%;
  animation: propGesture var(--idle-speed, 2.8s) ease-in-out infinite;
}

.agent-shoulder {
  top: calc(var(--torso-y, 40px) - 4px);
  z-index: 6;
  width: 13px;
  height: 12px;
  border-radius: 50%;
  background: var(--trim-color);
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.18);
}

.agent-shoulder-left {
  left: calc(var(--left-arm-x, 17px) - 8px);
}

.agent-shoulder-right {
  left: calc(var(--right-arm-x, 59px) - 5px);
}

.agent-body {
  position: absolute;
  left: var(--torso-x, 50%);
  top: var(--torso-y, 40px);
  width: var(--torso-width, calc(30px + (var(--shoulder-width, 0.32) * 16px)));
  height: var(--torso-height, 48px);
  transform: translateX(-50%) rotate(var(--torso-tilt, 0deg)) skewX(calc(var(--body-stance, 0.2) * -2deg));
  border-radius: 13px 13px 11px 11px;
  background:
    linear-gradient(135deg, transparent 42%, rgba(255, 255, 255, 0.26) 43%, transparent 47%),
    linear-gradient(180deg, color-mix(in srgb, var(--robe-color) 78%, #ffffff), var(--robe-color));
  box-shadow:
    inset 0 0 0 2px rgba(255, 244, 212, 0.34),
    0 6px 10px rgba(0, 0, 0, 0.18);
  z-index: 5;
  opacity: 0.2;
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
  top: var(--left-arm-y, 48px);
  width: 8px;
  height: var(--left-arm-length, 35px);
  border-radius: 8px;
  transform-origin: 50% 4px;
  z-index: 5;
  opacity: 0.36;
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
  left: var(--left-arm-x, 17px);
  animation: agentArmLeft var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-arm-right {
  left: var(--right-arm-x, 59px);
  top: var(--right-arm-y, 48px);
  height: var(--right-arm-length, 35px);
  animation: agentArmRight var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-leg {
  top: var(--left-leg-y, 82px);
  width: 9px;
  height: var(--left-leg-length, 31px);
  border-radius: 8px 8px 6px 6px;
  transform-origin: 50% 2px;
  z-index: 2;
  opacity: 0.34;
}

.agent-leg-left {
  left: var(--left-leg-x, 26px);
  animation: agentLegLeft var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-leg-right {
  left: var(--right-leg-x, 41px);
  top: var(--right-leg-y, 82px);
  height: var(--right-leg-length, 31px);
  animation: agentLegRight var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-boot {
  position: absolute;
  top: var(--left-foot-y, 113px);
  z-index: 7;
  width: 15px;
  height: 6px;
  border-radius: 50% 50% 6px 6px;
  background: #251711;
  box-shadow:
    inset 0 -2px 0 rgba(0, 0, 0, 0.24),
    0 1px 0 rgba(255, 244, 212, 0.18);
}

.agent-boot-left {
  left: var(--left-foot-x, 22px);
  transform-origin: 75% 50%;
  animation: agentBootLeft var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-boot-right {
  left: var(--right-foot-x, 39px);
  top: var(--right-foot-y, 113px);
  transform-origin: 25% 50%;
  animation: agentBootRight var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.role-songjiang .agent-hat {
  display: block;
  width: 21px;
  height: 7px;
  border-radius: 12px 12px 6px 6px;
  background: #1f1712;
  box-shadow: inset 0 4px 0 rgba(255, 244, 212, 0.18);
}

.role-songjiang .agent-hat::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -5px;
  width: 8px;
  height: 8px;
  transform: translateX(-50%);
  border-radius: 50% 50% 3px 3px;
  background: #1f1712;
}

.role-songjiang .agent-cape {
  display: block;
  width: 38px;
  height: 78px;
  border-radius: 18px 18px 14px 14px;
  background: linear-gradient(180deg, rgba(122, 31, 27, 0.86), rgba(63, 24, 18, 0.64));
}

.role-songjiang .agent-emblem {
  display: block;
}

.role-wuyong .agent-accessory {
  display: block;
  right: 4px;
  top: 39px;
  width: 22px;
  height: 20px;
  transform: rotate(-22deg);
  border-radius: 100% 0 100% 0;
  background:
    repeating-linear-gradient(90deg, rgba(35, 72, 62, 0.34) 0 2px, transparent 2px 5px),
    linear-gradient(135deg, #fff8e8, #d7b875);
  box-shadow: inset -3px -3px 0 rgba(0, 0, 0, 0.08);
}

.role-wuyong .agent-body {
  width: 29px;
  border-radius: 20px 20px 12px 12px;
}

.role-linchong .agent-weapon {
  display: block;
  left: 2px;
  top: 3px;
  width: 4px;
  height: 118px;
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
  width: 38px;
  height: 49px;
  border-radius: 18px 18px 12px 12px;
}

.role-luzhishen .agent-weapon {
  display: block;
  right: 6px;
  top: 26px;
  width: 6px;
  height: 92px;
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
  top: 42px;
  width: 30px;
  height: 60px;
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
  top: 38px;
  width: 34px;
  height: 68px;
  border-radius: 18px 18px 24px 24px;
  background: linear-gradient(180deg, rgba(47, 111, 106, 0.78), rgba(22, 56, 52, 0.52));
}

.role-husanniang .agent-hat {
  display: block;
  width: 12px;
  height: 24px;
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
  right: 2px;
  top: 39px;
  width: 28px;
  height: 28px;
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
  width: 39px;
  height: 50px;
  border-radius: 15px 15px 11px 11px;
}

.role-likui .agent-accessory,
.role-likui .agent-weapon {
  display: block;
  top: 48px;
  width: 20px;
  height: 26px;
}

.role-likui .agent-weapon {
  left: 2px;
  transform: rotate(-24deg);
}

.role-likui .agent-accessory {
  right: 2px;
  left: auto;
  --prop-angle: 24deg;
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

.is-idle .agent-body-sprite {
  filter:
    drop-shadow(0 9px 9px rgba(0, 0, 0, 0.24))
    saturate(0.98)
    contrast(1.02);
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

.is-busy .agent-body-sprite {
  filter:
    drop-shadow(0 9px 9px rgba(0, 0, 0, 0.28))
    saturate(0.9)
    sepia(0.08)
    contrast(1.03);
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
    agentStepShift var(--step-speed, 0.72s) ease-in-out infinite,
    agentAlert 0.82s steps(2, end) infinite;
}

.is-offline {
  color: #777;
}

.is-offline .agent-costume,
.is-offline .agent-body-sprite,
.is-offline .portrait-avatar {
  filter: grayscale(0.86) saturate(0.62);
  opacity: 0.76;
}

.is-offline .agent-figure,
.is-offline .agent-body-sprite,
.is-offline .agent-head,
.is-offline .agent-hat,
.is-offline .agent-cape,
.is-offline .agent-costume,
.is-offline .agent-accessory {
  animation-play-state: paused;
}

@keyframes agentStepShift {
  0%,
  100% {
    transform: translateX(-50%) translateY(0) scaleX(var(--face, 1)) scale(calc(var(--body-scale, 1) * var(--depth-scale, 1) * 0.78));
  }
  50% {
    transform: translateX(-50%) translateY(calc(var(--step-lift, 2px) * -1)) scaleX(var(--face, 1)) scale(calc(var(--body-scale, 1) * var(--depth-scale, 1) * 0.78));
  }
}

@keyframes bodyWeightShift {
  0%,
  100% {
    transform: translateX(-50%) rotate(calc(var(--body-stance, 0.2) * -0.8deg));
  }
  50% {
    transform: translateX(calc(-50% + (var(--body-stance, 0.2) * 2px))) rotate(calc(var(--body-stance, 0.2) * 0.8deg));
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
    transform: translateX(-50%) scaleX(var(--face, 1)) rotate(0);
  }
  42% {
    transform: translateX(-50%) scaleX(var(--face, 1)) rotate(var(--head-turn, 3deg));
  }
  72% {
    transform: translateX(-50%) scaleX(var(--face, 1)) rotate(calc(var(--head-turn, 3deg) * -0.7));
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
    transform: rotate(calc(var(--left-arm-rest, 10deg) + var(--left-arm-swing, 10deg)));
  }
  50% {
    transform: rotate(calc(var(--left-arm-rest, 10deg) - var(--left-arm-swing, 10deg)));
  }
}

@keyframes agentArmRight {
  0%,
  100% {
    transform: rotate(calc(var(--right-arm-rest, -10deg) - var(--right-arm-swing, 10deg)));
  }
  50% {
    transform: rotate(calc(var(--right-arm-rest, -10deg) + var(--right-arm-swing, 10deg)));
  }
}

@keyframes agentLegLeft {
  0%,
  100% {
    transform: rotate(calc(var(--left-leg-rest, -5deg) - var(--left-leg-stride, 8deg)));
  }
  50% {
    transform: rotate(calc(var(--left-leg-rest, -5deg) + var(--left-leg-stride, 8deg)));
  }
}

@keyframes agentLegRight {
  0%,
  100% {
    transform: rotate(calc(var(--right-leg-rest, 5deg) + var(--right-leg-stride, 8deg)));
  }
  50% {
    transform: rotate(calc(var(--right-leg-rest, 5deg) - var(--right-leg-stride, 8deg)));
  }
}

@keyframes agentBootLeft {
  0%,
  100% {
    transform: translateX(calc(var(--left-foot-step, 3px) * -0.7)) rotate(calc(var(--left-leg-rest, -5deg) - 2deg));
  }
  50% {
    transform: translateX(var(--left-foot-step, 3px)) rotate(calc(var(--left-leg-rest, -5deg) + 12deg));
  }
}

@keyframes agentBootRight {
  0%,
  100% {
    transform: translateX(var(--right-foot-step, 3px)) rotate(calc(var(--right-leg-rest, 5deg) + 3deg));
  }
  50% {
    transform: translateX(calc(var(--right-foot-step, 3px) * -0.7)) rotate(calc(var(--right-leg-rest, 5deg) - 12deg));
  }
}

@keyframes propGesture {
  0%,
  100% {
    transform: rotate(var(--prop-angle, 0deg)) translateY(0);
  }
  50% {
    transform: rotate(calc(var(--prop-angle, 0deg) + var(--prop-swing, 4deg))) translateY(-2px);
  }
}

@keyframes propGestureScroll {
  0%,
  100% {
    transform: rotate(var(--prop-angle, -22deg)) translateY(0);
  }
  50% {
    transform: rotate(calc(var(--prop-angle, -22deg) + var(--prop-swing, 8deg))) translateY(-3px);
  }
}

@keyframes weaponGuard {
  0%,
  100% {
    transform: rotate(var(--prop-angle, 0deg)) translateY(0);
  }
  50% {
    transform: rotate(calc(var(--prop-angle, 0deg) + var(--prop-swing, 4deg))) translateY(-1px);
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
  .agent-body-sprite,
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
    width: 76px;
    height: 126px;
  }

  .agent-figure {
    width: 66px;
    height: 110px;
  }

  .agent-body-sprite {
    width: calc(80px * var(--real-body-width, 0.6));
    height: calc(108px * var(--real-body-height, 1));
  }

  .agent-head {
    top: 9px;
    width: calc(15px * var(--head-scale, 0.9));
    height: calc(18px * var(--head-scale, 0.9));
  }

  .agent-costume {
    top: 26px;
    width: 52px;
    height: 72px;
  }

  .agent-body {
    top: 35px;
    width: calc(27px + (var(--shoulder-width, 0.32) * 14px));
    height: 42px;
  }

  .agent-arm {
    top: 42px;
    height: 30px;
  }

  .agent-leg {
    top: 72px;
    height: 27px;
  }

  .agent-boot {
    top: 99px;
    width: 13px;
    height: 6px;
  }

  .agent-boot-left {
    left: calc(19px - var(--body-stance, 0.2) * 4px);
  }

  .agent-boot-right {
    right: calc(19px - var(--body-stance, 0.2) * 4px);
  }

  .agent-name-tag,
  .agent-status-badge {
    max-width: 70px;
    font-size: 10px;
  }

  .agent-dialogue {
    bottom: 110px;
    min-width: 104px;
    max-width: min(190px, 62vw);
    padding: 6px 8px;
    font-size: 11px;
  }
}
</style>
