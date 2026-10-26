'use strict';
// Same P06 page and existing delivery/preview/picker controls; offline demo only.
(() => {
  if (selectedScenario !== 'image-turn') return;
  let timer;
  const captions = { running:'正在改图…', archiving:'图片已生成，正在准备预览…', unknown:'结果待核实', failed:'这次未完成', abandoned:'本轮结果已放弃', completed:'已完成' };
  const stage = () => state.imageTurn?.stage || 'completed';
  function setStage(next) {
    clearTimeout(timer);
    state.imageTurn = { stage: next };
    state.task = { title:'改成红色方块', description:'将图片中的蓝色方块改为红色方块，保留方块的形状和画布尺寸。', files:[], complete:false };
    state.agent = { id:'4', name:'吴用' };
    state.selectedAgent = { ...state.agent };
    state.deliveryEntry = { stage:'ready', selected:[], mode:'ok', submissionWrites:0, acceptanceWrites:0, operationId:null };
    state.outputs = next === 'completed' ? [{ id:'image-turn-red', name:'红色方块.svg', type:'image', url:'assets/delivery-red.svg', note:'形状和画布尺寸保持不变 · 原型示意' }] : [];
    const text = { completed:'已将方块改为红色，形状和画布尺寸保持不变。', unknown:'暂时无法确认生成结果。可核对原请求，不会重新生成。', failed:'图片未能生成。原需求和资料已保留，可继续补充说明。', abandoned:'不再接收本轮尚未交付的结果。已发生费用保留，不代表服务商已停止执行。' }[next] || '';
    state.messages = [{ role:'USER', text:state.task.description }, { role:'AGENT', text, outputs:state.outputs.map(a=>a.id) }];
    state.pending = false; state.error = null; state.delivery = []; state.final = []; state.operation = null;
    persist(); render();
  }
  const baseSend = send;
  send = function() {
    if (page==='chat' && ['running','archiving','unknown'].includes(stage())) return;
    return baseSend();
  };
  const baseChat = renderChat;
  renderChat = function() {
    baseChat(); if (page !== 'chat') return;
    const panel = $('.chat-panel'); if (!panel) return;
    $('.delivery-entry-demo', panel)?.remove();
    if (['running','archiving','unknown'].includes(stage())) $('.composer-send', panel).disabled=true;
    const reply = $$('.hall-message.AGENT', panel).at(-1);
    if (!reply) return;
    reply.classList.add('image-turn-reply');
    if (stage() !== 'completed') {
      $('.message-content', reply).insertAdjacentHTML('beforebegin', `<div class="image-turn-status" role="status"><span class="turn-dot ${['running','archiving'].includes(stage())?'is-active':''}" aria-hidden="true"></span>${esc(captions[stage()])}</div>`);
      $('.text-selection-archive', reply)?.remove();
    }
    if (['running','archiving','unknown'].includes(stage())) {
      reply.insertAdjacentHTML('beforeend', `<details class="image-turn-options"><summary>本轮操作</summary>${stage()==='unknown'?button('核对原请求','turn-check'):''}${button('放弃本轮未交付结果','turn-abandon','class="turn-danger"')}<small>不重新生成；已交付成果不可通过此操作删除。</small></details>`);
    }
    // Keep one source identity and one result: no typed answer block, generic "好汉" notification or separate results region.
    const summary = $('.context-summary em', panel); if (summary && !state.task.complete) summary.textContent = stage()==='completed'?'待你验收':captions[stage()];
    panel.insertAdjacentHTML('afterbegin', `<div class="image-turn-demo"><span>交互原型 · 同一条回复更新状态与成果</span><details><summary>切换演示状态</summary><div>${Object.entries(captions).filter(([key])=>key!=='abandoned').map(([key,label])=>button(label,'turn-stage',`data-stage="${key}" aria-pressed="${stage()===key}"`)).join('')}${button('播放生成过程','turn-play')}</div><small>仅离线演示，不调用模型、不扣费。</small></details></div>`);
  };
  document.addEventListener('click', e => {
    const b=e.target.closest('[data-action^="turn-"]'); if (!b || b.disabled) return;
    const a=b.dataset.action;
    if (a==='turn-stage') setStage(b.dataset.stage);
    if (a==='turn-play') { setStage('running'); timer=setTimeout(()=>{setStage('archiving');timer=setTimeout(()=>setStage('completed'),1000);},2000); }
    if (a==='turn-check') { setStage('archiving'); timer=setTimeout(()=>setStage('completed'),1000); }
    if (a==='turn-abandon') dialog('放弃本轮未交付结果？','<p>确认后不再接收本轮尚未交付的结果。</p><p>不会撤销已发生的生成费用，也不保证服务商停止执行。已上传或已交付的成果保留，不通过此操作删除。</p>',button('继续等待','close-dialog')+button('确认放弃','turn-abandon-confirm','class="turn-danger"'));
    if (a==='turn-abandon-confirm') { b.closest('dialog').close(); setStage('abandoned'); }
  });
  if (!state.imageTurn) setStage(new URLSearchParams(location.search).get('turn')==='running'?'running':'completed');
  else render();
})();
