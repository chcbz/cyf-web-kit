/* Recommendation R1: offline examples only; never calls a model or dispatches a task. */
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('scenario') !== 'assignee-recommendation') return;
  document.body.classList.add('model-recommendation-page');
  let stage = 'READY', manual = '', alternatives = null;
  const labels = { LOADING:'推荐中', READY:'推荐完成', NO_MATCH:'暂无合适推荐', NO_CANDIDATES:'暂无可承办候选', ERROR:'推荐暂不可用', STALE:'推荐已过期' };
  if (labels[params.get('recommendationState')]) stage = params.get('recommendationState');
  const previous = renderDetail;
  renderDetail = function () {
    previous();
    document.body.classList.add('model-recommendation-page');
    const card = document.querySelector('.matter-advice-card'); if (!card) return;
    if (params.get('fundedHistory') === 'true') {
      const materials = document.querySelector('.task-material-links');
      materials?.querySelectorAll('.matter-edit-button').forEach(button => button.remove());
      const hint = materials?.querySelector('.mmd-muted'); if (hint) hint.textContent = '历史资料与成果仅供查阅，不再修改需求或追加执行。';
      card.innerHTML = '<div class="matter-advice-heading"><span>历史资金榜</span><strong>仅供查阅</strong></div><h3>原资金榜事项</h3><p>旧资金榜已停止创建、领令、恢复、退款和结算操作；历史记录仍可查阅。</p><p>原请求结果未知时，不会自动重发，不会按新规则补价执行。</p><button type="button" data-history-settlement>查看历史结算示例</button><p data-history-receipt hidden>原始历史结算：总额100文，成本3文，平台费2文，好汉所得95文。仅为离线示例。</p>';
      return;
    }
    const candidates = stage === 'NO_CANDIDATES' ? [] : [{name:'林冲',quote:13,mine:true,status:'在线',level:'高',reason:'具备识图能力，适合读取成绩图片并整理统计。'},{name:'吴用',quote:null,mine:false,status:'离线',level:'资料不足',reason:'尚无公开能力介绍，可自行选择后交办。'}];
    const visible = candidates;
    const selected = manual || (stage === 'READY' ? '林冲' : '');
    const expanded = alternatives ?? (!selected && stage !== 'LOADING');
    const selectedAgent = candidates.find(a => a.name === selected);
    card.innerHTML = `<div class="matter-advice-heading"><span>事项进展</span><strong>待确认承办</strong></div><h3>统计一下成绩</h3><p>请根据上传的成绩图片整理统计。</p><dl><div><dt>${manual?'已选承办':'推荐承办'}</dt><dd>${selected||(stage==='LOADING'?'正在推荐…':'请选择承办人')}</dd></div>${selectedAgent?`<div><dt>所属用户 / 当前状态</dt><dd>${selectedAgent.mine?'我的':'外部'} · ${selectedAgent.status}</dd></div>`:''}</dl>${selectedAgent?`<p class="model-selected-reason">${selectedAgent.reason}</p><p>${selectedAgent.quote===null?'暂无法报价，请选择其他承办人或稍后重试':`事项报价：${selectedAgent.quote}文 · 确认承办时预占，验收后扣除`}</p>`:''}${['LOADING','ERROR','STALE'].includes(stage)?`<section class="model-recommendation-demo" aria-live="polite"><div class="model-recommendation-status" role="status">${stage==='LOADING'?'<span class="model-recommendation-spinner" aria-hidden="true"></span>':''}<strong>${stage==='LOADING'?'正在为你挑选合适的好汉…':labels[stage]}</strong></div>${stage==='LOADING'?'<p class="model-recommendation-hint">推荐完成后，你可以查看理由并选择承办人。</p>':'<button type="button" data-model-retry>重新推荐</button>'}</section>`:''}<button type="button" data-model-alternatives aria-expanded="${expanded}" ${stage==='LOADING'?'disabled':''}>${expanded?'收起候选列表':selected?'更换承办人':'选择承办人'}</button>${expanded?`<div class="model-manual-options">${visible.map(a=>`<button type="button" data-model-candidate="${a.name}" aria-pressed="${selected===a.name}" ${stage==='LOADING'?'disabled':''}><span class="model-candidate-avatar" aria-hidden="true">${a.name.slice(0,1)}</span><span><strong>${a.name}</strong><small>${a.quote===null?'暂无法报价':`事项报价 ${a.quote}文`}</small><small>${a.mine?'我的':'外部'} · ${a.status}</small>${stage!=='LOADING'?`<small class="model-recommendation-level">${stage==='NO_MATCH'?'匹配较低':a.level==='资料不足'?'资料不足':'优先推荐'}</small><small>${stage==='NO_MATCH'?'现有能力与这项需求不太匹配，仍可手选。':a.reason}</small>`:''}</span><span aria-hidden="true">${selected===a.name?'✓':''}</span></button>`).join('')||'<p role="status">暂无可选承办人。</p>'}</div>`:''}<div class="matter-primary-actions"><button type="button" class="matter-primary-action" data-model-confirm ${!selected||selectedAgent?.quote==null||stage==='LOADING'?'disabled':''}>${selected?`确认由${selected}承办`:'请选择承办人'}</button></div>${stage==='NO_CANDIDATES'?'<p role="status">暂未寻得可领令的好汉。</p>':''}<p class="draft-hint">离线演示：人物、能力和13文报价均为合成示例，不执行、不预占、不扣费。</p><details><summary>切换演示状态</summary><div class="model-state-options">${Object.entries(labels).map(([key,label])=>`<button type="button" data-recommendation-stage="${key}" aria-pressed="${key===stage}">${label}</button>`).join('')}</div></details>`;
  };
  document.addEventListener('click', e => {
    const b=e.target.closest('button'); if(!b)return;
    if(b.hasAttribute('data-history-settlement')){e.preventDefault();e.stopImmediatePropagation();document.querySelector('[data-history-receipt]').hidden=false;return;}
    if(b.dataset.recommendationStage){stage=b.dataset.recommendationStage;manual='';alternatives=null;render();}
    if(b.hasAttribute('data-model-alternatives')){alternatives=b.getAttribute('aria-expanded')!=='true';render();document.querySelector('[data-model-alternatives]')?.focus();}
    if(b.dataset.modelCandidate){manual=b.dataset.modelCandidate;alternatives=false;render();document.querySelector('[data-model-alternatives]')?.focus();}
    if(b.hasAttribute('data-model-retry')){stage='LOADING';render();}
    if(b.hasAttribute('data-model-confirm'))toast('离线演示：仅确认选择，未发送真实任务。');
  }, true);
  state.task={title:'统计一下成绩',description:'请根据上传的成绩图片整理统计。',files:[],complete:false};
  state.agent=null; render();
})();
