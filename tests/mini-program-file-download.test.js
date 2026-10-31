import { expect } from 'chai'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { saveOutputBlob } from '../src/utils/outputDownload.js'
import { savePersonalWorkspaceBlob } from '../src/composables/usePersonalWorkspace.js'
import path from 'node:path'
import postcss from 'postcss'
import { createMiniRuntimeLoader } from './helpers/miniProgramRuntime.js'
import { validateReturnTarget, saveInMiniProgram } from '../src/utils/miniProgramFileBridge.js'

const miniRoot = fileURLToPath(new URL('../miniprogram/juyiting', import.meta.url))
const readMini = relative => readFileSync(path.join(miniRoot, relative), 'utf8')
const runMini = createMiniRuntimeLoader(miniRoot)
const sourceUrl = 'https://kit.chaoyoufan.cn/juyiting?view=outputs&taskId=42&nativeOrientation=portrait#result'
const returnOptions = { returnUrl: encodeURIComponent(sourceUrl), returnLabel: encodeURIComponent('返回聚义厅'), orientation: 'portrait' }
const asMessage = record => ({ protocolVersion: record.protocolVersion, requestId: record.requestId, messageType: record.messageType, data: { name: record.name, mime: record.mime, size: record.size, base64: record.base64 } })


describe('Juyi Hall mini-program file bridge', () => {
  it(process.env.MINIPROGRAM_PROJECT ? 'verifies explicit external mirror file set and every runtime SHA-256' : 'loads authoritative repo runtime source (external comparison requires MINIPROGRAM_PROJECT)', () => {
    const runtimeFiles = (root, prefix = '') => readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
      const relative = path.posix.join(prefix, entry.name)
      return entry.isDirectory() ? runtimeFiles(root, relative) : /^(app\.(js|json|wxss)|sitemap\.json|(?:pages|utils)\/.+)$/.test(relative) ? [relative] : []
    }).sort()
    const files = runtimeFiles(miniRoot)
    expect(files).to.include('pages/download/index.js')
    expect(files).not.to.include('project.private.config.json')
    if (process.env.MINIPROGRAM_PROJECT) {
      expect(runtimeFiles(process.env.MINIPROGRAM_PROJECT)).to.deep.equal(files)
      for (const file of files) {
        const hash = root => createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')
        expect(hash(process.env.MINIPROGRAM_PROJECT), file).to.equal(hash(miniRoot))
      }
    }
  })
  it('keeps styled download actions bound to the original availability conditions', () => {
    const markup = readMini('pages/download/index.wxml')
    const actions = [...markup.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)]
    expect(actions).to.have.length(3)
    for (const [index, [condition, handler, label]] of [
      ['written && fileType', 'openFile', '打开文件'],
      ['written && canShare', 'shareFile', '分享文件到微信'],
      ['done', 'returnToSource', '{{returnLabel}}']
    ].entries()) {
      expect(actions[index][1]).to.include(`wx:if="{{${condition}}}"`).and.include(`bindtap="${handler}"`)
      expect(actions[index][2]).to.equal(label)
    }
    expect(markup).to.include('wx:if="{{message}}"').and.include('{{message}}')
    expect(markup).to.include('wx:if="{{fileName}}"').and.include('{{fileName}}')
    expect(markup).to.match(/<view wx:else class="download-emblem"/)
    expect(markup).not.to.include('data-download-state')
  })

  it('uses page-local Hall colors, safe-area spacing and scrollable responsive styling', () => {
    const styles = readMini('pages/download/index.wxss')
    const css = postcss.parse(styles)
    const config = JSON.parse(readMini('pages/download/index.json'))
    expect(config).to.include({ navigationBarTitleText: '聚义厅', navigationBarBackgroundColor: '#f6f3eb', backgroundColor: '#f6f3eb' })
    const rules = new Map()
    css.walkRules(rule => rules.set(rule.selector, rule))
    const value = (selector, property) => rules.get(selector)?.nodes.filter(node => node.prop === property).at(-1)?.value
    expect(value('.download-button-primary', 'background')).to.equal('#923f30')
    expect(value('.download-button', 'min-height')).to.equal('48px')
    expect(value('.download-content', 'max-width')).to.equal('560px')
    expect(styles).to.include('env(safe-area-inset-bottom)').and.include('(orientation: landscape)')
    css.walkDecls(decl => {
      if (decl.prop === 'position') expect(decl.value).not.to.equal('fixed', 'no fixed overlay hides controls')
      if (decl.prop === 'overflow' || decl.prop === 'overflow-y') expect(decl.value).not.to.equal('hidden')
    })
  })

  it('registers both web-view message handlers and native download route', () => {
    expect(readMini('app.json')).to.include('pages/download/index')
    for (const page of ['index', 'landscape']) {
      expect(readMini(`pages/${page}/index.wxml`)).to.include('bindmessage="onWebMessage"')
      expect(readMini(`pages/${page}/index.js`)).to.include('createWebViewPage')
      expect(readMini('utils/file-messages.js')).to.include("'file.download'")
    }
  })

  it('accepts the documented message event array shapes and bounds pending handoffs', () => {
    let definition
    const state = { pendingDownloads: Object.create(null), consumedDownloads: Object.create(null) }
    const context = { Page: value => { definition = value }, getApp: () => ({ globalData: state }), Date }
    runMini('pages/index/index.js', context)
    const payload = { protocolVersion: 1, messageType: 'file.download', requestId: '12345678-1234-4234-8234-123456789abc', name: 'a.txt', mime: 'text/plain', size: 1, base64: 'YQ==' }
    definition.onWebMessage({ detail: { data: [asMessage(payload), { data: asMessage({ ...payload, requestId: '22345678-1234-4234-8234-123456789abc' }) }] } })
    expect(Object.keys(state.pendingDownloads)).to.have.length(2)
    expect(state.pendingDownloads[payload.requestId].size).to.equal(1)
    definition.onWebMessage({ detail: { data: [asMessage({ ...payload, requestId: '32345678-1234-4234-8234-123456789abc', size: 8 * 1024 * 1024 + 1 })] } })
    expect(Object.keys(state.pendingDownloads)).to.have.length(2)
  })

  it('rejects malformed and oversized event data before decoding or writing', () => {
    let definition
    const calls = []
    const app = { globalData: { pendingDownloads: {}, consumedDownloads: {} } }
    const context = {
      Page: value => { definition = value }, getApp: () => app,
      wx: {
        base64ToArrayBuffer: value => { calls.push(['decode', value]); return new ArrayBuffer(1) },
        getFileSystemManager: () => ({ writeFile: options => { calls.push(['write', options]); options.success() } }),
        openDocument: options => { calls.push(['open']); options.success() }, env: { USER_DATA_PATH: '/user' }
      },
      setInterval: () => 1, clearInterval() {}, Date, setTimeout
    }
    runMini('pages/download/index.js', context)
    const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value) }, finish: definition.finish }
    page.requestId = '12345678-1234-4234-8234-123456789abc'
    app.globalData.pendingDownloads[page.requestId] = { protocolVersion: 1, messageType: 'file.download', requestId: page.requestId, name: 'x.txt', mime: 'text/plain', size: 8 * 1024 * 1024 + 1, base64: 'AAAA', receivedAt: Date.now() }
    page.consume()
    expect(calls).to.deep.equal([])
    expect(page.data.message).to.include('无效或超过8 MiB')
  })
})
const requestId = '12345678-1234-4234-8234-123456789abc'
const payload = overrides => ({ protocolVersion: 1, messageType: 'file.download', requestId, name: 'a.pdf', mime: 'application/pdf', size: 1, base64: 'YQ==', receivedAt: 1000, ...overrides })
const nativeHarness = ({ record = payload(), delayedWrite = false, share = true, unlinkFails = false, config } = {}) => {
  let definition, clock = 1000, write
  const calls = [], timers = new Set()
  const app = { globalData: { pendingDownloads: record ? { [requestId]: record } : {}, consumedDownloads: {} } }
  const wx = {
    env: { USER_DATA_PATH: '/user' },
    base64ToArrayBuffer: value => { calls.push(['decode']); const buffer = Buffer.from(value, 'base64'); return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) },
    getFileSystemManager: () => ({
      writeFile: options => { write = options; calls.push(['write', options.filePath]); if (!delayedWrite) options.success() },
      unlink: options => { calls.push(['unlink', options.filePath]); if (unlinkFails) options.fail?.(); else options.success?.() }
    }),
    openDocument: options => { calls.push(['open', options]); options.success() },
    redirectTo: options => calls.push(['return', options.url]), navigateBack: options => calls.push(['back', options]), showToast: options => calls.push(['toast', options])
  }
  if (share) wx.shareFileMessage = options => { calls.push(['share', options]); options.success() }
  runMini('pages/download/index.js', {
    Page: value => { definition = value }, getApp: () => app, wx,
    Date: { now: () => clock }, setInterval: () => { timers.add(1); return 1 }, clearInterval: id => timers.delete(id)
  })
  if (config) { definition = runMini('utils/download-page.js', { wx, getApp: () => app, Date: { now: () => clock }, setInterval: () => { timers.add(1); return 1 }, clearInterval: id => timers.delete(id) }).createDownloadPage(config) }
  const page = { ...definition, data: { ...definition.data }, setData(value) { calls.push(['setData', value]); Object.assign(this.data, value) } }
  page.onLoad = options => definition.onLoad.call(page, { ...returnOptions, ...options })
  return { page, app, calls, timers, rawLoad: options => definition.onLoad.call(page, options), now: value => { clock = value }, write: () => write, wx }
}

