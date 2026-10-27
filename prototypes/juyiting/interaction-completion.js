'use strict';
// Latest UI stays authoritative. This file only completes OFFLINE, local interactions.
const prototypePages=[['办事','home'],['事项','tasks'],['提出需求','create'],['好汉名册','agents'],['事项详情','detail'],['事项议事','chat'],['密议','private'],['厅前公议','public'],['资料','workspace'],['资料详情','file'],['我的','mine'],['典籍阁','library'],['阅读器','reader'],['消息','messages'],['招贤令','catalog'],['厅中实景','map'],['使用帮助','help'],['个人中心入口','account'],['正式成果','results']];
function seedBaseline(){
 if(state.initializedScenario){if(page==='private'&&!state.privateChats[state.privateAgentId]){state.privateAgentId='0';state.privateChats['0']={agent:{id:'0',name:'宋江'},messages:[],outputs:[],delivery:[],chatDraft:'',chatFiles:[],quote:null,pending:false};}return;}
 const scenario=selectedScenario;state.baselineScenario=scenario;state.initializedScenario=true;
  if (scenario === 'completed-review') {
    state.task={title:'方块改色与修改说明',description:'将蓝色方块改为红色，保留形状和画布尺寸，并附一份修改说明。',files:['ref-brief'],complete:true};
    state.agent={id:'4',name:'吴用'};state.selectedAgent={...state.agent};state.operation=null;state.error=null;
    state.outputs=[{id:'completed-image',name:'红色方块.svg',version:2,type:'image',url:'assets/delivery-red-v2.svg'}, {id:'completed-note',name:'修改说明.txt',version:1,type:'text',text:'已将方块改为红色，保留原形状和画布尺寸。此文本为离线原型示例。'}, {id:'completed-draft',name:'红色方块.svg',version:1,type:'image',url:'assets/delivery-red.svg'}];
    state.final=['completed-image','completed-note'];state.delivery=[...state.final];
    state.messages=[{role:'USER',text:state.task.description},{role:'AGENT',text:'已完成改色并补充修改说明。',outputs:[...state.final]}];return;
  }

 if(scenario==='library-unavailable'){state.libraryTab='search';state.librarySearched=true;state.libraryQuery='自然活动';state.libraryError=true;}
 const formal=['chat','detail','results'].includes(page),privatePage=page==='private';
 if(formal){state.task={title:'自然观察活动资料',description:'画一只鸟，并整理一份活动方案。',files:['ref-brief'],complete:false};state.agent={id:'0',name:'宋江'};state.selectedAgent={...state.agent};state.messages=[{role:'USER',text:state.task.description,files:['ref-brief']},{role:'AGENT',text:'你期望什么风格？可以在同一话头继续补充。'}];}
 if(privatePage){state.selectedAgent={id:'0',name:'宋江'};state.privateAgentId='0';state.privateChats['0']={agent:{...state.selectedAgent},messages:[],outputs:[],delivery:[],chatDraft:'',chatFiles:[],quote:null,pending:false};}
 const ctx=conversation();
 if(['chat','private','public'].includes(page)){
  if(scenario==='empty')ctx.messages=[];
  if(['waiting','streaming','reply-stop','reply-stop-delta-race','reply-stop-failed','reply-stop-unknown','reply-stop-finished'].includes(scenario)){ctx.pending=true;ctx.pendingReason='fixture';}
  if(['results','completed'].includes(scenario)&&!ctx.outputs.length){const ids=['image','audio','document','text'].map(type=>output(type,'一只小鸟停在枝头。',1,ctx));ctx.delivery=[...ids];ctx.messages.push({role:'AGENT',text:'本次示例成果如下，可预览；需要调整请直接在输入框说明。',outputs:ids});}
 }
 if(['cancel-ready','cancel-unknown','cancelled','history-error'].includes(scenario)&&state.task){state.task.notStarted=true;state.task.cancelled=['cancelled','history-error'].includes(scenario);if(state.task.cancelled){const id=output('text','保留的历史文字成果（离线示例）',1,state);state.delivery=[id];}state.cancellation={writes:0,status:'ready'};state.historyError=scenario==='history-error';}
 if(['revision-queued','revision-rejected','revision-running'].includes(scenario)&&formal){state.task.unified=true;state.agent={id:'wuyong',name:'吴用'};state.selectedAgent={...state.agent};state.messages.push({role:'AGENT',text:'已收到修改要求。（离线示例）',submissionNotice:scenario==='revision-queued'?'正在核对本轮成果与修改要求，尚未开始修改。':scenario==='revision-rejected'?'本次修改未受理，请核对当前成果后在原议事继续说明。':'已受理修改，正在原议事继续处理；上一版仍保留。'});}
 if(scenario==='submission-failure'&&formal){state.task.unified=true;state.task.phase='进行中';state.agent={id:'wuyong',name:'吴用'};state.selectedAgent={...state.agent};const id=output('text','已生成的候选成果仍然保留。',1,state);state.delivery=[];state.messages.push({role:'AGENT',text:'本轮候选成果已生成。',outputs:[id],submissionNotice:'成果提交未完成，原答复和文件已保留；可在原议事继续说明。'});}
 if(scenario==='projection-recovery'&&formal){ctx.agent={id:'wuyong',name:'吴用'};state.selectedAgent={...ctx.agent};const id=output('text','本轮修订后的活动方案（离线恢复示例）',2,ctx);ctx.delivery=[id];ctx.messages.push({role:'AGENT',text:'本轮成果已恢复，可预览并验收；继续修改请直接在原议事说明。',outputs:[id]});ctx.pending=false;}
 if(scenario==='sse-recovery'&&formal){ctx.agent={id:'wuyong',name:'吴用'};state.selectedAgent={...ctx.agent};ctx.messages.push({role:'USER',text:'请继续处理本轮需求。'},{role:'AGENT',text:'原请求已经完成，这是恢复读取的最终答复。（离线示例）'});ctx.pending=false;ctx.pendingReason='';ctx.replyStop=null;}
 if(scenario==='restore-latest'&&formal){ctx.agent={id:'wuyong',name:'吴用'};state.selectedAgent={...ctx.agent};ctx.messages.push({role:'AGENT',text:'上一轮保留的部分内容。',statusText:'已停止（未完成）'},{role:'USER',text:'请继续处理本轮需求。'});ctx.pending=true;ctx.pendingReason='fixture';ctx.replyStop=null;}
 // Background reconciliation keeps this detail visible; it never opens chat.
 if(['completed','completed-background-read'].includes(scenario)&&state.task){if(!state.outputs.length){const ids=['image','audio','document','text'].map(type=>output(type,'一只小鸟停在枝头。',1,state));state.delivery=ids;state.messages.push({role:'AGENT',text:'本次示例成果如下。',outputs:ids});}state.task.complete=true;state.final=[...state.delivery];state.operation={id:'demo-completed-operation',outputs:[...state.final],stage:'completed',writes:1};}
}
const optimizedComposer=syncCurrentComposer;
syncCurrentComposer=function(panel){optimizedComposer(panel);const ctx=conversation(),locked=ctx.pending||!!(ctx.task?.complete||ctx.task?.cancelled);const voice=$('.voice-start',panel);if(voice){voice.disabled=locked;voice.innerHTML=uiIcon('mic');voice.title='语音输入';}
 const actions=$('.composer-actions',panel);$('.composer-attach',panel)?.remove();const attach=document.createElement('button');attach.type='button';attach.className='composer-attach';attach.dataset.action='complete-materials';attach.title='添加资料';attach.setAttribute('aria-label','添加资料');attach.disabled=locked||state.baselineScenario==='recording';attach.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.3-8.3"/></svg>';actions.insertBefore(attach,$('.composer-inline-voice',actions));
 const more=$('.composer-more',panel);more.disabled=locked||state.baselineScenario==='recording';more.innerHTML=uiIcon('plus');more.title='更多操作';more.setAttribute('aria-label','更多操作');
 $('.composer-send',panel).innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>';
 const form=$('.composer-submit',panel);
 $$('.composer-context,.composer-meta,.composer-actions [data-draft-count]',panel).forEach(e=>e.remove());
 const contextLabel=page==='private'?'密议':page==='public'?'厅前公议':'事项议事 / '+taskTitle();
 form.insertAdjacentHTML('afterbegin',`<div class="composer-context ${page==='private'?'is-private':'is-bounty'}"><span class="composer-context-label" title="${esc(contextLabel)}">${esc(contextLabel)}</span>${ctx.agent?`<span class="composer-target-chip" aria-label="传话对象">@${esc(ctx.agent.name)}</span>`:''}</div>`);
 form.insertAdjacentHTML('beforeend',`<div class="composer-meta"><span data-draft-count>${ctx.chatDraft.length}/1200</span><span>${ctx.pending?'等待回复…':page==='public'?'公共议事':page==='private'?'只与当前好汉交流':'只与当前承办交流'}</span></div>`);
 if(page==='chat'){
  $('.composer-context',panel)?.remove();
  const count=$('[data-draft-count]',panel);if(count)actions.insertBefore(count,$('.composer-inline-voice',actions));
  $('.composer-meta',panel)?.remove();
 }
 $('.composer-textarea',panel).maxLength=1200;
 const summary=$('.context-summary small',panel);if(summary)summary.title=summary.textContent;
 $$('.toolbar-actions button',panel).forEach(b=>{const terminal=!!(ctx.task?.complete||ctx.task?.cancelled);b.hidden=terminal&&['新对话','查看并验收'].includes(b.getAttribute('aria-label'));b.disabled=!!(ctx.pending||ctx.historyDeletingId||$('.inline-voice-status',panel));});
 if(ctx.task?.complete){const status=$('.context-summary em',panel);if(status)status.textContent='事项已完成';}
 if(['waiting','streaming'].includes(state.baselineScenario)&&!ctx.pending){$$('.is-pending',panel).forEach(e=>e.remove());}
 const menu=$('.composer-more',panel);menu?.setAttribute('aria-expanded','false');
 // Preserve actions and state, while the compact CSS positions toolbar right and voice before send.
 $('[aria-label="议事记录"]',panel)?.setAttribute('aria-expanded',String(!!ctx.historyOpen));
 const mapping={'ui-refresh':'complete-refresh','ui-history':'complete-history','ui-new':'complete-new','ui-voice':'complete-voice','ui-voice-stop':'complete-voice-stop','ui-voice-cancel':'complete-voice-cancel','ui-voice-append':'complete-voice-append','ui-voice-replace':'complete-voice-replace'};
 for(const [old,next] of Object.entries(mapping))$$(`[data-action="${old}"]`,panel).forEach(e=>e.dataset.action=next);
 if(ctx.historyOpen)renderConversationHistory();
};
const completionMore=showMore;
showMore=function(){completionMore();$('.composer-more-panel .composer-add-materials')?.remove();const more=$('.composer-more');if(more)more.setAttribute('aria-expanded',String(!!$('.composer-more-panel')));};
const optimizedSupplement=renderSupplement;
renderSupplement=function(){optimizedSupplement();document.title=labels[page]+' · 界面优化基准（离线交互）';const note=$('.baseline-provenance');if(note)note.textContent='四阶段办事 · 2026-10-17 · 离线示例';
 $$('.workbench-account-action,.workbench-sidebar-account').forEach(e=>{e.disabled=false;e.dataset.prototypePage='account';});
 const brand=$('.workbench-brand');if(brand){brand.dataset.prototypePage='home';}
 if(page==='create'||unifiedTask()&&['chat','detail','results'].includes(page)){const crumb=$('.workbench-breadcrumb strong');if(crumb)crumb.textContent=page==='create'?'提出需求':'议事';if(page==='chat'){const title=$('#juyiting-floating-panel-title');if(title)title.textContent='议事';}}
 if(page==='home'){$$('.overview-tabs button').forEach((b,i)=>{b.dataset.action='complete-overview-tab';b.dataset.tab=String(i);b.setAttribute('aria-pressed',String((state.overviewTab||0)===i));});}
 if(page==='workspace'){$$('[data-action="ui-file"]').forEach(e=>e.remove());}
 if(page==='results')renderFormalResults();
 if(page==='catalog')renderRuntimeCatalog();
 if(page==='file')renderFileDetail();
 if(page==='library')renderLibrary();
 if(page==='reader')renderReader();
 if(page==='messages')renderMessages();
 if(page==='mine'){const root=$('.hall-mine-page');if(root&&!$('[data-action="complete-entries"]',root))root.insertAdjacentHTML('beforeend',`<div class="mmd baseline-extra">${button('全部入口','complete-entries')}${button('页面与状态索引','complete-index')}</div>`);}
 if(page==='help'){const root=$('.baseline-page');if(root)root.insertAdjacentHTML('beforeend',`<div class="mmd baseline-extra">${button('全部入口','complete-entries')}${button('页面与状态索引','complete-index')}</div>`);}
 refreshAllPageSurfaces();
 syncProductionNavigation();
 // Restore history after the visual shell is rerendered.
 if(['chat','private','public'].includes(page)&&conversation().historyOpen)renderConversationHistory();
};
// Presentation groups only: never mutate the underlying task or acceptance state.
const taskStatusNames=['待你补充','需核对','正在处理','已有结果','待确认承办','筹划中','议事中','办理中','待验收','受阻','已完成','失败','已取消','已归档'];
const taskGroups=['全部','待我处理','进行中','已结束'];
function taskBucket(){return state.task?listedMatterStatus(state):'待确认承办';}
function taskInGroup(group,bucket=taskBucket()){
 if(!state.task)return false;
 if(group==='全部')return true;
 if(group==='已结束')return ['已完成','失败','已取消','已归档','成果已归档'].includes(bucket);
 if(group==='待我处理')return (['待确认承办','待验收'].includes(bucket)||!!matterAttentionReason(state))&&!state.pending&&state.operation?.stage!=='pending';
 return !['已完成','失败','已取消','已归档','成果已归档'].includes(bucket);
}
function productionTaskStatus(){return listedMatterStatus(state);}
// Task browsing fixtures are separate from the user's unsubmitted requirement.
// Reading the list must never create a task or send a message.
const matterContextKeys=['task','agent','messages','outputs','delivery','final','operation','pending','pendingReason','error','chatDraft','chatFiles','quote','histories','historyOpen','cancellation','baselineScenario','topicId','topicTitle','topicUpdatedAt','historyPageLimit'];
function blankMatterContext(){return {task:null,agent:null,messages:[],outputs:[],delivery:[],final:[],operation:null,pending:false,pendingReason:null,error:null,chatDraft:'',chatFiles:[],quote:null,histories:[],historyOpen:false,cancellation:{writes:0,status:'ready'},baselineScenario:'ready'};}
function matterContextSnapshot(ctx=state){return structuredClone(Object.fromEntries(matterContextKeys.map(key=>[key,ctx[key]??blankMatterContext()[key]])));}
function currentMatterKey(){return state.task?.id||state.matterSelectionKey||'legacy-active';}
function ensureMatterLibrary(){
 if(state.matterLibrary&&state.matterFixtureRevision===2)return;
 state.matterLibrary||={};state.matterFixtureRevision=2;
 if(selectedScenario!=='empty'){
  const fixtures=[
   ['demo-list-001','整理亲子自然观察活动方案','梳理活动目标、人员分工与准备清单。','文案整理',null,false],
   ['demo-list-002','设计自然观察活动海报','准备一张突出活动主题的海报，先在议事中确认风格。','创意设计',{id:'1',name:'公孙胜'},false],
   ['demo-list-003','汇总活动筹备清单','已整理人员、物料与时间安排，保留结果供查看。','资料汇总',{id:'0',name:'宋江'},true]
  ];
  for(const [id,title,description,ability,agent,complete] of fixtures){
   const ctx=blankMatterContext();ctx.task={id,title,description,files:['ref-brief'],requiredAbilities:[ability],notStarted:!agent,complete,example:true};ctx.agent=agent;
   ctx.messages=[{role:'USER',text:description,files:['ref-brief']}];
   if(agent)ctx.messages.push({role:'AGENT',text:complete?'筹备清单已整理，见下方示例文件。':'希望海报偏自然手绘，还是简洁信息排版？请在这里补充。'});
   if(complete){const out={id:id+'-result',name:'活动筹备清单.txt',type:'text',text:'筹备清单（离线示例）\n1. 确认活动时间与人员\n2. 准备观察材料\n3. 核对现场安排',note:'已完成 · 离线示例'};ctx.outputs=[out];ctx.delivery=[out.id];ctx.final=[out.id];ctx.messages[1].outputs=[out.id];ctx.operation={id:id+'-acceptance',stage:'completed',outputs:[out.id],writes:1};}
   state.matterLibrary[id]||=ctx;
  }
 }
 if(selectedScenario!=='empty'){
  for(const [id,title,kind] of [['demo-review','核对自然观察成果','review'],['demo-failed','汇总资料时读取失败','failed'],['demo-cancelled','已取消的活动筹备','cancelled'],['demo-archived','往期活动案卷','archived']]){
   if(state.matterLibrary[id])continue;const ctx=blankMatterContext();ctx.task={id,title,description:'本地演示事项：'+title,files:['ref-brief'],example:true,demoSkills:kind==='review'?['文档整理']:[],phase:kind==='failed'?'失败':undefined,complete:kind==='archived',archived:kind==='archived',cancelled:kind==='cancelled'};ctx.agent={id:'0',name:'宋江'};ctx.messages=[{role:'USER',text:title}];
   if(['review','archived'].includes(kind)){const a={id:id+'-result',type:'text',name:title+'.txt',text:'活动目标、观察要点和准备清单（离线固定示例）',note:'固定 v1'};ctx.outputs=[a];ctx.delivery=[a.id];ctx.messages.push({role:'AGENT',text:'本轮成果已整理。',outputs:[a.id]});if(kind==='archived'){ctx.final=[a.id];ctx.operation={id:id+'-accepted',stage:'completed',outputs:[a.id],writes:1};}}
   if(kind==='failed')ctx.messages.push({role:'AGENT',text:'示例：资料读取失败，原需求和附件保留。请在这里核对资料，不自动重试。'});
   state.matterLibrary[id]=ctx;
  }
 }
 // Recover previously preserved local matters without replacing current drafts.
 (state.previousMatters||[]).forEach((ctx,i)=>{const key=ctx.task?.id||'legacy-history-'+i;if(ctx.task&&!state.matterLibrary[key])state.matterLibrary[key]=Object.assign(blankMatterContext(),structuredClone(ctx));});
}
function saveMatterContext(){ensureMatterLibrary();if(state.task)state.matterLibrary[currentMatterKey()]=matterContextSnapshot();}
function listedMatters(){
 ensureMatterLibrary();const current=state.task?currentMatterKey():null;
 return [...(state.task?[{key:current,ctx:state,current:true}]:[]),...Object.entries(state.matterLibrary).filter(([key])=>key!==current).map(([key,ctx])=>({key,ctx,current:false}))];
}
// User-facing stages; execution/clarification/archive details are not extra lifecycle tabs.
const visibleMatterStatuses=['待确认承办','进行中','待验收','已完成'];
function listedMatterStatus(ctx){
 const t=ctx.task||{};
 if(t.cancelled)return '已取消';if(t.complete)return '已完成';
 if(!ctx.agent)return '待确认承办';
 // An unresolved acceptance keeps its last business stage, never pretends completion.
 if(ctx.operation&&ctx.operation.stage!=='completed')return '待验收';
 if(ctx.pending||ctx.error||['待你补充','需核对','失败','受阻','正在处理','办理中'].includes(t.phase))return '进行中';
 // delivery is the demo's explicitly submitted, fixed result set; outputs alone do not qualify.
 if(ctx.delivery?.length&&ctx.delivery.every(id=>ctx.outputs?.some(a=>a.id===id)))return '待验收';
 return '进行中';
}
function matterAttentionReason(ctx){
 if(['已完成','已取消'].includes(listedMatterStatus(ctx)))return '';
 if(ctx.operation&&ctx.operation.stage!=='completed')return ctx.operation.stage==='pending'?'验收处理中，请勿重复提交':ctx.operation.stage==='failed'?'验收未完成，请核对原操作':'验收结果待核对';
 if(ctx.error||ctx.task?.phase==='需核对')return '回复状态待核对，请勿重复发送';
 if(ctx.task?.phase==='待你补充')return '请在原议事中补充信息';
 if(ctx.task?.phase==='失败')return '本次处理失败，请查看原因';
 return ctx.task?.phase==='受阻'?'办理受阻，请查看原因':'';
}
function listedMatterClass(ctx){return 'task-state-'+({'待确认承办':'open','进行中':'running','待验收':'reviewing','已完成':'done','已取消':'cancelled'}[listedMatterStatus(ctx)]||'unknown');}
function openListedMatter(key){
 ensureMatterLibrary();
 if(state.task&&key===currentMatterKey()){go('detail');return;}
 if(state.pending||state.operation?.stage==='pending'){feedback('当前事项正在处理，请等回复完成后再切换；原输入已保留。');return;}
 const ctx=state.matterLibrary[key];if(!ctx)return;
 saveMatterContext();Object.assign(state,matterContextSnapshot(ctx));state.matterSelectionKey=key;state.selectedAgent=state.agent?{...state.agent}:null;
 state.recommendation=null;persist();go('detail');
}
function applyTaskFilters(){
 const rows=listedMatters(),query=(state.taskSearch||'').trim().toLowerCase();let visible=0;
 for(const card of $$('.task-card')){
  const row=rows.find(r=>r.key===card.dataset.matterKey),ctx=row?.ctx;
  const match=!!ctx&&matchesMatterFilter(ctx,state.taskFilter)&&(!state.taskAbility||(ctx.task.requiredAbilities||[]).includes(state.taskAbility))&&(!query||[ctx.task.id,ctx.task.title,ctx.task.description].join(' ').toLowerCase().includes(query));
  card.hidden=!match;card.style.display=match?'':'none';if(match)visible++;
 }
 const empty=$('.baseline-empty');if(empty){empty.hidden=visible>0;empty.innerHTML=rows.length?'没有符合筛选条件的事项。'+button('清除筛选','complete-task-clear'):'暂无事项，点击右上方“提出需求”开始。';}
 const count=$('[data-task-list-count]');if(count)count.textContent=`显示 ${visible} / ${rows.length} 项 · 示例数据仅存本地，不是账号真实事项`;
}
function simplifyHome(){
 $$('.workbench-create-action').forEach(e=>{e.dataset.prototypePage='create';});
 const aside=$('.overview-aside-card');if(aside)aside.innerHTML='<h3>待我处理</h3><p>查看需要补充或核对的事项。</p>'+button('查看待处理列表','complete-go','data-page=tasks');
 if(aside)scoped(aside,'data-v-d13db084');
 const map=$('.overview-map-link');if(map)map.dataset.prototypePage='map';
 const heading=$('.overview-list-heading h3');if(heading)heading.textContent='接着上次办';
 const title=$('.overview-start-copy h2,.overview-start-copy h3');if(title)title.textContent='你想办成什么事？';
 const next=$('.overview-quick-request button.primary');if(next)next.textContent='开始办事';

 const intro=$('.overview-start-copy>p');if(intro)intro.textContent='点击“开始办事”先保存需求，确认承办后再交给好汉。补充要求、查看成果和验收都在议事中完成。';
 const all=$('.overview-list-heading [data-prototype-page="tasks"]');if(all)all.textContent='查看全部事项';
 const refresh=$$('.overview-list-heading button').find(b=>b.textContent==='刷新');if(refresh)refresh.dataset.action='complete-task-refresh';
 const tab=state.overviewTab||0;
 $$('.overview-tabs button').forEach((b,i)=>{b.textContent=['最近事项','待我处理','已归档'][i];});
 // Match the home projection: select the newest five, then reverse only needs-action.
 const rows=listedMatters().filter(({ctx})=>tab===0||tab===2&&ctx.task.archived||tab===1&&!ctx.task.archived&&!ctx.pending&&ctx.operation?.stage!=='pending'&&(['待确认承办','待验收'].includes(listedMatterStatus(ctx))||!!matterAttentionReason(ctx)))
  .sort((a,b)=>(b.ctx.task.updatedAt||0)-(a.ctx.task.updatedAt||0)).slice(0,5);
 if(tab===1)rows.reverse();
 const section=$('.overview-section');if(section){section.innerHTML=rows.map(({key,ctx})=>`<article class="overview-item"><div class="overview-item-copy"><strong>${esc(ctx.task.title)}</strong><p>事项 · ${esc(ctx.agent?.name||'待安排')}</p><span class="overview-status">${esc(listedMatterStatus(ctx))}</span></div>${button('查看事项','complete-open-matter',`data-matter-key="${esc(key)}"`)}</article>`).join('')||`<p class="simplify-home-empty" role="status">${tab===1?'暂时没有需要你处理的事项。':tab===2?'暂无已归档事项。':'还没有事项，从上方提出第一个需求。'}</p>`;scoped(section,'data-v-d13db084');}
}
function renderInteractiveList(){
 if(page==='home'){simplifyHome();return;}
 if(page!=='tasks')return;
 const rows=listedMatters(),list=$('.task-list');
 if(list){
  list.innerHTML=rows.map(({key,ctx,current})=>`<article class="task-card${current?' selected':''}" data-matter-key="${esc(key)}" data-action="complete-open-matter" tabindex="0" role="button" aria-label="查看事项：${esc(ctx.task.title)}"><div class="task-head"><strong>${esc(ctx.task.title)}</strong><span class="${listedMatterClass(ctx)}">${esc(listedMatterStatus(ctx))}</span></div><p>${esc(ctx.task.description)}</p>${matterAttentionReason(ctx)?`<p class="matter-attention-reason">${esc(matterAttentionReason(ctx))}</p>`:''}<div class="task-meta"><span>${esc(ctx.task.id||key)}</span>${ctx.agent?`<span>领令：${esc(ctx.agent.name)}</span>`:''}${ctx.task.archived?'<span>已归档</span>':''}<span>${ctx.task.example?'离线示例':'本地演示事项'}</span></div><div class="ability-tags">${(ctx.task.requiredAbilities?.length?ctx.task.requiredAbilities:['不拘本领']).map(a=>`<span>${esc(a)}</span>`).join('')}</div></article>`).join('')+'<div class="mmd baseline-empty empty-list" role="status" hidden></div>';
  scoped(list,'data-v-9209fea5');
 }
 const tabs=$('.task-status-tabs');
 const statuses=[...visibleMatterStatuses,'异常/历史'];
 if(['待开工（已点将）','筹划中','议事中','办理中','需处理','受阻','待澄清'].includes(state.taskFilter))state.taskFilter='进行中';
 if(['已取消','已归档','失败'].includes(state.taskFilter))state.taskFilter='异常/历史';
 if(state.taskFilter&&!statuses.includes(state.taskFilter))state.taskFilter='';
 if(tabs){tabs.setAttribute('aria-label','事项状态');tabs.innerHTML=statuses.map(name=>button(`${name} <span>${rows.filter(r=>matchesMatterFilter(r.ctx,name)).length}</span>`,'complete-production-status',`data-status="${name}" aria-pressed="${state.taskFilter===name}" class="${state.taskFilter===name?'active':''} ${name==='异常/历史'?'task-status-secondary':''}"`)).join('');}
 if(tabs){const old=$('.task-secondary-filters');if(old)old.remove();if(state.taskFilter==='异常/历史'){tabs.insertAdjacentHTML('afterend',`<div class="task-secondary-filters" aria-label="异常与历史分类"><span>分类</span>${button('待核对','complete-secondary-status',`data-kind="unknown" aria-pressed="${state.secondaryMatterFilter==='unknown'}"`)}${button('历史','complete-secondary-status',`data-kind="history" aria-pressed="${state.secondaryMatterFilter!=='unknown'}"`)}</div>`);}}
 const search=$('.task-search input');if(search){search.value=state.taskSearch||'';search.dataset.completeTaskSearch='true';}
 const ability=$('.task-search select');if(ability){const values=[...new Set(rows.flatMap(r=>r.ctx.task.requiredAbilities||[]))];if(state.taskAbility&&!values.includes(state.taskAbility))values.push(state.taskAbility);ability.innerHTML='<option value="">不拘本领</option>'+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');ability.value=state.taskAbility||'';ability.dataset.completeTaskAbility='true';}

 applyTaskFilters();
}
function createProblem(){const unknown=state.simulation.create==='unknown';dialog(unknown?'提交状态待核对':'提交失败（示例）',`<p>${unknown?'尚不能确认受理，先核对状态，不重复创建。':'明确未受理。需求和附件均保留，可返回修改。'}</p>`,button(unknown?'核对创建状态':'返回修改','complete-create-status'));}
function acceptanceLocked(){return !!(state.operation&&state.operation.stage!=='completed');}
function acceptanceReady(){return selectedScenario!=='independent-roots'&&!!state.task&&!!state.agent&&!state.task.complete&&!state.task.cancelled&&!state.pending&&!state.error&&!state.operation&&listedMatterStatus(state)==='待验收'&&state.delivery.length>0&&state.delivery.every(id=>state.outputs.some(a=>a.id===id));}
function acceptanceSummary(){
 if(!state.task)return '';
 if(state.task.cancelled)return '';
 if(state.task.complete)return '<section class="matter-acceptance-strip" aria-label="验收结果"><div><strong>已完成 · 验收通过</strong><small>最终成果已固定，议事记录保留。</small></div>'+button('查看验收成果','complete-acceptance-record')+'</section>';
 if(acceptanceLocked())return '<section class="matter-acceptance-strip" aria-label="验收进度"><div><strong>'+esc(matterAttentionReason(state))+'</strong><small>保留原操作与成果，不重复验收。</small></div>'+button('核对验收进度','complete-operation-open','class="mmd-primary"')+'</section>';
 if(!acceptanceReady())return '';
 return '<section class="matter-acceptance-strip" aria-label="事项验收"><div><strong>待验收 · 本轮成果已提交</strong><small>满意后验收完成；不满意直接在原议事继续修改。</small></div><div class="matter-acceptance-actions">'+button('继续修改','complete-acceptance-modify')+button('查看并验收','complete-acceptance-review','class="mmd-primary"')+'</div></section>';
}
function reviewAcceptance(){
 if(!acceptanceReady()){feedback('当前尚不能验收，请先完成处理或核对原操作。');return;}
 finalDraft=[...state.delivery];
 dialog('验收本轮成果',`<p>请核对以下 ${finalDraft.length} 项最新成果。确认后事项完成，原议事只读；旧版本仍保留，不计入本次验收。</p><div class="mmd-attachments">${deliveryList()}</div><small>离线原型演示，不发生真实结算。</small>`,button('返回议事','complete-acceptance-modify')+button('确认验收','finish','class="mmd-primary"'));
}
function beginAcceptance(){
 if(!acceptanceReady()||!finalDraft.length||JSON.stringify(finalDraft)!==JSON.stringify(state.delivery))return;
 state.operation={id:'demo-operation-'+(++serial),outputs:[...finalDraft],stage:'pending',writes:1};
 if(!persist()){state.operation=null;feedback('验收未保存，未提交。请检查浏览器存储后重试。');return;}
 $('dialog[open]')?.close();if(page==='detail')renderDetail();if(page==='chat')renderChat();operationDialog();setTimeout(resolveOperation,650);
}
function operationDialog(){const op=state.operation;if(!op)return;finalDraft=[...op.outputs];dialog('验收进度',`<p role="status">${op.stage==='pending'?'正在核对原验收操作…':op.stage==='failed'?'验收未完成。原操作和成果已保留。':'验收状态未知。不重新提交验收。'}</p><small>原操作 ${esc(op.id)} · 冻结 ${op.outputs.length} 项成果</small><div class="mmd-attachments">${deliveryList()}</div>`,button('返回详情','complete-operation-detail')+button('查询原操作状态','complete-operation-status'));}
function resolveOperation(){const op=state.operation;if(!op||state.task?.complete)return;if(state.simulation.accept==='ok'){op.stage='completed';state.final=[...op.outputs];state.task.complete=true;persist();const d=$('dialog[open]');if(d?.getAttribute('aria-label')==='验收进度'){d.close();if(page==='chat')renderChat();else go('detail');feedback('示例验收完成。');}else render();return;}op.stage=state.simulation.accept==='failed'?'failed':'unknown';if(page==='detail')renderDetail();if(page==='results')renderFormalResults();persist();const d=$('dialog[open]');if(d?.getAttribute('aria-label')==='验收进度'){d.close();operationDialog();}}
async function addLocalFiles(selected){
 const files=[...selected],d=$('.material-picker-dialog'),current=picker;
 if(!files.length||!d||current.uploading)return;
 const input=$('[data-local-files]',d),status=$('[data-picker-upload-status]',d);
 current.uploading=true;input.disabled=true;current.uploadStatus='正在读取资料…';status.hidden=false;status.textContent=current.uploadStatus;
 try{
  const added=[];
  for(const f of files){
   const type=f.type.startsWith('image/')?'image':f.type.startsWith('audio/')?'audio':/text|json/.test(f.type)||/\.(txt|md|csv)$/i.test(f.name)?'text':'document';
   const text=type==='text'?await f.text():type==='document'?'此格式暂不支持内嵌预览。':'';
   const url=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('read'));r.onabort=()=>reject(new Error('abort'));r.readAsDataURL(f);});
   added.push({id:'local-'+(++serial),name:f.name,type,text,url,version:1,note:'本机资料 · 上传离线演示'});
  }
  if(!d.isConnected||picker!==current)return;
  state.localFiles.push(...added);current.ids=[...new Set([...current.ids,...added.map(a=>a.id)])];
  current.selected=added[0].id;current.preview=false;current.previewDismissed=false;
  current.uploadStatus='';persist();
 }catch{current.uploadStatus='读取失败，原有选择保留，请重试。';}
 finally{current.uploading=false;input.disabled=false;input.value='';if(d.isConnected&&picker===current)renderMaterialPicker();}
}
function renderFileDetail(){
 const root=$('.baseline-page'),a=asset(state.fileId||'ref-brief');if(!root||!a)return;const meta=state.fileMeta[a.id]||{};
 const selected=meta.demoVersion||String(meta.versions?.length?meta.versions.length+1:1),versionAsset=asset(meta.versions?.find(v=>String(v.version)===selected)?.id)||a,versions=meta.demoHistory?(meta.demoHistoryLoaded?Array.from({length:102},(_,i)=>String(102-i)):Array.from({length:100},(_,i)=>String(102-i))):meta.versions?[...meta.versions.map(v=>String(v.version)).reverse(),'1']:['1'];
 root.classList.add('all-file-detail','personal-workspace','is-hall-treasure');
 root.innerHTML=`<div class="treasure-content"><div class="treasure-file-heading"><div><h2>${esc(a.name)}</h2><p>${state.saved.includes(a.id)?'成果':'资料'} · ${meta.recycled?'已回收':'资料由你管理'} · 离线示例</p></div>${button(state.fileManage?'返回预览':'更多管理','complete-file-manage')}</div><div class="file-preview-body" ${state.fileManage?'hidden':''}><div class="treasure-preview-tools treasure-version-tools"><label>版本 <select aria-label="文件版本" data-workspace-version>${versions.map(v=>`<option value="${v}" ${selected===v?'selected':''}>v${v} · ${esc(a.name)}</option>`).join('')}</select></label>${button('下载','download',`data-id="${versionAsset.id}"`)}</div>${meta.demoHistory&&!meta.demoHistoryLoaded?button('读取更早版本','complete-workspace-history-more'):''}<p class="treasure-note">当前查看版本 ${selected}；已有事项中的资料引用不会随新版本替换。</p>${meta.demoPartial?'<p class="treasure-note" role="status">预览内容不完整；请下载原文件查看。（离线状态示例）</p>':''}${meta.demoDetailError?`<p class="treasure-note" role="status">上传已保存，但详情读取失败；请重读详情，不要重复提交。（离线状态示例） ${button('重读详情','complete-workspace-detail-retry')}</p>`:''}<section class="treasure-preview" aria-label="文件预览">${media(versionAsset)}</section><div class="treasure-actions">${!meta.recycled?button('用此资料提需求','complete-use-file','class="treasure-primary"'):''}${button('预览','preview',`data-id="${versionAsset.id}"`)}</div><details class="treasure-note"><summary>离线修复状态演示</summary><p>以下历史分页为布局示例，历史102版使用同一份示例内容；自行选择的新文件另存本地字节，不代表服务端写入。</p><div class="treasure-actions">${button('演示历史分页','complete-workspace-history-demo')}${button('演示部分预览','complete-workspace-partial-demo')}${button('演示保存后详情失败','complete-workspace-detail-demo')}${button('演示提交结果未知','complete-workspace-unknown-demo')}</div></details></div><section class="treasure-management ${state.fileManage?'is-open':''}" ${state.fileManage?'':'hidden'} aria-label="文件管理"><h3>文件管理</h3><p>旧版本及已有事项引用保留。本原型只修改示例文件，不上传到服务器。</p><div class="treasure-form"><label>上传新版本<input type="file" data-file-new-version aria-label="选择新版本文件"></label><small data-version-status role="status">${esc(meta.versionStatus||'尚未选择新文件；旧版本和事项引用保持不变。')}</small>${button('上传为新版本','complete-file-version-submit','disabled class="mmd-primary"')}<label><input type="checkbox" data-version-fail>演示保存失败（不写入）</label></div>${button('重命名','complete-rename')}${button(meta.recycled?'恢复':'移到回收站','complete-recycle')}</section></div>`;
 scoped(root,'data-v-a1bd66a6');
}
function renderLibrary(){
 const root=$('.baseline-page');if(!root)return;const tab=state.libraryTab||'reader';root.classList.add('library-panel');
 root.innerHTML=`<div class="library-tabs" role="tablist" aria-label="典籍阁入口">${button('典籍阅读','complete-library-tab',`data-tab="reader" role="tab" aria-selected="${tab==='reader'}" class="${tab==='reader'?'active':''}"`)}${button('案卷检索','complete-library-tab',`data-tab="search" role="tab" aria-selected="${tab==='search'}" class="${tab==='search'?'active':''}"`)}${button('任职与维护','complete-library-tab',`data-tab="maintenance" role="tab" aria-selected="${tab==='maintenance'}"`)}</div>`;
 if(tab==='reader')root.insertAdjacentHTML('beforeend',`<section class="archive-reader is-embedded-reader"><div class="archive-shelf"><header class="archive-shelf-header"><div><p class="reader-kicker">典籍阅读</p><h3>阁中典籍</h3><p>先择一部典籍，再进入沉浸翻阅。</p></div><span class="archive-shelf-count">共 1 部</span></header><article class="archive-book-card"><div class="archive-book-cover" aria-hidden="true"><span>古典</span><strong>水滸傳</strong><small>一百二十回</small></div><div class="archive-book-info"><p class="reader-kicker">已收录典籍</p><h4>水滸傳</h4><p>阅读、目录、书签与私人手札。原型正文采用脱敏排版示例。</p>${button('进入翻阅','complete-go','data-page="reader" class="archive-book-open"')}</div></article></div></section>`);
 else if(tab==='maintenance')root.insertAdjacentHTML('beforeend',`<section class="archive-maintenance-demo"><p>新典籍是数据，不需要改代码。任职授予权限；技能包只提供执行能力。</p><h3>任职与技能</h3><div class="baseline-card"><label>目标好汉 <select aria-label="任命目标好汉"><option>林冲 · 豹子头</option><option>鲁智深 · 花和尚</option></select></label><label>职位 <select aria-label="任命职位"><option>典籍阁编修（2 名）</option></select></label>${button('任命并安装默认技能','complete-archive-appoint')}<p data-archive-status role="status">未任职 · 不具备典籍写入权限</p><p>职位技能：典籍维护 ｜ 通用技能：资料整理</p>${button('卸任','complete-archive-resign')}</div><h3>交办典籍维护</h3><div class="baseline-card archive-demo-grid"><label>书名<input aria-label="书名" value="三国演义"></label><label>作者<input aria-label="作者" value="罗贯中"></label><label>作品标识<input aria-label="作品标识" value="sanguo"></label><label>固定 UTF-8 底本<input type="file" aria-label="固定 UTF-8 底本" accept=".txt"></label><label>来源与使用权<input aria-label="来源与使用权" placeholder="明确底本出处及可使用依据"></label><label>发布方式<select aria-label="发布方式"><option>仅草稿（默认）</option> <option>授权后自动发布</option></select></label><p>将明确交给林冲；不会沿用其他页面的隐式选择。未安装成功、权限不足或操作未决时不可交办。</p>${button('创建维护任务','complete-archive-submit')}${button('模拟响应丢失','complete-archive-unknown')}${button('恢复原操作','complete-archive-recover')}<p role="status" data-archive-result>尚未交办</p></div><details><summary>职位默认技能配置</summary><p>职位与技能多对多；移除默认通用技能不会卸载已安装技能。职位技能仍有其他任职来源时保留。</p></details></section>`);
 else root.insertAdjacentHTML('beforeend',`<div class="library-search-tab"><form class="baseline-search library-search"><input aria-label="案卷检索关键词" placeholder="查项目案卷、议事旧录、往日回报" value="${esc(state.libraryQuery||'')}"><select aria-label="案卷来源" data-library-source><option value="all">全部案卷</option><option value="project">项目案卷</option><option value="meeting">议事旧录</option><option value="memory">长记</option></select>${button('查卷','complete-library-search')}</form><div class="library-hint"><span>藏书查卷</span><span>离线检索示例</span></div><div data-search-results class="result-list">${state.libraryError?'<p class="empty-list error-list" role="alert">案卷阁暂不可查，主线不受影响</p>':state.librarySearched?(state.libraryQuery?.match(/自然|活动/)&&(!state.librarySource||['all','project'].includes(state.librarySource))?`<article class="result-card"><div class="result-head"><strong>自然观察活动案卷</strong><small>示例案卷</small></div><p>亲子家庭自然观察活动的结论与待办。引用后仍需由你确认交办。</p><div class="result-meta">项目案卷 · 本地示例</div>${button('引用并起草需求','complete-case-draft')}</article>`:'<p class="empty-list" role="status">暂未查得案卷，请换个关键词或来源。</p>'):'<p class="empty-list" role="status">输入关键词后查阅案卷阁。</p>'}</div></div>`);
 scoped(root,'data-v-1c1bde34');if($('.archive-reader',root))scoped($('.archive-reader',root),'data-v-6cf6adee');if($('[data-library-source]'))$('[data-library-source]').value=state.librarySource||'all';const form=$('.library-search',root);if(form)form.addEventListener('submit',e=>{e.preventDefault();state.libraryQuery=$('input',form).value;state.librarySearched=true;state.libraryError=false;render();});
}
function renderReader(){
 const root=$('.baseline-page');if(!root)return;state.reader||={chapter:1,bookmarks:[],notes:''};const r=state.reader;
 root.classList.add('all-reader');root.innerHTML=`<section class="archive-reader-fullscreen all-reader-frame"><header class="reader-header"><div class="reader-heading"><p class="reader-kicker">固定典籍 · 离线排版样例</p><h3 id="archive-reader-title">水滸傳</h3></div><div class="reader-header-actions"><span class="save-state">仅存于本原型</span>${button('目录','complete-toc','class="reader-header-button"')}${button('手札','complete-reader-notes','class="reader-header-button" aria-expanded="'+!!r.notesOpen+'"')}</div></header><div class="reader-layout ${r.notesOpen?'notes-open':''}"><article class="reader-content baseline-reader" tabindex="0"><h4>第${r.chapter}回 · 阅读排版示例</h4><p>以下是原型专用示例，不复制账号的阅读记录、手札或真实文件。</p><p>山间清晨，同行者整理一路的见闻，把需要进一步核实的内容记在纸上。阅读时可查看目录、留下书签，并将所选内容带入需求草稿。</p><p>这一页演示正文的字号、行距和独立滚动。切换章回后，书签和手札仍保存在当前原型会话中，不发送给生产服务。</p><p>想继续处理相关资料时，引用到需求即可。系统推荐承办后，由你确认，后续补充和结果都在同一议事中继续。</p></article><aside class="reader-notes" ${r.notesOpen?'':'data-desktop-notes'}><h4>私人手札</h4><textarea aria-label="手札草稿" placeholder="记录此处所思，仅存本地原型。">${esc(r.notes||'')}</textarea>${button('保存手札','complete-reader-save','class="note-save"')}<p class="reader-note-status" role="status">${r.notes?'已有本地手札':'尚未记录手札'}</p><h4>引用与提问</h4><p>引用示例段落起草需求，不会自动发送给好汉。</p>${button('引用当前段落起草交办','complete-reader-cite')}</aside></div><footer class="reader-footer">${button('上一回','complete-chapter',`data-chapter="${r.chapter-1}" ${r.chapter===1?'disabled':''}`)}<span>第 ${r.chapter} / 2 回（示例）</span>${button('下一回','complete-chapter',`data-chapter="${r.chapter+1}" ${r.chapter===2?'disabled':''}`)}${button('书签','complete-bookmarks')}${button('引用起草需求','complete-reader-cite')}</footer></section>`;
 scoped(root,'data-v-6cf6adee');
}
function renderMessages(){
 const root=$('.baseline-page');if(!root)return;root.classList.add('all-messages');
 const rows=listedMatters().filter(({ctx})=>!ctx.task.complete&&!ctx.task.cancelled&&(['待确认承办','待验收'].includes(listedMatterStatus(ctx))||!!matterAttentionReason(ctx)));
 root.innerHTML=`<section class="hall-overview is-messages"><div class="overview-list-heading"><h3>待我处理</h3>${button('刷新','complete-task-refresh')}</div><div class="overview-list">${rows.map(({key,ctx})=>`<article class="overview-item" data-message-matter="${esc(key)}"><div class="overview-item-copy"><strong>${esc(ctx.task.title)}</strong><p>事项 · ${esc(ctx.agent?.name||'待安排')}</p><span class="overview-status">${esc(listedMatterStatus(ctx))}</span>${matterAttentionReason(ctx)?`<p>${esc(matterAttentionReason(ctx))}</p>`:''}</div>${button(listedMatterStatus(ctx)==='待验收'?'查看待验收成果':!ctx.agent?'确认承办':'查看原因','complete-open-matter',`data-matter-key="${esc(key)}"`)}</article>`).join('')||'<div class="all-empty" role="status"><h3>暂时没有待我处理的事项</h3><p>需要补充或核对结果时，会集中出现在这里。</p></div>'}${state.draft.trim()?`<article class="overview-item" data-message-draft><div><strong>未提交的需求草稿</strong><p>${esc(state.draft)}</p></div>${button('继续填写','complete-go','data-page="create"')}</article>`:''}</div><p class="all-boundary-note">本页聚合本地示例事项和草稿，不模拟服务器推送。</p></section>`;scoped(root,'data-v-d13db084');
}

