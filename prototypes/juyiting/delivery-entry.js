'use strict';
// Offline only: no API, model invocation, or production task writes.
(() => {
  if (!['delivery-entry', 'image-turn'].includes(selectedScenario)) return;
  let timer;
  const d=()=>state.deliveryEntry;
  function seed(){
    state.task={title:'将图片改成红色',description:'将图片改成红色',files:[],complete:false};
    state.agent={id:'4',name:'吴用'};state.selectedAgent={...state.agent};
    state.outputs=[{id:'delivery-demo-red-v1',name:'红色图片-第1稿.svg',type:'image',url:'assets/delivery-red.svg',note:'第 1 稿 · 原型示意'}];
    state.messages=[{role:'USER',text:'将图片改成红色。'},{role:'AGENT',text:'图片已生成。可以继续修改，也可以验收任意一稿。',outputs:[state.outputs[0].id]}];
    state.delivery=[];state.final=[];state.operation=null;state.pending=false;state.error=null;state.chatDraft='';state.chatFiles=[];
    state.deliveryEntry={stage:'ready',selected:[],mode:'ok',submissionWrites:0,acceptanceWrites:0,operationId:null};persist();
  }
  if(!d())seed();
  if(d().stage==='submitting')d().stage='unknown';
  if(d().stage==='accepting')d().stage='accept-unknown';
  const busy=()=>['submitting','accepting'].includes(d().stage);
  const frozen=()=>['submitting','unknown','failed','submitted','accepting','accept-unknown','accepted'].includes(d().stage);
  const complete=()=>d().stage==='accepted';
  const captions={ready:'可选择任意成果验收',submitting:'正在提交所选成果…',failed:'提交未成功，可重试原操作',unknown:'提交结果待核对',submitted:'成果已提交，待确认验收',accepting:'正在确认验收…','accept-unknown':'验收结果待核对',accepted:'已验收 · 事项已完成'};
  const baseDiscussion=handleSubmittedDiscussion;
  handleSubmittedDiscussion=function(...args){return conversation()===state?false:baseDiscussion(...args);};
  const baseSend=send;
  send=function(){if(conversation()===state&&frozen())return;return baseSend();};
  const baseOutput=output;
  output=function(type,text,revision,ctx){const id=baseOutput(type,text,revision,ctx);if((ctx||conversation())===state&&type==='image'){const a=state.outputs.find(x=>x.id===id);a.name=`红色图片-第${revision}稿.svg`;a.url=revision%2===0?'assets/delivery-red-v2.svg':'assets/delivery-red.svg';}return id;};
  const basePreview=preview;
  preview=function(id){
    basePreview(id);
    $$('dialog.attachment-preview [data-action="download"]').forEach(button=>{
      const footer=button.closest('footer');button.remove();
      if(footer&&!footer.children.length)footer.remove();
    });
  };
  const baseResult=result;
  result=function(a){
    if(conversation()!==state||!state.outputs.some(x=>x.id===a.id))return baseResult(a);
    return `<section class="mmd-result delivery-entry-card" data-result="${esc(a.id)}"><div class="delivery-entry-heading"><strong>${esc(a.name)}</strong></div>${media(a)}<p class="delivery-entry-state">${complete()?(d().selected.includes(a.id)?'本次已验收':'未纳入本次验收'):(a.note||'已有成果')}</p><div class="delivery-entry-actions">${button('预览','preview',`data-id="${esc(a.id)}"`)}${complete()?'':button('验收此版','delivery-open',`data-id="${esc(a.id)}" class="delivery-primary" ${busy()?'disabled':''}`)}</div></section>`;
  };
  const baseChat=renderChat;
  renderChat=function(){
    baseChat();if(page!=='chat')return;const panel=$('.chat-panel');if(!panel)return;
    $$('.delivery-entry-demo',panel).forEach(e=>e.remove());
    $$('[aria-label="查看并验收"], [data-action="delivery-all"]',panel).forEach(e=>e.remove());
    $('.toolbar-actions',panel)?.insertAdjacentHTML('beforeend',button(uiIcon('acceptance'),'delivery-all',`class="icon-button acceptance-icon" title="${complete()?'验收记录':'验收'}" aria-label="${complete()?'验收记录':'统一验收'}"`));
    const em=$('.context-summary em',panel);if(em)em.textContent=captions[d().stage];
    panel.insertAdjacentHTML('afterbegin',`<section class="delivery-entry-demo"><span>交互原型 · 不操作真实事项</span><details><summary>演示状态</summary><div>${button('正常提交','delivery-mode','data-mode="ok"')}${button('提交失败','delivery-mode','data-mode="failed"')}${button('提交结果未知','delivery-mode','data-mode="unknown"')}${button('重新体验','delivery-reset')}</div><small>本机模拟，不调用模型。</small></details></section>`);
  };
  function closeOwn(){$$('dialog.delivery-entry-dialog').forEach(e=>e.close());}
  function review(){
    closeOwn();const locked=frozen();
    const items=locked?state.outputs.filter(a=>d().selected.includes(a.id)):state.outputs;
    const content=items.map(a=>`<section class="delivery-choice"><label><input type="checkbox" data-delivery-select="${esc(a.id)}" ${d().selected.includes(a.id)?'checked':''} ${locked?'disabled':''}><strong>${esc(a.name)}</strong></label>${media(a)}<small>${esc(a.note||'已有成果')}</small></section>`).join('');
    const actionLabel=({failed:'重试原提交',unknown:'核对原提交','accept-unknown':'核对原验收'})[d().stage]||(busy()?'处理中…':'确认验收');
    const footer=complete()?button('关闭','close-dialog'):(locked?'':button('继续修改','delivery-modify'))+button(actionLabel,'delivery-accept',`class="delivery-primary" ${busy()||!d().selected.length?'disabled':''}`);
    const modal=dialog(complete()?'已验收成果':'选择成果并验收',`<div class="delivery-review-body"><p class="delivery-review-status" role="status">${captions[d().stage]}</p><p>将图片改成红色 · <span data-selection-count>已选 ${d().selected.length} 份</span></p><p class="delivery-review-note">可选择一份或多份，包括历史版本。仅验收勾选成果，不要求使用最新稿。</p>${content||'<p>暂无可验收成果</p>'}<p class="delivery-review-note">${locked?'本次操作的成果已固定；核对原操作不会重复提交。':'点击“确认验收”后，提交所选已有成果并完成事项。关闭窗口不提交、不验收，不重新生成。'}</p></div>`,footer);modal.classList.add('delivery-entry-dialog');
  }
  function finish(){d().stage='accepted';state.task.complete=true;state.final=[...d().selected];persist();renderChat();review();}
  function accept(){d().acceptanceWrites=1;d().stage='accepting';persist();renderChat();review();timer=setTimeout(finish,650);}
  function submit(){
    d().operationId||='demo-submit-'+Date.now();d().submissionWrites=1;d().stage='submitting';persist();renderChat();review();
    timer=setTimeout(()=>{const mode=d().mode;d().mode='ok';if(mode!=='ok'){d().stage=mode;persist();renderChat();review();return;}state.delivery=[...d().selected];accept();},800);
  }
  document.addEventListener('change',e=>{const id=e.target.dataset.deliverySelect;if(!id||frozen())return;d().selected=e.target.checked?[...new Set([...d().selected,id])]:d().selected.filter(x=>x!==id);persist();const modal=e.target.closest('dialog');$('[data-selection-count]',modal).textContent=`已选 ${d().selected.length} 份`;$('[data-action="delivery-accept"]',modal).disabled=!d().selected.length;});
  document.addEventListener('click',e=>{
    const t=e.target.closest('[data-action]');if(!t||!t.dataset.action.startsWith('delivery-'))return;e.preventDefault();e.stopImmediatePropagation();
    const action=t.dataset.action;
    if(action==='delivery-all'||action==='delivery-open'){
      if(!frozen())d().selected=action==='delivery-open'?[t.dataset.id]:[];
      else if(action==='delivery-open'&&!d().selected.includes(t.dataset.id)){feedback('请先核对当前未完成的验收操作，不能替换其中成果。');}
      persist();review();
    }
    if(action==='delivery-accept'&&!busy()&&d().selected.length){
      if(['ready','failed'].includes(d().stage))submit();
      else if(['unknown','submitted'].includes(d().stage)){state.delivery=[...d().selected];accept();}
      else if(d().stage==='accept-unknown')finish();
    }
    if(action==='delivery-modify'&&!frozen()){closeOwn();state.chatDraft='请把这张图片改成深红色';persist();renderChat();$('.composer-textarea')?.focus();}
    if(action==='delivery-mode'&&!frozen()){d().mode=t.dataset.mode;persist();renderChat();}
    if(action==='delivery-reset'){clearTimeout(timer);closeOwn();seed();go('chat');}
  },true);
  render();
})();
