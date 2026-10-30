// IA nos textos: um botão "Sugerir com IA" embaixo de cada campo marcado com data-ai="capa|titulo|descricao|titulo_youtube|
// descricao_youtube". Abre um painel curto com atalhos (outras opções, mais curto, em pergunta…) ou um pedido do seu jeito, e
// traz 3 opções; tocar numa opção troca o texto do campo (dá para desfazer). Contexto: data-ai-episode, data-ai-clip,
// data-ai-kind (tipo de capa) ou data-ai-scope="form" (lê o item escolhido no formulário). Sem JS inline (CSP 'self').
(function () {
  if (window.PulsoAI) return;
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  const tpl = document.querySelector('template[data-ai-icons]');
  const icon = (k) => tpl?.content.querySelector(`[data-i="${k}"]`)?.innerHTML || '';
  const SHORTCUTS = [
    ['variar', 'Outras opções'], ['curto', 'Mais curto'], ['impacto', 'Mais impacto'], ['pergunta', 'Em pergunta'],
    ['citacao', 'Frase do convidado'], ['numero', 'Com número'], ['serio', 'Mais sério'], ['leve', 'Mais leve'], ['hashtags', 'Com hashtags', ['descricao']],
  ];
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let openPanel = null;
  const closeAll = () => { if (openPanel) { openPanel.hidden = true; openPanel.previousElementSibling?.querySelector('.ai-btn')?.setAttribute('aria-expanded', 'false'); openPanel = null; } };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openPanel) { e.stopPropagation(); closeAll(); } }, true);
  document.addEventListener('pointerdown', (e) => { if (openPanel && !openPanel.contains(e.target) && !openPanel.previousElementSibling?.contains(e.target)) closeAll(); });

  function contextOf(field) {
    const out = { episodio: field.dataset.aiEpisode || '', corte: field.dataset.aiClip || '', tipo_capa: field.dataset.aiKind || '' };
    if (field.dataset.aiScope === 'form') { // "Novo post": o contexto é o item escolhido
      const r = field.form?.querySelector('input[type="radio"][name="clip_id"]:checked, input[type="radio"][name="cover_ids"]:checked');
      if (r?.name === 'clip_id') out.corte = r.value;
      if (r?.dataset.episode) out.episodio = r.dataset.episode;
    }
    return out;
  }

  function enhance(field) {
    if (field.dataset.aiReady) return;
    field.dataset.aiReady = '1';
    const kind = field.dataset.ai;
    const anchor = field.closest('label') || field;
    const bar = mk('div', 'ai-bar');
    const btn = mk('button', 'ai-btn'); btn.type = 'button'; btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `${icon('sparkles')}<span>Sugerir com IA</span>`;
    const undo = mk('button', 'link small ai-undo', 'Desfazer'); undo.type = 'button'; undo.hidden = true;
    bar.append(btn, undo);
    const panel = mk('div', 'ai-panel'); panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Sugestões da IA');
    const chips = mk('div', 'ai-chips');
    SHORTCUTS.filter(([, , only]) => !only || only.includes(kind)).forEach(([key, label]) => {
      const c = mk('button', 'ai-chip', label); c.type = 'button'; c.dataset.key = key;
      c.addEventListener('click', () => run({ atalho: key }));
      chips.append(c);
    });
    const ownRow = mk('div', 'ai-own'); // não é <form>: o campo já costuma estar dentro do formulário de publicar
    const own = mk('input'); own.type = 'text'; own.maxLength = 300; own.placeholder = 'Ou peça do seu jeito: "cite a fala sobre burnout"'; own.setAttribute('aria-label', 'Pedido para a IA');
    const go = mk('button', 'btn sm icon-only'); go.type = 'button'; go.innerHTML = icon('send'); go.title = 'Gerar'; go.setAttribute('aria-label', 'Gerar com este pedido');
    ownRow.append(own, go);
    const ask = () => { if (own.value.trim()) run({ pedido: own.value.trim() }); else own.focus(); };
    go.addEventListener('click', ask);
    own.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } }); // Enter não envia o formulário de publicar
    const status = mk('p', 'small muted ai-status'); status.setAttribute('role', 'status');
    const list = mk('ul', 'plain ai-options');
    panel.append(chips, ownRow, status, list);
    anchor.after(bar, panel);

    let before = null;
    btn.addEventListener('click', () => {
      const wasOpen = !panel.hidden; closeAll();
      if (wasOpen) return;
      panel.hidden = false; openPanel = panel; btn.setAttribute('aria-expanded', 'true');
      if (!list.children.length) status.textContent = field.value.trim() ? 'Escolha um atalho ou peça do seu jeito.' : 'O campo está vazio: a IA escreve a partir da conversa.';
    });
    undo.addEventListener('click', () => {
      if (before == null) return;
      field.value = before; before = null; undo.hidden = true;
      field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
      field.focus();
    });

    let busy = false;
    async function run(extra) {
      if (busy) return;
      busy = true; panel.classList.add('busy'); status.textContent = 'Pensando…'; list.replaceChildren();
      panel.querySelectorAll('button, input').forEach((b) => { b.disabled = true; });
      try {
        const body = new URLSearchParams({ campo: kind, atual: field.value || '', ...contextOf(field), ...extra });
        const res = await fetch('/ia/texto', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'x-csrf-token': csrf }, body });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.ok) throw new Error(out.error || 'A IA não respondeu agora. Tente de novo.');
        status.textContent = 'Toque numa opção para usar.';
        list.replaceChildren(...out.opcoes.map((t) => {
          const li = mk('li'); const b = mk('button', 'ai-option', t); b.type = 'button';
          b.addEventListener('click', () => {
            before = field.value; field.value = t; undo.hidden = false;
            field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
            list.querySelectorAll('.ai-option').forEach((x) => x.classList.toggle('on', x === b));
            status.textContent = 'Aplicado. Dá para desfazer ou escolher outra.';
          });
          li.append(b); return li;
        }));
      } catch (err) { status.textContent = err.message; } finally {
        busy = false; panel.classList.remove('busy');
        panel.querySelectorAll('button, input').forEach((b) => { b.disabled = false; });
      }
    }
  }

  const scan = (scope = document) => scope.querySelectorAll('[data-ai]').forEach(enhance);
  window.PulsoAI = { scan };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan()); else scan();
}());
