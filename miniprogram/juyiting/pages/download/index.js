const { createDownloadPage } = require('../../utils/download-page')
const config = require('../../utils/app-config.json')
Page(createDownloadPage(config))
