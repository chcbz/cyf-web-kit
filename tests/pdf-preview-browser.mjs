/** Targeted dev-server diagnostic: real Vue/PDF.js worker and bundled font assets; no API/Agent. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { writeFile, mkdir } from 'node:fs/promises'
import { pdfFixture } from './fixtures/pdf/document.mjs'
import { launchChrome, evaluate, waitForExpression, stopChrome } from '../scripts/juyiting/e13/lib/cdp-harness.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const fixtures = { real: pdfFixture().toString('base64'), password: pdfFixture({ encrypted: true }).toString('base64'), invalid: Buffer.from('broken PDF').toString('base64') }
const page = `<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app" style="width:100%;max-width:700px"></div><script type="module">
import { createApp, h, ref } from '/node_modules/.vite/deps/vue.js'
import Viewer from '/src/components/workspace/PdfDocumentPreview.vue'
const fixtures=${JSON.stringify(fixtures)}; const blob = ref(null);const show = ref(false)
window.changePDF = key => { blob.value = new Blob([Uint8Array.from(atob(fixtures[key]), c=>c.charCodeAt(0))], {type:'application/pdf'});show.value=true }
window.removePDF = () => { show.value=false;blob.value=null }
createApp({render:()=>show.value?h(Viewer,{blob:blob.value}):null}).mount('#app');window.changePDF('real')
</script>`
const server = await createServer({ configFile: false, root, plugins: [vue(), { name: 'pdf-diagnostic', configureServer(server) {
  server.middlewares.use('/pdf-diagnostic', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(page) })
} }], resolve: { alias: { '@': `${root}/src` } }, server: { host: '127.0.0.1', port: 18592, strictPort: true }, optimizeDeps: { include: ['vue', 'pdfjs-dist/legacy/build/pdf.mjs'] } })
let browser
const errors = [], requests = []
try {
  await server.listen(); browser = await launchChrome({ debugPort: 19592 })
  const { cdp } = browser
  cdp.on('Runtime.exceptionThrown', value => errors.push(value.exceptionDetails?.exception?.description || value.exceptionDetails?.text))
  cdp.on('Network.requestWillBeSent', value => requests.push(value.request.url))
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:18592/pdf-diagnostic' })
  await waitForExpression(cdp, `document.querySelector('canvas')?.getAttribute('aria-label') === 'PDF 第 1 页' && document.querySelector('canvas')?.style.display !== 'none'`, 90000)
  assert.ok(await evaluate(cdp, `document.querySelector('canvas').width > 0`))
  await evaluate(cdp, `document.querySelectorAll('button')[1].click()`)
  await waitForExpression(cdp, `document.querySelector('canvas')?.getAttribute('aria-label') === 'PDF 第 2 页' && document.querySelector('canvas')?.style.display !== 'none'`, 90000)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 780, deviceScaleFactor: 1, mobile: true })
  await waitForExpression(cdp, `document.querySelector('canvas')?.width <= 320`)
  assert.ok(await evaluate(cdp, `document.documentElement.scrollWidth <= window.innerWidth`))
  await evaluate(cdp, `window.changePDF('password')`)
  await waitForExpression(cdp, `document.querySelector('[role=alert]')?.textContent.includes('密码')`)
  await evaluate(cdp, `window.changePDF('invalid')`)
  await waitForExpression(cdp, `document.querySelector('[role=alert]')?.textContent.includes('无法解析')`)
  await evaluate(cdp, `window.changePDF('real');window.removePDF()`)
  await waitForExpression(cdp, `!document.querySelector('canvas')`)
  assert.deepEqual(errors, [])
  assert.ok(requests.some(url => url.includes('pdf.worker.min.mjs')))
  assert.ok(requests.some(url => url.includes('standard_fonts')))
  assert.equal(requests.some(url => !url.startsWith('http://127.0.0.1:18592') && !url.startsWith('data:') && !url.startsWith('blob:')), false)
  const evidence = process.env.PDF_PREVIEW_EVIDENCE || `/var/tmp/cyf-pdf-preview-${process.pid}`
  await mkdir(evidence, { recursive: true }); await writeFile(`${evidence}/browser.json`, JSON.stringify({ checkedAt: new Date().toISOString(), passed: true, checks: ['real worker','original PDF paging','Chinese page','320px resize','password','invalid','unmount','same-origin font resources'], requests, errors }, null, 2))
  console.log(`PDF browser diagnostic passed: ${evidence}/browser.json`)
} catch (error) { if (browser) console.error(JSON.stringify({ body: await evaluate(browser.cdp, 'document.body.innerText'), errors, requests: requests.slice(-20) })); throw error
} finally { if (browser) { browser.cdp.close(); await stopChrome(browser.chrome, browser.userDataDir) } await server.close() }
