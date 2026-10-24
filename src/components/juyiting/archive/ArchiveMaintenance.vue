<template>
  <section class="archive-maintenance" aria-label="典籍任职与维护">
    <header><h3>任职与维护</h3><button type="button" :disabled="busy" @click="reload">刷新与恢复</button></header>
    <p class="hint">新增典籍是内容数据，不需要改代码。技能安装不授予业务权限，最终由后端校验。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <aside v-if="pending" role="status" class="card">
      原操作结果未决，已保存身份隔离的恢复引用。请先查询，不要另建任务。
      <p v-if="pending.body.kind === 'job' && pending.body.path === ''">刷新后重试需重新选择完全相同的底本；正文不存入浏览器持久存储。</p>
      <button type="button" :disabled="busy" @click="retry(sourceText)">按原操作重试</button>
    </aside>
    <section class="card">
      <h4>任命好汉</h4>
      <form class="form-grid" @submit.prevent="appoint">
        <label>目标好汉<select v-model="agentId" required><option value="">明确选择好汉</option><option v-for="a in agents" :key="a.agentId" :value="a.agentId">{{ agentName(a.agentId) }}</option></select></label>
        <label>职位<select v-model="positionId" required><option value="">选择职位</option><option v-for="p in positions.positions" :key="p.positionId" :value="p.positionId">{{ p.title }}（{{ p.capacity }} 名）</option></select></label>
        <button :disabled="blocked || !agentId || !positionId">任命并安装默认技能</button>
      </form>
      <article v-for="a in positions.appointments.filter(a => a.active)" :key="a.appointmentId" class="row">
        <span>{{ agentName(a.agentId) }} · {{ positionName(a.positionId) }}</span>
        <button type="button" :disabled="blocked" @click="submit('position', `/appointments/${a.appointmentId}/resign`, {})">卸任</button>
      </article>
      <p class="hint">卸任立即撤销此职位权限；只有最后一个来源消失才回收职位技能，通用技能保留。</p>
      <article v-for="i in positions.installations" :key="i.installationId" class="row">
        <span>{{ agentName(i.agentId) }} · {{ i.skillKey }} · {{ installLabel(i) }}<small v-if="i.retained"> · 通用技能保留</small></span>
        <button
          v-if="i.state === 'FAILED' || i.state === 'INSTALLED'"
          type="button"
          :disabled="blocked"
          @click="submit('position', `/installations/${i.installationId}/retry`, {})"
        >{{ i.state === 'INSTALLED' ? '重新安装并验证' : '重试安装/卸载' }}</button>
        <button
          v-if="i.retained && i.desired"
          type="button"
          :disabled="blocked"
          @click="submit('position', `/installations/${i.installationId}/uninstall`, {})"
        >卸载通用技能</button>
      </article>
    </section>
    <section class="card">
      <h4>交办典籍维护</h4>
      <form class="form-grid" @submit.prevent="createJob">
        <label>明确执行任职<select v-model="appointmentId" required><option value="">选择任职好汉</option><option v-for="a in positions.appointments.filter(a => a.active)" :key="a.appointmentId" :value="a.appointmentId">{{ agentName(a.agentId) }} · {{ positionName(a.positionId) }}</option></select></label>
        <label>维护技能<select v-model="job.skillKey" required><option value="">选择已就绪技能</option><option v-for="i in readySkills" :key="i.installationId" :value="i.skillKey">{{ i.skillKey }}</option></select></label>
        <label>作品标识<input
          v-model="job.workId"
          required
          pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}"
          placeholder="新书唯一标识，修订沿用原标识"
        /></label>
        <label>书名<input v-model="job.title" required maxlength="255" /></label>
        <label>作者<input v-model="job.author" required maxlength="255" /></label>
        <label>固定 UTF-8 底本<input type="file" accept=".txt,text/plain" @change="selectSource" /></label>
        <label>来源名称<input v-model="job.sourceName" required maxlength="255" /></label>
        <label>来源与使用权依据<input v-model="job.sourceRights" required maxlength="255" /></label>
        <label>发布方式<select v-model="job.mode"><option value="DRAFT_ONLY">仅草稿（默认，不上架）</option><option value="AUTO" :disabled="!canPublish">授权后自动发布</option></select></label>
        <p>本次明确交给：{{ appointment ? agentName(appointment.agentId) : '未选择' }}。底本 {{ sourceText ? '已读取' : '未选择' }}。</p>
        <button :disabled="blocked || !sourceText || !ready || !appointment">创建维护任务</button>
      </form>
    </section>
    <section class="card">
      <h4>维护结果</h4>
      <p v-if="!jobs.length">尚无维护任务。</p>
      <article v-for="j in jobs" :key="j.jobId" class="row">
        <div><strong>{{ j.title }}</strong><p>{{ agentName(j.agentId) }} · {{ jobLabel(j.state) }}</p><small>{{ j.workId }} / {{ j.editionId }}</small></div>
        <button
          v-if="j.state === 'FAILED'"
          type="button"
          :disabled="blocked"
          @click="submit('job', `/${j.jobId}/retry`, {})"
        >使用原底本重新交办</button>
        <button
          v-if="j.state === 'DRAFT'"
          type="button"
          :disabled="blocked"
          @click="submit('job', `/${j.jobId}/publish`, {})"
        >授权发布此草稿</button>
        <small v-if="j.errorCode">{{ j.errorCode }}</small>
        <button v-if="j.state === 'DRAFT' || j.state === 'PUBLISHED'" type="button" @click="showDraft(j)">查看版本内容</button>
        <button v-if="j.state === 'PUBLISHED'" type="button" @click="$emit('read-edition', j)">阅读该版本</button>
      </article>
      <details v-if="draftText"><summary>版本数据（只读）</summary><pre>{{ draftText }}</pre></details>
    </section>
    <details class="card">
      <summary>技能与职位配置（需要后端管理权限）</summary>
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
        <label><input v-model="definition.allowPublish" type="checkbox" />允许发布（后端另行校验授权）</label>
        <fieldset><legend>默认技能（可多选、可被多个职位引用）</legend><label v-for="s in positions.skills" :key="s.key"><input v-model="definition.skillKeys" type="checkbox" :value="s.key" />{{ s.key }} · {{ s.type === 'GENERAL' ? '通用' : '职位' }}</label></fieldset>
        <button :disabled="blocked">保存职位及默认技能</button>
      </form>
    </details>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useArchiveMaintenance } from '@/composables/juyiting/useArchiveMaintenance'
