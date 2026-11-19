// "Criar tarefa" numa mensagem do chat: abre a janela Nova tarefa aqui mesmo, a IA lê a mensagem (ou a thread inteira) e preenche
// título, detalhes, responsável, prazo, categoria e vínculos. A pessoa confere e cria; nada é criado sem o clique em "Criar tarefa".
// Mensagem com thread: a janela pergunta primeiro o que a IA lê (Esta mensagem | A thread inteira). Sem inline script (CSP 'self').
(function () {
  'use strict';
  const dlg = document.getElementById('modal-task-new');
  const bar = dlg && dlg.querySelector('[data-task-from]');
  if (!bar) return;
  const form = dlg.querySelector('form');
  const seg = bar.querySelector('[data-tf-seg]');
  const status = bar.querySelector('[data-tf-status]');
  const csrf = document.querySelector('meta[name="csrf"]')?.content || '';
  let cur = null; let seq = 0;

  const say = (text, tone) => { status.textContent = text; status.classList.toggle('voice-err', tone === 'err'); };
  const set = (name, value) => { const el = form.elements[name]; if (el && value !== null && value !== undefined && value !== '') { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); } };
  const rte = () => form.querySelector('[data-rich]')?.rte;

  function clear() {
    form.reset();
    rte()?.reset?.();
    const d = form.querySelector('details'); if (d) d.open = false;
  }
  function fill(draft) {
    set('title', draft.title);
    if (draft.description && rte()) rte().setPlain(draft.description);
    set('assignee_id', draft.assignee_id); set('due_on', draft.due_on);
    if (draft.due_on && form.elements.due_time) form.elements.due_time.value = draft.due_time || '';
    set('kind', draft.kind);
    set('episode_id', draft.episode_id); set('guest_id', draft.guest_id); set('sponsor_id', draft.sponsor_id);
    if (draft.episode_id || draft.guest_id || draft.sponsor_id) { const d = form.querySelector('details'); if (d) d.open = true; }
  }

  async function run(scope) {
    const mine = ++seq;
    form.elements.source_scope.value = scope;
    seg.querySelectorAll('[data-tf-scope]').forEach((b) => { b.classList.toggle('on', b.dataset.tfScope === scope); b.setAttribute('aria-pressed', String(b.dataset.tfScope === scope)); });
    bar.classList.add('busy');
    say(scope === 'thread' ? 'Lendo a thread e organizando a tarefa…' : 'Lendo a mensagem e organizando a tarefa…');
    try {
      const res = await fetch(`/mensagens/m/${cur.id}/tarefa`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ alcance: scope }) });
      const body = await res.json().catch(() => ({}));
      if (mine !== seq) return; // trocou de escolha no meio: vale a última
      if (!res.ok || !body.ok) throw new Error(body.error || `Erro ${res.status}`);
      clear(); keep(); fill(body.draft);
      say(body.warnings && body.warnings.length ? body.warnings.join(' ') : 'Pronto. Confira os campos e toque em Criar tarefa.', body.warnings && body.warnings.length ? 'err' : undefined);
      form.elements.title?.focus();
    } catch (err) {
      if (mine === seq) say(err.message, 'err');
    } finally { if (mine === seq) bar.classList.remove('busy'); }
  }
  // o que form.reset() apagaria e precisa ficar: a origem e para onde voltar
  function keep() {
    form.elements.source_message_id.value = cur.id;
    form.elements.source_scope.value = cur.scope || '';
    if (form.elements.voltar) form.elements.voltar.value = cur.back;
  }

  seg.addEventListener('click', (e) => { const b = e.target.closest('[data-tf-scope]'); if (!b || !cur) return; cur.scope = b.dataset.tfScope; run(cur.scope); });
  dlg.addEventListener('close', () => { if (!cur) return; cur = null; seq += 1; bar.hidden = true; clear(); form.elements.source_message_id.value = ''; form.elements.source_scope.value = ''; });

  // chat.js chama ao tocar em "Criar tarefa": { id, hasThread, back }
  window.PulsoTaskFromMessage = {
    open({ id, hasThread, back }) {
      seq += 1;
      cur = { id, back, scope: hasThread ? '' : 'mensagem' };
      clear(); keep();
      bar.hidden = false; bar.classList.remove('busy');
      seg.hidden = !hasThread;
      seg.querySelectorAll('[data-tf-scope]').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
      if (!dlg.open) dlg.showModal();
      if (hasThread) say('Esta mensagem tem thread. O que a IA deve ler para montar a tarefa?');
      else run('mensagem');
    },
  };
}());
