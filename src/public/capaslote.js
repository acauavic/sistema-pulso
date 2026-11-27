// Capas em lote: "Sugerir textos para todos" pede à IA 3 textos de capa para cada corte (um pedido só) e coloca o primeiro no campo;
// os outros dois e o texto de antes ficam como botões embaixo, para trocar com um toque. Nada é salvo até "Salvar as capas".
(function () {
  const btn = document.querySelector('[data-cover-ai-all]');
  const form = document.querySelector('[data-cover-batch]');
  if (!btn || !form) return;
  const status = document.querySelector('[data-cover-ai-status]');
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  const fields = () => [...form.querySelectorAll('[data-cover-text]')];
  const set = (field, value) => { field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); };

  function alternatives(field, options, before) {
    const box = form.querySelector(`[data-cover-alts="${field.dataset.coverText}"]`);
    if (!box) return;
    const all = [...new Set([...options, before].filter(Boolean))];
    box.replaceChildren(...all.map((t) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ai-chip'; b.textContent = t === before ? `Manter: ${t}` : t;
      b.classList.toggle('on', field.value === t);
      b.addEventListener('click', () => { set(field, t); box.querySelectorAll('.ai-chip').forEach((x) => x.classList.toggle('on', x === b)); });
      return b;
    }));
    box.hidden = !all.length;
  }

  btn.addEventListener('click', async () => {
    const list = fields();
    if (!list.length) return;
    btn.disabled = true; status.textContent = `Pedindo textos para ${list.length} ${list.length === 1 ? 'corte' : 'cortes'}…`;
    const body = new URLSearchParams();
    list.forEach((f) => { body.append('ids', f.dataset.coverText); body.append(`texto_${f.dataset.coverText}`, f.value); });
    try {
      const res = await fetch('/conteudo/capas-em-lote/sugerir', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'x-csrf-token': csrf }, body });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.error || 'A IA não respondeu agora. Tente de novo.');
      let filled = 0; let failed = 0; let kept = 0;
      const fill = window.PulsoAIFill.create(); // o campo que a pessoa mudou (antes ou enquanto a IA pensava) fica; as sugestões viram botões
      list.forEach((f) => {
        const opts = out.sugestoes?.[f.dataset.coverText];
        if (!Array.isArray(opts) || !opts.length) { failed += 1; return; }
        const before = form.querySelector(`input[name="antes_${f.dataset.coverText}"]`)?.value || '';
        if (fill.write(f, opts[0])) filled += 1; else kept += 1;
        alternatives(f, opts, before);
      });
      status.textContent = `${filled} ${filled === 1 ? 'texto sugerido' : 'textos sugeridos'}${kept ? `; ${kept} ${kept === 1 ? 'mantido' : 'mantidos'} como você escreveu (as sugestões estão embaixo)` : ''}${failed ? `; ${failed} sem resposta da IA` : ''}. Revise e toque em "Salvar as capas".`;
    } catch (err) { status.textContent = err.message; } finally { btn.disabled = false; }
  });
})();
