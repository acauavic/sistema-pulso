// Quadro das pautas (uma coluna por estado) e o aviso das que travaram no "Seu dia".
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const col = (html, label) => {
  const i = html.indexOf(`>${label}</span>`);
  assert.ok(i > 0, `coluna ${label}`);
  return html.slice(i, html.indexOf('</section>', i));
};
// O prazo é um dia de Brasília: tirar 3 h antes de formatar, senão à noite o "ontem" em UTC cai no dia de hoje aqui
// (o teste falhava só depois das 21 h).
const ontem = new Date(Date.now() - 86_400_000 - 3 * 3600_000).toISOString().slice(0, 10);

describe('pautas: quadro e Seu dia', () => {
  let app; let gestao; let paula; let ids = {};

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Gil Gestão', email: 'g@t.com', role: 'gestao', projects: [1, 2] });
    const p = await h.createUser({ name: 'Paula Produtora', email: 'p@t.com', role: 'produtora' }); // só o Pulso
    await h.db.query("UPDATE projects SET modules = modules || '{\"producao\": true}'::jsonb WHERE id = 2");
    await require('../src/services/projects').refresh(true);
    gestao = h.client(app.base); await gestao.login('g@t.com');
    paula = h.client(app.base); await paula.login('p@t.com');
    const mk = async (titulo, projectId, state, extra = {}) => {
      const { rows: [e] } = await h.db.query('INSERT INTO episodes (title, number, project_id, status, format) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [titulo, Math.floor(Math.random() * 9000) + 100, projectId, 'pre_producao', projectId === 2 ? 'video' : 'podcast']);
      const { rows: [pa] } = await h.db.query(
        `INSERT INTO pautas (project_id, episode_id, kind, body, state, due_on, review_note, owner_id)
         VALUES ($1, $2, 'pauta', 'temas', $3, $4, $5, $6) RETURNING id`,
        [projectId, e.id, state, extra.due_on || null, extra.note || null, p.id]);
      ids[titulo] = pa.id;
      return e.id;
    };
    await mk('Pauta nova do Cem', 2, 'elaboracao');
    await mk('Esperando o grupo', 2, 'aprovacao');
    await mk('Voltou com ajustes', 2, 'ajustes', { note: 'tirar a pergunta 4' });
    await mk('Pauta atrasada', 1, 'elaboracao', { due_on: ontem });
    await mk('Pauta aprovada', 1, 'aprovada');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('o quadro mostra cada pauta na coluna do estado', async () => {
    const html = (await gestao.get('/episodios?view=pautas')).text;
    assert.match(html, /<a class="on" href="\/episodios\?view=pautas"/, 'a visualização fica marcada');
    assert.match(col(html, 'Em elaboração'), /Pauta nova do Cem/);
    assert.match(col(html, 'Enviada para aprovação'), /Esperando o grupo/);
    assert.match(col(html, 'Ajustes pedidos'), /Voltou com ajustes/);
    assert.match(col(html, 'Ajustes pedidos'), /tirar a pergunta 4/);
    assert.match(col(html, 'Aprovada'), /Pauta aprovada/);
    assert.match(col(html, 'A fazer'), /Nenhuma nesta etapa\./);
    assert.match(html, /PAUTA · V\.\d{3}/, 'o prefixo é o do projeto');
    assert.match(html, /class="project-tag mono"/, 'quem vê os dois projetos vê a sigla');
    const elab = col(html, 'Em elaboração');
    const i = elab.indexOf('Pauta atrasada');
    assert.match(elab.slice(i, elab.indexOf('</a>', i)), /· atrasada/, 'a atrasada aparece marcada no cartão');
  });

  it('o quadro segue o recorte do projeto', async () => {
    const html = (await paula.get('/episodios?view=pautas')).text;
    assert.match(html, /Pauta atrasada/); assert.match(html, /Pauta aprovada/);
    for (const t of ['Pauta nova do Cem', 'Esperando o grupo', 'Voltou com ajustes']) assert.doesNotMatch(html, new RegExp(t), t);
    assert.doesNotMatch(html, /class="project-tag mono"/, 'quem tem um projeto só não vê sigla');
  });

  it('o "Seu dia" da produtora avisa as pautas que travaram', async () => {
    const html = (await paula.get('/')).text;
    assert.match(html, /Pautas que travaram/);
    assert.match(html, /Pauta atrasada/);
    assert.match(html, /ver o quadro/);
    assert.doesNotMatch(html, /Pauta aprovada/, 'aprovada não trava');
    assert.doesNotMatch(html, /Voltou com ajustes/, 'a do outro projeto não aparece');
  });

  it('sem pauta travada, a faixa some', async () => {
    await h.db.query("UPDATE pautas SET due_on = NULL WHERE id = $1", [ids['Pauta atrasada']]);
    assert.doesNotMatch((await paula.get('/')).text, /Pautas que travaram/);
  });
});
