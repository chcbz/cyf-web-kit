/* Recommendation R1: offline examples only; never calls a model or dispatches a task. */
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('scenario') !== 'assignee-recommendation') return;
  document.body.classList.add('model-recommendation-page');
  let stage = 'READY', manual = '', alternatives = true, filter = 'all';
  const labels = { LOADING:'推荐中', READY:'推荐完成', NO_MATCH:'暂无合适推荐', NO_CANDIDATES:'暂无可承办候选', ERROR:'推荐暂不可用', STALE:'推荐已过期' };
  if (labels[params.get('recommendationState')]) stage = params.get('recommendationState');
  const previous = renderDetail;
  renderDetail = function () {
    previous();
    document.body.classList.add('model-recommendation-page');
    const card = document.querySelector('.matter-advice-card'); if (!card) return;
    const candidates = stage === 'NO_CANDIDATES' ? [] : [{name:'林冲',mine:true,status:'在线',level:'高',reason:'具备识图能力，适合读取成绩图片并整理统计。'},{name:'吴用',mine:false,status:'离线',level:'资料不足',reason:'尚无公开能力介绍，可自行选择后交办。'}];
    const visible = candidates.filter(a => filter === 'all' || (filter === 'mine') === a.mine);
    const selected = manual || (stage === 'READY' ? '林冲' : '');
    card.innerHTML = `<div class="matter-advice-heading"><span>事项进展</span><strong>待确认承办</strong></div><h3>统计一下成绩</h3><p>请根据上传的成绩图片整理统计。</p><dl><div><dt>${manual?'已选承办':'推荐承办'}</dt><dd>${selected||'尚未选择'}</dd></div></dl><section class="model-recommendation-demo" aria-live="polite"><div class="model-recommendation-status" role="status">${stage==='LOADING'?'<span class="model-recommendation-spinner" aria-hidden="true"></span>':''}<strong>${stage==='LOADING'?'正在为你挑选合适的好汉…':labels[stage]}</strong></div>${stage==='LOADING'?'<p class="model-recommendation-hint">请稍候，推荐完成后，你可以查看理由并选择承办人。</p>':`<details class="model-requirement-summary"><summary>需求理解</summary><p>读取图片中的成绩，再进行整理与统计。</p></details>`}<button type="button" data-model-retry ${stage==='LOADING'?'disabled':''}>重新推荐</button></section><p>推荐仅供参考；选择不会执行，确认后沿原流程交办。</p><button type="button" data-model-alternatives aria-expanded="${alternatives}" ${stage==='LOADING'?'disabled':''}>另选承办Agent</button>${alternatives?`<div class="model-state-options" aria-label="候选所属筛选">${[['all','全部'],['mine','我的'],['external','外部']].map(([key,label])=>`<button data-model-filter="${key}" aria-pressed="${filter===key}">${label}</button>`).join('')}</div><div class="model-manual-options">${visible.map(a=>`<button type="button" data-model-candidate="${a.name}" aria-pressed="${selected===a.name}" ${stage==='LOADING'?'disabled':''}><span class="model-candidate-avatar" aria-hidden="true">${a.name.slice(0,1)}</span><span><strong>${a.name}</strong><small>${a.mine?'我的':'外部'} · ${a.status}</small>${stage!=='LOADING'?`<small class="model-recommendation-level">${stage==='NO_MATCH'?'推荐度低':a.level==='资料不足'?'资料不足':`推荐度${a.level}`}</small><small>${stage==='NO_MATCH'?'现有能力与这项需求不太匹配，仍可手选。':a.reason}</small>`:''}</span><span aria-hidden="true">${selected===a.name?'✓':''}</span></button>`).join('')||'<p role="status">暂无符合当前筛选的承办人。</p>'}</div>`:''}<div class="matter-primary-actions"><button type="button" class="matter-primary-action" data-model-confirm ${!selected||stage==='LOADING'?'disabled':''}>确认承办，进入议事</button></div>${stage==='NO_CANDIDATES'?'<p role="status">暂未寻得可领令的好汉。</p>':''}<p class="draft-hint">离线演示：人物与能力均为虚构，不执行、不扣费。</p><details><summary>切换演示状态</summary><div class="model-state-options">${Object.entries(labels).map(([key,label])=>`<button type="button" data-recommendation-stage="${key}" aria-pressed="${key===stage}">${label}</button>`).join('')}</div></details>`;
  };
  document.addEventListener('click', e => {
    const b=e.target.closest('button'); if(!b)return;
    if(b.dataset.recommendationStage){stage=b.dataset.recommendationStage;manual='';render();}
    if(b.hasAttribute('data-model-alternatives')){alternatives=!alternatives;render();}
    if(b.dataset.modelFilter){filter=b.dataset.modelFilter;render();}
    if(b.dataset.modelCandidate){manual=b.dataset.modelCandidate;render();}
    if(b.hasAttribute('data-model-retry')){stage='LOADING';render();}
    if(b.hasAttribute('data-model-confirm'))toast('离线演示：仅确认选择，未发送真实任务。');
  });
  state.task={title:'统计一下成绩',description:'请根据上传的成绩图片整理统计。',files:[],complete:false};
  state.agent=null; render();
})();
