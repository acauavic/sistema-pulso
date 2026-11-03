// Tarefa por voz: grava a fala (MediaRecorder), manda ao servidor, que transcreve e organiza em um rascunho; os campos da janela
// "Nova tarefa" são preenchidos para a pessoa conferir e criar. Nada é criado sem o clique em "Criar tarefa". Sem inline script (CSP 'self').
(function () {
  const dlg = document.getElementById('modal-task-new');
  const bar = dlg && dlg.querySelector('[data-voice]');
  if (!bar) return;
  const form = dlg.querySelector('form');
  const btn = bar.querySelector('[data-voice-btn]');
  const label = bar.querySelector('[data-voice-label]');
  const status = bar.querySelector('[data-voice-status]');
  const heard = dlg.querySelector('[data-voice-heard]');
  const heardText = dlg.querySelector('[data-voice-text]');
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  const IDLE = status.textContent;
  const MAX_SECONDS = 120;
  let rec = null; let chunks = []; let timer = null; let started = 0; let discard = false; let busy = false; let starting = false;

  const icons = (mode) => { bar.querySelector('[data-voice-ic="mic"]').hidden = mode === 'rec'; bar.querySelector('[data-voice-ic="stop"]').hidden = mode !== 'rec'; };
  const say = (text, tone) => { status.textContent = text; status.classList.toggle('voice-err', tone === 'err'); };
  const reset = () => { bar.classList.remove('rec', 'busy'); icons('idle'); label.textContent = 'Falar a tarefa'; btn.disabled = false; clearInterval(timer); };

  function fill(draft) {
    const set = (name, value) => { const el = form.elements[name]; if (el && value !== null && value !== undefined && value !== '') el.value = value; };
    set('title', draft.title); const rte = form.querySelector('[data-rich]'); if (draft.description && rte && rte.rte) rte.rte.setPlain(draft.description); else set('description', draft.description); set('assignee_id', draft.assignee_id); set('due_on', draft.due_on); if (draft.due_on && form.elements.due_time) form.elements.due_time.value = draft.due_time || ''; // prazo novo vale com a hora dita (ou sem hora) set('kind', draft.kind);
    set('episode_id', draft.episode_id); set('guest_id', draft.guest_id); set('sponsor_id', draft.sponsor_id);
    if (draft.episode_id || draft.guest_id || draft.sponsor_id) { const d = form.querySelector('details'); if (d) d.open = true; }
    form.elements.title?.focus();
  }

  async function send(blob) {
    busy = true; bar.classList.add('busy'); btn.disabled = true; label.textContent = 'Organizando…'; say('Entendendo o que você disse e organizando a tarefa…');
    try {
      const res = await fetch(bar.dataset.url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': blob.type || 'audio/webm', 'x-csrf-token': csrf }, body: blob });
      const body = await res.json().catch(() => ({}));
      if (body.transcript && heard) { heardText.textContent = body.transcript; heard.hidden = false; }
      if (!res.ok || !body.ok) throw new Error(body.error || `erro ${res.status}`);
      fill(body.draft);
      say(body.warnings && body.warnings.length ? body.warnings.join(' ') : 'Pronto. Confira os campos e toque em Criar tarefa.', body.warnings && body.warnings.length ? 'err' : undefined);
    } catch (err) {
      say(err.message, 'err');
    } finally { busy = false; reset(); }
  }

  async function start() {
    if (busy || rec || starting) return; // toque duplo enquanto o navegador pede o microfone
    starting = true;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { starting = false; say('Este navegador não grava áudio. Escreva a tarefa.', 'err'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { starting = false; say('Sem acesso ao microfone. Libere o microfone para este site nas configurações do navegador.', 'err'); return; }
    if (!dlg.open) { starting = false; stream.getTracks().forEach((t) => t.stop()); return; } // a janela foi fechada enquanto o navegador pedia o microfone
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = []; discard = false;
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
      const tooShort = Date.now() - started < 800 || blob.size < 500;
      rec = null; clearInterval(timer);
      if (discard) { reset(); say(IDLE); return; }
      if (tooShort) { reset(); say('A gravação ficou curta demais. Toque e fale o que precisa ser feito.', 'err'); return; }
      send(blob);
    };
    rec.start(); started = Date.now(); starting = false;
    bar.classList.add('rec'); icons('rec'); label.textContent = 'Parar e organizar';
    const tick = () => { const s = Math.floor((Date.now() - started) / 1000); say(`Gravando ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}. Fale à vontade e toque em Parar quando acabar.`); if (s >= MAX_SECONDS) stop(); };
    tick(); timer = setInterval(tick, 500);
  }
  const stop = () => { if (rec && rec.state === 'recording') rec.stop(); };
  const cancel = () => { if (rec && rec.state === 'recording') { discard = true; rec.stop(); } };

  btn.addEventListener('click', () => (rec ? stop() : start()));
  dlg.addEventListener('close', cancel);   // fechar a janela descarta a gravação em andamento
  dlg.addEventListener('cancel', cancel);
  window.addEventListener('pagehide', cancel);

  // Botão do cabeçalho: abre a janela e já começa a gravar.
  document.querySelectorAll('[data-voice-open]').forEach((b) => b.addEventListener('click', () => { if (!dlg.open) dlg.showModal(); start(); }));
})();
