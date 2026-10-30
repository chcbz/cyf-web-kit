import { expect } from 'chai'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { saveOutputBlob } from '../src/utils/outputDownload.js'
import { savePersonalWorkspaceBlob } from '../src/composables/usePersonalWorkspace.js'
import vm from 'node:vm'
import path from 'node:path'

const miniRoot = fileURLToPath(new URL('../miniprogram/juyiting', import.meta.url))
const readMini = relative => readFileSync(path.join(miniRoot, relative), 'utf8')

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
  it('registers both web-view message handlers and native download route', () => {
    expect(readMini('app.json')).to.include('pages/download/index')
    for (const page of ['index', 'landscape']) {
      expect(readMini(`pages/${page}/index.wxml`)).to.include('bindmessage="onWebMessage"')
      expect(readMini(`pages/${page}/index.js`)).to.include('juyiting-file-download-v1')
    }
  })

  it('accepts the documented message event array shapes and bounds pending handoffs', () => {
    const source = readMini('pages/index/index.js')
    let definition
    const state = { pendingDownloads: Object.create(null), consumedDownloads: Object.create(null) }
    const context = { Page: value => { definition = value }, getApp: () => ({ globalData: state }), Date }
    vm.runInNewContext(source, context)
    const payload = { protocol: 'juyiting-file-download-v1', transferId: '12345678-1234-4234-8234-123456789abc', name: 'a.txt', mime: 'text/plain', size: 1, base64: 'YQ==' }
    definition.onWebMessage({ detail: { data: [payload, { data: { ...payload, transferId: '22345678-1234-4234-8234-123456789abc' } }] } })
    expect(Object.keys(state.pendingDownloads)).to.have.length(2)
    expect(state.pendingDownloads[payload.transferId].size).to.equal(1)
    definition.onWebMessage({ detail: { data: [{ ...payload, transferId: '32345678-1234-4234-8234-123456789abc', size: 8 * 1024 * 1024 + 1 }] } })
    expect(Object.keys(state.pendingDownloads)).to.have.length(2)
  })

  it('rejects malformed and oversized event data before decoding or writing', () => {
    const source = readMini('pages/download/index.js')
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
    vm.runInNewContext(source, context)
    const page = { ...definition, data: { ...definition.data }, setData(value) { Object.assign(this.data, value) }, finish: definition.finish }
    page.transferId = '12345678-1234-4234-8234-123456789abc'
    app.globalData.pendingDownloads[page.transferId] = { protocol: 'juyiting-file-download-v1', transferId: page.transferId, name: 'x.txt', mime: 'text/plain', size: 8 * 1024 * 1024 + 1, base64: 'AAAA', receivedAt: Date.now() }
    page.consume()
    expect(calls).to.deep.equal([])
    expect(page.data.message).to.include('无效或超过8 MiB')
  })
})
const transferId = '12345678-1234-4234-8234-123456789abc'
const payload = overrides => ({ protocol: 'juyiting-file-download-v1', transferId, name: 'a.pdf', mime: 'application/pdf', size: 1, base64: 'YQ==', receivedAt: 1000, ...overrides })
const nativeHarness = ({ record = payload(), delayedWrite = false, share = true, unlinkFails = false } = {}) => {
  let definition, clock = 1000, write
  const calls = [], timers = new Set()
  const app = { globalData: { pendingDownloads: record ? { [transferId]: record } : {}, consumedDownloads: {} } }
  const wx = {
    env: { USER_DATA_PATH: '/user' },
    base64ToArrayBuffer: value => { calls.push(['decode']); const buffer = Buffer.from(value, 'base64'); return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) },
    getFileSystemManager: () => ({
      writeFile: options => { write = options; calls.push(['write', options.filePath]); if (!delayedWrite) options.success() },
      unlink: options => { calls.push(['unlink', options.filePath]); if (unlinkFails) options.fail?.(); else options.success?.() }
    }),
    openDocument: options => { calls.push(['open', options]); options.success() },
    redirectTo: options => calls.push(['return', options.url]), showToast() {}
  }
  if (share) wx.shareFileMessage = options => { calls.push(['share', options]); options.success() }
  vm.runInNewContext(readMini('pages/download/index.js'), {
    Page: value => { definition = value }, getApp: () => app, wx,
    Date: { now: () => clock }, setInterval: () => { timers.add(1); return 1 }, clearInterval: id => timers.delete(id)
  })
  const page = { ...definition, data: { ...definition.data }, setData(value) { calls.push(['setData', value]); Object.assign(this.data, value) } }
  return { page, app, calls, timers, now: value => { clock = value }, write: () => write, wx }
}

