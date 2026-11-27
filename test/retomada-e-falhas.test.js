const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const social = require('../src/services/socialApi');
const publishing = require('../src/services/publishing');
const board = require('../src/services/contentBoard');

const fail = (platform, code, extra = {}) => ({ platform, ok: false, skipped: false, status: 'failed', url: null, error: `erro ${code}`, code, action: true, provider: 'outstand', ...extra });
const ok = (platform) => ({ platform, ok: true, skipped: false, status: 'completed', url: `https://x/${platform}`, provider: 'outstand' });

describe('Falhas de publicação: o resumo de cada conteúdo', () => {
  it('rede que saiu em outra publicação não conta; nova tentativa x precisa de ação; motivo e redes', () => {
    assert.equal(board.failOf([{ id: 1, status: 'erro', results: [fail('tiktok', 'provedor_chave')] }, { id: 2, status: 'publicado', results: [ok('tiktok')] }]), null, 'o TikTok saiu depois: resolvido');
    const f = board.failOf([{ id: 3, status: 'parcial', results: [ok('youtube'), fail('instagram', 'provedor_chave'), fail('tiktok', 'tiktok_limite_diario', { retry_at: '2030-01-01T10:00:00.000Z' })] }]);
    assert.deepEqual([f.state, f.reasons.sort(), f.platforms.sort(), f.labels.sort(), f.pubId], ['tentativa', ['limite', 'provedor'], ['instagram', 'tiktok'], ['Instagram', 'TikTok'], 3]);
    assert.equal(board.failOf([{ id: 4, status: 'erro', results: [fail('x', 'desconhecido')] }]).state, 'acao');
  });
});

