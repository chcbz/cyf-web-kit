const HOME_URL = 'https://kit.chaoyoufan.cn/'
const HALL_URL = 'https://kit.chaoyoufan.cn/juyiting'

// A cold launch opens the introduction; native landscape fallback returns to the workbench.
const portraitUrl = entry => {
  const fallback = entry === 'fallback'
  return (fallback ? HALL_URL : HOME_URL) + '?nativeOrientation=portrait&entry=' + (fallback ? 'fallback' : 'direct')
}

Page({
  data: {
    url: portraitUrl('direct')
  },

  onWebMessage(event) {
    const app = getApp()
    const items = event?.detail?.data
    if (!Array.isArray(items)) return
    for (const item of items) {
      const payload = item?.protocol ? item : item?.data
      if (!payload || payload.protocol !== 'juyiting-file-download-v1' ||
          typeof payload.transferId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.transferId) ||
          typeof payload.name !== 'string' || payload.name.length > 180 ||
          typeof payload.mime !== 'string' || payload.mime.length > 100 ||
          !Number.isInteger(payload.size) || payload.size < 1 || payload.size > 8 * 1024 * 1024 ||
          typeof payload.base64 !== 'string' || payload.base64.length > 11200000 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.base64)) continue
      const now = Date.now()
      for (const [id, pending] of Object.entries(app.globalData.pendingDownloads)) if (now - pending.receivedAt > 30000) delete app.globalData.pendingDownloads[id]
      for (const [id, usedAt] of Object.entries(app.globalData.consumedDownloads)) if (now - usedAt > 5 * 60 * 1000) delete app.globalData.consumedDownloads[id]
      if (app.globalData.consumedDownloads[payload.transferId] != null || app.globalData.pendingDownloads[payload.transferId]) continue
      if (Object.keys(app.globalData.pendingDownloads).length >= 3 || Object.keys(app.globalData.consumedDownloads).length >= 100) continue
      app.globalData.pendingDownloads[payload.transferId] = { ...payload, mime: payload.mime.split(';', 1)[0].trim().toLowerCase(), receivedAt: now }
    }
  },

  onLoad(options = {}) {
    this.setData({ url: portraitUrl(options.entry) })
  }
})
