import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { ref } from 'vue'
import { useHallTaskActions } from '../src/composables/juyiting/useHallTaskActions.js'
import { createEconomyRequestIntentStore } from '../src/composables/juyiting/economyRequestIntent.js'

let Vue
let mount
let BountyPanel
const wrappers = []
const domDescriptors = {}

const success = data => ({ data: { code: 'E0', data } })

const compile = async () => {
  const filename = new URL('../src/components/juyiting/BountyPanel.vue', import.meta.url)
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
  const silverAmount = await import('../src/utils/silverAmount.js')
  const code = compileScript(descriptor, { id: 'funded-bounty-public-contract-r7', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_match, names, path) =>
      `const { ${names.split(',').map(name => name.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
    .replace(/^import\s+([^\s]+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_match, name, path) =>
      `const ${name} = imports[${JSON.stringify(path)}]`)
    .replace('export default', 'return')
  return new Function('imports', code)({
    vue: Vue,
    './BountyActionIcon.vue': Vue.defineComponent({ render: () => Vue.h('span') }),
    '@/utils/silverAmount': silverAmount
  })
}

const installDom = () => {
  for (const key of ['SVGElement', 'Element', 'Node']) {
    domDescriptors[key] = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: globalThis.window?.[key] })
  }
}

const restoreDom = () => {
  for (const key of ['SVGElement', 'Element', 'Node']) {
    if (domDescriptors[key]) Object.defineProperty(globalThis, key, domDescriptors[key])
    else delete globalThis[key]
  }
}

const memoryStorage = () => {
  const records = new Map()
  return {
    getItem: key => records.get(key) || null,
    setItem: (key, value) => records.set(key, value),
    removeItem: key => records.delete(key)
  }
}

const actionHarness = ({ storage, api, scope = () => 'actor-a' }) => useHallTaskActions({
  agentApi: api,
  canAssign: () => true,
  fundedActorScopeKey: scope,
  fundedIntentStorage: storage,
  createIdempotencyKey: () => 'funded-create-key',
  log: { warn: () => {} },
  playError: () => {},
  playSuccess: () => {},
  selectedAgent: ref(null),
  selectedTask: ref(null),
  showToast: () => {},
  tasks: ref([])
})

const panelProps = recovery => ({
  tasks: [],
  selectedTask: null,
  selectedAgent: null,
  recommendedAgents: [],
  taskAbilityOptions: [],
  taskStatusFilters: [],
  fundedPreviewEnabled: true,
  fundedCreateRecovery: recovery,
  abilityText: () => '',
  canAssign: () => false,
  formatTime: () => '',
  portraitName: () => '',
  portraitStyle: () => ({}),
  taskAgentMatchScore: () => 0,
  taskStateClass: () => '',
  taskStatusCount: () => 0,
  taskStatusText: () => ''
})

const actionButton = (wrapper, text) => {
  const button = wrapper.findAll('button').find(item => item.text().includes(text))
  expect(button, `missing action ${text}`).to.exist
  return button
}

describe('W11 funded-create public composable contract', () => {
  before(async () => {
    installDom()
    Vue = await import('vue')
    ;({ mount } = await import('@vue/test-utils'))
    BountyPanel = await compile()
  })

  afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })
  after(() => restoreDom())

  it('returns the persisted recovery API and wires actual BountyPanel cancellation/confirmation to the original request', async () => {
    const storage = memoryStorage()
    const requests = []
    const api = {
      create: async (_url, body, options) => {
        requests.push({ body, key: options.headers['Idempotency-Key'] })
        if (requests.length === 1) throw new TypeError('response lost after server accepted the original request')
        return success({ id: 'recovered-task', ...body })
      }
    }
    const original = {
      title: '原资金榜正文',
      description: '不可用编辑稿替换',
      requiredAbilities: ['审计', '复核'],
      grossBountyAmountMicro: '100',
      settlementPolicy: 'GROSS_INCLUSIVE'
    }
    const first = actionHarness({ storage, api })
    expect(await first.createTask(original)).to.equal(false)

    const recovered = actionHarness({ storage, api })
    expect(recovered.fundedCreateRecovery).to.have.property('value')
    expect(recovered.fundedCreateRecovery.value?.body).to.deep.equal(original)
    expect(recovered.resumeFundedCreate).to.be.a('function')

    let cancelled = 0
    const Harness = Vue.defineComponent({
      setup () {
        return () => Vue.h(BountyPanel, {
          ...panelProps(recovered.fundedCreateRecovery.value),
          onResumeFundedCreate: recovered.resumeFundedCreate,
          onCancelFundedCreateRecovery: () => { cancelled += 1 }
        })
      }
    })
    const wrapper = mount(Harness)
    wrappers.push(wrapper)

    const recoveryText = wrapper.find('.funded-create-recovery').text()
    expect(recoveryText).to.include('原榜文名目：原资金榜正文')
    expect(recoveryText).to.include('原榜文缘由：不可用编辑稿替换')
    expect(recoveryText).to.include('原所需本领：审计、复核')
    expect(recoveryText).to.include('原结算规则：GROSS_INCLUSIVE')
    expect(recoveryText).to.include('原总额：100 micro-SILVER')
    expect(wrapper.text()).to.include('当前编辑稿不会提交或替换原请求。')
    await actionButton(wrapper, '暂不恢复').trigger('click')
    expect(cancelled).to.equal(1)
    expect(requests).to.have.length(1)
    expect(recovered.fundedCreateRecovery.value?.body).to.deep.equal(original)

    await actionButton(wrapper, '确认按原请求恢复').trigger('click')
    await Promise.resolve()
    await Vue.nextTick()
    expect(requests).to.have.length(2)
    expect(requests[1]).to.deep.equal(requests[0])
    expect(recovered.fundedCreateRecovery.value).to.equal(null)
  })

  it('reactively re-reads actor-scoped recovery from empty scope through A and B without cross-actor replay', async () => {
    const storage = memoryStorage()
    const requests = []
    const api = {
      create: async (_url, body, options) => {
        requests.push({ body, key: options.headers['Idempotency-Key'] })
        throw new TypeError('response lost')
      }
    }
    const originalA = { title: 'A 原文', description: 'A 缘由', requiredAbilities: ['甲'], grossBountyAmountMicro: '10', settlementPolicy: 'GROSS_INCLUSIVE' }
    const originalB = { title: 'B 原文', description: 'B 缘由', requiredAbilities: ['乙'], grossBountyAmountMicro: '20', settlementPolicy: 'GROSS_INCLUSIVE' }
    expect(await actionHarness({ storage, api, scope: () => 'actor-a' }).createTask(originalA)).to.equal(false)
    expect(await actionHarness({ storage, api, scope: () => 'actor-b' }).createTask(originalB)).to.equal(false)

    const scope = ref('')
    const recovered = actionHarness({ storage, api, scope: () => scope })
    expect(recovered.fundedCreateRecovery.value).to.equal(null)
    const Harness = Vue.defineComponent({
      setup () {
        return () => Vue.h(BountyPanel, {
          ...panelProps(recovered.fundedCreateRecovery.value),
          onResumeFundedCreate: recovered.resumeFundedCreate,
          onCancelFundedCreateRecovery: () => {}
        })
      }
    })
    const wrapper = mount(Harness)
    wrappers.push(wrapper)

    scope.value = 'actor-a'
    await Vue.nextTick()
    expect(wrapper.find('.funded-create-recovery').text()).to.include('原榜文名目：A 原文')
    scope.value = 'actor-b'
    await Vue.nextTick()
    expect(wrapper.find('.funded-create-recovery').text()).to.include('原榜文名目：B 原文')
    await actionButton(wrapper, '确认按原请求恢复').trigger('click')
    await Promise.resolve()
    expect(requests).to.have.length(3)
    expect(requests[2].body).to.deep.equal(originalB)
    expect(requests[2].key).to.equal(requests[1].key)
  })

  it('fences a delayed A funded-create completion from B recovery, journal, and task presentation', async () => {
    const storage = memoryStorage()
    const scope = ref('actor-a')
    const delayedA = (() => {
      let resolve
      const promise = new Promise(done => { resolve = done })
      return { promise, resolve }
    })()
    const requests = []
    const tasks = ref([])
    const selectedTask = ref(null)
    let keyIndex = 0
    const api = {
      create: async (_url, body, options) => {
        requests.push({ body, key: options.headers['Idempotency-Key'] })
        if (body.title === 'A 在途原文') return delayedA.promise
        throw new TypeError('B response lost after server accepted')
      }
    }
    const actions = useHallTaskActions({
      agentApi: api,
      canAssign: () => true,
      fundedActorScopeKey: () => scope,
      fundedIntentStorage: storage,
      createIdempotencyKey: () => `scope-key-${++keyIndex}`,
      log: { warn: () => {} },
      playError: () => {},
      playSuccess: () => {},
      selectedAgent: ref(null),
      selectedTask,
      showToast: () => {},
      tasks
    })
    const originalA = { title: 'A 在途原文', description: 'A 缘由', requiredAbilities: ['甲'], grossBountyAmountMicro: '10', settlementPolicy: 'GROSS_INCLUSIVE' }
    const originalB = { title: 'B 待恢复原文', description: 'B 缘由', requiredAbilities: ['乙'], grossBountyAmountMicro: '20', settlementPolicy: 'GROSS_INCLUSIVE' }

    const pendingA = actions.createTask(originalA)
    await Promise.resolve()
    scope.value = 'actor-b'
    await Vue.nextTick()
    expect(actions.fundedCreateRecovery.value).to.equal(null)

    expect(await actions.createTask(originalB)).to.equal(false)
    const bRecovery = JSON.parse(JSON.stringify(actions.fundedCreateRecovery.value))
    expect(bRecovery).to.deep.include({ body: originalB, key: 'scope-key-2' })

    const Harness = Vue.defineComponent({
      setup () {
        return () => Vue.h(BountyPanel, {
          ...panelProps(actions.fundedCreateRecovery.value),
          onResumeFundedCreate: actions.resumeFundedCreate,
          onCancelFundedCreateRecovery: () => {}
        })
      }
    })
    const wrapper = mount(Harness)
    wrappers.push(wrapper)
    expect(wrapper.find('.funded-create-recovery').text()).to.include('原榜文名目：B 待恢复原文')

    delayedA.resolve(success({ id: 'a-created-task', ...originalA }))
    expect(await pendingA).to.equal(true)
    await Vue.nextTick()

    expect(actions.fundedCreateRecovery.value).to.deep.equal(bRecovery)
    expect(wrapper.find('.funded-create-recovery').text()).to.include('原榜文名目：B 待恢复原文')
    expect(tasks.value).to.deep.equal([])
    expect(selectedTask.value).to.equal(null)

    const bStore = createEconomyRequestIntentStore({ storage, scopeKey: () => 'actor-b' })
    const aStore = createEconomyRequestIntentStore({ storage, scopeKey: () => 'actor-a' })
    expect(bStore.get('funded-create')).to.deep.equal({ state: 'PRESENT', record: bRecovery })
    expect(aStore.get('funded-create')).to.deep.equal({ state: 'ABSENT' })
    expect(requests).to.deep.equal([
      { body: originalA, key: 'scope-key-1' },
      { body: originalB, key: 'scope-key-2' }
    ])
  })

})
