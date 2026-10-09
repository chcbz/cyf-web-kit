import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import * as Vue from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { compileScript, parse } from '@vue/compiler-sfc'
import { abandonmentCommand, useHallExecutionAbandonment } from '../src/composables/juyiting/useHallExecutionAbandonment.js'

const filename = new URL('../src/components/juyiting/BountyExecutionTermination.vue', import.meta.url).pathname
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'execution-abandonment-dom', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm,
    (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"][^'"]+useHallExecutionAbandonment.js['"];?\s*$/gm,
    (_, names) => `var { ${names} } = deps`)
  .replace('export default', 'return')
const request = () => ({ requestId: 'request-1', conversationId: '42', state: 'RUNNING', stateVersion: '0',
  steps: [{ stepId: 'step-1', executionId: 'execution-1', kind: 'EXECUTE', state: 'RUNNING', stateVersion: '2', executionState: 'RUNNING' }] })
const receipt = () => ({ operationId: 'a'.repeat(64), conversationId: '42', requestId: 'request-1', stepId: 'step-1', executionId: 'execution-1',
  state: 'CANCELLED', requestStateVersion: '1', stepStateVersion: '3', reason: 'OWNER_ABANDONED_UNDELIVERED',
  providerAlreadyStarted: true, providerStopped: false, paidFactsPreserved: true })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const mountPanel = (execute = async () => receipt(), props = {}) => {
  const calls = []; const store = new Map()
  const Component = new Function('Vue', 'deps', script)(Vue, { abandonmentCommand,
    useHallExecutionAbandonment: options => useHallExecutionAbandonment({ ...options,
      storage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
      idempotencyKeyFactory: () => 'original-abandon-key',
      api: { execute: async options => { calls.push(options); return execute(options, calls.length) } } }) })
  const original = request()
  const wrapper = mount(Component, { props: { enabled: true, conversationId: '42', identityKey: 'owner-a', requests: [original], ...props } })
  return { wrapper, calls, store, original }
}
const button = (wrapper, text) => wrapper.findAll('button').find(node => node.text() === text)

describe('real execution abandonment SFC DOM with original-intent composable', () => {
  it('shows explicit paid/Provider warning, submits exact command and emits only a receipt hint without mutating a request', async () => {
    const { wrapper, calls, original } = mountPanel()
    try {
      expect(wrapper.get('aside').attributes('aria-label')).to.equal('未交付执行处理')
      expect(wrapper.text()).to.include('不会撤销已发生的生成费用').and.include('也不表示服务商已停止执行')
      expect(calls).to.deep.equal([])
      await button(wrapper, '放弃本轮未交付结果').trigger('click'); await flushPromises()
      expect(calls.length).to.equal(1); expect(calls[0].data).to.deep.equal(abandonmentCommand(original, '42'))
      expect(wrapper.emitted('settled')).to.deep.equal([[receipt()]])
      expect(original).to.deep.equal(request())
      expect(button(wrapper, '放弃本轮未交付结果').element.disabled).to.equal(true)
      expect(wrapper.find('[role="status"]').text()).to.include('本轮未交付结果已放弃')
    } finally { wrapper.unmount() }
  })
  it('blocks repeat writes while pending and exposes recovery actions after an unknown response', async () => {
    const pending = deferred(); const { wrapper, calls } = mountPanel(() => pending.promise)
    try {
      await button(wrapper, '放弃本轮未交付结果').trigger('click')
      expect(wrapper.findAll('button').every(node => node.element.disabled)).to.equal(true)
      expect(calls.length).to.equal(1)
      pending.resolve({ invalid: true }); await flushPromises()
      expect(button(wrapper, '放弃本轮未交付结果')).to.equal(undefined)
      expect(button(wrapper, '查询原操作结果').element.disabled).to.equal(false)
      expect(button(wrapper, '继续原放弃操作').element.disabled).to.equal(false)
      expect(wrapper.emitted('settled')).to.equal(undefined)
      expect(wrapper.find('[role="alert"]').exists()).to.equal(true)
    } finally { wrapper.unmount() }
  })
  it('unknown result queries only the original operation and emits confirmed receipt once', async () => {
    const { wrapper, calls } = mountPanel(async (_options, count) => {
      if (count === 1) throw new TypeError('lost response')
      return receipt()
    })
    try {
      await button(wrapper, '放弃本轮未交付结果').trigger('click'); await flushPromises()
      await button(wrapper, '查询原操作结果').trigger('click'); await flushPromises()
      expect(calls.map(call => call.method)).to.deep.equal(['POST', 'GET'])
      expect(calls[1].headers).to.deep.equal(calls[0].headers)
      expect(calls[1]).not.to.have.property('data')
      expect(wrapper.emitted('settled')).to.deep.equal([[receipt()]])
    } finally { wrapper.unmount() }
  })
  it('an explicit continue button preserves the original key/body and never generates again', async () => {
    const { wrapper, calls } = mountPanel(async (_options, count) => {
      if (count === 1) throw new TypeError('lost response')
      return receipt()
    })
    try {
      await button(wrapper, '放弃本轮未交付结果').trigger('click'); await flushPromises()
      await button(wrapper, '继续原放弃操作').trigger('click'); await flushPromises()
      expect(calls.map(call => call.method)).to.deep.equal(['POST', 'POST'])
      expect(calls[1].headers).to.deep.equal(calls[0].headers); expect(calls[1].data).to.equal(calls[0].data)
      expect(calls.every(call => call.url.endsWith('/abandon-execution'))).to.equal(true)
    } finally { wrapper.unmount() }
  })
  for (const props of [{ enabled: false }, { identityKey: 'owner-b', requests: [] }, { conversationId: '43', requests: [] }]) {
    it(`ignores a late receipt when component scope changes: ${JSON.stringify(props)}`, async () => {
      const pending = deferred(); const { wrapper, calls } = mountPanel(() => pending.promise)
      try {
        await button(wrapper, '放弃本轮未交付结果').trigger('click')
        await wrapper.setProps(props)
        expect(calls[0].signal.aborted).to.equal(true)
        pending.resolve(receipt()); await flushPromises()
        expect(wrapper.emitted('settled')).to.equal(undefined)
        expect(wrapper.find('aside').exists()).to.equal(false)
      } finally { wrapper.unmount() }
    })
  }
  it('does not offer abandonment for delivered requests or when the capability is disabled', () => {
    for (const props of [{ enabled: false }, { requests: [{ ...request(), state: 'OUTPUT_COMMITTED' }] }]) {
      const { wrapper, calls } = mountPanel(undefined, props)
      try { expect(wrapper.find('aside').exists()).to.equal(false); expect(calls).to.deep.equal([]) } finally { wrapper.unmount() }
    }
  })
})
