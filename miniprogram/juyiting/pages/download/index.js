const { createDownloadPage } = require('../../utils/download-page')
const config = require('../../utils/app-config.js')
Page(createDownloadPage(config))
