import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { parse as parseSfc } from '@vue/compiler-sfc'
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
