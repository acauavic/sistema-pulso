// Filtros combináveis (partials/filter-builder.ejs): monta uma linha por filtro (Onde / E | Ou · campo · operador · valor)
// a partir do JSON [data-fb-def] e aplica sozinho, sem botão "Filtrar": a lista recarrega quando a linha fica completa
// (texto, número e data ao sair do campo ou no Enter; lista de opções ao fechar a lista). O painel volta aberto (fa=1).
(function () {
  'use strict';
  const form = document.querySelector('[data-fb-form]');
  const defEl = document.querySelector('[data-fb-def]');
  if (!form || !defEl) return;
  let def; try { def = JSON.parse(defEl.textContent); } catch { return; }
  const rowsEl = form.querySelector('[data-fb-rows]');
  const emptyEl = form.querySelector('[data-fb-empty]');
  const iconX = (document.querySelector('[data-fb-icons] [data-i="x"]') || {}).innerHTML || '×';
  const byKey = Object.fromEntries(def.fields.map((f) => [f.key, f]));
  const noValue = new Set(def.noValue);
  let rows = def.filters.map((f) => ({ ...f }));
  let mode = def.mode;

  const el = (tag, attrs = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'text') n.textContent = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const k of [].concat(kids)) if (k) n.append(k);
    return n;
  };
  const complete = (r) => {
    const f = byKey[r.field]; if (!f) return false;
    if (noValue.has(r.op)) return true;
    if (Array.isArray(r.value)) return r.value.length > 0;
    return r.value !== '' && r.value != null;
  };

  function apply() {
    form.querySelectorAll('input[name="f"], input[name="m"], input[name="fa"]').forEach((i) => i.remove());
    const ready = rows.filter(complete);
    for (const r of ready) {
      const v = noValue.has(r.op) ? '' : Array.isArray(r.value) ? r.value.join('|') : String(r.value);
      form.append(el('input', { type: 'hidden', name: 'f', value: v === '' ? `${r.field}~${r.op}` : `${r.field}~${r.op}~${v}` }));
    }
    if (ready.length > 1 && mode === 'ou') form.append(el('input', { type: 'hidden', name: 'm', value: 'ou' }));
    form.append(el('input', { type: 'hidden', name: 'fa', value: '1' }));
    form.submit();
  }

  // ---- lista de opções com caixas de marcar (e busca quando são muitas)
  function picker(r, f) {
    const opts = (f.type === 'user' ? [['eu', 'Eu']] : []).concat(f.options || []);
    const chosen = new Set((r.value || []).map(String));
    const label = () => {
      const names = opts.filter(([k]) => chosen.has(String(k))).map(([, l]) => l);
      return names.length ? names.join(', ') : 'Escolha…';
    };
    const box = el('details', { class: 'fb-pick' });
    const sum = el('summary', { class: 'fb-pick-btn', 'aria-label': `Valores de ${f.label}` }, [el('span', { text: label() })]);
    const list = el('div', { class: 'fb-pick-list', role: 'group', 'aria-label': f.label });
    let search = null;
    if (opts.length > 8) {
      search = el('input', { type: 'search', class: 'fb-pick-search', placeholder: 'Buscar…', 'aria-label': `Buscar em ${f.label}` });
      list.append(search);
    }
    const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const items = opts.map(([k, l]) => {
      const cb = el('input', { type: 'checkbox', value: String(k) });
      cb.checked = chosen.has(String(k));
      cb.addEventListener('change', () => { if (cb.checked) chosen.add(String(k)); else chosen.delete(String(k)); sum.firstChild.textContent = label(); });
      const item = el('label', { class: 'fb-pick-item' }, [cb, el('span', { text: l })]);
      item.dataset.q = norm(l);
      list.append(item);
      return item;
    });
    if (search) search.addEventListener('input', () => { const q = norm(search.value); items.forEach((i) => { i.hidden = q && !i.dataset.q.includes(q); }); });
    let before = [...chosen].sort().join('|');
    box.addEventListener('toggle', () => {
      if (box.open) { before = [...chosen].sort().join('|'); if (search) search.focus(); return; }
      const now = [...chosen].sort().join('|');
      r.value = [...chosen];
      if (now !== before && complete(r)) apply();
    });
    box.append(sum, list);
    return box;
  }

  function valueCell(r, f) {
    if (noValue.has(r.op)) return el('span', { class: 'fb-novalue' });
    if (f.type === 'enum' || f.type === 'user') return picker(r, f);
    let input;
    if (f.type === 'date' && (r.op === 'ultimos' || r.op === 'proximos')) {
      input = el('input', { type: 'number', min: '1', max: '3650', step: '1', value: r.value ?? '', placeholder: 'ex.: 7', 'aria-label': 'Quantos dias' });
      const wrap = el('span', { class: 'fb-days' }, [input, el('span', { class: 'small muted', text: 'dias' })]);
      hook(input, r); return wrap;
    }
    if (f.type === 'date') input = el('input', { type: 'date', value: r.value || '', 'aria-label': 'Data' });
    else if (f.type === 'number') input = el('input', { type: 'number', step: 'any', value: r.value ?? '', 'aria-label': 'Valor' });
    else input = el('input', { type: 'text', value: r.value || '', maxlength: '100', placeholder: 'Digite…', 'aria-label': 'Valor' });
    hook(input, r);
    return input;
  }
  function hook(input, r) {
    const commit = () => { const v = input.value.trim(); if (String(r.value ?? '') === v) return; r.value = v; if (complete(r) || v === '') apply(); };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  }

  function render() {
    rowsEl.textContent = '';
    if (emptyEl) emptyEl.hidden = rows.length > 0;
    rows.forEach((r, i) => {
      const f = byKey[r.field];
      let lead;
      if (i === 0) lead = el('span', { class: 'fb-lead mono', text: 'ONDE' });
      else if (i === 1) {
        lead = el('select', { class: 'fb-mode', 'aria-label': 'Combinar os filtros' });
        lead.append(el('option', { value: 'e', text: 'E' }), el('option', { value: 'ou', text: 'OU' }));
        lead.value = mode;
        lead.addEventListener('change', () => { mode = lead.value; if (rows.filter(complete).length > 1) apply(); else render(); });
      } else lead = el('span', { class: 'fb-lead mono', text: mode === 'ou' ? 'OU' : 'E' });

      const fieldSel = el('select', { class: 'fb-field', 'aria-label': 'Campo' });
      const groups = {};
      for (const fd of def.fields) { (groups[fd.group] = groups[fd.group] || []).push(fd); }
      for (const [g, list] of Object.entries(groups)) {
        const og = el('optgroup', { label: g });
        for (const fd of list) og.append(el('option', { value: fd.key, text: fd.label }));
        fieldSel.append(og);
      }
      fieldSel.value = r.field;
      fieldSel.addEventListener('change', () => {
        const nf = byKey[fieldSel.value]; const wasComplete = complete(r);
        r.field = nf.key; r.op = def.ops[nf.type][0]; r.value = nf.type === 'enum' || nf.type === 'user' ? [] : '';
        if (complete(r) || wasComplete) apply(); else render();
      });

      const opSel = el('select', { class: 'fb-op', 'aria-label': 'Condição' });
      for (const op of def.ops[f.type]) opSel.append(el('option', { value: op, text: def.opLabel[op] }));
      opSel.value = r.op;
      // o tipo do valor que a condição pede: nenhum, quantos dias, uma data ou o do campo
      const kindOf = (op) => (noValue.has(op) ? 'none' : f.type === 'date' ? (op === 'ultimos' || op === 'proximos' ? 'days' : 'date') : f.type);
      opSel.addEventListener('change', () => {
        const wasComplete = complete(r); const prevKind = kindOf(r.op);
        r.op = opSel.value;
        if (kindOf(r.op) === 'none') r.value = null;
        else if (kindOf(r.op) !== prevKind) r.value = f.type === 'enum' || f.type === 'user' ? [] : '';
        if (complete(r) || wasComplete) apply(); else render();
      });

      const del = el('button', { type: 'button', class: 'icon-btn fb-del', 'aria-label': 'Tirar este filtro', title: 'Tirar' });
      del.innerHTML = iconX;
      del.addEventListener('click', () => { const was = complete(r); rows.splice(i, 1); if (was) apply(); else render(); });

      rowsEl.append(el('div', { class: 'fb-row' }, [lead, fieldSel, opSel, valueCell(r, f), del]));
    });
  }

  form.querySelector('[data-fb-add]').addEventListener('click', () => {
    if (rows.length >= 12) return;
    const f = def.fields[0];
    rows.push({ field: f.key, op: def.ops[f.type][0], value: f.type === 'enum' || f.type === 'user' ? [] : '' });
    render();
    const last = rowsEl.lastElementChild; if (last) last.querySelector('.fb-field').focus();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  render();
  // voltou de um filtro: o painel reabre (fa=1) e o endereço fica sem o marcador
  if (/[?&]fa=1/.test(location.search)) history.replaceState(null, '', location.pathname + location.search.replace(/[?&]fa=1/, (m) => (m[0] === '?' ? '?' : '')).replace(/\?&/, '?').replace(/\?$/, ''));
}());
