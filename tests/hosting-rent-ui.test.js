import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { useHostingRent } from '../src/composables/juyiting/useHostingRent.js'
import * as amounts from '../src/utils/silverAmount.js'
import { hostingPersona, hostingQuote, hostingReceipt, hostingLookup, activeHostingLookup,
  freeReprovisionReceipt, memoryHostingStorage } from './hosting-rent-fixtures.js'

let Vue, mount, flushPromises, HostingRentPanel
let makeRent
const wrappers = []
const ok = data => ({ data: { code: 'E0', data } })

const controller = (overrides = {}) => {
  const requests = []
  let key = 0
  const rent = useHostingRent({ enabled: true, storage: memoryHostingStorage(), now: () => 2000,
    createKey: () => `00000000-0000-4000-8000-${String(++key).padStart(12, '0')}`,
    loadCapability: async () => ({ economyPreviewEnabled: true, principalScopeFingerprint: 'ui-test-scope' }),
    economyApi: { get: async () => ok({ currency: 'SILVER', availableMicro: '9999999999', heldMicro: '0' }) },
    agentApi: {
      create: async (url, body) => { requests.push({ url, body }); return ok(url.endsWith('/quotes') ? hostingQuote() : hostingReceipt()) },
      get: async () => ok(hostingLookup())
    }, ...overrides })
  makeRent = () => rent
  return { rent, requests }
}
const show = async (persona = hostingPersona()) => {
  const wrapper = mount(HostingRentPanel, { props: { persona, resolvePersona: () => persona } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
const button = (wrapper, text) => wrapper.findAll('button').find(item => item.text().includes(text))

describe('hosting rent actual quote/lease UI', () => {
  before(async () => {
    global.SVGElement = global.window?.SVGElement
    global.Element = global.window?.Element
    global.Node = global.window?.Node
    Vue = await import('vue')
    ;({ mount, flushPromises } = await import('@vue/test-utils'))
    const filename = new URL('../src/components/juyiting/HostingRentPanel.vue', import.meta.url)
    const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
    const compiled = compileScript(descriptor, { id: 'hosting-rent-ui', inlineTemplate: true }).content
    const imports = {
      vue: Vue,
      '../../composables/useHttp.js': { agentApi: {}, economyApi: {} },
      '../../stores/api.js': { useApiStore: () => ({ authorizationGeneration: 1 }) },
      '../../composables/juyiting/useHostingRent.js': { useHostingRent: () => makeRent() },
      '../../utils/economyPreviewCapability.js': { loadEconomyPreviewCapability: () => {} },
      '../../utils/silverAmount.js': amounts
    }
    const source = compiled.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_all, names, path) =>
      `const { ${names.split(',').map(name => name.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
      .replaceAll('import.meta.env.VITE_ECONOMY_PREVIEW_ENABLED', "'true'").replace('export default', 'return')
    HostingRentPanel = new Function('imports', source)(imports)
  })
  afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })

  it('renders actual server terms/wallet/separate token fees, with no charge until the confirm click', async () => {
    const h = controller()
    const wrapper = await show()
    expect(wrapper.text()).to.include('1234.5 SILVER')
    expect(wrapper.text()).to.include('2 固定天（172800 秒）')
    expect(wrapper.text()).to.include('configured-plan / v7')
    expect(wrapper.text()).to.include('任务 Token、技能购买、悬赏费用另计')
    expect(wrapper.text()).to.include('钱袋可用')
    expect(wrapper.text()).to.include('9999999999999 ms')
    expect(h.requests).to.have.length(1)
    await button(wrapper, '确认此报价并').trigger('click')
    await flushPromises()
    expect(h.requests).to.have.length(2)
    expect(wrapper.text()).to.include('202 接受不等于安顿成功')
    expect(wrapper.text()).to.include('PENDING')
    expect(wrapper.text()).to.include('安顿待确认 / 待就绪')
    expect(wrapper.text()).not.to.include('已在山寨安顿')
  })

  it('cancel click never sends a bind; readback failure displays confirmed not failed payment', async () => {
    const h = controller()
    const wrapper = await show()
    await button(wrapper, '取消报价').trigger('click')
    await flushPromises()
    expect(h.requests).to.have.length(1)
    expect(wrapper.find('[aria-label="服务端租金报价确认"]').exists()).to.equal(false)
    wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1)
    const pending = controller({ agentApi: {
      create: async url => ok(url.endsWith('/quotes') ? hostingQuote() : hostingReceipt()),
      get: async () => { throw new TypeError('readback unavailable') }
    } })
    const accepted = await show()
    await button(accepted, '确认此报价并').trigger('click')
    await flushPromises()
    expect(accepted.text()).to.include('原租金预留已确认')
    expect(accepted.text()).to.include('租约刷新待完成')
    expect(pending.rent.canInitial.value).to.equal(false)
    expect(button(accepted, '重查租约与余额').exists()).to.equal(true)
  })

  it('keeps manual paid renewal and free reprovision separate and shows immutable non-ready acceptance', async () => {
    let lookup = activeHostingLookup()
    const requests = []
    controller({ agentApi: {
      get: async () => ok(lookup),
      create: async (url, body) => {
        requests.push({ url, body })
        if (url.endsWith('/renewal-quotes')) return ok(hostingQuote({ purpose: 'RENEWAL', leaseId: 'hl-1', expectedLeaseVersion: '3' }))
        lookup = activeHostingLookup({ lease: { version: '4' }, reprovision: { requestId: 'hr-1', version: '1', status: 'ACCEPTED', requestedAt: '2000', serviceReadyAt: null } })
        return ok(freeReprovisionReceipt())
      }
    } })
    const wrapper = await show(hostingPersona({ bound: true, boundToMe: true, agentId: 'agt_server_proposal' }))
    expect(wrapper.text()).to.include('租约已生效')
    await button(wrapper, '手动续租 ·').trigger('click'); await flushPromises()
    expect(requests.map(item => item.url)).to.deep.equal(['/hosting-leases/hl-1/renewal-quotes'])
    await button(wrapper, '取消报价').trigger('click')
    await button(wrapper, '免费重整接应').trigger('click'); await flushPromises()
    expect(requests[1].body.hostingAction).to.equal('REPROVISION')
    expect(wrapper.text()).to.include('免费重整已接受（非就绪回执）')
    expect(wrapper.text()).to.include('金额 0 SILVER')
    expect(wrapper.text()).to.include('不会续租或重置到期日')
  })
})
