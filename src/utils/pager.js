// Paginação das listas longas: ?pagina=N, PAGE itens por página. Busca um a mais para saber se existe a próxima.
function pageOf(req, size) {
  const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.pagina, 10) || 1));
  return { page, size, offset: (page - 1) * size, limit: size + 1 };
}
// rows: o que veio do banco (com o item a mais). Devolve { rows (só a página), pager (para partials/pager.ejs) }.
function paginate(req, rows, { page, size }) {
  const hasNext = rows.length > size;
  const url = (n) => {
    const q = new URLSearchParams(req.query);
    if (n > 1) q.set('pagina', String(n)); else q.delete('pagina');
    const s = q.toString();
    return `${req.path}${s ? `?${s}` : ''}`;
  };
  return { rows: rows.slice(0, size), pager: { page, hasNext, url } };
}
module.exports = { pageOf, paginate };
