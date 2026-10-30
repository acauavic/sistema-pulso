// Portal do convidado: "Copiar legenda" de cada corte exclusivo.
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-copy-caption]');
  if (!btn) return;
  const text = btn.parentElement.querySelector('[data-caption]')?.textContent || '';
  const done = () => { btn.textContent = 'Legenda copiada'; setTimeout(() => { btn.textContent = 'Copiar legenda'; }, 2000); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => {});
});

// Vídeo do YouTube: a capa vira o player só no clique (a página abre leve).
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-yt-play]');
  if (!a) return;
  ev.preventDefault();
  const box = a.closest('[data-yt-src]');
  const f = document.createElement('iframe');
  f.src = box.dataset.ytSrc; f.title = box.dataset.ytTitle || 'YouTube';
  f.width = '560'; f.height = '315';
  f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
  f.referrerPolicy = 'strict-origin-when-cross-origin';
  box.replaceChildren(f);
});

// Galeria das fotos: passa sozinha (pausa ao passar o mouse, ao focar, com a aba escondida ou com "reduzir movimento"),
// setas, miniaturas e teclado. "Baixar todas" é um ZIP montado pelo servidor.
(() => {
  const gal = document.querySelector('[data-gal]');
  if (!gal) return;
  const img = gal.querySelector('[data-gal-img]');
  const pos = gal.querySelector('[data-gal-pos]');
  const down = gal.querySelector('[data-gal-down]');
  const play = gal.querySelector('[data-gal-play]');
  const thumbs = [...gal.querySelectorAll('[data-gal-go]')];
  const note = document.querySelector('[data-gal-note]');
  const total = thumbs.length;
  const INTERVAL = 4500;
  let at = 0; let timer = null; let hold = false; let seen = false;
  let playing = total > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const strip = gal.querySelector('.pt-gal-thumbs');
  let want = 0;
  function show(i) {
    if (!total) return;
    at = (i + total) % total;
    const t = thumbs[at]; const n = at; want = n;
    pos.textContent = `${at + 1} / ${total}`;
    down.href = t.dataset.down;
    thumbs.forEach((x, k) => { if (k === at) x.setAttribute('aria-current', 'true'); else x.removeAttribute('aria-current'); });
    // a miniatura da foto atual fica à vista na faixa (sem rolar a página)
    if (strip) { const li = t.parentElement; const left = li.offsetLeft - (strip.clientWidth - li.offsetWidth) / 2; strip.scrollTo({ left: Math.max(0, left) }); }
    // troca só depois que a próxima carregou (sem tela vazia no meio)
    img.classList.add('is-loading');
    const next = new Image();
    next.onload = next.onerror = () => { if (want !== n) return; img.src = t.dataset.big; img.alt = `Foto da gravação ${n + 1} de ${total}`; img.classList.remove('is-loading'); };
    next.src = t.dataset.big;
    new Image().src = thumbs[(at + 1) % total].dataset.big; // a seguinte já fica carregada
  }
  // só passa sozinha com a galeria na tela: fora dela, nada troca nem rola (mexer na página enquanto a pessoa usa outra parte,
  // como o player do Spotify, fazia o primeiro clique dele se perder)
  function tick() { clearTimeout(timer); if (playing && seen && !hold && !document.hidden) timer = setTimeout(() => { show(at + 1); tick(); }, INTERVAL); }
  function setPlaying(v) { playing = v; if (play) { play.textContent = v ? 'Pausar' : 'Passar sozinha'; play.setAttribute('aria-pressed', String(v)); } tick(); }

  gal.querySelector('[data-gal-prev]')?.addEventListener('click', () => { show(at - 1); tick(); });
  gal.querySelector('[data-gal-next]')?.addEventListener('click', () => { show(at + 1); tick(); });
  play?.addEventListener('click', () => setPlaying(!playing));
  thumbs.forEach((t, n) => t.addEventListener('click', (ev) => { ev.preventDefault(); show(n); setPlaying(false); }));
  gal.addEventListener('mouseenter', () => { hold = true; tick(); });
  gal.addEventListener('mouseleave', () => { hold = false; tick(); });
  gal.addEventListener('focusin', () => { hold = true; tick(); });
  gal.addEventListener('focusout', () => { hold = false; tick(); });
  gal.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') { show(at - 1); setPlaying(false); }
    if (ev.key === 'ArrowRight') { show(at + 1); setPlaying(false); }
  });
  document.addEventListener('visibilitychange', tick);
  if ('IntersectionObserver' in window) new IntersectionObserver((list) => { seen = list[0].isIntersecting; tick(); }, { threshold: 0.4 }).observe(gal);
  else seen = true;
  setPlaying(playing);

})();
