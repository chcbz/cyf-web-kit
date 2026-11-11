import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { useHostingRent } from '../src/composables/juyiting/useHostingRent.js'
import * as amounts from '../src/utils/wenAmount.js'
import { hostingPersona, hostingQuote, hostingReceipt, hostingLookup, activeHostingLookup,
  freeReprovisionReceipt, memoryHostingStorage } from './hosting-rent-fixtures.js'

let Vue, mount, flushPromises, HostingRentPanel
let makeRent
const wrappers = []
const ok = data => data

const controller = (overrides = {}) => {
  const requests = []
  let key = 0
  const rent = useHostingRent({ enabled: true, storage: memoryHostingStorage(), now: () => 2000,
    createKey: () => `00000000-0000-4000-8000-${String(++key).padStart(12, '0')}`,
    loadCapability: async () => ({ economyPreviewEnabled: true, principalScopeSha256: 'c3bc3be1d84b8bfb021dd87ffae84531399c4e0c20bf1d63ebcb972325b3c755' }),
    economyApi: { get: async () => ok({ currency: 'WEN', available: { currency: 'WEN', amountMinor: '9999999999' }, held: { currency: 'WEN', amountMinor: '0' } }), create: async () => ok({ transactionId: 'etx-welcome', status: 'POSTED', amountWen: '1000000000', campaignRef: 'hosting-welcome-v1' }) },
    agentApi: {
      create: async (url, body) => { requests.push({ url, body }); return ok(url.endsWith('/quotes') ? hostingQuote() : hostingReceipt()) },
      get: async () => ok(hostingLookup())
    }, ...overrides })
  makeRent = () => rent
  return { rent, requests }
}
const show = async (persona = hostingPersona(), extraProps = {}) => {
  const wrapper = mount(HostingRentPanel, { props: { persona, resolvePersona: () => persona, ...extraProps } })
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
      '../../utils/wenAmount.js': amounts
    }
    const source = compiled.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_all, names, path) =>
      `const { ${names.split(',').map(name => name.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
      .replaceAll('import.meta.env.VITE_ECONOMY_PREVIEW_ENABLED', "'true'").replace('export default', 'return')
    HostingRentPanel = new Function('imports', source)(imports)
  })
  afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })

  for (const [status, title] of [['LOCKED', '欠费锁定，等待自动续费'], ['FINISHING', '正在解除收尾，暂不可重新邀请']]) {
    it(`shows ${status} without offering payment or re-invitation`, async () => {
      const h = controller({ agentApi: { get: async () => activeHostingLookup({ lease: { status, version: '4' }, admission: status }),
        create: async () => { throw Error('lifecycle display must not write') } } })
      const wrapper = await show(hostingPersona({ bound: true, boundToMe: true, agentId: 'agt_server_proposal' }))
      expect(wrapper.text()).to.include(title)
      expect(wrapper.text()).to.include('tx-capture')
      expect(wrapper.text()).not.to.include('安顿待确认')
      expect(h.rent.canInitial.value).to.equal(false)
      expect(h.rent.canRenew.value).to.equal(false)
      expect(h.rent.canReprovision.value).to.equal(false)
      expect(button(wrapper, '重查租约与余额')).not.to.equal(undefined)
      expect(button(wrapper, '确认此报价')).to.equal(undefined)
      expect(button(wrapper, '手动续租')).to.equal(undefined)
      expect(h.rent.error.value).to.equal('')
    })
  }

  it('shows first-fee breakdown from the quote and numeric expiry without charging on preview', async () => {
    const writes = []
    controller({ agentApi: {
      create: async (url, body) => { writes.push({ url, body }); return ok(hostingQuote({ amountWen: '650', recurringAmountWen: '500',
        initialSkillCount: '3', initialSkillAmountWen: '150', periodSeconds: '2592000', expiresAt: 1800000000000 })) },
      get: async () => ok(hostingLookup())
    } })
    const wrapper = await show()
    expect(wrapper.text()).to.include('本次合计：650文 / 30 天')
    expect(wrapper.text()).to.include('正常租费：500文 / 30 天')
    expect(wrapper.text()).to.include('已有技能：3种')
    expect(wrapper.text()).to.include('首次费用 150文；后续每期 500文')
    expect(wrapper.text()).to.include(new Date(1800000000000).toLocaleString())
    expect(wrapper.text()).to.include('余额足够时自动续费')
    expect(wrapper.text()).not.to.include('仅手动续租')
    expect(writes).to.have.length(1)
    await button(wrapper, '取消报价').trigger('click'); await flushPromises()
    expect(writes).to.have.length(1)
  })

  it('renders actual server terms/wallet/separate token fees, with no charge until the confirm click', async () => {
    const h = controller()
    const wrapper = await show()
    expect(wrapper.text()).to.include('1234500000文')
    expect(wrapper.text()).to.include('2 天')
    expect(wrapper.text()).not.not.to.include('configured-plan / v7')
    expect(wrapper.text()).to.include('任务用量、技能购买、悬赏费用另计')
    expect(wrapper.text()).to.include('钱袋可用')
    expect(wrapper.text()).not.to.include('9999999999999 ms')
    expect(wrapper.text()).to.include('报价有效至')
    expect(h.requests).to.have.length(1)
    await button(wrapper, '确认此报价并').trigger('click')
    await flushPromises()
    expect(h.requests).to.have.length(2)
    expect(wrapper.text()).to.include('尚未完成安顿')
    expect(wrapper.text()).not.to.include('PENDING')
    expect(wrapper.text()).to.include('安顿待确认 / 待就绪')
    expect(wrapper.text()).not.to.include('已在山寨安顿')
    expect(wrapper.emitted('hosting-confirmed')).to.deep.equal([[{
      personaCode: 'linchong', agentId: 'agt_server_proposal'
    }]])
  })

  it('cancel click never sends a bind; readback failure displays confirmed not failed payment', async () => {
    const h = controller()
    const wrapper = await show()
    await button(wrapper, '取消报价').trigger('click')
    await flushPromises()
    expect(h.requests).to.have.length(1)
    expect(wrapper.find('[aria-label="租金报价确认"]').exists()).to.equal(false)
    wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1)
    const pending = controller({ agentApi: {
      create: async url => ok(url.endsWith('/quotes') ? hostingQuote() : hostingReceipt()),
      get: async () => { throw new TypeError('readback unavailable') }
    } })
    const accepted = await show()
    await button(accepted, '确认此报价并').trigger('click')
    await flushPromises()
    expect(accepted.text()).to.include('租金已预留')
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
        lookup = activeHostingLookup({ lease: { version: '4' }, reprovision: { requestId: 'hr-1', version: '1', status: 'ACCEPTED', requestedAt: 2000, serviceReadyAt: null } })
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
    expect(wrapper.text()).to.include('免费重整已受理，等待就绪')
    expect(wrapper.text()).to.include('金额 0文')
    expect(wrapper.text()).to.include('不会续租或重置到期日')
  })
  it('shows explicit free cutover origin and future normal rent without fake payment', async () => {
    const value = activeHostingLookup({ lease: { settlementKind: 'TRANSITION', amountWen: '50' },
      intent: { reserveTransactionId: null, captureTransactionId: null, refundTransactionId: null, serviceReadyAt: null } })
    controller({ agentApi: { get: async () => ok(value), create: async () => { throw Error('unexpected payment') } } })
    const wrapper = await show(hostingPersona({ bound: true, boundToMe: true, agentId: 'agt_server_proposal' }))
    expect(wrapper.text()).to.include('赠送30天过渡期')
    expect(wrapper.text()).to.include('不补收历史租金和已有技能费')
    expect(wrapper.text()).to.not.include('预留流水')
  })

  it('shows retained rights rather than a zero-payment receipt and creates no new payment', async () => {
    const value = activeHostingLookup({ lease: { settlementKind: 'RETAINED', amountWen: '0' },
      intent: { reserveTransactionId: null, captureTransactionId: null, refundTransactionId: null } })
    const h = controller({ agentApi: { get: async () => ok(value), create: async () => { throw Error('unexpected payment') } } })
    const wrapper = await show(hostingPersona({ bound: true, boundToMe: true, agentId: 'agt_server_proposal' }))
    expect(wrapper.text()).to.include('保留的托管权益')
    expect(wrapper.text()).to.include('原结算记录已归档')
    expect(wrapper.text()).not.to.include('已付 0文')
    expect(wrapper.text()).not.to.include('预留流水')
    expect(h.requests).to.have.length(0)
  })

  for (const selected of ['local', 'server']) {
    it(`shows authoritative self-host price and blocks mismatched ${selected} selection`, async () => {
      controller({ agentApi: {
        create: async () => ok(hostingQuote({ planId: 'agent-self-hosted', amountWen: '200', recurringAmountWen: '50',
          initialSkillCount: '3', initialSkillAmountWen: '150', periodSeconds: '2592000' })),
        get: async () => ok(hostingLookup())
      } })
      const wrapper = await show(hostingPersona(), { requestedMode: selected })
      expect(wrapper.text()).to.include('报价部署方式：自行部署')
      expect(wrapper.text()).to.include('本次合计：200文 / 30 天')
      expect(wrapper.text()).to.include('正常租费：50文 / 30 天')
      expect(button(wrapper, '确认此报价').element.disabled).to.equal(selected !== 'local')
      expect(wrapper.text().includes('不能确认此报价')).to.equal(selected !== 'local')
    })
  }

})
