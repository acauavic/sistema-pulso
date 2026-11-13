// Baixar vários arquivos de uma vez (material e galeria do episódio, posts e cortes do Conteúdo). Dois ou mais arquivos saem num
// ZIP só (/baixar.zip, montado pelo servidor enquanto baixa, direto do Backblaze); um arquivo sozinho continua sendo o link de
// sempre (/baixar, que o servidor troca por um link assinado e curto do Backblaze), aberto num quadro escondido (por isso o
// frame-src da CSP aceita o Backblaze; é também o caminho de reserva se algum item vier sem data-zip).
// Marcação de uma lista: um contêiner [data-dl data-dl-zip="nome-do-zip"] com itens [data-dl-item data-href data-name data-bytes
// data-zip="f12"] (f = arquivo do episódio, c = corte, k = capa/post; cada um com um [data-dl-check]), os botões [data-dl-select] e
// [data-dl-everything] e a barra [data-dl-bar].
// Ações em massa na mesma seleção (Conteúdo: atribuir, aprovar, excluir…): cada item leva data-id; na barra,
// [data-dl-do="acao"] envia o formulário [data-dl-form] do contêiner (com data-confirm, pergunta antes; {n} vira a contagem) e
// [data-dl-open="id-da-janela"] abre uma janela cujo formulário recebe os ids marcados em [data-dl-ids] ({n} em [data-dl-n]).
(function () {
  const GAP_MS = 900; // intervalo entre um download e o seguinte: o navegador aceita melhor e o Backblaze não recebe tudo de uma vez
  const FRAME_MS = 5 * 60 * 1000; // o quadro fica um tempo: o download já passou para o navegador, mas sem pressa para tirar
  const CONFIRM_BYTES = 2 * 1024 ** 3; // acima disso, pergunta antes (evita baixar 100 GB por engano)
  let busy = false;

  const bytesText = (n) => {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
    do { n /= 1024; i += 1; } while (n >= 1024 && i < u.length - 1);
    return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1).replace('.', ',')} ${u[i]}`;
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const sum = (list) => list.reduce((t, it) => t + (Number(it.bytes) || 0), 0);

  // Um quadro escondido por download: com link clicado na própria página, o download que ainda esperava resposta era cancelado
  // pelo seguinte (navegação da aba).
  const viaFrame = (href) => {
    const f = document.createElement('iframe');
    f.hidden = true; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.src = href;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), FRAME_MS);
  };
  const zipHref = (list, name) => `/baixar.zip?itens=${list.map((it) => it.zip).join(',')}${name ? `&nome=${encodeURIComponent(name)}` : ''}`;

  // Baixa a lista: 2+ arquivos num ZIP só (opts.zipName dá o nome); 1 arquivo, direto. Devolve { n, zip } (n = 0 se já havia uma
  // rodada ou a pessoa desistiu). Item sem data-zip (não deveria acontecer) faz cair no jeito antigo: um download por arquivo.
  async function start(list, opts = {}) {
    if (busy || !list.length) return { n: 0 };
    if (list.length > 1 && sum(list) > CONFIRM_BYTES && !window.confirm(`Baixar ${plural(list.length, 'arquivo', 'arquivos')} (${bytesText(sum(list))})${list.every((it) => it.zip) ? ' num ZIP só' : ''}? Vai para a pasta de downloads do seu computador.`)) return { n: 0 };
    if (list.length > 1 && list.every((it) => it.zip)) { // mesmo domínio: o link com download baixa sem sair da página
      const a = document.createElement('a'); a.href = zipHref(list, opts.zipName); a.download = ''; a.hidden = true;
      document.body.appendChild(a); a.click(); a.remove();
      return { n: list.length, zip: true };
    }
    busy = true;
    try {
      for (let i = 0; i < list.length; i += 1) {
        viaFrame(list[i].href);
        if (i < list.length - 1) await new Promise((r) => setTimeout(r, GAP_MS));
      }
      return { n: list.length };
    } finally { busy = false; }
  }
  const doneNote = (r) => (r.zip
    ? `ZIP com ${plural(r.n, 'arquivo', 'arquivos')} a caminho. Ele é montado enquanto baixa: acompanhe na barra de downloads do navegador.`
    : `${plural(r.n, 'download iniciado', 'downloads iniciados')}. Acompanhe na barra de downloads do navegador.`);
  window.PulsoBaixar = { start, doneNote, bytesText, plural, isBusy: () => busy };

  const itemOf = (el) => ({ href: el.dataset.href, name: el.dataset.name, bytes: Number(el.dataset.bytes) || 0, zip: el.dataset.zip });

  document.querySelectorAll('[data-dl]').forEach((box) => {
    const rows = () => [...box.querySelectorAll('[data-dl-item]')];
    const bar = box.querySelector('[data-dl-bar]');
    const count = box.querySelector('[data-dl-count]');
    const go = box.querySelector('[data-dl-go]');
    const allBtn = box.querySelector('[data-dl-all]');
    const note = box.querySelector('[data-dl-note]');
    const checks = () => rows().map((r) => r.querySelector('[data-dl-check]')).filter(Boolean);
    const picked = () => rows().filter((r) => r.querySelector('[data-dl-check]')?.checked);
    let last = -1;

    const say = (text) => { if (note) { note.textContent = text; note.hidden = !text; } };
    const refresh = () => {
      const sel = picked();
      const bytes = sum(sel.map(itemOf));
      if (count) count.textContent = sel.length ? `${plural(sel.length, 'selecionado', 'selecionados')}${bytes ? ` · ${bytesText(bytes)}` : ''}` : 'Nenhum item marcado';
      if (go) go.disabled = !sel.length;
      box.querySelectorAll('[data-dl-do], [data-dl-open]').forEach((b) => { b.disabled = !sel.length; });
      if (allBtn) allBtn.textContent = sel.length === rows().length ? 'Limpar seleção' : 'Selecionar todos';
      rows().forEach((r) => r.classList.toggle('picked', Boolean(r.querySelector('[data-dl-check]')?.checked)));
    };
    const mode = (on) => {
      box.classList.toggle('selecting', on);
      if (bar) bar.hidden = !on;
      if (!on) { checks().forEach((c) => { c.checked = false; }); say(''); }
      refresh();
      if (on) go?.focus({ preventScroll: true }); else box.querySelector('[data-dl-select]')?.focus({ preventScroll: true });
    };
    const run = async (list) => {
      if (list.length > 1) say(`Preparando ${plural(list.length, 'arquivo', 'arquivos')}…`);
      const r = await start(list, { zipName: box.dataset.dlZip });
      say(r.n ? doneNote(r) : '');
    };

    // ids marcados viram campos "ids" do formulário que vai para o servidor
    const fill = (form, holder) => {
      (holder || form).querySelectorAll('input[data-dl-id]').forEach((i) => i.remove());
      picked().forEach((r) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = 'ids'; i.value = r.dataset.id; i.dataset.dlId = ''; (holder || form).appendChild(i); });
    };
    const act = (btn) => {
      const n = picked().length; if (!n) return;
      if (btn.dataset.dlOpen) {
        const dlg = document.getElementById(btn.dataset.dlOpen); const form = dlg?.querySelector('form'); if (!form) return;
        fill(form, form.querySelector('[data-dl-ids]'));
        dlg.querySelectorAll('[data-dl-n]').forEach((el) => { el.textContent = String(n); });
        dlg.showModal(); return;
      }
      const form = box.querySelector('[data-dl-form]'); if (!form) return;
      if (btn.dataset.confirm && !window.confirm(btn.dataset.confirm.replace('{n}', n))) return;
      form.querySelector('input[name="acao"]').value = btn.dataset.dlDo;
      fill(form);
      btn.disabled = true; if (btn.dataset.busy) btn.textContent = btn.dataset.busy;
      form.submit();
    };

    box.addEventListener('click', (e) => {
      const action = e.target.closest('[data-dl-do], [data-dl-open]');
      if (action) { act(action); return; }
      if (e.target.closest('[data-dl-select]')) { mode(!box.classList.contains('selecting')); return; }
      if (e.target.closest('[data-dl-cancel]')) { mode(false); return; }
      if (e.target.closest('[data-dl-everything]')) { run(rows().map(itemOf).filter((i) => i.href)); return; }
      if (e.target.closest('[data-dl-all]')) { const all = picked().length !== rows().length; checks().forEach((c) => { c.checked = all; }); refresh(); return; }
      if (e.target.closest('[data-dl-go]')) { run(picked().map(itemOf).filter((i) => i.href)); return; } // corte ainda sem vídeo pronto não baixa
      const pick = box.classList.contains('selecting') ? e.target.closest('[data-dl-pick]') : null; // a imagem do cartão: em vez de abrir, marca
      if (pick) { e.preventDefault(); pick.closest('[data-dl-item]')?.querySelector('[data-dl-check]')?.click(); return; }
      const row = box.classList.contains('selecting') && !e.target.closest('a, button, form, input, label') ? e.target.closest('[data-dl-item]') : null;
      if (row) { row.querySelector('[data-dl-check]')?.click(); return; } // tocar na linha marca/desmarca (o clique na caixa cai no tratamento abaixo)
      const c = e.target.closest('[data-dl-check]');
      if (c) { // Shift + clique marca o intervalo, como numa lista de e-mails
        const list = checks(); const i = list.indexOf(c);
        if (e.shiftKey && last >= 0) { const [a, b] = [Math.min(i, last), Math.max(i, last)]; for (let k = a; k <= b; k += 1) list[k].checked = c.checked; }
        last = i; refresh();
      }
    });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.classList.contains('selecting') && !e.target.closest('dialog')) { e.stopPropagation(); mode(false); } });
    refresh();
  });
}());
