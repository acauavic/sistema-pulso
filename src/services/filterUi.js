// Monta, para uma lista, o estado dos filtros combináveis (do endereço) e o que o partials/filter-builder.ejs precisa.
// Devolve { state, ui, passes(linha) }: `state` vai para filters.toSql (listas do banco); `passes` filtra listas carregadas.
const ff = require('./filters');
const fieldsDef = require('./filterFields');

async function build(req, { entity, action, keep, fields }) {
  const ctx = { userId: req.user.id };
  const state = ff.parse(req.query, fields, ctx);
  const { cleanQuery } = require('../routes/savedFilters');
  return {
    state, fields,
    passes: ff.matcher(state, fields),
    ui: {
      entity, action, keep,
      def: ff.clientDef(fields, state, ctx), count: state.filters.length, summary: ff.summary(state, fields, ctx), query: ff.toQuery(state, ctx),
      views: await fieldsDef.savedViews(entity, req.user.id),
      current: cleanQuery(entity, req.originalUrl.split('?')[1] || ''), open: req.query.fa === '1',
    },
  };
}

module.exports = { build };
