'use strict';
// Offline prototype presentation only: never changes action IDs, authorization or business state.
(() => {
 const groups = {
  light: {
   'ability-edit-open':'edit','skill-open':'settings','refresh-agent-profile':'refresh','ui-rename':'edit',
   materials:'attach','composer-materials':'attach','ui-materials':'attach','preview':'eye','download':'download',
   'complete-task-refresh':'refresh','complete-task-clear':'close','complete-file':'eye','complete-file-manage':'more',
   'complete-rename':'edit','complete-library-search':'search','complete-toc':'list','complete-reader-notes':'note',
   'complete-bookmarks':'bookmark','complete-reader-cite':'quote','complete-case-draft':'quote',
   'complete-catalog-profile':'user','complete-runtime-open':'link','complete-runtime-hosted':'home',
   'complete-runtime-import':'upload','complete-runtime-query':'refresh','complete-history-more':'chevronDown',
   'complete-workspace-history-more':'history','complete-workspace-detail-retry':'refresh','complete-workspace-original-retry':'refresh',
   'complete-history-reload':'refresh','complete-operation-status':'refresh','complete-operation-open':'refresh',
   'complete-reply-status':'refresh','turn-check':'refresh','turn-play':'play','delivery-reset':'refresh',
   'skill-view':'info','skill-reconcile':'refresh','skill-quote':'info','skill-resume':'refresh',
   'voice-settings':'settings','ui-settings':'settings','complete-index':'grid','complete-entries':'grid',
   'complete-bookmark-save':'plus','save-text':'note','complete-record-archive':'folder',
   'picker-back-list':'back','picker-preview':'eye','picker-remove':'close','unquote':'close'
  },
  tool: {
   'complete-refresh':'refresh','ui-refresh':'refresh','complete-history':'history','ui-history':'history',
   'complete-new':'plus','ui-new':'plus','composer-more':'plus','complete-materials':'attach',
   'complete-voice':'mic','ui-voice':'mic','close-dialog':'close','complete-runtime-close':'close',
   'complete-delete-current':'trash','complete-delete-history':'trash'
  },
  commit: {
   'complete-draft-save':'save','complete-draft-next':'send','complete-agent-confirm':'check',
   'complete-upload-panel':'upload','complete-upload-confirm':'upload','complete-file-version-submit':'upload',
   'complete-reader-save':'save','complete-notes-save':'save','complete-rename-save':'save',
   'voice-settings-save':'save','complete-acceptance-review':'acceptance','complete-acceptance-record':'acceptance',
   'complete-runtime-register':'check','complete-record-archive-confirm':'folder',
   'skill-select':'plus','skill-upgrade':'upload','skill-install-confirm':'check','skill-confirm':'check',
   'skill-uninstall-retry':'refresh','delivery-open':'acceptance','finish':'check',
   'private-chat':'chat','assign':'check','complete-use-file':'quote',
   'confirm-materials':'check','picker-stage':'plus','complete-new-confirm':'plus'
  },
  danger: {
   'complete-delete-confirm':'trash','complete-recycle-confirm':'trash','skill-uninstall':'trash',
   'skill-uninstall-confirm':'trash','turn-abandon':'stop','turn-abandon-confirm':'stop','complete-cancel-confirm':'close'
  }
 };
 // Only reviewed, familiar pictograms lose their visible labels. Contextual/critical actions keep words.
 const iconOnlyActions = new Set([
  'ability-edit-open','skill-open','refresh-agent-profile','ui-rename','materials','composer-materials','ui-materials',
  'preview','download','complete-task-refresh','complete-task-clear','complete-file','complete-file-manage',
  'complete-rename','complete-library-search','complete-toc','complete-reader-notes','complete-bookmarks',
  'voice-settings','ui-settings','picker-back-list','picker-remove','unquote','remove',
  'complete-chapter','complete-pdf-page','complete-upload-panel','complete-recycle','ui-recycle'
 ]);
 const filters = new Set(['complete-production-status','complete-secondary-status','complete-overview-tab',
  'complete-agent-filter','complete-workspace-filter','complete-library-tab','complete-runtime-mode','commission-filter','delivery-mode']);
 const destinations = {home:'home',tasks:'list',workspace:'folder',mine:'user',agents:'users',catalog:'users',
  library:'book',reader:'book',messages:'bell',map:'map',help:'help',account:'user',chat:'chat',detail:'eye',results:'acceptance',public:'chat',create:'plus',login:'shield'};
 function recipe(b) {
  const action=b.dataset.action||'';
  if(b.closest('.login-scene')||b.matches('[role="switch"],.material-item,.material-row,.recommendation-options button,.history-item,.composer-file-name'))return null;
  if(b.classList.contains('workbench-brand'))return null;
  if(b.classList.contains('workbench-create-action'))return ['commit','plus'];
  if(b.matches('.treasure-search button'))return ['light','search'];
  if(b.hasAttribute('data-workbench-tab'))return ['nav',destinations[b.dataset.prototypePage]||'home'];
  if(b.closest('.hall-workbench-sidebar,.workbench-topbar'))return null;
  if(filters.has(action)||b.getAttribute('role')==='tab')return ['filter',null];
  if(action==='picker-toggle-selected')return ['light',b.getAttribute('aria-expanded')==='true'||b.textContent.trim()==='收起'?'chevronUp':'chevronDown'];
  if(action==='picker-preview'&&b.classList.contains('material-back'))return ['back','back'];
  if(action==='complete-file'&&b.closest('.treasure-file-row'))return ['link','chevronRight'];
  if(action==='complete-file-manage')return ['light',state.fileManage?'back':'more'];
  if(action==='complete-recycle'||action==='ui-recycle')return b.textContent.trim()==='恢复'?['light','restore']:['danger','trash'];
  if(action==='complete-chapter'||action==='complete-pdf-page')return ['light',b.textContent.includes('上一')?'chevronLeft':b.textContent.includes('下一')?'chevronRight':null];
  if(action==='complete-help-step')return ['commit',Number(b.dataset.step)<Number(state.helpStep||0)?'chevronLeft':'chevronRight'];
  if(action==='skill-back')return ['light',b.textContent.trim()==='收起'?'chevronUp':b.textContent.trim()==='完成'?'check':'back'];
  if(action==='complete-page-back'||action==='agent-roster-back')return ['back','back'];
  if(action==='close-dialog'&&b.textContent.trim()&&!b.classList.contains('ui-close'))return ['back',b.textContent.includes('返回')?'back':null];
  if(action==='remove')return b.dataset.context==='chat'?['tool','close']:['light','close'];
  const target=b.dataset.page||b.dataset.prototypePage;
  if(b.closest('.mine-grid,.all-account-options'))return ['card',destinations[target]||'lock'];
  if(b.closest('.all-scene'))return ['scene',destinations[target]||'map'];
  if(['complete-go','ui-go','go-agents','go-create','continue-chat','complete-acceptance-modify','complete-operation-detail','complete-open-matter'].includes(action)||target){
   if(b.closest('.mmd-more-menu'))return ['menu',destinations[target]||'chevronRight'];
   return ['link',target==='chat'||action==='continue-chat'||action==='complete-acceptance-modify'?'chat':target==='reader'?'book':'chevronRight'];
  }
  for(const [kind,actions] of Object.entries(groups))if(actions[action])return [kind,actions[action]];
  // Snapshot form submitters retain their existing primary hierarchy.
  if(b.matches('.overview-quick-request button.primary,.composer-send'))return ['commit',b.classList.contains('composer-send')?null:'send'];
  return null;
 }
 function icon(name) {const holder=document.createElement('span');holder.innerHTML=uiIcon(name);const svg=holder.firstElementChild;svg.classList.add('semantic-glyph');return svg;}
 function decorateButton(b) {
  if(b.classList.contains('reader-icon-button'))return; // Reader command icons are explicitly named by renderReader.
  const result=recipe(b);if(!result)return;
  let [kind,glyph]=result;
  // A standalone link needs its words; an in-row detail link already has a title beside it.
  const row=kind==='link'?b.closest('.overview-item,.treasure-file-row'):null;
  // Business actions communicate through their explicit words, not decorative pictograms.
  // Keep real tool buttons (including composer send/upload entry) and stateful disclosures.
  const discussionPreview=b.dataset.action==='preview'&&!!b.closest('.delivery-entry-actions');
  const toolAction=!discussionPreview&&(iconOnlyActions.has(b.dataset.action)||b.matches('.composer-send,.treasure-search button'));
  const disclosure=b.dataset.action==='picker-toggle-selected'||b.dataset.action==='skill-back'&&['back','chevronUp','chevronDown'].includes(glyph);
  const businessAction=!toolAction&&(kind==='commit'||kind==='danger'||kind==='light'&&!disclosure);
  const textOnly=!row&&(
   businessAction||kind==='link'&&!!b.textContent.trim()||
   b.matches('.overview-quick-request button.primary')||b.dataset.action==='complete-draft-next'||
   b.dataset.action==='complete-help-step'||
   b.dataset.action==='complete-page-back'&&b.closest('.dialog-actions')&&!b.classList.contains('panel-return')
  );
  b.classList.toggle('semantic-text-only',!!textOnly);
  b.classList.toggle('semantic-row-link',!!row);
  if(row)glyph='chevronRight';
  if(textOnly){
   glyph=null;
   b.querySelectorAll('svg,.var-icon').forEach(n=>n.remove());
   const walker=document.createTreeWalker(b,NodeFilter.SHOW_TEXT);
   while(walker.nextNode())walker.currentNode.textContent=walker.currentNode.textContent.replace(/^\s*[←→›>]\s*|\s*[←→›>]\s*$/g,'');
  }
  if(row){
   b.dataset.semanticBaseLabel ||= row.matches('.treasure-file-row')?'查看资料':b.getAttribute('aria-label')||b.textContent.trim();
   const title=row.querySelector('.overview-item-copy strong,strong,h3,h4')?.textContent.trim();
   b.setAttribute('aria-label',b.dataset.semanticBaseLabel+(title?'：'+title:''));
  }
  if(kind==='back')for(const n of b.childNodes)if(n.nodeType===Node.TEXT_NODE)n.textContent=n.textContent.replace(/^\s*←\s*/,'');
  if(b.dataset.action==='complete-runtime-mode')b.setAttribute('aria-pressed',String(b.dataset.mode===state.runtimeDemo?.mode));
  const old=b.dataset.semanticKind;
  if(old!==kind){if(old)b.classList.remove('semantic-'+old);b.dataset.semanticKind=kind;}
  b.classList.add('semantic-control','semantic-'+kind);
  // Preserve the already approved Agent detail lightweight controls.
  if(kind==='light')b.classList.add('semantic-action');else b.classList.remove('semantic-action');
  if(glyph){
   const existing=b.querySelector('.semantic-glyph');
   if(existing&&existing.dataset.icon!==glyph)existing.replaceWith(icon(glyph));
   if(!b.querySelector('svg')){b.querySelector(':scope>.var-icon')?.remove();if(kind==='link'&&glyph==='chevronRight')b.append(icon(glyph));else b.prepend(icon(glyph));}
   const own=b.querySelector('.semantic-glyph');if(own)own.dataset.icon=glyph;
  }
  const iconOnly=!textOnly&&!!b.querySelector('svg')&&(!!row||kind==='tool'||kind==='back'&&!!glyph||iconOnlyActions.has(b.dataset.action)||b.matches('.treasure-search button'));
  if(iconOnly){
   const name=b.getAttribute('aria-label')||b.getAttribute('title')||b.textContent.trim();
   if(name&&!b.getAttribute('aria-label'))b.setAttribute('aria-label',name);
   if(name)b.title=name;
   b.classList.add('semantic-icon-only');
   // Retain textContent for existing handlers; only the visual label is hidden.
   // SVG stays outside the hidden span; no innerHTML replacement or listener rebinding.
   let label=b.querySelector(':scope>.semantic-control-label');
   const content=[...b.childNodes].filter(n=>n!==label&&!(n.nodeType===Node.ELEMENT_NODE&&n.tagName.toLowerCase()==='svg'));
   if(content.length){
    if(!label){label=document.createElement('span');label.className='semantic-control-label';b.append(label);}
    content.forEach(n=>label.append(n));
   }
  }else if(b.classList.contains('semantic-icon-only')){
   b.classList.remove('semantic-icon-only');
   const label=b.querySelector(':scope>.semantic-control-label');
   if(label)label.replaceWith(...label.childNodes);
  }
 }
 let queued=false,passes=0;
 const options={childList:true,subtree:true,attributes:true,attributeFilter:['data-action','data-prototype-page','aria-pressed','aria-selected','aria-expanded','disabled']};
 const observer=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(apply);});
 function apply() {
  queued=false;observer.disconnect();
  try {
   document.querySelectorAll('button').forEach(decorateButton);
   document.querySelectorAll('input[type="checkbox"][data-voice-reply]').forEach(input=>{
    input.classList.add('semantic-switch-input');input.setAttribute('role','switch');
    input.setAttribute('aria-label','语音回答');input.closest('label')?.classList.add('semantic-setting');
   });
   document.querySelectorAll('details>summary').forEach(s=>s.classList.add('semantic-disclosure'));
   document.querySelectorAll('.task-status-tabs,.status-filter,.treasure-tabs,.overview-tabs,.commission-tabs,.library-tabs').forEach(s=>s.classList.add('semantic-filter-group'));
   passes++;
  } finally {observer.observe(document.body,options);}
 }
 // A single coalesced, presentation-only observer also covers late dialog/submenu renders.
 window.SemanticControls={refresh:apply,get passes(){return passes;}};
 window.addEventListener('pagehide',()=>observer.disconnect());
 window.addEventListener('pageshow',apply);
 apply();
})();
