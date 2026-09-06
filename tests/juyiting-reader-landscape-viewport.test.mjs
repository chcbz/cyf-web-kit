import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const readerStyles = () => {
  const source = readFileSync('src/components/juyiting/archive/ArchiveReader.vue', 'utf8')
  const match = source.match(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/)
  assert.ok(match, 'ArchiveReader must provide styles')
  return match[1]
}

const renderLandscapeReader = () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'juyiting-reader-landscape-'))
  const fixturePath = join(fixtureDir, 'reader.html')
  const profilePath = join(fixtureDir, 'chromium-profile')
  const filler = '<p>梁山泊案卷正文，用以验证横屏时内容区域保有独立滚动空间。</p>'.repeat(80)
  const notes = '<p>手札内容，用以验证底部操作不会被横屏固定阅读器裁切。</p>'.repeat(50)
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
${readerStyles()}
</style></head><body>
<section class="archive-reader-fullscreen">
  <header class="reader-header"><div><p class="reader-kicker">固定典籍</p><h3>水滸傳</h3></div><div class="reader-header-actions"><button>目录</button><button>返回典籍列表</button></div></header>
  <div class="reader-layout">
    <article id="content" class="reader-content"><div class="reader-actions"><button>上一回</button><button>下一回</button><button>书签</button></div>${filler}</article>
    <aside id="notes" class="reader-notes">${notes}<button id="last-action">保存手札</button></aside>
  </div>
</section>
<pre id="result"></pre><script>
const dialog = document.querySelector('.archive-reader-fullscreen')
const content = document.querySelector('#content')
const notes = document.querySelector('#notes')
const action = document.querySelector('#last-action')
notes.scrollTop = notes.scrollHeight
const dialogRect = dialog.getBoundingClientRect()
const notesRect = notes.getBoundingClientRect()
const actionRect = action.getBoundingClientRect()
document.querySelector('#result').textContent = JSON.stringify({
  dialog: { width: dialogRect.width, height: dialogRect.height, clientHeight: dialog.clientHeight, scrollHeight: dialog.scrollHeight },
  content: { clientHeight: content.clientHeight, scrollHeight: content.scrollHeight },
  notes: { clientHeight: notes.clientHeight, scrollHeight: notes.scrollHeight, scrollTop: notes.scrollTop },
  actionVisible: actionRect.top >= notesRect.top && actionRect.bottom <= notesRect.bottom
})
</script></body></html>`
  try {
    writeFileSync(fixturePath, html)
    const output = execFileSync(process.env.CHROME_PATH || '/usr/bin/chromium-browser', [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--window-size=844,390', '--virtual-time-budget=1000',
      `--user-data-dir=${profilePath}`, '--dump-dom', `file://${fixturePath}`
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 })
    const result = output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]
    assert.ok(result, 'headless browser must report reader geometry')
    return JSON.parse(result)
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true })
  }
}

describe('Juyi Hall archive reader in a short landscape viewport', () => {
  const geometry = renderLandscapeReader()

  it('fits the real 844×390 viewport without page clipping', () => {
    assert.equal(geometry.dialog.width, 844)
    assert.equal(geometry.dialog.height, 390)
    assert.equal(geometry.dialog.clientHeight, 390)
    assert.equal(geometry.dialog.scrollHeight, 390)
  })

  it('keeps reading and notes independently scrollable and reaches the bottom action', () => {
    assert.ok(geometry.content.scrollHeight > geometry.content.clientHeight)
    assert.ok(geometry.notes.scrollHeight > geometry.notes.clientHeight)
    assert.ok(geometry.notes.scrollTop > 0)
    assert.equal(geometry.actionVisible, true)
  })
})
