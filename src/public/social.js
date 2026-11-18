// Social: ao escolher um corte/imagem, o título, a legenda e a chamada de cada rede vêm preenchidos (se a pessoa ainda não escreveu por cima).
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
  // chamada de cada rede: a que a IA escreveu para o corte escolhido (sem ela, fica a padrão que já veio no campo)
  const ctaFields = [...form.querySelectorAll('[data-fill-cta]')];
  ctaFields.forEach((el) => auto.set(el, el.value));
  const fillCtas = (input) => {
    let own = {};
    try { own = JSON.parse(input.dataset.ctas || '{}'); } catch { /* sem chamadas próprias */ }
    ctaFields.forEach((el) => { if (own[el.dataset.fillCta]) fill(el, own[el.dataset.fillCta]); });
  };
  const apply = (input) => { fill(fields.title, input.dataset.title || ''); fill(fields.caption, input.dataset.caption || ''); fillCtas(input); coverButton(input); };
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

// Novo post: escolher o item sem rolar por centenas de cartões. Busca (título, convidado, EP), filtro por episódio e 24 por vez
// ("Mostrar mais"). Escolhido o item, a grade recolhe num resumo com "Trocar" e o formulário fica logo abaixo.
(function () {
  const form = document.querySelector('[data-compose]');
  const grid = form && form.querySelector('[data-pick-grid]');
  if (!grid) return;
  const PAGE = 24;
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const cards = [...grid.querySelectorAll('[data-pick]')];
  const search = form.querySelector('[data-pick-search]'); const ep = form.querySelector('[data-pick-ep]');
  const count = form.querySelector('[data-pick-count]'); const moreWrap = form.querySelector('[data-pick-more-wrap]');
  const moreN = form.querySelector('[data-pick-more-n]'); const empty = form.querySelector('[data-pick-empty]');
  const tools = form.querySelector('[data-pick-tools]'); const chosen = form.querySelector('[data-pick-chosen]');
  let limit = PAGE;
  const apply = () => {
    const q = fold(search?.value); const e = ep?.value || '';
    const hits = cards.filter((c) => (!q || c.dataset.find.includes(q)) && (!e || c.dataset.ep === e));
    cards.forEach((c) => { c.hidden = true; });
    hits.slice(0, limit).forEach((c) => { c.hidden = false; });
    if (count) count.textContent = `${hits.length} ${hits.length === 1 ? 'item' : 'itens'}`;
    if (moreWrap) { moreWrap.hidden = hits.length <= limit; if (moreN) moreN.textContent = `(${hits.length - limit})`; }
    if (empty) empty.hidden = hits.length > 0;
  };
  const collapse = (input) => {
    const card = input.closest('[data-pick]'); if (!card || !chosen) return;
    const img = card.querySelector('img'); const pic = chosen.querySelector('[data-pick-chosen-img]');
    if (img && pic) { pic.src = img.currentSrc || img.src; pic.hidden = false; } else if (pic) pic.hidden = true;
    chosen.querySelector('[data-pick-chosen-title]').textContent = card.querySelector('strong')?.textContent || '';
    chosen.querySelector('[data-pick-chosen-ep]').textContent = card.dataset.short || card.querySelector('.small.muted')?.textContent || '';
    chosen.hidden = false; grid.hidden = true; if (tools) tools.hidden = true; if (moreWrap) moreWrap.hidden = true; if (empty) empty.hidden = true;
  };
  const expand = () => { chosen.hidden = true; grid.hidden = false; if (tools) tools.hidden = false; apply(); search?.focus(); };
  search?.addEventListener('input', () => { limit = PAGE; apply(); });
  ep?.addEventListener('change', () => { limit = PAGE; apply(); });
  form.querySelector('[data-pick-more]')?.addEventListener('click', () => { limit += PAGE; apply(); });
  form.querySelector('[data-pick-change]')?.addEventListener('click', expand);
  grid.addEventListener('change', (e) => { if (e.target.matches('input[type="radio"]')) collapse(e.target); });
  apply();
  const pre = grid.querySelector('input[type="radio"]:checked'); if (pre) collapse(pre);
})();
