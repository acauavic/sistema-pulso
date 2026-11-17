const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const SC = require('../src/services/socialCopy');
const clips = require('../src/services/clips');
const publishing = require('../src/services/publishing');

describe('Copy das redes: capa, título e legenda com critério e a chamada certa em cada rede', () => {
  const as = {}; let app; let clip; const realFetch = global.fetch; const asked = [];
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    await h.createUser({ name: 'Gestão', email: 'gestao@t.com', role: 'gestao' });
    as.gestao = h.client(app.base); await as.gestao.login('gestao@t.com');
    const [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (31, 'Carreira médica', 'publicado') RETURNING *");
    h.b2Store.set('pp/corte-cta.mp4', { body: Buffer.alloc(3000, 7), contentType: 'video/mp4' });
    [clip] = await q("INSERT INTO episode_clips (title, source, status, episode_id, storage_key, size_bytes, content_type, width, height, duration_ms, caption, ctas) VALUES ('Corte CTA', 'upload', 'pronto', $1, 'pp/corte-cta.mp4', 3000, 'video/mp4', 1080, 1920, 34000, 'Currículo não traz paciente.', $2) RETURNING *",
      [ep.id, JSON.stringify({ instagram: 'Siga o Pulso para mais conversas sobre carreira médica sem romantização.', youtube: 'Inscreva-se no canal para ver a conversa completa sobre carreira.' })]);
  });
  after(async () => { global.fetch = realFetch; await app.close(); await h.db.close(); });

  it('chamadas: a do corte quando há, senão a padrão da rede (seguir no Instagram, inscrever-se no YouTube)', () => {
    const c = SC.forClip(clip, ['instagram', 'youtube', 'tiktok', 'linkedin']);
    assert.match(c.instagram, /carreira médica/); assert.match(c.youtube, /^Inscreva-se/);
    assert.match(c.tiktok, /^Segue o Pulso/); assert.match(c.linkedin, /^Siga o Pulso/);
    for (const n of SC.NETWORKS) assert.ok(SC.DEFAULT_CTAS[n].length >= 3, `${n} tem variações`);
    assert.match(SC.forClip(null, ['youtube']).youtube, /Inscreva-se/);
    assert.equal(SC.compose('Legenda.', 'Siga o Pulso.'), 'Legenda.\n\nSiga o Pulso.');
    assert.equal(SC.compose('Legenda.\n\nSiga o Pulso.', 'Siga o Pulso.'), 'Legenda.\n\nSiga o Pulso.', 'não repete');
    assert.equal(SC.readForm({ cta_instagram: 'x' }, ['instagram']), null, 'sem cta_on: sem chamada');
    assert.deepEqual(SC.readForm({ cta_on: '1', cta_instagram: ' Siga o Pulso!!! ', cta_youtube: '' }, ['instagram', 'youtube']), { instagram: 'Siga o Pulso!' });
    assert.deepEqual(SC.bannedIn('Confira esse momento de reflexão. Assista ao trecho.'), ['momento de reflexão', 'assista ao trecho', 'confira esse']);
  });

  it('o pedido à IA traz o critério de copy e a regra de cada rede, e a legenda não pede para seguir', () => {
    const p = clips.textsPrompt({ transcript: 'fala de teste '.repeat(5) });
    assert.match(p, /parar de rolar/); assert.match(p, /tensão ou contradição/); assert.match(p, /Proibido: rótulo de tema/);
    assert.match(p, /YouTube: peça para SE INSCREVER/); assert.match(p, /Instagram: peça para SEGUIR o perfil/);
    assert.match(p, /NÃO peça para seguir, se inscrever nem curtir/); assert.match(p, /"momento de reflexão"/);
    assert.match(require('../src/services/aiText').FIELDS.descricao.rule, /pergunta específica/);
  });

  it('legenda genérica volta para a IA uma vez; a chamada de cada rede fica no corte', async () => {
    h.config.gemini.key = 'test-gemini'; h.config.geminiConfigured = true;
    const answers = [
      { titulo: 'Reflexão sobre carreira', legenda: 'Confira esse momento de reflexão com o convidado.', textos_capa: ['Carreira', 'Momento de reflexão', 'Dicas'], chamadas: {} },
      { titulo: 'Currículo não traz paciente', legenda: 'Ninguém escolhe médico pelo diploma na parede. O que você faz para ser lembrado?', textos_capa: ['Currículo não traz paciente', 'Diploma não enche agenda', 'Quem lembra de você?'],
        chamadas: { instagram: 'Siga o Pulso para mais conversas sobre carreira médica.', youtube: 'Inscreva-se no canal e veja a conversa completa.', tiktok: 'Segue o Pulso pra ver mais.' } },
    ];
    global.fetch = async (url, opts = {}) => {
      if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
        asked.push(JSON.parse(opts.body).contents[0].parts[0].text);
        return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(answers[Math.min(asked.length - 1, 1)]) }] } }] });
      }
      return realFetch(url, opts);
    };
    const t = await clips.writeTexts({ transcript: 'Ninguém escolhe médico pelo diploma na parede. '.repeat(3) });
    assert.equal(asked.length, 2); assert.match(asked[1], /frases genéricas proibidas \(momento de reflexão, confira esse\)/);
    assert.equal(t.post_title, 'Currículo não traz paciente');
    assert.match(t.caption, /O que você faz para ser lembrado\?$/);
    assert.equal(t.ctas.youtube, 'Inscreva-se no canal e veja a conversa completa.'); assert.equal(t.ctas.facebook, undefined);
  });

  it('publicar: cada rede recebe a sua chamada no fim da legenda e a publicação mostra qual foi', async () => {
    const page = (await as.gestao.get(`/cortes/${clip.id}`)).text;
    assert.match(page, /Chamada no fim da legenda, por rede/);
    assert.match(page, /name="cta_instagram" value="Siga o Pulso para mais conversas sobre carreira médica sem romantização\."/);
    assert.match(page, /name="cta_youtube" value="Inscreva-se no canal para ver a conversa completa sobre carreira\."/);
    const r = await as.gestao.act(`/cortes/${clip.id}/publicar`, { title: 'Currículo não traz paciente', description: 'Ninguém escolhe médico pelo diploma.', platforms: ['instagram', 'youtube'], cta_on: '1',
      cta_instagram: 'Siga o Pulso para mais conversas sobre carreira.', cta_youtube: 'Inscreva-se no canal do Pulso.', cta_tiktok: 'Segue o Pulso.', confirmar: '1' }, { from: `/cortes/${clip.id}` });
    assert.equal(r.status, 302, r.text);
    const [pub] = await q('SELECT * FROM episode_publications WHERE clip_id = $1 ORDER BY id DESC LIMIT 1', [clip.id]);
    assert.deepEqual(pub.options.ctas, { instagram: 'Siga o Pulso para mais conversas sobre carreira.', youtube: 'Inscreva-se no canal do Pulso.' }, 'só as redes marcadas');
    assert.equal(pub.description, 'Ninguém escolhe médico pelo diploma.', 'a legenda fica sem a chamada');
    assert.equal(publishing.textOf(pub, 'instagram').description, 'Ninguém escolhe médico pelo diploma.\n\nSiga o Pulso para mais conversas sobre carreira.');
    assert.equal(publishing.textOf(pub, 'youtube').description, 'Ninguém escolhe médico pelo diploma.\n\nInscreva-se no canal do Pulso.');
    assert.equal(publishing.textOf({ ...pub, options: { ...pub.options, texts: { youtube: { title: 'T', description: 'Texto próprio' } } } }, 'youtube').description, 'Texto próprio', 'texto próprio do reenvio vence');
    await q("UPDATE episode_publications SET status = 'publicado', results = $2 WHERE id = $1", [pub.id, JSON.stringify([{ platform: 'instagram', ok: true }, { platform: 'youtube', ok: true }])]);
    assert.match((await as.gestao.get(`/social/publicacoes/${pub.id}`)).text, /Chamada no fim: Inscreva-se no canal do Pulso\./);
    // sem a caixa marcada: nenhuma chamada
    await as.gestao.act(`/cortes/${clip.id}/publicar`, { title: 'Outro título', description: 'Sem chamada.', platforms: ['instagram'], cta_instagram: 'Siga.', confirmar: '1' }, { from: `/cortes/${clip.id}` });
    const [p2] = await q('SELECT options FROM episode_publications WHERE clip_id = $1 ORDER BY id DESC LIMIT 1', [clip.id]);
    assert.equal(p2.options.ctas, undefined);
  });

  it('novo post: as chamadas padrão vêm no formulário e as do corte escolhido entram pelo próprio item', async () => {
    const page = (await as.gestao.get('/social/novo?tipo=video&publicados=1')).text;
    assert.match(page, /name="cta_youtube" value="Inscreva-se/);
    assert.match(page, /data-ctas="[^"]*&#34;instagram&#34;:&#34;Siga o Pulso para mais conversas sobre carreira médica sem romantização\.&#34;/);
  });
});
