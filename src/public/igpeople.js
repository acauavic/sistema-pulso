// Instagram na publicação: collab e marcação com busca, lista de alternativas e seleção múltipla (partials/ig-people.ejs).
// O bloco só aparece com o Instagram marcado. O collab já vem com o @ do convidado do episódio (dá para tirar).
// Em post/carrossel, cada marcação precisa de posição: toque na imagem com a marcação escolhida. Sem JS inline (CSP 'self').
(function () {
  const HANDLE = /^[a-z0-9._]{1,30}$/;
  const clean = (raw) => {
    let s = String(raw || '').trim().toLowerCase();
    const m = s.match(/instagram\.com\/([^/?#\s]+)/); if (m) [, s] = m;
    s = s.replace(/^@+/, '').replace(/\/+$/, '');
    return HANDLE.test(s) && !/^\.|\.$|\.\./.test(s) ? s : '';
  };

  document.querySelectorAll('[data-ig-people]').forEach((fs) => {
    const form = fs.closest('form');
    const photo = fs.dataset.photo === '1';
    const ic = (k) => fs.querySelector('template[data-igp-icons]')?.content.querySelector(`[data-i="${k}"]`)?.innerHTML || '×';
    const place = fs.querySelector('[data-igp-place]'); const stage = fs.querySelector('[data-igp-stage]'); const img = fs.querySelector('[data-igp-img]'); const hint = fs.querySelector('[data-igp-hint]');
    const fields = {};
    let episode = fs.dataset.episode || ''; let autoCollab = true; let activeTag = null;
    const tagItems = new Map(); // marcações com a posição na imagem

    // ---- de qual episódio é o item escolhido (o "Novo post" troca de item)
    const chosen = () => form.querySelector('input[type="radio"][name="clip_id"]:checked, input[type="radio"][name="cover_ids"]:checked');
    const syncTarget = () => {
      const r = chosen();
      if (r?.dataset.episode) episode = r.dataset.episode;
      if (photo && img) {
        const first = r ? String(r.value).split(',')[0] : '';
        const src = fs.dataset.img || (first ? `/capas/${first}/imagem` : '');
        if (src && img.getAttribute('src') !== src) img.src = src;
      }
    };

    // ---- um campo (collab ou marcação): chips + busca + lista
    fs.querySelectorAll('[data-igp]').forEach((box) => {
      const kind = box.dataset.igp; const max = Number(box.dataset.max) || 3;
      const chips = box.querySelector('[data-igp-chips]'); const input = box.querySelector('[data-igp-input]'); const list = box.querySelector('[data-igp-list]');
      const items = new Map(); // handle -> { chip, hidden, x, y }
      let options = []; let cursor = -1; let timer = null; let seq = 0;

      const value = (h, it) => (kind === 'tag' ? `${h}|${it.x ?? ''}|${it.y ?? ''}` : h);
      const refreshLimit = () => {
        const full = items.size >= max;
        input.disabled = full; input.placeholder = full ? `Limite de ${max} perfis` : (kind === 'collab' ? 'Buscar convidado ou digitar @perfil' : 'Buscar ou digitar @perfil');
      };
      function add(handle, { auto = false } = {}) {
        const h = clean(handle);
        if (!h || items.has(h) || items.size >= max) return false;
        if (kind === 'collab' && !auto) autoCollab = false;
        const chip = document.createElement('span'); chip.className = 'igp-chip'; chip.dataset.handle = h;
        const label = document.createElement('span'); label.textContent = `@${h}`; chip.append(label);
        const hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = kind === 'collab' ? 'ig_collab' : 'ig_tag';
        const it = { chip, hidden, x: null, y: null };
        hidden.value = value(h, it); chip.append(hidden);
        if (kind === 'tag' && photo) {
          const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'igp-pin'; pin.innerHTML = ic('map-pin');
          pin.title = 'Posicionar na imagem'; pin.setAttribute('aria-label', `Posicionar @${h} na imagem`);
          pin.addEventListener('click', () => select(h)); chip.prepend(pin);
        }
        const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'igp-x'; rm.innerHTML = ic('x');
        rm.title = 'Tirar'; rm.setAttribute('aria-label', `Tirar @${h}`);
        rm.addEventListener('click', () => { remove(h); input.focus(); });
        chip.append(rm); chips.append(chip); items.set(h, it);
        refreshLimit();
        if (kind === 'tag') { tagItems.set(h, it); if (photo) select(h); }
        return true;
      }
      function remove(h) {
        const it = items.get(h); if (!it) return;
        it.chip.remove(); items.delete(h);
        if (kind === 'collab') autoCollab = false;
        if (kind === 'tag') { tagItems.delete(h); if (activeTag === h) activeTag = [...tagItems.keys()].pop() || null; drawDots(); }
        refreshLimit();
      }
      box.igp = { add, remove, items, clear: () => [...items.keys()].forEach((h) => { const it = items.get(h); it.chip.remove(); items.delete(h); }) };
      fields[kind] = box.igp;

      // ---- busca
      const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); cursor = -1; };
      function render() {
        const typed = clean(input.value);
        const shown = options.filter((o) => !items.has(o.handle));
        if (typed && !shown.some((o) => o.handle === typed) && !items.has(typed)) shown.unshift({ handle: typed, name: '', kind: 'usar este @', free: true });
        list.replaceChildren(...shown.map((o, i) => {
          const li = document.createElement('li'); li.setAttribute('role', 'option'); li.className = `igp-opt${i === cursor ? ' on' : ''}`; li.dataset.handle = o.handle;
          const a = document.createElement('strong'); a.textContent = `@${o.handle}`;
          const b = document.createElement('span'); b.className = 'small muted'; b.textContent = o.name || '';
          const c = document.createElement('span'); c.className = 'badge b-gray'; c.textContent = o.kind;
          li.append(a, b, c);
          li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(o.handle); });
          return li;
        }));
        const open = shown.length > 0 && document.activeElement === input;
        list.hidden = !open; input.setAttribute('aria-expanded', String(open));
      }
      async function load() {
        const my = (seq += 1);
        try {
          const res = await fetch(`/social/instagram/sugestoes?q=${encodeURIComponent(input.value)}&episodio=${encodeURIComponent(episode)}`, { headers: { Accept: 'application/json' } });
          const body = await res.json();
          if (my !== seq) return; // resposta velha: outra busca já saiu
          options = body.ok ? body.items : []; cursor = -1; render();
        } catch { options = []; render(); }
      }
      function pick(h) {
        if (!add(h)) return;
        input.value = ''; options = []; close();
        if (kind === 'tag' && photo) input.blur(); // libera a imagem para posicionar a marcação
        else load(); // continua aberto para escolher mais
      }
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 180); render(); });
      input.addEventListener('focus', () => load());
      input.addEventListener('blur', () => setTimeout(close, 120));
      input.addEventListener('keydown', (e) => {
        const opts = [...list.querySelectorAll('li')];
        if (e.key === 'ArrowDown' && opts.length) { e.preventDefault(); cursor = (cursor + 1) % opts.length; render(); }
        else if (e.key === 'ArrowUp' && opts.length) { e.preventDefault(); cursor = (cursor - 1 + opts.length) % opts.length; render(); }
        else if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
          const h = cursor >= 0 && opts[cursor] ? opts[cursor].dataset.handle : clean(input.value);
          if (h) { e.preventDefault(); pick(h); } else if (e.key !== 'Tab') e.preventDefault(); // Enter não envia o formulário por engano
        } else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'Backspace' && !input.value && items.size) remove([...items.keys()].pop());
      });
      input.addEventListener('paste', () => setTimeout(() => { // colar vários @ de uma vez (separados por vírgula ou espaço)
        const parts = input.value.split(/[\s,;]+/).filter(Boolean);
        if (parts.length > 1) { parts.forEach((p) => add(p)); input.value = ''; render(); }
      }));
      refreshLimit();
    });

    // ---- posição das marcações na imagem (post e carrossel)
    function select(h) {
      activeTag = h;
      fields.tag?.items.forEach((it, k) => it.chip.classList.toggle('on', k === h));
      if (hint) hint.textContent = h ? `Toque na imagem onde está @${h}.` : '';
      drawDots();
    }
    function drawDots() {
      if (!stage) return;
      stage.querySelectorAll('.igp-dot').forEach((d) => d.remove());
      if (place) place.hidden = !tagItems.size;
      tagItems.forEach((it, h) => {
        if (it.x == null) return;
        const d = document.createElement('span'); d.className = `igp-dot${h === activeTag ? ' on' : ''}`; d.textContent = `@${h}`;
        d.style.left = `${it.x * 100}%`; d.style.top = `${it.y * 100}%`;
        stage.append(d);
      });
    }
    stage?.addEventListener('click', (e) => {
      if (!activeTag || !tagItems.has(activeTag)) return;
      const r = img.getBoundingClientRect();
      const it = tagItems.get(activeTag);
      it.x = Math.min(1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * 1000) / 1000));
      it.y = Math.min(1, Math.max(0, Math.round(((e.clientY - r.top) / r.height) * 1000) / 1000));
      it.hidden.value = `${activeTag}|${it.x}|${it.y}`;
      const next = [...tagItems.entries()].find(([, v]) => v.x == null); // passa para a próxima sem posição
      select(next ? next[0] : activeTag);
    });

    // ---- convidado do episódio já vem no collab (enquanto a pessoa não mexer)
    async function suggestGuest() {
      if (!autoCollab || !fields.collab) return;
      fields.collab.clear();
      if (!episode) return;
      try {
        const res = await fetch(`/social/instagram/sugestoes?episodio=${encodeURIComponent(episode)}`, { headers: { Accept: 'application/json' } });
        const body = await res.json();
        const g = (body.items || []).find((o) => o.kind === 'convidado do episódio');
        if (g && autoCollab) fields.collab.add(g.handle, { auto: true });
      } catch { /* sem sugestão */ }
    }

    // ---- valores atuais (reenviar editando): o collab e as marcações que já estavam no post
    let initial = null;
    try { initial = JSON.parse(fs.dataset.initial || 'null'); } catch { initial = null; }
    if (initial) {
      autoCollab = false;
      (initial.collaborators || []).forEach((h) => fields.collab?.add(h));
      (initial.tags || []).forEach((t) => { if (!fields.tag?.add(t.username)) return; const it = tagItems.get(t.username); if (it && t.x != null) { it.x = t.x; it.y = t.y; it.hidden.value = `${t.username}|${t.x}|${t.y}`; } });
      autoCollab = false; drawDots();
    }

    // ---- aparece só com o Instagram marcado
    const ig = () => form.querySelector('input[name="platforms"][value="instagram"]');
    const toggle = () => { const on = Boolean(ig()?.checked); fs.hidden = !on; fs.disabled = !on; }; // desligado: nada vai no formulário
    form.addEventListener('change', (e) => {
      if (e.target.matches('input[name="platforms"]')) toggle();
      if (e.target.matches('input[type="radio"][name="clip_id"], input[type="radio"][name="cover_ids"]')) { syncTarget(); suggestGuest(); }
    });
    syncTarget(); toggle(); if (!initial) suggestGuest();
  });
}());
