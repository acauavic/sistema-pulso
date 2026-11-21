// Visualizações salvas dos filtros (Convidados e Conteúdo > Cortes): guardam o endereço com os filtros. De quem salvou ou,
// marcando "compartilhar", de toda a equipe que vê aquela lista. Só quem criou (ou um superadmin) apaga.
const express = require('express');
const db = require('../db/pool');
const { can } = require('../permissions');
const { wrap, isIntId } = require('../utils/wrap');
const { audit } = require('../services/audit');

const router = express.Router();

// base: a lista; home: para onde voltar depois de apagar; keys: os parâmetros que a lista entende (o resto é descartado).
const ENTITIES = {
  guest: { base: '/convidados', home: '/convidados', perm: 'guests.read', keys: ['view', 'q', 'owner', 'status', 'followup', 'f', 'm'] },
  episode: { base: '/episodios', home: '/episodios', perm: 'episodes.read', keys: ['view', 'editor', 'f', 'm'] },
  sponsor: { base: '/patrocinadores', home: '/patrocinadores', perm: 'sponsors.read', keys: ['view', 'q', 'owner', 'stage', 'f', 'm'] },
  clip: { base: '/conteudo', home: '/conteudo?vista=cortes', perm: 'episodes.read', keys: ['vista', 'episodio', 'situacao', 'ordem', 'f', 'm'] },
  board: { base: '/conteudo', home: '/conteudo?vista=quadro', perm: 'episodes.read', keys: ['vista', 'tipo', 'episodio', 'publicados', 'f', 'm'] },
  post: { base: '/conteudo', home: '/conteudo?vista=posts', perm: 'episodes.read', keys: ['vista', 'episodio', 'f', 'm'] },
  request: { base: '/conteudo', home: '/conteudo?vista=pedidos', perm: 'episodes.read', keys: ['vista', 'episodio', 'f', 'm'] },
};

// Só os parâmetros que a lista entende (o resto do endereço é descartado).
function cleanQuery(entity, raw) {
  const src = new URLSearchParams(String(raw || '').replace(/^\?/, '').slice(0, 2000));
  const out = new URLSearchParams();
  for (const k of ENTITIES[entity].keys) for (const v of src.getAll(k)) if (v) out.append(k, v.slice(0, 300));
  return out.toString();
}
const hrefOf = (entity, query) => `${ENTITIES[entity].base}${query ? `?${query}` : ''}`;

router.post('/filtros/visualizacoes', wrap(async (req, res) => {
  const entity = Object.prototype.hasOwnProperty.call(ENTITIES, req.body.entidade) ? req.body.entidade : null;
  if (!entity || !can(req.user, ENTITIES[entity].perm)) return res.status(403).render('error', { title: 'Sem permissão', message: 'Você não vê esta lista.' });
  const query = cleanQuery(entity, req.body.query);
  const name = String(req.body.nome || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) { await req.flash('error', 'Dê um nome para a visualização.'); return res.redirect(hrefOf(entity, query)); }
  if (!/(^|&)f=/.test(query)) { await req.flash('error', 'Escolha pelo menos um filtro antes de salvar.'); return res.redirect(hrefOf(entity, query)); }
  const { rows: [n] } = await db.query('SELECT count(*)::int AS n FROM saved_filters WHERE user_id = $1 AND entity = $2', [req.user.id, entity]);
  if (n.n >= 30) { await req.flash('error', 'Você já tem 30 visualizações nesta lista. Apague alguma antes.'); return res.redirect(hrefOf(entity, query)); }
  const { rows: [v] } = await db.query('INSERT INTO saved_filters (user_id, entity, name, query, shared) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [req.user.id, entity, name, query, req.body.compartilhar === '1']);
  await audit(req, 'filtro.visualizacao_salva', 'saved_filter', v.id, { entidade: entity, nome: name, compartilhada: req.body.compartilhar === '1' });
  await req.flash('ok', `Visualização "${name}" salva.`);
  res.redirect(hrefOf(entity, query));
}));

router.post('/filtros/visualizacoes/:id/excluir', wrap(async (req, res) => {
  const { rows: [v] } = isIntId(req.params.id) ? await db.query('SELECT * FROM saved_filters WHERE id = $1', [req.params.id]) : { rows: [] };
  if (!v) return res.status(404).render('error', { title: 'Não encontrado', message: 'Esta visualização não existe mais.' });
  if (String(v.user_id) !== String(req.user.id) && req.user.role !== 'superadmin') return res.status(403).render('error', { title: 'Sem permissão', message: 'Só quem criou apaga esta visualização.' });
  await db.query('DELETE FROM saved_filters WHERE id = $1', [v.id]);
  await audit(req, 'filtro.visualizacao_apagada', 'saved_filter', v.id, { entidade: v.entity, nome: v.name });
  await req.flash('ok', `Visualização "${v.name}" apagada.`);
  res.redirect(ENTITIES[v.entity].home);
}));

module.exports = router;
module.exports.cleanQuery = cleanQuery;