function historyTitle(ctx){return ctx.topicTitle||ctx.messages.find(m=>m.role==='USER'&&m.text?.trim())?.text.trim().slice(0,48)||ctx.chatDraft?.trim().slice(0,48)||'未命名议事';}
function historyTime(value){if(!value||Number.isNaN(new Date(value).getTime()))return '时间未记';return new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
function hasCurrentTopic(ctx){return !!(ctx.topicId||ctx.messages.length||ctx.chatDraft?.trim()||ctx.chatFiles?.length);}
function historySnapshot(ctx){
 ctx.topicId||='demo-topic-'+(++serial);
 return {id:ctx.topicId,title:historyTitle(ctx),updateTime:ctx.topicUpdatedAt||null,messages:structuredClone(ctx.messages),outputs:structuredClone(ctx.outputs),delivery:[...(ctx.delivery||[])],chatDraft:ctx.chatDraft,chatFiles:[...ctx.chatFiles],quote:ctx.quote};
}
function historyRows(ctx){
 const rows=[...(ctx.histories||[])];if(hasCurrentTopic(ctx)){const current=historySnapshot(ctx);return [current,...rows.filter(h=>h.id!==current.id)].sort((a,b)=>(Date.parse(b.updateTime)||0)-(Date.parse(a.updateTime)||0));}return rows;
}
function renderConversationHistory(){
 const panel=$('.chat-panel'),ctx=conversation();if(!panel)return;$('.baseline-history')?.remove();
 const toggle=$('[data-action=complete-history]',panel);toggle?.setAttribute('aria-expanded',String(!!ctx.historyOpen));toggle?.setAttribute('aria-controls','prototype-topic-history');
 if(!ctx.historyOpen)return;
 const rows=historyRows(ctx),limit=ctx.historyPageLimit||100,locked=ctx.pending||!!ctx.historyDeletingId||!!$('.inline-voice-status',panel);
 const trash='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg>';
 let content=ctx.historyLoading?'<div class="history-state" role="status">正在加载议事记录…</div>':ctx.topicHistoryError?`<div class="history-state is-error" role="alert">${esc(ctx.topicHistoryError)}</div>`:!rows.length?'<div class="history-state">还没有议事记录。</div>':`<ul class="history-list">${rows.slice(0,limit).map(h=>{const current=h.id===ctx.topicId,deleting=h.id===ctx.historyDeletingId;return `<li class="history-row">${button(`<strong>${esc(h.title||'未命名议事')}</strong><small>${esc(historyTime(h.updateTime))}</small>`,current?'complete-select-current':'complete-select-history',`class="history-item${current?' selected':''}" data-history="${esc(h.id)}" ${current?'aria-current="page"':''} ${locked?'disabled':''}`)}${button(deleting?'<span role="status" aria-live="polite">删除中</span>':trash,current?'complete-delete-current':'complete-delete-history',`class="history-delete" data-history="${current?'current':esc(h.id)}" title="删除议事记录：${esc(h.title)}" aria-label="${deleting?'正在删除':'删除'}话头：${esc(h.title)}" ${locked||ctx.task?.cancelled||ctx.task?.complete?'disabled':''}`)}</li>`;}).join('')}</ul>${rows.length>limit?button('加载更多记录','complete-history-more',`class="history-load-more" ${locked?'disabled':''}`):''}`;
 $('.panel-toolbar',panel).insertAdjacentHTML('afterend',`<section id="prototype-topic-history" class="hall-conversation-history baseline-history" aria-label="议事记录">${content}</section>`);
}

function openEntries(){dialog('全部入口',`<div class="mmd-more-menu">${prototypePages.map(([label,next])=>button(label,'complete-go',`data-page="${next}"`)).join('')}</div>`);}
// DISCUSSION-DISMISS-20261026: outside pointer never restores focus; Escape defers to child dialogs.
// Dismiss transient tools only, never drafts, references or recording.
function closeDiscussionTools(target=null,restoreFocus=false){
 if(!['chat','private','public'].includes(page)||$('dialog[open]'))return false;
 let closed=false,focus=null;
 if(conversation().historyOpen&&!target?.closest('.baseline-history,[data-action="complete-history"]')){
  conversation().historyOpen=false;renderConversationHistory();persist();closed=true;focus=$('[data-action="complete-history"]');
 }
 if($('.composer-more-panel')&&!target?.closest('.composer-more-panel,.composer-more')){
  $('.composer-more-panel').remove();focus=$('.composer-more');focus?.setAttribute('aria-expanded','false');closed=true;
 }
 if(restoreFocus)focus?.focus();return closed;
}
// INPUT-SWITCH-20261026: focus (including Tab) and voice activation select an input tool.
document.addEventListener('focusin',event=>{
 if(event.target.matches('.composer-textarea'))closeDiscussionTools(null);
});
document.addEventListener('click',event=>{
 const voice=event.target.closest('[data-action="complete-voice"],[data-action="complete-voice-stop"],[data-action="voice-record"],.composer-inline-voice button');
 if(voice&&!voice.disabled)closeDiscussionTools(null);
},true);
document.addEventListener('pointerdown',event=>closeDiscussionTools(event.target));
// Keyboard-activated tool buttons must switch panels just like pointer activation.
document.addEventListener('click',event=>closeDiscussionTools(event.target),true);
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&!event.defaultPrevented&&closeDiscussionTools(null,true)){event.preventDefault();event.stopImmediatePropagation();}
},true);
document.addEventListener('click',event=>{
 const t=event.target.closest('button,[data-action]');if(!t||t.disabled)return;const action=t.dataset.action;
 if(!action?.startsWith('complete-'))return;event.preventDefault();event.stopImmediatePropagation();
 const ctx=conversation();
 if(handleAllPageAction(action,t))return;
 if(action==='complete-record-preview'){state.completedPreview=state.completedPreview===t.dataset.id?null:t.dataset.id;renderFormalResults();return;}
 if(action==='complete-record-state'){state.completedReadState=t.dataset.state;state.completedPreview=null;renderFormalResults();return;}
 if(action==='complete-record-reload'){state.completedReadState='loading';renderFormalResults();setTimeout(()=>{if(!state.task?.complete)return;state.completedReadState='ready';if(page==='results')renderFormalResults();},500);return;}
 if(action==='complete-record-archive'){dialog('收入案卷','<p>仅将本事项收入个人案卷，不改变已完成状态、成果或验收记录。</p>',button('确认收入案卷','complete-record-archive-confirm','class="mmd-primary"'));return;}
 if(action==='complete-record-archive-confirm'){state.task.archived=true;$('dialog[open]')?.close();persist();render();feedback('已收入案卷（仅离线演示）');return;}
 if(action==='complete-page-back'){go(t.dataset.page);return;}
 if(action==='complete-recommend-agent'){if(!awaitingAssignment()||!demoAgents.some(([id])=>id===t.dataset.agent))return;state.task.assignmentCandidate=t.dataset.agent;renderDetail();$('.recommendation-alternative').open=true;$(`[data-action=complete-recommend-agent][data-agent="${state.task.assignmentCandidate}"]`)?.focus();persist();return;}
 if(action==='complete-acceptance-review'){reviewAcceptance();return;}
 if(action==='complete-acceptance-record'){finalDraft=[...state.final];dialog('已验收成果',`<p>以下为本事项已确认的固定版本。</p><div class="mmd-attachments">${deliveryList()}</div>`);return;}
 if(action==='complete-acceptance-modify'){if(acceptanceLocked()||state.task?.complete||state.task?.cancelled)return;$('dialog[open]')?.close();go('chat');$('.composer-textarea')?.focus();return;}
 if(action==='complete-agent-confirm'){confirmMatterAgent();return;}
 if(handleDraftAction(action,t))return;
 if(handleSyncedAction(action,t))return;
 if(action==='complete-secondary-status'){state.secondaryMatterFilter=t.dataset.kind;render();persist();return;}
 if(action==='complete-production-status'){state.taskFilter=state.taskFilter===t.dataset.status?'':t.dataset.status;render();return;}
 if(action==='complete-task-refresh'){render();feedback('已重读同一份离线事项，没有创建或修改。');return;}
 if(action==='complete-materials'){$('.composer-more-panel')?.remove();$('.composer-more')?.setAttribute('aria-expanded','false');openMaterials('chat');}
 if(action==='complete-go'){if(['detail','chat','results'].includes(t.dataset.page)&&!state.task){feedback('请先提出需求；或从页面与状态索引打开脱敏示例。');return;}if(t.dataset.page==='private'&&!state.privateAgentId){state.selectedAgent=state.selectedAgent||{id:'0',name:'宋江'};openPrivate();return;}go(t.dataset.page);}
 if(action==='complete-entries')openEntries();
 if(action==='complete-index')location.href='pages.html';
 if(action==='complete-overview-tab'){state.overviewTab=Number(t.dataset.tab);render();}
 if(action==='complete-task-group'){state.taskGroup=t.dataset.group;state.taskFilter='';render();}
 if(action==='complete-task-clear'){state.taskGroup='全部';state.taskFilter='';state.taskSearch='';state.taskAbility='';render();}
 if(action==='complete-workspace-filter'){state.workspaceFilter=t.dataset.filter;render();}
 if(action==='complete-create-status'){state.simulation.create='ok';t.closest('dialog').close();feedback('示例核对：未受理。原草稿保留，可显式提交。');}
 if(action==='complete-reply-status'){if(unifiedTask()){state.task.phase='待你补充';}state.simulation.reply='ok';ctx.error=null;ctx.pending=false;state.baselineScenario='ready';renderChat();feedback('示例核对：未受理；核对草稿后显式发送，不自动重发。');}
 if(action==='complete-operation-detail'){t.closest('dialog')?.close();go('detail');}
 if(action==='complete-operation-status')resolveOperation();
 if(action==='complete-refresh'){state.baselineScenario='ready';ctx.pending=false;ctx.error=null;render();feedback('已读取原演示话头状态；没有发送或重跑成果。');}
 if(action==='complete-history'){if($('.inline-voice-status')||ctx.historyDeletingId)return;ctx.historyOpen=!ctx.historyOpen;renderConversationHistory();persist();return;}
 if(action==='complete-history-more'){ctx.historyPageLimit=(ctx.historyPageLimit||100)+100;renderConversationHistory();persist();return;}
 if(action==='complete-select-current'){return;}
 if(action==='complete-new'){if(ctx.pending||(ctx.task?.complete||ctx.task?.cancelled))return;dialog('新对话','<p>当前消息、草稿和资料会留在议事记录中。新对话不创建事项，也不重复点将。</p>',button('取消','close-dialog')+button('新对话','complete-new-confirm'));}
 if(action==='complete-new-confirm'){if(ctx.pending)return;ctx.histories=ctx.histories||[];if(hasCurrentTopic(ctx)){const snapshot=historySnapshot(ctx);ctx.histories=ctx.histories.filter(h=>h.id!==snapshot.id);ctx.histories.push(snapshot);}ctx.topicId='demo-topic-'+(++serial);ctx.topicTitle='';ctx.topicUpdatedAt=new Date().toISOString();ctx.messages=[];ctx.chatDraft='';ctx.chatFiles=[];ctx.quote=null;ctx.pending=false;ctx.historyOpen=false;t.closest('dialog').close();render();}
 if(action==='complete-select-history'){if(ctx.pending||ctx.historyDeletingId||$('.inline-voice-status'))return;const h=ctx.histories?.find(h=>h.id===t.dataset.history);if(!h)return;const active=hasCurrentTopic(ctx)?historySnapshot(ctx):null;ctx.histories=ctx.histories.filter(x=>x.id!==h.id&&x.id!==active?.id);if(active)ctx.histories.push(active);Object.assign(ctx,{topicId:h.id,topicTitle:h.title,topicUpdatedAt:h.updateTime||null,messages:structuredClone(h.messages),outputs:structuredClone(h.outputs),delivery:[...h.delivery],chatDraft:h.chatDraft,chatFiles:[...h.chatFiles],quote:h.quote,historyOpen:true});render();}
 if(action==='complete-delete-current'||action==='complete-delete-history'){if(ctx.task?.complete||ctx.task?.cancelled||ctx.pending||ctx.historyDeletingId)return;const h=action==='complete-delete-current'?{title:historyTitle(ctx)}:ctx.histories?.find(h=>h.id===t.dataset.history);if(!h)return;dialog('删除议事记录',`<p>确认删除“${esc(h.title||'未命名议事')}”吗？删除后无法恢复。</p><small>仅删除本原型的话头，不删除事项、冻结成果或真实记录。</small>`,button('取消','close-dialog')+button('删除','complete-delete-confirm',`data-history="${action==='complete-delete-current'?'current':esc(t.dataset.history)}"`));}
 if(action==='complete-delete-confirm'){if(ctx.task?.complete||ctx.task?.cancelled||ctx.pending||ctx.historyDeletingId)return;if(t.dataset.history==='current'){ctx.messages=[];ctx.chatDraft='';ctx.chatFiles=[];ctx.quote=null;ctx.topicId=null;ctx.topicTitle='';ctx.topicUpdatedAt=null;}else ctx.histories=(ctx.histories||[]).filter(h=>h.id!==t.dataset.history);t.closest('dialog').close();render();}
 if(action==='complete-voice'){showVoiceStatus('recording');mapVoiceActions();}
 if(action==='complete-voice-stop'){showVoiceStatus('review');mapVoiceActions();}
 if(action==='complete-voice-cancel'){$('.baseline-voice-status')?.remove();state.baselineScenario='ready';renderChat();$('.composer-textarea')?.focus({preventScroll:true});if(ctx.historyOpen)renderConversationHistory();}
 if(action==='complete-voice-append'||action==='complete-voice-replace'){const text=$('.baseline-voice-status textarea').value.trim();if(!text){feedback('转写为空，草稿未改变。');return;}ctx.chatDraft=action==='complete-voice-replace'?text:[ctx.chatDraft,text].filter(Boolean).join('\n');state.baselineScenario='ready';$('.baseline-voice-status')?.remove();renderChat();$('.composer-textarea')?.focus({preventScroll:true});if(ctx.historyOpen)renderConversationHistory();}
 if(action==='complete-file'){state.fileId=t.dataset.id;state.fileManage=false;go('file');}
 if(action==='complete-rename'){dialog('重命名',`<label>名称<input aria-label="文件名称" value="${esc(asset(state.fileId||'ref-brief')?.name)}"></label>`,button('取消','close-dialog')+button('保存','complete-rename-save'));}
 if(action==='complete-rename-save'){const a=asset(state.fileId||'ref-brief'),name=$('dialog[open] input').value.trim();if(!name){feedback('名称不能为空。');return;}a.name=name;(state.fileMeta[a.id]||= {}).name=name;t.closest('dialog').close();render();}
 if(action==='complete-recycle'){const a=asset(state.fileId||'ref-brief'),m=state.fileMeta[a.id]||{};state.fileMeta[a.id]=m;if(m.recycled){m.recycled=false;render();}else dialog('移到回收站',`<p>确认将“${esc(a.name)}”移入回收站？仍可恢复。</p><p>任务引用 101 条；议事引用 2 条；现存输入授权 3 条。（离线示例计数）</p><p>已有固定版本引用和输入授权保留，本操作不会撤销授权。</p>`,button('取消','close-dialog')+button('演示确认信息过期','complete-workspace-stale-demo')+button('确认回收','complete-recycle-confirm'));}
 if(action==='complete-recycle-confirm'){const id=state.fileId||'ref-brief';(state.fileMeta[id]||= {}).recycled=true;t.closest('dialog').close();render();}
 if(action==='complete-use-file'){const base=state.fileId||'ref-brief',meta=state.fileMeta[base]||{},id=meta.versions?.find(v=>String(v.version)===String(meta.demoVersion||meta.versions.length+1))?.id||base;state.draftFiles=[...new Set([...state.draftFiles,id])];go('create');}
 if(action==='complete-library-tab'){state.libraryTab=t.dataset.tab;render();}
  if(action==='complete-archive-appoint'){$('[data-archive-status]').textContent='任职有效 · 技能待安装（不是已就绪）';return;}
  if(action==='complete-archive-resign'){$('[data-archive-status]').textContent='已卸任，业务权限已撤销 · 职位技能待卸载 · 通用技能保留';return;}
  if(action==='complete-archive-submit'){$('[data-archive-result]').textContent='离线原型：草稿完成不会上架；实际结果以服务端为准。';return;}
  if(action==='complete-archive-unknown'){$('[data-archive-result]').textContent='结果未决：已保存原操作引用。刷新后先查询，不创建第二张任务单。';return;}
  if(action==='complete-archive-recover'){$('[data-archive-result]').textContent='离线恢复示例：原任务为草稿，未发布。';return;}

 if(action==='complete-library-search'){state.libraryQuery=$('[aria-label="案卷检索关键词"]').value.trim();state.librarySearched=true;state.libraryError=false;renderLibrary();}
 if(action==='complete-case-draft'){state.draft='请根据自然观察活动案卷整理活动方案。';state.draftFiles=[...new Set([...state.draftFiles,'ref-brief'])];go('create');}
 if(action==='complete-toc'){dialog('目录',`<ol>${[1,2].map(i=>'<li>'+button('第'+i+'回','complete-chapter',`data-chapter="${i}"`)+'</li>').join('')}</ol>`);}
 if(action==='complete-chapter'){state.reader.chapter=Math.max(1,Math.min(2,Number(t.dataset.chapter)));$('dialog[open]')?.close();render();}
 if(action==='complete-bookmarks'){dialog('书签',`${state.reader.bookmarks.length?state.reader.bookmarks.map(n=>button('第'+n+'回','complete-chapter',`data-chapter="${n}"`)).join(''):'<p>暂无书签。</p>'}`,button('添加当前章节书签','complete-bookmark-save'));}
 if(action==='complete-bookmark-save'){state.reader.bookmarks=[...new Set([...state.reader.bookmarks,state.reader.chapter])];t.closest('dialog').close();feedback('演示书签已保存。');}
 if(action==='complete-notes'){dialog('手札',`<textarea aria-label="手札内容" rows="5">${esc(state.reader.notes)}</textarea>`,button('取消','close-dialog')+button('保存手札','complete-notes-save'));}
 if(action==='complete-notes-save'){state.reader.notes=$('[aria-label="手札内容"]').value;t.closest('dialog').close();feedback('演示手札已保存。');}
 persist();
},true);
// Voice is a temporary editing mode inside the same input boundary, not a panel below it.
showVoiceStatus=function(kind){
 $('.baseline-voice-status')?.remove();$('.composer-more-panel')?.remove();
 const root=$('.composer-input-area');if(!root)return;
 const recording=kind==='recording',hasDraft=!!conversation().chatDraft.trim();
 const heading=recording?'<div class="inline-voice-heading" role="status"><span class="voice-record-dot" aria-hidden="true"></span><strong>正在录音</strong><span class="voice-demo-time">00:03 · 示例</span></div><div class="inline-voice-wave" aria-hidden="true">'+[12,24,18,32,22,14,26,18,30,16,22].map(h=>`<i style="height:${h}px"></i>`).join('')+'</div>':'<div class="inline-voice-heading" role="status"><strong>检查转写内容</strong></div><textarea aria-label="语音转写草稿" rows="3">请把画面调整得明亮一些。</textarea>';
 const actions=recording?button('取消','complete-voice-cancel')+button('停止并转写','complete-voice-stop','class="inline-voice-primary"'):button('丢弃','complete-voice-cancel')+(hasDraft?button('替换草稿','complete-voice-replace'):'')+button(hasDraft?'追加到草稿':'放入输入框','complete-voice-append','class="inline-voice-primary"');
 root.insertAdjacentHTML('beforeend',`<section class="baseline-voice-status inline-voice-status" data-voice-mode="${kind}" aria-label="${recording?'录音':'转写预览'}">${heading}<small>${recording?'界面演示，不启用麦克风':'示例转写，可编辑；放入后仍需手动发送'}</small><div class="inline-voice-actions">${actions}</div></section>`);
 $$('.toolbar-actions button', $('.chat-panel')).forEach(b=>b.disabled=true);$$('.history-item,.history-delete,.history-load-more').forEach(b=>b.disabled=true);
 const focus=recording?$('[data-action=complete-voice-stop]',root):$('.baseline-voice-status textarea',root);focus?.focus({preventScroll:true});
};
function mapVoiceActions(){for(const [a,b] of [['ui-voice-stop','complete-voice-stop'],['ui-voice-cancel','complete-voice-cancel'],['ui-voice-append','complete-voice-append'],['ui-voice-replace','complete-voice-replace']])$$(`[data-action="${a}"]`).forEach(e=>e.dataset.action=b);}
document.addEventListener('input',e=>{if(e.target.dataset.completeTaskSearch){state.taskSearch=e.target.value;applyTaskFilters();persist();}});
document.addEventListener('change',e=>{if(e.target.matches('[data-task-status]')){state.taskFilter=e.target.value;applyTaskFilters();persist();}});

