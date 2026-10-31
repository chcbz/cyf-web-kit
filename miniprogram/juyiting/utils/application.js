// Only this feature's strict UUID-v4 basename is owned here; never sweep other user files.
const { ID } = require('./file-messages')
const ownsFile = (name, prefix) => name.startsWith(prefix) && ID.test(name.slice(prefix.length, prefix.length + 36)) && name[prefix.length + 36] === '-' &&
  name.length > prefix.length + 37 && !/[\\/\x00-\x1f]/.test(name.slice(prefix.length + 37))
const createApplication = config => ({
  onLaunch() {
    const fs = wx.getFileSystemManager()
    const root = wx.env.USER_DATA_PATH
    fs.readdir({ dirPath: root, success: ({ files }) => {
      for (const name of files) {
        if (!ownsFile(name, config.filePrefix)) continue
        const id = name.slice(config.filePrefix.length, config.filePrefix.length + 36)
        // readdir is asynchronous: a current-session handoff/write may now own this name.
        if (this.globalData.pendingDownloads[id] || this.globalData.consumedDownloads[id] != null) continue
        fs.unlink({ filePath: `${root}/${name}`, fail: () => {} })
      }
    }, fail: () => {} })
  },
  globalData: { pendingDownloads: Object.create(null), consumedDownloads: Object.create(null) }
})

module.exports = { createApplication }
