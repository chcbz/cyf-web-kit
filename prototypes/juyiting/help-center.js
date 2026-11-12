'use strict';
// Help interaction proposal. Offline content only; no business or feedback requests.
(() => {
  const articles = [
    ['start','快速开始','第一次使用聚义厅','从一句需求开始，把沟通、进度和成果留在同一件事里。',['打开「办事」，说明你想完成什么、给谁使用以及期望的成果。','按需补充参考资料，核对需求后再提交。','按页面提示确认承办，在同一事项里补充要求、查看进度和成果。'],'先看看办事页','home','入门 新手 开始 任务'],
    ['request','办事与沟通','怎样把需求说清楚？','说清目标、使用场景和交付形式，比只说“帮我做一个”更有效。',['例如：为亲子自然观察活动写一份半天的活动方案。','补充人数、时间、风格等限制，并附上已有资料。','需要修改时，在原事项议事中继续补充，不必重复新建。'],'前往办事','home','提问 聊天 需求'],
    ['progress','事项与成果','事项没有进展，该怎么办？','先查看事项当前状态和最近消息，不要因为等待就重复提交。',['在「事项」找到对应事项并打开。','检查是否有待确认、待补充资料或异常提示。','按页面提供的处理入口继续；结果未知时先核对原操作，不盲目重试。'],'前往事项','tasks','任务 卡住 进度 等待 状态'],
    ['result','事项与成果','生成的文件在哪里查看？','先回到对应事项，查看议事中的成果和相关记录。',['打开「事项」，找到这次办理的事项。','进入议事，查看成果消息与可用的预览入口。','核对内容与版本；查看成果不等于确认验收。'],'前往事项','tasks','文件 下载 结果 成果 图片'],
    ['material','资料与引用','怎样给办事补充参考资料？','在需求或议事的资料入口选取已有资料；不要只在消息里写一个本机路径。',['先到「资料」查看已有文件。','回到需求或议事，从资料入口选择需要引用的文件。','核对所选文件后再发送；取消选择不会提交需求。'],'查看资料','workspace','文件 上传 附件 引用'],
    ['agent','好汉与能力','怎样了解好汉能做什么？','在好汉名册查看能力与当前状态，再决定如何协作。',['打开「我的 → 好汉名册」。','选中好汉，查看能力说明与状态。','能力说明不等于实时可用承诺；以当前页面给出的可用操作为准。'],'查看好汉名册','agents','机器人 智能体 agent 在线 技能'],
    ['reply','办事与沟通','为什么暂时没有收到回复？','没有新消息不一定意味着任务失败，先检查当前会话和页面提示。',['确认正在查看原事项或原密议。','留意连接、处理进度和需要补充信息的提示。','若状态仍不明确，保留问题现象并反馈，不重复发送同一操作。'],'查看事项','tasks','没回复 无响应 离线'],
    ['notice','事项与成果','需要我确认的事情在哪里？','从「我的」中的消息入口查看需要你处理的事项。',['打开「我的」，进入消息。','选择对应事项，阅读具体问题或成果。','按实际提供的操作处理；打开消息本身不代表验收。'],'查看消息','messages','提醒 待办 待办提醒 确认'],
    ['account','账户与设置','账户与授权设置在哪里？','从「我的 → 个人中心」进入；以实际开放的功能为准。',['打开「我的」，选择个人中心。','查看当前可用的账户与授权入口。','不要在反馈或对话中提供密码、密钥或登录凭据。'],'查看个人中心','account','安全 账号 个人中心 钱袋']
  ].map(([id,category,title,summary,steps,action,target,keywords]) => ({id,category,title,summary,steps,action,target,keywords}));
  let screen = 'home', query = '', category = '', selected = 'start', step = 0, draft = '', feedbackState = '', homeScroll = 0;
  const groups = ['办事与沟通','事项与成果','资料与引用','好汉与能力','账户与设置'];
  const act = (label, action, extra = '', cls = '') => `<button type="button" class="hc-button ${cls}" data-help-action="${action}" ${extra}>${label}</button>`;
  const rows = list => list.map(a => `<button type="button" class="hc-row" data-help-action="article" data-id="${a.id}"><span><strong>${a.title}</strong><small>${a.category}</small></span><span aria-hidden="true">›</span></button>`).join('');
  function results() {
    const q = query.trim().toLowerCase();
    const matches = articles.filter(a => (!category || a.category === category) && (!q || `${a.title} ${a.summary} ${a.keywords} ${a.category}`.toLowerCase().includes(q)));
    const region = document.querySelector('#hc-results');
    if (region) region.innerHTML = `<div class="hc-section-label"><h2>${q ? '搜索结果' : category || '常见问题'}</h2><span>${q || category ? `${matches.length} 篇` : '从这里找到答案'}</span></div>${matches.length ? rows(q || category ? matches : articles.filter(a => ['reply','progress','result','notice'].includes(a.id))) : '<div class="hc-empty"><h3>还没有找到相关帮助</h3><p>试试“任务”“文件”或“机器人”，也可以把问题反馈给我们。</p>' + act('反馈问题','feedback') + '</div>'}`;
  }
  function paint(focus = true) {
    const root = document.querySelector('.baseline-page');
    if (!root) return;
    root.classList.add('hc-page');
    let body = '';
    if (screen === 'home') {
      body = `<div class="hc-intro"><p class="hc-eyebrow">聚义厅 · 使用指南</p><h1>让每一件事，都有章可循。</h1><p>从第一次办事，到找到一份成果。</p></div><label class="hc-search"><span aria-hidden="true">⌕</span><input id="hc-search" type="search" aria-label="搜索使用帮助" placeholder="搜索问题，例如：任务、文件、机器人" value="${esc(query)}"></label><section class="hc-start" ${query || category ? 'hidden' : ''}><div class="hc-start-copy"><span class="hc-eyebrow">快速开始</span><h2>第一次使用聚义厅？</h2><p>提出需求 → 确认承办 → 跟进事项 → 查看成果</p><div class="hc-actions">${act('阅读入门指南','article','data-id="start"','hc-primary')}${act('重看新手引导 ↗','tour')}</div></div><div class="hc-seal" aria-hidden="true">入<br>门</div></section><section aria-label="按场景查找"><div class="hc-section-label"><h2>你想了解什么？</h2>${category ? act('查看全部','category','data-category=""','hc-link') : ''}</div><div class="hc-categories">${groups.map((name,i) => act(`<span class="hc-category-number">0${i+1}</span>${name}`, 'category', `data-category="${name}" aria-pressed="${category===name}"`,category===name?'is-active':'')).join('')}</div></section><section id="hc-results" aria-live="polite"></section><footer class="hc-footer"><div><strong>仍然没有解决？</strong><p>告诉我们遇到的问题，一起把事情办顺。</p></div>${act('反馈问题 →','feedback','', 'hc-link')}</footer>`;
    } else if (screen === 'article') {
      const a = articles.find(x => x.id === selected);
      body = `<article class="hc-article"><p class="hc-eyebrow">${a.category} · 操作指南</p><h1>${a.title}</h1><p class="hc-summary">${a.summary}</p><h2>跟着这几步操作</h2><ol class="hc-steps">${a.steps.map(s=>`<li>${s}</li>`).join('')}</ol><aside class="hc-note"><strong>请留意</strong><p>帮助只说明操作方法。实际状态、权限和可用操作，以业务页面为准。</p></aside>${act(a.action+' →','navigate',`data-target="${a.target}"`,'hc-primary')}<hr><h2>接下来，你可能想了解</h2>${rows(articles.filter(x => x.id !== a.id && (x.category === a.category || x.id === 'progress')).slice(0,2))}<div class="hc-feedback-line">还不清楚？${act('反馈这个问题','feedback','','hc-link')}</div></article>`;
    } else if (screen === 'tour') {
      const slides = [['从一句需求开始','在「办事」说明你想做什么，以及期望得到怎样的成果。','为亲子自然观察活动，准备一份半天的活动方案。'],['核对需求，确认承办','补充必要资料，按页面提示确认承办。阅读引导不会创建事项。','目标清楚 · 资料齐备 · 用户明确确认'],['在同一事项里继续沟通','补充要求、回答问题和查看进度，都留在原事项中。','“请把活动对象调整为 6—10 岁儿童。”'],['查看成果，明确处理','打开成果核对内容。查看、下载与验收是不同操作。','事项 → 议事与成果 → 按实际操作处理']];
      const s = slides[step];
      body = `<section class="hc-tour"><p class="hc-eyebrow">新手引导 · ${step+1} / 4</p><div class="hc-tour-mark" aria-hidden="true">0${step+1}</div><h1>${s[0]}</h1><p class="hc-summary">${s[1]}</p><blockquote>${s[2]}</blockquote><div class="hc-dots" aria-label="第 ${step+1} 步，共 4 步">${slides.map((_,i)=>`<span class="${i===step?'active':''}"></span>`).join('')}</div><div class="hc-actions">${step ? act('上一步','previous') : act('稍后再看','home')}${act(step===3?'完成，返回帮助':'下一步','next','','hc-primary')}</div><p class="hc-fine">离线步骤演示 · 不会创建或提交事项</p></section>`;
    } else {
      body = `<section class="hc-article"><p class="hc-eyebrow">意见与反馈</p><h1>哪里还不够顺手？</h1><p class="hc-summary">描述你做了什么、遇到什么问题，以及期望的结果。</p><label class="hc-field">问题描述<textarea id="hc-feedback" rows="6" placeholder="例如：我在事项里看到了成果，但不知道怎样打开……">${esc(draft)}</textarea></label><p class="hc-fine">请勿填写密码、密钥或其他敏感信息。本原型不会上传任何内容。</p><div class="hc-note" role="status">${feedbackState==='done'?'演示结束：内容未发送。正式接入后，应按真实服务回执显示结果。':feedbackState==='failed'?'模拟发送失败：内容仍在，可以继续编辑或再次体验。':'当前为交互演示，尚未连接反馈服务。'}</div><div class="hc-actions">${act('体验提交反馈','submit','','hc-primary')}${act('模拟提交失败','fail')}</div></section>`;
    }
    root.innerHTML = `<div class="hc-topbar">${act('‹ '+(screen==='home'?'返回':'帮助首页'),'back','','hc-back')}<strong>使用帮助</strong><span class="hc-preview">交互原型</span></div><div class="hc-content">${body}<p class="hc-version">帮助方案 · 2026.11.09 · 离线示例，非线上功能</p></div>`;
    if (screen === 'home') results();
    root.scrollTop = screen === 'home' ? homeScroll : 0;
    if (focus) { const heading = root.querySelector('h1'); heading?.setAttribute('tabindex','-1'); heading?.focus({preventScroll:true}); }
  }
  const original = render;
  render = function () {
    original();
    if (page === 'help') paint(false);
    if (page === 'mine') {
      const entry = document.querySelector('.mine-help button, .all-mine-links [data-page="help"]');
      if (entry) {
        entry.innerHTML = '<i class="var-icon var-icon--set var-icon-help-circle-outline" aria-hidden="true"></i><span><strong>使用帮助</strong><small>新手入门、操作指南与常见问题</small></span>';
        entry.classList.add('hc-mine-entry');entry.dataset.helpAction='open';
        const grid = document.querySelector('.hall-mine-page .mine-grid');
        if (grid) {
          for (const name of grid.querySelector('button')?.getAttributeNames() || []) {
            if (name.startsWith('data-v-')) {
              entry.setAttribute(name, '');
              entry.querySelectorAll('*').forEach(node => node.setAttribute(name, ''));
            }
          }
          grid.append(entry);
        }
        document.querySelector('.hall-mine-page .mine-help')?.remove();
      }
    }
  };
  window.addEventListener('click', event => {
    const el = event.target.closest('[data-help-action]');
    if (!el) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const action = el.dataset.helpAction;
    if (action === 'open') {screen='home';go('help');return;}
    if (screen === 'home') homeScroll = document.querySelector('.baseline-page')?.scrollTop || 0;
    if (action === 'article') {selected=el.dataset.id; screen='article';}
    if (action === 'category') {category=el.dataset.category; homeScroll=0;}
    if (action === 'home' || action === 'back') {
      if (screen === 'home' && action === 'back') {go(state.returnPages?.help || 'mine');return;}
      screen='home';
    }
    if (action === 'tour') {screen='tour';step=0;}
    if (action === 'next') {if (step===3) screen='home';else step++;}
    if (action === 'previous') step=Math.max(0,step-1);
    if (action === 'feedback') {screen='feedback';feedbackState='';}
    if (action === 'submit' || action === 'fail') {
      if (!draft.trim()) {document.querySelector('#hc-feedback').setCustomValidity('请先描述遇到的问题');document.querySelector('#hc-feedback').reportValidity();return;}
      feedbackState=action==='fail'?'failed':'done';
    }
    if (action === 'navigate') {go(el.dataset.target);return;}
    paint();
  }, true);
  document.addEventListener('input', event => {
    if (event.target.id === 'hc-search') {
      query=event.target.value;results();
      const start=document.querySelector('.hc-start');if(start)start.hidden=Boolean(query||category);
    }
    if (event.target.id === 'hc-feedback') {draft=event.target.value;event.target.setCustomValidity('');}
  });
  render();
})();
