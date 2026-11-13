// Aplica o tema salvo antes da pintura (evita piscar). Escuro é o padrão; claro é opcional.
(function () {
  try {
    var t = localStorage.getItem('pulso-theme');
    if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      var meta = document.querySelector('meta[name="theme-color"]'); // barra do sistema no celular acompanha o tema
      if (meta) meta.setAttribute('content', '#F4F2EC');
    }
    if (localStorage.getItem('pulso-sidebar') === 'collapsed') document.documentElement.dataset.sidebar = 'collapsed'; // menu lateral recolhido
  } catch (e) { /* storage bloqueado: segue no escuro, menu aberto */ }
})();
