const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Plateia: pessoas de gravações que já passaram ficam ocultas de primeira', () => {
  let app; let as;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const days = (n) => new Date(Date.now() + n * 86400_000).toISOString();

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    await h.createUser({ name: 'Gil', email: 'g@t.com', role: 'gestao' }); as = h.client(app.base); await as.login('g@t.com');
    const mk = async (name, at) => (await q("INSERT INTO guests (name, status, proposed_at) VALUES ($1, 'agendado', $2) RETURNING id", [name, at]))[0].id;
    const past = await mk('Carol Borba', days(-10)); const next = await mk('Lia Prado', days(5));
    const lead = (ref, gid, name) => q("INSERT INTO plateia_leads (ref, guest_id, guest_name, recording_at, name, phone, country, price_cents, status) SELECT $1, g.id, g.name, g.proposed_at, $2, '11999990000', 'BR', 19700, 'novo' FROM guests g WHERE g.id = $3", [ref, name, gid]);
    await lead('p1', past, 'Ana Antiga'); await lead('p2', past, 'Bia Antiga'); await lead('n1', next, 'Cris Nova');
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('lista e quadro mostram só as gravações de hoje em diante, com o aviso de quantas estão ocultas', async () => {
    for (const v of ['lista', 'quadro']) {
      const t = (await as.get(`/plateia/painel?vista=${v}`)).text;
      assert.match(t, /Cris Nova/); assert.doesNotMatch(t, /Ana Antiga/, v);
      assert.match(t, /<span class="mono">2<\/span> pessoas de gravações que já passaram estão ocultas \(Carol Borba\)/);
    }
  });

  it('"Mostrar" traz todo mundo; filtrar o episódio ou buscar o nome também encontra', async () => {
    let t = (await as.get('/plateia/painel?anteriores=1')).text;
    assert.match(t, /Ana Antiga/); assert.match(t, /Cris Nova/); assert.match(t, /Ocultar/);
    const [g] = await q("SELECT id FROM guests WHERE name = 'Carol Borba'");
    t = (await as.get(`/plateia/painel?convidado=${g.id}`)).text;
    assert.match(t, /Ana Antiga/); assert.doesNotMatch(t, /Cris Nova/);
    assert.match((await as.get('/plateia/painel?q=Bia')).text, /Bia Antiga/);
  });
});
