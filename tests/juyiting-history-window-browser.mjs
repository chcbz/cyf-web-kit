/** Actual Vue window and page composable; HTTP is a synthetic scoped history fixture. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { launchChrome, evaluate, waitForExpression, stopChrome } from '../scripts/juyiting/e13/lib/cdp-harness.mjs'
const evidence = process.env.HISTORY_WINDOW_EVIDENCE
if (!evidence) throw new Error('HISTORY_WINDOW_EVIDENCE is required')
const root = fileURLToPath(new URL('..', import.meta.url)), cacheDir = `/var/tmp/cyf-history-window-vite-${process.pid}`
const html = `<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px sans-serif}#scroller{height:600px;overflow:auto;overflow-anchor:none}.message{padding:10px;margin:10px;border:1px solid #aaa}textarea{max-width:95%}</style><div id="app"></div><script type="module">
import {createApp,h,ref,nextTick} from 'vue';
import Window from '/src/components/juyiting/HallMessageWindow.vue';
import {useHallMessagePages} from '/src/composables/juyiting/useHallMessagePages.js';
const Row={props:['message'],setup:props=>{const draft=ref(props.message.content);return ()=>h('article',{class:'message'},[h('p',props.message.content),h('details',[h('summary','展开'),h('textarea',{value:draft.value,onInput:e=>draft.value=e.target.value})])])}};
const messages=ref([]),id=ref('100'),identity=ref('owner'),scroller=ref(null);window.calls=[];
const response=(last)=>{const first=Math.max(1,last-19);return {items:Array.from({length:Math.max(0,last-first+1)},(_,i)=>({id:String(first+i),createTime:1000,content:('message '+(first+i)+' ').repeat((first+i)%7+1)})),hasMore:first>1,nextCursor:first>1?'1000:'+first:null}};
const pages=useHallMessagePages({messages,conversationId:id,identityKey:identity,captureGuard:()=>identity.value,guardCurrent:x=>x===identity.value,normalize:row=>({localId:row.id,content:row.content}),chatApi:{get:async(path,params,options)=>{calls.push(params.cursor);const parts=params.cursor.split(':');const last=Number(parts.at(-1))-(parts[0]==='at'?0:1);await new Promise(r=>setTimeout(r,10));options.onSuccess(response(last))}}});
pages.applyLatest(response(1000));
window.inspect=()=>({bodies:messages.value.length,pages:pages.windows.value.length,loaded:pages.windows.value.filter(p=>p.loaded).length,dom:document.querySelectorAll('[data-history-row]').length,requests:calls.length,errors:pages.windowErrors.value});
window.latest=()=>pages.applyLatest(response(1002));
window.changeIdentity=()=>{identity.value='other';messages.value=[]};
createApp({setup:()=>()=>h('main',[h('button',{id:'older',onClick:()=>pages.loadOlder()},'更早'),h('div',{id:'scroller',ref:scroller},[h(Window,{pages:pages.windows.value,messages:messages.value,scroller:scroller.value,scope:identity.value,loading:pages.windowLoading.value,errors:pages.windowErrors.value,onRetain:pages.retainWindows,onLoad:pages.loadWindow},{default:({message})=>h(Row,{key:message.localId,message})})])])}).mount('#app');
</script>`
const server = await createServer({ root, configFile: false, cacheDir, plugins: [vue(), { name: 'history-window-fixture', configureServer(s) { s.middlewares.use('/window-test', async (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml('/window-test', html)) }) } }], server: { host: '127.0.0.1', port: 18797, strictPort: true }, optimizeDeps: { entries: [], include: ['vue'] } })
let browser
const errors = [], checks = []
try {
  await server.listen(); browser = await launchChrome({ debugPort: 19797 }); const { cdp } = browser
  cdp.on('Runtime.exceptionThrown', value => errors.push(value.exceptionDetails?.exception?.description || value.exceptionDetails?.text))
  await mkdir(evidence, { recursive: true })
  for (const width of [1440, 390]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:18797/window-test' })
    await waitForExpression(cdp, "document.querySelectorAll('[data-history-row]').length===20", 60000)
    const anchorBefore = await evaluate(cdp, "(()=>{const r=document.querySelector('[data-history-row]');return {id:r.dataset.historyRow,top:r.getBoundingClientRect().top}})()")
    await evaluate(cdp, "document.querySelector('#older').click()")
    await new Promise(resolve => setTimeout(resolve, 200))
    const anchorAfter = await evaluate(cdp, `document.querySelector('[data-history-row="${anchorBefore.id}"]')?.getBoundingClientRect().top`)
    assert.ok(Math.abs(anchorAfter - anchorBefore.top) < 2, JSON.stringify({ anchorBefore, anchorAfter }))
    // An image/expanded block above the first visible row changes height after paint.
    await evaluate(cdp, "document.querySelector('#scroller').scrollTop+=500")
    await new Promise(resolve => setTimeout(resolve, 100))
    const resizeAnchor = await evaluate(cdp, "(()=>{const top=document.querySelector('#scroller').getBoundingClientRect().top;const r=[...document.querySelectorAll('[data-history-row]')].find(r=>r.getBoundingClientRect().bottom>top);return {id:r.dataset.historyRow,top:r.getBoundingClientRect().top}})()")
    await evaluate(cdp, `(()=>{const rows=[...document.querySelectorAll('[data-history-row]')];const index=rows.findIndex(r=>r.dataset.historyRow==='${resizeAnchor.id}');if(index<1)throw new Error('resize fixture needs preceding content');rows[index-1].querySelector('article').style.paddingBottom='230px'})()`)
    await new Promise(resolve => setTimeout(resolve, 200))
    const resizeAfter = await evaluate(cdp, `document.querySelector('[data-history-row="${resizeAnchor.id}"]')?.getBoundingClientRect().top`)
    assert.ok(Math.abs(resizeAfter - resizeAnchor.top) < 2, JSON.stringify({ resizeAnchor, resizeAfter }))
    for (let i = 0; i < 14; i++) {
      await evaluate(cdp, "document.querySelector('#scroller').scrollTop=0;document.querySelector('#older').click()")
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    await evaluate(cdp, "document.querySelector('#scroller').scrollTop=0")
    await new Promise(resolve => setTimeout(resolve, 200))
    const old = await evaluate(cdp, 'inspect()')
    assert.equal(old.pages, 16)
    assert.ok(old.loaded < old.pages / 2, JSON.stringify(old))
    assert.ok(old.bodies <= old.loaded * 20, JSON.stringify(old))
    assert.ok(old.dom <= old.loaded * 20, JSON.stringify(old))
    await evaluate(cdp, "(()=>{const d=document.querySelector('details');d.open=true;d.querySelector('textarea').value='编辑保留';d.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}));})()")
    await new Promise(resolve => setTimeout(resolve, 100))
    const editedId = await evaluate(cdp, "document.querySelector('details[open]').closest('[data-history-row]').dataset.historyRow")
    await evaluate(cdp, "const b=document.querySelector('#scroller');b.scrollTop=b.scrollHeight")
    await waitForExpression(cdp, "!!document.querySelector('[data-history-row=\"1000\"]')")
    assert.equal(await evaluate(cdp, `document.querySelector('[data-history-row="${editedId}"] textarea')?.value`), '编辑保留')
    await evaluate(cdp, "document.querySelector('#scroller').scrollTop=0")
    await new Promise(resolve => setTimeout(resolve, 200))
    const beforeLatest = await evaluate(cdp, 'inspect()')
    await evaluate(cdp, 'latest()')
    await new Promise(resolve => setTimeout(resolve, 200))
    const afterLatest = await evaluate(cdp, 'inspect()')
    assert.ok(afterLatest.bodies <= beforeLatest.bodies + 2, JSON.stringify({ beforeLatest, afterLatest }))
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`${evidence}/${width}.png`, Buffer.from(screenshot.data, 'base64'))
    checks.push({ width, old, beforeLatest, afterLatest, prependAnchorDelta: anchorAfter - anchorBefore.top, resizeAnchorDelta: resizeAfter - resizeAnchor.top })
    await evaluate(cdp, 'changeIdentity()')
    await waitForExpression(cdp, 'inspect().pages===0 && inspect().bodies===0')
  }
  assert.deepEqual(errors, [])
  await writeFile(`${evidence}/results.json`, JSON.stringify({ checks, errors, boundary: 'actual components; synthetic HTTP only' }, null, 2))
  console.log(JSON.stringify(checks))
} catch (error) { console.error(JSON.stringify({ errors, state: browser ? await evaluate(browser.cdp, 'typeof inspect==="function"?inspect():document.body.innerText') : null })); throw error }
finally { if (browser) { browser.cdp.close(); await stopChrome(browser.chrome, browser.userDataDir) } await server.close(); await rm(cacheDir, { recursive: true, force: true }) }
