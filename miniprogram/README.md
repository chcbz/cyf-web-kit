# 小程序容器与文件下载公共框架

2026-10-31 核对范围：Web `2d95422951289ca0b3ab74aa805f7a4b03cbecdd` 后的本任务未提交候选；非线上状态。`juyiting/` 是权威源码，开发者工具目录仅为镜像，不纳管私人配置、登录信息或凭据。

## 2026-11-01 原生启动修复（基线 Web 9a8df904）

小程序入口不再 require JSON。修改共享配置后运行 `node scripts/generate-mini-program-config.mjs`，提交生成的 `juyiting/utils/app-config.js`；四个原生入口只加载该 JS 模块，H5 仍导入 JSON。回归校验两份配置完全一致，且原生 VM 加载器拒绝 JSON，避免 Node 的 JSON 扩展掩盖平台错误。

## 业务配置与公共能力

- `juyiting/utils/app-config.json`：部署业务配置。集中维护应用名称、默认返回文字、临时文件命名空间、横竖屏冷启动入口映射，以及允许的 HTTPS origin、页面路径和公开 query 键。其他业务通过替换此配置接入，不修改公共模块。
- `utils/webview-page.js`：两种屏幕方向共用的容器工厂，校验 URL 后才给 web-view 赋值；无 URL 参数时才使用配置中的冷启动入口。参数非法时展示错误，不加载默认业务页掩盖失败。
- `utils/file-messages.js`：统一消息接收、大小限制、待处理队列与防重放。
- `utils/download-page.js`：文件校验/写入/打开/分享/清理/参数化返回。页面脚本仅注册工厂；WXML 的品牌和返回文字来自数据，不包含聚义厅业务入口。
- `utils/navigation.js`：原生端 URL 策略、参数解码、方向标记替换和公共容器返回路由；不依赖小程序中未确认可用的浏览器 URL 对象。
- `utils/application.js`：应用生命周期与严格命名空间的孤儿文件清理。
- H5 的 `src/utils/miniProgramBridge.js` 和 `miniProgramFileBridge.js` 是公共 SDK/文件交接能力；`outputDownload.js` 仅适配业务文件名、业务配置和桌面下载。应用清单、页面导航颜色与样式仍是此部署的展示配置。

## 参数化返回

H5 的 `saveOutputBlob` 支持：

```js
saveOutputBlob({
  blob,
  item: { name: '活动方案.pdf' },
  returnTarget: { url: window.location.href, label: '返回成果列表' }
})
```

省略 `returnTarget` 时，业务适配器使用调用时的当前网址和配置的返回文字。公共桥接在异步处理前固定该目标，通过下载页导航参数 `requestId / returnUrl / returnLabel / orientation` 传递；文件内容不放导航参数。下载页清理完成后将目标以 `url` 参数传给横屏或竖屏公共 web-view 页，后者再次校验后加载。

仅接受配置内 HTTPS 域名/路径及公开 query 键；不接受任意外站、凭据、OAuth code/token、重复 query 键、非法编码或带鉴权内容的片段。H5 还限制同源并在发送前提供错误反馈；原生校验是最终边界。新增业务路由/公开参数应明确配置，不开放任意 URL 或透传未知参数。失效返回参数不写文件，返回按钮仅尝试返回原生上一页。

当前只保留网址中的页面、公开参数与锚点，仍会重新创建 web-view；不恢复 Vue 内存中的弹窗、选中项、滚动位置或草稿。需要这类业务现场恢复时，由 H5 业务层按身份与页面作用域管理，不放进公共原生框架。

## 消息与生命周期

依 `api/docs/interface-standard.md` v1.2（2026-10-14），本轮同步切换唯一自有请求信封：

```json
{"protocolVersion":1,"requestId":"UUID-v4","messageType":"file.download","data":{"name":"活动方案.pdf","mime":"application/pdf","size":1,"base64":"YQ=="}}
```

微信 `bindmessage` 外层格式只作平台适配。旧 `juyiting-file-download-v1` 消息不再接受；必须配套升级 H5 与小程序，不能只发一端。单文件仍为8 MiB上限，鉴权读取和固定版本语义不变。

交接前支持取消及身份/视图失效；postMessage 是不可撤销交接点，后续失败/超时不报告取消成功。原生写入后展示文件名，无可用名称时展示大文件图标；正常状态不展示技术说明，必要失败提示保留。文件仍是临时文件，返回等待删除成功后才跳转；删除失败保留路径并提示重试，退出仅尽力清理。启动扫描严格命名空间、UUID和文件名，并跳过本会话 pending/consumed，避免误删新文件。

## 定向诊断与镜像同步

从 `web/` 运行（本机诊断不替代 Flow 或平台验收）：

```powershell
node --import tsx ./node_modules/mocha/bin/mocha.js --no-config --require ./tests/setup.js --reporter spec --exit tests/mini-program-file-download.test.js tests/juyiting-mini-program-orientation.test.js tests/output-delivery-rb05.test.js
$env:MINIPROGRAM_PROJECT = 'C:/Users/Think/WeChatProjects/juyiting'
node --import tsx ./node_modules/mocha/bin/mocha.js --no-config --require ./tests/setup.js --reporter spec --exit tests/mini-program-file-download.test.js tests/public-entry-navigation.test.js
Remove-Item Env:MINIPROGRAM_PROJECT
```

默认测试不依赖个人盘符；显式镜像校验要求 `pages/`、`utils/`、`app.js/json/wxss`、`sitemap.json` 文件集合及逐文件 SHA-256 完全一致。同步前备份、核对目标旧值，再合并复制本次变化；不覆盖 `project.private.config.json`，不删无关文件。运行源码按 `.gitattributes` 固定 LF。

正式测试/生产构建/制品/部署使用 Flow4403172，不在本机生产打包；develop 推送不自动发布。上传/发布另需授权，微信开发者工具和真机的 bridge 销毁事件顺序、打开/分享能力、参数解码与横竖屏返回均需单独验收。
