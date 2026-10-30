const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Plateia: página do convidado e link de parceiro isento', () => {
  const as = {}; let app; let anon; let g; let other; let partner;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);
  const days = (n) => new Date(Date.now() + n * 86400_000).toISOString();
  const mk = async (name, { status = 'agendado', at = days(10), enabled = true } = {}) =>
    (await one("INSERT INTO guests (name, status, proposed_at, topic, audience_enabled, email, scheduled_studio, scheduled_hosts, scheduled_guest) VALUES ($1,$2,$3,'Gestão de clínicas',$4,'a@b.com',true,true,true) RETURNING id", [name, status, at, enabled])).id;
  const signup = (body) => fetch(`${app.base}/plateia/inscricao`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (test)' }, body: JSON.stringify({ country: 'BR', terms: true, ...body }) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 2)]);
  const act = (who, path, form) => as[who].act(path, form, { from: `/convidados/${g}` });

  before(async () => {
    await h.resetDb(); app = await h.startServer(); anon = h.client(app.base);
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@pg.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@pg.com`); }
    g = await mk('Mari Vabo');
    other = await mk('Outro Convidado');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('a aba só aparece com plateia; desligada, ensina e ativa; ativa, cria o endereço pelo nome', async () => {
    let page = (await as.gestao.get(`/convidados/${g}`)).text;
    assert.match(page, /data-tab-btn="pagina"/);
    assert.match(page, /Ativar página/);
    const off = await mk('Sem Plateia', { enabled: false });
    assert.doesNotMatch((await as.gestao.get(`/convidados/${off}`)).text, /data-tab-btn="pagina"/);
    assert.equal((await as.editor.act(`/convidados/${g}/plateia/pagina`, { on: '1' }, { from: '/' })).status, 403);

    const r = await act('gestao', `/convidados/${g}/plateia/pagina`, { on: '1' });
    assert.equal(r.location, `/convidados/${g}#pagina`);
    const row = await one('SELECT audience_page_enabled, audience_slug FROM guests WHERE id = $1', [g]);
    assert.equal(row.audience_page_enabled, true); assert.equal(row.audience_slug, 'mari-vabo');
    page = (await as.gestao.get(`/convidados/${g}`)).text;
    assert.match(page, /\/plateia\/com\/mari-vabo/); assert.match(page, /Copiar link/); assert.match(page, /Editar página/);
  });

  it('a página pública mostra o convidado; o que não foi preenchido não aparece; editar faz aparecer', async () => {
    let r = await anon.get('/plateia/com/mari-vabo');
    assert.equal(r.status, 200);
    assert.match(r.text, /<h1>Conheça de perto Mari Vabo<\/h1>/); assert.match(r.text, /participe também da gravação do Pulso Podcast/); assert.match(r.text, /Interação com o convidado/); assert.match(r.text, /Pedir para participar/); assert.match(r.text, /R\$ 197/);
    assert.doesNotMatch(r.text, /Como será/); assert.doesNotMatch(r.text, /pl-gallery/); assert.doesNotMatch(r.text, /Chegada da plateia/);
    assert.doesNotMatch(r.text, /<script>|onclick=|style=/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);

    assert.match((await as.gestao.act(`/convidados/${g}/plateia/pagina/editar`, { intro: 'x', arrival: '25:99' }, { from: `/convidados/${g}` })).location, /#pagina/);
    assert.equal((await one('SELECT audience_intro FROM guests WHERE id = $1', [g])).audience_intro, null, 'horário inválido não salva nada');
    await act('gestao', `/convidados/${g}/plateia/pagina/editar`, { intro: 'Conversa sobre gestão.\nPerguntas no fim.', arrival: '19:30', extra_title: 'O que levar', extra: 'Documento com foto.' });
    const upl = await fetch(`${app.base}/convidados/${g}/plateia/pagina/fotos`, { method: 'POST', headers: { cookie: as.gestao.cookie(), 'content-type': 'image/jpeg', 'x-csrf-token': await as.gestao.csrf('/') }, body: JPG });
    assert.equal(upl.status, 200);
    const [ph] = await q('SELECT id FROM guest_audience_photos WHERE guest_id = $1', [g]);
    r = await anon.get('/plateia/com/mari-vabo');
    assert.match(r.text, /Como será/); assert.match(r.text, /Conversa sobre gestão\./);
    assert.match(r.text, /Chegada da plateia: <strong>19h30<\/strong>/);
    assert.match(r.text, /<h2>O que levar<\/h2>/); assert.match(r.text, /Documento com foto\./);
    assert.match(r.text, new RegExp(`/plateia/com/mari-vabo/fotos/${ph.id}`));
    assert.equal((await fetch(`${app.base}/plateia/com/mari-vabo/fotos/${ph.id}`)).status, 200);
    assert.equal((await anon.get('/plateia/com/nao-existe')).status, 404);
  });

  it('o pedido pela página cai no painel como sempre, com o convidado e o valor normal', async () => {
    const r = await signup({ guest_id: g, name: 'Lucas Pereira', phone: '11912345678' });
    assert.equal(r.status, 200); assert.equal(r.json.exempt, false); assert.equal(r.json.price, 'R$ 197');
    const lead = await one("SELECT * FROM plateia_leads WHERE name = 'Lucas Pereira'");
    assert.equal(lead.guest_id, g); assert.equal(lead.partner_id, null);
  });

  it('link de parceiro: página isenta, pedido marcado, sem link de pagamento e seleção já como isento; esgotado volta ao valor', async () => {
    assert.equal((await act('gestao', `/convidados/${g}/plateia/parceiros`, { name: '', slots: '' })).status, 302);
    assert.equal((await q('SELECT 1 FROM plateia_partners')).length, 0, 'sem nome não cria');
    await act('gestao', `/convidados/${g}/plateia/parceiros`, { name: 'Clínica Vida', slots: '2' });
    partner = await one('SELECT * FROM plateia_partners WHERE guest_id = $1', [g]);
    assert.equal(partner.slots, 2);
    assert.match((await as.gestao.get(`/convidados/${g}`)).text, new RegExp(`/plateia/com/mari-vabo/${partner.token}`));

    let r = await anon.get(`/plateia/com/mari-vabo/${partner.token}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Convite de Clínica Vida/); assert.match(r.text, /Participação isenta de cobrança\./);
    assert.match(r.text, new RegExp(`data-partner="${partner.token}"`));
    assert.match(r.text, /name="robots" content="noindex"/, 'o link do parceiro não vai para o Google');
    assert.equal((await anon.get(`/plateia/com/mari-vabo/xxxxxxxx`)).location, '/plateia/com/mari-vabo', 'link inválido cai na página normal');
    const otherSlug = (await q("UPDATE guests SET audience_page_enabled = true, audience_slug = 'outro' WHERE id = $1 RETURNING audience_slug", [other]))[0].audience_slug;
    assert.equal((await anon.get(`/plateia/com/${otherSlug}/${partner.token}`)).location, '/plateia/com/outro', 'link de outra gravação não vale aqui');

    const a = await signup({ guest_id: g, partner: partner.token, name: 'Paula Antunes', phone: '11988887777' });
    assert.equal(a.json.exempt, true); assert.match(a.json.price, /Isento/);
    let lead = await one("SELECT * FROM plateia_leads WHERE name = 'Paula Antunes'");
    assert.equal(lead.partner_id, partner.id); assert.equal(lead.partner_name, 'Clínica Vida');
    const wa = decodeURIComponent(a.json.url || '');
    if (a.json.url) assert.match(wa, /convite de Clínica Vida/);
    let n; for (let i = 0; i < 40 && !n; i += 1) { n = await one("SELECT body FROM notifications WHERE title LIKE '%Paula Antunes%' LIMIT 1"); if (!n) await new Promise((s) => setTimeout(s, 25)); } // o aviso sai sem segurar a resposta
    assert.match(n.body, /isenta, link de Clínica Vida/);

    // painel: marcado como parceiro, a seleção já vem como isento e não oferece link de pagamento
    const panel = (await as.gestao.get(`/plateia/painel?convidado=${g}`)).text;
    assert.match(panel, /parceiro · Clínica Vida/);
    assert.match(panel, /&quot;paid&quot;:&quot;isento&quot;|"paid":"isento"/);
    await as.gestao.act(`/plateia/painel/leads/${lead.id}`, { status: 'em_atendimento', voltar: '/plateia/painel' }, { from: '/plateia/painel' });
    assert.equal((await q('SELECT 1 FROM plateia_pay_links WHERE lead_id = $1', [lead.id])).length, 0, 'parceiro não recebe link de pagamento');
    await as.gestao.act(`/plateia/painel/leads/${lead.id}/confirmar`, { paid: 'isento', voltar: '/plateia/painel' }, { from: '/plateia/painel' });
    lead = await one('SELECT * FROM plateia_leads WHERE id = $1', [lead.id]);
    assert.equal(lead.status, 'confirmado'); assert.equal(Number(lead.amount_cents), 0); assert.equal(lead.entry_id, null);

    // segunda vaga e o limite
    await signup({ guest_id: g, partner: partner.token, name: 'Rui Barbosa', phone: '11977776666' });
    r = await anon.get(`/plateia/com/mari-vabo/${partner.token}`);
    assert.match(r.text, /As vagas isentas do convite de Clínica Vida já foram preenchidas/);
    assert.match(r.text, /data-partner=""/); assert.match(r.text, /R\$ 197/);
    const c = await signup({ guest_id: g, partner: partner.token, name: 'Teo Antunes', phone: '11966665555' });
    assert.equal(c.json.exempt, false, 'esgotado: pedido normal');
    assert.equal((await one("SELECT partner_id FROM plateia_leads WHERE name = 'Teo Antunes'")).partner_id, null);

    // quem não foi selecionado devolve a vaga
    const rui = await one("SELECT id FROM plateia_leads WHERE name = 'Rui Barbosa'");
    await as.gestao.act(`/plateia/painel/leads/${rui.id}`, { status: 'nao_selecionado', voltar: '/plateia/painel' }, { from: '/plateia/painel' });
    r = await anon.get(`/plateia/com/mari-vabo/${partner.token}`);
    assert.match(r.text, /Participação isenta de cobrança\./);
    assert.match((await as.gestao.get(`/convidados/${g}`)).text, /1 de 2 vagas/);
  });

  it('vídeo dos bastidores: aparece nas duas páginas, com WebM e MP4, e a CSP libera só o Backblaze', async () => {
    assert.equal((await fetch(`${app.base}/plateia/video/bastidores.webm`, { redirect: 'manual' })).status, 404);
    await q("INSERT INTO app_settings (key, value) VALUES ('plateia_reels_webm_key', 'pulso/plateia/bastidores.webm'), ('plateia_reels_key', 'pulso/plateia/bastidores.mp4'), ('plateia_reels_poster_key', 'pulso/plateia/bastidores.jpg') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
    for (const path of ['/plateia', '/plateia/com/mari-vabo']) {
      const r = await anon.get(path);
      assert.match(r.text, /id="bastidores"/, path); assert.match(r.text, /Veja como é estar na plateia/);
      assert.match(r.text, /<source src="\/plateia\/video\/bastidores\.webm" type="video\/webm">\s*<source src="\/plateia\/video\/bastidores\.mp4" type="video\/mp4">/);
      assert.match(r.text, /poster="\/plateia\/imagem\/bastidores"/);
      assert.match(r.headers.get('content-security-policy'), /media-src https:\/\/s3\.acauamedia\.com https:\/\/s3\.[^ ;]+backblazeb2\.com/);
    }
    const v = await fetch(`${app.base}/plateia/video/bastidores.webm`, { redirect: 'manual' });
    assert.equal(v.status, 302); assert.match(v.headers.get('location'), /bastidores\.webm\?.*X-Amz-Signature=/);
  });

  it('desativar o link e a página', async () => {
    await act('gestao', `/convidados/${g}/plateia/parceiros/${partner.id}`, { active: '0' });
    assert.equal((await anon.get(`/plateia/com/mari-vabo/${partner.token}`)).location, '/plateia/com/mari-vabo');
    await act('gestao', `/convidados/${g}/plateia/parceiros/${partner.id}`, { name: 'Clínica Vida SP', slots: '' });
    const p = await one('SELECT name, slots, active FROM plateia_partners WHERE id = $1', [partner.id]);
    assert.equal(p.name, 'Clínica Vida SP'); assert.equal(p.slots, null); assert.equal(p.active, false);
    await act('gestao', `/convidados/${g}/plateia/pagina`, { on: '0' });
    assert.equal((await anon.get('/plateia/com/mari-vabo')).status, 404);
    // gravação que passou: a página continua, mas sem pedido
    await act('gestao', `/convidados/${g}/plateia/pagina`, { on: '1' });
    await q("UPDATE guests SET proposed_at = now() - interval '1 day' WHERE id = $1", [g]);
    const r = await anon.get('/plateia/com/mari-vabo');
    assert.match(r.text, /Inscrições encerradas/); assert.doesNotMatch(r.text, /data-signup=/);
  });
});
