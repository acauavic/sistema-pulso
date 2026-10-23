const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const socialApi = require('../src/services/socialApi');
const publishing = require('../src/services/publishing');

describe('Integrações: ligar e desligar a publicação de verdade pelo painel', () => {
  const as = {}; const u = {}; let app; let ep; let cover;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const mode = (who, form) => as[who].act('/integracoes/redes/modo', form, { from: '/integracoes' });

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['admin', 'superadmin'], ['prod', 'produtora']]) { u[k] = await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (30, 'Ep modo', 'publicado') RETURNING *");
    [cover] = await q("INSERT INTO episode_covers (episode_id, kind, position, spec, storage_key, mime, width, height, size_bytes) VALUES ($1, 'post_quote', 0, '{}', 'pp/capas/m.jpg', 'image/jpeg', 1080, 1350, 1000) RETURNING *", [ep.id]);
    h.uploadPostState.accounts = { instagram: { handle: 'pulso', display_name: 'Pulso' } };
  });
  after(async () => { h.config.uploadPost.live = false; await app.close(); await h.db.close(); });

  it('sem mexer no painel vale a variável do servidor; a tela mostra de onde vem', async () => {
    assert.equal(h.config.uploadPost.live, false);
    assert.equal(await socialApi.liveSource('uploadpost'), 'ambiente');
    const page = (await as.admin.get('/integracoes')).text;
    assert.match(page, /modo de teste/); assert.match(page, /padrão do servidor \(UPLOAD_POST_LIVE\)/);
    assert.match(page, /Ligar a publicação de verdade/);
  });

  it('ligar pede a confirmação; com ela, vale na hora e fica na auditoria', async () => {
    await mode('admin', { provedor: 'uploadpost', ligar: '1' });
    assert.equal(h.config.uploadPost.live, false, 'sem marcar "Entendi" não liga');
    await mode('admin', { provedor: 'uploadpost', ligar: '1', confirmar: '1' });
    assert.equal(h.config.uploadPost.live, true);
    assert.equal(await socialApi.liveSource('uploadpost'), 'painel');
    const page = (await as.admin.get('/integracoes')).text;
    assert.match(page, /publica de verdade/); assert.match(page, /definido aqui/); assert.match(page, /Voltar ao modo de teste/);
    const audit = await q("SELECT action FROM audit_log WHERE action LIKE 'integracao.redes_%'");
    assert.ok(audit.some((a) => a.action === 'integracao.redes_publicar_de_verdade'));
  });

  it('com a publicação de verdade ligada pelo painel, o envio sai para a rede (não é mais simulado)', async () => {
    h.uploadPostCalls.length = 0;
    const pub = await publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram'], title: 'Post', description: 'Legenda', userId: u.admin.id });
    assert.notEqual(pub.status, 'simulado');
    assert.ok(h.uploadPostCalls.some((c) => /upload_photos/.test(String(c.url || ''))), 'chamou o Upload-Post de verdade (simulado no teste)');
  });

  it('voltar ao modo de teste vale na hora; outro processo (o worker) lê a escolha do banco', async () => {
    await mode('admin', { provedor: 'uploadpost', ligar: '0' });
    assert.equal(h.config.uploadPost.live, false);
    const sim = await publishing.create({ media: 'imagem', coverIds: [cover.id], platforms: ['instagram'], title: 'Post 2', description: 'L', userId: u.admin.id });
    assert.equal(sim.status, 'simulado');
    // a escolha gravada por outro processo chega aqui na próxima releitura
    await q("UPDATE app_settings SET value = 'true' WHERE key = 'social_live_uploadpost'");
    await socialApi.syncLive({ force: true });
    assert.equal(h.config.uploadPost.live, true);
    await mode('admin', { provedor: 'uploadpost', ligar: '0' });
  });

  it('só quem cuida das integrações muda; provedor sem chave não liga', async () => {
    assert.equal((await mode('prod', { provedor: 'uploadpost', ligar: '1', confirmar: '1' })).status, 403);
    assert.equal(h.config.uploadPost.live, false);
    await mode('admin', { provedor: 'zernio', ligar: '1', confirmar: '1' });
    assert.equal(h.config.zernio.live, false, 'Zernio sem ZERNIO_API_KEY não liga');
    await assert.rejects(socialApi.setLive('outro', true), /desconhecido/);
  });

  it('as telas de publicar mandam para Integrações (e não para a variável do servidor)', async () => {
    assert.match(socialApi.sentMessage({ provider: 'uploadpost', status: 'simulado' }), /ligada em Integrações > Redes sociais/);
  });
});