const props = defineProps({ agents: { type: Array, default: () => [] }, identityScope: { type: String, default: '' }, identityEpoch: { type: Number, default: 0 } })
defineEmits(['read-edition'])
const { positions, jobs, busy, error, notice, pending, blocked, reload, submit, retry, readDraft } = useArchiveMaintenance({ identityScope: () => props.identityScope, identityEpoch: () => props.identityEpoch })
const agentId = ref(''), positionId = ref(''), appointmentId = ref(''), sourceText = ref(''), draftText = ref('')
const job = reactive({ skillKey: '', workId: '', title: '', author: '', sourceName: '', sourceRights: '', mode: 'DRAFT_ONLY' })
const skill = reactive({ skillKey: '', type: 'POSITION', productVersionId: '' })
const initialDefinition = () => ({ positionId: '', title: '', capacity: 1, resource: 'archive:public', allowPublish: false, skillKeys: [], expectedRevision: '0' })
const definition = reactive(initialDefinition())
let sourceGeneration = 0
const agentName = id => { const a = props.agents.find(a => a.agentId === id); return a?.personaName || a?.agentName || a?.name || id }
const positionName = id => positions.value.positions.find(p => p.positionId === id)?.title || id
const appointment = computed(() => positions.value.appointments.find(a => a.active && a.appointmentId === appointmentId.value))
const readySkills = computed(() => positions.value.installations.filter(i => i.usable && i.agentId === appointment.value?.agentId && i.bindingId === appointment.value?.bindingId))
const ready = computed(() => readySkills.value.some(i => i.skillKey === job.skillKey))
const canPublish = computed(() => positions.value.positions.find(p => p.positionId === appointment.value?.positionId)?.allowPublish === true)
watch(canPublish, allowed => { if (!allowed) job.mode = 'DRAFT_ONLY' })
watch(() => [props.identityScope, props.identityEpoch], () => { sourceGeneration++; Object.assign(definition, initialDefinition()); Object.assign(skill, { skillKey: '', type: 'POSITION', productVersionId: '' }); agentId.value = ''; positionId.value = ''; appointmentId.value = ''; sourceText.value = ''; draftText.value = ''; Object.assign(job, { skillKey: '', workId: '', title: '', author: '', sourceName: '', sourceRights: '', mode: 'DRAFT_ONLY' }) })
const installLabel = i => ({ INSTALL_PENDING: '待安装', INSTALLED: i.usable ? '已就绪' : '不可使用', REMOVE_PENDING: '已停用，待卸载', REMOVED: '已卸载', FAILED: `失败：${i.errorCode || '请重试'}` }[i.state] || i.state)
const jobLabel = state => ({ WAITING: '等待 Runtime 执行', FAILED: '技能执行失败，未发布', DRAFT: '草稿已完成，未上架', PUBLISHED: '已发布' }[state] || state)
const appoint = () => submit('position', '/appointments', { positionId: positionId.value, agentId: agentId.value })
const defineSkill = () => submit('position', '/skills', { ...skill })
const configure = () => submit('position', '/definitions', { ...definition, skillKeys: [...definition.skillKeys] })
const editPosition = id => { const p = positions.value.positions.find(p => p.positionId === id); Object.assign(definition, p ? { positionId: p.positionId, title: p.title, capacity: p.capacity, resource: p.resource, allowPublish: p.allowPublish, skillKeys: [...p.skillKeys], expectedRevision: p.revision } : initialDefinition()) }
const createJob = () => { if (appointment.value && ready.value) return submit('job', '', { appointmentId: appointment.value.appointmentId, agentId: appointment.value.agentId, ...job, sourceText: sourceText.value }) }
const selectSource = async event => {
  const selection = ++sourceGeneration
  const file = event.target.files?.[0], identity = props.identityScope, epoch = props.identityEpoch
  sourceText.value = ''; if (!file) return
  try { const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); if (selection === sourceGeneration && identity === props.identityScope && epoch === props.identityEpoch) { sourceText.value = text; if (!job.sourceName) job.sourceName = file.name } }
  catch { if (selection !== sourceGeneration || identity !== props.identityScope || epoch !== props.identityEpoch) return; error.value = '底本必须是有效的 UTF-8 文本，未读取或提交。' }
}
const showDraft = async j => { const identity = props.identityScope, epoch = props.identityEpoch; try { const data = await readDraft(j.jobId); if (identity === props.identityScope && epoch === props.identityEpoch) draftText.value = data } catch (e) { if (identity === props.identityScope && epoch === props.identityEpoch) error.value = e.message } }
</script>

<style scoped>
.archive-maintenance{min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:12px;color:var(--library-ink)}header,.row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}h3,h4,p{margin:6px 0}.hint,small{color:var(--library-muted)}.card{padding:16px;border:1px solid var(--library-line);border-radius:10px;background:var(--library-paper)}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}label{display:flex;flex-direction:column;gap:6px;min-width:0}input,select,button{font:inherit;min-height:44px;border:1px solid var(--library-line);border-radius:6px;padding:8px;color:inherit;background:var(--library-paper);min-width:0;max-width:100%}input[type=checkbox]{min-height:auto}button{cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}.row{border-top:1px solid var(--library-line);padding:12px 0}.error{color:#9b2f26}fieldset{min-width:0}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto}summary{cursor:pointer;min-height:44px}@container(max-width:600px){.form-grid{grid-template-columns:1fr}.card{padding:12px}}
</style>