// Scoped 2026-10-13 source sync. All receipts below are explicitly local fixtures.
function canCancelDemo(){return !!state.task?.notStarted&&!state.task.cancelled&&!state.task.complete&&!state.pending&&!state.operation;}
function renderCancellation(){
 const card=$('.matter-advice-card');if(!card)return;
 $('.ordinary-cancellation',card)?.remove();
 if(state.task?.cancelled){card.insertAdjacentHTML('beforeend','<p role="status">事项已取消；历史指派与成果保留，不再继续办理。</p>');return;}
 if(!canCancelDemo()&&state.cancellation?.status!=='unknown')return;
 card.insertAdjacentHTML('beforeend',`<section class="ordinary-cancellation" aria-label="普通事项取消"><p>仅取消无资金事实、未实际开始的普通事项；已点将未开工也可申请，最终以服务端核验为准。历史指派与成果保留。</p>${button(state.cancellation?.status==='unknown'?'核对原取消结果':'取消未开工事项','complete-cancel','class="ordinary-cancel-action"')}${state.cancellation?.status==='unknown'?'<p role="status">结果尚未确认；只核对原事项，不重复提交取消。</p>':''}</section>`);
}
function renderFormalResults(){
 const root=supplementalRoot()||$('.formal-results-page');if(!root)return;
 root.classList.add('formal-results-page');
 // This page belongs to the matter flow, not to the borrowed 'mine' shell.
 $$('[data-workbench-tab]').forEach(tab=>{if(tab.dataset.workbenchTab==='tasks')tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');});
 $$('.panel-workspace-link').forEach(entry=>entry.remove());
 if(state.task?.complete){renderCompletedMatterResults(root);return;}
 if(unifiedTask()){renderUnifiedResults(root);return;}
 root.innerHTML=`<header><h2>正式成果</h2><p>同一事项的固定版本成果 · 离线示例，不是实际查询</p></header>${button('返回事项详情','complete-go','data-page="detail"')}`;
 if(!state.task){root.insertAdjacentHTML('beforeend','<p>请先提出需求。</p>');return;}
 // No workspace control in formal-results context; global navigation remains unchanged.
 if(state.task.cancelled){
  root.insertAdjacentHTML('beforeend',`<section class="formal-terminal-history"><p role="status">已取消；仅查看历史成果，不再继续办理或验收。</p><p role="${state.historyError?'alert':'status'}">${state.historyError?'历史成果读取失败（离线固定场景）；请核对原记录。':'历史记录已保留（离线示例）。'}</p><div class="terminal-history-actions" role="group" aria-label="重新读取历史成果">${button('重新读取历史成果','complete-history-reload','data-kind="artifacts"')}${button('重新读取议事文字成果','complete-history-reload','data-kind="text"')}</div>${state.historyError?'':state.outputs.map(a=>`<article><strong>${esc(a.name)}</strong>${media(a,true)}${button('下载历史成果','download',`data-id="${a.id}"`)}</article>`).join('')}</section>`);return;
 }
 const done=state.task.complete;
 if(state.operation&&!done){root.insertAdjacentHTML('beforeend',`<p role="status">验收状态：${esc(state.operation.stage)}；不重复提交。</p>${button('查询原操作状态','complete-operation-open')}`);return;}
 if(selectedScenario==='independent-roots'){root.insertAdjacentHTML('beforeend','<p>图片与文字属于两个独立请求，暂不能视为同次交付。</p><p>来源关联恢复仍待实现（R01）；不自动合并、不重新生成。</p>');return;}
 finalDraft=done?[...state.final]:[...state.delivery];
 root.insertAdjacentHTML('beforeend',`<p>${done?'事项已完成，最终成果如下。':'请查看本次成果，满意后确认验收；需要修改就返回议事。'}</p><div class="mmd-attachments" data-delivery-list>${deliveryList()}</div><div class="mmd-row">${done?'':button('返回议事','continue-chat')+button('查看并验收','complete-acceptance-review',`class="mmd-primary" ${acceptanceReady()?'':'disabled'}`)}</div>`);
}
function renderRuntimeCatalog(){
 const root=$('.baseline-page');if(!root)return;
 const r=state.runtimeDemo||= {open:selectedScenario.startsWith('runtime-'),mode:selectedScenario==='runtime-existing'?'existing':'new',imported:false,attempted:false,status:'',queries:0};
 root.classList.add('persona-catalog-panel');root.innerHTML=`<div class="catalog-summary"><span>12 位待请豪杰（离线布局示例）</span><span>接应方式由你确认</span></div><div class="catalog-grid">${[['林冲','豹子头','执行协作'],['公孙胜','入云龙','资料整理'],['吴用','智多星','方案梳理'],['宋江','及时雨','沟通协调'],['鲁智深','花和尚','现场安排'],['武松','行者','执行协作'],['李逵','黑旋风','任务处理'],['燕青','浪子','资料整理'],['花荣','小李广','内容校对'],['柴进','小旋风','资源整理'],['戴宗','神行太保','进展汇总'],['扈三娘','一丈青','活动协作']].map(([name,nick,ability],i)=>`<article class="persona-card">${i<2?`<img class="all-persona-avatar" src="shared/juyiting-portraits/thumbs/${i===0?'linchong':'gongsunsheng'}.webp" alt="${name}画像">`:`<span class="all-persona-avatar" aria-hidden="true">${esc(name[0])}</span>`}<div class="persona-main"><div class="persona-head"><strong>${name}</strong><em>梁山好汉</em></div><small>${nick}</small><div class="ability-tags"><span>${ability}</span><span>离线示例</span></div></div><div class="catalog-actions">${i===0?button('自家接应','complete-runtime-open')+button('山寨安顿','complete-runtime-hosted'):button('查看本领','complete-catalog-profile',`data-name="${esc(name)}" data-ability="${esc(ability)}"`)}</div></article>`).join('')}</div><p class="all-boundary-note">原型不绑定好汉、不生成密钥、不登记真实安装或付款。</p>`;scoped(root,'data-v-31fc08de');
 if(!r.open)return;
 root.insertAdjacentHTML('beforeend',`<section class="runtime-setup"><div class="runtime-guide-head"><strong>自家接应文书已备（示例）</strong>${button('关闭接应文书','complete-runtime-close')}</div><p>Runtime v1 自家接应；安装授权不代表 Runtime 在线或事项可办理。</p><dl class="runtime-scope"><div><dt>Tenant</dt><dd>demo-tenant</dd></div><div><dt>Client</dt><dd>demo-client</dd></div><div><dt>Agent</dt><dd>demo-linchong</dd></div><div><dt>Manifest 版本</dt><dd>v1（非真实清单）</dd></div></dl><h3>Runtime 指引</h3><p>统一目录：程序放 apps/cyf-agent-runtime-v1，配置与策略放 conf/cyf-agent-runtime-v1，各角色 HOME 放 state/cyf-agent-runtime-v1/INSTANCE/agents/SUBJECT/codex-home；基目录使用目标机本人获授权的位置。</p><p>已有统一 Runtime：沿用 installation、manifest、hostId、授权和完整会话；不重新生成交接材料、不重复登记或 enroll。本页不会自动更新目标机。</p><div class="runtime-actions">${button('首次接入（演示）','complete-runtime-mode','data-mode="new"')}${button('已有 Runtime（演示）','complete-runtime-mode','data-mode="existing"')}</div>${r.mode==='existing'?'<p role="status">已有安装：仅查询原安装状态，不重复登记。路径迁移、validate、服务切换与新事项验收须在实际环境完成。</p>':'<ol><li>确认目标机运行用户、文件 UID 与权限。</li><li>准备交接材料，安全传回 handoff.json。</li></ol><pre class="runtime-command">安装 → prepare → 网页登记 → profile/host 配置 → validate → enroll → 服务切换 → 新事项验收</pre><p>不要粘贴或传送 enrollment-secret、subject-key、JWT 或 API Key。</p><label>导入 handoff.json（原型禁用真实文件）<input type="file" accept="application/json,.json" disabled></label>'+button('载入脱敏 handoff 示例','complete-runtime-import')}${r.error?`<p class="runtime-error" role="alert">${esc(r.error)}</p>`:''}${r.imported?'<p role="status">示例作用域匹配；不代表真实材料已校验。</p>':''}<div class="runtime-actions">${button('明确登记安装','complete-runtime-register',`class="catalog-action primary" ${r.mode==='existing'||!r.imported||r.attempted?'disabled':''}`)}${button('手动查询同一安装','complete-runtime-query',`class="catalog-action subtle" ${r.mode==='new'&&!r.imported?'disabled':''}`)}</div>${r.status?`<p role="status">安装授权状态：${esc(r.status)}（离线固定回执）。PENDING / ACTIVE 不代表在线；仍须配置、validate、enroll、服务切换与新事项验收。</p>`:''}</section>`);
}
function handleSyncedAction(action,t){
 if(action==='complete-operation-open'){operationDialog();return true;}
 if(action==='complete-cancel'){
  if(state.cancellation?.status==='unknown'){state.cancellation.queries=(state.cancellation.queries||0)+1;persist();feedback('示例核对：结果仍未确认；不重复提交取消。');return true;}
  if(!canCancelDemo())return true;
  dialog('确认取消未开工事项？',`<p>即将申请取消“${esc(taskTitle())}”。仅限无资金事实且未实际开始的事项，最终由服务端核验；历史指派与成果保留。确认后不会继续办理；若结果未确认，只核对原结果，不重复提交。</p>`,button('保留事项','close-dialog')+button('确认取消事项','complete-cancel-confirm','class="ordinary-cancel-action"'));return true;
 }
 if(action==='complete-cancel-confirm'){
  if(!canCancelDemo()||state.cancellation?.writes)return true;
  state.cancellation={writes:1,queries:0,status:selectedScenario==='cancel-unknown'?'unknown':'cancelled'};
  if(state.cancellation.status==='cancelled'){state.task.cancelled=true;state.pending=false;}
  t.closest('dialog')?.close();render();return true;
 }
 if(action==='complete-history-reload'){state.historyReads||={artifacts:0,text:0};state.historyReads[t.dataset.kind]++;persist();feedback(state.historyError?'示例读取仍失败；保留原记录，不自动重跑。':'已重新读取同一份离线历史；没有发送或验收。');return true;}
 if(!action?.startsWith('complete-runtime-'))return false;
 const r=state.runtimeDemo;
 if(action==='complete-runtime-open')r.open=true;
 if(action==='complete-runtime-close'){r.open=false;renderRuntimeCatalog();persist();return true;}
 if(action==='complete-runtime-hosted'){dialog('山寨安顿','<p>保留已有付费安顿边界；本原型不报价、不付款、不绑定好汉。</p>');return true;}
 if(action==='complete-runtime-mode'){Object.assign(r,{mode:t.dataset.mode,error:''});}
 if(action==='complete-runtime-import'){
  r.error=selectedScenario==='runtime-invalid'?'示例作用域不匹配或材料已过期；不登记安装。':'';r.imported=!r.error;
 }
 if(action==='complete-runtime-register'&&r.mode==='new'&&r.imported&&!r.attempted){r.attempted=true;r.status=selectedScenario==='runtime-unknown'?'UNKNOWN':'PENDING';}
 if(action==='complete-runtime-query'){r.queries++;r.status=selectedScenario==='runtime-unknown'?'UNKNOWN':r.mode==='existing'?'ACTIVE':'PENDING';}
 renderRuntimeCatalog();persist();return true;
}

// One continuous conversation. Local demo only, never API/Provider authority.
const demoAgents=[['wuyong','吴用'],['0','宋江'],['1','公孙胜']];
function demoDraftFields(){return {title:state.title,instruction:state.draft,inputs:[...state.draftFiles],agentId:state.draftAgent||'wuyong'};}
function demoDraftSaved(){return !!state.savedPrivateDraft&&JSON.stringify(state.savedPrivateDraft.fields)===JSON.stringify(demoDraftFields());}
function saveDemoDraft(){state.savedPrivateDraft={fields:demoDraftFields(),revision:(state.savedPrivateDraft?.revision||0)+1};persist();renderDraftPage();}
function demoAgentSelect(){return `<select aria-label="承办好汉" data-draft-agent>${demoAgents.map(([id,name])=>`<option value="${id}" ${(state.draftAgent||'wuyong')===id?'selected':''}>${name}</option>`).join('')}</select>`;}
function unifiedTask(){return !!state.task?.unified;}
function awaitingAssignment(){return !!state.task&&!state.agent&&!state.task.complete&&!state.task.cancelled;}
function ensureUnifiedTask(){
 saveMatterContext();
 state.task={id:'demo-matter-'+(++serial),unified:true,title:state.title.trim()||state.draft.trim().slice(0,36)||'资料处理',description:state.draft,files:[...state.draftFiles],phase:'待确认承办',notStarted:true,complete:false,executions:[],turns:0};
 state.matterSelectionKey=state.task.id;
 Object.assign(state,{agent:null,selectedAgent:null,recommendation:null,messages:[],outputs:[],delivery:[],final:[],pending:false,error:null,operation:null,cancellation:{writes:0,status:'ready'},chatDraft:'',chatFiles:[],quote:null,histories:[],historyOpen:false,topicId:null,topicTitle:'',topicUpdatedAt:null,historyPageLimit:100,baselineScenario:'ready'});
 taskRecommendation();
}
function recommendTaskAgent(text){
 // Offline capability fixtures, not a live routing service.
 if(/画|图片|插画|设计/.test(text))return {id:'1',reason:'这项需求涉及创意与图像表达，推荐公孙胜。'};
 if(/协调|分工|统筹/.test(text))return {id:'0',reason:'这项需求涉及统筹协调，推荐宋江。'};
 return {id:'wuyong',reason:'这项需求适合先梳理目标、整理内容，推荐吴用。'};
}
function taskRecommendation(){
 const task=state.task;
 task.assignmentRecommendation||=recommendTaskAgent(task.description||task.title||'');
 if(!demoAgents.some(([id])=>id===task.assignmentCandidate))task.assignmentCandidate=task.assignmentRecommendation.id;
 return task.assignmentRecommendation;
}
function assignmentSection(){
 const recommendation=taskRecommendation(),candidate=state.task.assignmentCandidate;
 const name=demoAgents.find(([id])=>id===recommendation.id)?.[1]||'待选择';
 return `<section class="matter-assignment" aria-label="确认承办"><h4>建议承办 · ${esc(name)}</h4><p class="matter-fee-note">${esc(recommendation.reason)}</p><details class="recommendation-alternative"><summary><span>另选承办好汉</span><small>当前：${esc(demoAgents.find(([id])=>id===candidate)?.[1]||name)}</small></summary><p>选择仅保存候选；确认后才安排承办，不会新建事项。</p><div class="recommendation-options" role="group" aria-label="承办候选">${demoAgents.map(([id,n])=>button(`<span class="recommendation-avatar">${n.slice(0,1)}</span><span><strong>${n}</strong><small>${id==='wuyong'?'梳理需求与方案':id==='0'?'统筹事项与协作':'整理资料与内容'}${id===recommendation.id?' · 系统推荐':''}</small></span><span class="recommendation-check" aria-hidden="true">${candidate===id?'✓':''}</span>`,'complete-recommend-agent',`data-agent="${id}" aria-pressed="${candidate===id}"`)).join('')}</div></details></section>`;
}
function confirmMatterAgent(){
 if(!awaitingAssignment()||state.pending)return;
 taskRecommendation();
 const candidate=demoAgents.find(([id])=>id===state.task.assignmentCandidate);if(!candidate)return;
 const selected={id:candidate[0],name:candidate[1]};
 if(!unifiedTask()){state.selectedAgent=selected;assign();return;}
 const task=state.task;state.agent=selected;state.selectedAgent={...selected};task.notStarted=false;task.phase='进行中';
 if(!persist()){state.agent=null;state.selectedAgent=null;task.notStarted=true;task.phase='待确认承办';feedback('未能保存承办确认，请检查浏览器存储后重试；尚未开始处理。');return;}
 go('chat');sendUnifiedMessage(task.description,[...task.files],null);
}
function syncProductionNavigation(){
 const primary=['home','tasks','workspace','mine'];
 const fallback={create:'tasks',detail:'home',chat:'detail',private:'agents',public:'map',agents:'home',file:'workspace',reader:'library',results:'detail',library:'mine',messages:'home',catalog:'agents',map:'home',help:'mine',account:'mine'};
 const target=page==='detail'?'tasks':page==='chat'?'detail':(state.returnPages?.[page]||fallback[page]||'home');
 const crumb=$('.workbench-breadcrumb strong');if(crumb)crumb.textContent=labels[page];
 if(primary.includes(page))return;
 const modal=['agents','catalog','library','reader','messages','help','account','private','public','chat','create'].includes(page);
 let header=page==='detail'?$('.bounty-modal-header'):$('.panel-title');
 const host=$('.hall-draft-editor,.baseline-page,.agent-panel,.formal-results-page');
 let panel=host?.closest('.floating-panel')||$('.floating-panel');
 if(!header){header=document.createElement('header');header.className='production-page-header';if(panel)panel.prepend(header);else if(host)host.prepend(header);else return;}
 if(modal&&panel){
  const overlay=panel.parentElement;overlay.className='panel-overlay theme-workbench all-pages-modal'+(['chat','private','public'].includes(page)?' is-chat-overlay':'');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label',labels[page]);
  panel.className='floating-panel layout-center-modal all-pages-panel panel-'+page;
  if(['chat','private','public'].includes(page)){overlay.classList.add('discussion-fullscreen');panel.classList.add('discussion-fullscreen-panel');}
  if(page==='create'){panel.classList.add('authenticated-draft-panel');overlay.classList.add('authenticated-draft-overlay');}
  panel.prepend(header);
  if(host)host.classList.add('all-page-content');
  // Background controls remain visible but cannot receive keyboard or pointer input.
  const frame=overlay.parentElement;for(const child of frame.children){if(child!==overlay&&!child.contains(overlay)){child.setAttribute('inert','');child.setAttribute('aria-hidden','true');}}
 }
 const back=page==='detail'?'bounty-back-button':'panel-return';header.classList.add('production-page-header');
 header.innerHTML=button('← 返回','complete-page-back',`class="${back}" data-page="${target}" aria-label="返回${esc(labels[target])}"`)+`<span id="juyiting-floating-panel-title">${esc(page==='chat'?'议事':labels[page])}</span>`;
 if(page==='map'){header.classList.add('all-map-back');$('.all-scene')?.prepend(header);}
}
function startUnifiedConversation(){
 if(!state.draft.trim()&&!state.draftFiles.length){feedback('请先填写需求或选择资料。');return;}
 if(state.draft.length>20000||state.title.length>200){feedback('内容超出长度，请修改后再发送；原文仍保留。');return;}
 if(state.pending||state.operation?.stage==='pending'){feedback('当前事项仍在处理中，请稍后再提交；需求已保留。');return;}
 if(state.simulation.create!=='ok'){createProblem();return;}
 const before=structuredClone(state),beforeSerial=serial;
 ensureUnifiedTask();state.draft='';state.title='';state.draftFiles=[];state.savedPrivateDraft=null;
 if(!persist()){Object.keys(state).forEach(k=>delete state[k]);Object.assign(state,before);serial=beforeSerial;feedback('事项未能保存，请检查浏览器存储后重试；需求和资料仍保留。');return;}
 go('detail');
}
// Offline interaction examples only; NOT a production intent classifier.
// Unknown wording is deliberately clarified rather than guessed by keywords.
function handleSubmittedDiscussion(text,inputs=[],quote=null){
 if(!state.delivery?.length||!state.task||state.task.complete||state.task.cancelled)return false;
 const brief=text.trim();
 const direct=/^(请)?把时间改成明天[，,、 ]*(重新生成)?[。！!]*$/.test(brief)
  || /^(请)?重新生成[。！!]*$/.test(brief)
  || (/^(确认修改|就按这个改|按此修改)[。！!]*$/.test(brief)&&JSON.stringify(state.task.pendingRevisionQuestion?.delivery)===JSON.stringify(state.delivery));
 const question=/[？?]|怎么样|会不会|是否|能否/.test(brief);
 const staleQuote=quote&&!state.delivery.includes(quote);
 const needsTarget=state.delivery.length>1&&!quote;
 if(direct&&!question&&!staleQuote&&!needsTarget){
  state.task.pendingRevisionQuestion=null;
  return false;
 }
 state.messages.push({role:'USER',text:brief||'请看看这些资料。',files:[...inputs],quote});
 const discussion=/^(这个结果怎么理解[？?]?|不错[。！!]*|可以[。！!]*|谢谢[。！!]*|为什么.*)$/.test(brief);
 let answer;
 if(staleQuote)answer='你引用的是历史成果。请说明要修改当前成果的哪一部分；本轮成果仍待验收。';
 else if(needsTarget&&!discussion)answer='这轮有多项成果，请说明要修改哪一项，请说出成果名称或具体内容。未开始修改，本轮仍待验收。';
 else if(discussion)answer='可以继续讨论这版成果。提问或表示认可不会启动修改；满意后请点击“查看并验收”确认。（离线说明示例）';
 else {answer='你是希望我正式修改本轮成果，还是先讨论这个想法？请直接在这里说明。当前成果仍待验收。（离线示例：可输入“把时间改成明天，重新生成”）';state.task.pendingRevisionQuestion={text:brief,delivery:[...state.delivery]};}
 state.messages.push({role:'AGENT',text:answer,clarification:!discussion});
 state.chatDraft='';state.chatFiles=[];state.quote=null;persist();renderChat();return true;
}
function sendUnifiedMessage(text,inputs=[],quote=null){
 if(!unifiedTask()||!state.agent||state.pending||acceptanceLocked()||state.task.complete||state.task.cancelled||(!text.trim()&&!inputs.length))return;
 if(state.simulation.reply==='failed'){
  state.chatDraft=text;state.chatFiles=[...inputs];state.quote=quote;state.error='尚不能确认本条消息是否受理（模拟）。内容已保留，请先核对，不要重复发送。';state.task.phase='需核对';renderChat();persist();return;
 }
 if(handleSubmittedDiscussion(text,inputs,quote))return;
 const replyEpoch=beginReplyControl(state),task=state.task,turn=++task.turns;
 const message={role:'USER',text:text||'请看看这份资料。',files:[...inputs],quote,turn};
 state.messages.push(message);if(state.delivery.length)state.messages.push({role:'AGENT',text:'已开始按你的要求修改。上一版仍保留，新成果提交后再验收。（离线演示）'});task.files=[...new Set([...task.files,...inputs])];
 state.chatDraft='';state.chatFiles=[];state.quote=null;state.pending=true;state.pendingReason='unified-reply';task.phase='正在处理';persist();renderChat();
 setTimeout(()=>{
  if(state.task!==task||!state.pending||task.turns!==turn||state.replyEpoch!==replyEpoch)return;
  const brief=text.trim(),missingPurpose=!brief||brief.length<5||/^(帮我|做一下|处理一下|优化一下|改一下|看看)[。！!\s]*$/.test(brief);
  const missingResume=/简历/.test(brief)&&!task.files.length;
  if(missingPurpose||missingResume){
   state.messages.push({role:'AGENT',text:missingResume?'请先添加需要优化的简历，也可以直接粘贴内容。收到后，我会继续在这里给你修改结果。':'你希望最后得到什么结果？可以补充用途或重点，也可以添加资料。我会沿着这段对话继续处理。',clarification:true,turn});
   task.phase='待你补充';
  }else{
   const round=task.executions.length+1;
   const snapshot={instruction:brief,inputs:task.files.map(id=>({fileId:id,version:1})),quote,agentId:state.agent.id};
   const body=round===1?`活动简报\n\n目标：梳理活动安排，明确下一步行动。\n结论：围绕活动主题组织内容，保留关键要求。\n待办：确认参与人员、完善时间安排、准备资料。`:`活动简报 · 修改稿\n\n已按本轮要求调整内容表达，保留关键结论与待办。\n本轮修改要求：${brief}\n\n上一版仍保留，可在原对话中预览；需要调整请直接说明。`;
   const id=output('text',body+'\n\n（离线示例，不是真实模型生成。）',round,state),a=asset(id);
   a.name=`${task.title}-第${round}版.txt`;a.note=`第 ${round} 版 · 离线示例`;a.round=round;
   task.executions.push({id:'demo-execution-'+(++serial),round,turn,fields:structuredClone(snapshot),outputs:[id],writes:1,phase:'已有结果'});
   state.delivery=[id];state.messages.push({role:'AGENT',text:round===1?'先给你这一版。结果在下面，可以直接查看；哪里不合适，继续告诉我就好。':'按你的补充改好了，这是第 '+round+' 版。上一版仍在这段对话里。',outputs:[id],turn});task.phase='已有结果';
  }
  state.pending=false;state.pendingReason=null;state.error=null;settleReplyControl(state);persist();
  if(page==='chat')renderChat();else if(['home','tasks','detail','results'].includes(page))render();
 },replyDemoDelay());
}
function sendUnifiedDraft(){if(state.pending||state.error)return;sendUnifiedMessage(state.chatDraft.trim(),state.chatFiles,state.quote);}
function renderDraftPage(){
 const old=$('.hall-draft-editor')||$('.bounty-panel');if(!old)return;
 const root=document.createElement('section');root.className='hall-draft-editor hall-draft-editor--draft';root.setAttribute('aria-label','提出需求');old.replaceWith(root);
 const panel=root.closest('.floating-panel'),overlay=panel?.parentElement;if(panel){panel.className='floating-panel panel-draft layout-center-modal authenticated-draft-panel';const heading=$('.panel-title',panel);if(heading)heading.remove();}if(overlay){overlay.className='panel-overlay theme-workbench authenticated-draft-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','提出需求');}
 const chips=state.draftFiles.length?state.draftFiles.map(id=>`<span>${esc(asset(id)?.name)} · v1（示例）</span>`).join(''):'<span class="muted">资料可稍后在议事中补充</span>';
 root.innerHTML=`<p class="draft-intro">说说你想办成的事，结果和后续修改都在同一段议事里。</p><form class="task-create-form"><label><span>需求描述</span><textarea name="taskDescription" placeholder="例如：把活动说明整理成一页简报，列出结论和待办。">${esc(state.draft)}</textarea></label><section class="draft-strip draft-materials"><div><h4>参考资料 <small>可选</small></h4><div class="draft-chips">${chips}</div></div>${button('添加资料','materials','data-context="draft"')}</section><details class="unified-optional"><summary>事项名称（可选）</summary><label><input name="taskTitle" aria-label="事项名称" placeholder="不填写时，按需求自动命名" value="${esc(state.title)}"></label></details><p class="draft-hint">点击开始办事即保存为待确认承办，在事项详情确认或另选系统推荐的承办好汉；信息不足会在议事中询问。</p><div class="draft-actions"><span data-draft-save-status class="muted">${demoDraftSaved()?'草稿已保存。':'离线原型，不调用模型、不扣费。'}</span>${button('保存草稿','complete-draft-save')}${button('开始办事','complete-draft-next','class="primary"')}</div></form>`;
 $('.task-create-form',root).addEventListener('submit',e=>{e.preventDefault();startUnifiedConversation();});
}
function handleDraftAction(action,t){
 if(!action?.startsWith('complete-draft-'))return false;
 if(action==='complete-draft-save')saveDemoDraft();
 if(action==='complete-draft-next')startUnifiedConversation();
 if(action==='complete-draft-new'){Object.assign(state,{title:'',draft:'',draftFiles:[],savedPrivateDraft:null});go('create');}
 persist();return true;
}
function matterDetailPresentation(){
 const t=state.task||{},phase=t.phase||'',label=listedMatterStatus(state);
 if(t.cancelled)return {label,tone:'muted',hint:'事项已停止办理，原议事和已有成果保留，仅供查看。',action:'查看议事记录'};
 if(t.complete)return {label,tone:'success',hint:'事项已完成，保留议事与结果；不再向此事项发送新要求。',action:'查看议事记录'};
 if(state.operation&&state.operation.stage!=='completed')return {label,tone:'warning',hint:'保留原验收操作，先核对进度，不重复提交。',action:'查看议事记录'};
 if(phase==='失败')return {label,tone:'warning',hint:'本次处理未成功，原需求和资料保留。进入议事查看原因，不自动重试。',action:'查看失败原因'};
 if(state.error||phase==='需核对')return {label,tone:'warning',hint:'尚不能确认上次处理结果。回原议事核对，草稿保留，不自动重发。',action:'回议事核对'};
 if(!state.agent)return {label,tone:'warning',hint:'事项已保存，尚未安排承办、未开始处理。确认后进入同一事项的议事。',action:'确认承办，进入议事'};
 if(state.pending||['正在处理','办理中'].includes(phase))return {label,tone:'running',hint:'正在处理，进入原议事查看进展；不要重复提交需求。',action:'查看办理进展'};
 if(phase==='待你补充')return {label,tone:'warning',hint:'承办好汉需要补充信息，请在原议事中直接回复。',action:'补充信息，继续议事'};
 if(acceptanceReady())return {label,tone:'success',hint:'本轮固定成果已提交。查看并验收后完成事项；不满意可在原议事继续修改。',action:'继续议事'};
 return {label,tone:'neutral',hint:'补充要求、查看结果和提出修改，都在原议事中继续。',action:'继续议事'};
}
function renderMatterOverview(card,unified){
 const v=matterDetailPresentation(),t=state.task||{};card.classList.add('matter-state-card','mmd');card.dataset.matterState=v.label;
 if(awaitingAssignment()){
  card.dataset.agentRecommendation='';
  card.innerHTML=`<div class="matter-advice-heading"><span>事项进展</span><strong class="matter-state-badge tone-warning">待确认承办</strong></div><h3>${esc(t.title||taskTitle())}</h3><p class="matter-request">${esc(t.description||taskTitle())}</p><dl><div><dt>承办好汉</dt><dd>待确认</dd></div><div><dt>资料 / 结果</dt><dd>${t.files?.length||0} 份资料 · ${state.outputs.length} 份结果</dd></div></dl><p class="matter-state-guidance">事项已保存，尚未安排承办、未开始处理。返回或刷新后可继续确认。</p>${assignmentSection()}<div class="matter-primary-actions">${button('确认承办，进入议事','complete-agent-confirm','class="matter-primary-action mmd-primary"')}</div><p class="draft-hint">离线原型：仅保存到当前浏览器会话，不调用真实 Agent、不扣费。</p>`;
  return;
 }
 delete card.dataset.agentRecommendation;
 card.innerHTML=`<div class="matter-advice-heading"><span>事项进展</span><strong class="matter-state-badge tone-${v.tone}">${v.label}</strong></div><h3>${esc(t.title||taskTitle())}</h3><p class="matter-request">${esc(t.description||taskTitle())}</p><dl><div><dt>承办好汉</dt><dd>${esc(state.agent?.name||'待确认')}</dd></div><div><dt>资料 / 结果</dt><dd>${t.files?.length||0} 份资料 · ${state.outputs.length} 份结果</dd></div></dl><p class="matter-state-guidance">${v.hint}</p><div class="matter-primary-actions">${unified?button(v.action,'complete-go',`data-page="${state.agent||t.complete||t.cancelled?'chat':'agents'}" class="matter-primary-action mmd-primary"`):button(v.action,'complete-go',`data-page="${state.agent||t.complete||t.cancelled?'chat':'agents'}" class="matter-primary-action mmd-primary"`)}</div>`;
 if(acceptanceReady())$('.matter-primary-actions',card).innerHTML=button('查看成果并验收','complete-acceptance-review','class="matter-primary-action mmd-primary"')+button('继续议事','complete-go','data-page="chat" class="matter-primary-action simplify-secondary"');
}
function renderUnifiedDetail(){
 const card=$('.matter-advice-card');if(!card)return;card.classList.add('unified-matter');renderMatterOverview(card,true);
 const materials=$('.task-material-links');if(materials)materials.innerHTML=`<div class="mmd"><h4>资料与成果</h4>${files(state.task.files,'task',false)}${awaitingAssignment()?'<p class="mmd-muted">确认承办后，在议事中查看结果或继续补充资料。</p>':''}</div>`;
 if(!acceptanceReady())card.insertAdjacentHTML('beforeend',acceptanceSummary());
 $$('.matter-results-action,.baseline-cancellation').forEach(e=>e.hidden=true);
 if(awaitingAssignment()||state.task.cancelled)renderCancellation();
}
function renderUnifiedResults(root){
 root.classList.add('unified-results');root.innerHTML=`<header><h2>事项成果与验收</h2><p>每一版结果与修改要求都保留在原议事中。</p></header>${acceptanceSummary()||'<p>尚无可验收的最新成果，请在原议事中继续。</p>'}${button('回到议事查看结果','complete-go','data-page="chat"')}`;
}
document.addEventListener('change',e=>{if(e.target.matches('[data-draft-agent]')){state.draftAgent=e.target.value;persist();}});
document.addEventListener('input',e=>{if(page==='create'&&e.target.matches('[name=taskTitle],[name=taskDescription]')){const status=$('[data-draft-save-status]');if(status)status.textContent='草稿已修改，尚未发送。';}});

function syncTaskToolbar(){
 const panel=$('.bounty-panel'),bar=panel&&$('.panel-toolbar',panel);if(!bar)return;
 panel.dataset.uiSync='20261013';
 $$('.task-create-actions,.task-draft-actions,.task-create-form',panel).forEach(e=>e.remove());
 $$('.workbench-create-action').forEach(e=>{e.dataset.prototypePage='create';});
 const search=$('.task-search',bar);if(search){search.style.display='grid';search.style.gridTemplateColumns='minmax(0, 1fr) minmax(90px, 0.45fr)';search.style.gap='8px';}
 const input=$('input',search||bar),select=$('select',search||bar);
 if(input){input.style.gridColumn='auto';input.type='search';input.setAttribute('aria-label','搜索事项');input.placeholder='查榜号';input.dataset.completeTaskSearch='true';}
 if(select){select.style.gridColumn='auto';select.setAttribute('aria-label','筛选所需本领');if(select.options[0])select.options[0].textContent='不拘本领';}
 const refresh=$(':scope > button',bar);if(refresh){refresh.classList.add('task-refresh');refresh.setAttribute('aria-label','刷新事项');refresh.title='刷新事项';refresh.dataset.action='complete-task-refresh';refresh.innerHTML=uiIcon('refresh');}
 bar.style.display='grid';bar.style.gridTemplateColumns='minmax(0, 1fr) 44px';bar.style.alignItems='center';bar.style.gap='8px';
}

// 2026-10-16: page-specific production structures, in the existing prototype only.
function refreshAllPageSurfaces(){
 document.body.dataset.uiRevision='all-pages-20261016';document.body.dataset.currentPage=page;
 const navFamily={home:'overview',tasks:'tasks',create:'tasks',detail:'tasks',chat:'tasks',results:'tasks',workspace:'treasure',file:'treasure',mine:'mine',agents:'mine',catalog:'mine',library:'mine',reader:'mine',messages:'mine',help:'mine',account:'mine',private:'mine',public:'overview',map:'overview'};
 $$('[data-workbench-tab]').forEach(e=>{e.toggleAttribute('aria-current',e.dataset.workbenchTab===navFamily[page]);if(e.hasAttribute('aria-current'))e.setAttribute('aria-current','page');});
 $$('.workbench-account-action,.workbench-sidebar-account').forEach(e=>{e.disabled=page!=='home';if(page==='home')e.dataset.prototypePage='account';else delete e.dataset.prototypePage;e.title=page==='home'?'个人中心：原型仅说明入口，设置页待核验':'请返回首页后进入个人中心';});
 const root=$('.baseline-page');
 if(page==='mine'){
  const mine=$('.hall-mine-page');if(mine){mine.querySelectorAll('.baseline-extra').forEach(e=>e.remove());const grid=$('.mine-grid',mine);if(grid){const entries=[['agents','好汉名册','查看好汉本领与在线状态','account-circle-outline'],['library','典籍阁','阅读典籍、案卷与个人进度','notebook'],['messages','消息','查看需要你处理的事项','bell-outline'],['map','厅中实景','进入梁山场景与地图','map-marker-outline'],['account','个人中心','返回首页后进入个人中心','account-circle-outline']];grid.innerHTML=entries.map(([to,title,desc,icon])=>`<button type="button" data-action="complete-go" data-page="${to}" ${to==='account'?'disabled aria-disabled="true"':''}><i class="var-icon var-icon--set var-icon-${icon}" aria-hidden="true"></i><span><strong>${title}</strong><small>${desc}</small></span></button>`).join('');}scoped(mine,'data-v-2ccfdada');mine.insertAdjacentHTML('beforeend',`<footer class="all-mine-links">${button('使用帮助','complete-go','data-page="help"')}${button('全部页面索引','complete-index')}</footer>`);}
 }
 if(page==='help'&&root){
  // Guidance keeps navigation as a visible, non-interactive reference.
  $$('.workbench-mobile-nav,.hall-workbench-sidebar').forEach(nav=>nav.setAttribute('inert',''));
  $('.juyi-page')?.classList.add('has-workbench-dock');
  const mobile=window.innerWidth<=760,location=mobile?'底部导航':'左侧导航';
  const steps=[['从办事页开始','在“办事”页写下目标，按需添加资料。点击“开始办事”先保存需求，确认承办后才交给好汉。'],['确认承办，再协作验收',`从${location}进入“事项”，打开需求，确认推荐好汉或另选。之后在原议事补充要求、查看结果和提出修改；成果提交后，查看并明确确认验收才算完成。`],['在资料页查找与复用',`从${location}进入“资料”，管理文件、查看成果，选择需要引用的固定版本。资料不是必选，添加资料不等于已经发送给好汉。`],['更多入口与使用帮助',mobile?'底部“我的”汇集好汉名册、典籍阁、待办提醒和厅中实景，也能重新打开“使用帮助”。点“稍后”仅收起本次引导；“跳过本版本”不影响手动重看。':'左侧“我的”汇集好汉名册、典籍阁和待办提醒；侧栏下方可进入厅中实景、重看“使用帮助”。点“稍后”仅收起本次引导；“跳过本版本”不影响手动重看。']];const n=Math.min(state.helpStep||0,steps.length-1);
  root.classList.add('all-help');root.innerHTML=`<section class="onboarding-dialog all-help-dialog" aria-labelledby="hall-onboarding-title"><div class="dialog-heading"><div><p class="eyebrow">聚义厅 · ${mobile?'手机端':'PC端'}使用指导</p><h1 id="hall-onboarding-title">${steps[n][0]}</h1></div></div><p class="intro">${steps[n][1]}</p><div class="all-guide-track" aria-label="引导进度">${steps.map((_,i)=>`<span class="${i<=n?'active':''}"></span>`).join('')}</div><p class="step-progress">第 ${n+1} 步，共 ${steps.length} 步</p><p class="all-boundary-note">只介绍入口，不会替你提交需求或发送消息。当前为离线原型；产品会在入口可见时高亮定位，不可见时保留文字说明。</p><div class="dialog-actions">${button('稍后','complete-page-back',`data-page="${state.returnPages?.help||'home'}"`)}${button('跳过本版本','complete-page-back',`data-page="${state.returnPages?.help||'home'}"`)}${n?button('上一步','complete-help-step',`data-step="${n-1}"`):''}${n<steps.length-1?button('下一步','complete-help-step',`data-step="${n+1}" class="complete-button"`):button('我知道了','complete-go','data-page="home" class="complete-button"')}</div></section>`;
 }
 if(page==='account'&&root){root.classList.add('all-account');root.innerHTML=`<section class="all-account-card"><span class="all-persona-avatar" aria-hidden="true">我</span><h2>个人中心</h2><p>这是聚义厅外的账户模块入口。</p><p role="status">生产源码支持从首页进入个人中心；面板打开或语音交互锁定时暂不可进入。真实设置页面尚待核验。</p><div class="all-account-options">${['账户信息','授权管理','隐私设置'].map(x=>`<button disabled>${x}<small>原型暂未展示</small></button>`).join('')}</div><p class="all-boundary-note">此处仅说明入口边界，不代表生产账户功能不可用；不模拟未经核验的设置，也不读取或修改凭据。</p>${button('返回我的','complete-go','data-page="mine"')}</section>`;}
 if(page==='map'&&root){root.classList.add('all-map');document.body.append(root);root.innerHTML=`<section class="all-scene" aria-label="厅中实景静态原型"><img src="assets/hall-base-v3.webp" alt="现有梁山厅堂游戏底图；静态原型，非实时地图"><nav class="all-scene-tools" aria-label="实景工具"><strong>聚义厅</strong>${button('办事','complete-go','data-page="home"')}${button('消息','complete-go','data-page="messages"')}${button('资料','complete-go','data-page="workspace"')}${button('帮助','complete-go','data-page="help"')}</nav><div class="all-scene-spots">${button('点将册','complete-go','data-page="agents" class="scene-roster"')}${button('忠义堂公议','complete-go','data-page="public" class="scene-public"')}${button('悬赏榜','complete-go','data-page="tasks" class="scene-board"')}${button('典籍阁','complete-go','data-page="library" class="scene-library"')}</div><p class="all-scene-note">静态实景与入口演示 · 不运行游戏、坐标或联网好汉</p></section>`;}
 if(page==='workspace'){
  const input=$('.treasure-search input');if(input){input.value=state.workspaceQuery||'';input.setAttribute('aria-label','搜索文件名称');}
  const upload=$('.treasure-primary');if(upload)upload.dataset.action='complete-upload-panel';
  const form=$('.treasure-search');if(form)form.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();state.workspaceQuery=$('input',form).value;render();});
 }
 const note=$('.baseline-provenance');if(note)note.textContent='四阶段办事 · 2026-10-17 · 离线示例';
}
function handleAllPageAction(action,t){
 if(action==='complete-file-version-submit'){saveFileVersion(t);return true;}
 if(action==='complete-pdf-page'){const a=asset(t.dataset.id),n=Number(t.dataset.page);if(!a||n<1||n>a.pages)return true;state.pdfPages||={};state.pdfPages[a.id]=n;const root=t.closest('.pdf-document'),wrapper=document.createElement('div');wrapper.innerHTML=pdfPreview(a);const region=wrapper.firstElementChild;root.replaceWith(region);const next=[...region.querySelectorAll('button')].find(e=>e.textContent===t.textContent&&!e.disabled)||region.querySelector('button:not(:disabled)');next?.focus();persist();return true;}
 if(action==='complete-catalog-profile'){dialog(t.dataset.name+' · 本领示例',`<p>${esc(t.dataset.ability)}</p><p>离线布局示例，不表示当前账号已拥有、安装或授权此Agent。</p>`,button('返回名册','close-dialog'));return true;}

 if(action==='complete-workspace-stale-demo'){dialog('确认信息已过期','<p>文件或关联情况已变化，请查看更新后的信息再确认。</p><p>旧确认已失效；本次没有回收文件。</p>',button('返回文件管理','close-dialog'));return true;}
 if(action==='complete-workspace-unknown-demo'){dialog('待确认的资料操作','<p>文件管理操作：提交结果尚未确认，请重试原操作核对结果，勿重复新建。</p><p>恢复标识仅保留在当前页面，刷新或关闭页面后无法在此继续重试。</p><p>离线交互示例，不发送请求、不持久化操作标识。</p>',button('重试原操作','complete-workspace-original-retry'));return true;}
 if(action==='complete-workspace-original-retry'){t.closest('dialog').close();feedback('原操作已提交，已读取当前文件状态。（离线示例；未创建新操作）');return true;}

 if(action.startsWith('complete-workspace-')&&['complete-workspace-history-demo','complete-workspace-history-more','complete-workspace-partial-demo','complete-workspace-detail-demo','complete-workspace-detail-retry'].includes(action)){const id=state.fileId||'ref-brief',meta=state.fileMeta[id]||(state.fileMeta[id]={});if(action==='complete-workspace-history-demo'){meta.demoHistory=true;meta.demoHistoryLoaded=false;meta.demoVersion='102';}if(action==='complete-workspace-history-more')meta.demoHistoryLoaded=true;if(action==='complete-workspace-partial-demo')meta.demoPartial=!meta.demoPartial;if(action==='complete-workspace-detail-demo')meta.demoDetailError=true;if(action==='complete-workspace-detail-retry'){meta.demoDetailError=false;feedback('已重新读取详情（离线示例），未再次上传。');}render();return true;}

 if(action==='complete-open-matter'){openListedMatter(t.dataset.matterKey);return true;}
 if(action==='complete-agent-filter'){state.agentFilter=t.dataset.filter;renderAgents();persist();return true;}
 if(action==='complete-file-manage'){state.fileManage=!state.fileManage;render();return true;}
 if(action==='complete-help-step'){state.helpStep=Number(t.dataset.step);render();return true;}
 if(action==='complete-reader-notes'){state.reader.notesOpen=!state.reader.notesOpen;render();return true;}
 if(action==='complete-reader-save'){state.reader.notes=$('[aria-label="手札草稿"]').value;persist();feedback('手札已保存在本原型，不上传。');$('.reader-note-status').textContent='手札已保存（本地示例）';return true;}
 if(action==='complete-reader-cite'){state.draft=[state.draft,'请根据典籍第'+state.reader.chapter+'回的阅读示例，整理要点与待办。'].filter(Boolean).join('\n');go('create');return true;}
 if(action==='complete-upload-panel'){dialog('上传资料',`<p>上传本身不交办，也不会把资料发给好汉。本原型仅保存在当前标签页。</p><label>选择资料<input type="file" data-workspace-upload aria-label="选择本地资料"></label><label>显示名称（可选）<input data-upload-name aria-label="显示名称" placeholder="留空使用文件名称"></label><p data-upload-status role="status">尚未选择文件</p>`,button('取消','close-dialog')+button('保存到原型资料','complete-upload-confirm','disabled class="mmd-primary"'));return true;}
 if(action==='complete-upload-confirm'){const input=$('[data-workspace-upload]'),f=input?.files?.[0];if(!f)return true;const name=$('[data-upload-name]').value.trim()||f.name;t.disabled=true;const reader=new FileReader();reader.onload=()=>{const type=f.type.startsWith('image/')?'image':f.type.startsWith('audio/')?'audio':/text|json/.test(f.type)?'text':'document';state.localFiles.push({id:'local-'+(++serial),name,type,url:reader.result,note:'本机资料 · 未上传',text:type==='text'?'本地文件可下载查看。':''});$('dialog[open]')?.close();persist();render();feedback('已存入原型资料，没有上传或交办。');};reader.onerror=()=>{t.disabled=false;$('[data-upload-status]').textContent='读取失败，请重新选择文件。';};reader.readAsDataURL(f);return true;}
 return false;
}
document.addEventListener('change',e=>{if(e.target.matches('[data-library-source]')){state.librarySource=e.target.value;persist();}if(e.target.matches('[data-workspace-upload]')){const f=e.target.files?.[0];$('[data-action=complete-upload-confirm]').disabled=!f;$('[data-upload-status]').textContent=f?f.name:'尚未选择文件';}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('dialog[open]')&&!['chat','private'].includes(page)){const back=$('.production-page-header [data-action=complete-page-back]');if(back){e.preventDefault();back.click();}}});

