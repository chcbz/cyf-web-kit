import { expect } from 'chai'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const hall = source('../src/components/world/JuyiHall.vue')
const bounty = source('../src/components/juyiting/BountyPanel.vue')
const catalog = source('../src/components/juyiting/PersonaCatalogPanel.vue')
const productionEnv = source('../.env.production')

describe('Juyi Hall hosted point flow', () => {
  it('enables the production economy preview and gives an empty bounty a recruitment CTA', () => {
    expect(productionEnv).to.include('VITE_ECONOMY_PREVIEW_ENABLED=true')
    expect(bounty).to.include("'recruit-agent'")
    expect(bounty).to.include(`@click="$emit('recruit-agent', detailTask)"`)
    expect(bounty).to.include('!assignableRecommendedAgents.length')
  })

  it('preserves an exact task snapshot and only restores after an owned, operable online roster read', () => {
    expect(hall).to.include('taskId: task.id')
    expect(hall).to.include('taskVersion: task.taskVersion ?? task.version ?? null')
    expect(hall).to.include('task: taskSnapshot(task)')
    expect(hall).to.include('agent.boundToMe === true')
    expect(hall).to.include('agent.canOperate === true')
    expect(hall).to.include("normalizeStatus(agent.status) === 'online'")
    expect(hall).to.include('operableRosterAgents.value.find(item => isHostedPointAgentOnline(item, context))')
    expect(hall).to.include('await loadAgents()')
    expect(hall).to.include("Assignment remains the user's explicit button click.")
  })

  it('puts the newly selected hosted agent first without silently assigning it', () => {
    expect(bounty).to.include('const selectedOperableAgent = computed(() => {')
    expect(bounty).to.include('agent.canOperate !== true || agent.systemAgent === true')
    expect(bounty).to.include('trim().toLowerCase() === \'online\'')
    expect(bounty).to.include('[selectedOperableAgent.value, ...assignableRecommendedAgents.value, ...legacyFallback]')
    expect(bounty).to.include('!seen.has(agent.agentId) && seen.add(agent.agentId)')
    expect(bounty).to.include('@click="$emit(\'assign-task\', detailTask, agent)"')
    expect(bounty).not.to.include("props.recommendedAgents.filter(agent => ['吴用', '林冲']")
  })

  it('cancels the unbounded roster readback on identity change and unmount, while CTA recruitment hides local setup', () => {
    expect(hall).to.include(`cancelHostedPointWait()
  cancelPanelChatLoad()`)
    expect(hall).to.include(`onUnmounted(() => {
  cancelHostedPointWait()`)
    expect(hall).to.include('There is deliberately no total wait deadline')
    expect(catalog).to.include('hostedPointFlow: { type: Boolean, default: false }')
    expect(catalog).to.include('v-if="!hostedPointFlow"')
    expect(catalog).to.include('@hosting-confirmed="handleHostingConfirmed"')
  })
})
