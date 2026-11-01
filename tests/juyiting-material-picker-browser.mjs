/** Targeted real-layout diagnostic. Only workspace I/O is a fixture; no production writes. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { launchChrome, evaluate, waitForExpression, stopChrome } from '../scripts/juyiting/e13/lib/cdp-harness.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = `import { ref } from 'vue';
export const savePersonalWorkspaceBlob = () => {};
export const usePersonalWorkspace = () => ({ items: ref([]), detail: ref(null), listState: ref('empty'), error: ref(''), hasMore: ref(false), loading: ref(false), nextCursor: ref(null),
refresh: async () => true, closeDetail: () => {}, dispose: () => {} });`
const page = `<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module">
import { createApp, h } from 'vue';
import Picker from '/src/components/juyiting/HallMaterialPicker.vue';
createApp({render:()=>h(Picker,{identityScope:'fixture-owner'}, {context:()=>h('details',{class:'material-use-settings'},[h('summary','本条消息使用的资料'),h('label',[h('input',{type:'radio',name:'scope'}),'使用所选资料'])])})}).mount('#app');</script>`
const server = await createServer({ root, configFile: false, cacheDir: process.env.MATERIAL_PICKER_CACHE || `/var/tmp/cyf-picker-vite-${process.pid}`, plugins: [{ name: 'picker-fixture', enforce: 'pre',
  resolveId(id) { if (id === '@/composables/usePersonalWorkspace') return '\0picker-workspace-fixture'; if (id.endsWith('/PdfDocumentPreview.vue')) return '\0picker-pdf-stub' },
  load(id) { if (id === '\0picker-workspace-fixture') return fixture; if (id === '\0picker-pdf-stub') return 'export default { render: () => null }' },
  configureServer(server) { server.middlewares.use('/picker-diagnostic', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/picker-diagnostic', page)) }) }
}, vue()], server: { host: '127.0.0.1', port: 18593, strictPort: true }, optimizeDeps: { entries: [], include: ['vue'] } })
let browser
const errors = [], checks = []
const click = async selector => {
  const point = await evaluate(browser.cdp, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('target occluded');return {x,y}})()`)
  for (const type of ['mousePressed', 'mouseReleased']) await browser.cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
}
try {
  await server.listen(); browser = await launchChrome({ debugPort: 19593 })
  const { cdp } = browser
  cdp.on('Runtime.exceptionThrown', value => errors.push(value.exceptionDetails?.exception?.description || value.exceptionDetails?.text))
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:18593/picker-diagnostic' })
  await waitForExpression(cdp, `!!document.querySelector('.quick-material-open')`, 90000)
  const evidence = process.env.MATERIAL_PICKER_EVIDENCE || `/var/tmp/cyf-material-picker-${process.pid}`
  await mkdir(evidence, { recursive: true })
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 })
    await click('.quick-material-open')
    await waitForExpression(cdp, `!!document.querySelector('dialog[open] .material-use-settings summary')`)
    await click('.material-use-settings summary')
    await waitForExpression(cdp, `document.querySelector('.material-use-settings').open`)
    await click('.material-use-settings input')
    assert.ok(await evaluate(cdp, `document.querySelector('.material-use-settings input').checked`))
    const geometry = await evaluate(cdp, `(()=>{const context=document.querySelector('.quick-material-context').getBoundingClientRect(),body=document.querySelector('.quick-material-picker-body').getBoundingClientRect();return {contextBottom:context.bottom,bodyTop:body.top,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
    assert.ok(geometry.bodyTop >= geometry.contextBottom - 1)
    assert.equal(geometry.overflow, false)
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${evidence}/picker-${width}.png`, Buffer.from(screenshot.data, 'base64'))
    checks.push({ width, height, ...geometry, summaryClicked: true, radioSelected: true })
    await click('.quick-material-back')
    await waitForExpression(cdp, `!document.querySelector('dialog[open]')`)
  }
  assert.deepEqual(errors, [])
  await writeFile(`${evidence}/browser.json`, JSON.stringify({ at: new Date().toISOString(), checks, errors }, null, 2))
  console.log(`Material picker browser diagnostic passed: ${evidence}/browser.json`)
} catch (error) { console.error(JSON.stringify({ errors, body: browser ? await evaluate(browser.cdp, 'document.body.innerText') : null })); throw error
} finally { if (browser) { browser.cdp.close(); await stopChrome(browser.chrome, browser.userDataDir) } await server.close() }
