import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { ref } from 'vue'

const require = createRequire(import.meta.url)
const { parse } = require('@vue/compiler-sfc')
const babel = require('@babel/parser')
const source = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
const script = parse(source, { filename: 'JuyiHall.vue' }).descriptor.scriptSetup.content
const declarations = babel.parse(script, { sourceType: 'module' }).program.body.flatMap(node => node.declarations || [])
const handler = name => {
  const node = declarations.find(item => item.id?.name === name)
  if (!node) throw new Error(`missing ${name}`)
  return script.slice(node.init.start, node.init.end)
}
const callback = (callee, property) => {
  const node = declarations.find(item => item.init?.callee?.name === callee)
  const option = node?.init?.arguments?.[0]?.properties?.find(item => item.key?.name === property)
  if (!option) throw new Error(`missing ${callee}.${property}`)
  return script.slice(option.value.start, option.value.end)
}

describe('actual JuyiHall F1 follow-up handlers', () => {
  it('routes explicit composer GENERATE and output-card EDIT only to the Hall follow-up composable', async () => {
    const enabled = ref(true); const draft = ref('画一只鸟'); const calls = []; const toasts = []
    const generate = new Function('followupExecuteEnabled', 'prepareFollowupGenerate', 'draft', 'showToast', `return (${handler('handleFollowupGenerate')})`)(enabled, async payload => { calls.push(['generate', payload]); return true }, draft, text => toasts.push(text))
    const edit = new Function('followupExecuteEnabled', 'prepareFollowupEdit', 'showToast', `return (${handler('handleFollowupEdit')})`)(enabled, async payload => { calls.push(['edit', payload]); return true }, text => toasts.push(text))
    expect(await generate()).to.equal(true)
    expect(await edit({ content: '改为黄昏', assetRef: { assetId: 'asset_fixture', revision: '1' }, continuationOf: { requestId: 'request_fixture', stepId: 'step_fixture' } })).to.equal(true)
    expect(calls).to.deep.equal([
      ['generate', { content: '画一只鸟' }],
      ['edit', { content: '改为黄昏', assetRef: { assetId: 'asset_fixture', revision: '1' }, continuationOf: { requestId: 'request_fixture', stepId: 'step_fixture' } }]
    ])
    expect(toasts).to.have.length(2)
  })

  it('does not route explicit F1 controls when their default-off flag is disabled', async () => {
    const enabled = ref(false); const draft = ref('画一只鸟'); let calls = 0
    const generate = new Function('followupExecuteEnabled', 'prepareFollowupGenerate', 'draft', 'showToast', `return (${handler('handleFollowupGenerate')})`)(enabled, async () => { calls++; return true }, draft, () => {})
    expect(await generate()).to.equal(false)
    expect(calls).to.equal(0)
  })

  it('uses the actual F1 admitted callback only as a catalog read hint, never a synthetic result', async () => {
    const calls = []; const toasts = []
    const onAdmitted = new Function('bountyRequestCatalog', 'showToast', `return (${callback('useHallBountyFollowup', 'onAdmitted')})`)({
      hint: () => { calls.push('hint'); return true }
    }, value => toasts.push(value))
    expect(await onAdmitted({ receipt: { requestId: 'request-f1' }, isCurrent: () => true })).to.equal(true)
    expect(calls).to.deep.equal(['hint'])
    expect(toasts).to.deep.equal(['受控图像办理已受理（request-f1）；不会改走旧传令。'])
    expect(await onAdmitted({ receipt: { requestId: 'request-late' }, isCurrent: () => false })).to.equal(false)
    expect(calls).to.deep.equal(['hint'])
  })

})
