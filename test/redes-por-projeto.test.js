// Redes por projeto: cada projeto tem as contas dele no provedor, os números dele, a configuração das respostas por IA
// com o nome e o contexto dele, e as telas do Social seguem o projeto escolhido. Tela de módulo que o projeto não usa: 404.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const projects = require('../src/services/projects');
const socialApi = require('../src/services/socialApi');
const replies = require('../src/services/commentReplies');
const automation = require('../src/services/commentAutomation');
const settings = require('../src/services/settings');

const PULSO = 1; const P100 = 2;

describe('redes por projeto', () => {
  let app; let casa; let cem;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);

  before(async () => {
    await h.resetDb();
    await h.createUser({ name: 'Casa', email: 'casa@local.test', role: 'superadmin', projects: [PULSO, P100] });
    await h.createUser({ name: 'Cem', email: 'cem@local.test', role: 'gestao', projects: [P100] });
    await h.db.query("UPDATE users SET house = false WHERE email = 'cem@local.test'");
    app = await h.startServer();
    casa = h.client(app.base); await casa.login('casa@local.test');
    cem = h.client(app.base); await cem.login('cem@local.test');
    await projects.refresh(true);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('a migração guarda as contas e os números por projeto, e o que existia é do Pulso', async () => {
    await h.db.query("INSERT INTO social_account_status (provider, network, handle, status) VALUES ('uploadpost','instagram','@pulso','ok')");
    assert.equal(Number((await one("SELECT project_id FROM social_account_status WHERE network = 'instagram'")).project_id), PULSO);
    await h.db.query("INSERT INTO social_snapshots (taken_on, platform, data) VALUES (CURRENT_DATE, 'instagram', '{\"followers\": 10}')");
    assert.equal(Number((await one("SELECT project_id FROM social_snapshots WHERE platform = 'instagram'")).project_id), PULSO);
    // a mesma rede no mesmo dia, em outro projeto, é outra linha
    await h.db.query("INSERT INTO social_snapshots (taken_on, platform, data, project_id) VALUES (CURRENT_DATE, 'instagram', '{\"followers\": 3}', $1)", [P100]);
    assert.equal((await q('SELECT 1 FROM social_snapshots')).length, 2);
  });

  it('a conta do provedor é a do projeto (variável por projeto); sem isso, a de sempre', async () => {
    const pulso = socialApi.profileFor(PULSO);
    assert.equal(pulso.uploadPostUser, require('../src/config').uploadPost.user, 'o projeto padrão usa a conta de sempre');
    assert.equal(pulso.own, false);
    const semVar = socialApi.profileFor(P100);
    assert.equal(semVar.uploadPostUser, require('../src/config').uploadPost.user, 'sem variável, cai na conta de sempre');
    process.env.UPLOAD_POST_USER_PROJETO_100 = 'cem';
    try {
      // o config lê o ambiente na hora da chamada
      const comVar = require('../src/config').socialEnv('projeto-100');
      assert.equal(comVar.uploadPostUser, 'cem');
    } finally { delete process.env.UPLOAD_POST_USER_PROJETO_100; }
  });

  it('a configuração das respostas por IA e os links são de cada projeto', async () => {
    const r = await replies.setConfig({ mode: 'aprovar', per_hour: '10', from: '8', to: '23', team_handles: '', dm_on: '1', dm_per_day: '50', invite_on: '1' }, { projectId: P100 });
    assert.ok(!r.error, r.error);
    assert.equal((await replies.getConfig(P100)).per_hour, 10);
    assert.equal((await replies.getConfig(PULSO)).per_hour, replies.DEFAULTS.per_hour, 'o Pulso continua com o dele');
    assert.equal(await settings.get('respostas_ia:2') !== null, true, 'a chave do projeto leva o número dele');

    await automation.setLinks({ whatsapp_community: 'https://chat.whatsapp.com/cem' }, { projectId: P100 });
    assert.equal((await automation.links(P100)).whatsapp_community, 'https://chat.whatsapp.com/cem');
    assert.equal((await automation.links(PULSO)).whatsapp_community, '', 'o link do Pulso não mudou');
  });

  it('o nome e o contexto da IA vêm do projeto', async () => {
    assert.equal(projects.publicName(PULSO), 'Podcast Pulso');
    assert.match(projects.aiContext(PULSO), /podcast de saúde/);
    const prompt = replies.SYSTEM(`${projects.publicName(PULSO)} (${projects.aiContext(PULSO)})`);
    assert.match(prompt, /Podcast Pulso \(podcast de saúde/);
    assert.doesNotMatch(replies.SYSTEM('Projeto 100'), /Pulso/, 'o prompt do outro projeto não fala do Pulso');
  });

  it('as publicações e os comentários seguem o projeto escolhido', async () => {
    const epP = await one("INSERT INTO episodes (title, project_id, number, status) VALUES ('Ep do Pulso',$1,801,'publicado') RETURNING id", [PULSO]);
    const epC = await one("INSERT INTO episodes (title, project_id, number, status) VALUES ('Video do Cem',$1,801,'publicado') RETURNING id", [P100]);
    const clipP = await one("INSERT INTO episode_clips (episode_id, project_id, title, status) VALUES ($1,$2,'Corte do Pulso','pronto') RETURNING id", [epP.id, PULSO]);
    const clipC = await one("INSERT INTO episode_clips (episode_id, project_id, title, status) VALUES ($1,$2,'Corte do Cem','pronto') RETURNING id", [epC.id, P100]);
    const pubP = await one("INSERT INTO episode_publications (clip_id, episode_id, media, platforms, title, status, provider) VALUES ($1,$2,'video','{instagram}','Post do Pulso','publicado','uploadpost') RETURNING id", [clipP.id, epP.id]);
    const pubC = await one("INSERT INTO episode_publications (clip_id, episode_id, media, platforms, title, status, provider) VALUES ($1,$2,'video','{instagram}','Post do Cem','publicado','uploadpost') RETURNING id", [clipC.id, epC.id]);

    const todas = await require('../src/services/social').listPublications({ pids: [PULSO, P100] });
    assert.equal(todas.length, 2);
    const soCem = await require('../src/services/social').listPublications({ pids: [P100] });
    assert.deepEqual(soCem.map((p) => p.title), ['Post do Cem']);

    await h.db.query("INSERT INTO social_comments (publication_id, network, comment_id, author_username, text, status) VALUES ($1,'instagram','c1','alguem','Oi do Pulso','nova')", [pubP.id]);
    await h.db.query("INSERT INTO social_comments (publication_id, network, comment_id, author_username, text, status) VALUES ($1,'instagram','c2','outro','Oi do Cem','nova')", [pubC.id]);
    const { rows } = await replies.list('equipe', { pids: [P100] });
    assert.deepEqual(rows.map((r) => r.text), []);
    const nova = await replies.counts({ pids: [P100] });
    assert.equal(typeof nova.aprovar, 'number');
    const posts = await replies.postsWithComments({ pids: [P100] });
    assert.deepEqual(posts.map((p) => p.title), ['Corte do Cem']);
  });

  it('tela de módulo que o projeto não usa responde 404', async () => {
    // o Projeto 100 não usa redes: para quem é só dele, o Social não existe
    for (const url of ['/social/publicacoes', '/social/insights', '/social/comentarios']) {
      assert.equal((await cem.get(url)).status, 404, url);
    }
    // a casa, com "Todos os projetos", continua entrando (o Pulso usa redes)
    assert.equal((await casa.get('/social/publicacoes')).status, 200);
    // quem participa do Pulso continua entrando mesmo com o Projeto 100 escolhido (trocar de projeto já leva ao Início)
    await casa.act('/projeto', { project: String(P100), voltar: '/' });
    assert.equal((await casa.get('/social/publicacoes')).status, 200);
    await casa.act('/projeto', { project: '', voltar: '/' });
  });
});
