const { createWebViewPage } = require('../../utils/webview-page')
const config = require('../../utils/app-config.json')
Page(createWebViewPage(config, 'portrait'))
