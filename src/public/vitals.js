// Velocidade real: mede no navegador de quem usa o painel quanto a página levou para aparecer (LCP, FCP), responder ao
// clique (INP), se pulou na tela (CLS) e quanto o servidor demorou (TTFB). Manda tudo de uma vez ao sair da página
// (sendBeacon, não atrasa nada). Gestão > Desempenho mostra o resultado por página. Nada vai para fora do sistema.
(() => {
  if (!('PerformanceObserver' in window) || !navigator.sendBeacon) return;
  const csrf = document.querySelector('meta[name="csrf"]')?.content;
  if (!csrf) return;
  const m = {};
  const watch = (type, fn) => { try { new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch { /* navegador sem esse tipo */ } };

  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) m.TTFB = Math.max(0, nav.responseStart - nav.startTime);
  watch('paint', (e) => { if (e.name === 'first-contentful-paint') m.FCP = e.startTime; });
  watch('largest-contentful-paint', (e) => { m.LCP = e.startTime; });
  let cls = 0; let session = 0; let last = 0; let first = 0;
  watch('layout-shift', (e) => { // CLS: maior "janela" de pulos (até 5 s, intervalos menores que 1 s)
    if (e.hadRecentInput) return;
    if (session && e.startTime - last < 1000 && e.startTime - first < 5000) session += e.value; else { session = e.value; first = e.startTime; }
    last = e.startTime; cls = Math.max(cls, session); m.CLS = cls;
  });
  // INP: a interação mais lenta (do toque até a tela mudar) entre as que tiveram resposta
  try {
    new PerformanceObserver((list) => list.getEntries().forEach((e) => { if (e.interactionId) m.INP = Math.max(m.INP || 0, e.duration); }))
      .observe({ type: 'event', buffered: true, durationThreshold: 40 });
  } catch { /* sem Event Timing */ }

  let sent = false;
  const send = () => {
    if (sent) return;
    const metrics = Object.entries(m).filter(([, v]) => Number.isFinite(v)).map(([name, value]) => ({ name, value: Math.round(name === 'CLS' ? value * 1000 : value) / (name === 'CLS' ? 1000 : 1) }));
    if (!metrics.length) return;
    sent = true;
    const device = window.matchMedia('(max-width: 860px)').matches ? 'celular' : 'computador';
    navigator.sendBeacon('/metricas/vitals', new Blob([JSON.stringify({ _csrf: csrf, page: location.pathname, device, metrics })], { type: 'application/json' }));
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); });
  window.addEventListener('pagehide', send);
})();
