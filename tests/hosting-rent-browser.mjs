/** Real rent panel/controller/capability decoder; only HTTP and authenticated store use synthetic fixtures. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import net from 'node:net'
import { launchChrome, evaluate, waitForExpression, stopChrome } from '../scripts/juyiting/e13/lib/cdp-harness.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const evidence = process.env.HOSTING_RENT_BROWSER_EVIDENCE
assert.ok(evidence?.startsWith('/'), 'absolute disk evidence directory required')
await mkdir(evidence, { recursive: true })
const fixture = `import { hostingQuote, hostingReceipt, hostingLookup } from '/tests/hosting-rent-fixtures.js';
window.requests=[];window.rejectStale=false;
const amount={currency:'WEN',amountMinor:'3500'};
export const economyApi={get:async path=>path==='/capabilities'?{economyPreviewEnabled:true,skillMarketplaceEnabled:true,principalScopeSha256:'a'.repeat(64)}:{currency:'WEN',available:amount,held:{currency:'WEN',amountMinor:'0'}}};
export const agentApi={create:async(path,body,options)=>{
window.requests.push({path,body,key:options.headers['Idempotency-Key']});
if(path.endsWith('/quotes'))return hostingQuote({amountWen:'650',recurringAmountWen:'500',initialSkillCount:'3',initialSkillAmountWen:'150',periodSeconds:'2592000',expiresAt:Date.now()+300000});
if(window.rejectStale){const e=new Error('HOSTING_RENT_QUOTE_STALE');e.code='HOSTING_RENT_QUOTE_STALE';e.status=409;throw e;}
return hostingReceipt({amountWen:'650',periodSeconds:'2592000',occurredAt:Date.now()});
},get:async()=>hostingLookup({lease:{amountWen:'650',periodSeconds:'2592000'}})};`
const page = `<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module">
import {createApp,h} from 'vue';import Panel from '/src/components/juyiting/HostingRentPanel.vue';import {hostingPersona} from '/tests/hosting-rent-fixtures.js';
sessionStorage.clear();window.closed=false;const persona=hostingPersona();createApp({render:()=>h(Panel,{persona,resolvePersona:()=>persona,onClose:()=>{window.closed=true}})}).mount('#app');</script>`
const server = await createServer({ root, configFile: false, cacheDir: `${evidence}/vite-cache`,
  define: { 'import.meta.env.VITE_ECONOMY_PREVIEW_ENABLED': JSON.stringify('true') },
  plugins: [{ name: 'hosting-http-fixtures', enforce: 'pre',
    resolveId(id) {
      if (/\/composables\/useHttp(?:\.js)?$/.test(id)) return '\0hosting-http'
      if (id.endsWith('/stores/api.js')) return '\0hosting-store'
    },
    load(id) {
      if (id === '\0hosting-http') return fixture
      if (id === '\0hosting-store') return 'export const useApiStore=()=>({authorizationGeneration:1})'
    },
    configureServer(s) { s.middlewares.use('/rent-check', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml('/rent-check', page))
    }) }
  }, vue()], server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { entries: [], include: ['vue'] } })
const started = Date.now()
const result = { status: 'RUNNING', scope: 'actual Vue panel/controller with synthetic HTTP; no production or provider calls',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), checks: [], screenshots: {}, exceptions: [] }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
result.inputs = Object.fromEntries(await Promise.all([
  'src/components/juyiting/HostingRentPanel.vue', 'src/composables/juyiting/useHostingRent.js',
  'src/composables/juyiting/hostingRentContract.js', 'src/utils/economyPreviewCapability.js',
  'tests/hosting-rent-fixtures.js', 'tests/hosting-rent-browser.mjs'
].map(async path => [path, hash(await readFile(root + path))])))
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const debugPort = socket.address().port; await new Promise(resolve => socket.close(resolve))
  browser = await launchChrome({ debugPort }); const { cdp } = browser
  cdp.on('Runtime.exceptionThrown', value => result.exceptions.push(value.exceptionDetails))
  const click = text => evaluate(cdp, `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)}));if(!b||b.disabled)throw new Error('button unavailable');b.click()})()`)
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['narrow', 320, 740]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 760 })
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${address.port}/rent-check` })
    await waitForExpression(cdp, `!!document.querySelector('.hosting-quote')`, 60000)
    const text = await evaluate(cdp, 'document.body.innerText')
    for (const expected of ['本次合计：650文 / 30 天', '正常租费：500文 / 30 天', '已有技能：3种', '首次费用 150文', '后续每期 500文']) assert.ok(text.includes(expected), `${name}:${expected}`)
    assert.ok(!text.includes('报价有效至 待确认'), 'numeric epoch rendered')
    assert.equal(await evaluate(cdp, `window.requests.filter(r=>r.path.endsWith('/bind')).length`), 0)
    const fit = await evaluate(cdp, `(()=>{const p=document.querySelector('.hosting-rent-panel'),r=p.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&p.scrollWidth<=p.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth})()`)
    assert.equal(fit, true, `${name}:horizontal fit`)
    await evaluate(cdp, `document.querySelector('.hosting-quote').scrollIntoView()`)
    const image = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64')
    await writeFile(`${evidence}/${name}.png`, image); result.screenshots[name] = hash(image)
    await click('取消报价，不付款')
    assert.equal(await evaluate(cdp, `document.querySelector('.hosting-quote')===null&&window.requests.filter(r=>r.path.endsWith('/bind')).length===0`), true)
    await click('查看安顿报价'); await waitForExpression(cdp, `!!document.querySelector('.hosting-quote')`)
    await evaluate(cdp, 'window.rejectStale=true'); await click('确认此报价')
    await waitForExpression(cdp, `!!document.querySelector('[role="alert"]')&&!document.querySelector('.hosting-quote')`)
    assert.equal(await evaluate(cdp, `window.requests.filter(r=>r.path.endsWith('/bind')).length`), 1)
    assert.equal(await evaluate(cdp, `!!document.querySelector('.hosting-recovery')`), false)
    await evaluate(cdp, 'window.rejectStale=false'); await click('查看安顿报价')
    await waitForExpression(cdp, `!!document.querySelector('.hosting-quote')`); await click('确认此报价')
    await waitForExpression(cdp, `!!document.querySelector('.hosting-receipt')&&!document.querySelector('.hosting-quote')`)
    const binds = await evaluate(cdp, `window.requests.filter(r=>r.path.endsWith('/bind'))`)
    assert.equal(binds.length, 2); assert.notEqual(binds[0].key, binds[1].key)
    assert.equal(binds[1].body.expectedAmountWen, '650'); assert.equal(binds[1].body.expectedPeriodSeconds, '2592000')
    assert.ok((await evaluate(cdp, 'document.body.innerText')).includes('租金已预留'))
    result.checks.push(`${name}:breakdown, numeric expiry, fit, preview/cancel no bind, stale rejection/no automatic retry, explicit requote/reserve`)
  }
  assert.deepEqual(result.exceptions, [])
  result.status = 'PASS'
} catch (error) {
  result.status = 'FAIL'; result.error = error.stack; process.exitCode = 1
  if (browser) result.diagnostic = await evaluate(browser.cdp, '({text:document.body.innerText,requests:window.requests})').catch(() => null)
} finally {
  if (browser) { browser.cdp.close(); await stopChrome(browser.chrome, browser.userDataDir) }
  await server.close(); result.seconds = (Date.now() - started) / 1000
  await writeFile(`${evidence}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result))
}