describe('O provedor voltou: o que falhou por assinatura ou conta volta sozinho para a fila', () => {
  let app; const as = {}; let clip; let ep;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const realGet = social.get; const realRoutes = social.routeMap;
  let accounts = null; // null = o provedor ainda não responde
  const pubWith = async (status, results, extra = '') => (await q(
    `INSERT INTO episode_publications (episode_id, clip_id, media, platforms, title, status, results, provider${extra ? ', options' : ''}) VALUES ($1, $2, 'video', $3, 'Um corte', $4, $5, 'outstand'${extra ? ', $6' : ''}) RETURNING *`,
    [ep.id, clip.id, results.map((r) => r.platform), status, JSON.stringify(results), ...(extra ? [extra] : [])]))[0];

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (9, 'Conversa', 'publicado') RETURNING *");
    [clip] = await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type, width, height, duration_ms) VALUES ('Corte 1', 'upload', 'pronto', $1, 'pp/c1.mp4', 10, 'video/mp4', 1080, 1920, 30000) RETURNING *", [ep.id]);
    social.routeMap = async () => ({ instagram: 'outstand', tiktok: 'outstand', facebook: 'outstand', threads: 'outstand', youtube: 'zernio', x: 'zernio', linkedin: 'outstand' });
    social.get = (id) => ({ ...realGet(id), live: () => true, connected: async () => (accounts ? { ok: true, platforms: accounts } : { ok: false, platforms: {} }) });
  });
  after(async () => { social.get = realGet; social.routeMap = realRoutes; await app.close(); await h.db.close(); });

  it('enquanto o provedor não responde, nada volta; quando volta, cada post sai de 20 em 20 min e a gestão é avisada', async () => {
    const a = await pubWith('erro', [fail('instagram', 'provedor_chave'), fail('tiktok', 'sem_conta')]);
    const b = await pubWith('parcial', [ok('youtube'), fail('instagram', 'provedor_chave'), fail('x', 'desconhecido')]);
    const semConta = await pubWith('erro', [fail('threads', 'sem_conta')]); // a conta do Threads não existe no provedor
    const velho = await pubWith('erro', [fail('instagram', 'provedor_chave')]);
    await q("UPDATE episode_publications SET updated_at = now() - interval '4 days' WHERE id = $1", [velho.id]);
    const cansado = await pubWith('erro', [fail('instagram', 'provedor_chave')], JSON.stringify({ resumed: 2 }));

    assert.deepEqual(await publishing.resumeAfterOutage({ force: true }), [], 'provedor ainda fora');
    accounts = { instagram: { handle: 'pulso' }, tiktok: { handle: 'pulso' } };
    const back = await publishing.resumeAfterOutage({ force: true });
    assert.deepEqual(back.map((x) => x.id), [a.id, b.id]);
    assert.equal(Date.parse(back[1].at) - Date.parse(back[0].at) >= 20 * 60_000, true, 'de 20 em 20 minutos');
    const [na] = await q('SELECT * FROM episode_publications WHERE id = $1', [a.id]);
    assert.ok(na.retry_at); assert.equal(na.options.resumed, 1); assert.deepEqual(na.options.tries, { instagram: 0, tiktok: 0 });
    assert.ok(na.results.every((r) => r.retry_at && r.action === false && /O provedor voltou/.test(r.hint)));
    const [nb] = await q('SELECT results FROM episode_publications WHERE id = $1', [b.id]);
    assert.equal(nb.results.find((r) => r.platform === 'x').retry_at, undefined, 'falha de outro motivo fica como estava');
    assert.equal(nb.results.find((r) => r.platform === 'instagram').action, false);
    for (const p of [semConta, velho, cansado]) assert.equal((await q('SELECT retry_at FROM episode_publications WHERE id = $1', [p.id]))[0].retry_at, null, `#${p.id} não volta`);
    const notes = await q("SELECT title, body FROM notifications WHERE title LIKE 'O provedor voltou%'");
    assert.ok(notes.length >= 1); assert.match(notes[0].body, /2 posts que tinham falhado voltam sozinhos, de 20 em 20 minutos/);
    assert.deepEqual(await publishing.resumeAfterOutage({ force: true }), [], 'quem já voltou não volta de novo');
    const events = await q("SELECT message FROM episode_events WHERE episode_id = $1 AND message LIKE 'O provedor voltou%'", [ep.id]);
    assert.equal(events.length, 2);
  });

  it('Conteúdo: o cartão diz que falhou, o filtro "Falha ao publicar" acha, e "Reler com IA" põe vários cortes na fila', async () => {
    const [c2] = await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type, width, height, duration_ms, note) VALUES ('Corte 2', 'upload', 'pronto', $1, 'pp/c2.mp4', 10, 'video/mp4', 1080, 1920, 30000, 'As capas ainda não foram geradas: o limite de uso da IA (Gemini) foi atingido. Use \"Ler de novo\" mais tarde.') RETURNING *", [ep.id]);
    const [c3] = await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type, width, height, duration_ms) VALUES ('Corte 3', 'upload', 'enviando', $1, NULL, 10, 'video/mp4', 1080, 1920, 30000) RETURNING *", [ep.id]);
    const shown = async (qs) => [...(await as.editor.get(`/conteudo?vista=cortes&${qs}`)).text.matchAll(/data-clip="(\d+)"/g)].map((m) => Number(m[1]));
    assert.deepEqual(await shown('f=falha~em~tentativa'), [clip.id], 'corte 1 tem nova tentativa marcada');
    assert.deepEqual(await shown('f=falha_rede~em~tiktok'), [clip.id]);
    assert.deepEqual(await shown('f=falha_motivo~em~provedor'), [clip.id]);
    assert.deepEqual((await shown('f=falha~em~nenhuma')).sort(), [c2.id, c3.id].sort());
    assert.deepEqual((await shown('f=leitura~sim')).sort(), [clip.id, c2.id].sort(), 'leitura incompleta: sem capa, ou a IA falhou (o que ainda sobe fica de fora)');
    const page = (await as.editor.get('/conteudo?vista=cortes')).text;
    assert.match(page, /Nova tentativa em Instagram, Threads, TikTok, X/); assert.match(page, /A leitura da IA não terminou/); assert.match(page, /data-dl-do="reler"/);
    assert.match((await as.editor.get('/conteudo?vista=quadro')).text, /nova tentativa · Instagram · Threads · TikTok · X/);

    const res = await as.editor.act('/conteudo/em-massa/cortes', { acao: 'reler', ids: [String(clip.id), String(c2.id), String(c3.id)] }, { from: '/conteudo?vista=cortes' });
    assert.equal(res.status, 302);
    const st = await q('SELECT id, status FROM episode_clips WHERE id = ANY($1) ORDER BY id', [[clip.id, c2.id, c3.id]]);
    assert.deepEqual(st.map((x) => x.status), ['processando', 'processando', 'enviando'], 'o que ainda está subindo fica de fora');
    assert.equal((await q("SELECT count(*)::int n FROM jobs WHERE kind = 'corte' AND ref_id = ANY($1)", [[clip.id, c2.id]]))[0].n, 2);
    const flash = (await as.editor.get('/conteudo?vista=cortes')).text;
    assert.match(flash, /2 cortes na fila para a IA ler de novo\. Leva alguns minutos por corte\. 1 ficou de fora/);
  });
});
