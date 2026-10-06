import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import { parse, compileStyle } from '@vue/compiler-sfc'
import postcss from 'postcss'

const cssUrl = new URL('../src/components/juyiting/hall-view-tabs.css', import.meta.url)
const css = readFileSync(cssUrl, 'utf8')
const groups = [
  ['juyiting/HallOverview.vue', '.hall-overview .overview-tabs', '[aria-pressed="true"]'],
  ['juyiting/LibraryPanel.vue', '.library-panel .library-tabs', '.active'],
  ['juyiting/HallDraftEditor.vue', '.hall-draft-editor .case-tabs', '[aria-pressed="true"]'],
  ['workspace/PersonalWorkspace.vue', '.personal-workspace.is-hall-treasure .treasure-tabs', '[aria-pressed="true"]']
]
const ast = postcss.parse(css)
function declarations(selector) {
  const result = {}
  ast.walkRules(rule => { if (rule.selectors.includes(selector)) rule.walkDecls(d => { result[d.prop] = d }) })
  return result
}
describe('shared capsule view tabs (style-only)', () => {
  for (const [component, group, selected] of groups) {
    it(`loads scoped capsule styling for ${component}`, () => {
      const url = new URL(`../src/components/${component}`, import.meta.url)
      const { descriptor } = parse(readFileSync(url, 'utf8'))
      const style = descriptor.styles.find(s => s.src?.endsWith('hall-view-tabs.css'))
      expect(style?.scoped).to.equal(true)
      expect(readFileSync(new URL(style.src, url), 'utf8')).to.equal(css)
      const compiled = compileStyle({ source: css, filename: cssUrl.pathname, id: 'data-v-capsule', scoped: true })
      expect(compiled.errors).to.deep.equal([])
      const tab = declarations(`${group} button`)
      expect(tab.border.value).to.equal('0')
      expect(tab.border.important).to.equal(true)
      expect(tab['border-radius'].value).to.equal('8px')
      expect(tab['min-height'].value).to.equal('44px')
      expect(tab.background.value).to.equal('transparent')
      const active = declarations(`${group} button${selected}`)
      expect(active.background.value).to.equal('#f7eae6')
      expect(active.background.important).to.equal(true)
      expect(active.color.value).to.equal('#923f30')
      expect(declarations(`${group} button:focus-visible`).outline.value).to.equal('2px solid #923f30')
      expect(declarations(group)['border-bottom'].value).to.equal('0')
    })
  }
  it('does not target global buttons, main navigation or action filters', () => {
    ast.walkRules(rule => rule.selectors.forEach(selector => {
      expect(groups.some(([, group]) => selector.startsWith(group))).to.equal(true)
    }))
  })
})
