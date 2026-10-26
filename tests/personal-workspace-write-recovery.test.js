import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'mocha'
import * as Vue from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { mount } from '@vue/test-utils'
for (const name of ['Element', 'HTMLElement', 'SVGElement', 'Node']) {
  if (!globalThis[name] && globalThis.window?.[name]) Object.defineProperty(globalThis, name, { value: globalThis.window[name], configurable: true })
}
const { descriptor } = parse(readFileSync(new URL('../src/components/personal-workspace/WorkspaceWriteRecovery.vue', import.meta.url), 'utf8'))
const script = compileScript(descriptor, { id: 'workspace-recovery-test', inlineTemplate: true }).content
  .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_, names) => `var { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
  .replace('export default', 'return')
const component = new Function('Vue', script)(Vue)
describe('workspace write recovery presentation', () => {
  it('labels retry as a write retry, disables in-flight retry and discloses page lifetime', async () => {
    const wrapper = mount(component, { props: { pending: [{ target: 'original', label: '重命名', state: 'UNKNOWN' }] } })
    try {
      assert.match(wrapper.text(), /提交结果尚未确认/)
      assert.match(wrapper.text(), /刷新后将无法在此继续恢复/)
      assert.equal(wrapper.get('button').text(), '继续原操作')
      await wrapper.get('button').trigger('click')
      assert.deepEqual(wrapper.emitted('retry'), [['original']])
      await wrapper.setProps({ pending: [{ target: 'original', label: '重命名', state: 'SENDING' }] })
      assert.equal(wrapper.get('button').element.disabled, true)
      await wrapper.setProps({ pending: [] }); assert.equal(wrapper.find('section').exists(), false)
    } finally { wrapper.unmount() }
  })
})
