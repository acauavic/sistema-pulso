// Aplica o tema salvo antes da pintura (evita piscar). Escuro é o padrão; claro é opcional.
(function () {
  try {
    var t = localStorage.getItem('pulso-theme');
    if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch (e) { /* storage bloqueado: segue no escuro */ }
})();
