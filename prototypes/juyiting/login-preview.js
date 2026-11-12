'use strict';
// Offline UI preview only. No OAuth exchange, credentials, timer or network request.
let loginPreviewState = new URLSearchParams(location.search).get('loginState') || 'processing';
function renderLoginPreview() {
 const mode = ['error', 'expired'].includes(loginPreviewState) ? loginPreviewState : 'processing';
 const processing = mode === 'processing';
 const title = processing ? '正在完成登录' : mode === 'expired' ? '登录已过期' : '暂时未能完成登录';
 const message = processing ? '正在验证授权信息，完成后将自动返回。' : mode === 'expired' ? '本次授权已失效，请重新登录。' : '未能验证授权结果，请重新登录后再试。';
 document.body.className = 'login-preview-body';
 document.body.removeAttribute('data-ui-revision');
 document.documentElement.className = 'login-preview-html';
 document.title = title + ' · 聚义厅（离线原型）';
 document.body.innerHTML = `<div class="login-scene"><header class="login-brand"><span class="login-brand-mark" aria-hidden="true">聚</span><span>聚义厅<span class="login-brand-divider" aria-hidden="true"></span><small>安全登录</small></span></header><main class="login-main"><section class="login-status" aria-labelledby="login-title" aria-describedby="login-description"><div class="login-emblem ${processing?'is-processing':'is-error'}" aria-hidden="true">${uiIcon(processing?'shield':'alert')}${processing?'<span class="login-orbit"></span>':''}</div><div role="status" aria-live="polite"><p class="login-eyebrow">${processing?'即将回到聚义厅':'登录未完成'}</p><h1 id="login-title">${title}</h1><p id="login-description">${message}</p></div>${processing?'<p class="login-patience">请保留此页面，无需重复登录。</p>':`<div class="login-actions">${button('重新登录','login-demo-retry','class="login-primary"')}${button('返回首页','login-demo-home','class="login-secondary"')}</div>`}</section></main><footer class="login-footer"><span>聚义厅 · 让好汉助你办事</span><details class="login-demo-controls"><summary>离线原型 · 切换状态</summary><div><label for="login-demo-state">登录状态</label><select id="login-demo-state">${[['processing','验证中'],['error','验证失败'],['expired','授权过期']].map(([value,text])=>`<option value="${value}" ${mode===value?'selected':''}>${text}</option>`).join('')}</select><p>仅演示界面，不发起真实登录。</p>${button('查看好汉详情 →','login-demo-agents')}</div></details></footer></div>`;
}
document.addEventListener('change', event => {
 if(event.target.id !== 'login-demo-state')return;
 loginPreviewState=event.target.value;renderLoginPreview();
 $('.login-demo-controls').open=true;$('#login-demo-state')?.focus();
});
document.addEventListener('click', event => {
 const target=event.target.closest('[data-action^="login-demo-"]');if(!target)return;
 event.preventDefault();event.stopImmediatePropagation();
 if(target.dataset.action==='login-demo-retry'){loginPreviewState='processing';renderLoginPreview();feedback('离线原型：验证中界面，不发起真实登录。');}
 if(target.dataset.action==='login-demo-home')go('home');
 if(target.dataset.action==='login-demo-agents'){state.selectedAgent={id:'3',name:'林冲'};agentMobileDetail=true;go('agents');}
},true);
