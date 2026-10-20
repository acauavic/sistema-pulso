// Editor de texto rico das tarefas e dos comentários (no estilo do ClickUp): negrito, itálico, títulos, listas, citação, código,
// links (só a URL ou miniatura), tabelas, imagens coladas/arrastadas, documentos (PDF, HTML, ZIP) e, nos comentários, áudio com
// transcrição e @menções. O servidor limpa o HTML de novo (lista branca): aqui a limpeza serve só para o texto colado ficar bonito.
// Sem inline script (CSP 'self'). Também mostra o conteúdo salvo: miniaturas de link, @menções destacadas e imagens ampliáveis.
(function () {
  'use strict';
  if (window.PulsoRich) return; // o editor pode ser pedido por mais de um trecho da mesma página
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  const team = (() => { try { return JSON.parse(document.getElementById('team-users')?.textContent || '[]'); } catch { return []; } })();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fmtBytes = (n) => { const u = ['B', 'KB', 'MB']; let i = 0; let x = n; while (x >= 1024 && i < 2) { x /= 1024; i += 1; } return `${x >= 100 || i === 0 ? Math.round(x) : x.toFixed(1).replace('.', ',')} ${u[i]}`; };
  const clock = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const icons = (() => { const t = document.querySelector('template[data-rte-icons]'); return (n) => (t ? (t.content.querySelector(`[data-i="${n}"]`)?.innerHTML || '') : ''); })();

  const URL_RE = /^(https?:\/\/[^\s<>"']+)$/i;

  // ---------------------------------------------------------------- limpeza do que é colado
  const KEEP = { P: 'p', BR: 'br', STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u', S: 's', STRIKE: 's', DEL: 's', CODE: 'code', PRE: 'pre', BLOCKQUOTE: 'blockquote', H1: 'h2', H2: 'h2', H3: 'h3', H4: 'h3', UL: 'ul', OL: 'ol', LI: 'li', A: 'a', TABLE: 'table', THEAD: 'thead', TBODY: 'tbody', TR: 'tr', TH: 'th', TD: 'td', HR: 'hr', DIV: 'p' };
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'SVG', 'IMG']);
  function cleanInto(node, out) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(node.nodeValue)); return; }
    if (node.nodeType !== 1 || DROP.has(node.tagName)) return;
    const tag = KEEP[node.tagName];
    if (!tag || ((node.tagName === 'B' || node.tagName === 'STRONG') && /font-weight:\s*(normal|400)/i.test(node.getAttribute('style') || ''))) { node.childNodes.forEach((c) => cleanInto(c, out)); return; }
    const el = document.createElement(tag);
    if (tag === 'a') { const h = node.getAttribute('href') || ''; if (!/^(https?:|mailto:)/i.test(h)) { node.childNodes.forEach((c) => cleanInto(c, out)); return; } el.setAttribute('href', h); }
    node.childNodes.forEach((c) => cleanInto(c, el));
    out.appendChild(el);
  }
  function cleanHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const box = document.createElement('div');
    doc.body.childNodes.forEach((c) => cleanInto(c, box));
    return box.innerHTML;
  }
  const plainToHtml = (text) => String(text ?? '').replace(/\r/g, '').trim().split(/\n{2,}/).filter(Boolean).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${esc(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(esc).join('<br>')}</p>`;
  }).join('');

  async function upload(blob, { filename = '', duration = 0 } = {}) {
    const headers = { Accept: 'application/json', 'x-csrf-token': csrf, 'Content-Type': blob.type || 'application/octet-stream', 'x-filename': encodeURIComponent(filename) };
    if (duration) headers['x-duration-ms'] = String(duration);
    const res = await fetch('/anexos', { method: 'POST', headers, body: blob });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || `erro ${res.status}`);
    return body;
  }

  // ---------------------------------------------------------------- o editor
  function init(root) {
    const area = root.querySelector('.rte-area');
    const hidden = root.querySelector('[data-rte-html]');
    const status = root.querySelector('[data-rte-status]');
    const filesBox = root.querySelector('[data-rte-files]');
    const linkBar = root.querySelector('[data-rte-linkbar]');
    const tableBar = root.querySelector('[data-rte-tablebar]');
    const picker = root.querySelector('[data-rte-picker]');
    const mentionList = root.querySelector('[data-rte-mentions]');
    const form = root.closest('form');
    const attachName = root.dataset.attach || 'attachment_ids';
    let saved = null; let pending = 0; let linkTarget = null; let linkTimer = null;

    const say = (t, err) => { if (status) { status.textContent = t || ''; status.classList.toggle('err', Boolean(err)); } };
    const isEmptyHtml = (h) => !/<(img|table|hr)\b/i.test(h) && !h.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim();
    const sync = () => { hidden.value = isEmptyHtml(area.innerHTML) ? '' : area.innerHTML; };
    const inArea = (n) => n && area.contains(n.nodeType === 1 ? n : n.parentNode);
    const remember = () => { const s = window.getSelection(); if (s.rangeCount && inArea(s.anchorNode)) saved = s.getRangeAt(0).cloneRange(); };
    const restore = () => { area.focus(); if (saved) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(saved); } };
    const exec = (cmd, val) => { restore(); document.execCommand(cmd, false, val); sync(); remember(); refreshBar(); };
    const insertHtml = (html) => exec('insertHTML', html);
    const closest = (tag) => { const s = window.getSelection(); if (!s.anchorNode || !inArea(s.anchorNode)) return null; let n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentNode; while (n && n !== area) { if (n.matches?.(tag)) return n; n = n.parentNode; } return null; };

    root.rte = {
      getHTML: () => hidden.value,
      setHTML(html) { area.innerHTML = html || ''; sync(); },
      setPlain(text) { area.innerHTML = plainToHtml(text); sync(); },
      focus: () => area.focus(),
      pending: () => pending > 0,
      reset() { area.innerHTML = ''; hidden.value = ''; filesBox.replaceChildren(); say(''); if (linkBar) linkBar.hidden = true; },
    };
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* navegador antigo */ }
    if (hidden.value && !area.innerHTML.trim()) area.innerHTML = hidden.value;
    sync();

    // ---- barra de formatação
    const COMMANDS = {
      bold: () => exec('bold'), italic: () => exec('italic'), underline: () => exec('underline'), strike: () => exec('strikeThrough'),
      h2: () => exec('formatBlock', closest('h2') ? '<p>' : '<h2>'),
      ul: () => exec('insertUnorderedList'), ol: () => exec('insertOrderedList'),
      quote: () => exec('formatBlock', closest('blockquote') ? '<p>' : '<blockquote>'),
      code: () => {
        const c = closest('code');
        if (c) { c.replaceWith(document.createTextNode(c.textContent)); sync(); return; }
        restore(); const text = window.getSelection().toString();
        if (text) insertHtml(`<code>${esc(text)}</code>`); else exec('formatBlock', closest('pre') ? '<p>' : '<pre>');
      },
      link: () => openLinkBar(closest('a')),
      table: () => insertTable(),
      attach: () => picker?.click(),
      mic: () => toggleRec(),
    };
    root.querySelector('.rte-bar')?.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // não tira o foco do texto
    root.querySelector('.rte-bar')?.addEventListener('click', (e) => { const b = e.target.closest('[data-cmd]'); if (b && COMMANDS[b.dataset.cmd]) { remember(); COMMANDS[b.dataset.cmd](); } });
    function refreshBar() {
      const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
      const on = { bold: q('bold'), italic: q('italic'), underline: q('underline'), strike: q('strikeThrough'), ul: q('insertUnorderedList'), ol: q('insertOrderedList'), h2: Boolean(closest('h2')), quote: Boolean(closest('blockquote')), code: Boolean(closest('code') || closest('pre')), link: Boolean(closest('a')) };
      root.querySelectorAll('[data-cmd]').forEach((b) => { if (b.dataset.cmd in on) b.classList.toggle('on', Boolean(on[b.dataset.cmd] && inArea(window.getSelection().anchorNode))); });
      if (tableBar) tableBar.hidden = !closest('table');
    }
    document.addEventListener('selectionchange', () => { if (inArea(window.getSelection().anchorNode)) { remember(); refreshBar(); } });

    // ---- o texto sempre mora dentro de um bloco (<p>): o navegador às vezes deixa texto solto na raiz
    function normalizeRoot() {
      const s = window.getSelection(); const an = s.anchorNode; const off = s.anchorOffset; let changed = false;
      let run = null;
      [...area.childNodes].forEach((c) => {
        const inline = (c.nodeType === 3 && (c.nodeValue.trim() || run)) || (c.nodeType === 1 && /^(B|STRONG|I|EM|U|S|A|CODE|SPAN)$/.test(c.tagName));
        if (!inline) { run = null; return; }
        if (!run) { run = document.createElement('p'); c.replaceWith(run); }
        run.appendChild(c); changed = true;
      });
      if (changed && an && area.contains(an)) { const r = document.createRange(); r.setStart(an, Math.min(off, an.nodeType === 3 ? an.nodeValue.length : an.childNodes.length)); r.collapse(true); s.removeAllRanges(); s.addRange(r); }
    }
    const caretEnd = (el) => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); };

    // ---- atalhos em markdown: "- ", "1. ", "## ", "> "
    const MD = [[/^[-*]\s$/, 'ul'], [/^1[.)]\s$/, 'ol'], [/^##?\s$/, 'h2'], [/^>\s$/, 'blockquote']];
    area.addEventListener('input', (e) => {
      if (e.inputType === 'insertText' || e.inputType === 'insertFromPaste') normalizeRoot();
      if (e.inputType === 'insertText' && e.data === ' ') {
        const s = window.getSelection(); const n = s.anchorNode;
        if (n && n.nodeType === 3 && n.parentNode.tagName === 'P' && n.parentNode.parentNode === area && n.parentNode.firstChild === n) {
          const t = n.nodeValue.slice(0, s.anchorOffset);
          const rule = MD.find(([re]) => re.test(t));
          if (rule) {
            n.nodeValue = n.nodeValue.slice(t.length);
            const blk = n.parentNode; const el = document.createElement(rule[1]);
            if (rule[1] === 'ul' || rule[1] === 'ol') { const li = document.createElement('li'); while (blk.firstChild) li.appendChild(blk.firstChild); if (!li.textContent) li.innerHTML = '<br>'; el.appendChild(li); blk.replaceWith(el); caretEnd(li); }
            else { while (blk.firstChild) el.appendChild(blk.firstChild); if (!el.textContent) el.innerHTML = '<br>'; blk.replaceWith(el); caretEnd(el); }
          }
        }
      }
      sync();
      mentionCheck();
    });

    // ---- colar, soltar e anexar
    function pastedUrl(text) { const t = String(text || '').trim(); return URL_RE.test(t) ? t : null; }
    area.addEventListener('paste', (e) => {
      const cd = e.clipboardData; if (!cd) return;
      const files = [...cd.files];
      if (files.length) { e.preventDefault(); handleFiles(files); return; }
      const text = cd.getData('text/plain'); const html = cd.getData('text/html');
      const url = pastedUrl(text);
      if (url && !window.getSelection().toString()) { e.preventDefault(); insertHtml(`<a href="${esc(url)}">${esc(url)}</a>&nbsp;`); const a = [...area.querySelectorAll('a')].find((x) => x.getAttribute('href') === url); if (a) showLinkChoice(a); return; }
      if (html) { e.preventDefault(); insertHtml(cleanHtml(html)); }
    });
    area.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); root.classList.add('dropping'); } });
    area.addEventListener('dragleave', () => root.classList.remove('dropping'));
    area.addEventListener('drop', (e) => { root.classList.remove('dropping'); const files = [...(e.dataTransfer?.files || [])]; if (files.length) { e.preventDefault(); handleFiles(files); } });
    picker?.addEventListener('change', () => { const files = [...picker.files]; picker.value = ''; handleFiles(files); });

    async function handleFiles(files) {
      for (const f of files) {
        pending += 1; say(`Enviando ${f.name || 'imagem'}…`);
        try {
          const r = await upload(f, { filename: f.name || 'imagem.png' });
          const a = r.attachment;
          if (a.kind === 'image') insertHtml(`<img src="${esc(a.url)}" alt="">`);
          else addChip(a);
          say('');
        } catch (err) { say(err.message, true); } finally { pending -= 1; }
      }
    }

    // ---- anexos soltos (documentos e áudios) listados abaixo do texto
    function addChip(a, extra = {}) {
      const el = document.createElement('div');
      el.className = `rte-chip ${a.kind === 'audio' ? 'is-audio' : ''}`; el.dataset.id = a.id;
      const input = document.createElement('input'); input.type = 'hidden'; input.name = attachName; input.value = a.id; el.appendChild(input);
      if (a.kind === 'audio') {
        el.insertAdjacentHTML('beforeend', `<div class="rte-chip-head"><span class="rte-ic">${icons('mic')}</span><strong>${esc(a.name)}</strong>${a.duration_ms ? `<span class="mono small muted">${clock(a.duration_ms)}</span>` : ''}</div>`
          + `<audio controls preload="none" src="${esc(a.url)}"></audio>`
          + (a.transcript ? `<p class="rte-transcript small">${esc(a.transcript)}</p><div class="row"><button type="button" class="link small" data-act="insert-transcript">Inserir a transcrição no texto</button></div>` : `<p class="small muted">${esc(extra.transcribeError || 'Sem transcrição.')}</p>`));
        el.dataset.transcript = a.transcript || '';
      } else {
        el.insertAdjacentHTML('beforeend', `<span class="rte-ic">${icons('file-text')}</span><a href="${esc(a.url)}/baixar" class="rte-chip-name">${esc(a.name)}</a><span class="mono small muted">${fmtBytes(a.size)}</span>`);
      }
      el.insertAdjacentHTML('beforeend', `<button type="button" class="icon-btn" data-act="remove" aria-label="Remover anexo" title="Remover">${icons('x')}</button>`);
      filesBox.appendChild(el);
      return el;
    }
    filesBox?.addEventListener('click', async (e) => {
      const chip = e.target.closest('.rte-chip'); const act = e.target.closest('[data-act]')?.dataset.act; if (!chip || !act) return;
      if (act === 'remove') {
        chip.classList.add('busy');
        try { const res = await fetch(`/anexos/${chip.dataset.id}/excluir`, { method: 'POST', headers: { Accept: 'application/json', 'x-csrf-token': csrf } }); if (!res.ok && res.status !== 404) throw new Error(); chip.remove(); } catch { chip.classList.remove('busy'); say('Não consegui remover o anexo.', true); }
      } else if (act === 'insert-transcript') { insertHtml(plainToHtml(chip.dataset.transcript)); area.focus(); }
    });

    // ---- link: só a URL ou miniatura
    function openLinkBar(a) {
      linkTarget = a || null;
      const input = linkBar.querySelector('input'); const card = linkBar.querySelector('[data-link-card]');
      input.value = a ? (a.getAttribute('href') || '') : ''; card.checked = Boolean(a && a.dataset.card === '1');
      linkBar.querySelector('[data-link-open]').hidden = !a; linkBar.querySelector('[data-link-remove]').hidden = !a;
      linkBar.querySelector('[data-link-choice]').hidden = true; linkBar.querySelector('[data-link-form]').hidden = false;
      linkBar.hidden = false; input.focus(); input.select();
    }
    function showLinkChoice(a) {
      clearTimeout(linkTimer); linkTarget = a;
      linkBar.querySelector('[data-link-form]').hidden = true; linkBar.querySelector('[data-link-choice]').hidden = false; linkBar.hidden = false;
      linkTimer = setTimeout(() => { linkBar.hidden = true; }, 10000);
    }
    const closeLinkBar = () => { clearTimeout(linkTimer); linkBar.hidden = true; restore(); };
    linkBar?.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.linkApply !== undefined) {
        const url = linkBar.querySelector('input').value.trim(); const card = linkBar.querySelector('[data-link-card]').checked;
        if (!/^(https?:\/\/|mailto:)/i.test(url)) { say('Use um endereço que comece com http:// ou https://', true); return; }
        if (linkTarget) { linkTarget.setAttribute('href', url); card ? linkTarget.setAttribute('data-card', '1') : linkTarget.removeAttribute('data-card'); sync(); } else { restore(); exec('createLink', url); const a = closest('a'); if (a && card) a.setAttribute('data-card', '1'); sync(); }
        say(''); closeLinkBar();
      } else if (b.dataset.linkRemove !== undefined) { if (linkTarget) { linkTarget.replaceWith(...linkTarget.childNodes); sync(); } closeLinkBar(); }
      else if (b.dataset.linkOpen !== undefined) { const h = linkBar.querySelector('input').value; if (/^https?:/i.test(h)) window.open(h, '_blank', 'noopener'); }
      else if (b.dataset.linkUrl !== undefined) { closeLinkBar(); }
      else if (b.dataset.linkThumb !== undefined) { if (linkTarget) { linkTarget.setAttribute('data-card', '1'); sync(); say('Vai aparecer como miniatura depois de salvar.'); } closeLinkBar(); }
      else if (b.dataset.linkClose !== undefined) closeLinkBar();
    });
    linkBar?.querySelector('input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); linkBar.querySelector('[data-link-apply]').click(); } else if (e.key === 'Escape') closeLinkBar(); });
    area.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a && area.contains(a)) { e.preventDefault(); remember(); openLinkBar(a); } });

    // ---- tabelas
    function insertTable(rows = 3, cols = 3) {
      const cell = (tag) => `<${tag}><br></${tag}>`;
      const head = `<tr>${Array.from({ length: cols }, () => cell('th')).join('')}</tr>`;
      const body = Array.from({ length: rows - 1 }, () => `<tr>${Array.from({ length: cols }, () => cell('td')).join('')}</tr>`).join('');
      insertHtml(`<table><tbody>${head}${body}</tbody></table><p><br></p>`);
      const first = area.querySelector('table:last-of-type th, table:last-of-type td'); if (first) { const r = document.createRange(); r.selectNodeContents(first); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      sync(); refreshBar();
    }
    const cellOf = () => closest('td, th');
    const makeCell = (tag) => { const c = document.createElement(tag); c.innerHTML = '<br>'; return c; };
    const TABLE_OPS = {
      'row-above': () => { const c = cellOf(); if (!c) return; const tr = c.parentNode; const n = tr.cloneNode(false); [...tr.children].forEach(() => n.appendChild(makeCell('td'))); tr.before(n); },
      'row-below': () => { const c = cellOf(); if (!c) return; const tr = c.parentNode; const n = tr.cloneNode(false); [...tr.children].forEach(() => n.appendChild(makeCell('td'))); tr.after(n); },
      'col-left': () => { const c = cellOf(); if (!c) return; const i = [...c.parentNode.children].indexOf(c); c.closest('table').querySelectorAll('tr').forEach((tr) => { const ref = tr.children[i]; const n = makeCell(ref && ref.tagName === 'TH' ? 'th' : 'td'); ref ? ref.before(n) : tr.appendChild(n); }); },
      'col-right': () => { const c = cellOf(); if (!c) return; const i = [...c.parentNode.children].indexOf(c); c.closest('table').querySelectorAll('tr').forEach((tr) => { const ref = tr.children[i]; const n = makeCell(ref && ref.tagName === 'TH' ? 'th' : 'td'); ref ? ref.after(n) : tr.appendChild(n); }); },
      'row-del': () => { const c = cellOf(); if (!c) return; const tr = c.parentNode; const t = tr.closest('table'); if (t.querySelectorAll('tr').length <= 1) t.remove(); else tr.remove(); },
      'col-del': () => { const c = cellOf(); if (!c) return; const i = [...c.parentNode.children].indexOf(c); const t = c.closest('table'); if (c.parentNode.children.length <= 1) { t.remove(); return; } t.querySelectorAll('tr').forEach((tr) => tr.children[i]?.remove()); },
      'table-del': () => { const t = closest('table'); if (t) t.remove(); },
    };
    tableBar?.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    tableBar?.addEventListener('click', (e) => { const b = e.target.closest('[data-table-op]'); if (!b) return; restore(); TABLE_OPS[b.dataset.tableOp]?.(); sync(); refreshBar(); });
    area.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const c = cellOf(); if (!c) return;
      e.preventDefault();
      const all = [...c.closest('table').querySelectorAll('th, td')]; const i = all.indexOf(c);
      let next = all[i + (e.shiftKey ? -1 : 1)];
      if (!next && !e.shiftKey) { TABLE_OPS['row-below'](); sync(); next = [...c.closest('table').querySelectorAll('th, td')][i + 1]; }
      if (next) { const r = document.createRange(); r.selectNodeContents(next); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    });

    // ---- @menções (comentários)
    let mStart = null; let mPos = 0; let mOpts = [];
    const mHide = () => { if (mentionList) mentionList.hidden = true; mStart = null; };
    function mentionCheck() {
      if (!mentionList) return;
      const s = window.getSelection(); const n = s.anchorNode;
      if (!n || n.nodeType !== 3 || !inArea(n)) { mHide(); return; }
      const upto = n.nodeValue.slice(0, s.anchorOffset);
      const m = upto.match(/(^|\s)@([\p{L}\p{N} ]{0,30})$/u);
      if (!m) { mHide(); return; }
      mStart = { node: n, from: upto.length - m[2].length - 1, to: s.anchorOffset };
      const q = norm(m[2]);
      mOpts = team.filter((u) => norm(u.name).startsWith(q) || norm(u.name).includes(` ${q}`)).slice(0, 6);
      if (!mOpts.length) { mHide(); return; }
      mPos = 0;
      mentionList.innerHTML = mOpts.map((u, i) => `<li role="option" data-i="${i}" class="${i === 0 ? 'on' : ''}"><span class="dot-av">${esc(u.ini)}</span>${esc(u.name)}</li>`).join('');
      mentionList.hidden = false;
    }
    function mPick(u) {
      if (!mStart) return;
      const { node, from, to } = mStart;
      node.nodeValue = `${node.nodeValue.slice(0, from)}@${u.name} ${node.nodeValue.slice(to)}`;
      const r = document.createRange(); r.setStart(node, from + u.name.length + 2); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      mHide(); sync();
    }
    mentionList?.addEventListener('mousedown', (e) => { const li = e.target.closest('li'); if (li) { e.preventDefault(); mPick(mOpts[Number(li.dataset.i)]); } });
    area.addEventListener('keydown', (e) => {
      if (mentionList && !mentionList.hidden) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mPos = (mPos + (e.key === 'ArrowDown' ? 1 : -1) + mOpts.length) % mOpts.length; mentionList.querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', i === mPos)); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); mPick(mOpts[mPos]); return; }
        if (e.key === 'Escape') { mHide(); return; }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && root.dataset.submit === 'ctrl-enter') { e.preventDefault(); form?.requestSubmit(); }
    });
    area.addEventListener('blur', () => setTimeout(mHide, 150));

    // ---- gravação de áudio com transcrição (comentários)
    let rec = null; let chunks = []; let started = 0; let timer = null; let stream = null; let discard = false;
    const micBtn = root.querySelector('[data-cmd="mic"]');
    async function toggleRec() {
      if (rec && rec.state === 'recording') { rec.stop(); return; }
      if (rec) return;
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { say('Este navegador não grava áudio.', true); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { say('Sem acesso ao microfone. Libere o microfone para este site nas configurações do navegador.', true); return; }
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined); chunks = []; discard = false;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); clearInterval(timer);
        micBtn?.classList.remove('rec'); micBtn?.setAttribute('aria-label', 'Gravar áudio');
        const dur = Date.now() - started; const blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] }); rec = null;
        if (discard) { say(''); return; }
        if (dur < 800 || blob.size < 500) { say('A gravação ficou curta demais.', true); return; }
        pending += 1; say('Enviando e transcrevendo o áudio…');
        try { const r = await upload(blob, { filename: 'audio.webm', duration: dur }); addChip(r.attachment, { transcribeError: r.transcribeError }); say(r.transcribeError || ''); if (r.transcribeError) say(r.transcribeError, true); } catch (err) { say(err.message, true); } finally { pending -= 1; }
      };
      rec.start(); started = Date.now(); micBtn?.classList.add('rec'); micBtn?.setAttribute('aria-label', 'Parar e enviar o áudio');
      const tick = () => { const s = Math.floor((Date.now() - started) / 1000); say(`Gravando ${clock(Date.now() - started)}. Toque no microfone para parar.`); if (s >= 120) rec?.stop(); };
      tick(); timer = setInterval(tick, 500);
    }
    window.addEventListener('pagehide', () => { if (rec && rec.state === 'recording') { discard = true; rec.stop(); } });

    // ---- envio do formulário
    form?.addEventListener('submit', (e) => {
      sync();
      if (pending > 0) { e.preventDefault(); say('Espere o envio do anexo terminar.', true); return; }
      if (root.dataset.require === '1' && !hidden.value && !filesBox.querySelector('.rte-chip')) { e.preventDefault(); say('Escreva algo, anexe um arquivo ou grave um áudio.', true); area.focus(); }
    });
  }

  // ---------------------------------------------------------------- mostrar o conteúdo salvo
  const cardCache = new Map();
  async function preview(url) {
    if (!cardCache.has(url)) cardCache.set(url, fetch(`/previa-link?url=${encodeURIComponent(url)}`, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return cardCache.get(url);
  }
  async function hydrateCards(scope) {
    for (const a of scope.querySelectorAll('a[data-card="1"]')) {
      const p = await preview(a.href);
      if (!p || !p.ok) continue;
      const card = document.createElement('a');
      card.className = 'link-card'; card.href = a.href; card.target = '_blank'; card.rel = 'noopener noreferrer nofollow';
      card.innerHTML = (p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '')
        + `<span class="link-card-body"><strong>${esc(p.title || p.site || a.href)}</strong>${p.description ? `<span class="small">${esc(p.description)}</span>` : ''}<span class="mono small muted">${esc(p.site || '')}</span></span>`;
      const parent = a.parentElement;
      if (parent && parent.tagName === 'P' && parent.textContent.trim() === a.textContent.trim()) parent.replaceWith(card); else a.replaceWith(card);
    }
  }
  function highlightMentions(scope) {
    const names = [...new Set(team.flatMap((u) => [u.name, u.name.split(/\s+/)[0]]))].filter(Boolean).sort((x, y) => y.length - x.length);
    if (!names.length) return;
    const re = new RegExp(`@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('a, code, pre, .mention') ? NodeFilter.FILTER_REJECT : (re.lastIndex = 0, re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)) });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      const frag = document.createDocumentFragment(); let last = 0; re.lastIndex = 0; let m;
      while ((m = re.exec(n.nodeValue))) { frag.append(n.nodeValue.slice(last, m.index)); const s = document.createElement('span'); s.className = 'mention'; s.textContent = m[0]; frag.append(s); last = m.index + m[0].length; }
      frag.append(n.nodeValue.slice(last)); n.replaceWith(frag);
    });
  }
  function hydrate(scope = document) {
    scope.querySelectorAll('.rich-content:not(.rte-area)').forEach((el) => { // o editor não vira miniatura: lá o link fica editável
      hydrateCards(el);
      if (el.dataset.mentions === '1') highlightMentions(el);
      el.querySelectorAll('img').forEach((img) => { img.tabIndex = 0; img.title = 'Abrir em tamanho real'; });
    });
  }
  document.addEventListener('click', (e) => { const img = e.target.closest('.rich-content:not(.rte-area) img'); if (img) window.open(img.src, '_blank', 'noopener'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches?.('.rich-content:not(.rte-area) img')) window.open(e.target.src, '_blank', 'noopener'); });

  // remover documento já salvo na tarefa
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-attachment-delete]'); if (!b) return;
    if (!window.confirm('Remover este anexo?')) return;
    try { const res = await fetch(`/anexos/${b.dataset.attachmentDelete}/excluir`, { method: 'POST', headers: { Accept: 'application/json', 'x-csrf-token': csrf } }); if (!res.ok && res.status !== 404) throw new Error(); b.closest('li')?.remove(); } catch { window.alert('Não consegui remover o anexo.'); }
  });

  // descrição da tarefa: lê primeiro, edita sob demanda
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-desc-edit]'); if (!b) return;
    const box = b.closest('[data-desc]'); box.querySelector('[data-desc-view]').hidden = true; b.hidden = true;
    const ed = box.querySelector('[data-desc-editor]'); ed.hidden = false; ed.querySelector('.rte-area').focus();
  });

  window.PulsoRich = { hydrate, init, plainToHtml };
  const boot = () => { document.querySelectorAll('[data-rich]').forEach(init); hydrate(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
