/* Offline state examples only; never submits or replays a production request. */
(() => {
  if (new URLSearchParams(location.search).get('scenario') !== 'matter-status') return;
  let status = 'ADMITTED';
  const labels = { ADMITTED:'已发送', ATTACHED:'已进入议事', PREPARING:'准备中', UNKNOWN:'结果未知', FAILED:'发送失败', HISTORICAL:'历史指派' };
  const hints = { PREPARING:'正在准备议事…需求已保存，无需重复提交。', UNKNOWN:'发送结果暂未确认，请先查询，避免重复提交。', FAILED:'需求未能发送。原需求和资料已保留。' };
  const previous = renderDetail;
  renderDetail = function() {
    previous();
    const card = $('.matter-advice-card'); if (!card) return;
    card.querySelector('dl').insertAdjacentHTML('afterend', `<div class="matter-send-status ${status.toLowerCase()}">${hints[status]?`<p role="status">${hints[status]}</p>`:''}${status==='FAILED'?'<p role="alert">失败原因：会话准备失败（离线示例）</p>':''}${['PREPARING','UNKNOWN','FAILED'].includes(status)?button('查询发送结果','matter-status-check'):''}${status==='UNKNOWN'?button('继续原请求','matter-status-resume'):''}<details><summary>${status==='HISTORICAL'?'历史指派信息':'技术详情'}</summary><p>承办好汉：林冲</p><p>本次资料：1 份 · 原始图片.png</p><p>需求修订：1</p><p>好汉编号：demo-agent；资料编号：demo-file v1</p><p>发送状态：${labels[status]}</p></details></div>`);
    card.insertAdjacentHTML('afterend', `<details class="matter-status-demo"><summary>切换演示状态（离线）</summary>${Object.entries(labels).map(([key,label])=>button(label,'matter-status-stage',`data-stage="${key}" aria-pressed="${key===status}"`)).join('')}</details>`);
  };
  document.addEventListener('click', e => {
    const b=e.target.closest('[data-action^="matter-status-"]'); if (!b) return;
    if (b.dataset.action==='matter-status-stage') { status=b.dataset.stage; render(); }
    if (b.dataset.action==='matter-status-check') toast('离线示例：仅查询原请求，不重新发送');
    if (b.dataset.action==='matter-status-resume') toast('离线示例：沿用原请求和幂等键恢复，不创建新请求');
  });
  state.task = { title:'将图片中的文字改为线上连线一对一', description:'保留其余画面，只修改指定文字。', files:[{id:'demo-file',name:'原始图片.png'}], complete:false };
  state.agent={id:'4',name:'林冲'}; state.selectedAgent={...state.agent}; persist(); render();
})();
