// Social: ao escolher um corte/imagem, o título e a legenda vêm preenchidos (se a pessoa ainda não escreveu por cima).
(function () {
  const form = document.querySelector('[data-compose]');
  if (!form) return;
  const fields = { title: form.querySelector('[data-fill="title"]'), caption: form.querySelector('[data-fill="caption"]') };
  const auto = new WeakMap(); // valor que nós preenchemos: se a pessoa mudou, não sobrescreve
  const fill = (el, value) => {
    if (!el || value == null) return;
    if (el.value && el.value !== auto.get(el)) return;
    el.value = value; auto.set(el, value);
  };
  const apply = (input) => { fill(fields.title, input.dataset.title || ''); fill(fields.caption, input.dataset.caption || ''); };
  form.addEventListener('change', (e) => { if (e.target.matches('input[type="radio"]')) apply(e.target); });
  const checked = form.querySelector('input[type="radio"]:checked');
  if (checked) apply(checked);
})();

// "Todos": marca/desmarca os itens habilitados do mesmo formulário.
document.querySelectorAll('[data-check-all]').forEach((all) => {
  const scope = all.closest('form');
  const items = () => [...scope.querySelectorAll('[data-check-item]')];
  all.addEventListener('change', () => items().forEach((i) => { i.checked = all.checked; }));
  scope.addEventListener('change', (e) => { if (e.target.matches('[data-check-item]')) all.checked = items().every((i) => i.checked); });
});
