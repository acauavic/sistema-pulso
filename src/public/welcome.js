// Boas-vindas à versão nova: foco no "Começar", Esc fecha, e fechar marca a versão como vista sem recarregar a página.
(function () {
  var box = document.querySelector('[data-welcome]');
  if (!box) return;
  var form = box.querySelector('[data-welcome-form]');
  var start = box.querySelector('[data-welcome-start]');
  var before = document.activeElement;
  document.documentElement.classList.add('welcome-open');
  setTimeout(function () { if (start) start.focus({ preventScroll: true }); }, 50);

  function close() {
    if (box.classList.contains('is-leaving')) return;
    box.classList.add('is-leaving');
    var data = new URLSearchParams(new FormData(form));
    fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' })
      .catch(function () { /* sem rede: aparece de novo na próxima tela */ });
    var done = function () { box.remove(); document.documentElement.classList.remove('welcome-open'); if (before && before.focus) before.focus({ preventScroll: true }); };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else setTimeout(done, 260);
  }
  form.addEventListener('submit', function (ev) { ev.preventDefault(); close(); });
  document.addEventListener('keydown', function (ev) {
    if (!document.body.contains(box)) return;
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    if (ev.key === 'Tab') { // o foco fica dentro da janela
      var f = box.querySelectorAll('button, a[href]'); if (!f.length) return;
      var a = f[0]; var z = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); } else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); }
    }
  });
}());
