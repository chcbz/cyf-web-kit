<template><aside v-if="voice?.supported" class="hall-voice-hud" @pointerdown.stop @keydown.stop><HallVoiceControls :voice="voice" @apply="$emit('apply', $event)" /></aside></template>
<script setup>import HallVoiceControls from './HallVoiceControls.vue'; defineProps({ voice:{type:Object,default:null} }); defineEmits(['apply'])</script>
<style scoped>.hall-voice-hud{position:absolute;right:18px;bottom:18px;z-index:12;max-width:min(420px,calc(100vw - 36px));padding:9px;border-radius:10px;background:rgba(255,250,240,.96);box-shadow:0 6px 20px rgba(0,0,0,.28)}</style>
