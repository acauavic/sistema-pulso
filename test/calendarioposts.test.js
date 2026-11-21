const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Portal do convidado: calendário de posts previstos', () => {
  const as = {}; let app; let anon; let g; let base;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const act = (who, form) => as[who].act(`/convidados/${g}/portal/calendario`, form, { from: `/convidados/${g}` });
  const day = (n) => new Date(Date.now() - 3 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

  before(async () => {
    await h.resetDb(); app = await h.startServer(); anon = h.client(app.base);
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@cp.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@cp.com`); }
    [{ id: g }] = await q("INSERT INTO guests (name, status) VALUES ('Mari Vabo', 'gravado') RETURNING id");
    await q("INSERT INTO episodes (number, title, guest_id, status) VALUES (12, 'Gestão', $1, 'em_edicao')", [g]);
    await as.gestao.act(`/convidados/${g}/portal`, { on: '1' }, { from: `/convidados/${g}` });
    base = `/convidado/${(await q('SELECT portal_token FROM guests WHERE id = $1', [g]))[0].portal_token}`;
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('não vem ligado: o portal não mostra nada e a aba ensina a montar', async () => {
    assert.doesNotMatch((await anon.get(base)).text, /Calendário de posts/);
    const tab = (await as.gestao.get(`/convidados/${g}`)).text;
    assert.match(tab, /Montar calendário/); assert.match(tab, /\/static\/postplan\.js/);
  });

  it('só quem edita o convidado salva; linhas erradas são recusadas sem perder nada', async () => {
    assert.equal((await act('editor', { plano_data: [day(1)], plano_hora: [''], plano_texto: [''] })).status, 403);
    for (const form of [{ plano_data: [''], plano_hora: ['18:00'], plano_texto: [''] }, { plano_data: ['ontem'], plano_hora: [''], plano_texto: [''] }, { plano_data: [day(1)], plano_hora: ['25:00'], plano_texto: [''] }]) {
      await act('gestao', form);
      assert.equal((await q('SELECT 1 FROM guest_post_plan')).length, 0);
    }
    assert.equal((await q('SELECT portal_post_plan FROM guests WHERE id = $1', [g]))[0].portal_post_plan, false);
  });

  it('salvar põe no portal: contagem, data, horário provável e descrição, em ordem; linha vazia é ignorada; texto vai escapado', async () => {
    await act('gestao', {
      plano_data: [day(3), day(1), '', day(2)], plano_hora: ['18:30', '', '', '12:00'], plano_texto: ['Corte <b>gestão</b>', '', '', 'Bastidores'],
    });
    const page = (await anon.get(base)).text;
    const part = page.split('id="calendario"')[1].split('</ol>')[0];
    assert.match(part, /3 previstos/);
    assert.ok(part.indexOf('Post em collab') < part.indexOf('Bastidores') && part.indexOf('Bastidores') < part.indexOf('Corte'), 'em ordem de data; sem descrição vira "Post em collab"');
    assert.match(part, /Por volta de <span class="pt-mono-in">18h30<\/span>/);
    assert.match(part, /Por volta de <span class="pt-mono-in">12h<\/span>/);
    assert.match(part, /Corte &lt;b&gt;gestão&lt;\/b&gt;/);
    assert.match(page, /são uma previsão/);
    assert.doesNotMatch(page, /O primeiro sai em/);
    const tab = (await as.gestao.get(`/convidados/${g}`)).text;
    assert.match(tab, />no portal</); assert.match(tab, /Editar calendário/); assert.match(tab, /tirar do portal/);
    assert.match(tab, new RegExp(`name="plano_data" value="${day(1)}"`), 'a janela abre com as linhas atuais');
  });

  it('dia que passou fica apagado e hoje recebe o destaque, sem afirmar que o post saiu', async () => {
    await act('gestao', { plano_data: [day(-2), day(0)], plano_hora: ['', ''], plano_texto: ['Antigo', 'De hoje'] });
    const part = (await anon.get(base)).text.split('id="calendario"')[1].split('</ol>')[0];
    assert.match(part, /class="is-feito"[\s\S]*Antigo/); assert.match(part, /class="is-hoje"[\s\S]*pt-chip-now[\s\S]*De hoje/);
    assert.doesNotMatch(part, /saiu|publicado/i);
  });

  it('tirar do portal esconde sem apagar; mostrar devolve; salvar vazio limpa', async () => {
    await act('gestao', { on: '0' });
    assert.doesNotMatch((await anon.get(base)).text, /Calendário de posts/);
    assert.equal((await q('SELECT 1 FROM guest_post_plan')).length, 2);
    assert.match((await as.gestao.get(`/convidados/${g}`)).text, /fora do portal/);
    await act('gestao', { on: '1' });
    assert.match((await anon.get(base)).text, /Calendário de posts/);
    await act('gestao', { plano_data: [''], plano_hora: [''], plano_texto: [''] });
    assert.equal((await q('SELECT 1 FROM guest_post_plan')).length, 0);
    assert.doesNotMatch((await anon.get(base)).text, /Calendário de posts/);
    assert.match((await as.gestao.get(`/convidados/${g}`)).text, /Montar calendário/);
  });

  it('limite de linhas', async () => {
    await act('gestao', { plano_data: Array(41).fill(day(1)), plano_hora: Array(41).fill(''), plano_texto: Array(41).fill('x') });
    assert.equal((await q('SELECT 1 FROM guest_post_plan')).length, 0);
  });
});