document.addEventListener('change',e=>{if(e.target.matches('[data-complete-task-ability]')){state.taskAbility=e.target.value;applyTaskFilters();persist();}});
document.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('.task-card[data-matter-key]')){e.preventDefault();openListedMatter(e.target.dataset.matterKey);}});

document.addEventListener('change',e=>{if(e.target.matches('[data-workspace-version]')){const id=state.fileId||'ref-brief',meta=state.fileMeta[id]||(state.fileMeta[id]={});meta.demoVersion=e.target.value;render();}});

// Update only the counter while typing; never rerender or move the input focus.
document.addEventListener('input',event=>{if(event.target.matches('.composer-textarea')){const count=document.querySelector('[data-draft-count]');if(count)count.textContent=event.target.value.length+'/1200';}});

// Page-recheck corrections: local fixtures only; no API, execution or authorization inference.
function matchesMatterFilter(ctx,filter){
 const historical=!!(ctx.task.archived||ctx.task.cancelled||ctx.task.phase==='失败');
 return filter==='异常/历史'?(state.secondaryMatterFilter==='unknown'?ctx.task.phase==='待核对':historical):!filter||(!ctx.task.archived&&listedMatterStatus(ctx)===filter);
}
function renderTaskSkills(panel){
 $('.task-skill-strip',panel)?.remove();if(page!=='chat'||!state.task)return;
 const skills=state.task.demoSkills||[],toolbar=$('.panel-toolbar',panel);
 toolbar?.insertAdjacentHTML('afterend',`<details class="task-skill-strip"><summary>本任务可调用技能（${skills.length}）</summary><p>${skills.length?skills.map(esc).join('、'):'暂无可调用技能。'} · 离线展示，不代表已获执行授权。</p></details>`);
}
function pdfPreview(a){
 const n=state.pdfPages?.[a.id]||1;
 return `<div class="pdf-document" data-pdf-id="${esc(a.id)}"><article class="pdf-text-page" aria-label="PDF第${n}页"><h4>Observation Guide — Page ${n}</h4><p>${esc(a.parts[n-1])}</p><small>Offline prototype fixture. No production content.</small></article><div class="pdf-pagination" role="group" aria-label="PDF分页">${button('上一页','complete-pdf-page',`data-id="${esc(a.id)}" data-page="${n-1}" ${n===1?'disabled':''}`)}<span role="status">第 ${n} / ${a.pages} 页</span>${button('下一页','complete-pdf-page',`data-id="${esc(a.id)}" data-page="${n+1}" ${n===a.pages?'disabled':''}`)}</div><small>PDF分页 · 浏览器本地查看目标；正文读取交给Agent的PDF技能。此处为离线页面示例，不代表真实解析。</small></div>`;
}
async function saveFileVersion(buttonElement){
 const input=$('[data-file-new-version]'),f=input?.files?.[0],fileId=state.fileId||'ref-brief';if(!f)return;
 const status=$('[data-version-status]'),meta=state.fileMeta[fileId]||={};
 if($('[data-version-fail]')?.checked){status.textContent='保存失败（离线示例），已选文件保留，旧版本与事项引用未改变。';return;}
 buttonElement.disabled=true;status.textContent='正在读取本机文件，不上传…';
 try{
  const text=/text|json/.test(f.type)||/\.(txt|md|csv)$/i.test(f.name)?await f.text():'';
  const url=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);});
  const version=(meta.versions?.length||0)+2,id='local-version-'+(++serial);
  const type=f.type.startsWith('image/')?'image':f.type.startsWith('audio/')?'audio':text?'text':'document';
  const next={id,name:f.name,type,url,text:text||'本格式可下载查看；不模拟未知格式解析。',version,note:'文件新版本 · 仅存于本原型'};
  const oldMeta=structuredClone(meta);state.localFiles.push(next);meta.versions||=[];meta.versions.push({id,version});meta.demoVersion=String(version);meta.versionStatus='已保存本地 v'+version+'；原事项引用仍固定旧版本。';
  if(!persist()){state.localFiles.pop();state.fileMeta[fileId]=oldMeta;throw Error('storage');}
  if(page==='file'&&(state.fileId||'ref-brief')===fileId){state.fileManage=false;render();}feedback('新版本已保存在原型，未上传。');
 }catch{if(status.isConnected)status.textContent='未保存，请重试；已选文件和旧版本保留。';if(buttonElement.isConnected)buttonElement.disabled=false;}
}
document.addEventListener('change',e=>{if(e.target.matches('[data-file-new-version]')){const f=e.target.files?.[0];$('[data-action=complete-file-version-submit]').disabled=!f;$('[data-version-status]').textContent=f?'已选择 '+f.name+'，尚未保存。':'尚未选择新文件。';}});


