// Assistente flutuante: conversa por texto ou voz, com histórico. A conversa aberta e o painel aberto/fechado ficam só neste navegador.
(function () {
  const panel = document.querySelector('[data-assist]');
  const fab = document.querySelector('[data-assist-open]');
  if (!panel || !fab) return;
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  const $ = (sel) => panel.querySelector(sel);
  const msgs = $('[data-assist-msgs]'); const list = $('[data-assist-list]'); const form = $('[data-assist-form]');
  const input = $('[data-assist-input]'); const mic = $('[data-assist-mic]'); const send = $('[data-assist-send]'); const title = $('[data-assist-title]');
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sem storage */ } } };
  let convId = Number(store.get('pulso-assist-conv')) || null;
  let busy = false;

  // texto da IA -> HTML seguro: escapa tudo; depois só links INTERNOS [texto](/caminho) (nunca //outro-site nem javascript:),
  // **negrito**, listas "- " e quebras de linha
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const format = (text) => {
    const lines = esc(text).split('\n');
    let html = ''; let inList = false;
    for (const raw of lines) {
      let line = raw.replace(/\[([^\]]{1,120})\]\((\/(?!\/)[^)\s]{0,200})\)/g, '<a href="$2">$1</a>').replace(/\*\*([^*]{1,200})\*\*/g, '<strong>$1</strong>');
      const item = /^\s*[-•]\s+(.*)$/.exec(line);
      if (item) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${item[1]}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim()) html += `<p>${line}</p>`;
    }
    if (inList) html += '</ul>';
    return html || '<p></p>';
  };

  const bubble = (role, text, { audio = false, error = false } = {}) => {
    const el = document.createElement('div');
    el.className = `assist-msg ${role}${error ? ' err' : ''}`;
    if (role === 'user') { el.textContent = text; if (audio) { const t = document.createElement('span'); t.className = 'assist-tag'; t.textContent = 'por voz'; el.appendChild(t); } } else el.innerHTML = format(text);
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  };
  const typing = () => { const el = document.createElement('div'); el.className = 'assist-msg assistant typing'; el.innerHTML = '<span></span><span></span><span></span>'; el.setAttribute('aria-label', 'Pensando'); msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight; return el; };

  const SUGGESTIONS = ['O que tenho para hoje?', 'Quais as próximas gravações?', 'Em que pé estão os episódios?', 'O que está pendente nas redes?'];
  const empty = () => {
    msgs.innerHTML = '';
    const hello = document.createElement('p'); hello.className = 'assist-hello'; hello.textContent = `Oi, ${panel.dataset.user || ''}. Como posso ajudar?`;
    const box = document.createElement('div'); box.className = 'assist-suggest';
    for (const s of SUGGESTIONS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = s; b.addEventListener('click', () => ask(s)); box.appendChild(b); }
    msgs.append(hello, box);
  };

  const setConv = (id, t) => { convId = id || null; store.set('pulso-assist-conv', convId ? String(convId) : null); title.textContent = t || 'Nova conversa'; };
  const api = async (url, opts = {}) => {
    const res = await fetch(url, { ...opts, headers: { Accept: 'application/json', 'x-csrf-token': csrf, ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({ ok: false, error: `Erro ${res.status}.` }));
    if (!res.ok || data.ok === false) throw new Error(data.error || `Erro ${res.status}.`);
    return data;
  };

  async function load(id) {
    list.hidden = true; msgs.hidden = false;
    try {
      const { conversation } = await api(`/assistente/conversas/${id}`);
      setConv(conversation.id, conversation.title);
      msgs.innerHTML = '';
      if (!conversation.messages.length) empty();
      for (const m of conversation.messages) bubble(m.role, m.content, { audio: m.meta?.audio, error: m.meta?.error });
    } catch { setConv(null); empty(); }
  }

  async function ask(text, { audioBlob = null } = {}) {
    if (busy) return;
    const q = String(text || '').trim();
    if (!q && !audioBlob) return;
    busy = true; send.disabled = true; mic.disabled = true;
    if (msgs.querySelector('.assist-hello')) msgs.innerHTML = '';
    const mine = q ? bubble('user', q) : bubble('user', 'Transcrevendo o áudio…', { audio: true });
    input.value = ''; autosize();
    const wait = typing();
    try {
      const page = location.pathname;
      const data = audioBlob
        ? await api(`/assistente/audio?pagina=${encodeURIComponent(page)}${convId ? `&conversa=${convId}` : ''}`, { method: 'POST', headers: { 'Content-Type': audioBlob.type || 'audio/webm' }, body: audioBlob })
        : await api('/assistente/mensagem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: q, conversation_id: convId, page }) });
      if (audioBlob) { mine.textContent = data.transcript; const t = document.createElement('span'); t.className = 'assist-tag'; t.textContent = 'por voz'; mine.appendChild(t); }
      setConv(data.conversation.id, data.conversation.title);
      wait.remove();
      bubble('assistant', data.reply, { error: data.error });
    } catch (err) {
      wait.remove();
      if (audioBlob) mine.remove();
      bubble('assistant', err.message || 'Não consegui responder agora.', { error: true });
    } finally { busy = false; send.disabled = false; mic.disabled = false; input.focus(); }
  }

  async function history() {
    if (!list.hidden) { list.hidden = true; msgs.hidden = false; return; }
    list.innerHTML = '<p class="small muted">Carregando…</p>'; list.hidden = false; msgs.hidden = true;
    try {
      const { conversations } = await api('/assistente/conversas');
      list.innerHTML = '';
      if (!conversations.length) { list.innerHTML = '<p class="small muted">Nenhuma conversa ainda.</p>'; return; }
      for (const c of conversations) {
        const row = document.createElement('div'); row.className = 'assist-conv';
        const open = document.createElement('button'); open.type = 'button'; open.className = 'assist-conv-open';
        const strong = document.createElement('strong'); strong.textContent = c.title;
        const meta = document.createElement('span'); meta.className = 'mono small muted';
        meta.textContent = `${new Date(c.updated_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${c.messages} msg`;
        open.append(strong, meta); open.addEventListener('click', () => load(c.id));
        const del = document.createElement('button'); del.type = 'button'; del.className = 'icon-btn'; del.setAttribute('aria-label', `Apagar a conversa ${c.title}`); del.textContent = 'apagar';
        del.addEventListener('click', async () => {
          if (!window.confirm('Apagar esta conversa?')) return;
          await api(`/assistente/conversas/${c.id}/excluir`, { method: 'POST' }).catch(() => {});
          if (convId === c.id) { setConv(null); empty(); }
          row.remove();
        });
        row.append(open, del); list.appendChild(row);
      }
    } catch (err) { list.innerHTML = ''; const p = document.createElement('p'); p.className = 'small bad-text'; p.textContent = err.message; list.appendChild(p); }
  }

  // ---- gravação de voz (até 2 minutos)
  let rec = null; let chunks = []; let timer = null; let started = 0;
  const stopRec = () => { if (rec && rec.state !== 'inactive') rec.stop(); };
  async function toggleMic() {
    if (rec && rec.state === 'recording') { stopRec(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { bubble('assistant', 'Este navegador não grava áudio. Escreva a pergunta.', { error: true }); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { bubble('assistant', 'Sem acesso ao microfone. Libere o microfone para este site nas configurações do navegador.', { error: true }); return; }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timer); mic.classList.remove('on'); mic.setAttribute('aria-label', 'Gravar pergunta por voz'); input.placeholder = 'Pergunte ou grave um áudio';
      const blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
      rec = null;
      if (Date.now() - started < 700 || blob.size < 500) return; // toque acidental
      ask('', { audioBlob: blob });
    };
    rec.start();
    started = Date.now();
    mic.classList.add('on'); mic.setAttribute('aria-label', 'Parar e enviar');
    const tick = () => { const s = Math.floor((Date.now() - started) / 1000); input.placeholder = `Gravando ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · toque de novo para enviar`; if (s >= 120) stopRec(); };
    tick(); timer = setInterval(tick, 500);
  }

  // ---- abrir/fechar
  const show = (open) => {
    panel.hidden = !open; fab.setAttribute('aria-expanded', open ? 'true' : 'false'); fab.hidden = open;
    store.set('pulso-assist-open', open ? '1' : null);
    if (open) { if (!msgs.childElementCount) { if (convId) load(convId); else empty(); } setTimeout(() => input.focus(), 30); } else { stopRec(); }
  };
  const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; input.style.overflowY = input.scrollHeight > 140 ? 'auto' : 'hidden'; };

  fab.addEventListener('click', () => show(true));
  $('[data-assist-close]').addEventListener('click', () => show(false));
  $('[data-assist-new]').addEventListener('click', () => { setConv(null); list.hidden = true; msgs.hidden = false; empty(); input.focus(); });
  $('[data-assist-history]').addEventListener('click', history);
  mic.addEventListener('click', toggleMic);
  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(input.value); } });
  input.addEventListener('input', autosize);
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(false); });
  if (store.get('pulso-assist-open') === '1') show(true);
})();
