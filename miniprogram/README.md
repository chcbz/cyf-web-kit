# 聚义厅原生小程序源码

2026-10-31 核对：修复基于 Web cd92a2a7，权威小程序源码随本目录纳管；这里只维护实际运行源码，不含 project.private.config.json、登录信息或凭据。juyiting/ 是权威版本；个人开发者工具目录仅是部署镜像。8 MiB 单文件上限保持不变。

从 web/ 运行定向诊断（不是 Flow 正式验收）：

```powershell
node --import tsx ./node_modules/mocha/bin/mocha.js --no-config --require ./tests/setup.js --reporter spec --exit tests/mini-program-file-download.test.js
$env:MINIPROGRAM_PROJECT = 'C:/Users/Think/WeChatProjects/juyiting'
node --import tsx ./node_modules/mocha/bin/mocha.js --no-config --require ./tests/setup.js --reporter spec --exit tests/mini-program-file-download.test.js
Remove-Item Env:MINIPROGRAM_PROJECT
```

默认仅读仓库，不依赖任何个人盘符。显式 MINIPROGRAM_PROJECT 时，必须存在且 pages/、utils/、app.js/json/wxss、sitemap.json 的文件集合及逐文件 SHA-256 精确相同，缺失、额外或漂移都会失败，不跳过。不比较个人 project.private.config.json。

同步/部署：先备份目标已修改文件；将 juyiting/ 合并复制到开发者工具项目（不要复制/覆盖 project.private.config.json，不删目标无关文件）。执行上方显式镜像回归后再用微信开发者工具打开目标。上传/发布需独立授权；当前未登录，无开发者工具或真机验收。最终候选本机回归226项通过、显式源码镜像校验19项通过，npm run build 已通过（32.57秒，本机诊断，不是正式 Flow 验收）；源码差异 ESLint 未新增诊断。正式 Web 构建/发布仍按根 AGENTS.md 使用 Flow4403172；未上传，最终平台验收待完成。

下载生命周期：H5 与八宝囊共用固定版本 bridge，交接前取消/身份/视图失效时不得继续提交；postMessage 后无法撤回，不再将原生交接报告为取消成功。原生文件是临时文件，返回等待删除回执，失败保留路径并提示重试；退出尽力清理但不能保证系统删除成功，先分享或保存；启动仅清理严格功能 UUID 文件，并跳过本会话 pending/consumed ID，以免异步扫描删除新文件。

2026-10-31 再审修复：交接后跳转超时/失败明确提示文件已提交且无法撤回；原生删除失败不误报已删除、不跳转，保留路径供重试。补充真正驱动原生接收/消费的交接后取消回归，以及删除失败/延迟回调测试；正式发布仍需配套 Web 和小程序及真机验收。

2026-10-31 最终候选：定向回归220项通过、显式镜像回归24项通过（20个运行文件逐文件一致），本机构建通过（34.01秒），独立只读复审 SOURCE GO。扩大检查另有既有 formal-review 测试因 Windows URL pathname 生成双盘符而无法加载，未计入通过数；不是全仓测试通过。上述为提交前验证快照；源码纳入本次 develop 集成，不代表真机或正式 Flow 验收。
