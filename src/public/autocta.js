// Automação no Instagram (janela de publicar): ao ligar e ao digitar a palavra, a chamada do Instagram passa a pedir essa palavra
// ("Comente PALAVRA e receba no direct..."); desligar volta a chamada que estava. Funciona em qualquer formulário com [data-auto-box].
(function () {
  const clean = (s) => String(s || '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase().slice(0, 30);
  document.querySelectorAll('[data-auto-box]').forEach((box) => {
    const form = box.closest('form'); if (!form) return;
    const on = box.querySelector('[data-auto-on]'); const word = box.querySelector('[data-auto-word]'); const echo = box.querySelector('[data-auto-echo]');
    const cta = form.querySelector('[data-fill-cta="instagram"]');
    let before = cta ? cta.value : null;
    const sync = () => {
      const w = clean(word.value);
      if (echo) echo.textContent = w || 'PALAVRA';
      if (!cta) return;
      if (on.checked && w) { if (before === null) before = cta.value; cta.value = `Comente ${w} e receba no direct o link do episódio completo.`; }
      else if (!on.checked && before !== null) { cta.value = before; }
    };
    word.addEventListener('input', () => { word.value = word.value.toUpperCase(); sync(); });
    on.addEventListener('change', () => { if (on.checked) { box.open = true; before = cta ? cta.value : null; } sync(); });
  });
})();
