// Quando a IA preenche campos sozinha (tarefa por voz, tarefa da mensagem, textos das capas em lote), ela só escreve no que está
// vazio, no valor que veio na tela ou no que ela mesma pôs da última vez. O que a pessoa escreveu antes ou enquanto a IA trabalhava
// fica como está, e kept() diz em quais campos (para a frase "Mantive o que você escreveu em …").
// Uso: const f = PulsoAIFill.create(); f.write(campo, valor); … PulsoAIFill.keptText(f.kept()).
// Campo de texto rico: passe { value (get/set), defaultValue: '', label } no lugar do elemento. data-ai-free="1" = a IA sempre pode.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PulsoAIFill = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const mine = new WeakMap(); // campo -> último valor escrito pela IA (vale entre uma resposta e outra)

  const defaultOf = (el) => {
    if (el.tagName === 'SELECT') return ([...(el.options || [])].find((o) => o.defaultSelected) || (el.options || [])[0] || { value: '' }).value;
    return el.defaultValue ?? '';
  };
  const labelOf = (el) => {
    if (el.label) return el.label;
    if (el.dataset?.aiLabel) return el.dataset.aiLabel;
    const l = el.labels?.[0];
    if (!l) return el.name || 'um campo';
    const first = l.childNodes?.[0];
    return String((first && first.nodeType === 3 ? first.textContent : l.textContent) || '').trim() || el.name || 'um campo';
  };
  // Pode escrever: vazio, igual ao da tela, igual ao que a IA pôs, ou campo livre.
  const writable = (el) => el.dataset?.aiFree === '1' || !String(el.value ?? '').trim() || el.value === defaultOf(el) || (mine.has(el) && el.value === mine.get(el));

  function create() {
    const kept = [];
    return {
      write(el, value) {
        if (!el || value === null || value === undefined || value === '') return false;
        if (!writable(el)) { const name = labelOf(el); if (!kept.includes(name)) kept.push(name); return false; }
        el.value = value;
        mine.set(el, el.value); // o select pode recusar um valor que não existe: guarda o que ficou
        if (typeof el.dispatchEvent === 'function' && typeof Event === 'function') { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
        return true;
      },
      writable,
      kept: () => kept.slice(),
    };
  }
  const list = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}` : items[0] || '');
  const keptText = (items) => (items && items.length ? `Mantive o que você escreveu em ${list(items)}.` : '');
  // A IA escreveu: o campo passa a contar como dela (útil quando o valor é posto por outra função, ex.: rte.setPlain).
  const mark = (el) => { if (el) mine.set(el, el.value); };
  return { create, keptText, mark, writable };
}));
