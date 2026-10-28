/* Recommendation R1: offline examples only; never calls a model or dispatches a task. */
(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('scenario') !== 'assignee-recommendation') return;
  document.body.classList.add('model-recommendation-page');
  let stage = 'READY', manual = '', alternatives = false;
  const labels = { LOADING:'推荐中', READY:'推荐完成', NEEDS_CLARIFICATION:'需补充需求', NO_MATCH:'暂无合适推荐', NO_CANDIDATES:'暂无可承办候选', ERROR:'推荐暂不可用', STALE:'推荐已过期' };
  if (labels[params.get('recommendationState')]) stage = params.get('recommendationState');
  const previous = renderDetail;
  renderDetail = function () {
    previous();
    const card = document.querySelector('.matter-advice-card'); if (!card) return;
    const selected = manual || (stage === 'READY' ? '林冲' : '');
    card.innerHTML = `<div class="matter-advice-heading"><span>事项进展</span><strong>待确认承办</strong></div><h3>将图片中的腾讯会议改为线上连线</h3><p>保留其余画面，只修改指定文字。</p><dl><div><dt>${manual?'已选承办':'推荐承办'}</dt><dd>${selected||'尚未选择'}</dd></div></dl><section class="model-recommendation-demo" aria-live="polite"><h4>${labels[stage]}</h4><p>${stage==='READY'?'推荐理由（模型建议）：已登记图片编辑本领，相关技能当前可用。':stage==='ERROR'?'智能推荐暂不可用，可重试或手动选择合法候选。':stage==='STALE'?'事项或能力已变化，请重新推荐。':stage==='NEEDS_CLARIFICATION'?'请补充：需要保留原字体和排版吗？':stage==='LOADING'?'正在根据需求、本领和技能比较候选，不会启动办理。':stage==='NO_CANDIDATES'?'暂无可承办候选，请核对接单范围。':'没有足够依据给出推荐，可以另选承办。'}</p>${stage==='READY'?'<p>依据：图片编辑 · 已登记本领；相关技能已安装且当前启用。</p><p>待核实：字体和排版要求；技能就绪不保证工具依赖或最终效果。</p>':''}<button type="button" data-model-retry ${stage==='LOADING'?'disabled':''}>重新推荐</button></section><p>推荐仅供参考；选择不会执行，确认后沿原流程交办。</p><button type="button" data-model-alternatives aria-expanded="${alternatives}">另选承办Agent</button>${alternatives?`<div class="model-manual-options">${['林冲','吴用'].map(name=>`<button type="button" data-model-candidate="${name}" aria-pressed="${selected===name}">${name} · 手动选择（虚构示例）</button>`).join('')}</div>`:''}<div class="matter-primary-actions"><button type="button" class="matter-primary-action" data-model-confirm ${!selected?'disabled':''}>确认承办，进入议事</button></div><p class="draft-hint">离线演示：人物与能力均为虚构，不执行、不扣费。</p><details><summary>切换演示状态</summary><div class="model-state-options">${Object.entries(labels).map(([key,label])=>`<button type="button" data-recommendation-stage="${key}" aria-pressed="${key===stage}">${label}</button>`).join('')}</div></details>`;
  };
  document.addEventListener('click', e => {
    const b=e.target.closest('button'); if(!b)return;
    if(b.dataset.recommendationStage){stage=b.dataset.recommendationStage;manual='';render();}
    if(b.hasAttribute('data-model-alternatives')){alternatives=!alternatives;render();}
    if(b.dataset.modelCandidate){manual=b.dataset.modelCandidate;render();}
    if(b.hasAttribute('data-model-retry')){stage='LOADING';render();}
    if(b.hasAttribute('data-model-confirm'))toast('离线演示：仅确认选择，未发送真实任务。');
  });
  state.task={title:'将图片中的腾讯会议改为线上连线',description:'保留其余画面，只修改指定文字。',files:[],complete:false};
  state.agent=null; render();
})();
