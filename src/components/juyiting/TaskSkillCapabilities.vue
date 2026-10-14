<template>
  <details class="task-skills">
    <summary>本任务可调用技能（{{ projection?.items?.filter(item => item.state === 'CALLABLE').length || 0 }}）</summary>
    <button type="button" :disabled="loading" @click="$emit('refresh')">刷新技能目录</button>
    <p v-if="error" role="status">{{ error }}</p>
    <p v-if="!projection && !error">{{ loading ? '正在读取…' : '尚未核对当前目录' }}</p>
    <ul v-else><li v-for="item in projection?.items || []" :key="`${item.skillKey}@${item.skillVersion}`">
      <strong>{{ item.title }}</strong> · {{ item.state === 'CALLABLE' ? '可调用' : '暂不可用' }}
      <small v-if="item.reasonCode">{{ item.reasonCode }}</small><p>{{ skillCostText(item.costInfo) }}</p>
    </li></ul>
    <small>费用仅为登记说明；平台不批准、冻结或预扣运行费用。技能包购买价另列。</small>
  </details>
</template>
<script setup>
import { skillCostText } from '../../composables/juyiting/hallSkillCapabilities.js'
defineProps({ projection: { type: Object, default: null }, error: { type: String, default: '' }, loading: { type: Boolean, default: false } })
defineEmits(['refresh'])
</script>
<style scoped>.task-skills{padding:8px 12px;font-size:12px;line-height:1.5;color:#3f6254}.task-skills ul{padding-left:18px}.task-skills p{margin:4px 0}.task-skills small{display:block;color:#637267}</style>
