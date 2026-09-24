<template>
  <section class="hall-mine-page" aria-label="我的">
    <header><p>聚义厅 · 我的</p><h2>常用入口与设置</h2><span>名册、典籍和消息统一放在这里，不打断当前事项。</span></header>
    <div class="mine-grid">
      <button type="button" @click="$emit('open', 'agents')"><var-icon name="account-circle-outline" /><span><strong>好汉名册</strong><small>查看吴用、林冲等 Agent 的能力与在线状态</small></span></button>
      <button type="button" @click="$emit('open', 'library')"><var-icon name="notebook" /><span><strong>典籍阁</strong><small>阅读典籍、案卷与个人进度</small></span></button>
      <button type="button" @click="$emit('open', 'messages')"><var-icon name="bell-outline" /><span><strong>消息</strong><small>查看需要你处理的事项</small></span></button>
      <button type="button" @click="$emit('map')"><var-icon name="map-marker-outline" /><span><strong>厅中实景</strong><small>进入梁山场景与地图</small></span></button>
      <button type="button" :disabled="accountEntryDisabled" @click="$emit('profile')"><var-icon name="account-circle-outline" /><span><strong>个人中心</strong><small>账户、授权与隐私设置</small></span></button>
    </div>
  </section>
</template>
<script setup>
defineProps({ accountEntryDisabled: { type: Boolean, default: false } })
defineEmits(['open', 'map', 'profile'])
</script>
<style scoped>
.hall-mine-page{min-height:100%;padding:24px 16px 96px;box-sizing:border-box;background:#f5f4f0;color:#242e2b}.hall-mine-page header{max-width:760px;margin:0 auto 22px}.hall-mine-page header p,.hall-mine-page header h2,.hall-mine-page header span{margin:0}.hall-mine-page header p{font-size:12px;color:#923f30}.hall-mine-page header h2{margin-top:5px;font:500 25px/1.45 "Noto Serif CJK SC","Songti SC",serif}.hall-mine-page header span{display:block;margin-top:6px;color:#68716b;font-size:14px}.mine-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;max-width:760px;margin:auto}.mine-grid button{display:flex;align-items:center;gap:13px;min-height:86px;padding:16px;text-align:left;border:1px solid #e3e5dc;border-radius:12px;background:#fffefa;color:#242e2b}.mine-grid .var-icon{flex:none;font-size:26px;color:#923f30}.mine-grid span{display:grid;gap:4px;min-width:0}.mine-grid strong{font-size:16px}.mine-grid small{color:#68716b;line-height:1.5}.mine-grid button:disabled{opacity:.55}@media(max-width:600px){.mine-grid{grid-template-columns:1fr}.hall-mine-page{padding-top:20px}.mine-grid button{min-height:74px}}
</style>
