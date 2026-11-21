// Comprovante nos lançamentos do Financeiro: escolher o arquivo já envia pelos anexos (/anexos) e o id vai num campo
// escondido "comprovante" do formulário. Na janela, a lista mostra o que entrou (com "tirar"); no clipe da linha
// (data-receipt-submit), o formulário segue sozinho depois do envio. Enquanto envia, o botão de salvar espera.
(function () {
  'use strict';
  var csrf = (document.querySelector('meta[name="csrf"]') || {}).content || '';

  function say(box, text, bad) {
    var msg = box.querySelector('[data-receipt-msg]');
    if (!msg) return;
    msg.textContent = text == null ? (msg.getAttribute('data-receipt-hint') || '') : text;
    msg.classList.toggle('err', Boolean(bad));
  }

  function addItem(box, form, att) {
    var hidden = document.createElement('input');
    hidden.type = 'hidden'; hidden.name = 'comprovante'; hidden.value = String(att.id);
    form.appendChild(hidden);
    var list = box.querySelector('[data-receipt-list]');
    if (!list) return;
    var li = document.createElement('li');
    li.className = 'receipt-item small';
    var name = document.createElement('span');
    name.textContent = att.name;
    var out = document.createElement('button');
    out.type = 'button'; out.className = 'link small'; out.textContent = 'tirar';
    out.addEventListener('click', function () { hidden.remove(); li.remove(); });
    li.appendChild(name); li.appendChild(out);
    list.appendChild(li);
  }

  async function send(file) {
    var res = await fetch('/anexos', {
      method: 'POST', credentials: 'same-origin', body: file,
      headers: { Accept: 'application/json', 'x-csrf-token': csrf, 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
    });
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok || !body.ok) throw new Error(body.error || 'Não consegui enviar ' + file.name + '.');
    return body.attachment;
  }

  document.addEventListener('change', async function (ev) {
    var input = ev.target;
    if (!input || !input.matches || !input.matches('input[type=file][data-receipt]')) return;
    var form = input.form; if (!form) return;
    var box = input.closest('[data-receipt-box]') || form;
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    var buttons = form.querySelectorAll('button[type=submit]');
    buttons.forEach(function (b) { b.disabled = true; });
    say(box, files.length > 1 ? 'Enviando ' + files.length + ' arquivos…' : 'Enviando ' + files[0].name + '…');
    var ok = 0; var error = null;
    for (var i = 0; i < files.length; i += 1) {
      try { addItem(box, form, await send(files[i])); ok += 1; } catch (err) { error = err.message || 'Sem conexão. Tente de novo.'; }
    }
    input.value = '';
    buttons.forEach(function (b) { b.disabled = false; });
    if (error) say(box, error, true); else say(box, null);
    if (ok && input.hasAttribute('data-receipt-submit')) { say(box, 'Anexando…'); form.submit(); }
  });

  // janela fechada sem salvar: o que foi escolhido nela sai (o anexo solto some sozinho na limpeza)
  document.addEventListener('close', function (ev) {
    var dlg = ev.target;
    if (!dlg || !dlg.querySelectorAll) return;
    dlg.querySelectorAll('[data-receipt-box]').forEach(function (box) {
      var form = box.closest('form') || box;
      form.querySelectorAll('input[type=hidden][name=comprovante]').forEach(function (h) { h.remove(); });
      var list = box.querySelector('[data-receipt-list]'); if (list) list.textContent = '';
      say(box, null);
    });
  }, true);
})();
