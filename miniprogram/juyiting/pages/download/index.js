const MAX_BYTES = 8 * 1024 * 1024
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/
const utf8Length = value => [...value].reduce((size, char) => { const point = char.codePointAt(0); return size + (point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4) }, 0)
const truncateBytes = (value, budget) => {
  let result = ''
  for (const char of value) { if (utf8Length(result + char) > budget) break; result += char }
  return result
}
const safeName = (value, prefix) => {
  const name = [...value].map(char => /[\\/:*?"<>|\x00-\x1f]/.test(char) ? '_' : char).join('').replace(/^\.+/, '').trim() || 'download.bin'
  const extension = name.match(/\.[a-zA-Z0-9]{1,16}$/)?.[0] || ''
  const budget = 240 - utf8Length(prefix)
  return truncateBytes(extension ? name.slice(0, -extension.length) : name, budget - utf8Length(extension)) + extension
}
const TEMP_NOTICE = '返回或退出时会尝试删除临时文件，请先分享或通过系统菜单保存。返回聚义厅时网页会重新载入。'

Page({
  data: { message: '正在接收文件…', done: false, written: false, fileType: '', canShare: typeof wx.shareFileMessage === 'function' },
  onLoad(options = {}) {
    this.disposed = false
    this.terminal = false
    this.transferId = options.transferId
    this.returnEntry = options.entry === 'landscape' ? 'landscape' : 'portrait'
    if (!ID.test(this.transferId || '')) return this.finish('下载请求无效。')
    this.waitDeadline = Date.now() + 3000
    this.waitTimer = setInterval(() => this.consume(), 100)
    this.consume()
  },
  stopWaiting() { if (this.waitTimer != null) clearInterval(this.waitTimer); this.waitTimer = null },
  discardPending() {
    if (!ID.test(this.transferId || '')) return
    const state = getApp().globalData
    delete state.pendingDownloads[this.transferId]
    state.consumedDownloads[this.transferId] = Date.now()
  },
  removeOwnFile(path = this.filePath) {
    if (!path) return Promise.resolve(true)
    return new Promise(resolve => wx.getFileSystemManager().unlink({
      filePath: path,
      success: () => { if (path === this.filePath) this.filePath = null; resolve(true) },
      fail: () => { this.updateData({ message: '临时文件删除失败，文件可能仍在小程序目录中；请点击返回重试清理。', done: true }); resolve(false) }
    }))
  },
  onUnload() { this.disposed = true; this.terminal = true; this.stopWaiting(); this.discardPending(); this.removeOwnFile() },
  consume() {
    if (this.disposed || this.terminal) return
    if (Date.now() >= this.waitDeadline) return this.finish('未收到文件数据，请返回后重试。')
    const app = getApp()
    const record = app.globalData.pendingDownloads[this.transferId]
    if (!record) {
      if (Date.now() >= this.waitDeadline) this.finish('未收到文件数据，请返回后重试。')
      return
    }
    this.stopWaiting()
    this.terminal = true
    delete app.globalData.pendingDownloads[this.transferId]
    if (app.globalData.consumedDownloads[this.transferId] || Date.now() - record.receivedAt > 30000) return this.finish('文件请求已过期或已处理。')
    app.globalData.consumedDownloads[this.transferId] = Date.now()
    const mime = typeof record.mime === 'string' ? record.mime.split(';', 1)[0].trim().toLowerCase() : ''
    const encodedLimit = Math.ceil(MAX_BYTES / 3) * 4
    if (record.protocol !== 'juyiting-file-download-v1' || record.transferId !== this.transferId ||
        !Number.isInteger(record.size) || record.size < 1 || record.size > MAX_BYTES ||
        typeof record.base64 !== 'string' || record.base64.length > encodedLimit ||
        record.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(record.base64) ||
        typeof record.name !== 'string' || record.name.length > 180 || !MIME.test(mime)) return this.finish('文件数据无效或超过8 MiB限制。')
    let bytes
    try { bytes = wx.base64ToArrayBuffer(record.base64) } catch { return this.finish('文件数据解码失败。') }
    if (bytes.byteLength !== record.size || bytes.byteLength > MAX_BYTES) return this.finish('文件长度不匹配，未写入文件。')
    const prefix = `juyiting-${this.transferId}-`
    const path = `${wx.env.USER_DATA_PATH}/${prefix}${safeName(record.name, prefix)}`
    wx.getFileSystemManager().writeFile({
      filePath: path, data: bytes,
      success: () => {
        this.filePath = path
        if (this.disposed || this.returning) { this.removeOwnFile(path); return }
        this.fileType = ({ 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx' })[mime] || ''
        this.setData({ done: true, written: true, fileType: this.fileType, message: `文件已写入小程序临时目录；可打开支持的文档或分享。${TEMP_NOTICE}` })
      },
      fail: () => this.finish('文件写入失败，请检查小程序存储空间。')
    })
  },
  updateData(value) { if (!this.disposed) this.setData(value) },
  openFile() {
    if (this.disposed) return
    if (!this.filePath || !this.fileType) return this.finish('该格式不支持系统文档打开；可尝试分享文件。')
    wx.openDocument({
      filePath: this.filePath, fileType: this.fileType, showMenu: true,
      success: () => this.updateData({ done: true, message: `系统已打开文件；如需保存或转发，请使用系统文件菜单。${TEMP_NOTICE}` }),
      fail: () => this.updateData({ done: true, message: `此设备未能打开该文件，可尝试分享。${TEMP_NOTICE}` })
    })
  },
  shareFile() {
    if (this.disposed) return
    if (!this.filePath || typeof wx.shareFileMessage !== 'function') return this.updateData({ done: true, message: `当前微信版本不支持分享文件。${TEMP_NOTICE}` })
    wx.shareFileMessage({
      filePath: this.filePath,
      success: () => this.updateData({ done: true, message: `微信已接收分享操作；请在分享面板确认目标。${TEMP_NOTICE}` }),
      fail: () => this.updateData({ done: true, message: `分享未完成。${TEMP_NOTICE}` })
    })
  },
  finish(message) { this.terminal = true; this.stopWaiting(); this.discardPending(); this.updateData({ message, done: true }) },
  async returnToHall() {
    if (this.disposed || this.returning) return
    this.returning = true
    this.terminal = true; this.stopWaiting(); this.discardPending()
    const removed = await this.removeOwnFile()
    if (this.disposed) return
    if (!removed) { this.returning = false; return }
    this.updateData({ written: false, done: true, message: '临时文件已删除，正在返回聚义厅。' })
    const url = this.returnEntry === 'landscape' ? '/pages/landscape/index?entry=portrait' : '/pages/index/index?entry=fallback'
    wx.redirectTo({ url, fail: () => { this.returning = false; if (!this.disposed) wx.showToast({ title: '返回失败，请使用左上角返回', icon: 'none' }) } })
  }
})