describe('native file lifetime and terminal states', () => {
  it('shows the real safe filename without path prefixes or technical success notices', () => {
    const h = nativeHarness({ record: payload({ name: '聚义厅活动方案.pdf' }) }); h.page.onLoad({ requestId })
    expect(h.page.data).to.include({ fileName: '聚义厅活动方案.pdf', message: '' })
    expect(h.page.data.fileName).not.to.include(requestId)
    h.page.openFile(); expect(h.page.data.message).to.equal('')
    h.page.shareFile(); expect(h.page.data.message).to.equal('')
    expect(h.page.data.fileName).to.equal('聚义厅活动方案.pdf')
  })
  for (const name of ['', '   ', '...']) it(`leaves the filename empty for the large-icon fallback: ${JSON.stringify(name)}`, () => {
    const h = nativeHarness({ record: payload({ name }) }); h.page.onLoad({ requestId })
    expect(h.page.data).to.include({ written: true, fileName: '', message: '' })
    expect(h.page.filePath).to.match(/download\.bin$/)
  })
  it('uses a sanitized basename and exposes it only after a successful write', () => {
    const h = nativeHarness({ record: payload({ name: '../<活动>:方案.pdf' }), delayedWrite: true }); h.page.onLoad({ requestId })
    expect(h.page.data.fileName).to.equal('')
    h.write().success()
    expect(h.page.data.fileName).to.equal('__活动__方案.pdf')
    expect(h.page.filePath.endsWith(h.page.data.fileName)).to.equal(true)
  })
  it('does not expose a filename as ready when writing fails', () => {
    const h = nativeHarness({ delayedWrite: true }); h.page.onLoad({ requestId }); h.write().fail()
    expect(h.page.data).to.include({ fileName: '', written: false, done: true })
    expect(h.page.data.message).to.include('写入失败')
  })
  it('shows an actionable message if neither opening nor sharing is supported', () => {
    const h = nativeHarness({ record: payload({ name: '资料.zip', mime: 'application/zip' }), share: false }); h.page.onLoad({ requestId })
    expect(h.page.data).to.include({ written: true, done: true, fileName: '资料.zip', fileType: '' })
    expect(h.page.data.message).to.equal('当前微信版本不支持分享文件。')
  })

  it('writes, exposes return immediately, opens and shares the exact owned file, and deletes on return', async () => {
    const h = nativeHarness(); h.page.onLoad({ requestId, orientation: 'landscape' })
    expect(h.page.data).to.include({ done: true, written: true, fileType: 'pdf' })
    expect(h.timers.size).to.equal(0)
    const filePath = h.page.filePath
    h.page.openFile(); h.page.shareFile(); await h.page.returnToSource()
    expect(h.calls.find(call => call[0] === 'open')[1].filePath).to.equal(filePath)
    expect(h.calls.find(call => call[0] === 'share')[1].filePath).to.equal(filePath)
    expect(h.calls).to.deep.include(['unlink', filePath])
    expect(h.calls).to.deep.include(['return', '/pages/landscape/index?url=' + encodeURIComponent(sourceUrl)])
    expect(h.page.data.written).to.equal(false)
  })
  it('keeps return available with unavailable share and truthful open/share failures', async () => {
    const h = nativeHarness({ share: false }); h.page.onLoad({ requestId }); h.page.shareFile()
    expect(h.page.data.done).to.equal(true)
    expect(h.page.data.message).to.include('不支持分享')
    expect(h.page.data.message).not.to.include('临时目录')
    h.wx.openDocument = options => options.fail(); h.page.openFile()
    expect(h.page.data.message).to.include('未能打开')
    h.wx.shareFileMessage = options => options.fail(); h.page.shareFile()
    expect(h.page.data.message).to.include('分享未完成')
    await h.page.returnToSource()
    expect(h.calls.some(call => call[0] === 'return')).to.equal(true)
  })
  it('accepts charset and bounds Unicode basename plus prefix to 240 UTF-8 bytes preserving extension', () => {
    const h = nativeHarness({ record: payload({ mime: ' Text/Plain;charset=utf-8 ', name: '文'.repeat(170) + '.txt' }) }); h.page.onLoad({ requestId })
    expect(h.page.data.written).to.equal(true)
    expect(Buffer.byteLength(path.posix.basename(h.page.filePath))).to.be.at.most(240)
    expect(h.page.filePath).to.match(/\.txt$/)
  })
  for (const [label, record, expected] of [
    ['oversize', payload({ size: 8 * 1024 * 1024 + 1 }), '无效或超过'],
    ['size mismatch', payload({ size: 2 }), '长度不匹配']
  ]) it(`rejects ${label} without writing`, () => {
    const h = nativeHarness({ record }); h.page.onLoad({ requestId })
    expect(h.calls.some(call => call[0] === 'write')).to.equal(false)
    expect(h.page.data.message).to.include(expected)
    expect(h.timers.size).to.equal(0)
  })
  it('rejects a present late arrival beyond deadline; terminal never consumes', () => {
    const h = nativeHarness({ record: null }); h.page.onLoad({ requestId })
    h.now(4000); h.app.globalData.pendingDownloads[requestId] = payload({ receivedAt: 3999 }); h.page.consume()
    expect(h.page.data.message).to.include('未收到'); expect(h.timers.size).to.equal(0)
    expect(h.app.globalData.pendingDownloads).not.to.have.property(requestId)
    h.app.globalData.pendingDownloads[requestId] = payload(); h.page.consume()
    expect(h.calls.some(call => call[0] === 'write')).to.equal(false)
  })
  it('unload mid-write never setData and late success cleans only its own file', () => {
    const h = nativeHarness({ delayedWrite: true }); h.page.onLoad({ requestId })
    const write = h.write(); h.page.onUnload(); const count = h.calls.filter(call => call[0] === 'setData').length
    write.success(); write.fail()
    expect(h.calls.filter(call => call[0] === 'setData')).to.have.length(count)
    expect(h.calls.filter(call => call[0] === 'unlink')).to.deep.equal([['unlink', write.filePath]])
    expect(h.app.globalData.pendingDownloads).not.to.have.property(requestId)
  })
  it('cleans late writes after explicit return too', async () => {
    const h = nativeHarness({ delayedWrite: true }); h.page.onLoad({ requestId }); await h.page.returnToSource()
    const count = h.calls.filter(call => call[0] === 'setData').length; h.write().success()
    expect(h.calls.filter(call => call[0] === 'setData')).to.have.length(count)
    expect(h.calls).to.deep.include(['unlink', h.write().filePath])
  })
  it('cleans completed file on unload and blocks native and web-view replay', () => {
    const h = nativeHarness(); h.page.onLoad({ requestId }); const own = h.page.filePath; h.page.onUnload()
    expect(h.calls).to.deep.include(['unlink', own])
    let receiver
    runMini('pages/index/index.js', { Page: value => { receiver = value }, getApp: () => h.app, Date: { now: () => 1100 } })
    receiver.onWebMessage({ detail: { data: [asMessage(payload())] } })
    expect(h.app.globalData.pendingDownloads).not.to.have.property(requestId)
    h.app.globalData.pendingDownloads[requestId] = payload(); h.page.onLoad({ requestId })
    expect(h.calls.filter(call => call[0] === 'write')).to.have.length(1)
    expect(h.page.data.message).to.include('已处理')
  })
  it('retains path and does not navigate or claim deletion when unlink fails; unload retries', async () => {
    const h = nativeHarness({ unlinkFails: true }); h.page.onLoad({ requestId }); const own = h.page.filePath
    await h.page.returnToSource()
    expect(h.page.filePath).to.equal(own); expect(h.page.returning).to.equal(false)
    expect(h.page.data.message).to.include('删除失败'); expect(h.page.data.message).not.to.include('已删除')
    expect(h.calls.some(call => call[0] === 'return')).to.equal(false)
    h.page.onUnload()
    expect(h.calls.filter(call => call[0] === 'unlink')).to.have.length(2)
  })
  it('waits for unlink confirmation before declaring deletion or navigating', async () => {
    const h = nativeHarness(); h.page.onLoad({ requestId }); const own = h.page.filePath; let unlink
    h.wx.getFileSystemManager = () => ({ unlink: options => { unlink = options } })
    const returning = h.page.returnToSource()
    expect(h.page.filePath).to.equal(own); expect(h.calls.some(call => call[0] === 'return')).to.equal(false)
    unlink.success(); await returning
    expect(h.page.filePath).to.equal(null); expect(h.page.data.message).to.equal('正在返回…')
    expect(h.calls.some(call => call[0] === 'return')).to.equal(true)
  })
  it('launch sweep deletes strict owned orphan names only, skipping IDs acquired while readdir was pending', () => {
    let app, readdir
    const owned = id => `juyiting-${id}-文件.txt`
    const active = '22345678-1234-4234-8234-123456789abc', consumed = '32345678-1234-4234-8234-123456789abc'
    const files = [owned(requestId), owned(active), owned(consumed), 'a.txt', 'juyiting-not-a-uuid-file.txt', `juyiting-${requestId}-../other`]
    const removed = []
    runMini('app.js', { App: value => { app = value }, wx: { env: { USER_DATA_PATH: '/user' }, getFileSystemManager: () => ({ readdir: options => { readdir = options }, unlink: options => removed.push(options.filePath) }) } })
    app.onLaunch(); app.globalData.pendingDownloads[active] = payload(); app.globalData.consumedDownloads[consumed] = 1000
    readdir.success({ files })
    expect(removed).to.deep.equal([`/user/${owned(requestId)}`])
  })
})

