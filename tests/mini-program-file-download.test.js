import { expect } from 'chai'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'

const miniRoot = process.env.MINIPROGRAM_PROJECT || 'C:/Users/Think/WeChatProjects/juyiting'
const readMini = relative => readFileSync(path.join(miniRoot, relative), 'utf8')

describe('Juyi Hall mini-program file bridge', () => {
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
