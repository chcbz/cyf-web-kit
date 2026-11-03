// Lightweight real-browser check: production sanitizer modules, no Vite/build.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { launchChrome, evaluate, stopChrome } from '../scripts/juyiting/e13/lib/cdp-harness.mjs'
const root = new URL('../', import.meta.url)
const server = createServer(async (request, response) => {
  const files = { '/renderer.js': 'src/utils/richDocumentPreview.js', '/marked.js': 'node_modules/marked/lib/marked.esm.js', '/purify.js': 'node_modules/dompurify/dist/purify.es.mjs' }
  if (!files[request.url]) { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'); return }
  let body = await readFile(new URL(files[request.url], root), 'utf8')
  if (request.url === '/renderer.js') body = body.replace("from 'marked'", "from '/marked.js'").replace("from 'dompurify'", "from '/purify.js'")
  response.setHeader('Content-Type', 'text/javascript'); response.end(body)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await launchChrome({ debugPort: Number(process.env.RICH_PREVIEW_CDP_PORT || 19496) })
const { cdp } = browser
const external = [], results = []
try {
  cdp.on('Fetch.requestPaused', async ({ requestId, request }) => { external.push(request.url); await cdp.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }) })
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*evil.invalid*' }] })
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
  await evaluate(cdp, `import('/renderer.js').then(m => { window.renderDocument=m.richDocumentSource })`)
  for (const width of [1440, 390, 320]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 760 })
    for (const kind of ['html', 'markdown']) {
      const content = `<style>@import url('https://evil.invalid/import');h1{color:rgb(12,34,56)}body{background-image:url('https://evil.invalid/css')}</style><h1 onclick="parent.pwned=1">安全标题</h1><script>parent.pwned=1;fetch('https://evil.invalid/script')</script><img src="https://evil.invalid/image" onerror="parent.pwned=1"><iframe src="https://evil.invalid/frame"></iframe><meta http-equiv="refresh" content="0;url=https://evil.invalid/nav"><form action="https://evil.invalid/post"><input></form><a href="https://evil.invalid/link" target="_top">链接</a><table><tr><th>A</th></tr><tr><td>表格</td></tr></table>`
      await evaluate(cdp, `(() => { window.pwned=0; document.body.innerHTML=''; const frame=document.createElement('iframe'); frame.setAttribute('sandbox',''); frame.style.cssText='width:100%;height:360px;box-sizing:border-box'; frame.srcdoc=renderDocument(${JSON.stringify(kind === 'markdown' ? '# Markdown 标题\n\n**重点**\n\n- 项目\n\n' + content : content)},${JSON.stringify(kind)}); document.body.append(frame) })()`)
      await new Promise(resolve => setTimeout(resolve, 250))
      const tree = await cdp.send('Page.getFrameTree')
      const child = tree.frameTree.childFrames?.[0]?.frame.id
      assert.ok(child, 'preview frame exists')
      const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: child, worldName: 'preview-inspection' })
      const inspect = async expression => (await cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true })).result.value
      assert.equal(await inspect("document.querySelector('h1').textContent.includes('标题')"), true)
      assert.equal(await inspect("getComputedStyle(document.querySelector('h1')).color"), 'rgb(12, 34, 56)')
      assert.equal(await inspect("!!document.querySelector('table') && !document.querySelector('script,iframe,form,[href],[onerror],[onclick]')"), true)
      if (kind === 'markdown') assert.equal(await inspect("!!document.querySelector('strong') && !!document.querySelector('ul')"), true)
      assert.equal(await evaluate(cdp, 'pwned'), 0)
      assert.equal(await evaluate(cdp, "document.querySelector('iframe').contentDocument === null"), true)
      assert.equal(await evaluate(cdp, 'document.documentElement.scrollWidth <= innerWidth'), true)
      assert.equal(external.length, 0, 'untrusted files must not issue external network requests, including during sanitization')
      results.push({ width, kind, formatted: true, inlineStyle: true, opaqueSandbox: true, noScript: true, noNetwork: true, noPageOverflow: true })
    }
  }
  console.log(JSON.stringify(results, null, 2))
  if (process.env.RICH_PREVIEW_RESULTS) await writeFile(process.env.RICH_PREVIEW_RESULTS, JSON.stringify(results, null, 2) + '\n')
} finally { cdp.close(); await stopChrome(browser.chrome, browser.userDataDir); await new Promise(resolve => server.close(resolve)) }