const miniHost = ({ deferredRead = false, redirectPending = false } = {}) => {
  const calls = []; let reader
  const host = { __wxjs_environment: 'miniprogram', location: { href: 'https://kit.chaoyoufan.cn/juyiting?nativeOrientation=portrait' }, setTimeout, clearTimeout,
    crypto: { randomUUID: () => requestId },
    wx: { miniProgram: { postMessage: value => calls.push(['post', value.data]), redirectTo: options => { calls.push(['redirect', options]); if (!redirectPending) options.success() } } },
    FileReader: class {
      constructor() { reader = this }
      readAsDataURL() { if (!deferredRead) this.complete() }
      complete() { this.result = 'data:text/plain;charset=utf-8;base64,YQ=='; this.onload?.() }
      abort() { calls.push(['abort']) }
    }
  }
  return { host, calls, reader: () => reader }
}
const advance = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const rejection = promise => promise.then(() => null, error => error)

describe('encoding cancellation fences and workspace native delegation', () => {
  it('normalizes charset on H5 and takes actual workspace native path without browser APIs', async () => {
    const h = miniHost()
    const saved = await savePersonalWorkspaceBlob({ blob: new Blob(['a'], { type: 'text/plain;charset=utf-8' }), filename: '../资料.txt', host: h.host, documentRef: {}, urlApi: {} })
    expect(saved.status).to.equal('transferred')
    expect(h.calls[0][1].data).to.include({ mime: 'text/plain', size: 1, name: '_资料.txt' })
    expect(h.calls.map(call => call[0])).to.deep.equal(['post', 'redirect'])
  })
  for (const mode of ['abort', 'identity']) it(`fences ${mode} during encoding and aborts reader without post/redirect`, async () => {
    const h = miniHost({ deferredRead: true }); const controller = new AbortController(); let current = true
    const pending = rejection(saveOutputBlob({ blob: new Blob(['a']), host: h.host, signal: controller.signal, isCurrent: () => current }))
    await advance(); expect(h.reader()).to.exist
    if (mode === 'abort') controller.abort(); else current = false
    const error = await pending; h.reader().complete()
    expect(error?.name).to.equal('AbortError'); expect(h.calls.map(call => call[0])).to.deep.equal(['abort'])
  })
  it('fences identity shift while bridge SDK still loads', async () => {
    const h = miniHost(); delete h.host.wx; let current = true, finishSdk
    h.host.setTimeout = callback => { finishSdk = callback; return 1 }
    h.host.document = { getElementById: () => null, createElement: () => ({ addEventListener() {} }), head: { appendChild() {} } }
    const pending = rejection(saveOutputBlob({ blob: new Blob(['a']), host: h.host, isCurrent: () => current })); current = false
    expect((await pending)?.name).to.equal('AbortError'); expect(h.calls).to.deep.equal([])
    finishSdk(); await advance()
  })
  for (const mode of ['abort', 'identity']) it(`does not report ${mode} as cancellation after native handoff`, async () => {
    const h = miniHost({ redirectPending: true }); const controller = new AbortController(); const timers = new Set(); let current = true, handoff
    h.host.setTimeout = (...args) => { const timer = setTimeout(...args); timers.add(timer); return timer }
    h.host.clearTimeout = timer => { clearTimeout(timer); timers.delete(timer) }
    const pending = saveOutputBlob({ blob: new Blob(['a']), host: h.host, signal: controller.signal, isCurrent: () => current, onHandoff: value => { handoff = value } })
    await advance(); expect(h.calls.map(call => call[0])).to.deep.equal(['post', 'redirect'])
    expect(handoff).to.include({ status: 'submitted', requestId })
    if (mode === 'abort') controller.abort(); else current = false
    // Drive the actual native receiver/consumer after cancellation, not just the H5 Promise.
    const native = nativeHarness({ record: null }); let receiver
    runMini('pages/index/index.js', { Page: value => { receiver = value }, getApp: () => native.app, Date: { now: () => 1000 } })
    receiver.onWebMessage({ detail: { data: [h.calls[0][1]] } }); native.rawLoad(Object.fromEntries(new URL(h.calls[1][1].url, 'https://native.local').searchParams))
    expect(native.page.data.written).to.equal(true)
    h.calls[1][1].success()
    expect(await pending).to.include({ status: 'transferred', requestId }); expect(timers.size).to.equal(0)
  })
  it('keeps timeout after dispatch explicitly unknown and non-cancellable', async () => {
    const h = miniHost({ redirectPending: true }); let timeout
    h.host.setTimeout = callback => { timeout = callback; return 1 }; h.host.clearTimeout = () => {}
    const pending = rejection(saveOutputBlob({ blob: new Blob(['a']), host: h.host }))
    await advance(); timeout()
    const error = await pending
    expect(error.name).not.to.equal('AbortError'); expect(error.message).to.include('已提交').and.include('勿重复下载')
  })
  it('reports an unknown native outcome rather than cancellation on redirect failure after dispatch', async () => {
    const h = miniHost({ redirectPending: true })
    const pending = rejection(saveOutputBlob({ blob: new Blob(['a']), host: h.host }))
    await advance(); h.calls[1][1].fail()
    const error = await pending
    expect(error.name).not.to.equal('AbortError'); expect(error.message).to.include('已提交').and.include('无法撤回')
  })
})


