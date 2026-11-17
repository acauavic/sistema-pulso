const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const tpl = require('../src/services/inviteTemplate');
const showcase = require('../src/services/inviteShowcase');

describe('Convite v2: formato, "Por que você", episódios reais e cortes de quem já veio', () => {
  let app; let gestao; let guest; const realFetch = global.fetch; const geminiBodies = [];
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const vitrine = (html) => JSON.parse(html.match(/<script type="application\/json" id="pulso-vitrine">([^<]*)<\/script>/)[1]);

  before(async () => {
    await h.resetDb(); app = await h.startServer(); showcase.reset();
    await h.createUser({ name: 'Gestão', email: 'gestao@t.com', role: 'gestao' });
    gestao = h.client(app.base); await gestao.login('gestao@t.com');
    // dois episódios publicados (número 3 = cartão da Tamiris) e um corte que já saiu nas redes
    const [g3] = await q("INSERT INTO guests (name, profile, status) VALUES ('Tamiris', 'medico', 'gravado') RETURNING id");
    const [ep] = await q("INSERT INTO episodes (number, title, status, guest_id) VALUES (3, 'Telas', 'publicado', $1) RETURNING id", [g3.id]);
    await q("INSERT INTO episodes (number, title, status) VALUES (4, 'Outro', 'publicado'), (5, 'Em edição', 'em_edicao')");
    h.b2Store.set('cortes/1/v.mp4', { body: Buffer.alloc(10), contentType: 'video/mp4' });
    const [c] = await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key) VALUES ('Corte 5', 'upload', 'pronto', $1, 'cortes/1/v.mp4') RETURNING id", [ep.id]);
    await q("INSERT INTO episode_publications (episode_id, clip_id, platforms, title, status, results) VALUES ($1, $2, '{instagram}', 'Toda vez que a tela ocupa um espaço', 'publicado', '[]')", [ep.id, c.id]);
    [guest] = await q("INSERT INTO guests (name, profile, status, bio, topic, proposed_at, invite_token) VALUES ('Lia Prado', 'medico', 'prospect', 'Nutróloga que fala de obesidade sem culpa.', 'Obesidade e rotina', '2026-12-03T17:00:00Z', 'tok-lia') RETURNING *");
  });
  after(async () => { global.fetch = realFetch; await app.close(); await h.db.close(); });

  it('textos do convite: período pela hora marcada, número real de episódios e formato', () => {
    const sc = { episodes: 21, guests: {}, highlights: [], plateia: null };
    const mesa = tpl.buildVariables({ name: 'A', proposed_at: '2026-12-03T17:00:00Z' }, { showcase: sc }); // 14h em Brasília
    assert.equal(mesa.periodo_card, 'Uma tarde de conversa.'); assert.equal(mesa.periodo_titulo, 'Uma tarde.');
    assert.equal(mesa.episodios, '21'); assert.equal(mesa.formato_selo, 'Convite exclusivo'); assert.equal(mesa.plateia_html, '');
    assert.equal(tpl.buildVariables({ name: 'A', proposed_at: '2026-12-03T12:00:00Z' }).periodo_titulo, 'Uma manhã.'); // 9h
    assert.equal(tpl.buildVariables({ name: 'A', proposed_at: '2026-12-03T23:00:00Z' }).periodo_titulo, 'Uma noite.'); // 20h
    const sem = tpl.buildVariables({ name: 'A' });
    assert.equal(sem.periodo_card, 'Uma conversa sem pressa.'); assert.equal(sem.periodo_titulo, 'Poucas horas.');
    const pl = tpl.buildVariables({ name: 'A', invite_format: 'plateia', invite_why: 'Sua forma de\nfalar <de> saúde.' }, { showcase: { ...sc, plateia: { sources: [{ src: 'https://v/p.mp4' }] } } });
    assert.match(pl.plateia_html, /plateia-gallery/); assert.match(pl.plateia_html, /data-plateia-video/);
    assert.equal(pl.formato_selo, 'Convite · com plateia'); assert.equal(pl.gravacao_titulo, 'Gravação com plateia');
    assert.equal(pl.convite_desc, 'Sua forma de falar <de> saúde.', 'o texto vira uma linha (e é escapado na renderização)');
    assert.equal(JSON.parse(pl.guest_json).motivo, true);
    assert.deepEqual(JSON.parse(pl.vitrine_json).plateia, { sources: [{ src: 'https://v/p.mp4' }] });
    assert.equal(JSON.parse(mesa.vitrine_json).plateia, null, 'convite de mesa não leva o vídeo da plateia');
  });

  it('a prévia mostra os episódios publicados, os cortes da Tamiris e os destaques; sem "14 episódios" nem "manhã" fixos', async () => {
    showcase.reset();
    const html = (await gestao.get(`/convidados/${guest.id}/previa`)).text;
    assert.doesNotMatch(html, /14 episódios|até set\/2026|Uma manhã de conversa/);
    assert.match(html, /Uma tarde de conversa\. Produção completa incluída/);
    const v = vitrine(html);
    assert.ok(v.mesa.some((g) => g.name === 'Dra. Tamiris Mariano' && g.ep === 3), 'sem galeria escolhida: a de lançamento');
    assert.equal(v.cortes['3'].length, 1); assert.equal(v.cortes['3'][0].title, 'Toda vez que a tela ocupa um espaço');
    assert.match(v.cortes['3'][0].src, /^https:\/\//, 'link assinado do armazenamento');
    assert.equal(v.cortes['11'], undefined, 'sem cortes: o destaque não mostra "Ver cortes"');
    assert.match(html, /id="mesaGrid"/); assert.match(html, /2 episódios no ar/);
    assert.match(html, /class="clips-head"/); assert.match(html, /04 · OS CORTES/);
    assert.doesNotMatch(html, /class="clip-card"/, 'corte sem capa não entra nos destaques');
    assert.match(html, /Saúde e inovação/); assert.match(html, /Histórias inspiradoras/);
    assert.match(html, /Escolhemos você pela trajetória/, 'sem "Por que você": frase padrão');
    assert.doesNotMatch(html, /class="plateia-gallery"/);
  });

  it('galeria do media kit vira a mesa do convite; cortes de exemplo escolhidos (com capa) na gestão', async () => {
    const [ep3] = await q('SELECT id FROM episodes WHERE number = 3');
    await gestao.act(`/gestao/galeria-kit/${ep3.id}/mostrar`, { mostrar: '1' }, { from: '/gestao/galeria-kit' });
    // um corte com capa para poder ser escolhido
    const [clip] = await q("SELECT id, episode_id FROM episode_clips WHERE title = 'Corte 5'");
    h.b2Store.set('capas/c5.jpg', { body: Buffer.alloc(10), contentType: 'image/jpeg' });
    const [cv] = await q("INSERT INTO episode_covers (episode_id, clip_id, kind, spec, storage_key, mime, width, height, size_bytes, auto, approved) VALUES ($1, $2, 'reel_cover', '{}', 'capas/c5.jpg', 'image/jpeg', 1080, 1920, 10, false, true) RETURNING id", [clip.episode_id, clip.id]);
    await q('UPDATE episode_clips SET cover_id = $2 WHERE id = $1', [clip.id, cv.id]);
    const page = (await gestao.get('/gestao/galeria-kit')).text;
    assert.match(page, /Cortes de exemplo no convite/); assert.match(page, new RegExp(`name="cortes" value="${clip.id}"`));
    const r = await gestao.act('/gestao/galeria-kit/cortes', { cortes: [String(clip.id), '999999'] }, { from: '/gestao/galeria-kit' });
    assert.equal(r.status, 302);
    assert.ok((await q('SELECT invite_pick_at FROM episode_clips WHERE id = $1', [clip.id]))[0].invite_pick_at);
    const html = (await gestao.get(`/convidados/${guest.id}/previa`)).text;
    const v = vitrine(html);
    assert.deepEqual(v.mesa.map((g) => g.name), ['Tamiris'], 'a mesa é a galeria escolhida');
    assert.equal((html.match(/class="clip-card"/g) || []).length, 1); assert.match(html, /poster="https:/);
    await gestao.act('/gestao/galeria-kit/cortes', {}, { from: '/gestao/galeria-kit' });
    assert.equal((await q('SELECT invite_pick_at FROM episode_clips WHERE id = $1', [clip.id]))[0].invite_pick_at, null);
  });

  it('"Como o convite chega": salva formato e texto, registra no histórico e o convite muda', async () => {
    const page = (await gestao.get(`/convidados/${guest.id}`)).text;
    assert.match(page, /Como o convite chega/); assert.match(page, /data-ai="convite_motivo" data-ai-guest="\d+"/);
    const r = await gestao.act(`/convidados/${guest.id}/convite/ajustes`, { invite_format: 'plateia', invite_why: 'Seu jeito de falar de obesidade sem culpa conversa com quem atende e com quem quer se cuidar.' }, { from: `/convidados/${guest.id}` });
    assert.equal(r.status, 302);
    const [g] = await q('SELECT invite_format, invite_why FROM guests WHERE id = $1', [guest.id]);
    assert.equal(g.invite_format, 'plateia'); assert.match(g.invite_why, /sem culpa/);
    assert.equal((await q("SELECT count(*)::int n FROM guest_events WHERE guest_id = $1 AND type = 'convite_ajustado'", [guest.id]))[0].n, 1);
    const html = (await gestao.get(`/convidados/${guest.id}/previa`)).text;
    assert.match(html, /Seu jeito de falar de obesidade sem culpa/); assert.match(html, /class="plateia-gallery"/); assert.match(html, /Convite · com plateia/);
    assert.match(html, /\/static\/convite\/plateia-1\.jpg/);
    assert.doesNotMatch(html, /hero-format/, 'sem a faixa "Podcast com plateia" no topo'); assert.match(html, /class="intro-format">Podcast com plateia/);
    assert.equal(JSON.parse(html.match(/const G = (\{.*\});/)[1]).plateia, true);
    await gestao.act(`/convidados/${guest.id}/convite/ajustes`, { invite_format: 'qualquer', invite_why: '   ' }, { from: `/convidados/${guest.id}` });
    assert.deepEqual((await q('SELECT invite_format, invite_why FROM guests WHERE id = $1', [guest.id]))[0], { invite_format: 'mesa', invite_why: null });
  });

  it('IA escreve o "Por que você" com os dados do convidado (sem contato)', async () => {
    h.config.gemini.key = 'test-gemini'; h.config.geminiConfigured = true;
    global.fetch = async (url, opts = {}) => {
      if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
        geminiBodies.push(JSON.parse(opts.body));
        return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ opcoes: ['Você fala de obesidade sem culpa.', 'Sua rotina inspira quem atende.', 'Queremos ouvir sua visão.'] }) }] } }] });
      }
      return realFetch(url, opts);
    };
    const csrf = await gestao.csrf(`/convidados/${guest.id}`);
    const res = await realFetch(`${app.base}/ia/texto`, { method: 'POST', headers: { cookie: gestao.cookie(), accept: 'application/json', 'x-csrf-token': csrf, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ campo: 'convite_motivo', atalho: 'variar', convidado: String(guest.id), atual: '' }) });
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out)); assert.equal(out.opcoes.length, 3);
    const prompt = geminiBodies.at(-1).contents[0].parts[0].text;
    assert.match(prompt, /Nutróloga que fala de obesidade sem culpa/); assert.match(prompt, /Missão do Pulso/);
    assert.doesNotMatch(prompt, /@t\.com/);
  });
});
