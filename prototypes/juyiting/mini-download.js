// Offline styling fixture only; no transfer, storage or navigation implementation.
'use strict';
(() => {
  labels.download = '文件下载';
  const originalRender = render;
  const states = {
    ad: { written: true, done: true, canShare: true, fileName: '聚义厅活动方案.pdf', message: '', ad: true },
    image: { written: true, done: true, canShare: true, fileName: 'image-edit-0.png', message: '' },
    openFailure: { written: true, done: true, canShare: true, fileName: '活动资料.zip', message: '此设备未能打开该文件，可尝试分享。' },
    ready: { written: true, done: true, canShare: true, fileName: '聚义厅活动方案.pdf', message: '' },
    loading: { message: '正在接收文件…' },
    unsupported: { written: true, done: true, canShare: true, fileName: '活动资料.zip', message: '' },
    error: { done: true, message: '文件写入失败，请检查小程序存储空间。' },
    noShare: { written: true, done: true, fileName: '活动资料.zip', message: '当前微信版本不支持分享文件。' },
    missingName: { written: true, done: true, canShare: true, message: '' },
    invalidReturn: { done: true, message: '返回地址无效，请重新打开下载。' },
    longName: { written: true, done: true, canShare: true, fileName: '聚义厅亲子自然观察活动详细方案与资料汇编（经确认的最终版本）'.repeat(3) + '.pdf', message: '' }
  };
  function paint(state = new URLSearchParams(location.search).get('state') || 'ready') {
    const data = states[state] || states.ready;
    const returnLabel = new URLSearchParams(location.search).get('returnLabel')?.trim() || '返回聚义厅';
    document.documentElement.className = '';
    document.body.className = 'mini-download-preview';
    document.title = '聚义厅 · 文件下载（离线样式原型）';
    document.body.innerHTML = `<main class="download-page"><div class="download-content"><div class="download-brand">聚义厅</div><h1 class="download-title">文件下载</h1><section class="download-card"><div class="download-emblem" aria-label="文件">FILE</div>${data.fileName ? `<div class="download-filename">${esc(data.fileName)}</div>` : ''}${data.message ? `<div class="download-message">${esc(data.message)}</div>` : ''}</section><div class="download-actions">${data.written ? '<button class="download-button download-button-primary">打开文件</button>' : ''}${data.written && data.canShare ? '<button class="download-button">分享文件到微信</button>' : ''}${data.done ? `<button class="download-button download-button-return">${esc(returnLabel)}</button>` : ''}</div>${data.ad ? '<aside class="download-ad"><div class="download-ad-demo">广告展示区域 · 仅原型示意</div></aside>' : ''}</div></main><aside class="download-demo"><span>离线状态演示 · 按钮不执行真实下载</span>${Object.entries({ready:'已接收', loading:'接收中', unsupported:'其他格式', error:'失败', noShare:'不支持分享', missingName:'无文件名', longName:'长文件名', invalidReturn:'无效返回参数', ad:'广告位示意', image:'图片文件', openFailure:'打开失败'}).map(([key, title]) => `<button data-download-state="${key}">${title}</button>`).join('')}</aside>`;
    document.querySelectorAll('[data-download-state]').forEach(button => button.onclick = event => { event.stopPropagation(); paint(button.dataset.downloadState); });
  }
  render = function (...args) {
    if (page === 'download') return paint();
    return originalRender(...args);
  };
  if (location.hash === '#download') { page = 'download'; render(); }
})();
