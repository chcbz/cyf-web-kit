'use strict';
// Documentation-only UI fixtures. No fetch, account state, microphone, payment or Agent execution.
const baselineScenarios = ['ready','empty','waiting','streaming','error','recording','voice-review','results','completed'];
function seedBaseline() {
  const params = new URLSearchParams(location.search);
  const scenario = params.get('scenario') || 'ready';
  if(params.has('scenario')) Object.assign(state,{task:null,agent:null,messages:[],outputs:[],delivery:[],final:[],pending:false,chatDraft:'',chatFiles:[],quote:null,privateChats:{},privateAgentId:null});
  state.baselineScenario = scenario;
  state.selectedAgent = { id: '0', name: '宋江' };
  if (['chat','private','public','detail','file'].includes(page)) {
    state.task ||= { title: '自然观察活动资料', description: '画一只鸟，并整理一份活动方案。', files: ['ref-brief'], complete: false };
    state.agent ||= { ...state.selectedAgent };
    if (!state.messages.length) state.messages = [{ role: 'USER', text: state.task.description, files: ['ref-brief'] }, { role: 'AGENT', text: '请补充你期望的风格，我们可以在这个话头中继续讨论。' }];
    if (scenario === 'empty') state.messages = [];
    if (['results','completed'].includes(scenario) && !state.outputs.length) {
      const ids = ['image','audio','document','text'].map(type => output(type, '一只小鸟停在树枝上。', 1, state));
      state.delivery = [...ids]; state.messages.push({ role: 'AGENT', text: '本次示例成果如下，可以预览、下载或保存。', outputs: ids });
      if (scenario === 'completed') { state.task.complete = true; state.final = [...ids]; }
    }
    if (page === 'private') { state.privateAgentId = '0'; state.privateChats['0'] = { agent: {...state.agent}, messages: structuredClone(state.messages), outputs: [...state.outputs], chatDraft: '', chatFiles: [], quote: null, pending: false, delivery: [] }; }
  }
}
function uiIcon(name) {
  const paths = {acceptance:'M9 4H5v17h14V4h-4M9 2h6v4H9ZM8 13l3 3 5-6',close:'M6 6l12 12M18 6 6 18',download:'M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5',refresh:'M19 8a7 7 0 1 0 1 6M19 3v5h-5',history:'M3 11a9 9 0 1 1 3 8M3 5v6h6M12 7v5l3 2',plus:'M12 4v16M4 12h16',send:'m9 5 7 7-7 7',mic:'M9 3a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8'};
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"></path></svg>`;
}
function syncCurrentComposer(panel) {
  panel.setAttribute('data-v-baseline-chat','');
  $$('.discussion-brief').forEach(node => node.remove());
  const toolbar = $('.panel-toolbar',panel);
  let actions = $('.toolbar-actions',toolbar);
  if (!actions) { actions = document.createElement('div'); actions.className='toolbar-actions'; toolbar.append(actions); }
  const locked = ['waiting','streaming','recording'].includes(state.baselineScenario);
  actions.innerHTML = [['重取回话','ui-refresh','refresh'],['话头记录','ui-history','history'],['另起话头','ui-new','plus']].map(([label,action,icon])=>`<button type="button" class="icon-button" data-action="${action}" title="${label}" aria-label="${label}" ${locked?'disabled':''}>${uiIcon(icon)}</button>`).join('');
  const body = $('.composer-body',panel), input = $('.composer-input-area',panel), actionRow=$('.composer-actions',panel);
  input.append(actionRow);
  $$('.composer-inline-voice',panel).forEach(node=>node.remove());
  const voice = document.createElement('div'); voice.className='composer-inline-voice'; voice.innerHTML=button(uiIcon('mic')+'<span>语音</span>','ui-voice','class="voice-start" aria-label="开始录音"'); actionRow.insertBefore(voice,$('.composer-send',actionRow));
  const sendButton=$('.composer-send',panel);sendButton.innerHTML=uiIcon('send');
  body.classList.add('has-supported-voice');
  for (const [selector,key] of [['.chat-panel','chat'],['.hall-chat-composer','composer'],['.panel-toolbar','chat'],['.composer-input-area','composer'],['.composer-actions','composer'],['.composer-inline-voice','composer']]) $$(selector,panel).forEach(node=>scoped(node,'data-v-baseline-'+key));
  if (locked) { $('.composer-textarea',panel).disabled=true;sendButton.disabled=true;$('.voice-start',panel).disabled=true; }
  if (['waiting','streaming'].includes(state.baselineScenario)) $('.hall-messages',panel).insertAdjacentHTML('beforeend',`<div class="hall-message SYSTEM is-pending" role="status">${state.baselineScenario==='streaming'?'宋江 · 回话未尽：正在整理活动方案…':'聚义厅 · 正在整理回报…'}</div>`);
  if(state.baselineScenario==='error') toolbar.insertAdjacentHTML('afterend',`<div class="conversation-load-error" role="alert">话头读取失败（演示） ${button('重试','ui-refresh')}</div>`);
  if(state.baselineScenario==='recording') showVoiceStatus('recording');
  if(state.baselineScenario==='voice-review') showVoiceStatus('review');
}
function showMore() {
  const existing = $('.composer-more-panel'); if(existing) { existing.remove();return; }
  const root=$('.hall-chat-composer');if(!root)return;
  root.insertAdjacentHTML('beforeend',`<section class="composer-more-panel mmd" aria-label="资料与语音"><div class="composer-more-actions">${button('添加资料','ui-materials','class="composer-add-materials"')}${button('语音设置','ui-settings','class="voice-settings-trigger"')}</div></section>`);
  $('.composer-more').setAttribute('aria-expanded','true');
  scoped($('.composer-more-panel'),'data-v-baseline-composer');
}
function showVoiceStatus(kind) {
  $('.baseline-voice-status')?.remove();
  const root=$('.hall-chat-composer');if(!root)return;
  const text=kind==='recording'?'正在录音 3s（界面演示，不启用麦克风）':'语音转写（示例文字，待放入可编辑草稿）';
  root.insertAdjacentHTML('beforeend',`<section class="baseline-voice-status mmd" role="status"><p>${text}</p>${kind==='recording'?button('停止录音并转写','ui-voice-stop')+button('取消并丢弃录音','ui-voice-cancel'): '<textarea aria-label="语音转写草稿">请把画面调整得明亮一些。</textarea>'+button('追加','ui-voice-append')+button('替换','ui-voice-replace')+button('丢弃','ui-voice-cancel')}</section>`);
}
function supplementalRoot() {
  const old=$('.hall-mine-page')||$('.hall-overview');
  if(!old)return null;
  const node=document.createElement('section');node.className='baseline-page mmd';old.replaceWith(node);return node;
}
function card(title,text,action,extra='') {return `<article class="baseline-card"><h3>${esc(title)}</h3><p>${esc(text)}</p>${action?button('打开','ui-go',`data-page="${action}" ${extra}`):''}</article>`;}
function renderSupplement() {
  document.title=labels[page]+' · 聚义厅界面基准 2026-10-06（离线示例）';
  $('.workbench-message-action')?.setAttribute('data-prototype-page','messages');
  $$('.workbench-account-action,.workbench-sidebar-account').forEach(e=>e.dataset.prototypePage='account');
  $('.workbench-map-entry')?.setAttribute('data-prototype-page','map');
  $$('.mine-grid button').forEach(e=>{const text=e.textContent;if(text.includes('典籍阁'))e.dataset.prototypePage='library';else if(text.includes('消息'))e.dataset.prototypePage='messages';else if(text.includes('实景'))e.dataset.prototypePage='map';else if(text.includes('个人中心'))e.dataset.prototypePage='account';});
  if(page==='agents') $$('.panel-toolbar button').filter(e=>e.textContent.includes('招贤令')).forEach(e=>e.dataset.prototypePage='catalog');
  if(page==='workspace') $$('.treasure-file-row').forEach((row,i)=>row.insertAdjacentHTML('beforeend',button('版本与管理','ui-file',`data-id="${[...catalog,...state.saved.map(asset)][i]?.id||'ref-brief'}"`)));
  if(['library','messages','catalog','map','help','file','reader','account'].includes(page)) {
    const root=supplementalRoot();if(!root)return;
    root.innerHTML=`<header><h2>${labels[page]}</h2><p class="mmd-muted">离线示例 · 不执行真实业务</p></header>`;
    if(page==='library')root.innerHTML+=`<div class="baseline-tabs">${button('典籍阅读','ui-library-reader')}${button('案卷检索','ui-library-search')}</div><div data-library-content>${card('水浒传','示例书架 · 阅读进度、目录、书签和手札入口','reader')}${card('自然观察活动案卷','示例个人案卷，不包含真实账号资料','detail')}</div>`;
    if(page==='messages')root.innerHTML+=`<h3>需要处理</h3>${state.baselineScenario==='empty'?'<p role="status">暂时没有需要处理的事项。</p>':card('自然观察活动资料','正式事项 · 成果可查看 · 查看待验收交付','detail')+card('未交办草稿','尚未交办 · 继续填写','create')}`;
    if(page==='catalog')root.innerHTML+=`<p>2 位待请豪杰 · 1 位已入伙</p>${card('公孙胜 · 入云龙','图像与资料协作 · 当前仅展示接入/山寨安顿入口','agents')}<div class="baseline-card"><h3>林冲 · 豹子头</h3><p>本地接入 / 山寨安顿</p>${button('查看接入说明','ui-hosting')}</div><p class="mmd-muted">原型不绑定 Agent，不生成接应密钥，不付款。</p>`;
    if(page==='map')root.innerHTML+=`<div class="baseline-map"><img src="shared/static/liangshan-hall-physical-bg-v1-ZLsp6lX5.png" alt="当前项目梁山厅堂静态美术；非实时地图"><div class="baseline-map-actions">${button('点将册','ui-go','data-page="agents"')}${button('悬赏榜','ui-go','data-page="tasks"')}${button('厅前公议','ui-go','data-page="public"')}${button('典籍阁','ui-go','data-page="library"')}</div></div><p class="mmd-muted">地图仅冻结现有美术与功能入口；不运行 melonJS，不模拟实时坐标、物理遮挡或联网 Agent。</p>`;
    if(page==='file'){const a=asset(state.fileId||'ref-brief');root.innerHTML+=`<h3>${esc(a?.name)}</h3><div class="baseline-tabs">${button('预览','preview',`data-id="${a?.id}"`)}${button('下载','download',`data-id="${a?.id}"`)}${button('返回资料','ui-go','data-page="workspace"')}</div><p>版本 1 · 当前示例版本</p><div class="baseline-card">${button('重命名','ui-rename')}${button(state.fileRecycled?'恢复':'移到回收站','ui-recycle')}</div>`;}
    if(page==='reader')root.innerHTML+=`<div class="baseline-tabs">${button('目录','ui-toc')}${button('书签','ui-bookmarks')}${button('手札','ui-notes')}${button('返回书架','ui-go','data-page="library"')}</div><article class="baseline-reader"><h3>水浒传 · 第一回（节选示意）</h3><p>此处为阅读排版样本，不复制真实典籍内容。段落、目录、续读、书签与手札以现有阅读器为来源。</p><p>后续界面优化应核对字号、行高、段落间距与短屏下的独立滚动，不以此示意页替代真实章节进度验证。</p></article>`;
    if(page==='account')root.innerHTML+=`<p>现有“个人中心”入口跳转到聚义厅外的账号模块。</p><p>本基准不扩展该模块，不模拟账号凭据、授权或隐私设置写入。</p>${button('返回我的','ui-go','data-page="mine"')}`;
    if(page==='help')root.innerHTML+=`<ol><li>在办事页描述需求，资料可选。</li><li>在点将册显式选择好汉，进入议事。</li><li>文字、资料与语音草稿通过同一个输入框处理。</li><li>议事中查看成果，事项详情中验收。</li></ol>${button('开始体验','ui-go','data-page="home"')}`;
  }
  // Stable provenance is visible without introducing a new top-level navigation system.
  const note=document.createElement('small');note.className='baseline-provenance';note.textContent='界面基准 · 2026-10-06 · 示例数据';document.body.append(note);
}
document.addEventListener('click',event=>{
  const target=event.target.closest('button,[data-action]');if(!target||target.disabled)return;
  if(target.matches('.workbench-mobile-more')){
    event.preventDefault();event.stopImmediatePropagation();
    dialog('全部入口',`<div class="mmd-more-menu">${prototypePages.map(([label,next])=>button(label,'ui-go',`data-page="${next}"`)).join('')}</div>`);return;
  }
  const action=target.dataset.action;
  if(!action||(!action.startsWith('ui-')&&action!=='composer-more'&&action!=='voice-settings'))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(action==='ui-go'){go(target.dataset.page);return;}
  if(action==='composer-more'){showMore();return;}
  if(action==='ui-materials'){openMaterials('chat');return;}
  if(action==='ui-settings'||action==='voice-settings'){const parent=$('.composer-more-panel');if(!parent)return;$('.voice-settings',parent)?.remove();parent.insertAdjacentHTML('beforeend',`<section class="voice-settings" role="group" aria-label="语音设置"><label><input type="checkbox" data-voice-reply ${state.replyVoice?'checked':''}>语音回答</label><p class="voice-disclosure">播放内容为 AI 生成语音</p><p class="mmd-muted">只保存本原型开关，不调用语音服务。</p></section>`);return;}
  if(action==='ui-voice'){showVoiceStatus('recording');return;}
  if(action==='ui-voice-stop'){showVoiceStatus('review');return;}
  if(action==='ui-voice-cancel'){$('.baseline-voice-status')?.remove();return;}
  if(action==='ui-voice-append'||action==='ui-voice-replace'){const text=$('.baseline-voice-status textarea').value;const ctx=conversation();ctx.chatDraft=action==='ui-voice-replace'?text:[ctx.chatDraft,text].filter(Boolean).join('\n');$('.baseline-voice-status')?.remove();renderChat();return;}
  if(action==='ui-refresh'){state.baselineScenario='ready';render();feedback('已重取离线话头示例；未发送网络请求。');return;}
  if(action==='ui-history'){const existing=$('.baseline-history');if(existing){existing.remove();return;}$('.panel-toolbar').insertAdjacentHTML('afterend',`<section class="baseline-history hall-conversation-history mmd"><h3>话头记录</h3>${button('自然观察活动资料','ui-select-history')}${button('删除话头','ui-delete-history')}</section>`);return;}
  if(action==='ui-new'){conversation().messages=[];conversation().chatDraft='';render();feedback('已另起演示话头；原型会话不影响真实记录。');return;}
  if(action==='ui-select-history'){conversation().messages=[{role:'AGENT',text:'已打开离线话头记录。'}];render();return;}
  if(action==='ui-delete-history'){dialog('删除话头','<p>删除的只是本原型演示记录，不调用真实删除接口。</p>',button('取消','close-dialog')+button('删除','ui-delete-confirm'));return;}
  if(action==='ui-delete-confirm'){target.closest('dialog').close();$('.baseline-history')?.remove();feedback('演示话头已删除');return;}
  if(action==='ui-library-search'){$('[data-library-content]').innerHTML=`<form class="baseline-search"><input placeholder="查项目案卷、议事旧录、往日回报" aria-label="案卷检索关键词"><select aria-label="案卷来源"><option>全部案卷</option><option>项目案卷</option><option>议事旧录</option><option>长记</option></select>${button('查卷','ui-search')}</form><div data-search-results></div>`;return;}
  if(action==='ui-library-reader'){render();return;}
  if(action==='ui-search'){$('[data-search-results]').innerHTML=card('自然观察活动案卷','示例检索结果 · 引用后可起草需求','detail');return;}
  if(action==='ui-file'){state.fileId=target.dataset.id;go('file');return;}
  if(action==='ui-rename'){dialog('重命名',`<label>名称<input aria-label="文件名称" value="${esc(asset(state.fileId||'ref-brief')?.name)}"></label>`,button('取消','close-dialog')+button('保存','ui-rename-save'));return;}
  if(action==='ui-rename-save'){const a=asset(state.fileId||'ref-brief'),name=$('dialog[open] input').value.trim();if(!name)return;a.name=name;target.closest('dialog').close();render();return;}
  if(action==='ui-recycle'){state.fileRecycled=!state.fileRecycled;render();feedback(state.fileRecycled?'示例文件已标记回收':'示例文件已恢复');return;}
  if(action==='ui-hosting'){dialog('接入 / 山寨安顿','<p>沿用现有接入说明、报价与确认入口。此基准只冻结入口；付费、租期恢复、授权和真实安装均不执行。</p>');return;}
  if(action==='ui-toc'){dialog('目录',`<ol><li>${button('第一回','close-dialog')}</li><li>${button('第二回','close-dialog')}</li></ol>`);return;}
  if(action==='ui-bookmarks'){dialog('书签','<p>当前章节 · 示例书签</p>',button('添加书签','ui-bookmark-save'));return;}
  if(action==='ui-bookmark-save'){target.closest('dialog').close();feedback('示例书签已保存');return;}
  if(action==='ui-notes'){dialog('手札','<textarea aria-label="手札内容" rows="5" placeholder="记下这次阅读的想法"></textarea>',button('保存手札','ui-bookmark-save'));return;}
},true);
document.addEventListener('change',event=>{if(event.target.matches('[data-voice-reply]'))state.replyVoice=event.target.checked;});
document.addEventListener('pointerdown',event=>{if($('.composer-more-panel')&&!event.target.closest('.hall-chat-composer')){$('.composer-more-panel').remove();$('.composer-more')?.setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('.composer-more-panel')){$('.composer-more-panel').remove();$('.composer-more')?.focus();event.stopImmediatePropagation();}},true);