// Offline reply controls. Cancel only the current reply, never the task or its artifacts.
// reply-stop-delta-race exercises the same stop control while output advances; no second write.
function replyDemoDelay(){return selectedScenario.startsWith('reply-stop')?12000:650;}
function beginReplyControl(ctx){ctx.replyStop=null;ctx.replyEpoch=(ctx.replyEpoch||0)+1;return ctx.replyEpoch;}
function renderReplyControl(panel,ctx){
 const send=$('.composer-send',panel);if(!send)return;
 const stop=ctx.replyStop;
 const mode=ctx.pending?(stop?.stage==='unknown'?'check':stop?.stage==='submitting'?'submitting':'stop'):'send';
 send.dataset.replyControl=mode;send.type=mode==='send'?'submit':'button';
 if(mode!=='send'){
  const label=mode==='check'?'核对停止结果':mode==='submitting'?'正在停止本轮回复':'停止本轮回复';
  send.title=label;send.setAttribute('aria-label',label);send.disabled=mode==='submitting';
  send.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';
 }
 send.classList.toggle('reply-stop-control',mode!=='send');
 $('.reply-control-status',panel)?.remove();
 if(stop?.text){const note=document.createElement('p');note.className='reply-control-status';note.setAttribute('role',stop.stage==='failed'?'alert':'status');note.textContent=stop.text;$('.composer-submit',panel).append(note);}
}
function stopReplyDemo(ctx){
 if(!ctx.pending||ctx.replyStop?.stage==='submitting')return;
 const epoch=ctx.replyEpoch||0;
 if(ctx.replyStop?.stage==='unknown'){
  ctx.replyStop.checks=(ctx.replyStop.checks||0)+1;
  ctx.replyStop.text='停止结果尚未确认，请稍后再次核对。不会重复提交，也不会自动重发消息。（离线示例）';
  persist();renderChat();return;
 }
 const attempt=(ctx.replyStop?.writes||0)+1;
 ctx.replyStop={stage:'submitting',writes:attempt,text:'正在停止本轮回复…'};persist();renderChat();
 setTimeout(()=>{
  if((ctx.replyEpoch||0)!==epoch||!ctx.pending)return;
  if(selectedScenario==='reply-stop-failed'&&attempt===1){ctx.replyStop.stage='failed';ctx.replyStop.text='停止失败，本轮仍在等待回复。可点击停止按钮重试。（离线示例）';}
  else if(selectedScenario==='reply-stop-unknown'){
   // Invalidate only the demo output timer; unknown is NOT cancellation success.
   ctx.replyEpoch=epoch+1;ctx.replyStop.stage='unknown';ctx.replyStop.text='停止结果尚未确认。请点击原按钮核对结果，不重复提交。（离线示例）';
  }else{
   ctx.replyEpoch=epoch+1;ctx.pending=false;ctx.pendingReason=null;ctx.error=null;
   const finished=selectedScenario==='reply-stop-finished';
   ctx.replyStop.stage=finished?'finished':'stopped';
   if(!finished)ctx.messages.filter(m=>m.streaming).forEach(m=>{m.streaming=false;m.statusText='已停止（未完成）';});
   ctx.replyStop.text=finished?'本轮已完成，无需停止。（离线竞态示例）':'本轮回复已停止，可以继续发送消息。（离线示例）';
   if(finished)ctx.messages.push({role:'AGENT',text:'回复已在停止确认前完成，保留这条已完成回复。（离线示例）'});
   if(ctx.task?.unified)ctx.task.phase=ctx.delivery.length?'已有结果':'待你补充';
  }
  persist();if(conversation()===ctx&&['chat','private','public'].includes(page)){renderChat();$('.composer-send')?.focus();if(!ctx.pending)$('.composer-textarea')?.focus();}
 },500);
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-reply-control]');if(!b||b.dataset.replyControl==='send')return;e.preventDefault();e.stopImmediatePropagation();stopReplyDemo(conversation());},true);

