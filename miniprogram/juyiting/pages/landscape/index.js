const { createWebViewPage } = require('../../utils/webview-page')
const config = require('../../utils/app-config.js')
Page(createWebViewPage(config, 'landscape'))
