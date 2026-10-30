// Portal do convidado: "Copiar legenda" de cada corte exclusivo.
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-copy-caption]');
  if (!btn) return;
  const text = btn.parentElement.querySelector('[data-caption]')?.textContent || '';
  const done = () => { btn.textContent = 'Legenda copiada'; setTimeout(() => { btn.textContent = 'Copiar legenda'; }, 2000); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => {});
});

// Galeria das fotos: passa sozinha (pausa ao passar o mouse, ao focar, com a aba escondida ou com "reduzir movimento"),
// setas, miniaturas e teclado. "Baixar todas" dispara os downloads um depois do outro.
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
  let at = 0; let timer = null; let hold = false;
  let playing = total > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function show(i) {
    if (!total) return;
    at = (i + total) % total;
    const t = thumbs[at];
    img.src = t.dataset.big;
    img.alt = `Foto da gravação ${at + 1} de ${total}`;
    down.href = t.dataset.down;
    pos.textContent = `${at + 1} / ${total}`;
    thumbs.forEach((x, n) => { if (n === at) x.setAttribute('aria-current', 'true'); else x.removeAttribute('aria-current'); });
    new Image().src = thumbs[(at + 1) % total].dataset.big; // a próxima já fica carregada
  }
  function tick() { clearTimeout(timer); if (playing && !hold && !document.hidden) timer = setTimeout(() => { show(at + 1); tick(); }, INTERVAL); }
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
  setPlaying(playing);

  const all = document.querySelector('[data-gal-all]');
  all?.addEventListener('click', async () => {
    if (all.disabled) return;
    all.disabled = true;
    for (let n = 0; n < total; n += 1) {
      const a = document.createElement('a');
      a.href = thumbs[n].dataset.down; a.download = ''; a.hidden = true;
      document.body.appendChild(a); a.click(); a.remove();
      if (note) { note.hidden = false; note.textContent = `Baixando ${n + 1} de ${total}. Se o navegador perguntar, permita vários downloads.`; }
      if (n < total - 1) await new Promise((r) => setTimeout(r, 900));
    }
    if (note) note.textContent = `Os ${total} downloads foram iniciados. As fotos vão para a pasta de downloads.`;
    all.disabled = false;
  });
})();
