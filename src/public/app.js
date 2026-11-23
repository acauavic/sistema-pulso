// JS do painel. Sem inline script (CSP: script-src 'self').
(function () {
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';

  // menu no celular: o botão Menu (barra de baixo) abre o menu completo por cima da página; Esc ou o mesmo botão fecham
  const sidebar = document.querySelector('[data-sidebar]');
  const navToggles = document.querySelectorAll('[data-nav-toggle]');
  const setMenu = (open) => {
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    document.documentElement.classList.toggle('menu-open', open);
    navToggles.forEach((b) => b.setAttribute('aria-expanded', String(open)));
  };
  navToggles.forEach((b) => b.addEventListener('click', () => setMenu(!sidebar?.classList.contains('open'))));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar?.classList.contains('open')) setMenu(false); });
  window.addEventListener('pageshow', () => setMenu(false)); // voltar pelo histórico não reabre a página com o menu aberto

  // Assistente: o script só baixa quando a pessoa abre (ou se ele ficou aberto da última vez). Até lá, só o botão.
  const assistFab = document.querySelector('[data-assist-open][data-assist-src]');
  if (assistFab) {
    const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } } };
    const loadAssist = () => { if (document.querySelector('script[data-assist-loaded]')) return; const s = document.createElement('script'); s.src = assistFab.dataset.assistSrc; s.dataset.assistLoaded = '1'; document.body.appendChild(s); };
    if (store.get('pulso-assist-open') === '1') loadAssist();
    else assistFab.addEventListener('click', () => { store.set('pulso-assist-open', '1'); loadAssist(); }, { once: true }); // o script abre sozinho ao carregar
  }

  // tema: escuro (padrão) ou claro; a escolha fica só neste navegador
  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#F4F4F0' : '#0E0F0D');
    try { localStorage.setItem('pulso-theme', next); } catch { /* storage bloqueado */ }
  });

  // celular: abas e etapas que não cabem rolam de lado; a ativa já aparece (sem mexer na rolagem da página)
  // (nas etapas, a anterior também fica inteira: sem "m agendamento" cortado na borda)
  document.querySelectorAll('.stepper li.now, .tabbar .on, .seg .on').forEach((el) => {
    const box = el.parentElement;
    const from = el.matches('.stepper li') && el.previousElementSibling ? el.previousElementSibling : el;
    if (box && box.scrollWidth > box.clientWidth) box.scrollLeft += from.getBoundingClientRect().left - box.getBoundingClientRect().left;
  });

  // confirmação antes de ações destrutivas: <form data-confirm="...">
  document.addEventListener('submit', (e) => {
    const msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // envio que demora (publicar, reenviar: o vídeo sobe antes para o provedor): <form data-busy="Enviando…"> mostra o andamento no
  // botão e trava o formulário, para o clique não se repetir. Os botões são travados depois do envio montado (o clicado leva o valor).
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (e.defaultPrevented || !form.matches || !form.matches('form[data-busy]')) return;
    if (form.dataset.sent) { e.preventDefault(); return; }
    form.dataset.sent = '1'; form.setAttribute('aria-busy', 'true');
    const btn = e.submitter && form.contains(e.submitter) ? e.submitter : form.querySelector('button[type=submit], button:not([type])');
    if (btn) { btn.idleNodes = [...btn.childNodes]; btn.textContent = form.dataset.busy; }
    setTimeout(() => form.querySelectorAll('button').forEach((b) => { b.disabled = true; }), 0);
  });
  // voltar pelo navegador (página guardada): o formulário volta a funcionar
  window.addEventListener('pageshow', (ev) => {
    if (!ev.persisted) return;
    document.querySelectorAll('form[data-busy][data-sent]').forEach((f) => {
      delete f.dataset.sent; f.removeAttribute('aria-busy');
      f.querySelectorAll('button').forEach((b) => { b.disabled = false; if (b.idleNodes) { b.replaceChildren(...b.idleNodes); b.idleNodes = null; } });
    });
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

  // formulário do convidado: campos e dicas conforme a etapa escolhida
  const stageSelect = document.querySelector('[data-stage-select]');
  if (stageSelect) {
    const sync = () => {
      const stage = stageSelect.value;
      document.querySelectorAll('[data-stages]').forEach((el) => { el.hidden = !el.dataset.stages.split(' ').includes(stage); });
      document.querySelectorAll('[data-hint-for]').forEach((el) => { el.hidden = el.dataset.hintFor !== stage; });
      const label = document.querySelector('[data-stage-label]');
      if (label) label.textContent = stageSelect.selectedOptions[0]?.textContent || '';
    };
    stageSelect.addEventListener('change', sync);
    sync();
  }

  // edição em massa (Convidados > Lista): seleção, contador, e os campos que só aparecem quando fazem sentido
  document.querySelectorAll('[data-bulk]').forEach((box) => {
    const picks = () => [...document.querySelectorAll('input[data-bulk-pick]')];
    const all = document.querySelector('[data-bulk-all]');
    const sync = () => {
      const n = picks().filter((b) => b.checked).length;
      box.querySelector('[data-bulk-bar]').hidden = !n;
      box.querySelector('[data-bulk-hint]').hidden = n > 0;
      document.querySelectorAll('[data-bulk-count]').forEach((el) => { el.textContent = n; });
      document.querySelectorAll('[data-bulk-word]').forEach((el) => { const [one, many] = el.dataset.bulkWord.split('|'); el.textContent = n === 1 ? one : many; });
      if (all) { all.checked = n > 0 && n === picks().length; all.indeterminate = n > 0 && n < picks().length; }
    };
    picks().forEach((b) => b.addEventListener('change', sync));
    all?.addEventListener('change', () => { picks().forEach((b) => { b.checked = all.checked; }); sync(); });
    box.querySelector('[data-bulk-clear]')?.addEventListener('click', () => { picks().forEach((b) => { b.checked = false; }); sync(); });
    sync();
  });
  document.querySelectorAll('[data-bulk-form]').forEach((form) => {
    const status = form.querySelector('[data-bulk-status]');
    const loss = form.querySelector('[data-bulk-loss]');
    const lossSelect = loss.querySelector('select');
    status.addEventListener('change', () => {
      const on = status.value === 'perdido';
      loss.hidden = !on; lossSelect.required = on;
      if (!on) { lossSelect.value = ''; lossSelect.dispatchEvent(new Event('change')); } // "Outros" some junto, sem deixar campo obrigatório escondido
    });
    const sponsor = form.querySelector('[data-bulk-sponsor]');
    const relation = form.querySelector('[data-bulk-relation]');
    sponsor.addEventListener('change', () => { relation.hidden = !/^\d+$/.test(sponsor.value); });
    form.addEventListener('submit', (e) => { if (!document.querySelector('input[data-bulk-pick]:checked')) e.preventDefault(); });
  });

  // link que abre outra aba e avisa o servidor (WhatsApp do lembrete): o <a> abre sozinho, sem depender de redirecionamento
  // (a CSP do painel barra formulário que termina em outro site), e o registro de "enviado" vai em segundo plano.
  document.querySelectorAll('a[data-mark-sent]').forEach((a) => a.addEventListener('click', () => {
    const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
    fetch(a.dataset.markSent, { method: 'POST', keepalive: true, headers: { 'x-csrf-token': csrf, Accept: 'application/json' } }).catch(() => {});
    setTimeout(() => window.location.reload(), 1200);
  }));

  // "Marcar todos" / "Desmarcar todos" dentro de um painel de filtros
  document.querySelectorAll('[data-check-all], [data-check-none]').forEach((b) => b.addEventListener('click', () => {
    const name = b.dataset.checkAll || b.dataset.checkNone;
    b.closest('form').querySelectorAll(`input[type=checkbox][name="${name}"]`).forEach((c) => { c.checked = b.hasAttribute('data-check-all'); });
  }));
  // painéis que abrem sob um botão (<details data-popover>): fecham ao clicar fora ou com Esc
  const popovers = () => document.querySelectorAll('details[data-popover][open]');
  document.addEventListener('click', (e) => popovers().forEach((d) => { if (!d.contains(e.target)) d.open = false; }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') popovers().forEach((d) => { d.open = false; d.querySelector('summary')?.focus(); }); });

  // menu lateral recolhível: a escolha fica guardada neste navegador (theme.js aplica antes da pintura)
  document.querySelectorAll('[data-sidebar-collapse]').forEach((btn) => {
    const root = document.documentElement;
    const sync = () => {
      const collapsed = root.dataset.sidebar === 'collapsed';
      const label = collapsed ? 'Expandir o menu' : 'Recolher o menu';
      btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false'); btn.setAttribute('aria-label', label); btn.title = label;
    };
    btn.addEventListener('click', () => {
      const collapsed = root.dataset.sidebar === 'collapsed';
      if (collapsed) delete root.dataset.sidebar; else root.dataset.sidebar = 'collapsed';
      try { localStorage.setItem('pulso-sidebar', collapsed ? 'open' : 'collapsed'); } catch { /* sem storage: vale só nesta página */ }
      sync();
    });
    sync();
  });
  // com o menu recolhido só aparecem os ícones: o nome vai na dica de cada item
  document.querySelectorAll('.nav a').forEach((a) => { if (!a.title) { const t = a.querySelector('span:not(.nav-count)'); if (t) a.title = t.textContent.trim(); } });

  // motivo da perda: "Outros" pede a descrição (formulário do convidado e janela "Marcar como perdido")
  document.querySelectorAll('[data-loss-select], [data-loss-radio]').forEach((input) => {
    const form = input.form;
    const note = form.querySelector('[data-loss-note]');
    if (!note) return;
    const sync = () => {
      const picked = input.matches('select') ? input.value : form.querySelector('[data-loss-radio]:checked')?.value;
      const on = picked === 'outros';
      note.hidden = !on; note.querySelector('input').required = on;
    };
    input.addEventListener('change', sync); sync();
  });

  // envio de arquivos da equipe (corpo cru): <div data-upload data-url="…"> com select[data-upload-kind], input[data-upload-file], button[data-upload-send]
  document.querySelectorAll('[data-upload]').forEach((box) => {
    const status = box.querySelector('[data-upload-status]');
    box.querySelector('[data-upload-send]')?.addEventListener('click', async () => {
      const file = box.querySelector('[data-upload-file]').files[0];
      if (!file) { status.textContent = 'Escolha um arquivo.'; return; }
      status.textContent = 'Enviando…';
      try {
        const kind = box.querySelector('[data-upload-kind]').value;
        const res = await fetch(`${box.dataset.url}?tipo=${encodeURIComponent(kind)}&nome=${encodeURIComponent(file.name)}`, {
          method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-csrf-token': csrf }, body: file,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error || `erro ${res.status}`);
        window.location.hash = 'arquivos';
        window.location.reload();
      } catch (err) {
        status.textContent = `Não foi possível enviar: ${err.message}`;
      }
    });
  });

  // importação CSV: o arquivo escolhido vira o texto da caixa (o servidor sempre recebe texto)
  document.querySelector('[data-csv-file]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); } // Excel salva CSV em Windows-1252
    document.querySelector('[data-csv-text]').value = text.replace(/^\uFEFF/, '');
  });

  // Campo obrigatório: o rótulo ganha o "*" e o formulário com dois ou mais obrigatórios ganha a legenda "* obrigatório" no topo
  // (a regra do design system, aplicada uma vez para todas as telas; quem já escreveu o "*" à mão fica como está).
  const markRequired = (root) => {
    root.querySelectorAll('label').forEach((label) => {
      if (label.dataset.reqDone) return;
      const ctl = label.querySelector('input[required], select[required], textarea[required]');
      if (!ctl || ctl.type === 'radio' || ctl.type === 'checkbox' || ctl.type === 'hidden') return;
      label.dataset.reqDone = '1';
      const text = [...label.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!text || /\*/.test(label.textContent.split('\n')[0])) return;
      text.textContent = `${text.textContent.replace(/\s+$/, '')} *`; // no próprio texto: o rótulo é uma grade e um elemento a mais desceria de linha
      label.classList.add('req-label');
    });
    root.querySelectorAll('form').forEach((form) => {
      if (form.dataset.reqLegend || form.querySelector('.req-legend') || /\* obrigatório/.test(form.textContent)) return;
      if (form.querySelectorAll('.req-label').length < 2) return;
      form.dataset.reqLegend = '1';
      const p = document.createElement('p'); p.className = 'req-legend small muted m-0'; p.textContent = '* obrigatório';
      const head = form.querySelector(':scope > h2, :scope > .modal-head, :scope > h3');
      if (head) head.after(p); else form.prepend(p);
    });
  };
  markRequired(document);

  // Voltar que lembra: a lista (Conteúdo em qualquer aba, Publicações) guarda o endereço com os filtros nesta aba do navegador;
  // a página do corte, do pedido e da publicação leva de volta para lá, mesmo depois de salvar algo nela. Em qualquer outra
  // página a lembrança se apaga, e o botão volta a levar ao destino de sempre.
  try {
    const KEY = 'pulso-voltar';
    const list = document.querySelector('[data-list-memory]');
    const backs = document.querySelectorAll('a[data-back-memory]');
    if (list) sessionStorage.setItem(KEY, JSON.stringify({ href: location.pathname + location.search, label: list.dataset.listMemory }));
    else if (backs.length) {
      const v = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (v && typeof v.href === 'string' && /^\/(conteudo|social\/publicacoes)(\?|$)/.test(v.href)) {
        backs.forEach((a) => { a.href = v.href; const t = a.querySelector('[data-back-label]'); if (t && v.label) t.textContent = v.label; });
      }
    } else sessionStorage.removeItem(KEY);
  } catch { /* navegador sem sessionStorage: o botão leva ao destino de sempre */ }

  // página de erro: Voltar leva à página anterior (sem histórico, ao início)
  document.querySelectorAll('[data-go-back]').forEach((b) => b.addEventListener('click', () => { if (history.length > 1) history.back(); else location.href = '/'; }));

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
      e.dataTransfer.setData('text/plain', card.dataset.itemId || card.dataset.guestId);
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
      if (col.hasAttribute('data-drop-open')) { card.querySelector('[data-drop-open]')?.click(); return; } // a coluna pede dados (ex.: valor combinado): abre a janela em vez de mover
      zone.prepend(card); // otimista
      refreshCounts();
      try {
        const res = await fetch(`${board.dataset.base || '/convidados'}/${card.dataset.itemId || card.dataset.guestId}/${board.dataset.statusPath || 'status'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'x-csrf-token': csrf },
          body: new URLSearchParams({ status: col.dataset.status }),
        });
        if (res.status === 422) { // faltam dados para esta etapa: desfaz e oferece completar o cadastro
          const info = await res.json().catch(() => ({}));
          from.prepend(card);
          refreshCounts();
          if (info.editUrl && window.confirm(`${info.error}\n\nCompletar agora?`)) window.location.href = info.editUrl;
          else if (!info.editUrl && info.error) window.alert(info.error);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const info = await res.json().catch(() => ({}));
        if (info.reload) window.location.reload(); // o servidor fez algo que a pessoa precisa ver (aviso na tela)
      } catch {
        from.prepend(card); // desfaz
        refreshCounts();
        window.alert(board.dataset.failMsg || 'Não foi possível mover o convidado. Tente de novo.');
      }
    });
  }
  // ---------------------------------------------------------------- abas (a seção certa por etapa; o endereço #secao abre a aba que a contém)
  document.querySelectorAll('[data-tabs]').forEach((wrap) => {
    const own = (el) => el.closest('[data-tabs]') === wrap; // abas dentro de uma janela não pertencem às abas da página
    const btns = [...wrap.querySelectorAll('[data-tab-btn]')].filter(own);
    const panes = [...wrap.querySelectorAll('[data-pane-id]')].filter(own);
    const keys = btns.map((b) => b.dataset.tabBtn);
    const fallback = keys.includes(wrap.dataset.default) ? wrap.dataset.default : keys[0];
    const show = (key) => {
      btns.forEach((b) => { const on = b.dataset.tabBtn === key; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      panes.forEach((p) => { p.hidden = p.dataset.paneId !== key; });
    };
    const fromHash = () => {
      const h = decodeURIComponent(window.location.hash.slice(1));
      if (keys.includes(h)) return { key: h };
      const el = h && document.getElementById(h);
      const pane = el && el.closest('[data-pane-id]');
      return pane && keys.includes(pane.dataset.paneId) ? { key: pane.dataset.paneId, el } : { key: fallback };
    };
    const apply = (scroll) => { const r = fromHash(); show(r.key); if (scroll && r.el) r.el.scrollIntoView({ block: 'start' }); };
    const local = wrap.hasAttribute('data-local'); // abas dentro de uma janela: não mexem na URL
    btns.forEach((b) => b.addEventListener('click', () => { show(b.dataset.tabBtn); if (!local) window.history.replaceState(null, '', `#${b.dataset.tabBtn}`); }));
    if (local) { show(fallback); return; }
    window.addEventListener('hashchange', () => apply(true));
    apply(true);
  });

  // ---------------------------------------------------------------- janelas (modal): <button data-modal-open="id"> abre <dialog class="modal" id="id">
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-modal-open]');
    if (!btn) return;
    const dlg = document.getElementById(btn.dataset.modalOpen);
    if (dlg && btn.dataset.tab) dlg.querySelector(`[data-tab-btn="${btn.dataset.tab}"]`)?.click(); // abre já na aba pedida
    if (dlg && !dlg.open) dlg.showModal();
  });
  document.querySelectorAll('dialog.modal').forEach((dlg) => {
    dlg.querySelectorAll('[data-modal-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // clicar fora fecha
  });
  document.querySelector('dialog.modal[data-open-on-load]')?.showModal(); // voltou com erro de uma janela: ela reabre
  // filtro rápido de uma lista, sem recarregar: <div class="seg" data-row-filter="id-da-lista"> com botões data-value; linhas com data-filter-value
  document.querySelectorAll('[data-row-filter]').forEach((seg) => {
    const list = document.getElementById(seg.dataset.rowFilter);
    if (!list) return;
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      seg.querySelectorAll('button[data-value]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      list.querySelectorAll('[data-filter-value]').forEach((row) => { row.hidden = Boolean(b.dataset.value) && !row.dataset.filterValue.split(' ').includes(b.dataset.value); });
    });
  });
  // filtro de uma lista longa dentro de uma janela: <input data-list-filter="#lista" data-list-item="li">; o que está marcado ou
  // vinculado (checkbox marcada, select com valor) continua à vista, para não sumir da conta de quem está escolhendo
  document.querySelectorAll('[data-list-filter]').forEach((input) => {
    const box = document.querySelector(input.dataset.listFilter);
    if (!box) return;
    const sel = input.dataset.listItem || 'li';
    const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const count = input.parentElement.querySelector('[data-list-filter-count]');
    const kept = (it) => it.querySelector('input[type="checkbox"]:checked, input[type="radio"]:checked') || [...it.querySelectorAll('select')].some((s) => s.value);
    const run = () => {
      const q = fold(input.value.trim()); let n = 0;
      box.querySelectorAll(sel).forEach((it) => { const hit = !q || fold(it.textContent).includes(q) || kept(it); it.hidden = !hit; if (hit) n += 1; });
      if (count) count.textContent = q ? `${n} ${n === 1 ? 'item' : 'itens'}` : '';
    };
    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); }); // Enter não envia a janela
  });
  // menu lateral: em tela baixa, o item da página aberta aparece (sem precisar rolar a lista para achar onde se está)
  (() => {
    const nav = document.querySelector('.sidebar .nav'); const cur = nav && nav.querySelector('a.active');
    if (!cur || nav.scrollHeight <= nav.clientHeight) return;
    const top = cur.offsetTop - nav.offsetTop;
    if (top < nav.scrollTop || top + cur.offsetHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = Math.max(0, top - nav.clientHeight / 2);
  })();
  // link para uma seção que abre (#sobre): ela já vem aberta
  try { const sec = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1))); if (sec && sec.tagName === 'DETAILS') sec.open = true; } catch { /* hash inválido */ }

  // Calendário no celular: a grade vira lista dos dias com evento; ela começa em hoje (ou no próximo dia com algo), não no primeiro quadrado do mês
  (() => {
    const grid = document.querySelector('.cal-month, .cal-week');
    if (!grid || !window.matchMedia('(max-width: 760px)').matches) return;
    const days = [...grid.querySelectorAll('.cal-day')];
    const i = days.findIndex((d) => d.classList.contains('today'));
    if (i < 0) return;
    const shown = (d) => d.offsetParent !== null;
    const target = days.slice(i).find(shown);
    if (target && target !== days.find(shown)) target.scrollIntoView({ block: 'start' });
  })();
  document.querySelectorAll('[data-autosubmit]').forEach((s) => s.addEventListener('change', () => s.form.submit()));
  // Página-ponte para um site de fora (ex.: reconectar o Instagram): segue o link sozinha; o botão fica de reserva.
  const autoOpen = document.querySelector('a[data-auto-open][href^="https://"]');
  if (autoOpen) setTimeout(() => window.location.assign(autoOpen.href), 300);
  // Gestão > Metas (janela de cada pessoa): a categoria filtra "o que contar"; taxa (%) aparece sempre em porcentagem (o campo
  // trava e o servidor também garante); "Adicionar meta" mostra a próxima linha; "tirar" esvazia a linha (salvar apaga a meta).
  document.querySelectorAll('[data-goal-form]').forEach((form) => {
    form.querySelectorAll('[data-goal-slot]').forEach((slot) => {
      const cat = slot.querySelector('[data-goal-cat]'); const metric = slot.querySelector('[data-goal-metric]');
      const display = slot.querySelector('[data-goal-display]'); const target = slot.querySelector('[data-goal-target]');
      if (!cat || !metric) return;
      const all = [...metric.options].map((o) => ({ value: o.value, text: o.textContent, cat: o.dataset.cat || '', rate: o.dataset.rate === '1', param: o.dataset.param === '1' }));
      const param = slot.querySelector('[data-goal-param]'); // "Vídeos entregues": o tipo de vídeo só aparece para ela
      const sync = () => {
        const rate = Boolean(all.find((o) => o.value === metric.value && o.rate));
        if (param) param.hidden = !all.find((o) => o.value === metric.value && o.param);
        if (display) { if (rate) display.value = 'porcentagem'; display.disabled = rate; }
        if (target) { target.max = rate ? '100' : ''; target.placeholder = rate ? 'ex.: 40 (%)' : 'ex.: 20'; }
      };
      const fill = () => {
        const keep = metric.value;
        metric.replaceChildren(...all.filter((o) => !o.value || !cat.value || o.cat === cat.value).map((o) => { const el = new Option(o.text, o.value); el.dataset.cat = o.cat; if (o.rate) el.dataset.rate = '1'; if (o.param) el.dataset.param = '1'; return el; }));
        metric.value = [...metric.options].some((o) => o.value === keep) ? keep : '';
        sync();
      };
      cat.addEventListener('change', fill); metric.addEventListener('change', sync);
      fill();
      slot.querySelector('[data-goal-clear]')?.addEventListener('click', () => { cat.value = ''; fill(); metric.value = ''; if (target) target.value = ''; sync(); });
    });
    const add = form.querySelector('[data-goal-add]');
    add?.addEventListener('click', () => {
      const next = form.querySelector('[data-goal-slot][hidden]');
      if (next) { next.hidden = false; next.querySelector('select')?.focus(); }
      add.hidden = !form.querySelector('[data-goal-slot][hidden]');
    });
  });
  // Resumo do dia (Início): escolher no calendário leva direto ao dia; digitando, espera terminar (cada número já forma uma data
  // válida e mandaria a página no meio da digitação). Enter vai na hora.
  document.querySelectorAll('[data-day-pick]').forEach((inp) => {
    let timer = null; let typed = 0;
    const go = () => { clearTimeout(timer); if (inp.value && inp.value !== inp.defaultValue && inp.checkValidity()) inp.form.submit(); };
    inp.addEventListener('keydown', (e) => { typed = Date.now(); if (e.key === 'Enter') { e.preventDefault(); go(); } });
    inp.addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(go, Date.now() - typed < 1500 ? 900 : 0); });
  });

  // ---------------------------------------------------------------- agenda da gravação: preencher a data pede a confirmação com estúdio, hosts e convidado
  // <div data-agenda> com input[data-agenda-date], checkboxes [data-agenda-check], dialog[data-agenda-dialog] e um resumo [data-agenda-summary]
  document.querySelectorAll('[data-agenda]').forEach((box) => {
    const date = box.querySelector('[data-agenda-date]');
    const dlg = box.querySelector('[data-agenda-dialog]');
    const checks = [...box.querySelectorAll('[data-agenda-check]')];
    const summary = box.querySelector('[data-agenda-summary]');
    const when = box.querySelector('[data-agenda-when]');
    const stage = box.closest('form')?.querySelector('[data-stage-select]');
    const label = () => {
      if (!date.value) return '';
      const d = new Date(date.value);
      return Number.isNaN(d.getTime()) ? date.value : d.toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
    };
    const draw = () => {
      const ok = checks.filter((c) => c.checked).map((c) => c.dataset.agendaCheck);
      const missing = checks.filter((c) => !c.checked).map((c) => c.dataset.agendaCheck);
      if (summary) {
        summary.hidden = !date.value;
        summary.querySelector('[data-agenda-state]').textContent = missing.length ? `Falta confirmar: ${missing.join(', ')}` : `Confirmada com ${ok.join(', ')}`;
        summary.classList.toggle('warn', missing.length > 0);
      }
      return missing;
    };
    // abre a confirmação quando a data nova está completa: ao sair do campo ou ao tentar salvar (aí salva depois de confirmar)
    let original = date.value; let pending = false; let submitAfter = false;
    const form = box.closest('form');
    const open = () => { pending = false; if (when) when.textContent = label(); if (!dlg.open) dlg.showModal(); };
    date.addEventListener('change', () => {
      if (!date.value || date.value === original) { pending = false; draw(); return; }
      checks.forEach((c) => { c.checked = false; }); // data nova: confirma de novo
      original = date.value; pending = true;
      draw();
      if (document.activeElement !== date) open(); // escolheu pelo calendário
    });
    date.addEventListener('blur', () => { if (pending) open(); });
    form?.addEventListener('submit', (e) => { if (pending) { e.preventDefault(); submitAfter = true; open(); } });
    dlg.addEventListener('close', () => { submitAfter = false; });
    box.querySelector('[data-agenda-review]')?.addEventListener('click', open);
    dlg.querySelector('[data-agenda-ok]')?.addEventListener('click', () => {
      const missing = draw();
      if (stage) { // todos confirmaram: o convidado vai para Agendado ao salvar; se a agenda caiu, volta para Em agendamento
        const before = stage.value;
        if (!missing.length && ['em_agendamento', 'convite_enviado', 'prospect'].includes(stage.value)) stage.value = 'agendado';
        else if (missing.length && stage.value === 'agendado') stage.value = 'em_agendamento';
        if (stage.value !== before) { stage.dispatchEvent(new Event('change')); stage.closest('details')?.setAttribute('open', ''); }
      }
      const go = submitAfter;
      dlg.close();
      if (go) form.requestSubmit();
    });
    draw();
  });
  // ---------------------------------------------------------------- campos condicionais: [data-when="nome=valor1 valor2"] ou "nome!=" (preenchido)
  document.querySelectorAll('[data-when-form]').forEach((form) => {
    const valueOf = (name) => {
      const els = [...form.elements].filter((el) => el.name === name);
      const radio = els.find((el) => el.type === 'radio');
      if (radio) return (els.find((el) => el.checked) || {}).value || '';
      return els[0] ? els[0].value : '';
    };
    const apply = () => { applyWhen(); keepVisible(); applyWhen(); };
    const applyWhen = () => form.querySelectorAll('[data-when]').forEach((el) => {
      const m = el.dataset.when.match(/^([\w-]+)(!?=)(.*)$/);
      if (!m) return;
      const cur = valueOf(m[1]);
      const list = m[3].split(' ').filter((x) => x !== '');
      const on = m[2] === '!=' ? (list.length ? !list.includes(cur) : cur !== '') : list.includes(cur);
      el.hidden = !on;
    });
    const keepVisible = () => form.querySelectorAll('select').forEach((sel) => { // a opção escolhida sumiu: fica com a primeira visível
      const opt = sel.selectedOptions[0];
      if (opt && opt.hidden) { const first = [...sel.options].find((o) => !o.hidden); if (first) first.selected = true; }
    });
    form.addEventListener('change', apply);
    apply();
  });
  // ---------------------------------------------------------------- troca de etapa: o botão só habilita quando a escolha é outra etapa
  document.querySelectorAll('[data-stage-confirm]').forEach((btn) => {
    const form = btn.closest('form');
    const sync = () => { const on = form.querySelector('input[name="status"]:checked'); btn.disabled = !on || on.dataset.current === '1'; };
    form.addEventListener('change', sync); sync();
  });
  // menu "Mais" (details.row-menu): fecha ao clicar fora ou com Esc
  document.addEventListener('click', (e) => { document.querySelectorAll('details.row-menu[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('details.row-menu[open]').forEach((d) => { d.open = false; d.querySelector('summary')?.focus(); }); });

  // ---------------------------------------------------------------- janela de edição reaproveitada: <button data-fill-modal="id" data-fill='{"campo":"valor"}' data-fill-action="/rota" data-fill-mode="edit|new" data-fill-remove="/rota/excluir">
  // Um formulário só (form[data-fill-form]) serve a todos os itens da lista: o clique preenche, aponta a rota e abre.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fill-modal]');
    if (!btn) return;
    const dlg = document.getElementById(btn.dataset.fillModal);
    const form = dlg && dlg.querySelector('form[data-fill-form]');
    if (!form) return;
    let data = {};
    try { data = JSON.parse(btn.dataset.fill || '{}'); } catch { /* sem dados */ }
    document.querySelectorAll('details.row-menu[open]').forEach((d) => { d.open = false; });
    form.action = btn.dataset.fillAction || '';
    form.querySelectorAll('[name]').forEach((el) => {
      if (el.name === '_csrf' || el.tagName === 'BUTTON') return;
      // escolha (radio/caixa) é marcar, não trocar o valor: sem dado para ela, fica como está
      if (el.type === 'radio' || el.type === 'checkbox') {
        if (el.name in data) el.checked = el.type === 'radio' ? String(el.value) === String(data[el.name] ?? '') : Boolean(data[el.name]);
        return;
      }
      el.value = data[el.name] ?? '';
    });
    const mode = btn.dataset.fillMode || 'edit';
    dlg.querySelectorAll('[data-mode]').forEach((n) => { n.hidden = n.dataset.mode !== mode; });
    dlg.querySelectorAll('[data-hide-section]').forEach((n) => { n.hidden = n.dataset.hideSection === data.section; });
    dlg.querySelectorAll('[data-if]').forEach((n) => { n.hidden = !data[n.dataset.if]; });
    const rm = dlg.querySelector('[data-fill-remove-btn]');
    if (rm) {
      rm.formAction = btn.dataset.fillRemove || ''; rm.hidden = !btn.dataset.fillRemove;
      rm.dataset.confirmText = btn.dataset.fillConfirm || 'Retirar este item? Ele some também dos patrocinadores.';
      if (!rm.dataset.label) rm.dataset.label = rm.textContent;
      rm.textContent = btn.dataset.fillRemoveLabel || rm.dataset.label;
    }
    form.dispatchEvent(new Event('change', { bubbles: true })); // refaz campos condicionais (data-when) com os valores preenchidos
    form.querySelectorAll('select').forEach((el) => el.dispatchEvent(new Event('pulso:combo-sync'))); // lista com busca mostra o valor novo
    dlg.showModal();
  });
  document.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-fill-remove-btn]');
    if (rm && !window.confirm(rm.dataset.confirmText || 'Remover?')) e.preventDefault();
  });

  // ---------------------------------------------------------------- envio de imagem (foto do convidado, imagens da página de plateia)
  // <input type="file" data-image-input data-csrf data-base="/rota/"> + <button data-image-pick="slot"> -> POST cru em data-base + slot
  document.querySelectorAll('[data-image-input]').forEach((input) => {
    let slot = null;
    document.querySelectorAll('[data-image-pick]').forEach((btn) => {
      if (btn.closest('[data-image-scope]') !== input.closest('[data-image-scope]') && btn.closest('[data-image-scope]')) return;
      btn.addEventListener('click', () => { slot = btn.dataset.imagePick; input.value = ''; input.click(); });
    });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file || slot == null) return;
      let body = file;
      if (input.dataset.crop) { // foto de convidado: enquadra na moldura padrão e envia o recorte (JPEG)
        if (!window.pulsoCrop) { window.alert('Não consegui abrir o recorte. Recarregue a página.'); return; }
        if (file.size > 40 * 1024 * 1024) { window.alert('A imagem tem mais de 40 MB.'); return; }
        body = await window.pulsoCrop(file, { reopen: () => { input.value = ''; input.click(); } });
        if (!body) return;
      } else if (file.size > 5 * 1024 * 1024) { window.alert('A imagem tem mais de 5 MB.'); return; }
      if (body.size > 5 * 1024 * 1024) { window.alert('A imagem recortada passou de 5 MB. Escolha outra foto.'); return; }
      try {
        const res = await fetch(input.dataset.base + slot, { method: 'POST', headers: { 'Content-Type': body.type || 'application/octet-stream', 'x-csrf-token': input.dataset.csrf, Accept: 'application/json' }, body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) { window.alert(json.error || 'Não foi possível enviar a imagem.'); return; }
        // janela da foto aberta para mudar de etapa: com a foto enviada, a mudança continua sozinha
        const after = input.closest('[data-image-scope]')?.querySelector('form[data-after-upload]');
        if (after) after.submit(); else window.location.reload();
      } catch { window.alert('Sem conexão. Tente de novo.'); }
    });
  });
})();

