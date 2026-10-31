const { validateWebUrl, decodeOption, withOrientation } = require('./navigation')
const { acceptFileMessages } = require('./file-messages')

const createWebViewPage = (config, orientation) => ({
  data: { url: '', message: '' },
  onWebMessage(event) { acceptFileMessages(event, getApp().globalData) },
  onLoad(options = {}) {
    const entries = config.entries[orientation]
    const defaultUrl = Object.prototype.hasOwnProperty.call(entries, options.entry) ? entries[options.entry] : entries.default
    const url = validateWebUrl(options.url == null ? defaultUrl : decodeOption(options.url), config.webPolicy)
    this.setData(url ? { url: withOrientation(url, orientation), message: '' } : { url: '', message: '页面地址无效，请重新打开小程序。' })
  }
})
module.exports = { createWebViewPage }
