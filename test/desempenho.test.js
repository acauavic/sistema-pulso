const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
const rc = require('../src/utils/requestCache');
const fin = require('../src/services/finance');
const cal = require('../src/services/calendar');
const notify = require('../src/services/notify');

// Conta as consultas que o servidor (no mesmo processo) manda ao banco enquanto `fn` roda.
async function countQueries(fn) {
  const seen = [];
  const orig = h.db.query;
  h.db.query = (text, params) => { seen.push(String(text).replace(/\s+/g, ' ').trim()); return orig(text, params); };
  try { await fn(); } finally { h.db.query = orig; }
  return seen;
}

describe('desempenho: sem N+1, leitura repetida uma vez por página, índices e esqueleto', () => {
  const as = {}; let app; const u = {};

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['admin', 'superadmin'], ['gestao', 'gestao'], ['prod', 'produtora']]) {
      u[k] = await h.createUser({ name: k, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); await as[k].login(`${k}@t.com`);
    }
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('memória da requisição: guarda dentro dela, esquece com forget e não guarda erro nem fora de requisição', async () => {
    let calls = 0;
    const fn = async () => { calls += 1; return calls; };
    assert.equal(await rc.memo('k', fn), 1); assert.equal(await rc.memo('k', fn), 2, 'fora de requisição, sem memória');
    await new Promise((resolve) => rc.middleware({}, {}, async () => {
      assert.equal(await rc.memo('k', fn), 3); assert.equal(await rc.memo('k', fn), 3);
      rc.forget('k'); assert.equal(await rc.memo('k', fn), 4);
      let fail = true;
      const flaky = async () => { if (fail) { fail = false; throw new Error('caiu'); } return 'ok'; };
      await assert.rejects(rc.memo('f', flaky)); assert.equal(await rc.memo('f', flaky), 'ok', 'erro não fica guardado');
      resolve();
    }));
  });

  it('ajuste lido várias vezes na mesma página vai ao banco uma vez por chave; salvar mostra o valor novo', async () => {
    const qs = await countQueries(() => as.admin.get('/integracoes'));
    const keys = qs.filter((q) => q.startsWith('SELECT value FROM app_settings WHERE key = $1'));
    assert.ok(keys.length > 0);
    // cada consulta por chave é de uma chave diferente (antes: até 18 seguidas, repetindo chaves)
    const settings = require('../src/services/settings');
    await new Promise((resolve) => rc.middleware({}, {}, async () => {
      assert.equal(await settings.get('plateia_duration'), '1h30 a 2h');
      await settings.set('plateia_duration', '2h');
      assert.equal(await settings.get('plateia_duration'), '2h', 'set esquece o valor lido antes');
      resolve();
    }));
    const menu = qs.filter((q) => q === 'SELECT id, name FROM users WHERE active ORDER BY lower(name)');
    assert.ok(menu.length <= 1, 'a lista da equipe é lida uma vez por página');
  });

  it('estoque: as movimentações de todos os itens vêm numa consulta só', async () => {
    for (const name of ['Caneca', 'Camiseta', 'Boné']) await as.prod.act('/financeiro/estoque', { name, qty: '10', per_episode: '1' }, { from: '/financeiro/estoque' });
    const items = await fin.stockItems();
    for (const i of items) await as.prod.act(`/financeiro/estoque/${i.id}/ajustar`, { acao: 'perda', qty: '1', note: `quebrou ${i.name}` }, { from: '/financeiro/estoque' });
    let page;
    const qs = await countQueries(async () => { page = (await as.prod.get('/financeiro/estoque')).text; });
    assert.equal(qs.filter((q) => /FROM fin_stock_moves m LEFT JOIN episodes/.test(q)).length, 1, 'a lista de movimentações é uma consulta para todos os itens');
    for (const n of ['Caneca', 'Camiseta', 'Boné']) assert.match(page, new RegExp(`quebrou ${n}`));
    const map = await fin.stockMovesFor(items.map((i) => i.id), 1);
    for (const i of items) assert.equal(map[i.id].length, 1, 'limite por item');
    assert.deepEqual(await fin.stockMovesFor([]), {});
  });

  it('aviso para várias pessoas é gravado num INSERT só, sem duplicar com a mesma chave', async () => {
    const send = () => notify.notify({ type: 'comentario', users: [u.admin.id, u.gestao.id, u.prod.id], title: 'Teste em lote', dedupe: 'lote-1' });
    let created;
    const qs = await countQueries(async () => { created = await send(); });
    assert.equal(created.length, 3);
    assert.equal(qs.filter((q) => q.startsWith('INSERT INTO notifications')).length, 1);
    assert.equal((await send()).length, 0, 'a chave de deduplicação segura a segunda vez');
  });

  it('calendário: o dia é o de Brasília, nas pontas da faixa', async () => {
    const mk = async (name, at) => (await h.db.query("INSERT INTO guests (name, profile, status, proposed_at) VALUES ($1, 'medico', 'agendado', $2) RETURNING id", [name, at])).rows[0].id;
    await mk('Última hora do dia', '2026-12-10T23:30:00-03:00');
    await mk('Já é o dia seguinte', '2026-12-11T00:10:00-03:00');
    await mk('Primeiro minuto', '2026-12-09T00:00:00-03:00');
    const evs = await cal.events({ user: { id: u.admin.id, role: 'superadmin' }, from: '2026-12-09', to: '2026-12-10', types: ['gravacao'] });
    const titles = evs.map((e) => e.title).join(' | ');
    assert.match(titles, /Última hora do dia/); assert.match(titles, /Primeiro minuto/);
    assert.doesNotMatch(titles, /Já é o dia seguinte/);
  });

  it('os índices das consultas frequentes existem', async () => {
    const { rows } = await h.db.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'");
    const names = new Set(rows.map((r) => r.indexname));
    for (const n of ['episode_publications_status_idx', 'episode_publications_updated_idx', 'episode_publications_scheduled_idx', 'episode_publications_clip_idx',
      'jobs_kind_ref_idx', 'episode_frames_clip_idx', 'tasks_guest_idx', 'tasks_sponsor_idx', 'sponsor_episodes_episode_idx', 'guests_proposed_idx', 'plateia_events_guest_idx']) {
      assert.ok(names.has(n), `falta o índice ${n}`);
    }
  });

  it('esqueleto: o painel carrega o script, que ignora downloads e respeita quem já tratou o clique', async () => {
    const html = (await as.admin.get('/')).text;
    const at = (s) => html.indexOf(s);
    assert.ok(at('/static/skeleton.js') > at('/static/uploads.js'), 'depois da bandeja de envios (que intercepta a navegação durante o envio)');
    const js = fs.readFileSync(path.join(__dirname, '../src/public/skeleton.js'), 'utf8');
    assert.match(js, /defaultPrevented/); assert.match(js, /pageshow/); assert.match(js, /baixar/);
    assert.doesNotMatch(js, /--action|lime/i, 'carregar não é ação: sem lime');
    const css = fs.readFileSync(path.join(__dirname, '../src/public/app.css'), 'utf8');
    assert.match(css, /\.main\.is-loading > \.container \{ display: none; \}/);
    const login = (await h.client(app.base).get('/login')).text;
    assert.doesNotMatch(login, /skeleton\.js/, 'fora do painel (login) não entra');
  });
});
