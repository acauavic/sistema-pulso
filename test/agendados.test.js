// Conteúdo > Agendados: o que sai (ou saiu) no dia ou na semana, com o horário, o Reel de teste e o mapa de horários (0h a 24h);
// só o projeto da pessoa; e o voltar que lembra a lista com os filtros (a lista guarda, a página do item usa).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const agenda = require('../src/services/postAgenda');

describe('Conteúdo > Agendados', () => {
  const as = {}; let app; let day; let clipId;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);

  before(async () => {
    await h.resetDb();
    await h.createUser({ name: 'Casa', email: 'casa@local.test', role: 'gestao', projects: [1, 2] });
    await h.createUser({ name: 'Cem', email: 'cem@local.test', role: 'gestao', projects: [2] });
    app = await h.startServer();
    for (const k of ['casa', 'cem']) { as[k] = h.client(app.base); await as[k].login(`${k}@local.test`); }
    day = agenda.addDays(agenda.readQuery({}).today, 1); // amanhã, em Brasília
    const ep = await one("INSERT INTO episodes (title, project_id, number, status) VALUES ('Ep Agenda', 1, 7, 'publicado') RETURNING id");
    const ep2 = await one("INSERT INTO episodes (title, project_id, number, status) VALUES ('Ep do Cem', 2, 3, 'publicado') RETURNING id");
    const clip = await one("INSERT INTO episode_clips (title, post_title, source, status, episode_id, project_id, storage_key, size_bytes, content_type) VALUES ('Corte 9', 'Gancho das nove', 'upload', 'pronto', $1, 1, 'k/c9.mp4', 10, 'video/mp4') RETURNING id", [ep.id]);
    clipId = clip.id;
    const ins = (epId, cId, title, at, opts = {}) => q(
      `INSERT INTO episode_publications (episode_id, clip_id, platforms, title, status, media, scheduled_at, options) VALUES ($1, $2, $3, $4, $5, $6, ($7::timestamp AT TIME ZONE 'America/Sao_Paulo'), $8)`,
      [epId, cId, opts.platforms || '{instagram,tiktok}', title, opts.status || 'agendado', opts.media || 'video', `${day} ${at}`, JSON.stringify(opts.options || {})]);
    await ins(ep.id, clip.id, 'Reel das dezoito', '18:30');
    await ins(ep.id, clip.id, 'Reel de teste cedo', '09:00', { options: { instagram: { trial: true } } });
    await ins(ep.id, null, 'Post de imagem', '12:00', { media: 'imagem', platforms: '{instagram}' });
    await ins(ep.id, clip.id, 'Simulado fica fora', '10:00', { status: 'simulado' });
    await ins(ep2.id, null, 'Reel do Cem', '20:00');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('o dia: cada post com o horário, em ordem, o Reel de teste marcado e a régua com uma marca por horário', async () => {
    const r = await as.casa.get(`/conteudo?vista=agenda&dia=${day}`);
    assert.equal(r.status, 200);
    const html = r.text;
    assert.match(html, /Reel de teste cedo/);
    assert.doesNotMatch(html, /Simulado fica fora/, 'simulado não sai nas redes');
    assert.ok(html.indexOf('>09:00<') < html.indexOf('>12:00<') && html.indexOf('>12:00<') < html.indexOf('>18:30<'), 'em ordem de horário');
    assert.match(html, /badge b-trial[^>]*>Reel de teste/);
    assert.match(html, /4 POSTS · 1 REEL DE TESTE · DAS 09:00 ÀS 20:00/, 'em "Todos os projetos", o do Projeto 100 entra');
    assert.equal((html.match(/class="amap-mark/g) || []).length, 4);
    assert.match(html, /amap-mark trial/);
    assert.match(html, /<span>0h<\/span>[\s\S]*<span>24h<\/span>/, 'a régua vai de 0h a 24h');
  });

  it('tipo e projeto: Vídeos tira a imagem; quem é só do Projeto 100 vê só o dele', async () => {
    const vids = (await as.casa.get(`/conteudo?vista=agenda&dia=${day}&tipo=video`)).text;
    assert.doesNotMatch(vids, /Post de imagem/); assert.match(vids, /Reel das dezoito/);
    const imgs = (await as.casa.get(`/conteudo?vista=agenda&dia=${day}&tipo=imagem`)).text;
    assert.match(imgs, /Post de imagem/); assert.doesNotMatch(imgs, /Reel das dezoito/);
    const cem = (await as.cem.get(`/conteudo?vista=agenda&dia=${day}`)).text;
    assert.match(cem, /Reel do Cem/); assert.doesNotMatch(cem, /Reel das dezoito/);
  });

  it('a semana: uma régua por dia, de segunda a domingo; dia vazio diz que não há nada', async () => {
    const wk = (await as.casa.get(`/conteudo?vista=agenda&dia=${day}&periodo=semana`)).text;
    assert.equal((wk.match(/<svg class="amap-svg"/g) || []).length, 7);
    assert.match(wk, /Semana de \d{2}\/\d{2} a \d{2}\/\d{2}/);
    const empty = (await as.casa.get('/conteudo?vista=agenda&dia=2030-01-01')).text;
    assert.match(empty, /Nada agendado para este dia/);
    const q2 = agenda.readQuery({ dia: '2026-11-26', periodo: 'semana' }); // quinta
    assert.equal(q2.from, '2026-11-23'); assert.equal(q2.to, '2026-11-30');
    assert.equal(agenda.readQuery({ dia: '2026-02-31' }).day, agenda.readQuery({}).today, 'dia que não existe vira hoje');
  });

  it('voltar que lembra: as listas guardam o endereço e as páginas do item usam', async () => {
    assert.match((await as.casa.get('/conteudo?vista=cortes')).text, /data-list-memory="Conteúdo"/);
    assert.match((await as.casa.get('/social/publicacoes')).text, /data-list-memory="Publicações"/);
    const clip = (await as.casa.get(`/cortes/${clipId}`)).text;
    assert.match(clip, /data-back-memory/); assert.doesNotMatch(clip, /data-list-memory/);
  });
});
