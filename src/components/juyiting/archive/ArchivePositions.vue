<template>
  <section class="archive-positions" aria-label="典籍任职管理">
    <header><h3>任职管理</h3><button type="button" :disabled="busy" @click="reload">刷新与恢复</button></header>
    <p class="hint">此处管理任职与岗位技能。典籍内容维护请从任职好汉详情的“密议”进入。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <aside v-if="pending" role="status" class="card">
      上次操作结果待确认，请先查询，勿重复提交。
      <button type="button" :disabled="busy" @click="retry()">按原操作重试</button>
    </aside>
    <section class="card">
      <h4>任命好汉</h4>
      <form class="form-grid" @submit.prevent="appoint">
        <label>目标好汉<select v-model="agentId" required><option value="">明确选择好汉</option><option v-for="a in agents" :key="a.agentId" :value="a.agentId">{{ agentName(a.agentId) }}</option></select></label>
        <label>职位<select v-model="positionId" required><option value="">选择职位</option><option v-for="p in positions.positions" :key="p.positionId" :value="p.positionId">{{ p.title }}（{{ p.capacity }} 名）</option></select></label>
        <button :disabled="blocked || !agentId || !positionId">任命并安装默认技能</button>
      </form>
      <p v-if="!busy && !error && !activeAppointments.length" role="status">暂无任职，请先任命好汉。</p>
      <article v-for="a in activeAppointments" :key="a.appointmentId" class="row">
        <span>{{ agentName(a.agentId) }} · {{ positionName(a.positionId) }}</span>
        <button type="button" :disabled="blocked" @click="submit(`/appointments/${a.appointmentId}/resign`, {})">卸任</button>
      </article>
      <p class="hint">卸任立即撤销此职位权限；只有最后一个来源消失才回收职位技能，通用技能保留。</p>
      <article v-for="i in positions.installations" :key="i.installationId" class="row">
        <span>{{ agentName(i.agentId) }} · {{ i.skillKey }} · {{ installLabel(i) }}<small v-if="i.retained"> · 通用技能保留</small></span>
        <button
          v-if="i.state === 'FAILED' || i.state === 'INSTALLED'"
          type="button"
          :disabled="blocked"
          @click="submit(`/installations/${i.installationId}/retry`, {})"
        >{{ i.state === 'INSTALLED' ? '重新安装并验证' : '重试安装/卸载' }}</button>
        <button
          v-if="i.retained && i.desired"
          type="button"
          :disabled="blocked"
          @click="submit(`/installations/${i.installationId}/uninstall`, {})"
        >卸载通用技能</button>
      </article>
    </section>
    <details class="card">
      <summary>技能与职位配置（需管理权限）</summary>
      <form class="form-grid" @submit.prevent="defineSkill">
        <label>技能标识<input v-model="skill.skillKey" required placeholder="archive-maintenance" /></label>
        <label>技能类型<select v-model="skill.type"><option value="POSITION">职位技能</option><option value="GENERAL">通用技能</option></select></label>
        <label>已审核包版本<input v-model="skill.productVersionId" required placeholder="从已审核技能目录取得版本标识" /></label>
        <button :disabled="blocked">登记技能</button>
      </form>
      <form class="form-grid" @submit.prevent="configure">
        <label>编辑职位<select @change="editPosition($event.target.value)"><option value="">新增职位</option><option v-for="p in positions.positions" :key="p.positionId" :value="p.positionId">{{ p.title }}</option></select></label>
        <label>职位标识<input v-model="definition.positionId" required /></label><label>职位名称<input v-model="definition.title" required /></label>
        <label>任职名额<input
          v-model.number="definition.capacity"
          type="number"
          min="1"
          required
        /></label>
        <label>业务范围<input v-model="definition.resource" required placeholder="archive:public 或 archive:work:作品标识" /></label>
        <label><input v-model="definition.allowPublish" type="checkbox" />允许发布（需发布权限）</label>
        <fieldset><legend>默认技能（可多选、可被多个职位引用）</legend><label v-for="s in positions.skills" :key="s.key"><input v-model="definition.skillKeys" type="checkbox" :value="s.key" />{{ s.key }} · {{ s.type === 'GENERAL' ? '通用' : '职位' }}</label></fieldset>
        <button :disabled="blocked">保存职位及默认技能</button>
      </form>
    </details>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useArchivePositions } from '@/composables/juyiting/useArchivePositions'
const props = defineProps({ agents: { type: Array, default: () => [] }, identityScope: { type: String, default: '' }, identityEpoch: { type: Number, default: 0 } })
const { positions, busy, error, notice, pending, blocked, reload, submit, retry } = useArchivePositions({ identityScope: () => props.identityScope, identityEpoch: () => props.identityEpoch })
const agentId = ref(''), positionId = ref('')
const skill = reactive({ skillKey: '', type: 'POSITION', productVersionId: '' })
const initialDefinition = () => ({ positionId: '', title: '', capacity: 1, resource: 'archive:public', allowPublish: false, skillKeys: [], expectedRevision: '0' })
const definition = reactive(initialDefinition())
const activeAppointments = computed(() => positions.value.appointments.filter(a => a.active))
const agentName = id => { const a = props.agents.find(a => a.agentId === id); return a?.personaName || a?.agentName || a?.name || id }
const positionName = id => positions.value.positions.find(p => p.positionId === id)?.title || id
watch(() => [props.identityScope, props.identityEpoch], () => { Object.assign(definition, initialDefinition()); Object.assign(skill, { skillKey: '', type: 'POSITION', productVersionId: '' }); agentId.value = ''; positionId.value = '' })
const installLabel = i => ({ INSTALL_PENDING: '待安装', INSTALLED: i.usable ? '已就绪' : '不可使用', REMOVE_PENDING: '已停用，待卸载', REMOVED: '已卸载', FAILED: `失败：${i.errorCode || '请重试'}` }[i.state] || i.state)
const appoint = () => submit('/appointments', { positionId: positionId.value, agentId: agentId.value })
const defineSkill = () => submit('/skills', { ...skill })
const configure = () => submit('/definitions', { ...definition, skillKeys: [...definition.skillKeys] })
const editPosition = id => { const p = positions.value.positions.find(p => p.positionId === id); Object.assign(definition, p ? { positionId: p.positionId, title: p.title, capacity: p.capacity, resource: p.resource, allowPublish: p.allowPublish, skillKeys: [...p.skillKeys], expectedRevision: p.revision } : initialDefinition()) }
</script>

<style scoped>
.archive-positions{min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:12px;color:var(--library-ink)}header,.row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}h3,h4,p{margin:6px 0}.hint,small{color:var(--library-muted)}.card{padding:16px;border:1px solid var(--library-line);border-radius:10px;background:var(--library-paper)}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}label{display:flex;flex-direction:column;gap:6px;min-width:0}input,select,button{font:inherit;min-height:44px;border:1px solid var(--library-line);border-radius:6px;padding:8px;color:inherit;background:var(--library-paper);min-width:0;max-width:100%}input[type=checkbox]{min-height:auto}button{cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}.row{border-top:1px solid var(--library-line);padding:12px 0}.error{color:#9b2f26}fieldset{min-width:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto}summary{cursor:pointer;min-height:44px}@container(max-width:600px){.form-grid{grid-template-columns:1fr}.card{padding:12px}}
</style>
