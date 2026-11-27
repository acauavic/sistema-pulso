const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

describe('Portal do convidado: calendário de posts previstos', () => {
  const as = {}; let app; let anon; let g; let ep; let base;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const act = (who, form) => as[who].act(`/convidados/${g}/portal/calendario`, form, { from: `/convidados/${g}` });
  const day = (n) => new Date(Date.now() - 3 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

  before(async () => {
    await h.resetDb(); app = await h.startServer(); anon = h.client(app.base);
    for (const [k, role] of [['gestao', 'gestao'], ['editor', 'editor_video']]) { await h.createUser({ name: k, email: `${k}@cp.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@cp.com`); }
    [{ id: g }] = await q("INSERT INTO guests (name, status) VALUES ('Mari Vabo', 'gravado') RETURNING id");
    [{ id: ep }] = await q("INSERT INTO episodes (number, title, guest_id, status) VALUES (12, 'Gestão', $1, 'em_edicao') RETURNING id", [g]);
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

  describe('agendados do Social', () => {
    let cover; let other; let a;
    const sched = async ({ episode = ep, title, at, status = 'agendado', platforms = ['instagram', 'tiktok', 'youtube'], ig = {}, coverId = null }) => (await q(
      `INSERT INTO episode_publications (episode_id, platforms, title, status, media, results, options, cover_id, scheduled_at)
       VALUES ($1, $2, $3, $4, 'video', '[]', $5, $6, ($7::timestamp) AT TIME ZONE 'America/Sao_Paulo') RETURNING id`,
      [episode, platforms, title, status, JSON.stringify({ instagram: { tags: [], ...ig } }), coverId, at]))[0].id;
    const cal = async () => { const page = (await anon.get(base)).text; return page.includes('id="calendario"') ? page.split('id="calendario"')[1].split('</ol>')[0] : ''; };

    before(async () => {
      await q("UPDATE guests SET instagram = '@MariVabo' WHERE id = $1", [g]);
      [{ id: cover }] = await q("INSERT INTO episode_covers (episode_id, kind, position, spec, storage_key, mime, width, height, size_bytes) VALUES ($1, 'post_quote', 0, '{}', 'pp/capas/x.jpg', 'image/jpeg', 1080, 1920, 1000) RETURNING id", [ep]);
      [{ id: other }] = await q("INSERT INTO episodes (number, title, status) VALUES (13, 'Outro', 'publicado') RETURNING id");
      a = await sched({ title: 'Gancho em collab', at: `${day(2)} 18:30`, ig: { collaborators: ['marivabo'] }, coverId: cover });
      await sched({ title: 'Reel de teste escondido', at: `${day(2)} 08:00`, ig: { trial: 'auto' } });
      await sched({ title: 'Esperando aprovação', at: `${day(2)} 10:00`, status: 'revisao' });
      await sched({ title: 'Deu erro', at: `${day(2)} 11:00`, status: 'erro' });
      await sched({ episode: other, title: 'Participação especial', at: `${day(1)} 09:00`, platforms: ['instagram'], ig: { collaborators: ['@MariVabo'] } });
      await sched({ episode: other, title: 'Outro convidado', at: `${day(1)} 10:00` });
    });

    it('aparecem sozinhos, sem Reel de teste, sem os que esperam aprovação ou falharam: dia, hora, redes, collab e só a capa', async () => {
      const part = await cal();
      assert.match(part, /2 previstos/);
      assert.ok(part.indexOf('Participação especial') < part.indexOf('Gancho em collab'), 'em ordem de data');
      for (const out of ['Reel de teste escondido', 'Esperando aprovação', 'Deu erro', 'Outro convidado']) assert.doesNotMatch(part, new RegExp(out));
      const gancho = part.split('Gancho em collab')[1];
      assert.match(gancho, /Às <span class="pt-mono-in">18h30<\/span> · <span class="pt-mono-in">Instagram · TikTok · YouTube<\/span>/);
      assert.match(gancho, /collab · Instagram/);
      assert.match(part, new RegExp(`<img class="pt-plan-cover" src="${base}/capa/${cover}"`));
      assert.doesNotMatch(part, /<video|<a /, 'nada para assistir ou abrir');
      const page = (await anon.get(base)).text;
      assert.match(page, /A collab é só no Instagram: se quiser collab em outra rede, <a href="[^"]*\/producao"[^>]*>fale com a produção<\/a>/);
      assert.doesNotMatch(page, /style=|<script>/);
      assert.notEqual((await anon.get(`${base}/capa/${cover}`)).status, 404, 'a capa do agendado abre');
    });

    it('o painel mostra os agendados; a linha à mão entra na mesma lista; saiu, sai do calendário', async () => {
      let tab = (await as.gestao.get(`/convidados/${g}`)).text;
      assert.match(tab, /2 agendados no Social · aparecem sozinhos no portal/); assert.match(tab, /AGENDADO · COLLAB/);
      assert.match(tab, /Algum post previsto que ainda não foi agendado/);

      await act('gestao', { plano_data: [day(3)], plano_hora: ['12:00'], plano_texto: ['Bastidores à mão'] });
      let part = await cal();
      assert.match(part, /3 previstos/);
      assert.ok(part.indexOf('Gancho em collab') < part.indexOf('Bastidores à mão'));
      assert.match(part, /Por volta de <span class="pt-mono-in">12h<\/span>/);
      tab = (await as.gestao.get(`/convidados/${g}`)).text;
      assert.match(tab, /1 previsto à mão/);

      await act('gestao', { on: '0' });
      part = await cal();
      assert.match(part, /2 previstos/, 'tirar do portal esconde só as linhas à mão');
      assert.doesNotMatch(part, /Bastidores à mão/);

      await q("UPDATE episode_publications SET status = 'publicado' WHERE id = $1", [a]);
      part = await cal();
      assert.match(part, /1 previsto/); assert.doesNotMatch(part, /Gancho em collab/);
      assert.equal((await anon.get(`${base}/capa/${cover}`)).status, 404, 'saiu sem link no ar: a capa não fica aberta');
    });
  });
});
