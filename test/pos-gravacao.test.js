// Página pós-gravação (/pos-gravacao): pública, a mesma para todos os convidados, fora dos buscadores, com o caminho depois da
// gravação, o portal, os cortes em collab, as redes e o WhatsApp da produção (número e mensagem de Gestão > WhatsApp dos convites).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const settings = require('../src/services/settings');

describe('Página pós-gravação', () => {
  let app; let gestao;
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    await h.createUser({ name: 'Gil Gestão', email: 'gestao@t.com', role: 'gestao' });
    gestao = h.client(app.base); assert.equal((await gestao.login('gestao@t.com')).status, 302);
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('abre sem login, fora dos buscadores e sem script', async () => {
    const r = await h.client(app.base).get('/pos-gravacao');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('x-robots-tag'), /noindex/);
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /default-src 'none'/); assert.doesNotMatch(csp, /unsafe-inline/);
    assert.match(r.text, /<meta name="robots" content="noindex, nofollow, noarchive">/);
    assert.doesNotMatch(r.text, /<script/);
  });

  it('agradece e mostra o que acontece agora, o portal, os cortes em collab e as redes', async () => {
    const t = (await h.client(app.base).get('/pos-gravacao')).text;
    assert.match(t, /Obrigado por sentar à mesa\./);
    for (const step of ['Gravação', 'Triagem e edição', 'A data do seu episódio', 'Seu portal do convidado', 'Bastidores e aviso', 'Episódio e cortes']) assert.match(t, new RegExp(`<h3>${step}</h3>`));
    assert.match(t, /Sexta-feira antes do episódio/);
    for (const item of ['Fotos da gravação', 'Posts em collab', 'Cortes inéditos', 'Posts inéditos', 'Agenda dos cortes']) assert.match(t, new RegExp(item));
    assert.match(t, /Cortes em collab/); assert.match(t, /sem custo para você/);
    for (const net of ['Instagram e Reels', 'YouTube e Shorts', 'TikTok', 'LinkedIn', 'X \\(Twitter\\)', 'Threads', 'Facebook']) assert.match(t, new RegExp(`<span>${net}</span>`));
  });

  it('o WhatsApp é o da produção, com a mensagem da página (editável na gestão)', async () => {
    let t = (await h.client(app.base).get('/pos-gravacao')).text;
    assert.match(t, /href="https:\/\/wa\.me\/5512991053852\?text=Ol%C3%A1!%20Gravei%20no%20/);
    assert.match(t, /\(12\) 99105-3852/);
    assert.match(t, /class="pp-wa"/, 'o botão flutuante de dúvidas');
    await settings.set('whatsapp_msg_posgravacao', 'Oi, produção! Tenho uma dúvida.');
    await settings.set('whatsapp_producao', '5548999720273');
    t = (await h.client(app.base).get('/pos-gravacao')).text;
    assert.match(t, /href="https:\/\/wa\.me\/5548999720273\?text=Oi%2C%20produ%C3%A7%C3%A3o!%20Tenho%20uma%20d%C3%BAvida\."/);
    assert.match(t, /\(48\) 99972-0273/);
  });

  it('a gestão acha o link em Gestão > WhatsApp dos convites e edita a mensagem da página ali', async () => {
    const page = (await gestao.get('/gestao/whatsapp')).text;
    assert.match(page, /Página pós-gravação/);
    assert.match(page, /data-copy="http:\/\/localhost\/pos-gravacao"/);
    assert.match(page, /Na página pós-gravação/);
  });
});