// Vídeo: o player toca a versão leve (720p). "Ver no original" troca para o arquivo enviado sem perder o ponto em que estava.
// Vídeo que só carrega no clique: a capa vira o player e já começa a tocar.
document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-video-load]'); if (!p) return;
  const v = document.createElement('video');
  v.id = p.dataset.id; v.controls = true; v.playsInline = true; v.autoplay = true; v.preload = 'auto'; v.src = p.dataset.src;
  if (p.dataset.poster) v.poster = p.dataset.poster;
  v.className = p.classList.contains('tall') ? 'tall' : '';
  p.replaceWith(v); v.focus(); v.play().catch(() => {});
});
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-video-swap]'); if (!btn) return;
  const waiting = document.querySelector(`[data-video-load][data-id="${CSS.escape(btn.dataset.videoSwap)}"]`);
  if (waiting) { const u = new URL(waiting.dataset.src, location.href); u.searchParams.set('original', '1'); waiting.dataset.src = u.toString(); btn.dataset.on = '1'; btn.textContent = 'Ver na versão leve'; const l = btn.parentElement.querySelector('[data-video-label]'); if (l) l.textContent = 'Original'; waiting.click(); return; }
  const video = document.getElementById(btn.dataset.videoSwap); if (!video) return;
  const original = btn.dataset.on !== '1';
  const at = video.currentTime; const playing = !video.paused;
  const url = new URL(video.currentSrc || video.src, location.href); url.hash = '';
  if (original) url.searchParams.set('original', '1'); else url.searchParams.delete('original');
  video.src = url.toString();
  video.addEventListener('loadedmetadata', () => { video.currentTime = at; if (playing) video.play().catch(() => {}); }, { once: true });
  btn.dataset.on = original ? '1' : '';
  btn.textContent = original ? 'Ver na versão leve' : 'Ver no original';
  const label = btn.parentElement.querySelector('[data-video-label]'); if (label) label.textContent = original ? 'Original' : 'Versão leve · 720p';
});
