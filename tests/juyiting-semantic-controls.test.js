import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { parse as parseSfc, compileScript } from '@vue/compiler-sfc'
import postcss from 'postcss'

const source = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
const css = postcss.parse(source('styles/hall-controls.css'))
const declarations = selector => {
  const result = {}
  css.walkRules(rule => {
    if (rule.selector.split(',').map(value => value.trim()).includes(selector)) {
      rule.walkDecls(decl => { result[decl.prop] = decl.value })
    }
  })
  return result
}

describe('Hall semantic presentation contract', () => {
  it('opts tools in explicitly with a 44px box and never rewrites every page button', () => {
    for (const selector of ['.hall-tool.hall-tool', '.hall-row-link.hall-row-link']) {
      expect(declarations(selector)).to.include({ width: '44px', 'min-width': '44px', 'min-height': '44px', padding: '0' })
    }
    css.walkRules(rule => expect(rule.selector).not.to.match(/(^|,)\s*button(?:\s|:|$)/))
    expect(source('main.js')).to.include("import './styles/hall-controls.css'")
  })
  it('draws on/off tracks and native checkbox switches with an explicit keyboard focus', () => {
    expect(declarations('.hall-switch-track')).to.include({ width: '40px', height: '24px' })
    expect(declarations('.hall-switch-control[aria-checked="true"] .hall-switch-track')).to.include({ background: '#923f30' })
    expect(declarations('.hall-switch-input.hall-switch-input:checked::after')).to.include({ transform: 'translateX(16px)' })
    expect(declarations('.hall-switch-input.hall-switch-input:focus-visible')).to.have.property('outline')
    const { descriptor } = parseSfc(source('components/juyiting/HallVoiceControls.vue'))
    expect(descriptor.template.content.match(/type="checkbox" role="switch"/g)).to.have.length(2)
    expect(descriptor.template.content).to.include('voice.setReplyVoiceEnabled($event.target.checked)')
  })
  it('keeps the fixed-version selector and download tool in one shrinkable row', () => {
    const { descriptor } = parseSfc(source('components/workspace/PersonalWorkspace.vue'))
    const styles = postcss.parse(descriptor.styles.map(style => style.content).join('\n'))
    let row, label, select
    styles.walkRules(rule => {
      if (rule.selector === '.treasure-version-tools') row = rule.toString()
      if (rule.selector === '.treasure-version-tools label') label = rule.toString()
      if (rule.selector === '.treasure-version-tools select') select = rule.toString()
    })
    expect(row).to.include('flex-wrap: nowrap')
    expect(label).to.include('min-width: 0').and.include('margin: 0')
    expect(select).to.include('min-width: 0')
    expect(descriptor.template.content).to.include('@change="preview(selectedVersion)"').and.include('@click="download(selectedVersion)"')
  })
  it('uses the brand auth shell with reduced-motion support, not simulated success steps', () => {
    const { descriptor } = parseSfc(source('components/OAuthCallback.vue'))
    expect(descriptor.template.content).to.include('oauth-brand__seal').and.include(':aria-busy="processing"')
    expect(descriptor.styles[0].content).to.include('prefers-reduced-motion: reduce').and.include('100svh')
    expect(descriptor.scriptSetup.content).to.include('processOAuthCallback({').and.include('scrubQuery:')
    expect(descriptor.scriptSetup.content).not.to.include('setTimeout')
  })
})


describe('OAuth callback real App shell', () => {
  it('uses the existing public-entry layout only on the callback and restores the ordinary shell', async () => {
    const Vue = await import('vue')
    const { mount } = await import('@vue/test-utils')
    const callback = source('router/index.js').match(/path: '\/oauth2\/callback',[\s\S]*?meta: (\{[^}]+\})/)
    expect(callback, 'actual callback route metadata').not.to.equal(null)
    const meta = new Function(`return (${callback[1]})`)()
    expect(meta.publicEntry).to.equal(true)
    const route = Vue.reactive({ meta: {} })
    const store = Vue.reactive({ showAppBar: true, showSideMenu: false, showBack: false, showMore: true, title: '聚义厅' })
    const { descriptor } = parseSfc(source('App.vue'))
    const imports = {
      vue: { ...Vue, defineAsyncComponent: () => ({ template: '<aside class="test-side-menu" />' }) },
      'vue-router': { useRoute: () => route },
      '@/stores/global': { useGlobalStore: () => store },
      '@/utils/pwa': {
        usePwaState: () => ({ hasUpdate: Vue.ref(true), isInstallable: Vue.ref(true), isOfflineReady: Vue.ref(true) }),
        applyAppUpdate: () => {}, dismissOfflineReady: () => {}, promptInstall: () => {}
      }
    }
    const compiled = compileScript(descriptor, { id: 'auth-real-app-shell', inlineTemplate: true }).content
      .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_all, names, path) =>
        `const { ${names.split(',').map(name => name.trim().replace(/\s+as\s+/, ': ')).join(', ')} } = imports[${JSON.stringify(path)}]`)
      .replaceAll('import.meta.env.VITE_APP_TITLE', "'CYF'").replace('export default', 'return')
    const App = new Function('imports', compiled)(imports)
    const wrapper = mount(App, { global: { stubs: {
      'var-app-bar': { template: '<header class="test-app-bar"><slot /><slot name="right" /></header>' },
      'var-icon': true, 'router-view': { template: '<main class="test-route-page">页面</main>' }
    } } })
    try {
      const checkShell = visible => {
        expect(wrapper.find('.test-app-bar').exists()).to.equal(visible)
        expect(wrapper.find('.test-side-menu').exists()).to.equal(visible)
        expect(wrapper.find('.pwa-banner').exists()).to.equal(visible)
        expect(wrapper.find('.app-content').classes().includes('public-entry')).to.equal(!visible)
        expect(wrapper.find('.test-route-page').exists()).to.equal(true)
      }
      checkShell(true)
      route.meta = meta
      await Vue.nextTick()
      checkShell(false)
      route.meta = {}
      await Vue.nextTick()
      checkShell(true)
    } finally { wrapper.unmount() }
  })
})