describe('native file lifetime and terminal states', () => {
  it('writes, exposes return immediately, opens and shares the exact owned file, and deletes on return', async () => {
    const h = nativeHarness(); h.page.onLoad({ transferId, entry: 'landscape' })
    expect(h.page.data).to.include({ done: true, written: true, fileType: 'pdf' })
    expect(h.timers.size).to.equal(0)
    const filePath = h.page.filePath
    h.page.openFile(); h.page.shareFile(); await h.page.returnToHall()
    expect(h.calls.find(call => call[0] === 'open')[1].filePath).to.equal(filePath)
    expect(h.calls.find(call => call[0] === 'share')[1].filePath).to.equal(filePath)
    expect(h.calls).to.deep.include(['unlink', filePath])
    expect(h.calls).to.deep.include(['return', '/pages/landscape/index?entry=portrait'])
    expect(h.page.data.written).to.equal(false)
  })
  it('keeps return available with unavailable share and truthful open/share failures', async () => {
    const h = nativeHarness({ share: false }); h.page.onLoad({ transferId }); h.page.shareFile()
    expect(h.page.data.done).to.equal(true)
    expect(h.page.data.message).to.include('不支持分享').and.include('删除临时文件')
    h.wx.openDocument = options => options.fail(); h.page.openFile()
    expect(h.page.data.message).to.include('未能打开')
    h.wx.shareFileMessage = options => options.fail(); h.page.shareFile()
    expect(h.page.data.message).to.include('分享未完成')
    await h.page.returnToHall()
    expect(h.calls.some(call => call[0] === 'return')).to.equal(true)
  })
  it('accepts charset and bounds Unicode basename plus prefix to 240 UTF-8 bytes preserving extension', () => {
    const h = nativeHarness({ record: payload({ mime: ' Text/Plain;charset=utf-8 ', name: '文'.repeat(170) + '.txt' }) }); h.page.onLoad({ transferId })
    expect(h.page.data.written).to.equal(true)
    expect(Buffer.byteLength(path.posix.basename(h.page.filePath))).to.be.at.most(240)
    expect(h.page.filePath).to.match(/\.txt$/)
  })
  for (const [label, record, expected] of [
    ['oversize', payload({ size: 8 * 1024 * 1024 + 1 }), '无效或超过'],
    ['size mismatch', payload({ size: 2 }), '长度不匹配']
  ]) it(`rejects ${label} without writing`, () => {
    const h = nativeHarness({ record }); h.page.onLoad({ transferId })
    expect(h.calls.some(call => call[0] === 'write')).to.equal(false)
    expect(h.page.data.message).to.include(expected)
    expect(h.timers.size).to.equal(0)
  })
  it('rejects a present late arrival beyond deadline; terminal never consumes', () => {
    const h = nativeHarness({ record: null }); h.page.onLoad({ transferId })
    h.now(4000); h.app.globalData.pendingDownloads[transferId] = payload({ receivedAt: 3999 }); h.page.consume()
    expect(h.page.data.message).to.include('未收到'); expect(h.timers.size).to.equal(0)
    expect(h.app.globalData.pendingDownloads).not.to.have.property(transferId)
    h.app.globalData.pendingDownloads[transferId] = payload(); h.page.consume()
    expect(h.calls.some(call => call[0] === 'write')).to.equal(false)
  })
  it('unload mid-write never setData and late success cleans only its own file', () => {
    const h = nativeHarness({ delayedWrite: true }); h.page.onLoad({ transferId })
    const write = h.write(); h.page.onUnload(); const count = h.calls.filter(call => call[0] === 'setData').length
    write.success(); write.fail()
    expect(h.calls.filter(call => call[0] === 'setData')).to.have.length(count)
    expect(h.calls.filter(call => call[0] === 'unlink')).to.deep.equal([['unlink', write.filePath]])
    expect(h.app.globalData.pendingDownloads).not.to.have.property(transferId)
  })
  it('cleans late writes after explicit return too', async () => {
    const h = nativeHarness({ delayedWrite: true }); h.page.onLoad({ transferId }); await h.page.returnToHall()
    const count = h.calls.filter(call => call[0] === 'setData').length; h.write().success()
    expect(h.calls.filter(call => call[0] === 'setData')).to.have.length(count)
    expect(h.calls).to.deep.include(['unlink', h.write().filePath])
  })
  it('cleans completed file on unload and blocks native and web-view replay', () => {
    const h = nativeHarness(); h.page.onLoad({ transferId }); const own = h.page.filePath; h.page.onUnload()
    expect(h.calls).to.deep.include(['unlink', own])
    let receiver
    vm.runInNewContext(readMini('pages/index/index.js'), { Page: value => { receiver = value }, getApp: () => h.app, Date: { now: () => 1100 } })
    receiver.onWebMessage({ detail: { data: [payload()] } })
    expect(h.app.globalData.pendingDownloads).not.to.have.property(transferId)
    h.app.globalData.pendingDownloads[transferId] = payload(); h.page.onLoad({ transferId })
    expect(h.calls.filter(call => call[0] === 'write')).to.have.length(1)
    expect(h.page.data.message).to.include('已处理')
  })
  it('retains path and does not navigate or claim deletion when unlink fails; unload retries', async () => {
    const h = nativeHarness({ unlinkFails: true }); h.page.onLoad({ transferId }); const own = h.page.filePath
    await h.page.returnToHall()
    expect(h.page.filePath).to.equal(own); expect(h.page.returning).to.equal(false)
    expect(h.page.data.message).to.include('删除失败'); expect(h.page.data.message).not.to.include('已删除')
    expect(h.calls.some(call => call[0] === 'return')).to.equal(false)
    h.page.onUnload()
    expect(h.calls.filter(call => call[0] === 'unlink')).to.have.length(2)
  })
  it('waits for unlink confirmation before declaring deletion or navigating', async () => {
    const h = nativeHarness(); h.page.onLoad({ transferId }); const own = h.page.filePath; let unlink
    h.wx.getFileSystemManager = () => ({ unlink: options => { unlink = options } })
    const returning = h.page.returnToHall()
    expect(h.page.filePath).to.equal(own); expect(h.calls.some(call => call[0] === 'return')).to.equal(false)
    unlink.success(); await returning
    expect(h.page.filePath).to.equal(null); expect(h.page.data.message).to.include('已删除')
    expect(h.calls.some(call => call[0] === 'return')).to.equal(true)
  })
  it('launch sweep deletes strict owned orphan names only, skipping IDs acquired while readdir was pending', () => {
    let app, readdir
    const owned = id => `juyiting-${id}-文件.txt`
    const active = '22345678-1234-4234-8234-123456789abc', consumed = '32345678-1234-4234-8234-123456789abc'
    const files = [owned(transferId), owned(active), owned(consumed), 'a.txt', 'juyiting-not-a-uuid-file.txt', `juyiting-${transferId}-../other`]
    const removed = []
    vm.runInNewContext(readMini('app.js'), { App: value => { app = value }, wx: { env: { USER_DATA_PATH: '/user' }, getFileSystemManager: () => ({ readdir: options => { readdir = options }, unlink: options => removed.push(options.filePath) }) } })
    app.onLaunch(); app.globalData.pendingDownloads[active] = payload(); app.globalData.consumedDownloads[consumed] = 1000
    readdir.success({ files })
    expect(removed).to.deep.equal([`/user/${owned(transferId)}`])
  })
})

const miniHost = ({ deferredRead = false, redirectPending = false } = {}) => {
  const calls = []; let reader
  const host = { __wxjs_environment: 'miniprogram', location: { href: 'https://example.org/?nativeOrientation=portrait' }, setTimeout, clearTimeout,
    crypto: { randomUUID: () => transferId },
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
    expect(h.calls[0][1]).to.include({ mime: 'text/plain', size: 1, name: '_资料.txt' })
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
    expect(handoff).to.include({ status: 'submitted', transferId })
    if (mode === 'abort') controller.abort(); else current = false
    // Drive the actual native receiver/consumer after cancellation, not just the H5 Promise.
    const native = nativeHarness({ record: null }); let receiver
    vm.runInNewContext(readMini('pages/index/index.js'), { Page: value => { receiver = value }, getApp: () => native.app, Date: { now: () => 1000 } })
    receiver.onWebMessage({ detail: { data: [h.calls[0][1]] } }); native.page.onLoad({ transferId })
    expect(native.page.data.written).to.equal(true)
    h.calls[1][1].success()
    expect(await pending).to.include({ status: 'transferred', transferId }); expect(timers.size).to.equal(0)
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
