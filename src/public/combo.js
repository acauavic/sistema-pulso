// Lista com busca: todo <select> com muitas opções (mais de 8) ou marcado com data-search ganha uma caixa de busca dentro dele.
// O <select> de verdade continua no formulário (é ele que vai para o servidor e que dispara "change"); por cima fica um botão
// com o valor atual e, aberto, a busca e a lista filtrada. Teclado: setas, Enter, Esc e digitar já busca. Sem acento e sem
// maiúscula na comparação. data-native num <select> deixa o nativo. Funciona dentro de janelas (dialog) e no celular.
(function () {
  const MIN_OPTIONS = 9;
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  let seq = 0; let openCombo = null;

  function enhance(select) {
    if (select.dataset.combo || select.multiple || select.hasAttribute('data-native') || select.size > 1) return;
    if (!select.hasAttribute('data-search') && select.options.length < MIN_OPTIONS) return;
    select.dataset.combo = '1';
    const id = `combo-${(seq += 1)}`;
    const wrap = document.createElement('div'); wrap.className = 'combo';
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'combo-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', `${id}-list`);
    const label = select.labels?.[0] || select.closest('label');
    const labelText = (lab) => { if (!lab) return ''; const c = lab.cloneNode(true); c.querySelectorAll('select, .combo, small, .counter').forEach((n) => n.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
    const name = select.getAttribute('aria-label') || labelText(label);
    if (name) trigger.setAttribute('aria-label', name);
    const value = document.createElement('span'); value.className = 'combo-value';
    const chev = document.createElement('span'); chev.className = 'combo-chev'; chev.setAttribute('aria-hidden', 'true');
    trigger.append(value, chev);
    const pop = document.createElement('div'); pop.className = 'combo-pop'; pop.hidden = true;
    const search = document.createElement('input'); search.type = 'search'; search.className = 'combo-search'; search.placeholder = 'Buscar…';
    search.setAttribute('role', 'combobox'); search.setAttribute('aria-autocomplete', 'list'); search.setAttribute('aria-controls', `${id}-list`); search.setAttribute('aria-expanded', 'true');
    if (name) search.setAttribute('aria-label', `Buscar em ${name}`);
    search.autocomplete = 'off'; search.spellcheck = false;
    const list = document.createElement('ul'); list.className = 'combo-list'; list.id = `${id}-list`; list.setAttribute('role', 'listbox');
    const empty = document.createElement('p'); empty.className = 'combo-empty small muted'; empty.textContent = 'Nada encontrado.'; empty.hidden = true;
    pop.append(search, list, empty);
    select.parentNode.insertBefore(wrap, select);
    wrap.append(select, trigger, pop);
    select.classList.add('combo-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');

    // "Escolha…"/"Selecione" num campo obrigatório é convite (fica apagado); "Todos os episódios" num filtro é uma escolha de verdade.
    const isPlaceholder = (opt, index) => Boolean(opt) && opt.value === '' && index === 0 && (select.required || /(…|\.\.\.)\s*$|^\s*(escolha|selecione)/i.test(opt.textContent));
    let items = []; let active = -1;
    const build = () => {
      list.replaceChildren(); items = [];
      let group = null;
      [...select.options].forEach((opt, index) => {
        const og = opt.parentElement.tagName === 'OPTGROUP' ? opt.parentElement : null;
        if (og && og !== group) { group = og; const h = document.createElement('li'); h.className = 'combo-group'; h.setAttribute('role', 'presentation'); h.textContent = og.label; list.append(h); }
        const li = document.createElement('li'); li.className = 'combo-opt'; li.id = `${id}-o${index}`; li.setAttribute('role', 'option');
        li.textContent = opt.textContent.replace(/\s+/g, ' ').trim() || '—';
        if (opt.disabled) li.setAttribute('aria-disabled', 'true');
        if (isPlaceholder(opt, index)) li.classList.add('combo-placeholder');
        li.dataset.index = String(index);
        li.addEventListener('mousedown', (e) => e.preventDefault()); // não tira o foco da busca
        li.addEventListener('click', () => { if (!opt.disabled) choose(index); });
        list.append(li); items.push({ li, opt, key: fold(li.textContent || opt.value) }); // só o texto: o valor é id do banco ("12" achava o EP.011)
      });
    };
    const sync = () => {
      const opt = select.options[select.selectedIndex];
      value.textContent = opt ? opt.textContent.replace(/\s+/g, ' ').trim() : '';
      wrap.classList.toggle('is-placeholder', !opt || isPlaceholder(opt, select.selectedIndex));
      trigger.disabled = select.disabled;
      items.forEach(({ li, opt: o }) => li.setAttribute('aria-selected', String(o.selected)));
    };
    const visible = () => items.filter((i) => !i.li.hidden && i.li.getAttribute('aria-disabled') !== 'true');
    const highlight = (n) => {
      const vis = visible(); if (!vis.length) { active = -1; search.removeAttribute('aria-activedescendant'); return; }
      active = (n + vis.length) % vis.length;
      items.forEach((i) => i.li.classList.remove('is-active'));
      const cur = vis[active]; cur.li.classList.add('is-active'); search.setAttribute('aria-activedescendant', cur.li.id);
      cur.li.scrollIntoView({ block: 'nearest' });
    };
    const filter = () => {
      const q = fold(search.value);
      let shown = 0;
      items.forEach((i) => { const hit = !q || i.key.includes(q); i.li.hidden = !hit; if (hit) shown += 1; });
      list.querySelectorAll('.combo-group').forEach((g) => { let n = g.nextElementSibling; let any = false; while (n && !n.classList.contains('combo-group')) { if (!n.hidden) any = true; n = n.nextElementSibling; } g.hidden = !any; });
      empty.hidden = shown > 0;
      highlight(Math.max(0, visible().findIndex((i) => i.opt.selected)));
    };
    const place = () => {
      const r = trigger.getBoundingClientRect();
      const below = window.innerHeight - r.bottom; const above = r.top;
      wrap.classList.toggle('opens-up', below < 280 && above > below);
    };
    function open() {
      if (openCombo && openCombo !== close) openCombo();
      build(); sync(); place();
      pop.hidden = false; wrap.classList.add('is-open'); trigger.setAttribute('aria-expanded', 'true');
      search.value = ''; filter(); search.focus();
      openCombo = close;
    }
    function close(focusBack = true) {
      if (pop.hidden) return;
      pop.hidden = true; wrap.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false');
      if (openCombo === close) openCombo = null;
      if (focusBack) trigger.focus();
    }
    function choose(index) {
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index; sync(); close();
      if (changed) { select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); }
      wrap.classList.remove('is-invalid');
    }

    trigger.addEventListener('click', () => (pop.hidden ? open() : close()));
    trigger.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); return; }
      if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) { open(); search.value = e.key; filter(); }
    });
    search.addEventListener('input', filter);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); } else if (e.key === 'Enter') {
        e.preventDefault(); const cur = visible()[active]; if (cur) choose(Number(cur.li.dataset.index));
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === 'Tab') close(false);
    });
    select.addEventListener('change', sync);
    select.addEventListener('focus', () => trigger.focus()); // clicar no rótulo foca o select escondido: o foco vai para o botão
    select.addEventListener('pulso:combo-sync', sync);
    select.addEventListener('invalid', (e) => { e.preventDefault(); wrap.classList.add('is-invalid'); trigger.focus(); });
    select.form?.addEventListener('reset', () => setTimeout(sync, 0));
    new MutationObserver(() => { sync(); }).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    build(); sync();
  }

  document.addEventListener('click', (e) => { if (openCombo && !e.target.closest('.combo')) openCombo(false); });
  window.addEventListener('resize', () => { if (openCombo) openCombo(false); });
  const scan = (root = document) => root.querySelectorAll('select').forEach(enhance);
  scan();
  // conteúdo que chega depois (janelas preenchidas, listas carregadas por fetch)
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.tagName === 'SELECT') enhance(n); else if (n.querySelector?.('select')) scan(n); } })
    .observe(document.body, { childList: true, subtree: true });
  // valor trocado por código (janela preenchida por um botão "Editar"): o rótulo acompanha ao abrir a janela ou focar
  document.addEventListener('focusin', (e) => { const w = e.target.closest?.('.combo'); if (w) w.querySelector('select')?.dispatchEvent(new Event('pulso:combo-sync')); });
  window.PulsoCombo = { enhance, scan, sync: (select) => select?.dispatchEvent(new Event('pulso:combo-sync')) };
})();
