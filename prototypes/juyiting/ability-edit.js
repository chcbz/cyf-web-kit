'use strict';
// Offline prototype: per-agent examples only; no API, runtime, or database writes.
(() => {
  state.abilityEditDemo ||= {};
  let editing = null;
  const baseRenderAgents = renderAgents;
  const canEdit = id => commissionAgents.some(agent => agent.id === id && agent.owner === commissionViewer);
  const viewFor = id => state.abilityEditDemo[id] || [];
  function paint() {
    const id = state.selectedAgent?.id;
    const section = $('.agent-profile-section[aria-label="本领"]');
    if (!section || !id) return;
    if (editing && editing.id !== id) editing = null;
    const mine = canEdit(id);
    const values = viewFor(id);
    const heading = $('.agent-skill-heading', section);
    const tags = $('.ability-tags', section);
    const note = $('.agent-profile-note', section);
    if (mine && heading) {
      $('small', heading)?.remove();
      if (!editing) heading.insertAdjacentHTML('beforeend', button('编辑', 'ability-edit-open', 'class="ability-edit-link" aria-label="编辑这位好汉的本领"'));
      if (tags) tags.innerHTML = values.length ? values.map(value => `<span>${esc(value)}</span>`).join('') : '<small>暂无能力介绍</small>';
      if (note) note.textContent = '由你维护的能力介绍，仅供参考，不代表已安装技能或运行就绪。';
    }
    if (mine && editing?.id === id) {
      tags?.remove(); note?.remove();
      section.insertAdjacentHTML('beforeend', `<div class="ability-editor"><label for="ability-edit-input">本领介绍</label><p>每行填写一项，例如：资料整理、方案撰写。留空表示暂不填写。</p><textarea id="ability-edit-input" rows="4" placeholder="每行填写一项本领">${esc(editing.draft)}</textarea><p class="ability-editor-note">仅维护这位好汉的能力介绍，不会安装技能或改变技能状态。</p><div class="ability-editor-actions">${button('取消', 'ability-edit-cancel')}${button('保存', 'ability-edit-save', 'class="ability-edit-save"')}</div></div>`);
    }
  }
  renderAgents = function (...args) { baseRenderAgents(...args); paint(); };
  document.addEventListener('input', event => {
    if (event.target.id === 'ability-edit-input' && editing) editing.draft = event.target.value;
  });
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action^="ability-edit-"]');
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const id = state.selectedAgent?.id;
    if (!id || !canEdit(id)) return;
    if (target.dataset.action === 'ability-edit-open') {
      editing = { id, draft: viewFor(id).join('\n') }; renderAgents(); $('#ability-edit-input')?.focus();
    } else if (target.dataset.action === 'ability-edit-cancel') {
      editing = null; renderAgents(); $('[data-action="ability-edit-open"]')?.focus();
    } else if (target.dataset.action === 'ability-edit-save' && editing?.id === id) {
      const before = state.abilityEditDemo[id];
      state.abilityEditDemo[id] = [...new Set(editing.draft.split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
      if (!persist()) { if (before === undefined) delete state.abilityEditDemo[id]; else state.abilityEditDemo[id] = before; feedback('原型保存失败，请重试。'); return; }
      editing = null; renderAgents(); $('[data-action="ability-edit-open"]')?.focus(); feedback('已保存本领介绍（仅原型示例）');
    }
  }, true);
  if (page === 'agents') renderAgents();
})();
