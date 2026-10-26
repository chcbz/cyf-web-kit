'use strict';
// Agent-scoped offline interaction fixtures. No API, installer, purchase or model calls.
(() => {
  // Catalog names follow existing packages; publication, price and permission choices below are fixtures.
  const products = [
    { key: 'image-edit', title: '图片修改', version: '1.1.0', description: '修改参考图片，支持 GIF、AVIF 等格式。', inputs: 'PNG、JPEG、WebP、GIF、BMP、TIFF、HEIC、HEIF、AVIF', permissions: ['读取本次授权的图片', '生成结果并写回当前任务'] },
    { key: 'pdf-extract', title: 'PDF 正文读取', version: '1.0.0', description: '按页提取 PDF 正文，不含 OCR。', inputs: 'PDF 文件', permissions: ['读取本次授权的 PDF', '将提取正文返回当前任务'] },
    { key: 'text-file', title: '文本文件生成', version: '1.0.0', description: '从任务资料生成 UTF-8 文本文件。', inputs: '本次已授权的任务资料', permissions: ['读取本次授权的任务资料', '生成文件并写回当前任务'] }
  ];
  const product = key => products.find(p => p.key === key);
  const initial = id => ({ version: '1.0.0', enabled: true, installed: id === '4', outcome: 'ok', operation: null, history: [], extraSkills: {}, installOutcome: 'ok', uninstallOutcome: 'ok' });
  state.skillManagementDemo ||= {};
  const model = id => { const m = state.skillManagementDemo[id] ||= initial(id); m.extraSkills ||= {}; m.installOperations ||= {}; if (m.operation?.kind === 'install') m.installOperations[m.operation.key] = m.operation; m.installOutcome ||= 'ok'; return m; };
  const entry = (m, key) => key === 'image-edit' ? m.installed ? m : null : m.extraSkills[key];
  const installedCount = m => Number(m.installed) + Object.keys(m.extraSkills).length;
  const operationKey = op => op?.key || 'image-edit';
  const own = id => commissionAgents.some(a => a.id === id && a.owner === commissionViewer);
  const locked = m => ['pending', 'unknown', 'waiting'].includes(m.operation?.stage);
  const action = (text, name, extra = '') => button(text, 'skill-' + name, extra);
  let active = null;
  for (const m of Object.values(state.skillManagementDemo)) {
    if (m.operation?.stage === 'pending') m.operation.stage = 'unknown';
  }
  const baseAgents = renderAgents;
  renderAgents = function (...args) {
    if (active && !active.d.isConnected) active = null;
    baseAgents(...args);
    const id = state.selectedAgent?.id;
    const section = $('.agent-profile-section[aria-label="技能"]');
    if (!section || !own(id) || agentSkillExample(state.selectedAgent.name) === 'noauth') return;
    const m = model(id);
    if (!agentProfileRead.loading && installedCount(m)) {
      $$('.agent-skill-item,.agent-skill-empty', section).forEach(el => el.remove());
      $('.agent-skill-heading', section).insertAdjacentHTML('afterend', products.filter(p => entry(m, p.key)).map(p => {
        const r = entry(m, p.key), busy = locked(m) && operationKey(m.operation) === p.key;
        return `<div class="agent-skill-item"><div class="agent-skill-heading"><strong>${p.title}</strong><small>${r.version}</small></div><div class="agent-skill-badges"><span>已核验安装</span><span>${busy ? '操作待确认' : r.enabled ? '运行就绪' : '已停用新调用'}</span></div></div>`;
      }).join(''));
    }
    const heading = $('.agent-skill-heading', section);
    $('small', heading)?.remove();
    heading.insertAdjacentHTML('beforeend', action('管理技能', 'open', 'class="skill-inline-manage"'));
  };
  function open(id) {
    if (!own(id) || active || agentSkillExample(commissionAgents.find(a => a.id === id).name) === 'noauth') return;
    const trigger = document.activeElement;
    const d = dialog('技能管理', '');
    d.classList.add('skill-manager');
    active = { id, d, screen: 'list', tab: 'all', key: 'image-edit', approvals: [], quote: null, trigger };
    d.addEventListener('cancel', e => {
      e.preventDefault();
      if (active?.screen !== 'list') back(); else d.close();
    });
    // Keep keyboard navigation in this layer, including Chromium's browser-chrome boundary.
    d.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const targets = $$('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]', d) .filter(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') return false;
        for (let parent = el.parentElement; parent && parent !== d; parent = parent.parentElement) {
          if (parent.matches('details:not([open])') && !parent.querySelector(':scope > summary')?.contains(el)) return false;
        }
        return true;
      });
      if (!targets.length) return;
      const first = targets[0], last = targets[targets.length - 1], current = document.activeElement;
      if (!targets.includes(current) || (e.shiftKey ? current === first : current === last)) {
        e.preventDefault(); (e.shiftKey ? last : first).focus();
      }
    });
    let backdrop = false;
    const outside = e => { const r = d.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
    d.addEventListener('pointerdown', e => { backdrop = e.target === d && outside(e); });
    d.addEventListener('click', e => { if (backdrop && e.target === d && outside(e)) d.close(); backdrop = false; });
    d.addEventListener('close', () => {
      active = null;
      if (page === 'agents') renderAgents();
      if (trigger?.isConnected) trigger.focus(); else $('[data-action="skill-open"]')?.focus();
    });
    paint();
  }
  function back() {
    if (!active) return;
    active.screen = 'list'; active.quote = null; active.approvals = [];
    paint('skill-row-focus');
  }
  const badge = (text, style = '') => `<span class="skill-pill ${style}">${text}</span>`;
  function skillRow(m, p, expanded = '') {
    const r = entry(m, p.key), op = operationKey(m.operation) === p.key ? m.operation : m.installOperations[p.key];
    const busy = op && ['pending', 'unknown', 'waiting'].includes(op.stage), upgrade = p.key === 'image-edit' && r?.version === '1.0.0';
    const stateText = op?.kind === 'uninstall' && op.stage === 'failed' ? '卸载未完成' : busy ? op.stage === 'waiting' ? '等待连接' : op.stage === 'pending' ? op.kind === 'uninstall' ? '卸载中' : op.kind === 'install' ? '安装中' : '升级中' : '待核对' : !r ? op && op.kind !== 'uninstall' ? '安装未完成' : '未安装' : r.enabled ? '已启用' : '已停用';
    const disabled = locked(m) && operationKey(m.operation) !== p.key;
    const open = active.key === p.key && active.screen !== 'list';
    const primary = busy || (op?.kind === 'uninstall' && op.stage === 'failed') || (!r && op && op.kind !== 'uninstall') ? action(op?.stage === 'unknown' ? '核对结果' : '查看进度', 'progress', `data-skill="${p.key}" ${disabled ? 'disabled' : ''}`) : !r ? action('安装', 'select', `data-skill="${p.key}" ${locked(m) ? 'disabled' : ''}`) : upgrade ? action('升级', 'upgrade', locked(m) ? 'disabled' : '') : '';
    return `<article class="skill-unified-row ${open ? 'is-expanded' : ''}" data-skill-row="${p.key}"><div class="skill-row-summary"><span class="skill-row-icon" aria-hidden="true">${p.key === 'image-edit' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6"/></svg>'}</span><div class="skill-row-copy"><h3>${p.title}<span class="skill-row-status ${busy || (!r && op && op.kind !== 'uninstall') ? 'attention' : ''}">${stateText}</span></h3><p>${p.key === 'image-edit' && r?.version === '1.0.0' ? '修改参考图片，当前仅支持 PNG、JPEG。' : p.description}</p><small>${r ? (op?.stage === 'unknown' ? '最近确认 ' : '') + r.version + (upgrade ? ' → 1.1.0 可升级' : '') : p.version + (op && op.kind !== 'uninstall' ? ' · 待确认安装' : ' · 示例技能')}</small></div><div class="skill-row-actions">${r && !open ? action('详情', 'view', `data-skill="${p.key}" class="skill-secondary-action"`) : ''}${open ? action('收起', 'back', 'aria-expanded="true"') : primary}</div></div>${open ? `<div class="skill-inline-panel" data-inline-skill="${p.key}">${expanded}</div>` : ''}</article>`;
  }
  function list(m, a, expanded = '') {
    return `<div class="skill-unified-list" aria-label="${esc(a.name)}的技能">${products.map(p => skillRow(m, p, expanded)).join('')}</div>
      <details class="skill-records"><summary>操作记录${m.history.length ? ' · ' + m.history.length : ''}</summary>${history(m)}</details>
      <details class="skill-demo"><summary>演示设置</summary><div><label>安装结果<select data-skill-install-outcome ${locked(m) ? 'disabled' : ''}>${[['ok', '成功'], ['failed', '准备失败'], ['unknown', '回执未知'], ['offline', '等待连接']].map(([v, text]) => `<option value="${v}" ${m.installOutcome === v ? 'selected' : ''}>${text}</option>`).join('')}</select></label><label>升级结果<select data-skill-outcome ${locked(m) ? 'disabled' : ''}>${[['ok', '成功'], ['failed', '准备失败'], ['unknown', '回执未知']].map(([v, text]) => `<option value="${v}" ${m.outcome === v ? 'selected' : ''}>${text}</option>`).join('')}</select></label><label>卸载结果<select data-skill-uninstall-outcome ${locked(m) ? 'disabled' : ''}>${[['ok', '成功'], ['failed', '确认未生效'], ['unknown', '回执未知'], ['offline', '等待连接']].map(([v, text]) => `<option value="${v}" ${(m.uninstallOutcome || 'ok') === v ? 'selected' : ''}>${text}</option>`).join('')}</select></label>${action('重置示例', 'reset', locked(m) ? 'disabled' : '')}</div><small>只影响当前Agent的离线示例。</small></details>`;
  }
  function installConfirm(m, a) {
    const p = product(active.key);
    return `<div class="skill-install-heading"><p>安装到 ${esc(a.name)}${a.status === '离线' && !m.runtimeOnline ? ' · 当前离线，提交后等待连接' : ''}</p></div><p class="skill-install-quote" role="status">${active.quote ? '示例报价：0 积分 · 仅本次版本与权限有效' : '获取示例报价后安装。'}</p><details class="skill-deferred"><summary>技能详情与费用</summary><p>${p.permissions.map(esc).join("；")}</p><p>安装后仍需核验 Runtime 和工具依赖；安装完成不自动执行任务。示例报价不是实际价格，不操作真实资金；执行服务费用与购买费用分开。</p></details>`;
  }
  function installProgress(m) {
    const op = m.operation, p = product(op.key);
    const titles = { waiting: '等待 Agent 连接', pending: '正在安装', failed: '安装未完成', unknown: '安装结果待核对', succeeded: '安装完成，运行就绪' };
    const steps = ['订单接纳', '下载与校验', '登记安装', '回执与运行核验'];
    const at = op.stage === 'succeeded' ? 4 : op.stage === 'unknown' ? 3 : op.stage === 'failed' ? 1 : op.stage === 'waiting' ? 1 : op.step;
    const note = { waiting: '原操作已接纳；连接恢复后继续，不重复购买。', pending: '完成安装与运行核验后才加入已安装列表。关闭窗口不会取消本次演示。', failed: '示例：包校验失败，未激活技能。可沿原操作重试安装，不重复购买。', unknown: '尚不能确认是否已安装。只核对原操作，不重新报价或重复购买。', succeeded: '可用于后续获得授权的新请求，不自动执行或重发旧消息。' };
    return `<div class="skill-page-heading" role="status"><span class="skill-eyebrow">${esc(op.id)} · 离线模拟</span><h3>${titles[op.stage]}</h3><p>${p.title} · ${op.target} · ${esc(commissionAgents.find(a => a.id === active.id).name)}</p></div><ol class="skill-progress">${steps.map((step, i) => `<li class="${i < at ? 'done' : i === at ? 'current' : ''}"><span>${i < at ? '✓' : i + 1}</span><div><strong>${step}</strong><small>${i < at ? '示例已确认' : i === at ? op.stage === 'waiting' ? '等待连接' : op.stage === 'failed' ? '未通过校验' : op.stage === 'unknown' ? '等待核对' : '处理中…' : '尚未开始'}</small></div></li>`).join('')}</ol><p class="skill-catalog-caption">${note[op.stage]}</p>`;
  }
  function activate(m, op) {
    if (op.kind === 'uninstall') {
      if (op.key === 'image-edit') { m.installed = false; m.enabled = false; }
      else delete m.extraSkills[op.key];
      delete m.installOperations[op.key];
      return;
    }

    if (op.kind !== 'install' || op.key === 'image-edit') { m.version = op.target || '1.1.0'; m.installed = true; if (op.kind === 'install') m.enabled = true; }
    else m.extraSkills[op.key] = { version: op.target, enabled: true };
  }
  function schedule(id, op) {
    [1, 2, 3].forEach(step => setTimeout(() => {
      if (model(id).operation !== op || op.stage !== 'pending') return;
      op.step = step;
      if (step === 3 || (step === 1 && op.outcome === 'failed')) finish(id, op);
      else { persist(); if (active?.id === id) paint(); }
    }, step * 650));
  }
  function history(m) {
    return `<section class="skill-history">${m.history.length ? `<ol>${m.history.map(h => `<li><div><strong>${esc(h.title)}</strong><small>${esc(h.at)} · 我（示例）</small></div><p>${esc(h.detail)}</p><code>${esc(h.id)}</code></li>`).join('')}</ol>` : '<p class="skill-empty">暂无管理操作。原有安装信息保留，不伪造历史记录。</p>'}</section>`;
  }
  function detail(m) {
    if (active.key !== 'image-edit') {
      const p = product(active.key), r = entry(m, active.key);
      return `<div class="skill-page-heading"><span class="skill-eyebrow">${p.key}</span><h3>${p.title}</h3><p>${r.version} · ${r.enabled ? '已启用新调用' : '已停用新调用'}</p></div><dl class="skill-detail-grid"><dt>输入</dt><dd>${p.inputs}</dd><dt>权限范围</dt><dd>${p.permissions.join('；')}</dd><dt>运行状态</dt><dd>示例安装与运行已核验；仍需逐任务授权。</dd></dl><section class="skill-section"><h4>使用控制</h4><p>只影响新调用，不中断已获授权任务，不删除成果。</p>${action(r.enabled ? '停用新调用' : '启用新调用', 'toggle-confirm', locked(m) ? 'disabled' : '')}${action('卸载技能', 'uninstall-confirm', `class="skill-secondary-action" ${locked(m) ? 'disabled' : ''}`)}</section>`;
    }
    return `<div class="skill-page-heading"><span class="skill-eyebrow">已安装技能 / IMAGE-EDIT</span><h3>图片修改</h3><p>${m.operation?.stage === 'unknown' ? '最近确认' : '当前'} ${m.version} · ${m.enabled ? '已启用新调用' : '已停用新调用'} · 安装已核验（示例）</p></div><section class="skill-section"><h4>输入与运行条件</h4><dl class="skill-detail-grid"><dt>输入图片</dt><dd>${m.version === '1.0.0' ? 'PNG、JPEG' : 'PNG、JPEG、WebP、GIF、BMP、TIFF、HEIC、HEIF、AVIF'}</dd><dt>执行权限</dt><dd>读取本次授权的图片；生成结果写回本次任务</dd><dt>运行依赖</dt><dd>图片处理工具链与图像服务绑定 · 示例就绪</dd><dt>核验状态</dt><dd>安装证据已核验；${locked(m) && operationKey(m.operation) === 'image-edit' ? '运行状态待核对' : m.enabled ? '运行就绪' : '已停用新调用'}。任务授权仍需单独核对。</dd></dl></section><section class="skill-section"><h4>使用控制</h4><p>停用后不再接受新的技能调用，不中止已获授权的任务，不删除成果或操作记录。</p>${action(m.enabled ? '停用新调用' : '启用新调用', 'toggle-confirm', locked(m) ? 'disabled' : '')}${action('卸载技能', 'uninstall-confirm', `class="skill-secondary-action" ${locked(m) ? 'disabled' : ''}`)}${locked(m) ? '<p role="status">先核对正在进行的操作，再更改启用状态。</p>' : ''}</section>`;
  }
  function upgrade(m) {
    return `<div class="skill-page-heading"><span class="skill-eyebrow">版本变更 / IMAGE-EDIT</span><h3>升级图片修改</h3><p>1.1.0为示例候选，不代表平台已发布。</p></div><div class="skill-version-compare"><div><small>当前启用</small><strong>${m.version}</strong></div><span aria-hidden="true">→</span><div><small>本次目标 · 示例候选</small><strong>1.1.0</strong></div></div><section class="skill-section"><h4>这次更新了什么</h4><dl class="skill-diff"><dt>图片格式 <span>扩展</span></dt><dd><s>仅 PNG / JPEG</s><p>保留 PNG、JPEG，新增 WebP、GIF、BMP、TIFF、HEIC、HEIF、AVIF。</p></dd><dt>执行权限 <span>无新增</span></dt><dd>仍只读取本次授权图片，并写回本次任务结果（演示假设）。</dd><dt>运行依赖 <span>需核验</span></dt><dd>新版统一解码与转换工具链；准备完成后才切换，不用文件下载成功代替就绪。</dd><dt>升级费用 <span>示例</span></dt><dd>本例假设已有权益覆盖，不重复购买。真实升级以平台报价与授权为准。</dd></dl></section><aside class="skill-safety"><strong>只影响后续新请求</strong><p>准备失败保留 ${m.version}。旧任务继续绑定原版本；升级不会自动重发失败消息，也不会重放结果未知的操作。</p></aside>`;
  }
  function progress(m) {
    const op = m.operation;
    if (!op) return '';
    if (op.kind === 'install') return installProgress(m);
    if (op.kind === 'uninstall') {
      const title = { pending: '正在卸载', waiting: '等待 Agent 连接', failed: '卸载未完成', unknown: '卸载结果待核对', succeeded: '已卸载' }[op.stage];
      const note = { pending: '已停止新调用，正在移除当前技能的可用入口。', waiting: '已停止新调用；连接恢复后沿原操作继续，不重复提交。', failed: '示例已确认未完成卸载，仍保留安装信息且不开放新调用。可重试原操作。', unknown: '尚不能确认卸载结果；保留最近确认的安装信息，只核对原操作。', succeeded: '历史记录、成果与已购权益保留；在途任务引用的包不删除。需要时可重新安装，不自动退款。' }[op.stage];
      return `<div class="skill-page-heading" role="status"><span class="skill-eyebrow">${esc(op.id)} · 离线模拟</span><h3>${title}</h3><p>${product(op.key).title} · ${op.from}</p></div><p class="skill-note">${note}</p>`;
    }
    const text = { pending: '正在准备新版本', failed: '升级未完成，旧版本仍保留', unknown: '回执尚未确认，请核对原操作', succeeded: '升级完成，运行就绪' };
    const steps = ['后台接纳', '下载与校验', '安全切换', '回执与运行核验'];
    const at = op.stage === 'succeeded' ? 4 : op.stage === 'unknown' ? 3 : op.stage === 'failed' ? 1 : op.step;
    return `<div class="skill-page-heading" role="status"><span class="skill-eyebrow">${esc(op.id)} · 离线模拟</span><h3>${text[op.stage]}</h3><p>图片修改 · ${op.from} → 1.1.0</p></div><ol class="skill-progress">${steps.map((s, i) => `<li class="${i < at ? 'done' : i === at ? 'current' : ''}"><span>${i < at ? '✓' : i + 1}</span><div><strong>${s}</strong><small>${i < at ? '示例已确认' : i === at ? op.stage === 'failed' ? '校验失败 · 未切换' : op.stage === 'unknown' ? '等待原操作核对' : '处理中…' : '尚未开始'}</small></div></li>`).join('')}</ol><aside class="skill-safety ${op.stage === 'failed' || op.stage === 'unknown' ? 'warning' : ''}"><strong>${op.stage === 'succeeded' ? '当前启用 1.1.0 · 支持扩展图片格式' : op.stage === 'failed' ? '示例原因：候选包摘要校验未通过' : op.stage === 'unknown' ? '尚不能确认当前激活版本' : '关闭此窗口不会取消本次演示操作'}</strong><p>${op.stage === 'succeeded' ? '新请求可重新获取技能目录。此前失败消息不会自动重发；在途任务仍保留原版本。' : op.stage === 'failed' ? '当前仍是 1.0.0。可查看版本差异后重试；失败记录保留。' : op.stage === 'unknown' ? '最近已确认版本为 1.0.0；不据此断言切换失败。只核对原操作，不另起安装、不重复购买。' : '先准备并验证候选，再确认切换结果与运行状态，不打断已获授权的旧任务。'}</p></aside>`;
  }
  function paint(focusAction) {
    if (!active || !active.d.isConnected) return;
    const { id, d, screen } = active, m = model(id), a = commissionAgents.find(a => a.id === id);
    const current = entry(m, active.key) || m;
    const titles = { detail: '技能详情', install: '确认安装', upgrade: '确认升级', uninstall: '卸载技能', progress: m.operation?.kind === 'uninstall' ? '卸载进度' : m.operation?.kind === 'install' ? '安装进度' : '升级进度', toggle: current.enabled ? '停用技能' : '启用技能' };
    const focused = document.activeElement?.dataset?.action;
    const top = $('.skill-scroll', d)?.scrollTop || 0;
    let content = screen === 'uninstall' ? `<p>卸载 ${product(active.key).title}？将停止新调用并移出已安装列表。</p><p class="skill-note">不中断在途任务，不删除成果、历史和已购权益；不自动退款。需要时可重新安装。</p>` : screen === 'install' ? installConfirm(m, a) : screen === 'detail' ? detail(m) : screen === 'upgrade' ? upgrade(m) : screen === 'progress' ? progress(m) : screen === 'toggle' ? `<p>${current.enabled ? '停用' : '启用'}${product(active.key).title}的新调用？不会中断在途任务，也不删除成果或历史。</p>` : '';
    let footer = '';
    if (screen === 'upgrade') footer = `<span>目标版本 1.1.0</span>${action('确认升级（演示）', 'confirm', 'class="mmd-primary"')}`;
    if (screen === 'install') footer = active.quote ? action('确认安装（演示）', 'install-confirm', 'class="mmd-primary"') : action('获取报价（演示）', 'quote', `class="mmd-primary" ${active.approvals.length !== product(active.key).permissions.length ? 'disabled' : ''}`);
    if (screen === 'uninstall') footer = `${action('取消', 'view')}${action('确认卸载', 'uninstall', 'class="mmd-primary"')}`;
    if (screen === 'toggle') footer = `${action('取消', 'view')}${action(current.enabled ? '确认停用' : '确认启用', 'toggle', 'class="mmd-primary"')}`;
    if (screen === 'progress') {
      const op = m.operation;
      if (op.stage === 'pending') footer = '<span role="status">处理中，可收起查看其他技能</span>';
      else if (op.stage === 'unknown') footer = action('核对原操作', 'reconcile', 'class="mmd-primary"');
      else if (op.stage === 'failed' && op.kind === 'uninstall') footer = action('重试原卸载（演示）', 'uninstall-retry', 'class="mmd-primary"');
      else if (op.stage === 'failed') footer = action(op.kind === 'install' ? '重试原安装（演示）' : '检查版本并重试', op.kind === 'install' ? 'install-retry' : 'upgrade', 'class="mmd-primary"');
      else if (op.stage === 'waiting') footer = action('模拟恢复连接', 'resume', 'class="mmd-primary"');
      else footer = action('完成', 'back', 'class="mmd-primary"');
    }
    const expanded = content ? `<h4 class="skill-inline-title" tabindex="-1">${titles[screen]}</h4>${content}${footer ? `<div class="skill-inline-footer">${footer}</div>` : ''}` : '';
    d.innerHTML = `<header><div><h3 tabindex="-1" id="skill-manager-title">${esc(a.name)}的技能</h3><p>查看、安装与管理</p></div>${button('关闭', 'close-dialog', 'aria-label="关闭技能管理"')}</header><div class="skill-demo-banner">离线原型 · 不操作真实安装或资金</div><div class="skill-scroll">${list(m, a, expanded)}</div>`;
    d.setAttribute('aria-labelledby', 'skill-manager-title');
    const row = $(`[data-skill-row="${active.key}"]`, d);
    const target = focusAction ? $(`[data-action="${focusAction}"]`, row) || $('.skill-inline-title', row) || $('button', row) : focused && $(`[data-action="${focused}"]`, row);
    if (target) target.focus({ preventScroll: true });
    else if (!focused) ($('.skill-inline-title', row) || $('#skill-manager-title', d)).focus({ preventScroll: true });
    $('.skill-scroll', d).scrollTop = top;
    if (focusAction && screen !== 'list') target?.scrollIntoView({ block: 'nearest' });
  }
  function record(m, title, detail, id) {
    m.history.unshift({ title, detail, id, at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
  }
  function finish(id, operation) {
    const m = model(id);
    if (m.operation !== operation || operation.stage !== 'pending') return;
    operation.stage = operation.outcome === 'ok' ? 'succeeded' : operation.outcome;
    if (operation.stage === 'succeeded') activate(m, operation);
    if (operation.kind === 'uninstall') record(m, { succeeded: '卸载完成', failed: '卸载失败 · 保留安装信息', unknown: '卸载回执未知' }[operation.stage], product(operation.key).title + ' · 保留历史、成果与权益', operation.id);
    else if (operation.kind === 'install') record(m, { succeeded: '安装完成', failed: '安装失败 · 未激活', unknown: '安装回执未知' }[operation.stage], product(operation.key).title + ' ' + operation.target, operation.id);
    else record(m, { succeeded: '升级完成', failed: '准备失败 · 保留旧版', unknown: '回执未知 · 等待核对' }[operation.stage], `${operation.from} → 1.1.0`, operation.id);
    persist(); if (active?.id === id) paint();
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-action^="skill-"]');
    if (!t || t.disabled) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const cmd = t.dataset.action.slice(6);
    if (cmd === 'open') { open(state.selectedAgent?.id); return; }
    if (!active || !own(active.id)) return;
    const { id } = active, m = model(id);
    if (cmd === 'select' && !locked(m) && product(t.dataset.skill) && !entry(m, t.dataset.skill) && !m.installOperations[t.dataset.skill]) { active.key = t.dataset.skill; active.screen = 'install'; active.approvals = product(active.key).permissions.map((_, i) => i); active.quote = null; }
    if (cmd === 'quote' && active.screen === 'install' && active.approvals.length === product(active.key).permissions.length && !locked(m)) {
      active.quote = { id: 'demo-quote-' + (++serial), agent: id, key: active.key, version: product(active.key).version, permissions: [...active.approvals], price: 0 };
    }
    if (cmd === 'install-confirm' && active.screen === 'install' && active.quote?.agent === id && active.quote.key === active.key && active.quote.permissions.length === product(active.key).permissions.length && active.approvals.length === active.quote.permissions.length && !entry(m, active.key) && !m.installOperations[active.key] && !locked(m)) {
      const offline = (commissionAgents.find(a => a.id === id).status === '离线' && !m.runtimeOnline) || m.installOutcome === 'offline';
      const op = { id: 'demo-install-' + (++serial), kind: 'install', key: active.key, target: active.quote.version, quote: active.quote, from: null, stage: offline ? 'waiting' : 'pending', step: 0, outcome: m.installOutcome === 'offline' ? 'ok' : m.installOutcome };
      m.operation = op; m.installOperations[op.key] = op; active.quote = null; active.screen = 'progress';
      record(m, '已提交安装', product(op.key).title + ' ' + op.target + ' · 0积分（示例）', op.id);
      if (!offline) schedule(id, op);
    }
    if ((cmd === 'resume' && m.operation?.stage === 'waiting') || (cmd === 'install-retry' && m.operation?.kind === 'install' && m.operation.stage === 'failed') || (cmd === 'uninstall-retry' && m.operation?.kind === 'uninstall' && m.operation.stage === 'failed')) {
      const op = m.operation; op.stage = 'pending'; op.step = 0;
      if (cmd === 'resume') m.runtimeOnline = true; else op.outcome = 'ok';
      record(m, cmd === 'resume' ? '示例连接恢复' : op.kind === 'uninstall' ? '重试原卸载' : '重试原安装', '沿原操作继续，不重复购买', op.id); active.screen = 'progress'; schedule(id, op);
    }
    if (cmd === 'uninstall-confirm' && entry(m, active.key) && !locked(m)) active.screen = 'uninstall';
    if (cmd === 'uninstall' && active.screen === 'uninstall' && entry(m, active.key) && !locked(m)) {
      const r = entry(m, active.key), outcome = m.uninstallOutcome || 'ok';
      const offline = outcome === 'offline' || (commissionAgents.find(a => a.id === id).status === '离线' && !m.runtimeOnline);
      const op = { id: 'demo-uninstall-' + (++serial), kind: 'uninstall', key: active.key, from: r.version, target: r.version, stage: offline ? 'waiting' : 'pending', step: 0, outcome: outcome === 'offline' ? 'ok' : outcome };
      r.enabled = false; m.operation = op; active.screen = 'progress';
      record(m, '已提交卸载', product(op.key).title + ' · 停止新调用，不删除历史与成果', op.id);
      if (!offline) schedule(id, op);
    }
    if (cmd === 'back') { back(); return; }
    if (cmd === 'view') { const key = t.dataset.skill || active.key; if (entry(m, key)) { active.key = key; active.screen = 'detail'; } }
    if (cmd === 'upgrade' && m.installed && !locked(m) && m.version === '1.0.0') { active.key = 'image-edit'; active.screen = 'upgrade'; }
    if (cmd === 'progress') { const key = t.dataset.skill || operationKey(m.operation); const op = operationKey(m.operation) === key ? m.operation : m.installOperations[key]; if (op && (!locked(m) || operationKey(m.operation) === key)) { m.operation = op; active.key = key; active.screen = 'progress'; } }
    if (cmd === 'toggle-confirm' && !locked(m)) active.screen = 'toggle';
    if (cmd === 'toggle' && active.screen === 'toggle' && !locked(m)) {
      const current = entry(m, active.key); current.enabled = !current.enabled;
      record(m, current.enabled ? '启用新调用' : '停用新调用', product(active.key).title + ' · 保留在途任务、成果与版本记录', 'demo-control-' + (++serial));
      active.screen = 'detail';
    }
    if (cmd === 'reset' && !locked(m)) { state.skillManagementDemo[id] = initial(id); active.tab = 'all'; }
    if (cmd === 'confirm' && active.screen === 'upgrade' && m.installed && !locked(m) && m.version === '1.0.0') {
      const op = { id: 'demo-upgrade-' + (++serial), from: m.version, stage: 'pending', step: 0, outcome: m.outcome };
      m.operation = op; active.screen = 'progress';
      record(m, '已提交升级', '固定目标 1.1.0 · 不创建重复购买订单', op.id);
      schedule(id, op);
    }
    if (cmd === 'reconcile' && m.operation?.stage === 'unknown') {
      m.operation.stage = 'succeeded'; activate(m, m.operation);
      record(m, '原操作核对完成', (m.operation.kind === 'uninstall' ? '示例回读确认已卸载：' : '示例回读确认：') + product(operationKey(m.operation)).title + ' ' + (m.operation.target || '1.1.0') + (m.operation.kind === 'uninstall' ? '；未重复提交卸载' : '，运行就绪；未新建安装'), m.operation.id);
    }
    persist(); paint(cmd === 'quote' ? 'skill-install-confirm' : cmd === 'toggle-confirm' ? 'skill-toggle' : 'skill-heading');
  }, true);
  document.addEventListener('change', e => {
    if (active && e.target.matches('[data-skill-permission]')) {
      const value = Number(e.target.dataset.skillPermission);
      active.approvals = e.target.checked ? [...new Set([...active.approvals, value])] : active.approvals.filter(i => i !== value);
      active.quote = null; paint(); $(`[data-skill-permission="${value}"]`, active.d)?.focus(); return;
    }
    if (active && e.target.matches('[data-skill-uninstall-outcome]') && !locked(model(active.id))) { model(active.id).uninstallOutcome = e.target.value; persist(); return; }
    if (active && e.target.matches('[data-skill-install-outcome]')) { model(active.id).installOutcome = e.target.value; persist(); return; }
    if (!e.target.matches('[data-skill-outcome]') || !active) return;
    const m = model(active.id); if (!locked(m)) { m.outcome = e.target.value; persist(); }
  });
  if (page === 'agents') renderAgents();
  if (selectedScenario === 'skill-management' && page === 'agents') {
    state.selectedAgent = { id: '4', name: '吴用' }; agentMobileDetail = true;
    renderAgents(); $('[data-action="skill-open"]')?.focus(); open('4');
  }
})();
