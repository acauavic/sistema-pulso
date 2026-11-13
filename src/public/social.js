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
  // "Editar capa": aparece depois de escolher o item e leva ao editor, que volta para cá com o item já escolhido.
  const edit = form.querySelector('[data-cover-edit]');
  const DRAFT = 'pulso-novo-post';
  const coverButton = (input) => {
    if (!edit) return;
    const link = edit.querySelector('[data-cover-link]'); const label = edit.querySelector('[data-cover-label]'); const hint = edit.querySelector('[data-cover-hint]');
    label.dataset.text ??= label.textContent; hint.dataset.text ??= hint.textContent;
    const back = `/social/novo?tipo=${encodeURIComponent(edit.dataset.tipo)}&item=${encodeURIComponent(input.value)}`;
    if (input.dataset.cover) {
      link.href = `/capas/${input.dataset.cover}/editar?voltar=${encodeURIComponent(back)}`;
      label.textContent = label.dataset.text; hint.textContent = hint.dataset.text;
    } else if (input.dataset.clip) { // corte sem capa escolhida: a escolha fica na página do corte
      link.href = `/cortes/${input.dataset.clip}`;
      label.textContent = 'Escolher capa'; hint.textContent = 'Este corte ainda não tem capa escolhida.';
    } else { edit.hidden = true; return; }
    link.dataset.item = input.value;
    edit.hidden = false;
  };
  // O que a pessoa já escreveu não se perde na ida ao editor: fica guardado nesta aba e volta quando ela retorna ao mesmo item.
  const named = () => [...form.querySelectorAll('input[name="title"], textarea[name="description"], input[name="agendar"]')];
  edit?.querySelector('[data-cover-link]').addEventListener('click', (e) => {
    try {
      const values = Object.fromEntries(named().map((el) => [el.name, el.value]));
      const platforms = [...form.querySelectorAll('input[name="platforms"]')].map((el) => [el.value, el.checked]);
      sessionStorage.setItem(DRAFT, JSON.stringify({ item: e.currentTarget.dataset.item, values, platforms }));
    } catch { /* sem armazenamento: segue sem guardar */ }
  });
  const restore = (input) => {
    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem(DRAFT) || 'null'); sessionStorage.removeItem(DRAFT); } catch { return; }
    if (!draft || draft.item !== input.value) return;
    named().forEach((el) => { if (draft.values?.[el.name] != null) el.value = draft.values[el.name]; });
    for (const [value, on] of draft.platforms || []) { const el = form.querySelector(`input[name="platforms"][value="${CSS.escape(value)}"]`); if (el && !el.disabled) el.checked = on; }
  };
  const apply = (input) => { fill(fields.title, input.dataset.title || ''); fill(fields.caption, input.dataset.caption || ''); coverButton(input); };
  form.addEventListener('change', (e) => { if (e.target.matches('input[type="radio"]')) apply(e.target); });
  const checked = form.querySelector('input[type="radio"]:checked');
  if (checked) { apply(checked); restore(checked); }
})();

// "Todos": marca/desmarca os itens habilitados do mesmo formulário.
document.querySelectorAll('[data-check-all]').forEach((all) => {
  const scope = all.closest('form');
  const items = () => [...scope.querySelectorAll('[data-check-item]')];
  all.addEventListener('change', () => items().forEach((i) => { i.checked = all.checked; }));
  scope.addEventListener('change', (e) => { if (e.target.matches('[data-check-item]')) all.checked = items().every((i) => i.checked); });
});
