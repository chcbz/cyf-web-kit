import { expect } from 'chai'
import { describe, it } from 'mocha'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import * as content from '../src/content/hallHelp.js'
import { useHelpFeedback } from '../src/composables/useHelpFeedback.js'
import { resolveHallNavigationPresentation } from '../src/composables/juyiting/useHallPanels.js'

const load = ({ post = async () => ({}), globalStore = Vue.reactive({ getJiacn: 'user-a' }), apiStore = Vue.reactive({ authorizationGeneration: 1 }) } = {}) => {
  const filename = new URL('../src/components/juyiting/HallHelpCenter.vue', import.meta.url).pathname
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const code = compileScript(descriptor, { id: 'hall-help-test', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?\s*$/gm, (_line, names) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue`)
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]@\/[^'"]+['"];?\s*$/gm, (_line, names) => `const { ${names} } = deps`)
    .replace('export default', 'return')
  return new Function('Vue', 'deps', code)(Vue, { ...content, kefuApi: { post }, useHelpFeedback, useGlobalStore: () => globalStore, useApiStore: () => apiStore })
}
const mountHelp = (options, props = {}) => mount(load(options), { props, global: { stubs: { 'var-icon': true } } })
const clickText = async (wrapper, label) => {
  const button = wrapper.findAll('button').find(button => button.text().includes(label))
  expect(button, label).to.not.equal(undefined)
  await button.trigger('click')
  await flushPromises()
}
const settle = async () => { await flushPromises(); await Vue.nextTick() }

describe('JUYITING-HELP-20261109 help content and navigation', () => {
  it('covers approved categories and synonyms without inventing business actions', () => {
    expect(new Set(content.hallHelpArticles.map(a => a.id)).size).to.equal(9)
    for (const category of content.hallHelpCategories) expect(content.searchHallHelp('', category)).not.to.be.empty
    expect(content.searchHallHelp(' 机器人 ')[0].id).to.equal('agent')
    expect(content.searchHallHelp('任务').map(a => a.id)).to.include('progress')
    expect(content.searchHallHelp('文件').map(a => a.id)).to.include('result')
    expect(content.searchHallHelp('AGENT')[0].id).to.equal('agent')
    expect(content.searchHallHelp('not-found')).to.deep.equal([])
    for (const article of content.hallHelpArticles) expect(['overview', 'tasks', 'treasure', 'agents', 'messages', 'account']).to.include(article.target)
  })
  it('searches, reads and returns with the search preserved; displays empty state', async () => {
    const w = mountHelp()
    try {
      await w.find('input[type="search"]').setValue('机器人')
      expect(w.findAll('.help-row')).to.have.length(1)
      await w.find('.help-row').trigger('click')
      expect(w.find('h1').text()).to.equal('怎样了解好汉能做什么？')
      expect(w.vm.canGoBack).to.equal(true)
      expect(w.vm.back()).to.equal(true)
      await settle()
      expect(w.find('input[type="search"]').element.value).to.equal('机器人')
      await w.find('input[type="search"]').setValue('not-found')
      expect(w.text()).to.include('还没有找到相关帮助')
      expect(w.vm.back()).to.equal(false)
    } finally { w.unmount() }
  })
  it('filters topics and clears the topic independently of text', async () => {
    const w = mountHelp()
    try {
      await clickText(w, '资料与引用')
      expect(w.findAll('.help-row')).to.have.length(1)
      expect(w.find('.help-row').text()).to.include('补充参考资料')
      await clickText(w, '查看全部')
      expect(w.findAll('.help-row')).to.have.length(4)
    } finally { w.unmount() }
  })
  it('only emits navigation or replay; never submits feedback on page actions', async () => {
    const calls = []
    const w = mountHelp({ post: (...args) => calls.push(args) })
    try {
      await clickText(w, '重看新手引导')
      expect(w.emitted('replay')).to.have.length(1)
      await clickText(w, '阅读入门指南')
      await clickText(w, '先看看办事页')
      expect(w.emitted('navigate')[0]).to.deep.equal(['overview'])
      expect(calls).to.have.length(0)
    } finally { w.unmount() }
  })
  it('keeps read state when a child business panel hides it and blocks disabled account navigation', async () => {
    const w = mountHelp({}, { accountEntryDisabled: true })
    try {
      await w.find('input[type="search"]').setValue('账户')
      await w.find('.help-row').trigger('click')
      const title = w.find('h1').text()
      expect(w.find('button.primary').attributes('disabled')).to.not.equal(undefined)
      await w.setProps({ active: false }); await w.setProps({ active: true })
      expect(w.find('h1').text()).to.equal(title)
      expect(w.emitted('navigate')).to.equal(undefined)
    } finally { w.unmount() }
  })
  it('gives the existing Hall header sole ownership of article and feedback return', () => {
    for (const mobile of [true, false]) {
      for (const panelReturnPanel of ['', 'mine']) {
        const nav = resolveHallNavigationPresentation({ isMobileCoarse: mobile, isOverviewHome: true, experienceMode: 'portrait-command', renderedPanel: 'help', panelReturnPanel, helpCanGoBack: true })
        expect(nav.showHallReturn).to.equal(true)
        expect(nav.showHallClose).to.equal(false)
        expect(nav.showRootReturn).to.equal(false)
        expect(nav.showWorkbenchDock).to.equal(false)
      }
    }
    const hall = readFileSync(new URL('../src/components/world/JuyiHall.vue', import.meta.url), 'utf8')
    expect(hall).to.include('@help="openHelp"')
    expect(hall).to.include('v-show="!helpReplayVisible"')
    expect(hall).to.include("renderedPanel: helpReplayVisible.value ? '' : renderedPanel.value")
    expect(hall).to.include("panelFrames.includes('help')")
    expect(hall).to.include("renderedPanel.value === 'help' ? helpPanelRef.value")
    expect(hall).to.include("@replay=\"emit('open-onboarding', $event)\"")
    expect(hall).to.include("const openHelp = invoker => openPanel('help', { returnFocusTarget: invoker })")
  })
})

describe('JUYITING-HELP-20261109 shared feedback boundary', () => {
  it('sends only explicit fields through the existing adapter and reports actual success', async () => {
    const calls = []
    const w = mountHelp({ post: async (...args) => { calls.push(args); return {} } })
    try {
      await clickText(w, '反馈问题')
      expect(w.find('button[type="submit"]').attributes('disabled')).to.not.equal(undefined)
      await w.find('textarea').setValue('  找不到成果  ')
      await w.find('input[type="email"]').setValue('a@example.com')
      await w.find('form').trigger('submit'); await settle()
      expect(calls).to.have.length(1)
      expect(calls[0][0]).to.equal('/message/create')
      expect(Object.fromEntries(calls[0][1].entries())).to.deep.equal({ resourceId: 'help-center', jiacn: 'user-a', title: '聚义厅使用帮助：使用问题', content: '找不到成果', name: '', phone: '', email: 'a@example.com' })
      expect(calls[0][2].signal).to.be.instanceOf(AbortSignal)
      expect(w.text()).to.include('反馈已提交')
      expect(w.find('textarea').element.value).to.equal('')
      await w.find('textarea').setValue('另一个问题')
      expect(w.find('button[type="submit"]').attributes('disabled')).to.equal(undefined)
    } finally { w.unmount() }
  })
  it('preserves rejected feedback and allows explicit correction, without automatic retries', async () => {
    let calls = 0
    const w = mountHelp({ post: async () => { calls++; throw Object.assign(new Error('reject'), { status: 400 }) } })
    try {
      await clickText(w, '反馈问题')
      await w.find('textarea').setValue('保留我的内容')
      await w.find('form').trigger('submit'); await settle()
      expect(w.find('textarea').element.value).to.equal('保留我的内容')
      expect(w.text()).to.include('未被受理')
      expect(calls).to.equal(1)
      expect(w.find('button[type="submit"]').attributes('disabled')).to.equal(undefined)
      w.vm.back(); await settle(); await clickText(w, '反馈问题')
      expect(w.find('textarea').element.value).to.equal('保留我的内容')
    } finally { w.unmount() }
  })
  it('does not resend an uncertain write and preserves the draft', async () => {
    let calls = 0
    const w = mountHelp({ post: async () => { calls++; throw new TypeError('network') } })
    try {
      await clickText(w, '反馈问题'); await w.find('textarea').setValue('结果未知')
      await w.find('form').trigger('submit'); await settle()
      expect(w.text()).to.include('结果暂未确认')
      expect(w.find('fieldset').attributes('disabled')).not.to.equal(undefined)
      await w.find('form').trigger('submit'); await settle()
      expect(calls).to.equal(1)
      expect(w.find('textarea').element.value).to.equal('结果未知')
    } finally { w.unmount() }
  })
  it('disables repeated submission while pending and ignores a stale response after identity change', async () => {
    let resolve, request, calls = 0
    const apiStore = Vue.reactive({ authorizationGeneration: 1 })
    const w = mountHelp({ apiStore, post: (...args) => { calls++; request=args; return new Promise(done => { resolve=done }) } })
    try {
      await clickText(w, '反馈问题'); await w.find('textarea').setValue('旧身份内容')
      await w.find('form').trigger('submit'); await w.find('form').trigger('submit')
      expect(calls).to.equal(1)
      apiStore.authorizationGeneration++
      await settle()
      expect(request[2].signal.aborted).to.equal(true)
      expect(w.find('input[type="search"]').exists()).to.equal(true)
      resolve({}); await settle(); await clickText(w, '反馈问题')
      expect(w.find('textarea').element.value).to.equal('')
      expect(w.text()).not.to.include('反馈已提交')
    } finally { w.unmount() }
  })
  it('aborts a pending readback on unmount without claiming the server write was cancelled', async () => {
    let request, resolve
    const w = mountHelp({ post: (...args) => { request=args; return new Promise(done => { resolve=done }) } })
    await clickText(w, '反馈问题'); await w.find('textarea').setValue('待返回')
    await w.find('form').trigger('submit')
    w.unmount()
    expect(request[2].signal.aborted).to.equal(true)
    resolve({}); await settle()
  })
})
