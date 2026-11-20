// Cada item nasce no seu projeto: o escolhido no menu, o do campo Projeto em "Todos os projetos", ou o do item a que está ligado
// (o vínculo vence o seletor).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');

const one = async (sql, params) => (await h.db.query(sql, params)).rows[0];
const projectOf = async (table, col, value) => (await one(`SELECT project_id FROM ${table} WHERE ${col} = $1`, [value])).project_id;

describe('projetos: criar no projeto certo', () => {
  let app; let sara; let paula; let saraUser;
  // confirmar_duplicata: os nomes de teste se parecem; o aviso de possível duplicata não é o assunto aqui
  const guest = (name, extra = {}) => ({ name, instagram: `@${name.toLowerCase().replace(/\W/g, '')}`, profile: 'medico', status: 'prospect', owner_id: saraUser.id, confirmar_duplicata: '1', ...extra });
  const pick = (project) => sara.act('/projeto', { project, voltar: '/' });

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    saraUser = await h.createUser({ name: 'Sara Super', email: 's@t.com', role: 'superadmin', projects: [1, 2] });
    await h.createUser({ name: 'Paula Produtora', email: 'p@t.com', role: 'produtora' });
    sara = h.client(app.base); await sara.login('s@t.com');
    paula = h.client(app.base); await paula.login('p@t.com');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('com o Projeto 100 escolhido, convidado, patrocinador, pedido e tarefa nascem nele, sem campo Projeto', async () => {
    await pick('2');
    assert.doesNotMatch((await sara.get('/convidados/novo')).text, /project-field/);
    assert.equal((await sara.act('/convidados', guest('Dra Cem'), { from: '/convidados/novo' })).status, 302);
    assert.equal(await projectOf('guests', 'name', 'Dra Cem'), 2);
    assert.equal((await sara.act('/patrocinadores', { company: 'Marca Cem', kind: 'negocio', stage: 'prospect', owner_id: saraUser.id, confirmar_duplicata: '1' }, { from: '/patrocinadores/novo' })).status, 302);
    assert.equal(await projectOf('sponsors', 'company', 'Marca Cem'), 2);
    assert.equal((await sara.act('/conteudo/pedidos', { kind: 'trailer', title: 'Trailer Cem', format: 'horizontal' })).status, 302);
    assert.equal(await projectOf('content_requests', 'title', 'Trailer Cem'), 2);
    assert.equal((await sara.act('/tarefas', { title: 'Tarefa Cem', kind: 'geral' }, { from: '/tarefas' })).status, 302);
    assert.equal(await projectOf('tasks', 'title', 'Tarefa Cem'), 2);
  });

  it('em "Todos os projetos" o formulário pergunta o projeto primeiro; sem resposta, não cria', async () => {
    await pick('');
    const form = (await sara.get('/convidados/novo')).text;
    assert.match(form, /<fieldset class="seg-radio project-field"><legend>Projeto \*<\/legend>/);
    assert.match(form, /name="project_id" value="1"[^>]*><span>Pulso<\/span>/); assert.match(form, /name="project_id" value="2"[^>]*><span>Projeto 100<\/span>/);
    assert.ok(form.indexOf('project-field') < form.indexOf('name="name"'), 'o campo Projeto vem antes dos outros');
    const no = await sara.act('/convidados', guest('Dra Sem Projeto'), { from: '/convidados/novo' });
    assert.equal(no.status, 400); assert.match(no.text, /Escolha o projeto\./);
    assert.equal(await one("SELECT 1 FROM guests WHERE name = 'Dra Sem Projeto'"), undefined);
    assert.equal((await sara.act('/convidados', guest('Dra Escolhida', { project_id: '2' }), { from: '/convidados/novo' })).status, 302);
    assert.equal(await projectOf('guests', 'name', 'Dra Escolhida'), 2);
    const sp = await sara.act('/patrocinadores', { company: 'Marca Sem Projeto', kind: 'negocio', stage: 'prospect', owner_id: saraUser.id, confirmar_duplicata: '1' }, { from: '/patrocinadores/novo' });
    assert.equal(sp.status, 400); assert.match(sp.text, /Escolha o projeto\./);
    assert.equal((await sara.act('/patrocinadores', { company: 'Marca Um', kind: 'negocio', stage: 'prospect', owner_id: saraUser.id, project_id: '1', confirmar_duplicata: '1' }, { from: '/patrocinadores/novo' })).status, 302);
    assert.equal(await projectOf('sponsors', 'company', 'Marca Um'), 1);
    // projeto de que ela não participa (ou inventado) não vale
    assert.equal((await sara.act('/convidados', guest('Dra Nove', { project_id: '9' }), { from: '/convidados/novo' })).status, 400);
  });

  it('tarefa em "Todos os projetos": começa em Geral (sem projeto) e aceita um projeto', async () => {
    await pick('');
    const page = (await sara.get('/tarefas')).text;
    assert.match(page, /<fieldset class="seg-radio project-field"><legend>Projeto<\/legend>\s*<label><input type="radio" name="project_id" value="" checked><span>Geral<\/span>/);
    await sara.act('/tarefas', { title: 'Tarefa de todos', kind: 'geral', project_id: '' }, { from: '/tarefas' });
    assert.equal(await projectOf('tasks', 'title', 'Tarefa de todos'), null);
    await sara.act('/tarefas', { title: 'Tarefa do Pulso', kind: 'geral', project_id: '1' }, { from: '/tarefas' });
    assert.equal(await projectOf('tasks', 'title', 'Tarefa do Pulso'), 1);
  });

  it('quem participa de um projeto só não vê o campo e cria nele, venha o que vier no formulário', async () => {
    assert.doesNotMatch((await paula.get('/convidados/novo')).text, /project-field/);
    assert.doesNotMatch((await paula.get('/tarefas')).text, /project-field/);
    const u = await one("SELECT id FROM users WHERE email = 'p@t.com'");
    assert.equal((await paula.act('/convidados', { ...guest('Dra Paula'), owner_id: u.id, project_id: '2' }, { from: '/convidados/novo' })).status, 302);
    assert.equal(await projectOf('guests', 'name', 'Dra Paula'), 1);
    await paula.act('/tarefas', { title: 'Tarefa da Paula', kind: 'geral' }, { from: '/tarefas' });
    assert.equal(await projectOf('tasks', 'title', 'Tarefa da Paula'), 1);
  });

  it('o vínculo vence o seletor: episódio do convidado, corte do episódio, tarefa do episódio', async () => {
    const production = require('../src/services/production'); const clips = require('../src/services/clips'); const tasks = require('../src/services/tasks');
    await pick('2'); // o menu está no Projeto 100…
    const g = await one("INSERT INTO guests (name, status, project_id) VALUES ('Dr Pulso Gravado', 'gravado', 1) RETURNING id");
    const ep1 = await production.syncFromGuest(g.id, saraUser.id); // …mas o convidado é do Pulso
    assert.equal(ep1.project_id, 1, 'o episódio é do projeto do convidado');
    const ep2 = await production.createEpisode({ title: 'Vídeo solto do Cem', userId: saraUser.id, projectId: 2 });
    assert.equal(ep2.project_id, 2, 'sem convidado, vale o projeto informado');
    const { clip } = await clips.startUpload({ filename: 'a.mp4', size: 1000, contentType: 'video/mp4', userId: saraUser.id, episodeId: ep1.id, projectId: 2 });
    assert.equal(await projectOf('episode_clips', 'id', clip.id), 1, 'o corte é do projeto do episódio');
    const loose = await clips.startUpload({ filename: 'b.mp4', size: 1000, contentType: 'video/mp4', userId: saraUser.id, projectId: 2 });
    assert.equal(await projectOf('episode_clips', 'id', loose.clip.id), 2);
    // atribuir o corte solto do Projeto 100 a um episódio do Pulso leva o corte para o Pulso
    await h.db.query("UPDATE episode_clips SET status = 'pronto', storage_key = 'pp/cortes/x/b.mp4' WHERE id = $1", [loose.clip.id]);
    await h.db.query('UPDATE episodes SET status = $2 WHERE id = $1', [ep1.id, clips.ELIGIBLE_STATUSES[0]]);
    const out = await clips.assign(loose.clip.id, ep1.id, saraUser.id);
    assert.equal(out.error, undefined, out.error);
    assert.equal(await projectOf('episode_clips', 'id', loose.clip.id), 1);
    const t = await tasks.create({ values: { title: 'Tarefa do episódio', project_id: 2 }, user: saraUser, links: { episodeId: ep1.id } });
    assert.equal(t.project_id, 1, 'a tarefa é do projeto do episódio');
    const general = await tasks.create({ values: { title: 'Tarefa do sistema' }, user: null });
    assert.equal(general.project_id, null);
    await pick('');
  });

  it('pedido de um episódio fica no projeto do episódio, mesmo com outro escolhido', async () => {
    const ep = await one("SELECT id FROM episodes WHERE title = 'Vídeo solto do Cem'");
    await pick('1');
    assert.equal((await sara.act('/conteudo/pedidos', { kind: 'trailer', title: 'Trailer do vídeo', format: 'horizontal', episode_id: ep.id })).status, 302);
    assert.equal(await projectOf('content_requests', 'title', 'Trailer do vídeo'), 2);
    await pick('');
  });

  it('lixeira: desfazer devolve no mesmo projeto; item guardado antes dos projetos volta no Pulso', async () => {
    const cem = await one("SELECT id FROM guests WHERE name = 'Dra Cem'");
    assert.equal((await sara.act(`/convidados/${cem.id}/excluir`, {}, { from: `/convidados/${cem.id}` })).status, 302);
    assert.equal(await one('SELECT 1 FROM guests WHERE id = $1', [cem.id]), undefined);
    let t = await one("SELECT id, project_id FROM trash_items WHERE kind = 'guest' AND ref_id = $1", [String(cem.id)]);
    assert.equal(t.project_id, 2, 'a lixeira guarda de que projeto era');
    assert.equal((await sara.act(`/lixeira/${t.id}/restaurar`, {}, { from: '/lixeira' })).status, 302);
    assert.equal(await projectOf('guests', 'id', cem.id), 2);
    // linha guardada antes da migração: sem project_id no JSON
    const old = await one("SELECT id FROM guests WHERE name = 'Dra Paula'");
    await sara.act(`/convidados/${old.id}/excluir`, {}, { from: `/convidados/${old.id}` });
    t = await one("SELECT id, payload FROM trash_items WHERE kind = 'guest' AND ref_id = $1", [String(old.id)]);
    for (const r of t.payload.rows) delete r.row.project_id;
    await h.db.query('UPDATE trash_items SET payload = $2 WHERE id = $1', [t.id, JSON.stringify(t.payload)]);
    assert.equal((await sara.act(`/lixeira/${t.id}/restaurar`, {}, { from: '/lixeira' })).status, 302);
    assert.equal(await projectOf('guests', 'id', old.id), 1);
  });

  it('todo INSERT numa tabela-raiz informa o projeto (o padrão do banco é só rede de segurança)', () => {
    const root = path.join(__dirname, '..', 'src');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
      .filter((f) => f.endsWith('.js') && !path.basename(f).startsWith('._') && !f.includes(`${path.sep}public${path.sep}`));
    const missing = [];
    for (const f of walk(root)) {
      const src = fs.readFileSync(f, 'utf8');
      // a lista de colunas vai até o VALUES (às vezes é montada com COLUMNS.join(', '))
      for (const m of src.matchAll(/INSERT INTO (guests|sponsors|episodes|episode_clips|content_requests|social_ideas|plateia_events)\s*\(([\s\S]*?)VALUES/g)) {
        if (!/\bproject_id\b/.test(m[2])) missing.push(`${path.relative(root, f)}: ${m[1]}`);
      }
    }
    assert.deepEqual(missing, []);
  });
});
