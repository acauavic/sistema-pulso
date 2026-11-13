// Reações com emoji nos comentários. Vale também para o comentário da revisão que entra sem recarregar a página, por isso escuta no documento.
(function () {
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  const closeAll = (except) => document.querySelectorAll('[data-react-pop]:not([hidden])').forEach((pop) => {
    if (pop === except) return;
    pop.hidden = true;
    pop.parentElement.querySelector('[data-react-open]')?.setAttribute('aria-expanded', 'false');
  });

  // Mostra a reação na hora (antes da resposta): liga/desliga o chip e ajusta a contagem. A resposta do servidor
  // substitui o bloco pelo estado real (com quem reagiu); se der erro, o bloco volta como estava.
  function optimistic(box, emoji) {
    let chip = [...box.querySelectorAll('.react-chip')].find((c) => c.dataset.react === emoji);
    const add = box.querySelector('[data-react-open]');
    if (chip && chip.classList.contains('mine')) {
      const n = Number(chip.querySelector('.mono').textContent) - 1;
      if (n <= 0) chip.remove(); else { chip.querySelector('.mono').textContent = String(n); chip.classList.remove('mine'); chip.setAttribute('aria-pressed', 'false'); }
    } else if (chip) {
      chip.querySelector('.mono').textContent = String(Number(chip.querySelector('.mono').textContent) + 1);
      chip.classList.add('mine'); chip.setAttribute('aria-pressed', 'true');
    } else {
      chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'react-chip mine'; chip.dataset.react = emoji; chip.setAttribute('aria-pressed', 'true');
      const e = document.createElement('span'); e.className = 'react-emoji'; e.textContent = emoji;
      const n = document.createElement('span'); n.className = 'mono'; n.textContent = '1';
      chip.append(e, n);
      box.insertBefore(chip, add || null);
    }
  }

  async function send(box, emoji) {
    if (box.dataset.busy) return;
    box.dataset.busy = '1';
    const before = box.cloneNode(true);
    closeAll();
    optimistic(box, emoji);
    try {
      const res = await fetch('/reacoes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf, Accept: 'application/json' },
        body: JSON.stringify({ tipo: box.dataset.kind, id: box.dataset.id, emoji }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { box.replaceWith(before); delete before.dataset.busy; window.alert(json.error || 'Não foi possível reagir.'); return; }
      const holder = document.createElement('div');
      holder.innerHTML = json.html;
      box.replaceWith(holder.firstElementChild);
    } catch { box.replaceWith(before); delete before.dataset.busy; window.alert('Sem conexão. Tente de novo.'); } finally { delete box.dataset.busy; }
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
