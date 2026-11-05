'use strict';
// Offline matters-list paging; no API or task writes.
(() => {
  const original = render;
  let observer;
  let generation = 0;
  render = function () {
    observer?.disconnect();
    const current = ++generation;
    original();
    if (page !== 'tasks') return;
    const list = $('.task-list');
    if (!list) return;
    const seed = [...list.querySelectorAll('.task-card')];
    if (!seed.length) return;
    const footer = document.createElement('p');
    footer.setAttribute('role', 'status');
    footer.className = 'task-pagination-status';
    footer.style.cssText = 'padding:16px;text-align:center;color:var(--hall-text-muted,#68716b)';
    footer.textContent = '向下滚动自动加载（离线示例）';
    list.append(footer);
    let batch = 0;
    observer = new IntersectionObserver(async entries => {
      if (!entries.some(entry => entry.isIntersecting) || batch >= 3) return;
      observer.unobserve(footer);
      footer.textContent = '正在加载更多事项…';
      await new Promise(resolve => setTimeout(resolve, 250));
      if (current !== generation) return;
      batch += 1;
      seed.forEach(row => {
        const clone = row.cloneNode(true);
        clone.style.pointerEvents = 'none';
        const title = clone.querySelector('strong');
        if (title) title.textContent = `分页示例 ${batch} · ${title.textContent}`;
        footer.before(clone);
      });
      footer.textContent = batch === 3 ? '已显示全部事项（离线示例）' : '向下滚动自动加载（离线示例）';
      if (batch < 3) observer.observe(footer);
    }, { rootMargin: '0px 0px 120px 0px' });
    observer.observe(footer);
  };
  if (page === 'tasks') render();
})();
