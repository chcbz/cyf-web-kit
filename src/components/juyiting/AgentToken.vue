<template>
  <button
    class="agent-token"
    :class="[
      statusClass(agent.status),
      roleClass(agent),
      motifClass,
      sceneClass,
      {
        active,
        'is-scene-agent': mode === 'scene',
        'is-selected': sceneState?.selected,
        'is-focused': sceneState?.focused
      }
    ]"
    :style="agentStyle(agent)"
    @click="$emit('select-agent', agent)"
  >
    <span v-if="bubbleText" class="agent-dialogue">{{ bubbleText }}</span>
    <span class="agent-shadow"></span>
    <span class="agent-figure" :style="rigStyle" :title="portraitName(agent)">
      <span class="agent-cape agent-rig-part rig-cape"></span>
      <span class="agent-hat agent-rig-part rig-headwear"></span>
      <span class="agent-neck agent-rig-part rig-neck"></span>
      <span class="agent-shoulder agent-shoulder-left agent-rig-part rig-shoulder-left"></span>
      <span class="agent-shoulder agent-shoulder-right agent-rig-part rig-shoulder-right"></span>
      <span class="agent-upper-arm agent-upper-arm-left agent-rig-part rig-upper-arm-left"></span>
      <span class="agent-upper-arm agent-upper-arm-right agent-rig-part rig-upper-arm-right"></span>
      <span class="agent-forearm agent-forearm-left agent-rig-part rig-forearm-left"></span>
      <span class="agent-forearm agent-forearm-right agent-rig-part rig-forearm-right"></span>
      <span class="agent-hand agent-hand-left agent-rig-part rig-hand-left"></span>
      <span class="agent-hand agent-hand-right agent-rig-part rig-hand-right"></span>
      <span class="agent-body agent-rig-part rig-torso">
        <span class="agent-sash"></span>
        <span class="agent-emblem"></span>
      </span>
      <span class="agent-pelvis agent-rig-part rig-pelvis"></span>
      <span class="agent-robe-skirt agent-rig-part rig-robe-skirt"></span>
      <span class="agent-thigh agent-thigh-left agent-rig-part rig-thigh-left"></span>
      <span class="agent-thigh agent-thigh-right agent-rig-part rig-thigh-right"></span>
      <span class="agent-shin agent-shin-left agent-rig-part rig-shin-left"></span>
      <span class="agent-shin agent-shin-right agent-rig-part rig-shin-right"></span>
      <span class="agent-boot agent-boot-left agent-rig-part rig-foot-left"></span>
      <span class="agent-boot agent-boot-right agent-rig-part rig-foot-right"></span>
      <span
        class="agent-head portrait-avatar agent-rig-part rig-head"
        :style="portraitStyle(agent)"
      ></span>
      <span class="agent-weapon agent-rig-part rig-prop"></span>
      <span class="agent-accessory agent-rig-part rig-prop-secondary"></span>
    </span>
    <span class="agent-name-tag">{{ portraitShortName(agent) }}</span>
    <span class="agent-status-badge">{{ statusText(agent.status) }}</span>
  </button>
</template>

<script setup>
import { computed } from 'vue'
import {
  roleBodyPartProfiles,
  roleBodyRigs,
  roleBodyVisuals
} from '@/constants/juyiting'
import { portraitRole } from '@/composables/juyiting/useWaterMarginRoles'

const props = defineProps({
  active: { type: Boolean, default: false },
  agent: { type: Object, required: true },
  agentStyle: { type: Function, required: true },
  bubbleText: { type: String, default: '' },
  mode: { type: String, default: 'token' },
  portraitName: { type: Function, required: true },
  portraitShortName: { type: Function, required: true },
  portraitStyle: { type: Function, required: true },
  roleClass: { type: Function, required: true },
  sceneState: { type: Object, default: null },
  statusClass: { type: Function, required: true },
  statusText: { type: Function, required: true }
})

defineEmits(['select-agent'])

const motifClass = computed(() => `motif-${portraitRole(props.agent).motif || 'crest'}`)