const businessConfig = JSON.parse(readMini('utils/app-config.json'))
const navigation = () => runMini('utils/navigation.js', {})
const webPage = (orientation = 'portrait', config = businessConfig) => {
  const definition = runMini('utils/webview-page.js', { getApp: () => ({ globalData: { pendingDownloads: {}, consumedDownloads: {} } }), Date }).createWebViewPage(config, orientation)
  return { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value) } }
}

describe('parameterized source return and reusable mini-program framework', () => {
  for (const orientation of ['portrait', 'landscape']) it(`roundtrips H5 -> native download -> ${orientation} web-view with URL state intact`, async () => {
    const h = miniHost()
    const url = `https://kit.chaoyoufan.cn/juyiting?view=outputs&taskId=42&nativeOrientation=${orientation}#result`
    h.host.location.href = url
    await saveOutputBlob({ blob: new Blob(['a']), item: { name: 'a.pdf' }, host: h.host, returnTarget: { url, label: '返回成果列表' } })
    const native = nativeHarness({ record: null }); let receiver
    runMini('pages/index/index.js', { Page: value => { receiver = value }, getApp: () => native.app, Date: { now: () => 1000 } })
    receiver.onWebMessage({ detail: { data: [h.calls[0][1]] } })
    const options = Object.fromEntries(new URL(h.calls[1][1].url, 'https://native.local').searchParams)
    native.rawLoad(options)
    expect(native.page.data).to.include({ written: true, returnLabel: '返回成果列表', fileName: 'a.pdf' })
    await native.page.returnToSource()
    const route = native.calls.find(call => call[0] === 'return')[1]
    expect(route).to.include(orientation === 'landscape' ? '/pages/landscape/' : '/pages/index/')
    const destination = webPage(orientation)
    destination.onLoad(Object.fromEntries(new URL(route, 'https://native.local').searchParams))
    const returned = new URL(destination.data.url)
    expect(returned.origin + returned.pathname).to.equal('https://kit.chaoyoufan.cn/juyiting')
    expect(returned.searchParams.get('taskId')).to.equal('42')
    expect(returned.searchParams.get('view')).to.equal('outputs')
    expect(returned.searchParams.get('nativeOrientation')).to.equal(orientation)
    expect(returned.hash).to.equal('#result')
    expect(native.calls.some(call => call[0] === 'unlink')).to.equal(true)
  })
  for (const url of [
    'https://evil.example/juyiting', 'https://kit.chaoyoufan.cn.evil.example/juyiting',
    'javascript:alert(1)', '//evil.example/juyiting', 'http://kit.chaoyoufan.cn/juyiting',
    'https://user:secret@kit.chaoyoufan.cn/juyiting', 'https://kit.chaoyoufan.cn/oauth/callback',
    'https://kit.chaoyoufan.cn/juyiting?token=secret', 'https://kit.chaoyoufan.cn/juyiting?code=secret',
    'https://kit.chaoyoufan.cn/juyiting?redirect=https%3A%2F%2Fevil.example',
    'https://kit.chaoyoufan.cn/juyiting#access_token=secret', 'https://kit.chaoyoufan.cn/juyiting?view=%GG',
    'https://kit.chaoyoufan.cn/juyiting?view=%0a', 'https://kit.chaoyoufan.cn/juyiting?view=a&view=b',
    'https://kit.chaoyoufan.cn/juyiting/%5cevil', 'https://kit.chaoyoufan.cn/juyiting?view=%FF'
  ]) it(`rejects unsafe return target in both browser and native policy: ${url}`, () => {
    expect(navigation().validateWebUrl(url, businessConfig.webPolicy)).to.equal(null)
    expect(() => validateReturnTarget(url, sourceUrl, businessConfig.webPolicy)).to.throw('返回地址无效')
    const native = nativeHarness()
    native.rawLoad({ requestId, returnUrl: encodeURIComponent(url), returnLabel: '返回', orientation: 'portrait' })
    expect(native.page.data).to.include({ written: false, done: true })
    expect(native.page.data.message).to.include('返回地址无效')
    expect(native.calls.some(call => call[0] === 'write')).to.equal(false)
  })
  for (const options of [{}, { requestId }, { requestId, ...returnOptions, returnUrl: '%' }, { requestId, ...returnOptions, orientation: 'auto' }]) it(`fails visibly without a valid return context: ${JSON.stringify(options)}`, async () => {
    const native = nativeHarness(); native.rawLoad(options)
    expect(native.page.data.done).to.equal(true)
    expect(native.calls.some(call => call[0] === 'write')).to.equal(false)
    await native.page.returnToSource()
    expect(native.calls.some(call => call[0] === 'return')).to.equal(false)
    expect(native.calls.some(call => call[0] === 'back')).to.equal(true)
  })
  it('does not load invalid, empty, encoded external or token-bearing web-view URL parameters', () => {
    for (const url of ['', '%', encodeURIComponent('https://evil.example'), encodeURIComponent('https://kit.chaoyoufan.cn/juyiting?token=secret')]) {
      const page = webPage(); page.onLoad({ url })
      expect(page.data.url).to.equal('')
      expect(page.data.message).to.include('地址无效')
    }
  })
  it('uses configured home/workspace only for cold starts, not parameterized returns', () => {
    const portrait = webPage(); portrait.onLoad(); expect(portrait.data.url).to.equal(businessConfig.entries.portrait.default + '&nativeOrientation=portrait')
    portrait.onLoad({ entry: 'fallback' }); expect(portrait.data.url).to.equal(businessConfig.entries.portrait.fallback + '&nativeOrientation=portrait')
    const landscape = webPage('landscape'); landscape.onLoad(); expect(landscape.data.url).to.equal(businessConfig.entries.landscape.default + '&nativeOrientation=landscape')
  })
  it('replaces only the orientation marker without losing parameters or hash', () => {
    const source = 'https://kit.chaoyoufan.cn/juyiting?nativeOrientation=landscape&taskId=42#result'
    expect(navigation().withOrientation(source, 'portrait')).to.equal('https://kit.chaoyoufan.cn/juyiting?taskId=42&nativeOrientation=portrait#result')
  })
  it('rejects old or unsupported wire envelopes rather than maintaining dual business protocols', () => {
    const state = { pendingDownloads: {}, consumedDownloads: {} }
    const accept = runMini('utils/file-messages.js', { Date }).acceptFileMessages
    const current = asMessage(payload())
    accept({ detail: { data: [{ ...current, protocolVersion: 2 }, { ...current, messageType: 'business.download' }, { protocol: 'juyiting-file-download-v1', ...payload() }] } }, state)
    expect(Object.keys(state.pendingDownloads)).to.deep.equal([])
  })
  it('supports another application using only deployment policy and caller parameters', async () => {
    const config = { ...businessConfig, applicationName: '资料中心', filePrefix: 'documents-', entries: { portrait: { default: 'https://documents.example/' }, landscape: { default: 'https://documents.example/reports' } }, webPolicy: { origins: ['https://documents.example'], paths: ['/', '/reports'], queryKeys: ['view', 'nativeOrientation'] } }
    const target = 'https://documents.example/reports?view=annual#summary'
    const h = miniHost(); h.host.location.href = target
    await saveInMiniProgram({ blob: new Blob(['a']), filename: 'annual.pdf', host: h.host, returnTarget: { url: target, label: '返回报告' }, webPolicy: config.webPolicy })
    const native = nativeHarness({ config }); native.rawLoad(Object.fromEntries(new URL(h.calls[1][1].url, 'https://native.local').searchParams))
    expect(native.page.data).to.include({ applicationName: '资料中心', returnLabel: '返回报告', written: true })
    expect(native.page.filePath).to.include('/documents-')
    await native.page.returnToSource()
    const route = native.calls.find(call => call[0] === 'return')[1]
    const page = webPage('portrait', config); page.onLoad(Object.fromEntries(new URL(route, 'https://native.local').searchParams))
    expect(page.data.url).to.equal('https://documents.example/reports?view=annual&nativeOrientation=portrait#summary')
  })
  it('keeps business literals outside the reusable native modules and download markup', () => {
    for (const file of ['utils/navigation.js', 'utils/file-messages.js', 'utils/webview-page.js', 'utils/download-page.js', 'utils/application.js', 'pages/download/index.wxml']) {
      expect(readMini(file), file).not.to.match(/聚义厅|chaoyoufan|juyiting/)
    }
  })
  it('captures the return URL at invocation rather than after asynchronous encoding', async () => {
    const h = miniHost({ deferredRead: true }); const original = h.host.location.href
    const pending = saveOutputBlob({ blob: new Blob(['a']), host: h.host })
    await advance(); h.host.location.href = 'https://kit.chaoyoufan.cn/juyiting?view=other'; h.reader().complete()
    await pending
    expect(new URL(h.calls[1][1].url, 'https://native.local').searchParams.get('returnUrl')).to.equal(original)
  })
  it('allows retrying navigation after a native redirect failure without deleting unrelated files', async () => {
    const h = nativeHarness(); h.page.onLoad({ requestId })
    h.wx.redirectTo = options => { h.calls.push(['return-failed', options.url]); options.fail() }
    await h.page.returnToSource()
    expect(h.page.returning).to.equal(false)
    expect(h.page.filePath).to.equal(null)
    expect(h.calls.some(call => call[0] === 'toast')).to.equal(true)
    h.wx.redirectTo = options => h.calls.push(['return', options.url])
    await h.page.returnToSource()
    expect(h.calls.filter(call => call[0] === 'unlink')).to.have.length(1)
    expect(h.calls.find(call => call[0] === 'return')[1]).to.equal('/pages/index/index?url=' + encodeURIComponent(sourceUrl))
  })
  it('rejects unsafe caller context before posting bytes', async () => {
    const h = miniHost()
    const error = await rejection(saveOutputBlob({ blob: new Blob(['a']), host: h.host, returnTarget: { url: 'https://evil.example/', label: '返回' } }))
    expect(error.message).to.include('返回地址无效')
    expect(h.calls).to.deep.equal([])
  })
})
