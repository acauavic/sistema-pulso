// Formulário do patrocinador: envio da logo e respostas por voz (grava, transcreve na Groq e deixa a pessoa revisar).
// Sem inline script (CSP 'self'). A rota recebe o corpo cru; o texto transcrito vai para a caixa e continua editável.
(function () {
  const form = document.querySelector('[data-brief]');
  if (!form) return;
  const base = form.dataset.base;
  const csrf = form.dataset.csrf;

  // ---- logo ----
  const logoInput = form.querySelector('[data-logo-file]');
  const logoState = form.querySelector('[data-logo-state]');
  const logoImg = form.querySelector('[data-logo-img]');
  const setLogoState = (text, warn) => { logoState.textContent = text; logoState.classList.toggle('warn', Boolean(warn)); };
  logoInput?.addEventListener('change', async () => {
    const file = logoInput.files[0];
    if (!file) return;
    if (file.type !== 'image/png') { setLogoState('Envie a logo em PNG.', true); logoInput.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { setLogoState('O arquivo passa de 5 MB.', true); logoInput.value = ''; return; }
    setLogoState('Enviando…');
    try {
      const res = await fetch(`${base}/logo?nome=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'x-csrf-token': csrf }, body: file });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || `erro ${res.status}`);
      logoImg.src = `${json.url}?t=${Date.now()}`;
      logoImg.hidden = false;
      setLogoState(json.hasAlpha ? 'Logo enviada.' : 'Logo enviada. Ela parece ter fundo; se tiver a versão transparente, pode enviar de novo.', !json.hasAlpha);
    } catch (err) {
      setLogoState(`Não foi possível enviar: ${err.message}`, true);
    }
  });

  // ---- voz ----
  const MAX_SECONDS = 300;
  const supported = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  let active = null; // { recorder, stream, timer, box }

  const pickMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) || '';

  function stopActive() {
    if (!active) return;
    clearTimeout(active.timer);
    if (active.recorder.state !== 'inactive') active.recorder.stop();
  }

  form.querySelectorAll('[data-voice]').forEach((box) => {
    const button = box.querySelector('[data-voice-toggle]');
    if (!button) return;
    const status = box.querySelector('[data-voice-status]');
    const area = box.querySelector('textarea');
    const say = (text, err) => { status.textContent = text; status.classList.toggle('err', Boolean(err)); };
    if (!supported) { button.hidden = true; return; }

    button.addEventListener('click', async () => {
      if (active && active.box === box) { stopActive(); return; }
      if (active) { say('Termine a outra gravação primeiro.', true); return; }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        say('Não conseguimos acessar o microfone. Libere a permissão no navegador ou digite a resposta.', true);
        return;
      }
      const mime = pickMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = (recorder.mimeType || mime || 'audio/webm').split(';')[0];
        active = null;
        button.classList.remove('rec');
        button.textContent = 'Responder por voz';
        button.disabled = true;
        say('Transcrevendo…');
        try {
          const blob = new Blob(chunks, { type });
          const res = await fetch(`${base}/audio?campo=${encodeURIComponent(box.dataset.field)}`, { method: 'POST', headers: { 'Content-Type': type, 'x-csrf-token': csrf }, body: blob });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.ok) throw new Error(json.error || `erro ${res.status}`);
          area.value = area.value.trim() ? `${area.value.trim()}\n${json.text}` : json.text;
          area.focus();
          say('Transcrição pronta. Revise e edite o texto antes de enviar.');
        } catch (err) {
          say(err.message, true);
        } finally {
          button.disabled = false;
        }
      };
      recorder.start();
      active = { recorder, stream, box, timer: setTimeout(stopActive, MAX_SECONDS * 1000) };
      button.classList.add('rec');
      button.textContent = 'Parar gravação';
      say('Gravando… fale com calma e toque em “Parar gravação” quando terminar.');
    });
  });

  // sair da página com gravação aberta: solta o microfone
  window.addEventListener('pagehide', stopActive);

  // ---- uma pergunta por vez: responder, deixar para depois (pendência) ou "não se aplica" ----
  const keys = [...form.querySelectorAll('[data-q]')].map((q) => q.dataset.q).filter((k) => k !== 'resumo');
  const blocks = Object.fromEntries([...form.querySelectorAll('[data-q]')].map((q) => [q.dataset.q, q]));
  const LABEL = { respondida: 'respondida', nao_se_aplica: 'não se aplica', pendente: 'pendente', aberta: 'por responder' };
  let states = JSON.parse(form.dataset.states || '{}');
  let current = null;
  form.classList.add('wizard');
  form.querySelector('[data-progress]').hidden = false;
  form.querySelector('[data-nojs-submit]').hidden = true;
  form.querySelectorAll('[data-actions]').forEach((a) => { a.hidden = false; });

  const isDone = (k) => states[k] === 'respondida' || states[k] === 'nao_se_aplica';
  function paint() {
    keys.forEach((k) => {
      const st = states[k] || 'aberta';
      const li = form.querySelector(`[data-step="${k}"]`);
      li.className = `st-${st}${k === current ? ' on' : ''}`;
      li.querySelector('[data-step-label]').textContent = LABEL[st];
      const sum = form.querySelector(`[data-sum-item="${k}"]`);
      sum.className = `st-${st}`;
      sum.querySelector('[data-sum-state]').textContent = LABEL[st];
      sum.querySelector('[data-sum-btn]').textContent = isDone(k) ? 'Editar' : 'Responder agora';
      const label = blocks[k].querySelector('[data-q-state]');
      if (label) { label.textContent = LABEL[st]; label.className = `q-state st-${st}`; }
    });
    const n = (s) => keys.filter((k) => states[k] === s).length;
    const done = n('respondida') + n('nao_se_aplica');
    const parts = [`${done} de ${keys.length} respondidas`];
    if (n('pendente')) parts.push(`${n('pendente')} pendente${n('pendente') > 1 ? 's' : ''}`);
    if (n('aberta')) parts.push(`${n('aberta')} por responder`);
    const sum = form.querySelector('[data-sum]');
    sum.textContent = parts.join(' · ');
    sum.classList.toggle('has-pending', n('pendente') > 0);
  }

  async function show(key, { scroll = true } = {}) {
    current = key;
    Object.entries(blocks).forEach(([k, el]) => { const on = k === key; el.classList.toggle('on', on); el.hidden = !on && k === 'resumo'; });
    paint();
    if (key === 'resumo') await closeSummary();
    if (scroll) form.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const field = blocks[key].querySelector('textarea, input[type=text], input[type=url]');
    if (field && key !== 'resumo' && scroll) field.focus({ preventScroll: true });
  }

  const nextAfter = (key) => { const i = keys.indexOf(key); return i < keys.length - 1 ? keys[i + 1] : 'resumo'; };
  const say = (key, text, err = true) => { const m = blocks[key].querySelector('[data-msg]'); if (m) { m.textContent = text; m.classList.toggle('err', err); } };

  function valuesOf(key) {
    const box = blocks[key];
    if (key === 'landing') return { landing_url: box.querySelector('[name=landing_url]').value, landing_perk: box.querySelector('[name=landing_perk]').value };
    if (key === 'goal') return { goal: (box.querySelector('[name=goal]:checked') || {}).value || '', goal_other: box.querySelector('[name=goal_other]').value };
    if (key === 'logo') return {};
    return { [key]: box.querySelector(`[name=${key}]`).value };
  }

  async function act(key, action, button) {
    say(key, '');
    if (action === 'voltar') { const i = keys.indexOf(key); show(i > 0 ? keys[i - 1] : key); return; }
    button.disabled = true;
    try {
      const res = await fetch(`${base}/resposta`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ pergunta: key, acao: action, valores: action === 'responder' ? valuesOf(key) : {} }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || `erro ${res.status}`);
      states = json.states;
      show(nextAfter(key));
    } catch (err) {
      say(key, err.message);
    } finally { button.disabled = false; }
  }

  form.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) { show(goto.dataset.goto); return; }
    const b = e.target.closest('[data-act]');
    if (b) act(b.closest('[data-q]').dataset.q, b.dataset.act, b);
  });
  form.addEventListener('submit', (e) => e.preventDefault()); // com JavaScript, quem envia são os botões de cada pergunta

  // chegou ao resumo: avisa a equipe e mostra o que falta
  async function closeSummary() {
    const title = form.querySelector('[data-sum-title]'); const text = form.querySelector('[data-sum-text]');
    let info = null;
    try {
      const res = await fetch(`${base}/concluir`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-csrf-token': csrf }, body: '{}' });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) info = json;
    } catch { /* a página continua útil sem o aviso */ }
    const pending = keys.filter((k) => states[k] === 'pendente').length; const open = keys.filter((k) => states[k] === 'aberta').length;
    if (!pending && !open) { title.textContent = 'Tudo respondido. Obrigado!'; text.textContent = 'A equipe do Pulso já recebeu as suas respostas. Se quiser ajustar algo, toque em Editar.'; } else {
      title.textContent = `${pending + open} pergunta${pending + open > 1 ? 's' : ''} para responder`;
      text.textContent = 'Está tudo salvo. Você pode voltar a este mesmo link quando quiser e continuar de onde parou; as pendências ficam guardadas.';
    }
    void info;
  }

  // logo enviada: a pergunta já conta como respondida
  logoInput?.addEventListener('change', () => { setTimeout(() => { if (/enviada/i.test(logoState.textContent)) { states.logo = 'respondida'; paint(); } }, 1500); });

  show(form.dataset.start && blocks[form.dataset.start] ? form.dataset.start : keys[0], { scroll: false });
})();
