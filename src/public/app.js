// JS do painel. Sem inline script (CSP: script-src 'self').
(function () {
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';

  // menu mobile
  document.querySelector('[data-nav-toggle]')?.addEventListener('click', () => {
    document.querySelector('[data-sidebar]')?.classList.toggle('open');
  });

  // tema: escuro (padrão) ou claro; a escolha fica só neste navegador
  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('pulso-theme', next); } catch { /* storage bloqueado */ }
  });

  // confirmação antes de ações destrutivas: <form data-confirm="...">
  document.addEventListener('submit', (e) => {
    const msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // copiar: <button data-copy="texto">
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = btn.getAttribute('data-copy');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const tmp = document.createElement('textarea');
      tmp.value = text; document.body.appendChild(tmp); tmp.select(); document.execCommand('copy'); tmp.remove();
    }
    const old = btn.textContent;
    btn.textContent = 'Copiado';
    setTimeout(() => { btn.textContent = old; }, 1600);
  });

  document.querySelectorAll('[data-select-on-focus]').forEach((el) => el.addEventListener('focus', () => el.select()));

  // quadro: arrastar convidado entre etapas
  const board = document.querySelector('[data-board]');
  if (board && board.dataset.canMove === '1') {
    let dragging = null;
    const refreshCounts = () => board.querySelectorAll('.column').forEach((col) => {
      col.querySelector('.count').textContent = col.querySelectorAll('.kcard').length;
    });

    board.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.kcard');
      if (!card) return;
      dragging = card;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.guestId);
    });
    board.addEventListener('dragend', () => {
      dragging?.classList.remove('dragging');
      board.querySelectorAll('.column.over').forEach((c) => c.classList.remove('over'));
      dragging = null;
    });
    board.addEventListener('dragover', (e) => {
      const col = e.target.closest('.column');
      if (!col || !dragging) return;
      e.preventDefault();
      board.querySelectorAll('.column.over').forEach((c) => c !== col && c.classList.remove('over'));
      col.classList.add('over');
    });
    board.addEventListener('drop', async (e) => {
      const col = e.target.closest('.column');
      if (!col || !dragging) return;
      e.preventDefault();
      col.classList.remove('over');
      const zone = col.querySelector('[data-dropzone]');
      const from = dragging.closest('[data-dropzone]');
      if (from === zone) return;
      const card = dragging;
      zone.prepend(card); // otimista
      refreshCounts();
      try {
        const res = await fetch(`/convidados/${card.dataset.guestId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'x-csrf-token': csrf },
          body: new URLSearchParams({ status: col.dataset.status }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        from.prepend(card); // desfaz
        refreshCounts();
        window.alert('Não foi possível mover o convidado. Tente de novo.');
      }
    });
  }
})();
