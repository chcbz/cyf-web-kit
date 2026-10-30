// Only this feature's strict UUID-v4 basename is owned here; never sweep other user files.
const OWNED_DOWNLOAD = /^juyiting-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}-[^/\\\x00-\x1f]+$/
App({
  onLaunch() {
    const fs = wx.getFileSystemManager()
    const root = wx.env.USER_DATA_PATH
    fs.readdir({ dirPath: root, success: ({ files }) => {
      for (const name of files) {
        if (!OWNED_DOWNLOAD.test(name)) continue
        const id = name.slice('juyiting-'.length, 'juyiting-'.length + 36)
        // readdir is asynchronous: a current-session handoff/write may now own this name.
        if (this.globalData.pendingDownloads[id] || this.globalData.consumedDownloads[id] != null) continue
        fs.unlink({ filePath: `${root}/${name}`, fail: () => {} })
      }
    }, fail: () => {} })
  },
  globalData: { pendingDownloads: Object.create(null), consumedDownloads: Object.create(null) }
})
