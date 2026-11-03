/** Real picker/message components and sanitizer; only authorized file I/O uses fixtures. No build. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { launchChrome, evaluate, waitForExpression, stopChrome } from '../scripts/juyiting/e13/lib/cdp-harness.mjs'
const root = fileURLToPath(new URL('..', import.meta.url))
const text = kind => kind === 'html' ? '<h1>实际正文</h1><script>parent.pwned=1</script>' : '# 实际正文\n\n**重点**'
const workspaceFixture = `import {ref} from 'vue';
const files=['html','markdown'].map(kind=>({fileId:kind,displayName:'活动资料.'+(kind==='html'?'html':'md'),latestVersion:'2'}));
const w={items:ref(files),detail:ref(null),preview:ref({kind:'none'}),error:ref(''),listState:ref('ready'),actionState:ref('idle'),loading:ref(false),nextCursor:ref(null),
refresh:async()=>true,dispose:()=>{},revokePreview:()=>{w.preview.value={kind:'none'}},closeDetail:()=>{w.detail.value=null;w.revokePreview()},
select:async fileId=>{w.detail.value={file:{...files.find(f=>f.fileId===fileId),state:'ACTIVE'},latestVersion:{version:'2'},versions:[{version:'1'},{version:'2'}]};return w.detail.value},
previewVersion:async version=>{window.fixedVersions.push(version);const kind=w.detail.value.file.fileId;w.preview.value={kind:'document',documentKind:kind,text:kind==='html'?${JSON.stringify(text('html'))}:${JSON.stringify(text('markdown'))},message:''}}};
export const usePersonalWorkspace=()=>w;export const savePersonalWorkspaceBlob=()=>{};`
const httpFixture = `export const createApi=()=>({execute:async req=>{window.contentRequests.push({url:req.url,needAuth:req.needAuth});return new Blob([window.fileBody],{type:window.fileMime})}});`
const page = `<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module">
import {createApp,h,ref} from 'vue';import Picker from '/src/components/juyiting/HallMaterialPicker.vue';import Media from '/src/components/juyiting/HallMessageMedia.vue';
window.fixedVersions=[];window.contentRequests=[];window.pwned=0;
const scope=ref('owner-a'),part=ref({partId:'part',revision:'1',assetId:'asset',kind:'file',mime:'text/html',filename:'file.html'});
window.setFile=(kind,body)=>{window.fileMime=kind==='html'?'text/html':'text/markdown';window.fileBody=body;part.value={...part.value,mime:window.fileMime,revision:String(Number(part.value.revision)+1),filename:'file.'+(kind==='html'?'html':'md')}};
createApp({render:()=>h('main',[h(Picker,{identityScope:scope.value,modelValue:[{fileId:'html',version:'1',displayName:'固定旧版.html'}]}),h(Media,{part:part.value,identityKey:scope.value,conversationId:'conversation-1'}),h('button',{id:'identity',onClick:()=>scope.value+='-next'},'切换身份')])}).mount('#app');</script>`
const server = await createServer({ root, configFile: false, cacheDir: `/var/tmp/cyf-rich-entry-vite-${process.pid}`, plugins: [{ name: 'rich-entry-fixtures', enforce: 'pre',
 resolveId(id) { if (id === '@/composables/usePersonalWorkspace') return '\0workspace-fixture'; if (id.endsWith('/composables/useHttp.js')) return '\0http-fixture'; if (id.endsWith('/PdfDocumentPreview.vue')) return '\0pdf-stub' },
 load(id) { if (id === '\0workspace-fixture') return workspaceFixture; if (id === '\0http-fixture') return httpFixture; if (id === '\0pdf-stub') return 'export default {render:()=>null}' },
 configureServer(s) { s.middlewares.use('/document-entries', async (_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/document-entries',page))}) }
},vue()],server:{host:'127.0.0.1',port:18596,strictPort:true},optimizeDeps:{entries:[],include:['vue','marked','dompurify']} })
let b; const checks=[],errors=[]
const click=selector=>evaluate(b.cdp,`document.querySelector(${JSON.stringify(selector)}).click()`)
try {
 await server.listen(); b=await launchChrome({debugPort:19596});const {cdp}=b
 cdp.on('Runtime.exceptionThrown',v=>errors.push(v.exceptionDetails?.exception?.description||v.exceptionDetails?.text))
 await cdp.send('Page.navigate',{url:'http://127.0.0.1:18596/document-entries'});await waitForExpression(cdp,`!!document.querySelector('.quick-material-open')`,60000)
 const evidence=process.env.RICH_ENTRY_EVIDENCE || `/var/tmp/cyf-rich-entries-${process.pid}`;await mkdir(evidence,{recursive:true})
 const inspect=async()=>{
  await waitForExpression(cdp,`!!document.querySelector('dialog iframe')`);await new Promise(r=>setTimeout(r,150))
  const {frameTree}=await cdp.send('Page.getFrameTree');const frame=frameTree.childFrames[0].frame.id
  const {executionContextId}=await cdp.send('Page.createIsolatedWorld',{frameId:frame,worldName:'inspect'})
  const {result}=await cdp.send('Runtime.evaluate',{expression:`({heading:document.querySelector('h1')?.textContent,script:!!document.querySelector('script')})`,contextId:executionContextId,returnByValue:true})
  assert.deepEqual(result.value,{heading:'实际正文',script:false})
  const geometry=await evaluate(cdp,`(()=>{const f=document.querySelector('dialog iframe'),r=f.getBoundingClientRect();return {width:r.width,height:r.height,sandbox:f.getAttribute('sandbox'),opaque:f.contentDocument===null,overflow:document.documentElement.scrollWidth>innerWidth,pwned}})()`)
  assert.ok(geometry.width>100&&geometry.height>100);assert.equal(geometry.sandbox,'');assert.equal(geometry.opaque,true);assert.equal(geometry.overflow,false);assert.equal(geometry.pwned,0);return geometry
 }
 for(const width of [1440,390,320]){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<760})
  for(const kind of ['html','markdown']){
   await click('.quick-material-open');await waitForExpression(cdp,`!!document.querySelector('dialog[open]')`)
   await click(`[data-file-id="${kind}"]`);await new Promise(r=>setTimeout(r,100));if(width<600)await click('.quick-material-preview-toggle')
   checks.push({width,kind,entry:'picker',...await inspect()});await click('.quick-material-back');if(width<600)await click('.quick-material-back')
   await evaluate(cdp,`setFile(${JSON.stringify(kind)},${JSON.stringify(text(kind))})`);await click('.media-actions button')
   checks.push({width,kind,entry:'message',...await inspect()});await click('.media-preview-close')
  }
  await click('.quick-material-summary button');checks.push({width,kind:'html',entry:'selected-fixed-version',...await inspect()})
  const screenshot=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(`${evidence}/selected-${width}.png`,Buffer.from(screenshot.data,'base64'))
  await click('#identity');await waitForExpression(cdp,`!document.querySelector('dialog')`)
 }
 assert.deepEqual(errors,[])
 const fixedVersions=await evaluate(cdp,'fixedVersions');assert.ok(fixedVersions.filter(v=>v==='1').length>=6)
 const requests=await evaluate(cdp,'contentRequests');assert.equal(requests.length,6);assert.ok(requests.every(r=>r.needAuth&&r.url==='/conversations/conversation-1/assets/asset/content'))
 await writeFile(`${evidence}/results.json`,JSON.stringify({checks,errors,fixedVersions,requests},null,2));console.log(`PASS 15 real component entry previews: ${evidence}`)
}finally{if(b){b.cdp.close();await stopChrome(b.chrome,b.userDataDir)}await server.close()}
