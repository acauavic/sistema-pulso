// Portal do convidado: "Copiar legenda" de cada corte exclusivo.
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-copy-caption]');
  if (!btn) return;
  const text = btn.parentElement.querySelector('[data-caption]')?.textContent || '';
  const done = () => { btn.textContent = 'Legenda copiada'; setTimeout(() => { btn.textContent = 'Copiar legenda'; }, 2000); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => {});
});
