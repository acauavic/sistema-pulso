// Formulários que se lembram da última escolha (ex.: Publicar em massa: redes, horários, por dia, Reel de teste, automação).
// <form data-remember="chave" data-remember-skip="_csrf,ids">: ao enviar, guarda os campos neste navegador; ao abrir a página,
// devolve. Sem armazenamento disponível (aba privada), o formulário só abre com os valores padrão.
(function () {
  document.querySelectorAll('form[data-remember]').forEach((form) => {
    const key = `pulso-lembrar-${form.dataset.remember}`;
    const skip = new Set(String(form.dataset.rememberSkip || '').split(',').map((s) => s.trim()).filter(Boolean));
    const fields = () => [...form.elements].filter((el) => el.name && !skip.has(el.name) && !['hidden', 'submit', 'button', 'file'].includes(el.type));
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && typeof saved === 'object') {
        fields().forEach((el) => {
          if (!(el.name in saved)) return;
          const v = saved[el.name];
          if (el.type === 'checkbox' || el.type === 'radio') el.checked = Array.isArray(v) ? v.includes(el.value) : v === el.value;
          else if (typeof v === 'string') el.value = v;
        });
      }
    } catch { /* sem armazenamento: valores padrão */ }
    form.addEventListener('submit', () => {
      const out = {};
      fields().forEach((el) => {
        if (el.type === 'checkbox') { out[el.name] = out[el.name] || []; if (el.checked) out[el.name].push(el.value); }
        else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
        else out[el.name] = el.value;
      });
      try { localStorage.setItem(key, JSON.stringify(out)); } catch { /* sem armazenamento */ }
    });
  });
})();
