// Página do link do estúdio (/estudio/<token>): recebe pastas ou arquivos soltos, guarda o caminho de cada arquivo (câmeras repetem
// o nome: CAM_A/C0001.MP4 e CAM_B/C0001.MP4) e manda tudo pela fila de envios do painel (uploads.js). Retoma pelo caminho + tamanho,
// pula o que já chegou inteiro, mantém a tela acesa durante o envio e libera "Terminei o envio" quando nada está subindo.
(function () {
  'use strict';
  const root = document.querySelector('[data-studio]');
  if (!root) return;
  const U = window.PulsoUploads;
  const base = root.dataset.base;
  let server = []; try { server = JSON.parse(root.dataset.files || '[]'); } catch { server = []; }
  const note = root.querySelector('[data-studio-note]');
  const keep = root.querySelector('[data-studio-keep]');
  const doneBtn = root.querySelector('[data-studio-done]');
  const finishForm = root.querySelector('[data-studio-finish]');
  const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*|\.[^/]*)$/i;
  let sentThisVisit = 0;

  const say = (text) => { if (note) note.textContent = text; };

  // ---------------------------------------------------------------- leitura de pastas (arrastar)
  const readAll = (reader) => new Promise((resolve, reject) => {
    const out = [];
    const next = () => reader.readEntries((batch) => { if (!batch.length) resolve(out); else { out.push(...batch); next(); } }, reject);
    next();
  });
  async function walk(entry, prefix, out) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      for (const child of await readAll(entry.createReader())) await walk(child, `${prefix}${entry.name}/`, out);
    }
  }
  async function fromDrop(dt) {
    const out = [];
    const entries = [...(dt.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (entries.length) { for (const e of entries) await walk(e, '', out); return out; }
    return [...(dt.files || [])].map((file) => ({ file, path: file.name }));
  }
  const fromInput = (input) => [...input.files].map((file) => ({ file, path: file.webkitRelativePath || file.name }));

  // ---------------------------------------------------------------- fila
  function enqueue(list) {
    if (!U) { say('O envio não abriu neste navegador. Tente o Chrome ou o Edge atualizados.'); return; }
    const clean = list.filter((x) => x.file.size > 0 && !JUNK.test(x.path));
    let skipped = 0; let resumed = 0;
    const entries = [];
    for (const x of clean) {
      const known = server.find((f) => f.path === x.path && f.size === x.file.size);
      if (known && known.status === 'pronto') { skipped += 1; continue; }
      if (U.has(base, x.path, x.file.size)) { skipped += 1; continue; }
      if (known && known.status === 'enviando') resumed += 1;
      entries.push({ file: x.file, kind: 'estudio', name: x.path, path: x.path, resumeId: known && known.status === 'enviando' ? known.id : null });
    }
    if (entries.length) U.add(entries, { base, csrf: '', where: '' });
    const parts = [];
    if (entries.length) parts.push(`${entries.length} arquivo${entries.length > 1 ? 's' : ''} na fila`);
    if (resumed) parts.push(`${resumed} continuando de onde parou`);
    if (skipped) parts.push(`${skipped} já enviado${skipped > 1 ? 's' : ''}, pulado${skipped > 1 ? 's' : ''}`);
    if (clean.length < list.length) parts.push('arquivos de sistema ignorados');
    say(parts.length ? `${parts.join(' · ')}.` : 'Nenhum arquivo para enviar.');
    refresh();
  }

  const drop = root.querySelector('[data-studio-drop]');
  if (drop) {
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'dragend'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
    drop.addEventListener('drop', async (e) => {
      e.preventDefault(); drop.classList.remove('over');
      say('Lendo as pastas…');
      try { enqueue(await fromDrop(e.dataTransfer)); } catch { say('Não consegui ler o que foi arrastado. Use "Escolher pasta" ou "Escolher arquivos".'); }
    });
    // arrastar em qualquer lugar da página também vale
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { if (!drop.contains(e.target)) e.preventDefault(); });
    root.querySelectorAll('[data-studio-pick]').forEach((b) => b.addEventListener('click', () => root.querySelector(`[data-studio-input="${b.dataset.studioPick}"]`).click()));
    root.querySelectorAll('[data-studio-input]').forEach((input) => input.addEventListener('change', () => { enqueue(fromInput(input)); input.value = ''; }));
  }

  // ---------------------------------------------------------------- tela acesa e "Terminei"
  let lock = null;
  async function wake(on) {
    try {
      if (on && !lock && navigator.wakeLock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); }
      if (!on && lock) { await lock.release(); lock = null; }
    } catch { /* o navegador não deixou: segue sem */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && U && U.active()) wake(true); });

  function refresh() {
    const active = U ? U.active() : 0;
    const list = U ? U.list() : [];
    const failed = list.filter((x) => x.status === 'error').length;
    if (keep) keep.hidden = !active;
    wake(active > 0);
    const readyBefore = server.filter((f) => f.status === 'pronto').length;
    if (doneBtn) doneBtn.disabled = active > 0 || (readyBefore + sentThisVisit === 0);
    if (finishForm) finishForm.dataset.failed = String(failed);
  }
  if (U) U.on((ev) => { if (ev.type === 'file-done') sentThisVisit += 1; if (ev.type !== 'change' || Math.random() < 0.2) refresh(); });
  setInterval(refresh, 2000);

  if (finishForm) finishForm.addEventListener('submit', (e) => {
    if (U && U.active()) { e.preventDefault(); say('Ainda há arquivos subindo. Espere terminar para confirmar.'); return; }
    const failed = Number(finishForm.dataset.failed || 0);
    if (failed) {
      if (!window.confirm(`${failed} arquivo${failed > 1 ? 's falharam' : ' falhou'} e não chegou inteiro. Terminar mesmo assim? (Para mandar de novo, use "tentar de novo" na lista antes.)`)) { e.preventDefault(); return; }
      finishForm.querySelector('[name=mesmo_assim]').value = '1';
    }
  });
  refresh();
})();
