// Reações com emoji nos comentários. Vale também para o comentário da revisão que entra sem recarregar a página, por isso escuta no documento.
(function () {
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  const closeAll = (except) => document.querySelectorAll('[data-react-pop]:not([hidden])').forEach((pop) => {
    if (pop === except) return;
    pop.hidden = true;
    pop.parentElement.querySelector('[data-react-open]')?.setAttribute('aria-expanded', 'false');
  });

  async function send(box, emoji) {
    if (box.dataset.busy) return;
    box.dataset.busy = '1';
    try {
      const res = await fetch('/reacoes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, Accept: 'application/json' },
        body: JSON.stringify({ tipo: box.dataset.kind, id: box.dataset.id, emoji }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { window.alert(json.error || 'Não foi possível reagir.'); return; }
      const holder = document.createElement('div');
      holder.innerHTML = json.html;
      box.replaceWith(holder.firstElementChild);
    } catch { window.alert('Sem conexão. Tente de novo.'); } finally { delete box.dataset.busy; }
  }

  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-react-open]');
    if (open) {
      const pop = open.parentElement.querySelector('[data-react-pop]');
      closeAll(pop);
      pop.hidden = !pop.hidden;
      open.setAttribute('aria-expanded', String(!pop.hidden));
      if (!pop.hidden) pop.querySelector('button')?.focus();
      return;
    }
    const btn = e.target.closest('[data-reacts] [data-react]');
    if (btn) { send(btn.closest('[data-reacts]'), btn.dataset.react); return; }
    closeAll();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const pop = e.target.closest?.('[data-react-pop]');
    if (pop) { e.stopPropagation(); pop.parentElement.querySelector('[data-react-open]')?.focus(); }
    closeAll();
  });
}());
