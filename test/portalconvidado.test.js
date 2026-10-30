const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Portal do convidado', () => {
  const as = {}; let app; let anon; let g; let ep; let token; let base;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const act = (who, path, form) => as[who].act(path, form, { from: `/convidados/${g}` });
  const collabPart = (html) => html.split('id="collab"')[1].split('id="exclusivos"')[0];
  const live = (platform, url) => ({ platform, ok: true, url });
  const pub = async ({ clip = null, title, results, collab = [], media = 'video', episode = ep }) => (await one(
    `INSERT INTO episode_publications (episode_id, clip_id, platforms, title, status, media, results, options) VALUES ($1, $2, $3, $4, 'publicado', $5, $6, $7) RETURNING id`,
    [episode, clip, results.map((r) => r.platform), title, media, JSON.stringify(results), JSON.stringify(collab.length ? { instagram: { collaborators: collab, tags: [] } } : {})])).id;
  const clip = async (title, extra = {}) => (await one(
    "INSERT INTO episode_clips (episode_id, title, post_title, caption, status, storage_key, source, for_guest) VALUES ($1, $2, $3, $4, 'pronto', $5, 'upload', $6) RETURNING id",
    [ep, title, extra.postTitle || null, extra.caption || null, `pp/cortes/${title}.mp4`, extra.forGuest ?? true])).id;

  before(async () => {
    await h.resetDb(); app = await h.startServer(); anon = h.client(app.base);
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@pc.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@pc.com`); }
    g = (await one("INSERT INTO guests (name, status, instagram, email, phone) VALUES ('Mari Vabo', 'gravado', '@MariVabo', 'mari@ex.com', '(11) 98888-7777') RETURNING id")).id;
    ep = (await one("INSERT INTO episodes (number, title, guest_id, status, aired_on) VALUES (12, 'Gestão de clínicas', $1, 'publicado', '2030-11-08') RETURNING id", [g])).id;
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('a aba nasce com o episódio; desligada ensina e ativa; o editor não ativa', async () => {
    const noEp = (await one("INSERT INTO guests (name, status) VALUES ('Sem Episódio', 'agendado') RETURNING id")).id;
    assert.doesNotMatch((await as.gestao.get(`/convidados/${noEp}`)).text, /data-tab-btn="portal"/);
    let page = (await as.gestao.get(`/convidados/${g}`)).text;
    assert.match(page, /data-tab-btn="portal"/); assert.match(page, /Ativar portal/);
    assert.equal((await as.editor.act(`/convidados/${g}/portal`, { on: '1' }, { from: '/' })).status, 403);

    const r = await act('gestao', `/convidados/${g}/portal`, { on: '1' });
    assert.equal(r.location, `/convidados/${g}#portal`);
    ({ portal_token: token } = await one('SELECT portal_token FROM guests WHERE id = $1', [g]));
    assert.match(token, /^[A-Za-z0-9_-]{24}$/);
    base = `/convidado/${token}`;
    page = (await as.gestao.get(`/convidados/${g}`)).text;
    assert.match(page, new RegExp(`/convidado/${token}`)); assert.match(page, /Enviar link/); assert.match(page, /link não enviado/);
    // cronograma automático: episódio na sexta 08/11, cortes na segunda 04/11, exclusivos com o episódio
    assert.match(page, /seg, 04\/11 · automático/); assert.match(page, /sex, 08\/11 · do episódio/);
  });

  it('a página pública: cronograma, collab reconhecida pelo @, outros posts, links do episódio; sem script ou estilo inline', async () => {
    const c1 = await clip('Corte 1');
    await pub({ clip: c1, title: 'A clínica que cresceu', results: [live('instagram', 'https://instagram.com/reel/A1'), live('tiktok', 'https://tiktok.com/v/1')], collab: ['marivabo'] });
    await pub({ title: 'Post de frase', media: 'imagem', results: [live('linkedin', 'https://linkedin.com/p/1')] });
    await pub({ title: 'Episódio completo', results: [live('youtube', 'https://youtu.be/ep12'), live('instagram', 'https://instagram.com/reel/EP')] });
    await pub({ title: 'Rascunho', results: [{ platform: 'tiktok', ok: true, draft: true, url: null }] });
    await q("UPDATE episodes SET youtube_url = 'https://youtu.be/ep12abcdefg', spotify_url = 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk?si=x' WHERE id = $1", [ep]);
    // post de outro episódio em collab com ela também entra
    const other = (await one("INSERT INTO episodes (number, title, status) VALUES (13, 'Outro', 'publicado') RETURNING id")).id;
    await pub({ episode: other, title: 'Participação especial', results: [live('instagram', 'https://instagram.com/reel/X')], collab: ['@MariVabo'] });

    assert.equal((await anon.get('/convidado/nao-existe-este-token-123')).status, 404);
    const r = await anon.get(base);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/); assert.match(r.headers.get('x-robots-tag'), /noindex/);
    assert.doesNotMatch(r.text, /<script>|onclick=|style=/);
    assert.match(r.text, /<h1>Olá, Mari\.<\/h1>/); assert.match(r.text, /EP\.012 · Gestão de clínicas/);
    assert.match(r.text, /seg, 04\/11/); assert.match(r.text, /Começam os cortes em collab/); assert.match(r.text, /sex, 08\/11/);
    const collab = r.text.split('id="collab"')[1].split('id="exclusivos"')[0];
    assert.match(collab, /A clínica que cresceu/); assert.match(collab, /Participação especial/); assert.match(collab, /collab · Instagram/);
    assert.match(collab, /Compartilhe nos stories/);
    assert.doesNotMatch(collab, /Post de frase/);
    const others = r.text.split('id="outros"')[1];
    assert.match(others, /Post de frase/); assert.match(others, /Episódio completo/); assert.doesNotMatch(others, /Rascunho/);
    assert.match(r.text, /<iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/ep12abcdefg\?rel=0"/);
    assert.match(r.text, /src="https:\/\/open\.spotify\.com\/embed\/episode\/4rOoJ6Egrf8K2IrywzwOMk"/);
    assert.match(r.headers.get('content-security-policy'), /frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/open\.spotify\.com/);
    assert.match(r.headers.get('content-security-policy'), /img-src 'self' data: https:\/\/s3\.test-region\.backblazeb2\.com/, 'capas redirecionadas para o Backblaze aparecem');
    assert.match(collabPart(r.text), /Clique e veja:/); assert.match(collabPart(r.text), /aria-label="Ver no Instagram"/); assert.match(collabPart(r.text), /class="icon brand"/);
    assert.match(r.text, /Este material fica disponível por 60 dias/); assert.match(r.text, /https:\/\/instagram\.com\/reel\/EP/);
    assert.match(r.text, /Falar com a produção/);
    const wa = await anon.get(`${base}/producao`);
    assert.equal(wa.status, 302); assert.match(wa.location, /^https:\/\/wa\.me\/\d*\?text=.*portal/);
  });

  it('cortes exclusivos: só os não publicados e marcados, a partir da data; tirar e pôr de volta', async () => {
    const ex = await clip('Corte 2', { postTitle: 'Saúde e negócios', caption: 'Legenda pronta' });
    const out = await clip('Corte 3', { forGuest: false });
    let r = await anon.get(base);
    assert.match(r.text, /Chegam em sex, 08\/11/); assert.doesNotMatch(r.text, /Saúde e negócios/);
    assert.equal((await anon.get(`${base}/cortes/${ex}`)).status, 404, 'antes da data, o corte não abre');

    await act('gestao', `/convidados/${g}/portal/datas`, { release_on: '2030-11-08', exclusive_from: '2020-01-01', cuts_from: '' });
    const row = await one("SELECT to_char(portal_exclusive_from, 'YYYY-MM-DD') AS e, portal_cuts_from FROM guests WHERE id = $1", [g]);
    assert.equal(row.e, '2020-01-01'); assert.equal(row.portal_cuts_from, null);
    assert.match((await act('gestao', `/convidados/${g}/portal/datas`, { release_on: 'amanhã' })).location, /#portal/);

    r = await anon.get(base);
    const sec = r.text.split('id="exclusivos"')[1].split('id="episodio"')[0];
    assert.match(sec, /Saúde e negócios/); assert.match(sec, /Legenda pronta/); assert.match(sec, /Baixar corte/);
    assert.doesNotMatch(sec, /Corte 1/, 'publicado vai para os posts'); assert.doesNotMatch(sec, /Corte 3/, 'tirado do portal');
    const dl = await anon.get(`${base}/cortes/${ex}/baixar`);
    assert.equal(dl.status, 302); assert.match(dl.location, /X-Amz-Signature/); assert.match(dl.location, /saude-e-negocios\.mp4/);
    assert.equal((await anon.get(`${base}/cortes/${out}`)).status, 404);

    assert.equal((await as.editor.act(`/cortes/${ex}/convidado`, { on: '0' }, { from: '/' })).status, 403);
    await as.gestao.act(`/cortes/${ex}/convidado`, { on: '0', voltar: `/convidados/${g}` }, { from: `/cortes/${ex}` });
    assert.doesNotMatch((await anon.get(base)).text, /Saúde e negócios/);
    await as.gestao.act(`/cortes/${ex}/convidado`, { on: '1' }, { from: `/cortes/${ex}` });
    assert.match((await anon.get(base)).text, /Saúde e negócios/);
    assert.match((await as.gestao.get(`/cortes/${ex}`)).text, /Portal do convidado:.*exclusivo de Mari/s);
  });

  it('fotos: a equipe escolhe; só as escolhidas abrem', async () => {
    const [f1, f2] = await Promise.all(['a.jpg', 'b.jpg'].map(async (n) => (await one(
      "INSERT INTO episode_files (episode_id, kind, filename, content_type, size_bytes, storage_key, status) VALUES ($1, 'foto', $2, 'image/jpeg', 10, $3, 'pronto') RETURNING id", [ep, n, `pp/f/${n}`])).id));
    assert.doesNotMatch((await anon.get(base)).text, /id="fotos"/);
    assert.match((await as.gestao.get(`/convidados/${g}`)).text, /0 de 2/);
    await act('gestao', `/convidados/${g}/portal/fotos`, { fotos: [String(f2)] });
    assert.match((await anon.get(base)).text, new RegExp(`${base}/fotos/${f2}/baixar`));
    assert.equal((await anon.get(`${base}/fotos/${f1}/baixar`)).status, 404);
    const dl = await anon.get(`${base}/fotos/${f2}/baixar`);
    assert.equal(dl.status, 302); assert.match(dl.location, /b\.jpg/);
    // todas num ZIP só
    await act('gestao', `/convidados/${g}/portal/fotos`, { fotos: [String(f1), String(f2)] });
    h.b2Store.set('pp/f/a.jpg', { body: Buffer.from('foto-a'), contentType: 'image/jpeg' });
    h.b2Store.set('pp/f/b.jpg', { body: Buffer.from('foto-bb'), contentType: 'image/jpeg' });
    assert.match((await anon.get(base)).text, new RegExp(`${base}/fotos\\.zip`));
    const zr = await fetch(`${app.base}${base}/fotos.zip`);
    assert.equal(zr.status, 200); assert.equal(zr.headers.get('content-type'), 'application/zip');
    const zip = Buffer.from(await zr.arrayBuffer());
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50); assert.equal(zip.readUInt16LE(zip.length - 12), 2, 'duas fotos');
    assert.ok(zip.includes('a.jpg') && zip.includes('foto-bb'));
    assert.equal(zip.readUInt32LE(14), require('zlib').crc32(Buffer.from('foto-a')) >>> 0);
  });

  it('collab no YouTube: o convidado pede, a equipe é avisada e marca como feita', async () => {
    let r = await anon.post(`${base}/youtube`, { canal: 'não é canal!' });
    assert.equal(r.status, 303); assert.match(r.location, /youtube=erro/);
    assert.match((await anon.get(`${base}?youtube=erro`)).text, /Não reconhecemos esse canal/);
    r = await anon.post(`${base}/youtube`, { canal: 'https://www.youtube.com/@marivabo' });
    assert.match(r.location, /youtube=ok/);
    assert.equal((await one('SELECT portal_yt_channel FROM guests WHERE id = $1', [g])).portal_yt_channel, '@marivabo');
    assert.match((await anon.get(base)).text, /Pedido recebido para o canal/);
    let n;
    for (let i = 0; i < 20 && !n; i += 1) { n = await one("SELECT title FROM notifications WHERE title LIKE '%collab no YouTube%'"); if (!n) await new Promise((x) => setTimeout(x, 50)); }
    assert.ok(n, 'a equipe recebe o aviso');
    assert.match((await as.gestao.get(`/convidados/${g}`)).text, /Marcar como feita/);
    await act('gestao', `/convidados/${g}/portal/youtube`, { feito: '1' });
    r = await anon.get(base);
    assert.match(r.text, /O episódio está em collab com o seu canal/);
    assert.match(r.text.split('id="collab"')[1].split('id="exclusivos"')[0], /Episódio completo/, 'o episódio vira collab no YouTube');
  });

  it('enviar o link por e-mail; post novo em collab vira e-mail; no WhatsApp fica pendente até a equipe mandar', async () => {
    const portal = require('../src/services/guestPortal');
    h.mailer.outbox.length = 0;
    await act('gestao', `/convidados/${g}/portal/enviar`, { canal: 'email' });
    assert.equal(h.mailer.outbox.length, 1); assert.equal(h.mailer.outbox[0].to, 'mari@ex.com'); assert.match(h.mailer.outbox[0].html, new RegExp(`/convidado/${token}`));
    assert.ok((await one('SELECT portal_sent_at FROM guests WHERE id = $1', [g])).portal_sent_at);
    assert.equal(await portal.tick(), 0, 'o que já estava no ar não vira aviso');

    await pub({ title: 'Corte novo', results: [live('instagram', 'https://instagram.com/reel/N1')], collab: ['marivabo'] });
    assert.equal(await portal.tick(), 1);
    const mail = h.mailer.outbox.at(-1);
    assert.match(mail.subject, /Post novo em collab/); assert.match(mail.html, /reel\/N1/);
    assert.equal(await portal.tick(), 0, 'cada post avisa uma vez');

    await act('gestao', `/convidados/${g}/portal/aviso`, { canal: 'whatsapp' });
    await pub({ title: 'Outro corte', results: [live('instagram', 'https://instagram.com/reel/N2')], collab: ['marivabo'] });
    const before = h.mailer.outbox.length;
    assert.equal(await portal.tick(), 1);
    assert.equal(h.mailer.outbox.length, before, 'no WhatsApp, nada sai sozinho');
    const page = (await as.gestao.get(`/convidados/${g}`)).text;
    assert.match(page, /Um post novo em collab para avisar/); assert.match(page, /Avisar no WhatsApp/);
    const r = await act('gestao', `/convidados/${g}/portal/avisar`, {});
    assert.equal(r.status, 303); assert.match(r.location, /^https:\/\/wa\.me\/5511988887777\?text=.*reel%2FN2/);
    assert.doesNotMatch((await as.gestao.get(`/convidados/${g}`)).text, /para avisar/);
  });

  it('o material fica disponível por 60 dias a partir do envio; a equipe estende', async () => {
    const { portal_expires_at: exp, portal_sent_at: sent } = await one('SELECT portal_expires_at, portal_sent_at FROM guests WHERE id = $1', [g]);
    assert.equal(Math.round((new Date(exp) - new Date(sent)) / 86400_000), 60);
    assert.match((await anon.get(base)).text, /Este material fica disponível até/);
    await q("UPDATE guests SET portal_expires_at = now() - interval '1 minute' WHERE id = $1", [g]);
    const r = await anon.get(base);
    assert.equal(r.status, 410); assert.match(r.text, /não está mais disponível/);
    assert.match((await as.gestao.get(`/convidados/${g}`)).text, /expirou/);
    assert.equal(await require('../src/services/guestPortal').tick(), 0, 'expirado não avisa');
    await act('gestao', `/convidados/${g}/portal/estender`, {});
    assert.equal((await anon.get(base)).status, 200);
  });

  it('novo link derruba o antigo; desativar fecha o portal', async () => {
    await act('gestao', `/convidados/${g}/portal/novo-link`, {});
    assert.equal((await anon.get(base)).status, 404);
    const { portal_token: t2 } = await one('SELECT portal_token FROM guests WHERE id = $1', [g]);
    assert.equal((await anon.get(`/convidado/${t2}`)).status, 200);
    await act('gestao', `/convidados/${g}/portal`, { on: '0' });
    assert.equal((await anon.get(`/convidado/${t2}`)).status, 404);
  });
});
