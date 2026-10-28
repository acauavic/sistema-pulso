const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app;
let admin; let gestao; let produtora; let editor;
const as = {};

const lastMail = (to) => [...h.mailer.outbox].reverse().find((m) => !to || m.to === to);
const JSON_HEADERS = (csrf) => ({ accept: 'application/json', 'x-csrf-token': csrf });

// PNG mínimo: assinatura + IHDR (cor tipo 6 = com transparência) + enchimento. O servidor só confere assinatura e tipo de cor.
function fakePng({ colorType = 6 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(10, 0); ihdr.writeUInt32BE(10, 4); ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), ihdr, Buffer.alloc(4), Buffer.alloc(120, 7)]);
}

const sponsorFields = (o = {}) => ({ company: 'Clínica Aurora', kind: 'negocio', ...o });

// Fotos de convidado também passam pelo bucket (pp/convidados/…). A conferência de assinatura no fim do arquivo só trata de
// chamadas do patrocinador, então os testes de foto tiram as deles do registro.
const forgetGuestPhotoCalls = () => { for (let i = h.b2Calls.length - 1; i >= 0; i -= 1) if (!/^pp\/patrocinadores\//.test(h.b2Calls[i].key)) h.b2Calls.splice(i, 1); };

describe('central de patrocinadores', () => {
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    admin = await h.createUser({ name: 'Ana Admin', email: 'admin@t.com', role: 'superadmin' });
    gestao = await h.createUser({ name: 'Gil Gestão', email: 'gestao@t.com', role: 'gestao' });
    produtora = await h.createUser({ name: 'Paula Produtora', email: 'prod@t.com', role: 'produtora' });
    editor = await h.createUser({ name: 'Edu Editor', email: 'edit@t.com', role: 'editor_video' });
    for (const [k, email] of [['admin', 'admin@t.com'], ['gestao', 'gestao@t.com'], ['prod', 'prod@t.com'], ['editor', 'edit@t.com']]) {
      as[k] = h.client(app.base);
      assert.equal((await as[k].login(email)).status, 302, `login ${k}`);
    }
  });
  after(async () => { await app.close(); await h.db.close(); });

  const anon = () => h.client(app.base);
  const sponsor = (id) => h.db.query('SELECT * FROM sponsors WHERE id=$1', [id]).then((r) => r.rows[0]);
  const create = async (fields) => {
    const r = await as.prod.act('/patrocinadores', { owner_id: produtora.id, ...sponsorFields(fields) }, { from: '/patrocinadores/novo' });
    assert.equal(r.status, 302, r.text.slice(0, 300));
    return r.location.split('/').pop();
  };
  const move = async (id, status, who = 'prod') => {
    const csrf = await as[who].csrf('/patrocinadores');
    return as[who].post(`/patrocinadores/${id}/etapa`, { status }, { headers: JSON_HEADERS(csrf) });
  };
  const tokenOf = async (id) => {
    await as.prod.act(`/patrocinadores/${id}/links`, {}, { from: `/patrocinadores/${id}` });
    return (await sponsor(id)).public_token;
  };

  describe('cadastro e funil', () => {
    let id;

    it('cria com empresa, site, tipo, cota, valor e responsável; valor em reais vira centavos', async () => {
      id = await create({
        website: 'aurora.com.br', tier: 'diamond', value: '15.000,00', contact_name: 'Ricardo Nascimento', contact_email: 'ricardo@aurora.com.br', contact_phone: '(12) 98888-0000',
      });
      const s = await sponsor(id);
      assert.equal(s.company, 'Clínica Aurora');
      assert.equal(s.website, 'https://aurora.com.br/');
      assert.equal(s.kind, 'negocio');
      assert.equal(s.tier, 'diamond');
      assert.equal(String(s.value_cents), '1500000');
      assert.equal(s.stage, 'prospect');
      assert.equal(s.owner_id, produtora.id);
      const page = (await as.prod.get(`/patrocinadores/${id}`)).text;
      assert.match(page, /R\$\s15\.000,00/);
      assert.match(page, /Ricardo Nascimento/);
      assert.match(page, /Diamond/);
      assert.match(page, /Prospecção/);
    });

    it('valida o formulário', async () => {
      const bad = (fields) => as.prod.act('/patrocinadores', fields, { from: '/patrocinadores/novo' });
      assert.equal((await bad({ company: 'A', kind: 'negocio' })).status, 400);
      assert.match((await bad({ company: 'Sem Tipo' })).text, /tipo de patrocinador/);
      assert.match((await bad(sponsorFields({ value: 'muito caro' }))).text, /Valor inválido/);
      assert.match((await bad(sponsorFields({ contact_email: 'ruim' }))).text, /E-mail/);
      assert.match((await bad(sponsorFields({ starts_on: '2026-12-10', ends_on: '2026-12-01' }))).text, /fim da vigência/);
      assert.match((await bad(sponsorFields({ paid_at: '2026-02-31' }))).text, /Data inválida/);
      assert.equal((await bad(sponsorFields({ owner_id: '00000000-0000-4000-8000-000000000000' }))).status, 400);
    });

    it('nome com HTML é escapado no painel', async () => {
      const xss = await create({ company: 'Evil <script>alert(1)</script>' });
      const page = (await as.prod.get(`/patrocinadores/${xss}`)).text;
      assert.doesNotMatch(page, /<script>alert\(1\)/);
      assert.match(page, /Evil &lt;script&gt;/);
    });

    it('quadro e lista mostram as etapas novas e o total por coluna', async () => {
      const board = (await as.prod.get('/patrocinadores')).text;
      assert.match(board, /data-board/);
      for (const key of ['prospect', 'negociacao', 'ganho', 'ativo', 'inativo', 'perdido']) assert.match(board, new RegExp(`data-status="${key}"`), key);
      assert.match(board, /R\$\s15\.000,00/);
      const list = (await as.prod.get('/patrocinadores?view=lista&stage=prospect&q=aurora')).text;
      assert.match(list, /Clínica Aurora/);
      assert.match((await as.prod.get('/patrocinadores?q=zzzz-nada')).text, /Clínica|board/);
    });

    it('Ganho exige cota, valor, responsável e contato; arrastar devolve 422 com o caminho para completar', async () => {
      const bare = await create({ company: 'Marca Sem Dados' });
      const blocked = await move(bare, 'ganho');
      assert.equal(blocked.status, 422);
      const info = JSON.parse(blocked.text);
      assert.deepEqual(info.missing, ['cota (Ouro ou Diamond)', 'valor do patrocínio', 'nome do responsável na empresa', 'e-mail e/ou WhatsApp do responsável na empresa']);
      assert.equal(info.editUrl, `/patrocinadores/${bare}?abrir=ganho`, 'abre a janela que pede só o que falta');
      assert.equal((await sponsor(bare)).stage, 'prospect');
      const page = (await as.prod.get(info.editUrl)).text;
      assert.match(page, /id="modal-ganho"[^>]*data-open-on-load/);
      assert.match(page, /name="tier" required/);
      const form = await as.prod.act(`/patrocinadores/${bare}/etapa`, { status: 'ganho' }, { from: '/patrocinadores' });
      assert.equal(form.status, 302);
      assert.match(form.location, /\?abrir=ganho/);
    });

    it('próximo passo guiado: "Fechou" salva só os campos da janela e move para Ganho; "Pagamento confirmado" leva a Ativo', async () => {
      const sid = await create({ company: 'Marca Guiada' });
      const page = (await as.prod.get(`/patrocinadores/${sid}`)).text;
      assert.match(page, /Próximo passo/);
      assert.match(page, /Apresentar o Pulso/);
      assert.doesNotMatch(page, /id="pane-entregas"/, 'entregas só depois de Ganho');
      const step = (fields) => as.prod.act(`/patrocinadores/${sid}/avancar`, fields, { from: `/patrocinadores/${sid}` });
      let r = await step({ para: 'ganho', tier: 'ouro', value: '8.000,00', contact_name: 'Ana Lima', contact_phone: '', contact_email: '' });
      assert.match(r.location, /\?abrir=ganho/, 'faltou contato: volta para a janela');
      let s = await sponsor(sid);
      assert.equal(s.stage, 'prospect');
      assert.equal(s.tier, 'ouro', 'o que veio fica salvo');
      assert.equal(Number(s.value_cents), 800000);
      assert.equal((await step({ para: 'ganho', tier: 'ouro', value: 'abc', contact_name: 'Ana Lima', contact_email: 'ana@marca.com' })).status, 302);
      assert.equal((await sponsor(sid)).stage, 'prospect', 'valor inválido não move');
      r = await step({ para: 'ganho', tier: 'ouro', value: '8.000,00', contact_name: 'Ana Lima', contact_email: 'ana@marca.com' });
      assert.equal(r.location, `/patrocinadores/${sid}`);
      s = await sponsor(sid);
      assert.equal(s.stage, 'ganho');
      assert.equal(s.contact_email, 'ana@marca.com');
      assert.match((await as.prod.get(`/patrocinadores/${sid}`)).text, /Cadastro e pagamento/);
      assert.match((await step({ para: 'ativo', paid_at: '2026-10-05', starts_on: '2026-10-10', ends_on: '2026-10-01' })).location, /\?abrir=ativo/, 'vigência ao contrário');
      r = await step({ para: 'ativo', paid_at: '2026-10-05', starts_on: '2026-10-10', ends_on: '2026-12-10' });
      s = await sponsor(sid);
      assert.equal(s.stage, 'ativo');
      assert.equal(s.tier, 'ouro', 'campos fora da janela não mudam');
      assert.match((await as.prod.get(`/patrocinadores/${sid}`)).text, /Patrocínio em andamento/);
      assert.equal((await as.editor.act(`/patrocinadores/${sid}/avancar`, { para: 'inativo' }, { from: `/patrocinadores/${sid}` })).status, 403);
    });

    it('Ativo exige a data do pagamento; o formulário também respeita as regras', async () => {
      assert.equal((await move(id, 'ganho')).status, 200);
      const noPay = await move(id, 'ativo');
      assert.equal(noPay.status, 422);
      assert.deepEqual(JSON.parse(noPay.text).missing, ['data do pagamento confirmado']);
      const edit = (fields) => as.prod.act(`/patrocinadores/${id}`, sponsorFields({ tier: 'diamond', value: '15.000,00', contact_name: 'Ricardo Nascimento', contact_email: 'ricardo@aurora.com.br', ...fields }), { from: `/patrocinadores/${id}/editar` });
      assert.equal((await edit({ stage: 'ativo' })).status, 400);
      assert.equal((await edit({ stage: 'ativo', paid_at: '2026-10-05', starts_on: '2026-10-09', ends_on: '2026-11-06' })).status, 302);
      const s = await sponsor(id);
      assert.equal(s.stage, 'ativo');
      assert.match(String(s.paid_at), /2026/);
      assert.equal((await move(id, 'prospect')).status, 200, 'voltar etapa não exige nada');
      assert.equal((await move(id, 'ativo')).status, 200, 'dados já salvos: passa');
    });

    it('nota entra na linha do tempo e mudanças de etapa ficam registradas', async () => {
      await as.prod.act(`/patrocinadores/${id}/nota`, { nota: 'Reunião com o jurídico' }, { from: `/patrocinadores/${id}` });
      const page = (await as.prod.get(`/patrocinadores/${id}`)).text;
      assert.match(page, /Reunião com o jurídico/);
      assert.match(page, /Etapa: Em negociação|Etapa: Prospecção → Ganho|Etapa: Ganho → Ativo/);
    });

    it('permissões: editor de vídeo só enxerga; exclusão só gestão/superadmin; IDs ruins viram 404', async () => {
      assert.equal((await as.editor.get('/patrocinadores')).status, 200);
      assert.equal((await as.editor.get(`/patrocinadores/${id}`)).status, 200);
      assert.equal((await as.editor.get('/patrocinadores/novo')).status, 403);
      assert.equal((await as.editor.act('/patrocinadores', sponsorFields(), { from: '/patrocinadores' })).status, 403);
      assert.equal((await as.editor.act(`/patrocinadores/${id}/links`, {}, { from: '/patrocinadores' })).status, 403);
      assert.equal((await as.editor.act(`/patrocinadores/${id}/briefing`, {}, { from: '/patrocinadores' })).status, 403);
      assert.equal((await as.prod.act(`/patrocinadores/${id}/excluir`, {}, { from: '/patrocinadores' })).status, 403);
      for (const p of ['/patrocinadores/abc', '/patrocinadores/99999999', '/patrocinadores/abc/editar', '/patrocinadores/abc/arquivos/1', '/episodios/abc/editar']) {
        assert.equal((await as.admin.get(p)).status, 404, p);
      }
    });
  });

  describe('magic link, sessão do patrocinador e media kit', () => {
    let id; let token;
    const enter = async (tok, page = '', opts = {}) => {
      const c = h.client(app.base);
      const r = await c.get(`/patrocinador/${tok}${page}`, opts);
      return { c, r };
    };

    it('gera um token por patrocinador; o painel mostra os três links como magic links', async () => {
      id = await create({ company: 'Marca Pessoal Bia', kind: 'marca_pessoal', contact_name: 'Bia Souza', contact_phone: '(11) 97777-0000' });
      token = await tokenOf(id);
      assert.match(token, /^[A-Za-z0-9_-]{20,}$/);
      const page = (await as.prod.get(`/patrocinadores/${id}`)).text;
      assert.match(page, new RegExp(`http://localhost/patrocinador/${token}"`));
      assert.match(page, new RegExp(`/patrocinador/${token}/cadastro`));
      assert.match(page, new RegExp(`/patrocinador/${token}/portal`));
      assert.match(page, /libera em Ganho/);
      assert.match(page, /Magic links reutilizáveis/);
    });

    it('abrir o link cria a sessão (cookie HttpOnly) e leva para uma URL limpa, sem o token', async () => {
      const { c, r } = await enter(token);
      assert.equal(r.status, 302);
      assert.equal(r.location, '/patrocinador/kit');
      assert.doesNotMatch(r.location, new RegExp(token));
      const cookie = r.headers.getSetCookie().find((x) => x.startsWith('pulso_sp='));
      assert.ok(cookie, 'cookie de sessão do patrocinador');
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Lax/);
      assert.match(cookie, /Path=\/patrocinador/);
      assert.match(cookie, /Max-Age=2592000/, '30 dias');
      const rawCookie = cookie.split(';')[0].split('=')[1];
      const { rows } = await h.db.query('SELECT token_hash FROM sponsor_sessions WHERE sponsor_id=$1', [id]);
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0].token_hash, decodeURIComponent(rawCookie), 'o banco guarda só o hash');
      assert.equal((await c.get('/patrocinador/kit')).status, 200);
    });

    it('é reutilizável: o mesmo link abre de novo, em outro navegador, e reaproveita a sessão que já existe', async () => {
      const { c } = await enter(token);
      await c.get(`/patrocinador/${token}`); // mesmo navegador: não cria outra sessão
      assert.equal((await h.db.query('SELECT count(*)::int n FROM sponsor_sessions WHERE sponsor_id=$1', [id])).rows[0].n, 1 + 1, 'uma do teste anterior + uma deste navegador');
      const second = await enter(token); // outro navegador/dispositivo
      assert.equal(second.r.status, 302);
      assert.equal((await second.c.get('/patrocinador/kit')).status, 200);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM sponsor_sessions WHERE sponsor_id=$1', [id])).rows[0].n, 3);
    });

    it('cada link de entrada leva à página certa (kit, formulário, portal)', async () => {
      assert.equal((await enter(token, '/cadastro')).r.location, '/patrocinador/cadastro');
      assert.equal((await enter(token, '/portal')).r.location, '/patrocinador/portal');
    });

    it('robôs de pré-visualização não ganham sessão (recebem só uma página simples)', async () => {
      const { r } = await enter(token, '', { ua: 'WhatsApp/2.23' });
      assert.equal(r.status, 200);
      assert.match(r.text, /Pulso · Marca Pessoal Bia/);
      assert.equal(r.headers.getSetCookie().length, 0, 'nenhum cookie para robô');
    });

    it('sem sessão as páginas e ações pedem o link; token inválido ou forjado dá 404', async () => {
      const c = anon();
      for (const p of ['/patrocinador/kit', '/patrocinador/quero', '/patrocinador/equipe', '/patrocinador/cadastro', '/patrocinador/portal', '/patrocinador/arquivo/1']) {
        const r = await c.get(p);
        assert.equal(r.status, 401, p);
        assert.match(r.text, /Abra pelo seu link/);
      }
      assert.equal((await c.post('/patrocinador/cadastro', { offer: 'x' })).status, 401);
      for (const t of ['x', 'a'.repeat(24), "' OR 1=1 --", '../../etc/passwd']) {
        for (const sub of ['', '/cadastro', '/portal']) assert.equal((await anon().get(`/patrocinador/${encodeURIComponent(t)}${sub}`)).status, 404, `${t}${sub}`);
      }
    });

    it('cookie forjado ou de outro patrocinador não abre nada', async () => {
      const r = await fetch(`${app.base}/patrocinador/kit`, { headers: { cookie: `pulso_sp=${'x'.repeat(43)}` } });
      assert.equal(r.status, 401);
    });

    it('media kit: o deck do Pulso, com botões limpos (sem token) e imagens do próprio servidor', async () => {
      const { c } = await enter(token);
      const r = await c.get('/patrocinador/kit');
      assert.equal(r.status, 200);
      assert.match(r.text, /Media Kit Pulso/);
      assert.match(r.text, /href="\/patrocinador\/quero"/);
      assert.match(r.text, /href="\/patrocinador\/equipe"/);
      assert.doesNotMatch(r.text, new RegExp(token), 'o token não aparece na página');
      assert.doesNotMatch(r.text, /href="https:\/\/wa\.me/);
      assert.doesNotMatch(r.text, /data:image\/jpeg;base64/);
      assert.doesNotMatch(r.text, /\{\{/);
      assert.match(r.headers.get('content-security-policy'), /sandbox allow-scripts/);
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
      const img = r.text.match(/\/static\/kit\/img-\d+\.jpg/g);
      assert.ok(img && img.length >= 10);
      for (const path of new Set(img)) assert.equal((await fetch(app.base + path)).status, 200, path);
    });

    it('media kit: "Quem já está na agenda" vem dos convidados em Agendado (por mês), nada inventado', async () => {
      const { c } = await enter(token);
      let t = (await c.get('/patrocinador/kit')).text;
      assert.doesNotMatch(t, /Mohamad Barakat/, 'sem nomes fixos no HTML');
      const { rows: [g] } = await h.db.query("INSERT INTO guests (name, instagram, profile, status, proposed_at) VALUES ('Dra. <i>Kit</i>', 'dra.kit', 'medico', 'agendado', now() + interval '20 days') RETURNING id");
      await h.db.query("INSERT INTO guests (name, instagram, profile, status, proposed_at) VALUES ('Só Em Agendamento', 'emag', 'medico', 'em_agendamento', now() + interval '5 days')");
      t = (await c.get('/patrocinador/kit')).text;
      assert.match(t, /Dra\. &lt;i&gt;Kit&lt;\/i&gt;/, 'nome escapado');
      assert.match(t, /@dra\.kit/);
      assert.match(t, /data-agenda-track/); assert.match(t, /class="agenda-date">\d{2} [A-Z]{3}</, 'data curta no cartão'); assert.match(t, /data-handle="dra\.kit"/);
      assert.doesNotMatch(t, /Só Em Agendamento/, 'só quem está com a data confirmada');
      await h.db.query("DELETE FROM guests WHERE id=$1 OR instagram='emag'", [g.id]);
    });

    it('media kit: foto do convidado na moldura 4:3 por endereço assinado e com validade; sem foto mantém o espaço "Foto"', async () => {
      const guestPhotos = require('../src/services/guestPhotos');
      const { c } = await enter(token);
      const b2 = require('../src/services/b2');
      const { rows: [com] } = await h.db.query("INSERT INTO guests (name, instagram, profile, status, proposed_at) VALUES ('Dra. Foto Kit', 'dra.fotokit', 'medico', 'agendado', now() + interval '20 days') RETURNING id");
      const { rows: [sem] } = await h.db.query("INSERT INTO guests (name, instagram, profile, status, proposed_at, photo_key) VALUES ('Dr. Sem Foto Kit', 'dr.semfotokit', 'medico', 'agendado', now() + interval '21 days', NULL) RETURNING id");
      const key = await b2.keyFor('convidados', com.id, 'foto-kit.jpg');
      await b2.putObject(key, Buffer.from('JPEGKIT'), 'image/jpeg');
      await h.db.query('UPDATE guests SET photo_key = $2 WHERE id = $1', [com.id, key]);
      try {
        const t = (await c.get('/patrocinador/kit')).text;
        const m = t.match(/<span class="agenda-photo img-slot has-photo"><img src="(\/agenda\/foto\/(\d+)\?e=(\d+)&amp;s=([\w-]{32}))" alt="Dra\. Foto Kit"/);
        assert.ok(m, 'o convidado com foto ganha a imagem na moldura');
        assert.equal(Number(m[2]), com.id);
        assert.match(t, /agenda-photo img-slot"><span class="plus">\+<\/span><span class="cap">Foto/, 'sem foto, o espaço reservado continua');
        assert.match(t, /\.agenda-photo\{[^}]*aspect-ratio:4\/3/, 'moldura padrão 4:3 no lugar do círculo');
        const url = m[1].replace(/&amp;/g, '&');
        const img = await fetch(app.base + url);
        assert.equal(img.status, 200); assert.equal(await img.text(), 'JPEGKIT');
        assert.equal(img.headers.get('content-type'), 'image/jpeg'); assert.match(img.headers.get('content-security-policy'), /sandbox/);
        assert.equal(img.headers.get('cross-origin-resource-policy'), 'cross-origin', 'o kit roda em sandbox (origem opaca): com same-origin o navegador bloquearia a foto');
        // assinatura: adulterada, de outro convidado, vencida, ausente ou convidado sem foto não abrem nada
        const bad = [url.replace(/s=(.)/, (all, ch) => `s=${ch === 'a' ? 'b' : 'a'}`), url.replace(`/foto/${com.id}`, `/foto/${sem.id}`), guestPhotos.signedUrl(com.id, Date.now() - 3 * 24 * 3600 * 1000),
          `/agenda/foto/${com.id}`, `/agenda/foto/${com.id}?e=9999999999&s=${'0'.repeat(32)}`, guestPhotos.signedUrl(sem.id), '/agenda/foto/abc?e=1&s=2'];
        for (const u of bad) assert.equal((await fetch(app.base + u)).status, 404, u);
      } finally {
        await h.db.query('DELETE FROM guests WHERE id = ANY($1)', [[com.id, sem.id]]);
        await b2.deleteObject(key).catch(() => {});
        forgetGuestPhotoCalls();
      }
    });

    it('"visto" conta a primeira abertura humana uma vez só', async () => {
      assert.ok((await sponsor(id)).kit_viewed_at);
      assert.equal((await h.db.query("SELECT count(*)::int n FROM sponsor_events WHERE sponsor_id=$1 AND type='kit_visto'", [id])).rows[0].n, 1);
    });

    it('"Quero ser patrocinador": conta o clique, vai para Em negociação, avisa a equipe e abre o WhatsApp comercial', async () => {
      h.mailer.outbox.length = 0;
      const { c } = await enter(token);
      const r = await c.get('/patrocinador/quero');
      assert.equal(r.status, 302);
      assert.match(r.location, /^https:\/\/wa\.me\/5511971739061\?text=Oi%2C%20quero%20ser%20um%20patrocinador/);
      assert.equal((await sponsor(id)).stage, 'negociacao');
      assert.equal((await h.db.query("SELECT count(*)::int n FROM sponsor_clicks WHERE sponsor_id=$1 AND kind='quero'", [id])).rows[0].n, 1);
      const mail = lastMail('prod@t.com');
      assert.ok(mail, 'responsável da equipe avisado');
      assert.match(mail.subject, /Marca Pessoal Bia quer ser patrocinador/);
      h.mailer.outbox.length = 0;
      await c.get('/patrocinador/quero');
      assert.equal(h.mailer.outbox.length, 0, 'segundo clique não repete o aviso');
      assert.equal((await h.db.query("SELECT count(*)::int n FROM sponsor_clicks WHERE sponsor_id=$1 AND kind='quero'", [id])).rows[0].n, 2);
      assert.match((await as.prod.get(`/patrocinadores/${id}`)).text, /“Quero ser patrocinador”: <strong>2<\/strong>/);
    });

    it('"Falar com a equipe" só conta e redireciona; o primeiro clique entra na linha do tempo', async () => {
      const { c } = await enter(token);
      const r = await c.get('/patrocinador/equipe');
      assert.equal(r.status, 302);
      assert.match(r.location, /^https:\/\/wa\.me\/5511971739061\?text=Oi%2C%20quero%20saber%20mais/);
      await c.get('/patrocinador/equipe');
      assert.equal((await h.db.query("SELECT count(*)::int n FROM sponsor_events WHERE sponsor_id=$1 AND message LIKE '%Falar com a equipe%'", [id])).rows[0].n, 1);
    });

    it('gerar novos links derruba as sessões abertas e o link antigo', async () => {
      const { c } = await enter(token);
      assert.equal((await c.get('/patrocinador/kit')).status, 200);
      await as.prod.act(`/patrocinadores/${id}/links`, { regenerar: '1' }, { from: `/patrocinadores/${id}` });
      assert.equal((await c.get('/patrocinador/kit')).status, 401, 'sessão aberta foi encerrada');
      assert.equal((await anon().get(`/patrocinador/${token}`)).status, 404, 'link antigo morreu');
      assert.equal((await h.db.query('SELECT count(*)::int n FROM sponsor_sessions WHERE sponsor_id=$1', [id])).rows[0].n, 0);
      token = (await sponsor(id)).public_token;
      assert.equal((await enter(token)).r.status, 302, 'o novo link funciona');
    });

    it('sessão vencida não vale; excluir o patrocinador apaga as sessões', async () => {
      const { c } = await enter(token);
      assert.equal((await c.get('/patrocinador/kit')).status, 200);
      await h.db.query("UPDATE sponsor_sessions SET expires_at = now() - interval '1 minute' WHERE sponsor_id=$1", [id]);
      assert.equal((await c.get('/patrocinador/kit')).status, 401);
      assert.equal((await enter(token)).r.status, 302, 'o link continua válido: abre uma sessão nova');
    });
  });

  describe('formulário de cadastro (briefing), logo e voz', () => {
    let id; let token; let c; let csrf;
    const session = async () => {
      const client = h.client(app.base);
      assert.equal((await client.get(`/patrocinador/${token}/cadastro`)).status, 302);
      return client;
    };
    const csrfFrom = (html) => html.match(/data-csrf="([a-f0-9]+)"/)?.[1];
    const raw = (path, body, type, { withCsrf = true, client = c, token: t = csrf, origin } = {}) => fetch(`${app.base}${path}`, {
      method: 'POST', headers: { 'content-type': type, cookie: client.cookie(), ...(withCsrf ? { 'x-csrf-token': t } : {}), ...(origin ? { origin } : {}) }, body,
    });

    before(async () => {
      id = await create({ company: 'Rede Vida Saúde', tier: 'ouro', value: '6000', contact_name: 'Marta Lima', contact_email: 'marta@vida.com' });
      token = await tokenOf(id);
      c = await session();
    });

    it('antes de Ganho o formulário não abre (nem logo, nem voz)', async () => {
      const r = await c.get('/patrocinador/cadastro');
      assert.equal(r.status, 403);
      assert.match(r.text, /Formulário ainda não liberado/);
      assert.equal((await raw('/patrocinador/logo', fakePng(), 'image/png', { token: 'qualquer' })).status, 403, 'sem CSRF válido');
    });

    it('em Ganho o formulário abre com as 8 perguntas, CSRF e o botão de voz', async () => {
      assert.equal((await move(id, 'ganho')).status, 200);
      const r = await c.get('/patrocinador/cadastro');
      assert.equal(r.status, 200);
      for (const q of ['Logo da marca', 'página para a gente divulgar', 'Oferta ou ação especial', 'apresente a empresa', 'Principais pontos', 'Restrições de comunicação', 'Slogan', 'principal objetivo']) {
        assert.match(r.text, new RegExp(q), q);
      }
      assert.equal((r.text.match(/data-voice-toggle/g) || []).length, 4, 'voz nas 4 perguntas de texto corrido');
      assert.match(r.text, /Marta, vamos/);
      assert.doesNotMatch(r.text, new RegExp(token), 'sem o token na página');
      csrf = csrfFrom(r.text);
      assert.match(csrf, /^[a-f0-9]{64}$/);
      assert.match(r.text, /action="\/patrocinador\/cadastro"/);
      const csp = r.headers.get('content-security-policy');
      assert.match(csp, /script-src 'self'/);
      assert.doesNotMatch(csp, /unsafe-inline/);
      assert.match(csp, /connect-src 'self'/);
      assert.match(r.headers.get('permissions-policy'), /microphone=\(self\)/);
      assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
      assert.doesNotMatch(r.text, /<script>/, 'sem script inline');
    });

    it('ações exigem o token CSRF da sessão: sem ele, ou com o de outra sessão, é 403', async () => {
      assert.equal((await raw('/patrocinador/logo', fakePng(), 'image/png', { withCsrf: false })).status, 403);
      const other = await session();
      const otherCsrf = csrfFrom((await other.get('/patrocinador/cadastro')).text);
      assert.notEqual(otherCsrf, csrf, 'cada sessão tem o seu');
      assert.equal((await raw('/patrocinador/logo', fakePng(), 'image/png', { token: otherCsrf })).status, 403);
      assert.equal((await raw('/patrocinador/audio?campo=offer', Buffer.alloc(900), 'audio/webm', { withCsrf: false })).status, 403);
      assert.equal((await c.post('/patrocinador/cadastro', { offer: 'sem csrf' })).status, 403);
      assert.equal((await fetch(`${app.base}/patrocinador/logo`, { method: 'POST', headers: { 'content-type': 'image/png', 'x-csrf-token': csrf }, body: fakePng() })).status, 401, 'sem cookie');
    });

    it('logo: só PNG; guarda no bucket com o prefixo da chave, avisa se não tem transparência e troca a anterior', async () => {
      const bad = await raw('/patrocinador/logo', Buffer.from('não sou png '.repeat(20)), 'image/png');
      assert.equal(bad.status, 400);
      assert.match((await bad.json()).error, /PNG/);

      const ok = await raw('/patrocinador/logo?nome=logo-vida.png', fakePng(), 'image/png');
      assert.equal(ok.status, 200);
      const first = await ok.json();
      assert.equal(first.hasAlpha, true);
      assert.equal(first.url, `/patrocinador/arquivo/${first.id}`, 'URL limpa, sem token');
      const f1 = (await h.db.query('SELECT * FROM sponsor_files WHERE id=$1', [first.id])).rows[0];
      assert.equal(f1.kind, 'logo');
      assert.equal(f1.from_sponsor, true);
      assert.match(f1.storage_key, new RegExp(`^pp/patrocinadores/${id}/logo-[0-9a-f]{16}\\.png$`));
      assert.ok(h.b2Store.get(f1.storage_key).body.equals(fakePng()));
      assert.equal(h.b2Store.get(f1.storage_key).contentType, 'image/png');

      const second = await (await raw('/patrocinador/logo', fakePng({ colorType: 2 }), 'image/png')).json();
      assert.equal(second.hasAlpha, false, 'cor tipo 2 (RGB) não tem transparência');
      assert.equal((await h.db.query("SELECT count(*)::int n FROM sponsor_files WHERE sponsor_id=$1 AND kind='logo'", [id])).rows[0].n, 1);
      assert.equal(h.b2Store.has(f1.storage_key), false, 'a logo anterior foi apagada do bucket');

      const view = await c.get(second.url);
      assert.equal(view.status, 200);
      assert.equal(view.headers.get('content-type'), 'image/png');
      assert.equal(view.headers.get('x-content-type-options'), 'nosniff');
      assert.equal((await as.prod.get(`/patrocinadores/${id}/arquivos/${second.id}`)).status, 200);
      assert.equal((await anon().get(`/patrocinadores/${id}/arquivos/${second.id}`)).status, 302, 'painel exige login');
      assert.equal((await anon().get(second.url)).status, 401, 'sem sessão não vê o arquivo');
    });

    it('voz: guarda o áudio, transcreve com Whisper large-v3 em português e devolve o texto para revisar', async () => {
      h.groqCalls.length = 0;
      const r = await raw('/patrocinador/audio?campo=offer', Buffer.alloc(2000, 3), 'audio/webm;codecs=opus');
      assert.equal(r.status, 200);
      const json = await r.json();
      assert.equal(json.text, 'texto transcrito de teste');
      assert.equal(h.groqCalls.length, 1);
      assert.equal(h.groqCalls[0].model, 'whisper-large-v3');
      assert.equal(h.groqCalls[0].language, 'pt');
      assert.equal(h.groqCalls[0].auth, 'Bearer test-groq-key');
      assert.equal(h.groqCalls[0].file.size, 2000);
      const f = (await h.db.query('SELECT * FROM sponsor_files WHERE id=$1', [json.id])).rows[0];
      assert.equal(f.kind, 'audio');
      assert.equal(f.field, 'offer');
      assert.equal(f.transcript, 'texto transcrito de teste');
      assert.match(f.storage_key, /\.webm$/);
      assert.equal(h.b2Store.get(f.storage_key).body.length, 2000);
      assert.equal((await c.get(`/patrocinador/arquivo/${f.id}`)).status, 404, 'o áudio não é servido na área pública');
    });

    it('voz: campo inválido, formato errado, áudio vazio e falha da Groq (o áudio fica guardado)', async () => {
      assert.equal((await raw('/patrocinador/audio?campo=slogan', Buffer.alloc(900), 'audio/webm')).status, 400);
      assert.equal((await raw('/patrocinador/audio?campo=offer', Buffer.alloc(900), 'text/plain')).status, 400);
      assert.equal((await raw('/patrocinador/audio?campo=offer', Buffer.alloc(10), 'audio/webm')).status, 400);
      h.setGroqFail(true);
      try {
        const r = await raw('/patrocinador/audio?campo=presentation', Buffer.alloc(900, 1), 'audio/mp4');
        assert.equal(r.status, 502);
        const json = await r.json();
        assert.match(json.error, /não conseguimos transcrever/);
        assert.ok(json.id, 'devolve o id do áudio guardado');
        assert.equal((await h.db.query('SELECT transcript FROM sponsor_files WHERE id=$1', [json.id])).rows[0].transcript, null);
      } finally { h.setGroqFail(false); }
    });

    it('enviar o formulário grava o briefing no cadastro, avisa a equipe e pode ser reenviado', async () => {
      h.mailer.outbox.length = 0;
      const r = await c.post('/patrocinador/cadastro', {
        _csrf: csrf, landing_url: 'https://vida.com.br/pulso', landing_perk: 'Check-up grátis', offer: 'Diagnóstico gratuito de 30 min', presentation: 'Somos a Rede Vida',
        key_points: 'Atendimento humanizado', restrictions: 'Não prometer cura', slogan: 'Cuidar é nosso ritmo', goal: 'leads', goal_other: '',
      });
      assert.equal(r.status, 303);
      assert.equal(r.location, '/patrocinador/cadastro?enviado=1');
      const brief = (await h.db.query('SELECT * FROM sponsor_briefs WHERE sponsor_id=$1', [id])).rows[0];
      assert.equal(brief.offer, 'Diagnóstico gratuito de 30 min');
      assert.equal(brief.goal, 'leads');
      assert.equal(brief.landing_url, 'https://vida.com.br/pulso');
      assert.ok((await sponsor(id)).brief_completed_at);
      assert.match(lastMail().subject, /Rede Vida Saúde respondeu o formulário/);

      const again = (await c.get(r.location)).text;
      assert.match(again, /Recebemos suas respostas/);
      assert.match(again, /Diagnóstico gratuito de 30 min/, 'volta preenchido para editar');
      assert.match(again, /value="leads" checked/);

      h.mailer.outbox.length = 0;
      await c.post('/patrocinador/cadastro', { _csrf: csrf, offer: 'Outra oferta', goal: 'autoridade' });
      assert.equal(h.mailer.outbox.length, 1, 'a situação mudou (voltou a ter perguntas em aberto): a equipe é avisada uma vez');
      assert.match(lastMail().subject, /respondeu parte do formulário/);
      assert.equal((await h.db.query('SELECT offer FROM sponsor_briefs WHERE sponsor_id=$1', [id])).rows[0].offer, 'Outra oferta');
    });

    it('o navegador envia "Origin: null" (Referrer-Policy: no-referrer): com sessão e CSRF passa; o painel segue protegido', async () => {
      const nul = { origin: 'null' };
      assert.equal((await c.post('/patrocinador/cadastro', { _csrf: csrf, offer: 'Oferta via navegador' }, { headers: nul })).status, 303);
      assert.equal((await raw('/patrocinador/logo', fakePng(), 'image/png', { origin: 'null' })).status, 200);
      assert.equal((await raw('/patrocinador/audio?campo=offer', Buffer.alloc(900), 'audio/webm', { origin: 'null' })).status, 200);
      assert.equal((await c.post('/patrocinador/cadastro', { offer: 'sem csrf' }, { headers: nul })).status, 403, 'null sem CSRF não passa');
      const panelCsrf = await as.prod.csrf('/perfil');
      assert.equal((await as.prod.post('/perfil', { _csrf: panelCsrf, name: 'X Y' }, { headers: nul })).status, 403, 'painel recusa Origin: null');
      assert.equal((await as.prod.post(`/patrocinadores/${id}/etapa`, { _csrf: panelCsrf, status: 'ganho' }, { headers: nul })).status, 403);
      assert.equal((await c.post('/patrocinador/cadastro', { _csrf: csrf, offer: 'x' }, { headers: { origin: 'https://evil.example' } })).status, 403, 'origem externa explícita barrada');
    });

    it('link inválido, objetivo inventado e texto com HTML são tratados', async () => {
      const bad = await c.post('/patrocinador/cadastro', { _csrf: csrf, landing_url: 'javascript:alert(1)' });
      assert.equal(bad.status, 400);
      assert.match(bad.text, /não parece válido/);
      await c.post('/patrocinador/cadastro', { _csrf: csrf, goal: 'dominar-o-mundo', offer: '<img src=x onerror=alert(1)>' });
      assert.equal((await h.db.query('SELECT goal FROM sponsor_briefs WHERE sponsor_id=$1', [id])).rows[0].goal, null);
      const page = (await c.get('/patrocinador/cadastro')).text;
      assert.doesNotMatch(page, /<img src=x/);
      assert.match(page, /&lt;img src=x/);
    });

    it('a equipe vê as respostas, a logo, as gravações com a transcrição original e pode editar o briefing', async () => {
      await c.post('/patrocinador/cadastro', { _csrf: csrf, offer: 'Diagnóstico gratuito', presentation: 'Somos a Rede Vida', slogan: 'Cuidar é nosso ritmo', goal: 'leads' });
      const page = (await as.prod.get(`/patrocinadores/${id}`)).text;
      assert.match(page, /Diagnóstico gratuito/);
      assert.match(page, /Cuidar é nosso ritmo/);
      assert.match(page, /Gerar leads/);
      assert.match(page, /class="logo-preview"/);
      assert.match(page, /<audio controls/);
      assert.match(page, /Transcrição original/);
      assert.match(page, /texto transcrito de teste/);
      const edit = await as.prod.act(`/patrocinadores/${id}/briefing`, { offer: 'Oferta ajustada pela equipe', goal: 'vendas' }, { from: `/patrocinadores/${id}/briefing` });
      assert.equal(edit.status, 302);
      assert.equal((await h.db.query('SELECT offer FROM sponsor_briefs WHERE sponsor_id=$1', [id])).rows[0].offer, 'Oferta ajustada pela equipe');
      assert.equal((await as.prod.get(`/patrocinadores/${id}/briefing`)).status, 200);
      assert.equal((await as.prod.act(`/patrocinadores/${id}/briefing`, { landing_url: 'ftp://x' }, { from: `/patrocinadores/${id}/briefing` })).status, 400);
    });
  });

  describe('formulário em etapas: uma pergunta por vez, com pendências', () => {
    let id; let c; let csrf; let token;
    const answer = async (pergunta, acao, valores = {}, client = c, t = csrf) => {
      const r = await fetch(`${app.base}/patrocinador/resposta`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: client.cookie(), 'x-csrf-token': t }, body: JSON.stringify({ pergunta, acao, valores }) });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    const conclude = async () => {
      const r = await fetch(`${app.base}/patrocinador/concluir`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: c.cookie(), 'x-csrf-token': csrf }, body: '{}' });
      return { status: r.status, json: await r.json() };
    };
    const states = async () => (await h.db.query('SELECT * FROM sponsor_briefs WHERE sponsor_id=$1', [id])).rows[0];
    const page = async () => (await c.get('/patrocinador/cadastro')).text;

    before(async () => {
      id = await create({ company: 'Instituto Aurora', tier: 'diamond', value: '9000', contact_name: 'Paulo Reis', contact_email: 'paulo@aurora.com' });
      token = await tokenOf(id);
      await move(id, 'ganho');
      c = h.client(app.base);
      await c.get(`/patrocinador/${token}/cadastro`);
      csrf = (await page()).match(/data-csrf="([a-f0-9]+)"/)[1];
    });

    it('a página mostra as 8 etapas com o estado de cada uma, os botões de cada pergunta e começa na primeira em aberto', async () => {
      const html = await page();
      assert.equal((html.match(/data-step="/g) || []).length, 8);
      assert.match(html, /data-start="logo"/);
      assert.equal((html.match(/data-act="responder"/g) || []).length, 8, 'um "Salvar e continuar" por pergunta');
      assert.equal((html.match(/data-act="pular"/g) || []).length, 5, 'cinco perguntas podem ficar para depois');
      assert.match(html, /Responder depois/);
      for (const na of ['Não temos uma página', 'Preferimos só apresentar a empresa', 'Não há restrições', 'Não temos slogan']) assert.match(html, new RegExp(na), na);
      assert.match(html, /pendente \(você escolheu responder depois\)/, 'legenda da representação visual');
      assert.match(html, /data-q="resumo"/);
      assert.match(html, /data-nojs-submit/, 'sem JavaScript continua dando para enviar a página inteira');
      assert.doesNotMatch(html, /<script>/);
    });

    it('proteções: sem CSRF ou sessão não grava; pergunta ou ação desconhecida e perguntas obrigatórias são recusadas', async () => {
      assert.equal((await fetch(`${app.base}/patrocinador/resposta`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: c.cookie() }, body: '{}' })).status, 403);
      assert.equal((await fetch(`${app.base}/patrocinador/resposta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
      assert.equal((await answer('inventada', 'responder')).status, 422);
      assert.equal((await answer('offer', 'voar')).status, 422);
      const mustNow = await answer('restrictions', 'pular');
      assert.equal(mustNow.status, 422); assert.match(mustNow.json.error, /precisa ser respondida agora/);
      const noNa = await answer('key_points', 'nao_se_aplica');
      assert.equal(noNa.status, 422); assert.match(noNa.json.error, /não aceita/);
    });

    it('resposta vazia é recusada com a saída certa para cada pergunta', async () => {
      assert.match((await answer('offer', 'responder', { offer: '   ' })).json.error, /Responder depois/);
      assert.match((await answer('restrictions', 'responder', { restrictions: '' })).json.error, /Não há restrições/);
      assert.match((await answer('goal', 'responder', { goal: 'dominar-o-mundo' })).json.error, /Escolha o objetivo/);
      assert.match((await answer('landing', 'responder', { landing_url: 'javascript:alert(1)' })).json.error, /não parece válido/);
      assert.match((await answer('landing', 'responder', {})).json.error, /Cole o link/);
      assert.match((await answer('logo', 'responder')).json.error, /Envie a logo/);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM sponsor_briefs WHERE sponsor_id=$1 AND offer IS NOT NULL', [id])).rows[0].n, 0);
    });

    it('"responder depois" vira pendência e fica guardada; responder depois tira da pendência', async () => {
      const r = await answer('offer', 'pular');
      assert.equal(r.status, 200); assert.equal(r.json.states.offer, 'pendente'); assert.equal(r.json.pending, 1);
      assert.equal((await answer('presentation', 'pular')).json.pending, 2);
      assert.deepEqual((await states()).skipped.sort(), ['offer', 'presentation']);
      const html = await page();
      assert.match(html, /class="st-pendente" data-step="offer"/, 'a etapa aparece como pendente');
      assert.match(html, /data-start="logo"/, 'continua na primeira ainda em aberto (a logo), não nas puladas');
      const back = await answer('offer', 'responder', { offer: 'Diagnóstico gratuito' });
      assert.equal(back.json.states.offer, 'respondida'); assert.equal(back.json.pending, 1);
      assert.deepEqual((await states()).skipped, ['presentation']);
      assert.equal((await states()).offer, 'Diagnóstico gratuito');
      assert.match(await page(), /Diagnóstico gratuito/, 'volta preenchido');
    });

    it('"não se aplica" conta como respondida (e guarda vazio); página só com brinde também vale', async () => {
      assert.equal((await answer('slogan', 'nao_se_aplica')).json.states.slogan, 'nao_se_aplica');
      assert.equal((await answer('restrictions', 'nao_se_aplica')).json.states.restrictions, 'nao_se_aplica');
      const landing = await answer('landing', 'responder', { landing_url: '', landing_perk: 'Check-up grátis' });
      assert.equal(landing.json.states.landing, 'respondida');
      assert.equal((await states()).landing_perk, 'Check-up grátis');
      const sloganThen = await answer('slogan', 'responder', { slogan: 'Cuidar é nosso ritmo' });
      assert.equal(sloganThen.json.states.slogan, 'respondida');
      assert.deepEqual((await states()).na.sort(), ['restrictions'], 'responder tira o "não se aplica"');
    });

    it('fechar o formulário com pendências avisa a equipe (uma vez por situação) e a equipe vê as pendências com destaque', async () => {
      await answer('key_points', 'pular');
      h.mailer.outbox.length = 0;
      const first = await conclude();
      assert.equal(first.json.complete, false);
      assert.equal(first.json.answered, 4); assert.equal(first.json.pending, 2); assert.equal(first.json.open, 2, 'logo e objetivo ainda não vistas');
      assert.equal(h.mailer.outbox.length, 1);
      assert.match(lastMail().subject, /Instituto Aurora respondeu parte do formulário/);
      assert.match(lastMail().text || lastMail().html || '', /Pendências: /);
      await conclude();
      assert.equal(h.mailer.outbox.length, 1, 'mesmo resumo: sem novo aviso');
      const ev = (await h.db.query("SELECT message FROM sponsor_events WHERE sponsor_id=$1 AND type='briefing' ORDER BY id DESC LIMIT 1", [id])).rows[0].message;
      assert.match(ev, /Fechou o formulário com 4 de 8 respondidas\. Faltam: /);
      assert.equal((await sponsor(id)).brief_completed_at, null, 'ainda não está completo');

      const show = (await as.prod.get(`/patrocinadores/${id}`)).text;
      assert.match(show, /fp-pendente/);
      assert.match(show, /4 de 8 respondidas/);
      assert.match(show, /pendentes: Apresentação, Destaques/);
      assert.match((await as.prod.get('/patrocinadores')).text, /2 pendências/, 'o quadro mostra quantas pendências o patrocinador deixou');
    });

    it('responder as pendências e o resto completa o formulário: marca como respondido e avisa a equipe', async () => {
      h.mailer.outbox.length = 0;
      assert.equal((await answer('presentation', 'responder', { presentation: 'Somos o Instituto Aurora' })).json.complete, false);
      assert.equal((await answer('key_points', 'responder', { key_points: 'Cuidado humanizado' })).json.pending, 0);
      assert.equal((await answer('goal', 'responder', { goal: 'autoridade', goal_other: '' })).json.complete, false, 'falta a logo');
      const up = await fetch(`${app.base}/patrocinador/logo?nome=logo.png`, { method: 'POST', headers: { 'content-type': 'image/png', cookie: c.cookie(), 'x-csrf-token': csrf }, body: fakePng() });
      assert.equal(up.status, 200);
      const done = (await states());
      assert.ok((await sponsor(id)).brief_completed_at, 'a logo fechou o formulário');
      const fin = await conclude();
      assert.equal(fin.json.complete, true); assert.equal(fin.json.pending, 0);
      assert.match(lastMail().subject, /Instituto Aurora respondeu o formulário/);
      assert.match((await h.db.query("SELECT message FROM sponsor_events WHERE sponsor_id=$1 AND type='briefing' ORDER BY id DESC LIMIT 1", [id])).rows[0].message, /Respondeu todas as perguntas/);
      assert.match((await as.prod.get('/patrocinadores')).text, /briefing/);
      assert.equal(done.skipped.length, 0);
    });

    it('a equipe preencher um campo pendente pelo painel tira a pergunta das pendências', async () => {
      const other = await create({ company: 'Rede Sol', tier: 'ouro', value: '6000', contact_name: 'Ana Sol', contact_email: 'ana@sol.com' });
      const t2 = await tokenOf(other);
      await move(other, 'ganho');
      const c2 = h.client(app.base); await c2.get(`/patrocinador/${t2}/cadastro`);
      const csrf2 = (await c2.get('/patrocinador/cadastro')).text.match(/data-csrf="([a-f0-9]+)"/)[1];
      assert.equal((await answer('offer', 'pular', {}, c2, csrf2)).json.states.offer, 'pendente');
      assert.equal((await as.prod.act(`/patrocinadores/${other}/briefing`, { offer: 'Oferta colocada pela equipe' }, { from: `/patrocinadores/${other}/briefing` })).status, 302);
      const row = (await h.db.query('SELECT * FROM sponsor_briefs WHERE sponsor_id=$1', [other])).rows[0];
      assert.deepEqual(row.skipped, []);
      assert.equal((await answer('offer', 'responder', { offer: 'x' }, c, csrf)).status, 200, 'cada sessão só mexe no próprio patrocinador');
      assert.equal((await h.db.query('SELECT offer FROM sponsor_briefs WHERE sponsor_id=$1', [other])).rows[0].offer, 'Oferta colocada pela equipe');
    });

    it('o navegador manda "Origin: null" (a página usa Referrer-Policy: no-referrer): resposta e fechamento aceitam, com CSRF', async () => {
      const r = await fetch(`${app.base}/patrocinador/resposta`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'null', cookie: c.cookie(), 'x-csrf-token': csrf }, body: JSON.stringify({ pergunta: 'slogan', acao: 'responder', valores: { slogan: 'Cuidar é nosso ritmo' } }) });
      assert.equal(r.status, 200);
      const done = await fetch(`${app.base}/patrocinador/concluir`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'null', cookie: c.cookie(), 'x-csrf-token': csrf }, body: '{}' });
      assert.equal(done.status, 200);
      const evil = await fetch(`${app.base}/patrocinador/resposta`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: c.cookie(), 'x-csrf-token': csrf }, body: '{}' });
      assert.equal(evil.status, 403);
    });

    it('antes de Ganho não grava nada', async () => {
      const early = await create({ company: 'Cedo Demais' });
      const te = await tokenOf(early);
      const ce = h.client(app.base); await ce.get(`/patrocinador/${te}/cadastro`);
      const r = await fetch(`${app.base}/patrocinador/resposta`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: ce.cookie(), 'x-csrf-token': 'x' }, body: JSON.stringify({ pergunta: 'offer', acao: 'pular' }) });
      assert.equal(r.status, 403);
    });
  });

  describe('episódios, entregáveis, arquivos e portal do patrocinador ativo', () => {
    let id; let token; let ep1; let ep3;
    const rawStaff = (path, body, type, who = 'prod', csrf = true) => as[who].csrf('/patrocinadores').then((t) => fetch(`${app.base}${path}`, {
      method: 'POST', headers: { 'content-type': type, cookie: cookieOf(as[who]), ...(csrf ? { 'x-csrf-token': t } : {}) }, body,
    }));
    const cookieOf = (client) => client.cookie();
    let agendaGuest;
    it('episódio gravado (número único, origem obrigatória) e uma gravação marcada na agenda', async () => {
      await h.db.query("INSERT INTO guests (name, instagram, profile, bio, positioning) VALUES ('Dr. José Bento', 'josebento', 'medico', 'Ginecologista e obstetra com 40 anos de atuação.', 'Referência em saúde da mulher')");
      const { rows: [g] } = await h.db.query("SELECT id FROM guests WHERE instagram='josebento'");
      const { rows: [g3] } = await h.db.query("INSERT INTO guests (name, instagram, profile) VALUES ('Sem Número', 'semnumero', 'medico') RETURNING id");
      agendaGuest = (await h.db.query("INSERT INTO guests (name, instagram, profile, status, proposed_at, scheduled_studio, scheduled_hosts, scheduled_guest) VALUES ('Dra. Agenda', 'dra.agenda', 'medico', 'agendado', '2026-10-23 10:00-03', true, true, true) RETURNING id")).rows[0].id;
      const mk = async (fields) => {
        const r = await as.prod.act('/episodios', fields, { from: '/episodios/novo' });
        assert.equal(r.status, 302, r.text.slice(0, 200));
        return (await h.db.query('SELECT id FROM episodes WHERE title = $1', [fields.title])).rows[0].id;
      };
      ep1 = await mk({ origem: 'convidado', number: '12', title: 'Conversa com José Bento', aired_on: '2026-10-30', guest_id: String(g.id) });
      ep3 = await mk({ origem: 'convidado', title: 'Sem número ainda', guest_id: String(g3.id) });
      const dup = await as.prod.act('/episodios', { number: '12', title: 'Repetido' }, { from: '/episodios/novo' });
      assert.equal(dup.status, 400);
      assert.match(dup.text, /Já existe o episódio 012/);
      assert.equal((await as.prod.act('/episodios', { title: 'X' }, { from: '/episodios/novo' })).status, 400);
      assert.equal((await as.prod.act('/episodios', { title: 'Data ruim', aired_on: '2026-13-01' }, { from: '/episodios/novo' })).status, 400);
      const list = (await as.editor.get('/episodios')).text;
      assert.match(list, /Conversa com José Bento/);
      assert.match(list, /Dr\. José Bento/);
      assert.doesNotMatch(list, /Dra\. Agenda/, 'gravação marcada ainda não é episódio');
      assert.equal((await as.editor.get('/episodios/novo')).status, 403);
      assert.equal((await as.prod.act(`/episodios/${ep3}`, { title: 'Sem número (editado)', number: '14' }, { from: '/episodios' })).status, 302);
      assert.equal((await as.prod.act(`/episodios/${ep3}/excluir`, {}, { from: '/episodios' })).status, 403, 'produtora não exclui');
    });

    it('prepara o patrocinador ativo: episódios (exclusivo e inserção), entregáveis e arquivos', async () => {
      id = await create({ company: 'America Licenciamentos', kind: 'negocio', tier: 'diamond', value: '15000', contact_name: 'Ricardo Nascimento', contact_email: 'ricardo@america.com' });
      token = await tokenOf(id);
      assert.equal((await move(id, 'ganho')).status, 200);

      const before = (await as.prod.get(`/patrocinadores/${id}`)).text;
      assert.match(before, /Dra\. Agenda/, 'a agenda aparece para reservar');
      const eps = await as.prod.act(`/patrocinadores/${id}/episodios`, { [`booking_${agendaGuest}`]: 'exclusivo', [`role_${ep1}`]: 'insercao', [`role_${ep3}`]: '', role_999999: 'insercao', booking_999999: 'insercao' }, { from: `/patrocinadores/${id}` });
      assert.equal(eps.status, 302);
      const { rows: linked } = await h.db.query('SELECT episode_id, role FROM sponsor_episodes WHERE sponsor_id=$1 ORDER BY episode_id', [id]);
      assert.deepEqual(linked, [{ episode_id: ep1, role: 'insercao' }], 'episódio inexistente e "fora" não entram');
      const { rows: booked } = await h.db.query('SELECT guest_id, role FROM sponsor_bookings WHERE sponsor_id=$1', [id]);
      assert.deepEqual(booked, [{ guest_id: agendaGuest, role: 'exclusivo' }], 'a gravação marcada fica reservada');

      const add = (fields) => as.prod.act(`/patrocinadores/${id}/entregaveis`, fields, { from: `/patrocinadores/${id}` });
      assert.equal((await h.db.query('SELECT count(*)::int n FROM sponsor_deliverables WHERE sponsor_id=$1 AND plan_item_id IS NOT NULL', [id])).rows[0].n, 8, 'a cota Diamond traz os 6 do Ouro + 2 próprios');
      const { rows: [qrd] } = await h.db.query("SELECT id FROM sponsor_deliverables WHERE sponsor_id=$1 AND kind='qr_code'", [id]);
      await as.prod.act(`/patrocinadores/${id}/entregaveis/${qrd.id}`, { title: 'QR Code na tela', quantity: '', status: 'pendente', link_url: 'https://america.com.br/pulso' }, { from: `/patrocinadores/${id}` });
      await add({ title: 'Ativação no evento de lançamento', quantity: '2', status: 'em_producao' });
      await add({ kind: 'invalido' });
      await add({});
      assert.equal((await h.db.query('SELECT count(*)::int n FROM sponsor_deliverables WHERE sponsor_id=$1', [id])).rows[0].n, 9, 'o personalizado entra; inválido e vazio não');

      const up = async (tipo, buf, type, nome) => (await rawStaff(`/patrocinadores/${id}/arquivo?tipo=${tipo}&nome=${nome}`, buf, type)).json();
      const m = await up('moldura', fakePng(), 'image/png', 'moldura.png');
      const q = await up('qrcode', fakePng(), 'image/png', 'qr.png');
      assert.ok(m.ok && q.ok);
      const { rows: d } = await h.db.query("SELECT kind, file_id FROM sponsor_deliverables WHERE sponsor_id=$1 AND kind IN ('moldura','qr_code') ORDER BY kind", [id]);
      assert.deepEqual(d, [{ kind: 'moldura', file_id: m.id }, { kind: 'qr_code', file_id: q.id }], 'o arquivo já vai para o entregável certo');
      const mat = await up('material', Buffer.from('%PDF-1.4 teste'), 'application/pdf', 'contrato.pdf');
      assert.ok(mat.ok);
      assert.equal((await h.db.query("SELECT count(*)::int n FROM sponsor_files WHERE sponsor_id=$1 AND kind='material'", [id])).rows[0].n, 1);

      const page = (await as.prod.get(`/patrocinadores/${id}`)).text;
      assert.match(page, /Presença nos cortes/);
      assert.match(page, /Ativação no evento de lançamento/);
      assert.match(page, /contrato\.pdf/);
      assert.match(page, /Conversa com José Bento/);
    });

    it('envio de arquivo pela equipe exige login, CSRF, tipo válido e imagem nos tipos de imagem', async () => {
      assert.equal((await fetch(`${app.base}/patrocinadores/${id}/arquivo?tipo=moldura`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: fakePng(), redirect: 'manual' })).status, 401, 'anônimo não envia');
      assert.equal((await rawStaff(`/patrocinadores/${id}/arquivo?tipo=moldura`, fakePng(), 'image/png', 'prod', false)).status, 403, 'sem CSRF');
      assert.equal((await rawStaff(`/patrocinadores/${id}/arquivo?tipo=moldura`, fakePng(), 'image/png', 'editor')).status, 403, 'editor não envia');
      assert.equal((await rawStaff(`/patrocinadores/${id}/arquivo?tipo=logo`, fakePng(), 'image/png')).status, 400, 'tipo fora da lista');
      assert.equal((await rawStaff(`/patrocinadores/${id}/arquivo?tipo=moldura`, Buffer.from('texto'), 'text/plain')).status, 400, 'moldura precisa ser imagem');
      assert.equal((await rawStaff(`/patrocinadores/${id}/arquivo?tipo=moldura`, Buffer.alloc(0), 'image/png')).status, 400, 'vazio');
    });

    it('atualizar e remover entregável; link inválido é recusado', async () => {
      const { rows: [d] } = await h.db.query("SELECT id FROM sponsor_deliverables WHERE sponsor_id=$1 AND kind='insercao'", [id]);
      await as.prod.act(`/patrocinadores/${id}/entregaveis/${d.id}`, { status: 'ativo', quantity: '4', link_url: 'https://youtu.be/x', notes: 'No ar' }, { from: `/patrocinadores/${id}` });
      assert.deepEqual((await h.db.query('SELECT status, notes FROM sponsor_deliverables WHERE id=$1', [d.id])).rows[0], { status: 'ativo', notes: 'No ar' });
      await as.prod.act(`/patrocinadores/${id}/entregaveis/${d.id}`, { status: 'concluido', link_url: 'javascript:alert(1)' }, { from: `/patrocinadores/${id}` });
      assert.equal((await h.db.query('SELECT status FROM sponsor_deliverables WHERE id=$1', [d.id])).rows[0].status, 'ativo', 'link inválido não altera');
      const { rows: [tmp] } = await h.db.query("INSERT INTO sponsor_deliverables (sponsor_id, kind) VALUES ($1,'presenca_plataformas') RETURNING id", [id]);
      await as.prod.act(`/patrocinadores/${id}/entregaveis/${tmp.id}/excluir`, {}, { from: `/patrocinadores/${id}` });
      assert.equal((await h.db.query('SELECT 1 FROM sponsor_deliverables WHERE id=$1', [tmp.id])).rowCount, 0);
    });

    it('portal só abre quando o patrocínio está ativo', async () => {
      const c = h.client(app.base);
      assert.equal((await c.get(`/patrocinador/${token}/portal`)).status, 302);
      const before = await c.get('/patrocinador/portal');
      assert.equal(before.status, 403);
      assert.match(before.text, /Portal ainda não disponível/);
      const activate = await move(id, 'ativo');
      assert.equal(activate.status, 422, 'falta a data do pagamento');
      assert.equal((await as.prod.act(`/patrocinadores/${id}`, sponsorFields({
        company: 'America Licenciamentos', kind: 'negocio', tier: 'diamond', value: '15000', contact_name: 'Ricardo Nascimento', contact_email: 'ricardo@america.com',
        stage: 'ativo', paid_at: '2026-10-05', starts_on: '2026-10-09', ends_on: '2026-11-06',
      }), { from: `/patrocinadores/${id}/editar` })).status, 302);
    });

    it('portal ativo: entregas, episódio exclusivo, calendário, convidados, moldura e QR Code — sem script e sem emoji', async () => {
      const pc = h.client(app.base);
      assert.equal((await pc.get(`/patrocinador/${token}/portal`)).location, '/patrocinador/portal');
      const r = await pc.get('/patrocinador/portal');
      assert.equal(r.status, 200);
      const t = r.text;
      assert.doesNotMatch(t, new RegExp(token), 'sem o token na página');
      assert.match(t, /Portal do Patrocinador/);
      assert.match(t, /America Licenciamentos · Responsável Ricardo Nascimento/);
      assert.match(t, /Patrocínio Diamond/);
      assert.match(t, /1 episódio exclusivo \+ inserção em 1 episódio/);
      assert.match(t, /Parceria em andamento/);
      assert.match(t, /parceria Diamond conduzida por Ricardo Nascimento, ativa de 09\/10\/2026 até 06\/11\/2026/);
      assert.match(t, /<strong>02<\/strong> episódios/);
      for (const label of ['Episódio especial dedicado', 'Inserção nos episódios', 'Corte exclusivo', 'Presença nos cortes', 'Moldura de patrocinador', 'QR Code na tela', 'Ativação no evento de lançamento']) assert.match(t, new RegExp(label), label);
      assert.match(t, /Em produção/);
      assert.match(t, /23 de outubro de 2026/);
      assert.match(t, /inteiramente dedicado à America Licenciamentos/);
      assert.match(t, /Gravação marcada · episódio exclusivo/, 'a reserva aparece como gravação marcada');
      assert.match(t, /Dra\. Agenda/);
      assert.match(t, /<div class="cal-date">23\/10<\/div>/);
      assert.match(t, /<div class="cal-date">30\/10<\/div>/);
      assert.match(t, /Exclusivo/);
      assert.match(t, /@josebento →/);
      assert.match(t, /Ginecologista e obstetra com 40 anos/);
      assert.match(t, /<details class="guest-item">/);
      assert.match(t, /moldura · bloco lateral fixo/);
      assert.match(t, /inserção · card com QR Code/);
      assert.match(t, /O QR Code leva direto para o link de destino/);
      assert.doesNotMatch(t, /<script/, 'portal sem JavaScript');
      assert.doesNotMatch(t, /fonts\.googleapis|gstatic/, 'fontes locais');
      assert.doesNotMatch(t, /[\u{1F300}-\u{1FAFF}]/u, 'sem emoji');
      const csp = r.headers.get('content-security-policy');
      assert.match(csp, /default-src 'none'/);
      assert.doesNotMatch(csp, /script-src/);
      assert.match(r.headers.get('x-robots-tag'), /noindex/);
      const imgs = [...t.matchAll(/src="(\/patrocinador\/arquivo\/\d+)"/g)].map((m) => m[1]);
      assert.equal(imgs.length, 2, 'moldura e QR Code');
      for (const src of imgs) assert.equal((await pc.get(src)).status, 200, src);
      for (const src of imgs) assert.equal((await anon().get(src)).status, 401, 'sem sessão não abre');
      const css = await fetch(`${app.base}/static/patrocinador.css`);
      assert.equal(css.status, 200);
      assert.match(await css.text(), /tier-ouro/);
    });

    it('foto do convidado no portal: calendário e lista de convidados usam a moldura 4:3 (endereço assinado); sem foto, as iniciais', async () => {
      const b2 = require('../src/services/b2');
      const key = await b2.keyFor('convidados', agendaGuest, 'foto-portal.jpg');
      await b2.putObject(key, Buffer.from('JPEGPORTAL'), 'image/jpeg');
      await h.db.query("UPDATE guests SET photo_key = $2 WHERE id = $1 OR instagram = 'josebento'", [agendaGuest, key]);
      const pc = h.client(app.base);
      await pc.get(`/patrocinador/${token}/portal`);
      const t = (await pc.get('/patrocinador/portal')).text;
      assert.match(t, /<img class="cal-photo" src="\/agenda\/foto\/\d+\?e=\d+&amp;s=[\w-]{32}" alt="Dra\. Agenda"/, 'calendário');
      assert.match(t, /<img class="guest-photo" src="\/agenda\/foto\/\d+\?e=\d+&amp;s=[\w-]{32}" alt="Dr\. José Bento"/, 'lista de convidados');
      const src = t.match(/class="cal-photo" src="([^"]+)"/)[1].replace(/&amp;/g, '&');
      const img = await fetch(app.base + src);
      assert.equal(img.status, 200); assert.equal(await img.text(), 'JPEGPORTAL');
      assert.match(await (await fetch(`${app.base}/static/patrocinador.css`)).text(), /\.guest-photo\{[^}]*aspect-ratio:4\/3/);
      await h.db.query("UPDATE guests SET photo_key = NULL WHERE id = $1 OR instagram = 'josebento'", [agendaGuest]);
      const bare = (await pc.get('/patrocinador/portal')).text;
      assert.doesNotMatch(bare, /class="cal-photo"|class="guest-photo"/);
      assert.match(bare, /class="guest-avatar"/);
      await b2.deleteObject(key).catch(() => {});
      forgetGuestPhotoCalls();
    });

    it('cota Ouro muda o tema e Inativo mostra "Parceria encerrada"; nome com HTML é escapado', async () => {
      await h.db.query("UPDATE sponsors SET tier='ouro', stage='inativo', company='Marca <b>Ouro</b>' WHERE id=$1", [id]);
      const pc = h.client(app.base);
      await pc.get(`/patrocinador/${token}/portal`);
      const t = (await pc.get('/patrocinador/portal')).text;
      assert.match(t, /<body class="tier-ouro">/);
      assert.match(t, /Parceria encerrada/);
      assert.match(t, /Marca &lt;b&gt;Ouro&lt;\/b&gt;/);
      assert.doesNotMatch(t, /<b>Ouro<\/b>/);
      await h.db.query("UPDATE sponsors SET tier='diamond', stage='ativo', company='America Licenciamentos' WHERE id=$1", [id]);
    });

    it('sem moldura/QR o portal avisa que está preparando', async () => {
      const bare = await create({ company: 'Marca Sem Arte', tier: 'ouro', value: '6000', contact_name: 'Zé', contact_phone: '1' });
      const t2 = await tokenOf(bare);
      await h.db.query("UPDATE sponsors SET stage='ativo', paid_at=CURRENT_DATE WHERE id=$1", [bare]);
      const bc = h.client(app.base);
      await bc.get(`/patrocinador/${t2}/portal`);
      const page = (await bc.get('/patrocinador/portal')).text;
      assert.match(page, /Estamos preparando a moldura e o QR Code/);
      assert.doesNotMatch(page, /Calendário/);
    });

    it('quando a gravação reservada acontece, a reserva vira o vínculo do episódio', async () => {
      const csrf = await as.prod.csrf('/convidados');
      const r = await as.prod.post(`/convidados/${agendaGuest}/status`, { status: 'gravado' }, { headers: { accept: 'application/json', 'x-csrf-token': csrf } });
      assert.equal(r.status, 200);
      const { rows: [e] } = await h.db.query('SELECT id FROM episodes WHERE guest_id=$1', [agendaGuest]);
      assert.deepEqual((await h.db.query('SELECT role FROM sponsor_episodes WHERE sponsor_id=$1 AND episode_id=$2', [id, e.id])).rows, [{ role: 'exclusivo' }]);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM sponsor_bookings WHERE guest_id=$1', [agendaGuest])).rows[0].n, 0);
    });

    it('excluir o patrocinador remove os arquivos do bucket; excluir o episódio o tira do portal', async () => {
      const { rows: keys } = await h.db.query('SELECT storage_key FROM sponsor_files WHERE sponsor_id=$1', [id]);
      assert.ok(keys.length >= 3);
      for (const k of keys) assert.ok(h.b2Store.has(k.storage_key), k.storage_key);

      assert.equal((await as.gestao.act(`/episodios/${ep1}/excluir`, {}, { from: '/episodios' })).status, 302);
      const ec = h.client(app.base);
      await ec.get(`/patrocinador/${token}/portal`);
      assert.doesNotMatch((await ec.get('/patrocinador/portal')).text, /Conversa com José Bento/);

      assert.equal((await as.gestao.act(`/patrocinadores/${id}/excluir`, {}, { from: '/patrocinadores' })).status, 302);
      assert.equal((await sponsor(id)), undefined);
      await h.emptyTrash();
      for (const k of keys) assert.equal(h.b2Store.has(k.storage_key), false, 'arquivo apagado do bucket');
      assert.equal((await anon().get(`/patrocinador/${token}/portal`)).status, 404, 'link morre junto');
      assert.equal((await ec.get('/patrocinador/portal')).status, 401, 'e a sessão também');
      assert.equal((await h.db.query('SELECT count(*)::int n FROM sponsor_sessions WHERE sponsor_id=$1', [id])).rows[0].n, 0);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM sponsor_files WHERE sponsor_id=$1', [id])).rows[0].n, 0);
    });
  });

  describe('integração com o Backblaze', () => {
    it('toda requisição ao bucket é assinada (SigV4), usa o prefixo da chave e nada fora do bucket é chamado', async () => {
      assert.ok(h.b2Calls.length > 5);
      for (const call of h.b2Calls) {
        assert.match(call.authorization, /^AWS4-HMAC-SHA256 Credential=test-key-id\//);
        assert.match(call.key, /^pp\/patrocinadores\/\d+\//);
        assert.match(call.payloadHash, /^[0-9a-f]{64}$/);
      }
      assert.ok(h.b2Calls.some((c) => c.method === 'PUT') && h.b2Calls.some((c) => c.method === 'GET') && h.b2Calls.some((c) => c.method === 'DELETE'));
    });

    it('a trava da suíte impede chamadas reais ao Backblaze e à Groq', async () => {
      await assert.rejects(() => fetch('https://s3.us-east-005.backblazeb2.com/Pulso-podcast/pp/x'), /Rede externa bloqueada/);
      await assert.rejects(() => fetch('https://api.groq.com/openai/v1/models'), /Rede externa bloqueada/);
    });
  });
});