function settleReplyControl(ctx){if(ctx.replyStop)ctx.replyStop={stage:'finished',text:'本轮已完成，无需停止。',writes:ctx.replyStop.writes};}
document.addEventListener('input',e=>{if(e.target.matches('.composer-textarea')&&conversation().pending)queueMicrotask(()=>renderReplyControl($('.chat-panel'),conversation()));});

// Exact media basis choice: context only, never submission/acceptance.
function renderMediaBasis(){
 $$('.media-basis-choice,.submission-demo').forEach(e=>e.remove());
 if(page!=='chat')return;
 const scenario=new URLSearchParams(location.search).get('scenario');
 const notices={'submission-pending':'正在核对提交结果，请勿重复提交。','submission-completed':'成果已提交，请查看并验收。','submission-failed':'成果提交未完成，原答复和文件已保留；可在原议事继续说明。'};
 if(notices[scenario]){$('.hall-messages')?.insertAdjacentHTML('beforeend','<article class="submission-demo"><strong>提交已有成果</strong><p>提交已生成的成果，不重新生成，也不自动验收。</p><small role="status">'+notices[scenario]+'</small></article>');return;}
 if(scenario!=='media-basis')return;
 const form=$('.composer-submit');if(!form)return;
 const label=document.createElement('label');label.className='media-basis-choice';
 label.innerHTML='<span>本轮成果</span><select aria-label="本轮成果"><option value="">请选择要继续议事的成果</option><option value="batch-a">消息 101 · 第一版修改后的图片</option><option value="batch-b">消息 103 · 第二版修改后的图片</option></select>';
 label.querySelector('select').value=state.mediaBasisChoice||'';
 label.querySelector('select').addEventListener('change',e=>{state.mediaBasisChoice=e.target.value;});
 const toolbar=$('.panel-toolbar');if(toolbar)toolbar.after(label);else form.before(label);
};
document.addEventListener('submit',e=>{
 if(e.target.matches('.composer-submit')&&page==='chat'&&new URLSearchParams(location.search).get('scenario')==='media-basis'&&!state.mediaBasisChoice){e.preventDefault();e.stopImmediatePropagation();feedback('存在多份独立成果，请先选择本轮成果。');}
},true);


