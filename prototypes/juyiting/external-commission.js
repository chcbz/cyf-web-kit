'use strict';
// Offline fixtures only. Ownership and switches use IDs, never display names.
const commissionViewer='demo-owner-a';
const commissionAgents=[
 {id:'0',name:'公孙胜',owner:'demo-owner-b',ownerLabel:'山水工作室',open:true,status:'在线',ability:'创意与图像表达',match:'画|图片|插画|设计'},
 {id:'1',name:'扈三娘',owner:'demo-owner-c',ownerLabel:'青禾',open:true,status:'忙碌',ability:'能力待完善',match:null},
 {id:'2',name:'李逵',owner:'demo-owner-b',ownerLabel:'山水工作室',open:false,status:'离线',ability:'资料整理',match:'整理'},
 {id:'3',name:'林冲',owner:commissionViewer,ownerLabel:'chcbz',open:false,status:'离线',ability:'执行与核对',match:'执行|核对'},
 {id:'4',name:'吴用',owner:commissionViewer,ownerLabel:'chcbz',open:false,status:'在线',ability:'梳理需求与方案',match:'方案|整理|分析'}
];
// Transient demo responses only; never infer server state from a timeout.
const commissionOperations = new Map();
function commissionOperation(a) {
 if (!commissionOperations.has(a.id)) {
  const requested = new URLSearchParams(location.search).get('commissionState');
  commissionOperations.set(a.id, {stage:['pending','failed','unknown'].includes(requested)?requested:'idle'});
 }
 return commissionOperations.get(a.id);
}
function commissionControl(a) {
 const op=commissionOperation(a),checked=commissionOpen(a),locked=['pending','unknown'].includes(op.stage);
 const status=op.stage==='pending'?'保存中…':op.stage==='unknown'?'待核对':checked?'已开启':'已关闭';
 return `<span class="commission-switch-group"><span class="commission-switch-status" aria-hidden="true">${status}</span>${button('<span class="commission-switch-track" aria-hidden="true"><span class="commission-switch-thumb"></span></span>','commission-toggle',`class="commission-switch" data-agent="${a.id}" role="switch" aria-checked="${checked}" aria-busy="${op.stage==='pending'}" aria-label="${esc(a.name)}接受平台其他用户的委派" aria-describedby="commission-detail-hint commission-setting-result" ${locked?'disabled':''}`)}</span>`;
}
function commissionOpen(a){return state.commissionSwitches?.[a.id]??a.open;}
function commissionEligible(){return commissionAgents.filter(a=>a.owner===commissionViewer||commissionOpen(a));}
function commissionScore(a){return a.match&&new RegExp(a.match).test(state.task?.description||'')?95:a.match?45:null;}
function renderCommissionRoster(){
 const panel=$('.agent-panel');if(!panel)return;
 $('.commission-profile',panel)?.remove();$('[data-action="commission-inbox"]',panel)?.remove();
 $$('.agent-row',panel).forEach(row=>{
  const a=commissionAgents.find(a=>a.id===row.dataset.agent);if(!a)return;
  const label={'在线':'候命','忙碌':'办事','离线':'失联'}[a.status];
  if($('em',row))$('em',row).textContent=label;
  row.hidden=!!Number(state.agentFilter)&&label!==['','候命','办事','出征','失联'][Number(state.agentFilter)];row.style.display=row.hidden?'none':'';
 });
 const selected=commissionAgents.find(a=>a.id===state.selectedAgent?.id),head=$('.agent-detail-scroll .detail-head',panel);
 if(!head||!selected)return;
 const own=selected.owner===commissionViewer;
 const op=own?commissionOperation(selected):null;
 const message=op?.stage==='pending'?'正在保存设置…':op?.stage==='failed'?'保存失败，设置未更改，请重试。':op?.stage==='unknown'?'暂时无法确认保存结果，请先核对。':'';
 head.insertAdjacentHTML('afterend',`<div class="commission-profile"><div class="commission-detail-setting"><span>接受平台其他用户的委派</span>${own?commissionControl(selected):`<span class="commission-readonly">${commissionOpen(selected)?'已开启':'已关闭'} · 仅拥有者可修改</span>`}</div><p id="commission-detail-hint" class="agent-profile-note">${own?'面向同平台所有用户；关闭不影响已接任务，不要求当前在线。':'外部 Agent · '+esc(selected.ownerLabel)+'；仅拥有者可修改。'}</p><div id="commission-setting-result" class="commission-setting-result ${op?.stage==='failed'?'is-error':''}" role="status">${message}${op?.stage==='unknown'?button('核对结果','commission-check',`class="semantic-action" data-agent="${selected.id}"`):''}</div></div>`);
}
function commissionAssignment(){
 const candidates=commissionEligible().sort((a,b)=>(commissionScore(b)||0)-(commissionScore(a)||0));
 if(!candidates.some(a=>a.id===state.task.assignmentCandidate))state.task.assignmentCandidate=candidates[0]?.id;
 const selected=candidates.find(a=>a.id===state.task.assignmentCandidate);
 return `<section class="matter-assignment commission-assignment" aria-label="确认承办"><h4>选择承办 Agent</h4><p>自己的 Agent ＋ 他人已开启外单的 Agent。能力只影响推荐，所有候选均可选择。</p><details class="recommendation-alternative" open><summary>当前候选：${esc(selected?.name||'未选择')}</summary><div class="recommendation-options">${candidates.map(a=>button(`<span class="recommendation-avatar">${a.name.slice(0,1)}</span><span><strong>${esc(a.name)} <small>${a.owner===commissionViewer?'我的':'外部 · '+esc(a.ownerLabel)}</small></strong><small>${a.status} · ${esc(a.ability)}</small><small>${commissionScore(a)===null?'能力未知 · 仍可选择':commissionScore(a)===95?'推荐 · 与当前需求匹配':'匹配较低 · 仍可选择'}${a.status!=='在线'?' · 委派后等待运行':''}</small></span><span>${selected?.id===a.id?'✓':''}</span>`,'complete-recommend-agent',`data-agent="${a.id}" aria-pressed="${selected?.id===a.id}"`)).join('')||'<p role="status">暂无可承办的 Agent。</p>'}</div></details><p class="commission-note">承办所属：${esc(selected?.ownerLabel||'其他用户')}。确认后将任务内容和所列资料发送给该Agent开始办理；资料由该Agent运行环境及所使用的模型服务处理。</p><p>当前任务资料：${state.task.files.map(f=>esc(typeof f==='string'?f:f.name||'资料')).join('、')||'无'}（离线示例）。离线或忙碌将等待运行，提交成功不代表模型已运行。</p></section>`;
}
function commissionConfirm(){
 if(!awaitingAssignment())return;const a=commissionEligible().find(a=>a.id===state.task.assignmentCandidate);if(!a){feedback('候选已不可接单，请重新选择。');renderDetail();return;}
 const before=JSON.stringify({task:state.task,agent:state.agent,selectedAgent:state.selectedAgent,messages:state.messages});
 state.agent={id:a.id,name:a.name};state.selectedAgent={...state.agent};Object.assign(state.task,{commission:true,commissionWaiting:a.status!=='在线',notStarted:false,phase:a.status==='在线'?'正在处理':'待运行',assignmentCandidate:a.id,providerOwner:a.owner});state.messages=[];
 if(state.task.commissionWaiting)state.messages=[{role:'USER',text:state.task.description,files:[...state.task.files]},{role:'AGENT',text:'已提交原任务，等待运行；无需再次启动。这是离线示例，不是真实回执。'}];
 if(!persist()){Object.assign(state,JSON.parse(before));feedback('保存失败，尚未委派，请重试。');return;}
 go('chat');if(!state.task.commissionWaiting)sendUnifiedMessage(state.task.description,[...state.task.files]);
}
function renderCommissionProgress(){if(!state.task?.commission||!['chat','detail'].includes(page))return;const target=page==='chat'?$('.chat-panel'):$('.matter-state-card');if(!target)return;$('.commission-progress')?.remove();target.insertAdjacentHTML('afterbegin',`<section class="commission-progress" role="status"><strong>${esc(state.agent?.name)} · ${state.task.commissionWaiting?'已委派 · 等待运行':'离线办理演示'}</strong><p>确认即自动沿原任务办理，无需额外启动；关闭接外单不撤销本单。</p><small>离线示例不调用真实模型，不报价、不扣费。</small></section>`);}
document.addEventListener('click',event=>{
 const t=event.target.closest('[data-action]');if(!t||!t.dataset.action.startsWith('commission-'))return;event.preventDefault();event.stopImmediatePropagation();
 const action=t.dataset.action;
 if(action==='commission-toggle'){
  const a=commissionAgents.find(a=>a.id===t.dataset.agent&&a.owner===commissionViewer);if(!a)return;
  const op=commissionOperation(a);if(['pending','unknown'].includes(op.stage))return;
  const old=commissionOpen(a);op.stage='pending';renderAgents();
  // Simulated latency for the offline prototype; no real request or automatic retry.
  setTimeout(()=>{
   const outcome=new URLSearchParams(location.search).get('commissionOutcome')||'ok';
   if(outcome==='unknown')op.stage='unknown';
   else if(outcome==='failed')op.stage='failed';
   else {state.commissionSwitches||={};state.commissionSwitches[a.id]=!old;if(!persist()){state.commissionSwitches[a.id]=old;op.stage='failed';}else op.stage='idle';}
   if(page==='agents'&&state.selectedAgent?.id===a.id){
    const restoreFocus=document.activeElement===document.body;renderAgents();
    if(restoreFocus)$(`[data-action="${op.stage==='unknown'?'commission-check':'commission-toggle'}"][data-agent="${a.id}"]`)?.focus();
    if(op.stage==='idle')feedback(!old?'已开启：同平台用户可委派（原型示例）':'已关闭：不影响已接任务（原型示例）');
   }
  },600);
 }
 if(action==='commission-check'){
  const a=commissionAgents.find(a=>a.id===t.dataset.agent&&a.owner===commissionViewer);if(!a)return;
  const op=commissionOperation(a);if(op.stage!=='unknown')return;
  if(new URLSearchParams(location.search).get('commissionRead')==='failed'){feedback('暂未读到最新设置，请稍后核对（原型示例）。');return;}
  op.stage='idle';renderAgents();$(`[data-action="commission-toggle"][data-agent="${a.id}"]`)?.focus();feedback('已核对，设置未更改（原型示例，不会重新提交）。');
 }
});
