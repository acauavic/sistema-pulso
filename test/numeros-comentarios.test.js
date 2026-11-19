const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const S = require('../src/services/commentStats');
const R = require('../src/services/commentReplies');
const settings = require('../src/services/settings');

describe('Comentários > Números e a faixa do Resumo do dia', () => {
  const as = {}; let app; let pub; let pub2;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const prevFetch = global.fetch;
  let clicks = 37;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    const [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (19, 'Mari Vabo', 'publicado') RETURNING id");
    [pub] = await q(`INSERT INTO episode_publications (episode_id, platforms, title, status, results) VALUES ($1, '{instagram}', 'A segurança que o homem maduro busca', 'publicado',
      '[{"platform":"instagram","provider":"outstand","ref":"op1","post_id":"1789","ok":true}]') RETURNING *`, [ep.id]);
    [pub2] = await q(`INSERT INTO episode_publications (episode_id, platforms, title, status, results) VALUES ($1, '{instagram}', 'O peso do relacionamento', 'publicado',
      '[{"platform":"instagram","provider":"outstand","ref":"op2","post_id":"1790","ok":true}]') RETURNING *`, [ep.id]);
    await q("INSERT INTO post_metrics (publication_id, platform, comments, views) VALUES ($1, 'instagram', 61, 77463)", [pub.id]);
    // hoje: 4 comentários no post 1 (2 respondidos em texto, um com convite; 1 reação; 1 com erro) e 1 no post 2 (espera a equipe)
    const ins = (p, cid, who, status, extra = {}) => q(`INSERT INTO social_comments (network, post_ref, platform_post_id, publication_id, comment_id, parent_comment_id, author_username, text, commented_at,
        status, action, invited, sent_at, dm_status, dm_sent_at, dm_error, error, reason, updated_at)
      VALUES ('instagram', $1, '1789', $2, $3, $4, $5, 'texto', now() - interval '5 minutes', $6, $7, $8, $9, $10, $11, $12, $13, $14, now()) RETURNING id`,
      [p.id === pub.id ? 'op1' : 'op2', p.id, cid, extra.parent || null, who, status, extra.action || null, Boolean(extra.invited), extra.sent ? new Date(Date.now() - 4 * 60_000) : null,
        extra.dm || null, extra.dm === 'enviada' ? new Date(Date.now() - 3 * 60_000) : null, extra.dmError || null, extra.error || null, extra.reason || null]);
    await ins(pub, 'c1', 'ana', 'enviada', { action: 'responder', sent: true, invited: true, dm: 'enviada' });
    await ins(pub, 'c2', 'bia', 'enviada', { action: 'responder', sent: true, dm: 'erro', dmError: 'O Instagram não deu acesso às mensagens: reconecte o Instagram em Integrações (com acesso às mensagens).' });
    await ins(pub, 'c3', 'caio', 'enviada', { action: 'reagir', sent: true });
    await ins(pub, 'c4', 'duda', 'erro', { action: 'responder', error: 'Outstand recusou (400).' });
    await ins(pub2, 'c5', 'eva', 'equipe', { action: 'equipe', reason: 'A resposta da IA veio com código no texto e não saiu. Escreva a resposta.' });
    // a ana comentou de novo depois da resposta do Pulso
    await q(`INSERT INTO social_comments (network, post_ref, platform_post_id, publication_id, comment_id, parent_comment_id, author_username, text, commented_at, status)
      VALUES ('instagram', 'op1', '1789', $1, 'c1b', 'c1', 'ana', 'verdade!', now(), 'nova')`, [pub.id]);
    await R.setConfig({ on: '1' }, { onlyToggle: true });
    global.fetch = async (url, opts = {}) => {
      if (String(url).startsWith('https://yourls.test/')) {
        const p = new URLSearchParams(String(opts.body));
        if (p.get('action') === 'url-stats') return Response.json({ statusCode: '200', link: { clicks: String(clicks) } });
        if (p.get('action') === 'expand') return Response.json({ statusCode: 200, longurl: 'https://chat.whatsapp.com/ABC?mode=gi_t' });
      }
      return prevFetch(url, opts);
    };
  });
  after(async () => { global.fetch = prevFetch; await app.close(); await h.db.close(); });

  it('conta o dia: recebidos, respondidos (texto e reação), convite, directs, quem voltou e os erros', async () => {
    const k = await S.forDay(today());
    assert.equal(k.received, 6); assert.equal(k.replied, 3); assert.equal(k.text, 2); assert.equal(k.reactions, 1);
    assert.equal(k.invited, 1); assert.equal(k.dms, 1);
    assert.deepEqual(k.back, { replied: 2, back: 1, rate: 50 });
    assert.equal(k.top[0].id, pub.id); assert.equal(k.top[0].n, 5); assert.equal(k.top[0].network_total, 61); assert.equal(k.top[0].dms, 1);
    assert.equal(k.health.team, 1); assert.equal(k.health.blocked, 1);
    assert.equal(k.health.replyErrors[0].n, 1); assert.match(k.health.dmErrors[0].reason, /acesso às mensagens/);
    assert.equal(k.slots.length, 48); assert.equal(k.slots.reduce((s, x) => s + x.in, 0), 6); assert.equal(k.slots.reduce((s, x) => s + x.out, 0), 3);
    assert.ok(k.health.alerts.some((a) => /direct não saiu/.test(a.text)), JSON.stringify(k.health.alerts));
  });

  it('a página Números mostra o caminho, os posts, a saúde e as barras de 30 em 30 minutos; a fila ganhou as abas', async () => {
    const page = (await as.prod.get('/social/comentarios/numeros')).text;
    for (const t of ['Do comentário à comunidade', 'Comentários recebidos', 'Com convite para seguir', 'Directs enviados', 'Cliques no link', 'Voltaram a comentar',
      'Posts que mais conversaram', 'A segurança que o homem maduro busca', '61 na rede', 'Saúde da automação', 'Respostas com erro', 'Outstand recusou (400).',
      'Directs que não saíram', 'Barradas por código', 'Automação por palavra', 'De 30 em 30 minutos', 'HOJE, ATÉ AGORA']) assert.ok(page.includes(t), t);
    assert.match(page, /<rect class="cmt-bar-in"/); assert.doesNotMatch(page, /style="/);
    assert.match(page, /action="\/social\/comentarios\/numeros"/, 'a navegação do dia fica nesta página');
    const old = (await as.prod.get('/social/comentarios/numeros?dia=2020-01-01')).text;
    assert.match(old, /HOJE, ATÉ AGORA/, 'antes do primeiro comentário guardado, abre no primeiro dia que existe (hoje)');
    const queue = (await as.prod.get('/social/comentarios')).text;
    assert.match(queue, /href="\/social\/comentarios\/numeros"/);
    assert.equal((await as.editor.get('/social/comentarios/numeros')).status, 403);
  });

  it('o Resumo do dia e o Seu dia ganham a faixa "Comentários nas redes"', async () => {
    const team = (await as.gestao.get('/')).text;
    assert.match(team, /Comentários nas redes/); assert.match(team, /\/social\/comentarios\/numeros\?dia=/);
    assert.match(team, /Voltaram a comentar/);
    const mine = (await as.prod.get('/')).text;
    assert.match(mine, /Comentários nas redes/);
    const editor = (await as.editor.get('/')).text;
    assert.doesNotMatch(editor, /Comentários nas redes/);
  });

  it('o direct leva um link curto só dele e os cliques entram por dia', async () => {
    await require('../src/services/commentAutomation').setLinks({ whatsapp_community: 'https://yourls.test/omunidade' });
    h.yourlsCalls.length = 0;
    const link = await R.communityLink();
    assert.equal(link, 'https://yourls.test/comunidade-direct');
    const made = h.yourlsCalls.find((c) => c.action === 'shorturl');
    assert.equal(made.url, 'https://chat.whatsapp.com/ABC?mode=gi_t&origem=direct-pulso', 'o destino do link da bio, com uma marca para virar outro link');
    const y = today();
    const yesterday = new Date(Date.now() - 86400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    await settings.set(S.CLICKS_KEY, JSON.stringify({ [yesterday]: 30 }));
    assert.deepEqual(await S.snapshotClicks(), { total: 37 });
    assert.deepEqual(await S.clicksOn(y), { day: 7, total: 37 });
    clicks = 41; await S.snapshotClicks({ today: y });
    assert.deepEqual(await S.clicksOn(y), { day: 11, total: 41 });
  });

  it('a hora real do comentário entra na leitura seguinte (o que chegou sem hora)', async () => {
    await q("UPDATE social_comments SET commented_at = NULL WHERE comment_id = 'c4'");
    const when = '2026-11-18T12:00:00.000Z';
    await R.ingest({ network: 'instagram', post_ref: 'op1', platform_post_id: '1789', publication_id: pub.id },
      [{ id: 'c4', username: 'duda', text: 'texto', timestamp: when, replies: [] }], 'podcastpulso');
    const [r] = await q("SELECT commented_at FROM social_comments WHERE comment_id = 'c4'");
    assert.equal(r.commented_at.toISOString(), when);
  });
});