const sceneClass = computed(() => {
  if (props.mode !== 'scene') return ''
  const facing = props.sceneState?.facing || 'right'
  const motion = props.sceneState?.sceneStatus || 'idle'
  return [
    `is-facing-${facing}`,
    `is-motion-${motion}`,
    props.sceneState?.prominentMotion ? 'has-prominent-motion' : ''
  ].filter(Boolean)
})

const bodyConfig = computed(() => {
  const role = portraitRole(props.agent)
  return roleBodyVisuals[role.bodyType] || roleBodyVisuals.leader
})

const rigConfig = computed(() => {
  const role = portraitRole(props.agent)
  return roleBodyRigs[role.bodyType] || roleBodyRigs.leader
})

const bodyPartProfile = computed(() => {
  const role = portraitRole(props.agent)
  return roleBodyPartProfiles[role.bodyType] || roleBodyPartProfiles.leader
})

const rigStyle = computed(() => {
  const rig = rigConfig.value
  const body = bodyConfig.value
  const parts = bodyPartProfile.value
  return {
    '--real-body-width': body.width,
    '--real-body-height': body.height,
    '--head-scale': body.headScale,
    '--shoulder-width': body.shoulderWidth,
    '--body-stance': body.stance,
    '--body-gait-weight': body.gaitWeight,
    '--part-head-width': `${parts.head.width}px`,
    '--part-head-height': `${parts.head.height}px`,
    '--part-neck-width': `${parts.neck.width}px`,
    '--part-neck-height': `${parts.neck.height}px`,
    '--part-shoulder-width': `${parts.shoulder.width}px`,
    '--part-shoulder-height': `${parts.shoulder.height}px`,
    '--part-pelvis-width': `${parts.pelvis.width}px`,
    '--part-pelvis-height': `${parts.pelvis.height}px`,
    '--part-robe-width': `${parts.robeSkirt.width}px`,
    '--part-robe-height': `${parts.robeSkirt.height}px`,
    '--part-torso-width-bias': `${parts.torso.widthBias}px`,
    '--part-torso-height-bias': `${parts.torso.heightBias}px`,
    '--part-torso-waist': parts.torso.waist,
    '--part-torso-chest': parts.torso.chest,
    '--part-upper-arm-width': `${parts.upperArm.width}px`,
    '--part-upper-arm-length': `${parts.upperArm.length}px`,
    '--part-forearm-width': `${parts.forearm.width}px`,
    '--part-forearm-length': `${parts.forearm.length}px`,
    '--part-hand-width': `${parts.hand.width}px`,
    '--part-hand-height': `${parts.hand.height}px`,
    '--part-thigh-width': `${parts.thigh.width}px`,
    '--part-thigh-length': `${parts.thigh.length}px`,
    '--part-shin-width': `${parts.shin.width}px`,
    '--part-shin-length': `${parts.shin.length}px`,
    '--part-foot-width': `${parts.foot.width}px`,
    '--part-foot-height': `${parts.foot.height}px`,
    '--part-stride-scale': parts.thigh.stride,
    '--part-prop-scale': parts.prop.scale,
    '--head-x': `${rig.head.x}%`,
    '--head-y': `${parts.head.y ?? rig.head.y}px`,
    '--head-turn': `${rig.head.turn}deg`,
    '--neck-x': `${rig.neck.x}%`,
    '--neck-y': `${rig.neck.y}px`,
    '--torso-x': `${rig.torso.x}%`,
    '--torso-y': `${rig.torso.y}px`,
    '--torso-width': `${rig.torso.width}px`,
    '--torso-height': `${rig.torso.height}px`,
    '--torso-tilt': `${rig.torso.tilt}deg`,
    '--pelvis-x': `${rig.pelvis.x}%`,
    '--pelvis-y': `${rig.pelvis.y}px`,
    '--pelvis-sway': `${rig.pelvis.sway}px`,
    '--robe-x': `${rig.robeSkirt.x}%`,
    '--robe-y': `${rig.robeSkirt.y}px`,
    '--robe-sway': `${rig.robeSkirt.sway}deg`,
    '--left-upper-arm-x': `${rig.leftUpperArm.x}px`,
    '--left-upper-arm-y': `${rig.leftUpperArm.y}px`,
    '--left-upper-arm-rest': `${rig.leftUpperArm.rest}deg`,
    '--left-upper-arm-swing': `${rig.leftUpperArm.swing}deg`,
    '--left-forearm-x': `${rig.leftForearm.x}px`,
    '--left-forearm-y': `${rig.leftForearm.y}px`,
    '--left-forearm-rest': `${rig.leftForearm.rest}deg`,
    '--left-forearm-bend': `${rig.leftForearm.bend}deg`,
    '--left-hand-x': `${rig.leftHand.x}px`,
    '--left-hand-y': `${rig.leftHand.y}px`,
    '--right-upper-arm-x': `${rig.rightUpperArm.x}px`,
    '--right-upper-arm-y': `${rig.rightUpperArm.y}px`,
    '--right-upper-arm-rest': `${rig.rightUpperArm.rest}deg`,
    '--right-upper-arm-swing': `${rig.rightUpperArm.swing}deg`,
    '--right-forearm-x': `${rig.rightForearm.x}px`,
    '--right-forearm-y': `${rig.rightForearm.y}px`,
    '--right-forearm-rest': `${rig.rightForearm.rest}deg`,
    '--right-forearm-bend': `${rig.rightForearm.bend}deg`,
    '--right-hand-x': `${rig.rightHand.x}px`,
    '--right-hand-y': `${rig.rightHand.y}px`,
    '--left-thigh-x': `${rig.leftThigh.x}px`,
    '--left-thigh-y': `${rig.leftThigh.y}px`,
    '--left-thigh-rest': `${rig.leftThigh.rest}deg`,
    '--left-thigh-stride': `${rig.leftThigh.stride * parts.thigh.stride}deg`,
    '--left-shin-x': `${rig.leftShin.x}px`,
    '--left-shin-y': `${rig.leftShin.y}px`,
    '--left-shin-rest': `${rig.leftShin.rest}deg`,
    '--left-shin-bend': `${rig.leftShin.bend}deg`,
    '--right-thigh-x': `${rig.rightThigh.x}px`,
    '--right-thigh-y': `${rig.rightThigh.y}px`,
    '--right-thigh-rest': `${rig.rightThigh.rest}deg`,
    '--right-thigh-stride': `${rig.rightThigh.stride * parts.thigh.stride}deg`,
    '--right-shin-x': `${rig.rightShin.x}px`,
    '--right-shin-y': `${rig.rightShin.y}px`,
    '--right-shin-rest': `${rig.rightShin.rest}deg`,
    '--right-shin-bend': `${rig.rightShin.bend}deg`,
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

.agent-token.is-scene-agent {
  pointer-events: auto;
  transition:
    left 0.72s ease,
    top 0.72s ease,
    filter 0.18s ease;
}

.agent-token.is-scene-agent.is-selected .agent-name-tag,
.agent-token.is-scene-agent.is-focused .agent-name-tag {
  background: rgba(255, 239, 188, 0.98);
  color: #3c2716;
}

.agent-token.is-scene-agent.is-focused .agent-figure {
  filter:
    drop-shadow(0 0 8px rgba(255, 221, 130, 0.52))
    drop-shadow(0 8px 12px rgba(0, 0, 0, 0.24));
}

.agent-token.is-motion-busy .agent-shadow,
.agent-token.is-motion-talk .agent-shadow,
.agent-token.is-motion-discuss .agent-shadow {
  opacity: 0.86;
}

.agent-token.is-motion-talk .agent-head,
.agent-token.is-motion-discuss .agent-head {
  animation-duration: calc(var(--idle-speed, 2.8s) * 0.72);
}

.agent-token.has-prominent-motion .agent-figure,
.agent-token.has-prominent-motion .agent-shadow,
.agent-token.has-prominent-motion .agent-body,
.agent-token.has-prominent-motion .agent-pelvis,
.agent-token.has-prominent-motion .agent-upper-arm,
.agent-token.has-prominent-motion .agent-forearm,
.agent-token.has-prominent-motion .agent-thigh,
.agent-token.has-prominent-motion .agent-shin,
.agent-token.has-prominent-motion .agent-boot {
  animation-play-state: running;
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

.agent-rig-part {
  pointer-events: none;
}

.agent-head {
  position: absolute;
  left: var(--head-x, 50%);
  top: var(--head-y, 10px);
  width: calc(var(--part-head-width, 15px) * var(--head-scale, 0.9));
  height: calc(var(--part-head-height, 19px) * var(--head-scale, 0.9));
  transform: translateX(-50%) scaleX(var(--face, 1));
  border-radius: 48% 48% 46% 46%;
  z-index: 8;
  animation: agentLook var(--idle-speed, 2.8s) ease-in-out infinite;
  opacity: 0.98;
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
  box-shadow: inset 0 0 0 1px rgba(255, 238, 195, 0.16);
}

.agent-neck {
  position: absolute;
  left: var(--neck-x, 50%);
  top: var(--neck-y, 29px);
  z-index: 5;
  width: var(--part-neck-width, 8px);
  height: var(--part-neck-height, 8px);
  transform: translateX(-50%);
  border-radius: 0 0 8px 8px;
  background: #b98258;
  box-shadow:
    inset 0 -2px 0 rgba(72, 38, 22, 0.18),
    0 2px 0 color-mix(in srgb, var(--robe-color) 82%, #000000);
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
  width: var(--part-shoulder-width, 13px);
  height: var(--part-shoulder-height, 12px);
  border-radius: 50%;
  background:
    radial-gradient(circle at 35% 28%, rgba(255, 245, 210, 0.44), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--trim-color) 86%, #fff4d4), var(--trim-color));
  box-shadow:
    inset 0 -2px 0 rgba(0, 0, 0, 0.18),
    0 2px 3px rgba(0, 0, 0, 0.18);
}

.agent-shoulder-left {
  left: calc(var(--left-upper-arm-x, 17px) - 8px);
}

.agent-shoulder-right {
  left: calc(var(--right-upper-arm-x, 59px) - 5px);
}

.agent-body {
  position: absolute;
  left: var(--torso-x, 50%);
  top: var(--torso-y, 40px);
  width: calc(var(--torso-width, 35px) + var(--part-torso-width-bias, 0px));
  height: calc(var(--torso-height, 48px) + var(--part-torso-height-bias, 0px));
  transform: translateX(-50%) rotate(var(--torso-tilt, 0deg)) skewX(calc(var(--body-stance, 0.2) * -2deg)) scaleX(var(--part-torso-chest, 1));
  border-radius: calc(16px * var(--part-torso-chest, 1)) calc(16px * var(--part-torso-chest, 1)) calc(12px * var(--part-torso-waist, 0.9)) calc(12px * var(--part-torso-waist, 0.9)) / 18px 18px 10px 10px;
  background:
    radial-gradient(ellipse at 50% 3%, rgba(255, 244, 212, 0.32), transparent 20%),
    linear-gradient(92deg, rgba(0, 0, 0, 0.18), transparent 18%, transparent 82%, rgba(0, 0, 0, 0.16)),
    linear-gradient(135deg, transparent 42%, rgba(255, 255, 255, 0.26) 43%, transparent 47%),
    linear-gradient(180deg, color-mix(in srgb, var(--robe-color) 78%, #ffffff), var(--robe-color));
  box-shadow:
    inset 0 0 0 1px rgba(255, 244, 212, 0.34),
    inset 0 -8px 0 rgba(0, 0, 0, 0.1),
    0 6px 10px rgba(0, 0, 0, 0.2);
  z-index: 5;
  opacity: 1;
  animation: bodyWeightShift var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-body::before,
.agent-body::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.agent-body::before {
  left: 50%;
  top: 0;
  width: 1px;
  height: 100%;
  transform: translateX(-50%) rotate(5deg);
  background: rgba(255, 244, 212, 0.3);
  box-shadow: -7px 7px 0 -6px rgba(0, 0, 0, 0.25), 8px 10px 0 -7px rgba(0, 0, 0, 0.2);
}

.agent-body::after {
  left: 6px;
  right: 6px;
  bottom: -5px;
  height: 10px;
  border-radius: 0 0 12px 12px;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 6px),
    linear-gradient(180deg, color-mix(in srgb, var(--robe-color) 86%, #ffffff), color-mix(in srgb, var(--robe-color) 82%, #000000));
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

.agent-pelvis,
.agent-robe-skirt,
.agent-upper-arm,
.agent-forearm,
.agent-hand,
.agent-thigh,
.agent-shin {
  position: absolute;
  display: block;
}

.agent-pelvis {
  left: var(--pelvis-x, 50%);
  top: var(--pelvis-y, 82px);
  z-index: 4;
  width: var(--part-pelvis-width, 30px);
  height: var(--part-pelvis-height, 16px);
  transform: translateX(-50%);
  border-radius: 14px 14px 10px 10px;
  background:
    linear-gradient(90deg, rgba(0, 0, 0, 0.18), transparent 38%, rgba(255, 244, 212, 0.12), transparent 70%, rgba(0, 0, 0, 0.16)),
    linear-gradient(180deg, color-mix(in srgb, var(--robe-color) 74%, #000000), #2d1c13);
  box-shadow: inset 0 2px 0 rgba(255, 244, 212, 0.16);
  animation: pelvisSway var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-robe-skirt {
  left: var(--robe-x, 50%);
  top: var(--robe-y, 87px);
  z-index: 3;
  width: var(--part-robe-width, 34px);
  height: var(--part-robe-height, 30px);
  transform: translateX(-50%);
  transform-origin: 50% 0;
  clip-path: polygon(14% 0, 86% 0, 100% 100%, 0 100%);
  border-radius: 0 0 10px 10px;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.14) 0 1px, transparent 1px 7px),
    linear-gradient(180deg, color-mix(in srgb, var(--robe-color) 86%, #ffffff), color-mix(in srgb, var(--robe-color) 82%, #000000));
  box-shadow:
    inset 0 -4px 0 rgba(0, 0, 0, 0.14),
    0 4px 5px rgba(0, 0, 0, 0.12);
  animation: robeSkirtSway var(--idle-speed, 2.8s) ease-in-out infinite;
}

.agent-upper-arm,
.agent-forearm {
  width: var(--part-upper-arm-width, 10px);
  transform-origin: 50% 4px;
  z-index: 5;
  background:
    linear-gradient(90deg, rgba(0, 0, 0, 0.2), transparent 38%, rgba(255, 244, 212, 0.18) 52%, transparent 72%, rgba(0, 0, 0, 0.16)),
    linear-gradient(180deg, color-mix(in srgb, var(--robe-color) 78%, #ffffff), color-mix(in srgb, var(--robe-color) 84%, #000000));
  box-shadow:
    inset 0 -8px 0 rgba(255, 237, 200, 0.12),
    0 3px 4px rgba(0, 0, 0, 0.18);
}

.agent-upper-arm {
  height: var(--part-upper-arm-length, 24px);
  border-radius: 9px 9px 7px 7px;
}

.agent-forearm {
  width: var(--part-forearm-width, 9px);
  height: var(--part-forearm-length, 22px);
  border-radius: 8px 8px 6px 6px;
  z-index: 6;
}

.agent-upper-arm::after,
.agent-forearm::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -2px;
  width: 8px;
  height: 5px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: color-mix(in srgb, var(--robe-color) 74%, #000000);
  box-shadow: inset 0 2px 0 rgba(255, 244, 212, 0.14);
}

.agent-hand {
  z-index: 7;
  width: var(--part-hand-width, 10px);
  height: var(--part-hand-height, 9px);
  border-radius: 50%;
  background: #bf875e;
  box-shadow: inset -1px -2px 0 rgba(66, 36, 22, 0.18);
}

.agent-upper-arm-left {
  left: var(--left-upper-arm-x, 17px);
  top: var(--left-upper-arm-y, 48px);
  animation: upperArmLeft var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-upper-arm-right {
  left: var(--right-upper-arm-x, 59px);
  top: var(--right-upper-arm-y, 48px);
  animation: upperArmRight var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-forearm-left {
  left: var(--left-forearm-x, 20px);
  top: var(--left-forearm-y, 68px);
  animation: forearmLeft var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-forearm-right {
  left: var(--right-forearm-x, 56px);
  top: var(--right-forearm-y, 68px);
  animation: forearmRight var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-hand-left {
  left: var(--left-hand-x, 24px);
  top: var(--left-hand-y, 88px);
  animation: handLeft var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-hand-right {
  left: var(--right-hand-x, 54px);
  top: var(--right-hand-y, 88px);
  animation: handRight var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-thigh,
.agent-shin {
  border-radius: 8px 8px 5px 5px;
  transform-origin: 50% 2px;
  z-index: 2;
  background:
    linear-gradient(90deg, rgba(0, 0, 0, 0.24), transparent 42%, rgba(255, 244, 212, 0.12) 56%, rgba(0, 0, 0, 0.2)),
    linear-gradient(180deg, color-mix(in srgb, var(--robe-color) 68%, #000000), #302015);
  box-shadow: 0 2px 3px rgba(0, 0, 0, 0.18);
}

.agent-thigh::after,
.agent-shin::after {
  content: '';
  position: absolute;
  left: 1px;
  right: 1px;
  bottom: 6px;
  height: 1px;
  background: rgba(255, 244, 212, 0.22);
}

.agent-thigh {
  width: var(--part-thigh-width, 10px);
  height: var(--part-thigh-length, 27px);
}

.agent-shin {
  width: var(--part-shin-width, 9px);
  height: var(--part-shin-length, 25px);
  z-index: 3;
}

.agent-thigh-left {
  left: var(--left-thigh-x, 26px);
  top: var(--left-thigh-y, 82px);
  animation: thighLeft var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-thigh-right {
  left: var(--right-thigh-x, 41px);
  top: var(--right-thigh-y, 82px);
  animation: thighRight var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-shin-left {
  left: var(--left-shin-x, 24px);
  top: var(--left-shin-y, 107px);
  animation: shinLeft var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-shin-right {
  left: var(--right-shin-x, 42px);
  top: var(--right-shin-y, 107px);
  animation: shinRight var(--step-speed, 0.72s) ease-in-out infinite;
  animation-play-state: var(--walk-play-state, running);
}

.agent-boot {
  position: absolute;
  top: var(--left-foot-y, 113px);
  z-index: 7;
  width: var(--part-foot-width, 15px);
  height: var(--part-foot-height, 6px);
  border-radius: 60% 46% 7px 7px;
  background:
    radial-gradient(ellipse at 68% 30%, rgba(255, 244, 212, 0.18), transparent 32%),
    linear-gradient(180deg, #3a2519, #1c100b);
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

.role-yanqing .agent-thigh,
.role-yanqing .agent-shin {
  height: 24px;
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

.motif-spirit .agent-body,
.motif-spirit .agent-robe-skirt {
  filter: drop-shadow(0 0 7px rgba(179, 63, 31, 0.28));
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

.is-idle .agent-body,
.is-idle .agent-robe-skirt {
  filter:
    drop-shadow(0 5px 6px rgba(0, 0, 0, 0.26))
    saturate(0.96)
    contrast(1.04);
}

.is-busy {
  color: #9a5b00;
}

.is-busy .agent-body,
.is-busy .agent-robe-skirt {
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

.is-error .agent-body,
.is-error .agent-robe-skirt {
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

.is-offline .agent-body,
.is-offline .agent-robe-skirt,
.is-offline .portrait-avatar {
  filter: grayscale(0.86) saturate(0.62);
  opacity: 0.76;
}

.is-offline .agent-figure,
.is-offline .agent-head,
.is-offline .agent-hat,
.is-offline .agent-cape,
.is-offline .agent-body,
.is-offline .agent-robe-skirt,
.is-offline .agent-upper-arm,
.is-offline .agent-forearm,
.is-offline .agent-hand,
.is-offline .agent-thigh,
.is-offline .agent-shin,
.is-offline .agent-boot,
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
    transform: translateX(-50%) rotate(calc(var(--torso-tilt, 0deg) + (var(--body-stance, 0.2) * -0.8deg))) skewX(calc(var(--body-stance, 0.2) * -2deg)) scaleX(var(--part-torso-chest, 1));
  }
  50% {
    transform: translateX(calc(-50% + (var(--body-stance, 0.2) * 2px))) rotate(calc(var(--torso-tilt, 0deg) + (var(--body-stance, 0.2) * 0.8deg))) skewX(calc(var(--body-stance, 0.2) * -2deg)) scaleX(var(--part-torso-chest, 1));
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

@keyframes pelvisSway {
  0%,
  100% {
    transform: translateX(calc(-50% - var(--pelvis-sway, 3px) * 0.35));
  }
  50% {
    transform: translateX(calc(-50% + var(--pelvis-sway, 3px) * 0.35));
  }
}

@keyframes robeSkirtSway {
  0%,
  100% {
    transform: translateX(-50%) rotate(calc(var(--robe-sway, 3deg) * -0.5));
  }
  50% {
    transform: translateX(-50%) rotate(var(--robe-sway, 3deg));
  }
}

@keyframes upperArmLeft {
  0%,
  100% {
    transform: rotate(calc(var(--left-upper-arm-rest, 10deg) + var(--left-upper-arm-swing, 10deg)));
  }
  50% {
    transform: rotate(calc(var(--left-upper-arm-rest, 10deg) - var(--left-upper-arm-swing, 10deg)));
  }
}

@keyframes upperArmRight {
  0%,
  100% {
    transform: rotate(calc(var(--right-upper-arm-rest, -10deg) - var(--right-upper-arm-swing, 10deg)));
  }
  50% {
    transform: rotate(calc(var(--right-upper-arm-rest, -10deg) + var(--right-upper-arm-swing, 10deg)));
  }
}

@keyframes forearmLeft {
  0%,
  100% {
    transform: rotate(calc(var(--left-forearm-rest, 6deg) - var(--left-forearm-bend, 12deg) * 0.35));
  }
  50% {
    transform: rotate(calc(var(--left-forearm-rest, 6deg) + var(--left-forearm-bend, 12deg)));
  }
}

@keyframes forearmRight {
  0%,
  100% {
    transform: rotate(calc(var(--right-forearm-rest, -6deg) + var(--right-forearm-bend, 12deg) * 0.35));
  }
  50% {
    transform: rotate(calc(var(--right-forearm-rest, -6deg) - var(--right-forearm-bend, 12deg)));
  }
}

@keyframes handLeft {
  0%,
  100% {
    transform: rotate(calc(var(--left-forearm-rest, 6deg) * 0.5));
  }
  50% {
    transform: translateY(-1px) rotate(calc(var(--left-forearm-bend, 12deg) * 0.35));
  }
}

@keyframes handRight {
  0%,
  100% {
    transform: rotate(calc(var(--right-forearm-rest, -6deg) * 0.5));
  }
  50% {
    transform: translateY(-1px) rotate(calc(var(--right-forearm-bend, 12deg) * -0.35));
  }
}

@keyframes thighLeft {
  0%,
  100% {
    transform: rotate(calc(var(--left-thigh-rest, -5deg) - var(--left-thigh-stride, 8deg)));
  }
  50% {
    transform: rotate(calc(var(--left-thigh-rest, -5deg) + var(--left-thigh-stride, 8deg)));
  }
}

@keyframes thighRight {
  0%,
  100% {
    transform: rotate(calc(var(--right-thigh-rest, 5deg) + var(--right-thigh-stride, 8deg)));
  }
  50% {
    transform: rotate(calc(var(--right-thigh-rest, 5deg) - var(--right-thigh-stride, 8deg)));
  }
}

@keyframes shinLeft {
  0%,
  100% {
    transform: rotate(calc(var(--left-shin-rest, -2deg) + var(--left-shin-bend, 12deg) * 0.2));
  }
  50% {
    transform: rotate(calc(var(--left-shin-rest, -2deg) - var(--left-shin-bend, 12deg)));
  }
}

@keyframes shinRight {
  0%,
  100% {
    transform: rotate(calc(var(--right-shin-rest, 2deg) - var(--right-shin-bend, 12deg) * 0.2));
  }
  50% {
    transform: rotate(calc(var(--right-shin-rest, 2deg) + var(--right-shin-bend, 12deg)));
  }
}

@keyframes agentBootLeft {
  0%,
  100% {
    transform: translateX(calc(var(--left-foot-step, 3px) * -0.7)) rotate(calc(var(--left-thigh-rest, -5deg) - 2deg));
  }
  50% {
    transform: translateX(var(--left-foot-step, 3px)) rotate(calc(var(--left-thigh-rest, -5deg) + 12deg));
  }
}

@keyframes agentBootRight {
  0%,
  100% {
    transform: translateX(var(--right-foot-step, 3px)) rotate(calc(var(--right-thigh-rest, 5deg) + 3deg));
  }
  50% {
    transform: translateX(calc(var(--right-foot-step, 3px) * -0.7)) rotate(calc(var(--right-thigh-rest, 5deg) - 12deg));
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
  .agent-shadow,
  .agent-head,
  .agent-hat,
  .agent-cape,
  .agent-body,
  .agent-pelvis,
  .agent-robe-skirt,
  .agent-upper-arm,
  .agent-forearm,
  .agent-hand,
  .agent-thigh,
  .agent-shin,
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

  .agent-head {
    top: 9px;
    width: calc(var(--part-head-width, 15px) * var(--head-scale, 0.9) * 0.9);
    height: calc(var(--part-head-height, 19px) * var(--head-scale, 0.9) * 0.9);
  }

  .agent-body {
    top: 35px;
    width: calc((var(--torso-width, 35px) + var(--part-torso-width-bias, 0px)) * 0.88);
    height: calc((var(--torso-height, 48px) + var(--part-torso-height-bias, 0px)) * 0.88);
  }

  .agent-pelvis {
    width: calc(var(--part-pelvis-width, 30px) * 0.88);
    height: calc(var(--part-pelvis-height, 16px) * 0.88);
  }

  .agent-robe-skirt {
    width: calc(var(--part-robe-width, 34px) * 0.88);
    height: calc(var(--part-robe-height, 30px) * 0.88);
  }

  .agent-upper-arm {
    width: calc(var(--part-upper-arm-width, 10px) * 0.9);
    height: calc(var(--part-upper-arm-length, 24px) * 0.88);
  }

  .agent-forearm {
    width: calc(var(--part-forearm-width, 9px) * 0.9);
    height: calc(var(--part-forearm-length, 22px) * 0.88);
  }

  .agent-hand {
    width: calc(var(--part-hand-width, 10px) * 0.9);
    height: calc(var(--part-hand-height, 9px) * 0.9);
  }

  .agent-thigh {
    width: calc(var(--part-thigh-width, 10px) * 0.9);
    height: calc(var(--part-thigh-length, 27px) * 0.88);
  }

  .agent-shin {
    width: calc(var(--part-shin-width, 9px) * 0.9);
    height: calc(var(--part-shin-length, 25px) * 0.88);
  }

  .agent-boot {
    top: 99px;
    width: calc(var(--part-foot-width, 15px) * 0.88);
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
