import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { parse, compileScript } from '@vue/compiler-sfc'
import { formatWen } from '../src/utils/wenAmount.js'

const source = readFileSync(new URL('../src/components/Wallet.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, { id: 'wallet-test', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_all, names, path) =>
    `const { ${names.split(',').map(n => n.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
  .replace('export default', 'return')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }
const money = amountMinor => ({ currency: 'WEN', amountMinor })
const balance = amount => ({ available: money(amount), held: money('1') })
let wrapper
const setup = ({ get, capability = async () => true } = {}) => {
  const store = Vue.reactive({ authorizationGeneration: 0 })
  const calls = []
  const component = new Function('imports', compiled)({
    vue: Vue,
    '@/stores/api': { useApiStore: () => store },
    '@/utils/wenAmount': { formatWen },
    '@/utils/economyPreviewCapability': { isEconomyPreviewCapability: value => value === true, loadEconomyPreviewCapability: capability },
    '@/composables/useHttp': { economyApi: { get: (...args) => { calls.push(args); return get ? get(...args) : Promise.resolve(args[0] === '/wallet' ? balance('3499') : { items: [] }) } } }
  })
  wrapper = mount(component, { global: { stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } } })
  return { store, calls }
}
afterEach(() => wrapper?.unmount())

describe('personal center wallet', () => {
  it('shows real integer wen, held balance, empty ledger and return link without a preview build flag', async () => {
    const { calls } = setup()
    await flushPromises()
    expect(wrapper.text()).to.include('3499文').and.include('1文').and.include('暂无收支记录')
    expect(wrapper.find('a[href="/profile"]').text()).to.equal('返回个人中心')
    expect(calls.map(c => c[0])).to.deep.equal(['/wallet', '/ledger'])
    expect(source).not.to.include('VITE_ECONOMY_PREVIEW_ENABLED')
  })
  it('shows loading, then a recoverable error instead of fake zero', async () => {
    const pending = deferred()
    let fail = true
    setup({ capability: () => pending.promise, get: path => fail ? Promise.reject(new Error('读取失败')) : Promise.resolve(path === '/wallet' ? balance('3499') : { items: [] }) })
    await Vue.nextTick()
    expect(wrapper.text()).to.include('正在核对钱袋')
    pending.resolve(true)
    await flushPromises()
    expect(wrapper.text()).to.include('读取失败').and.not.include('0文')
    fail = false
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).to.include('3499文')
  })
  it('keeps server-disabled state visible without issuing money reads', async () => {
    const { calls } = setup({ capability: async () => false })
    await flushPromises()
    expect(wrapper.text()).to.include('钱包暂未开放')
    expect(calls).to.have.length(0)
    expect(wrapper.find('button').text()).to.equal('重试')
  })
  it('clears old identity and ignores a late wallet result on account switch', async () => {
    const old = deferred()
    let sequence = 0
    const { store } = setup({ get: path => path === '/ledger' ? Promise.resolve({ items: [] }) : ++sequence === 1 ? old.promise : Promise.resolve(balance('123')) })
    await flushPromises()
    store.authorizationGeneration += 1
    await flushPromises()
    expect(wrapper.text()).to.include('123文')
    old.resolve(balance('9999'))
    await flushPromises()
    expect(wrapper.text()).to.include('123文').and.not.include('9999文')
  })
  it('formats known transaction names and preserves unknown business facts', async () => {
    setup({ get: path => Promise.resolve(path === '/wallet' ? balance('3499') : { items: [
      { entryId: '1', businessType: 'ISSUE_WEN', direction: 'CREDIT', amount: money('3500'), postedAt: 0 },
      { entryId: '2', businessType: 'CAPTURE_TASK', direction: 'DEBIT', amount: money('1'), postedAt: 0 },
      { entryId: '3', businessType: 'FUTURE_TYPE', direction: 'CREDIT', amount: money('2'), postedAt: 0 }
    ] }) })
    await flushPromises()
    expect(wrapper.text()).to.include('活动赠送').and.include('事项扣款').and.include('FUTURE_TYPE')
  })
  it('does not bounce the wallet route through a preview guard', () => {
    const routes = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8')
    const walletRoute = routes.slice(routes.indexOf("path: '/wallet'"), routes.indexOf("path: '/skill-market'"))
    expect(walletRoute).not.to.include('beforeEnter')
    expect(walletRoute).not.to.include('publicEntry')
  })
})
