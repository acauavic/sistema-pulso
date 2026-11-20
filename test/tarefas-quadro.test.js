// Quadro das tarefas: a visão escolhida volta igual, "Feito" não cresce para sempre, dá para mover sem arrastar e o motivo do
// bloqueio é pedido numa janela do sistema.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');

const col = (html, key) => {
  const i = html.indexOf(`data-status-col="${key}"`);
  assert.ok(i > 0, `coluna ${key}`);
  return html.slice(i, html.indexOf('</section>', i));
};

describe('tarefas: o quadro', () => {
  let app; let c; let me; const ids = {};
  const task = async (title, extra = {}) => {
    const cols = ['title', 'kind', 'status', 'assignee_id', 'created_by', 'due_on', 'completed_at', 'block_reason'];
    const v = { title, kind: 'geral', status: 'a_fazer', assignee_id: me.id, created_by: me.id, due_on: null, completed_at: null, block_reason: null, ...extra };
    const { rows: [t] } = await h.db.query(
      `INSERT INTO tasks (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, cols.map((k) => v[k]));
    ids[title] = t.id;
    return t.id;
  };
  const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    me = await h.createUser({ name: 'Gil Gestão', email: 'g@t.com', role: 'gestao' });
    c = h.client(app.base); await c.login('g@t.com');
    await task('Atrasada', { due_on: day(-3) });
    await task('Para amanhã', { due_on: day(1) });
    await task('Sem prazo');
    await task('Fazendo agora', { status: 'fazendo' });
    await task('Terminada hoje', { status: 'feito', completed_at: new Date().toISOString() });
    await task('Terminada há 3 dias', { status: 'feito', completed_at: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    await task('Terminada no mês passado', { status: 'feito', completed_at: new Date(Date.now() - 30 * 86_400_000).toISOString() });
    await task('Terminada sem data', { status: 'feito' });
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('a visão escolhida volta igual na próxima vez (e vale em qualquer aparelho)', async () => {
    assert.match((await c.get('/tarefas')).text, /class="board task-board"|class="task-section"/);
    assert.doesNotMatch((await c.get('/tarefas')).text, /data-status-col/, 'sem escolha, começa na lista');
    assert.match((await c.get('/tarefas?visao=quadro')).text, /data-status-col="a_fazer"/);
    assert.match((await c.get('/tarefas')).text, /data-status-col="a_fazer"/, 'a escolha ficou guardada');
    assert.equal((await h.db.query('SELECT prefs FROM users WHERE id = $1', [me.id])).rows[0].prefs.tarefas_visao, 'quadro');
    // outro aparelho (outra sessão) abre no quadro também
    const outro = h.client(app.base); await outro.login('g@t.com');
    assert.match((await outro.get('/tarefas')).text, /data-status-col="a_fazer"/);
    assert.match((await c.get('/tarefas?visao=lista')).text, /class="task-section"/);
    assert.doesNotMatch((await c.get('/tarefas')).text, /data-status-col/);
    await c.get('/tarefas?visao=quadro');
  });

  it('"Feito" mostra as duas últimas semanas e leva ao resto por um link', async () => {
    const html = (await c.get('/tarefas?visao=quadro')).text;
    const feito = col(html, 'feito');
    assert.match(feito, /Terminada hoje/); assert.match(feito, /Terminada há 3 dias/);
    assert.doesNotMatch(feito, /Terminada no mês passado/); assert.doesNotMatch(feito, /Terminada sem data/);
    assert.match(feito, /<span class="count" data-count>2<\/span>/);
    assert.match(feito, /\+ <span class="mono">2<\/span> feitas antes/);
    assert.ok(feito.indexOf('Terminada hoje') < feito.indexOf('Terminada há 3 dias'), 'o que terminou por último vem em cima');

    const todas = col((await c.get('/tarefas?visao=quadro&feitas=todas')).text, 'feito');
    for (const t of ['Terminada hoje', 'Terminada há 3 dias', 'Terminada no mês passado', 'Terminada sem data']) assert.match(todas, new RegExp(t), t);
    assert.match(todas, /Mostrar só os últimos <span class="mono">14<\/span> dias/);
    assert.doesNotMatch(todas, /feitas antes/);
  });

  it('coluna vazia diz o que fazer; a de bloqueadas explica o motivo', async () => {
    const html = (await c.get('/tarefas?visao=quadro')).text;
    assert.match(col(html, 'bloqueada'), /Nenhuma nesta etapa\. Mova um cartão para cá e diga o motivo\./);
    assert.match(col(html, 'a_fazer'), /Nenhuma nesta etapa\./, 'o texto fica na marcação e o CSS esconde quando há cartão');
  });

  it('dentro da coluna, a mais atrasada vem primeiro e aparece em vermelho', async () => {
    const aFazer = col((await c.get('/tarefas?visao=quadro')).text, 'a_fazer');
    const order = ['Atrasada', 'Para amanhã', 'Sem prazo'].map((t) => aFazer.indexOf(t));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `ordem: ${order}`);
    const i = aFazer.indexOf('Atrasada');
    const card = aFazer.slice(aFazer.lastIndexOf('<article', i), aFazer.indexOf('</article>', i));
    assert.match(card, /class="task-card st-a_fazer late/); assert.match(card, /· atrasada/);
  });

  it('cada cartão tem o menu "Mover para" com as outras etapas (sem arrastar)', async () => {
    const html = (await c.get('/tarefas?visao=quadro')).text;
    const i = html.indexOf('Fazendo agora');
    const card = html.slice(html.lastIndexOf('<article', i), html.indexOf('</article>', i));
    assert.match(card, /<details class="row-menu tc-move">/);
    assert.match(card, /<span class="kicker m-0">Mover para<\/span>/);
    for (const [status, label] of [['a_fazer', 'A fazer'], ['feito', 'Feito'], ['bloqueada', 'Bloqueada']]) {
      assert.match(card, new RegExp(`name="status" value="${status}"[\\s\\S]{0,120}>${label}<`), label);
    }
    assert.doesNotMatch(card, /name="status" value="fazendo"/, 'a etapa atual não aparece no menu');
    assert.match(card, /action="\/tarefas\/\d+\/status" data-block-form/, 'bloquear pede o motivo antes de enviar');

    // o menu move de verdade
    const r = await c.act(`/tarefas/${ids['Fazendo agora']}/status`, { status: 'feito', voltar: '/tarefas?escopo=minhas&visao=quadro' }, { from: '/tarefas?visao=quadro' });
    assert.equal(r.status, 302); assert.equal(r.location, '/tarefas?escopo=minhas&visao=quadro');
    const { rows: [t] } = await h.db.query('SELECT status, completed_at FROM tasks WHERE id = $1', [ids['Fazendo agora']]);
    assert.equal(t.status, 'feito'); assert.ok(t.completed_at);
    await h.db.query("UPDATE tasks SET status = 'fazendo', completed_at = NULL WHERE id = $1", [ids['Fazendo agora']]);
  });

  it('bloquear pede o motivo numa janela do sistema, e sem motivo não salva', async () => {
    const html = (await c.get('/tarefas?visao=quadro')).text;
    assert.match(html, /<dialog class="modal" id="modal-bloquear"/);
    assert.match(html, /<h2 id="modal-bloquear-h">Por que está bloqueada\?<\/h2>/);
    assert.match(html, /name="reason" maxlength="200" required/);
    const js = fs.readFileSync(path.join(__dirname, '..', 'src/public/collab.js'), 'utf8');
    assert.match(js, /getElementById\('modal-bloquear'\)/);
    assert.ok(js.indexOf('window.prompt') > js.indexOf("if (!blockDlg)"), 'a caixinha do navegador fica só para quem não tem a janela');

    const semMotivo = await c.act(`/tarefas/${ids.Atrasada}/status`, { status: 'bloqueada' }, { from: '/tarefas?visao=quadro' });
    assert.equal(semMotivo.status, 422);
    assert.equal((await h.db.query('SELECT status FROM tasks WHERE id = $1', [ids.Atrasada])).rows[0].status, 'a_fazer');
    const comMotivo = await c.act(`/tarefas/${ids.Atrasada}/status`, { status: 'bloqueada', block_reason: 'esperando o material' }, { from: '/tarefas?visao=quadro' });
    assert.equal(comMotivo.status, 302);
    const bloqueada = col((await c.get('/tarefas?visao=quadro')).text, 'bloqueada');
    assert.match(bloqueada, /Bloqueada: esperando o material/);
  });
});
