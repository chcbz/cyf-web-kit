import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { mount, flushPromises } from '@vue/test-utils'
import * as Vue from 'vue'
import { richDocumentKind, richDocumentSource } from '../src/utils/richDocumentPreview.js'
import { outputPreviewKind } from '../src/composables/useOutputs.js'

function component (path, imports) {
  const { descriptor } = parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
  const code = compileScript(descriptor, { id: 'rich-preview-test', inlineTemplate: true }).content
    .replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, names, key) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = imports[${JSON.stringify(key)}]`)
    .replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?\s*$/gm, (_, name, key) => `const ${name} = imports[${JSON.stringify(key)}]`)
    .replace('export default', 'return')
  return new Function('imports', code)({ vue: Vue, ...imports })
}
const Rich = component('../src/components/outputs/RichDocumentPreview.vue', { '../../utils/richDocumentPreview.js': { richDocumentSource } })
const Preview = component('../src/components/outputs/OutputPreview.vue', {
  './RichDocumentPreview.vue': Rich, '../../utils/richDocumentPreview.js': { richDocumentKind },
  '../../composables/useOutputs.js': { outputPreviewKind }, '../workspace/PdfDocumentPreview.vue': { render: () => null }
})

describe('static HTML and Markdown file preview', () => {
  it('recognizes MIME and historical plain-text filename aliases, never unknown binary formats', () => {
    for (const [mime, name, kind] of [['text/html', '', 'html'], ['text/markdown', '', 'markdown'], ['text/plain', 'NOTES.MD', 'markdown'], ['application/octet-stream', 'report.htm', 'html'], ['application/pdf', 'report.html', '']]) assert.equal(richDocumentKind(mime, name), kind)
    for (const mimeType of ['text/html', 'text/markdown', 'text/x-markdown']) {
      assert.equal(outputPreviewKind({ mimeType, byteLength: 100 }), 'text')
      assert.equal(outputPreviewKind({ mimeType, byteLength: 1024 * 1024 + 1 }), 'none')
    }
  })
  it('renders real Markdown headings, table, lists, emphasis and fenced code', () => {
    const html = richDocumentSource('# 标题\n\n**重点**\n\n- 项目\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1\n```', 'markdown')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    for (const tag of ['h1', 'strong', 'ul', 'table', 'pre', 'code']) assert.ok(doc.querySelector(tag), tag)
  })
  for (const kind of ['html', 'markdown']) it(`removes active content, navigation and external images (${kind})`, () => {
    const source = richDocumentSource('<style>h1{color:red}</style><h1 onclick="alert(1)">标题</h1><script>parent.pwned=1</script><meta http-equiv="refresh" content="0;url=https://evil.invalid"><base href="https://evil.invalid"><iframe src="https://evil.invalid"></iframe><form action="https://evil.invalid"><input></form><a href="javascript:alert(1)">链接</a><img src="https://evil.invalid/a" onerror="alert(1)"><svg onload="alert(1)"></svg>', kind)
    const doc = new DOMParser().parseFromString(source, 'text/html')
    assert.equal(doc.querySelector('script,iframe,form,input,svg,base,link'), null)
    assert.equal(doc.querySelector('[onclick],[onerror],[onload],[href]'), null)
    assert.equal(doc.querySelector('img')?.hasAttribute('src'), false)
    assert.ok(doc.querySelector('h1')); assert.ok(doc.querySelector('style'))
    const policy = doc.querySelector('[http-equiv="Content-Security-Policy"]').content
    assert.match(policy, /default-src 'none'/); assert.match(policy, /script-src 'none'/); assert.match(policy, /base-uri 'none'/)
    assert.equal(doc.querySelectorAll('[http-equiv="refresh"]').length, 0)
  })
  it('uses an opaque sandbox, has an empty state and changes content on switching files', async () => {
    const wrapper = mount(Rich, { props: { text: '# Hello', kind: 'markdown', title: 'notes.md' } })
    try {
      assert.equal(wrapper.get('iframe').attributes('sandbox'), '')
      assert.equal(wrapper.get('iframe').attributes('referrerpolicy'), 'no-referrer')
      assert.match(wrapper.get('iframe').attributes('srcdoc'), /<h1>Hello<\/h1>/)
      await wrapper.setProps({ text: '<p>new</p>', kind: 'html' })
      assert.match(wrapper.get('iframe').attributes('srcdoc'), /<p>new<\/p>/)
      assert.doesNotMatch(wrapper.get('iframe').attributes('srcdoc'), /<h1>Hello/)
      await wrapper.setProps({ text: '' }); assert.equal(wrapper.find('iframe').exists(), false); assert.match(wrapper.text(), /为空/)
    } finally { wrapper.unmount() }
  })
  for (const mimeType of ['text/html', 'text/markdown']) it(`uses the actual output renderer for ${mimeType}`, async () => {
    const wrapper = mount(Preview, { props: { item: { artifactId: 'a', artifactVersion: '1', title: '文件', mimeType, byteLength: 10 }, load: async () => new Blob(['<h1>Title</h1>'], { type: mimeType }) } })
    try { await flushPromises(); assert.equal(wrapper.findComponent(Rich).exists(), true); assert.equal(wrapper.find('iframe').exists(), true) } finally { wrapper.unmount() }
  })
  it('does not show a stale output after the file context changes', async () => {
    let resolve
    const wrapper = mount(Preview, { props: { item: { artifactId: 'a', artifactVersion: '1', title: '旧', mimeType: 'text/html', byteLength: 1 }, load: () => new Promise(r => { resolve = r }) } })
    await wrapper.setProps({ item: null }); resolve(new Blob(['old'], { type: 'text/html' })); await flushPromises()
    assert.equal(wrapper.find('iframe').exists(), false); wrapper.unmount()
  })
})