// Completed matters share one read-only detail/results surface; no new write protocol.
function renderCompletedMatterDetail(){
 const card=$('.matter-advice-card');if(!card)return;renderMatterOverview(card,false);
 $('.matter-state-guidance',card).textContent='事项已完成，可查看已验收成果和历史议事；不能继续修改或重复验收。';
 $('.matter-primary-actions',card).innerHTML=button('查看议事记录','complete-go','data-page="chat"')+(state.task.archived?'<p class="mmd-muted">已收入个人案卷</p>':button('收入案卷','complete-record-archive'));
 const materials=$('.task-material-links');if(materials)materials.innerHTML=`<div class="mmd"><h4>事项资料</h4>${files(state.task.files||[],'task',false)}<p class="mmd-muted">已验收 ${state.final.length} 份成果，成果与其他历史版本在下方统一查看。</p></div>`;
 const b=$('.matter-results-action');if(b){b.hidden=false;b.textContent='查看成果与验收记录';b.dataset.action='accept';b.dataset.mainAction='true';}
 $$('.baseline-cancellation,.matter-acceptance-strip').forEach(e=>e.remove());
}
function renderCompletedMatterResults(root){
 const finalIds=new Set(state.final),accepted=state.outputs.filter(a=>finalIds.has(a.id)),history=state.outputs.filter(a=>!finalIds.has(a.id));
 const mode=state.completedReadState||'ready';
 labels.results='成果与验收记录';document.title='成果与验收记录 · 离线原型';
 const title=$('#juyiting-floating-panel-title');if(title)title.textContent='成果与验收记录';
 const row=(a,i,final)=>`<article class="completed-result"><div class="completed-result-heading"><div><strong>${esc(a.name)}</strong><p class="mmd-muted">${final?'已验收成果':'其他历史成果'} ${i+1} · 版本 ${esc(a.version||1)}</p></div>${button(state.completedPreview===a.id?'收起预览':'预览','complete-record-preview',`data-id="${esc(a.id)}" aria-expanded="${state.completedPreview===a.id}" aria-controls="preview-${esc(a.id)}"`)}</div>${state.completedPreview===a.id?`<section id="preview-${esc(a.id)}" class="completed-inline-preview" aria-label="${esc(a.name)}预览"><p>正在预览：${esc(a.name)} · 版本 ${esc(a.version||1)}</p>${media(a,true)}</section>`:''}</article>`;
 root.classList.add('completed-records');
 root.innerHTML=`<header><h2>成果与验收记录</h2><p class="completed-readonly">已完成 · 只读</p><p>${esc(taskTitle())}</p><p class="mmd-muted">已验收的版本固定保留。其他历史成果不代表已验收。</p></header>${['error','empty'].includes(mode)?`<div class="completed-record-tools">${button(mode==='error'?'重试':'重新核对','complete-record-reload')}</div>`:''}${mode==='loading'?'<p role="status">正在读取成果与验收记录…</p>':mode==='error'?'<p role="alert">成果与验收记录读取失败，请重新读取；不会重新提交验收。</p>':mode==='empty'?'<p role="status">尚未读取到验收成果记录，不能仅凭“已完成”推断哪些版本已验收。请重新读取或查看历史议事。</p>':`<section><h3>已验收成果 <small>（${accepted.length}）</small></h3>${accepted.length?accepted.map((a,i)=>row(a,i,true)).join(''):'<p>验收成果关联待核对，不将其他成果推定为已验收。</p>'}</section><details class="completed-history" ${history.some(a=>a.id===state.completedPreview)?'open':''}><summary>其他历史成果（${history.length}）</summary><p class="mmd-muted">仅供查阅，不属于上方已验收的固定版本。</p>${history.length?history.map((a,i)=>row(a,i,false)).join(''):'<p>没有其他历史成果。</p>'}</details><details class="completed-receipt"><summary>验收记录</summary><p>验收状态：已通过</p><p>本次确认：${accepted.length} 份固定成果</p><p class="mmd-muted">离线示例；正式页面只展示服务端实际返回的时间、操作者与版本，不猜测缺失字段。</p></details>`}${selectedScenario==='completed-review'?`<details class="completed-demo"><summary>演示读取状态（仅原型）</summary><div class="completed-record-tools">${[['ready','正常'],['loading','加载中'],['error','读取失败'],['empty','记录缺失']].map(([key,label])=>button(label,'complete-record-state',`data-state="${key}" aria-pressed="${mode===key}"`)).join('')}</div></details>`:''}`;
}
