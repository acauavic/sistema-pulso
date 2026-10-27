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

  // tema: escuro (padrão) ou claro; a escolha fica só neste navegador
  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#F4F2EC' : '#0A0A0A');
    try { localStorage.setItem('pulso-theme', next); } catch { /* storage bloqueado */ }
  });

  // celular: abas e etapas que não cabem rolam de lado; a ativa já aparece (sem mexer na rolagem da página)
  document.querySelectorAll('.stepper li.now, .tabbar .on, .seg .on').forEach((el) => {
    const box = el.parentElement;
    if (box && box.scrollWidth > box.clientWidth) box.scrollLeft += el.getBoundingClientRect().left - box.getBoundingClientRect().left - 16;
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
    if (file) document.querySelector('[data-csv-text]').value = await file.text();
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
  document.querySelectorAll('[data-autosubmit]').forEach((s) => s.addEventListener('change', () => s.form.submit()));

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
    form.querySelectorAll('[name]').forEach((el) => { if (el.name !== '_csrf' && el.tagName !== 'BUTTON') el.value = data[el.name] ?? ''; });
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
