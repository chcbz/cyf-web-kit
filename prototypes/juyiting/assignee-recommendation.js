/* Recommendation R1: offline examples only; never calls a model or dispatches a task. */
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('scenario') !== 'assignee-recommendation') return;
  document.body.classList.add('model-recommendation-page');
  let stage = 'READY', manual = '', alternatives = true;
  const labels = { LOADING:'推荐中', READY:'推荐完成', NO_MATCH:'暂无合适推荐', NO_CANDIDATES:'暂无可承办候选', ERROR:'推荐暂不可用', STALE:'推荐已过期' };
  if (labels[params.get('recommendationState')]) stage = params.get('recommendationState');
  const previous = renderDetail;
  renderDetail = function () {
    previous();
    document.body.classList.add('model-recommendation-page');
    const card = document.querySelector('.matter-advice-card'); if (!card) return;
    const candidates = stage === 'NO_CANDIDATES' ? [] : [{name:'林冲',mine:true,status:'在线',level:'高',reason:'具备识图能力，适合读取成绩图片并整理统计。'},{name:'吴用',mine:false,status:'离线',level:'资料不足',reason:'尚无公开能力介绍，可自行选择后交办。'}];
    const visible = candidates;
    const selected = manual || (stage === 'READY' ? '林冲' : '');
    card.innerHTML = `<div class="matter-advice-heading"><span>事项进展</span><strong>待确认承办</strong></div><h3>统计一下成绩</h3><p>请根据上传的成绩图片整理统计。</p><dl><div><dt>${manual?'已选承办':'推荐承办'}</dt><dd>${selected||'尚未选择'}</dd></div></dl>${['LOADING','ERROR','STALE'].includes(stage)?`<section class="model-recommendation-demo" aria-live="polite"><div class="model-recommendation-status" role="status">${stage==='LOADING'?'<span class="model-recommendation-spinner" aria-hidden="true"></span>':''}<strong>${stage==='LOADING'?'正在为你挑选合适的好汉…':labels[stage]}</strong></div>${stage==='LOADING'?'<p class="model-recommendation-hint">推荐完成后，你可以查看理由并选择承办人。</p>':'<button type="button" data-model-retry>重新推荐</button>'}</section>`:''}<button type="button" data-model-alternatives aria-expanded="${alternatives}" ${stage==='LOADING'?'disabled':''}>${alternatives?'收起承办候选':'选择承办好汉'}</button>${alternatives?`<div class="model-manual-options">${visible.map(a=>`<button type="button" data-model-candidate="${a.name}" aria-pressed="${selected===a.name}" ${stage==='LOADING'?'disabled':''}><span class="model-candidate-avatar" aria-hidden="true">${a.name.slice(0,1)}</span><span><strong>${a.name}</strong><small>${a.mine?'我的':'外部'} · ${a.status}</small>${stage!=='LOADING'?`<small class="model-recommendation-level">${stage==='NO_MATCH'?'推荐度低':a.level==='资料不足'?'资料不足':`推荐度${a.level}`}</small><small>${stage==='NO_MATCH'?'现有能力与这项需求不太匹配，仍可手选。':a.reason}</small>`:''}</span><span aria-hidden="true">${selected===a.name?'✓':''}</span></button>`).join('')||'<p role="status">暂无可选承办人。</p>'}</div>`:''}<div class="matter-primary-actions"><button type="button" class="matter-primary-action" data-model-confirm ${!selected||stage==='LOADING'?'disabled':''}>确认承办，进入议事</button></div>${stage==='NO_CANDIDATES'?'<p role="status">暂未寻得可领令的好汉。</p>':''}<p class="draft-hint">离线演示：人物与能力均为虚构，不执行、不扣费。</p><details><summary>切换演示状态</summary><div class="model-state-options">${Object.entries(labels).map(([key,label])=>`<button type="button" data-recommendation-stage="${key}" aria-pressed="${key===stage}">${label}</button>`).join('')}</div></details>`;
  };
  document.addEventListener('click', e => {
    const b=e.target.closest('button'); if(!b)return;
    if(b.dataset.recommendationStage){stage=b.dataset.recommendationStage;manual='';render();}
    if(b.hasAttribute('data-model-alternatives')){alternatives=!alternatives;render();}
    if(b.dataset.modelCandidate){manual=b.dataset.modelCandidate;render();}
    if(b.hasAttribute('data-model-retry')){stage='LOADING';render();}
    if(b.hasAttribute('data-model-confirm'))toast('离线演示：仅确认选择，未发送真实任务。');
  });
  state.task={title:'统计一下成绩',description:'请根据上传的成绩图片整理统计。',files:[],complete:false};
  state.agent=null; render();
})();
