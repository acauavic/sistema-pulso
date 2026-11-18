// Ordem de edição: o editor vê o que editar primeiro (1º, 2º…) pela data de veiculação, no Início, em Episódios e na página do
// episódio; liberar para edição sem data pergunta a data, e o aviso ao editor diz a posição.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const cal = require('../src/services/calendar');
const editOrder = require('../src/services/editOrder');

describe('Ordem de edição', () => {
  const today = cal.todayISO();
  const day = (n) => cal.addDays(today, n);
  const q = (sql, p) => h.db.query(sql, p);
  let app; const as = {}; const u = {}; const ep = {};
  const add = async (k, number, status, aired, extra = {}) => {
    ep[k] = (await q('INSERT INTO episodes (number, title, status, aired_on, editor_id, review_round) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [number, `Episódio ${k}`, status, aired, extra.editor || null, extra.round || 0])).rows[0].id;
  };
  const posOf = (page, number) => page.indexOf(`EP.${String(number).padStart(3, '0')} · Episódio`);

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, name, role] of [['gestao', 'Gil Gestão', 'gestao'], ['editor', 'Edu Editor', 'editor_video']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); assert.equal((await as[k].login(`${k}@t.com`)).status, 302);
    }
    await add('atrasado', 25, 'disponivel_edicao', day(-2));
    await add('ajuste', 21, 'em_edicao', day(1), { editor: u.editor.id, round: 1 });
    await add('mesmoDia', 22, 'disponivel_edicao', day(1));
    await add('depois', 20, 'disponivel_edicao', day(5));
    await add('semData', 23, 'disponivel_edicao', null);
    await add('revisao', 24, 'em_revisao', today, { editor: u.editor.id });
  });
  after(async () => { await app.close(); await h.db.close(); });

  it('pela data de veiculação: quem vai ao ar antes vem primeiro, no mesmo dia vale o número, sem data no fim; ajuste não fura a fila', async () => {
    const order = await editOrder.list();
    assert.deepEqual(order.map((e) => [e.id, e.rank]), [[ep.atrasado, 1], [ep.ajuste, 2], [ep.mesmoDia, 3], [ep.depois, 4], [ep.semData, 5]], 'em revisão fica de fora');
    assert.deepEqual(order.map((e) => e.air.tone), ['late', 'soon', 'soon', '', 'none']);
    assert.equal((await editOrder.positionOf(ep.revisao)), null);
  });

  it('a data em palavras, com a cor do prazo', () => {
    const t = '2026-11-18'; // quarta-feira
    assert.deepEqual(editOrder.airInfo('2026-11-18', t), { line: 'vai ao ar hoje, qua 18/11', short: '18/11', tone: 'soon' });
    assert.deepEqual(editOrder.airInfo('2026-11-19', t), { line: 'vai ao ar amanhã, qui 19/11', short: '19/11', tone: 'soon' });
    assert.deepEqual(editOrder.airInfo('2026-11-20', t), { line: 'vai ao ar sex 20/11 · em 2 dias', short: '20/11', tone: 'soon' });
    assert.deepEqual(editOrder.airInfo('2026-11-21', t), { line: 'vai ao ar sáb 21/11 · em 3 dias', short: '21/11', tone: '' });
    assert.deepEqual(editOrder.airInfo('2026-11-17', t), { line: 'devia ter saído ontem, ter 17/11', short: '17/11', tone: 'late' });
    assert.deepEqual(editOrder.airInfo('2026-11-10', t), { line: 'devia ter saído ter 10/11 · há 8 dias', short: '10/11', tone: 'late' });
    assert.deepEqual(editOrder.airInfo(null, t), { line: 'sem data de veiculação', short: 'sem data', tone: 'none' });
  });

  it('o Início do editor mostra a ordem de edição numa lista só, com a posição e a situação de cada um', async () => {
    const page = (await as.editor.get('/')).text;
    assert.match(page, /Ordem de edição/);
    const positions = [25, 21, 22, 20, 23].map((n) => posOf(page, n));
    assert.ok(positions.every((p) => p > 0) && positions.every((p, i) => i === 0 || p > positions[i - 1]), `na ordem: ${positions}`);
    assert.match(page, /<span class="edit-pos"[^>]*>1º<\/span>/);
    assert.match(page, /class="mono small air-late">devia ter saído/);
    assert.match(page, /ajustes pedidos/, 'o episódio dele que voltou com ajustes');
    assert.match(page, /disponível/);
    const mine = page.slice(page.indexOf('Meus episódios'));
    assert.match(mine, /EP\.024 · Episódio revisao/, 'em revisão fica em Meus episódios');
    assert.doesNotMatch(mine, /EP\.021/, 'em edição está na ordem, não em Meus episódios');
  });

  it('Episódios: Disponível para edição e Em edição seguem a ordem, com a posição no cartão; a lista ganha a coluna Ordem', async () => {
    const board = (await as.gestao.get('/episodios')).text;
    const col = board.slice(board.indexOf('data-status="disponivel_edicao"'), board.indexOf('data-status="em_edicao"'));
    const inCol = [25, 22, 20, 23].map((n) => col.indexOf(`EP.0${n}`));
    assert.ok(inCol.every((p, i) => p > 0 && (i === 0 || p > inCol[i - 1])), `ordem na coluna: ${inCol}`);
    assert.match(col, /title="1º na ordem de edição">1º<\/b> · EP\.025 · <span class="air-late"/);
    assert.match(board, /title="2º na ordem de edição">2º<\/b> · EP\.021/);
    const list = (await as.gestao.get('/episodios?view=lista')).text;
    assert.match(list, />Ordem<\/th>/);
    assert.match(list, /<b class="order-n">5º<\/b>/);
  });

  it('a página do episódio diz a posição e quando vai ao ar; fora da edição, nada', async () => {
    const page = (await as.editor.get(`/episodios/${ep.mesmoDia}`)).text;
    assert.match(page, /<b class="order-n">3º<\/b> na ordem de edição · <span class="air-soon">vai ao ar amanhã/);
    assert.doesNotMatch((await as.editor.get(`/episodios/${ep.revisao}`)).text, /na ordem de edição/);
  });

  it('liberar para edição sem data pergunta a data; ela entra na ordem e o aviso ao editor diz a posição', async () => {
    await add('novo', 30, 'gravado', null);
    await add('comData', 31, 'gravado', day(10));
    for (const k of ['novo', 'comData']) await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status) VALUES ($1, 'bruto_video', 'cam.mp4', 10, $2, 'pronto')", [ep[k], `k-${k}`]);
    let page = (await as.gestao.get(`/episodios/${ep.novo}`)).text;
    assert.match(page, /data-modal-open="modal-liberar">Liberar para edição/);
    assert.match(page, /id="modal-liberar"/); assert.match(page, /name="aired_on"/);
    page = (await as.gestao.get(`/episodios/${ep.comData}`)).text;
    assert.doesNotMatch(page, /modal-liberar/, 'com data, o botão libera direto');

    const r = await as.gestao.act(`/episodios/${ep.novo}/etapa`, { to: 'disponivel_edicao', aired_on: day(3) }, { from: `/episodios/${ep.novo}` });
    assert.equal(r.status, 302);
    const { rows: [row] } = await q("SELECT status, to_char(aired_on, 'YYYY-MM-DD') AS aired FROM episodes WHERE id = $1", [ep.novo]);
    assert.deepEqual(row, { status: 'disponivel_edicao', aired: day(3) });
    assert.equal((await editOrder.positionOf(ep.novo)).rank, 4, 'entre o de amanhã e o de daqui a 5 dias');
    const { rows: [note] } = await q("SELECT body FROM notifications WHERE user_id = $1 AND type = 'episodio' ORDER BY id DESC LIMIT 1", [u.editor.id]);
    assert.match(note.body, /É o 4º na ordem de edição \(vai ao ar .+ · em 3 dias\)/);
  });

  it('liberar sem data também vale (vai para o fim); se a liberação não acontece, a data não fica gravada', async () => {
    await add('semDataAgora', 32, 'gravado', null);
    await q("INSERT INTO episode_files (episode_id, kind, filename, size_bytes, storage_key, status) VALUES ($1, 'bruto_video', 'cam.mp4', 10, 'k-sem', 'pronto')", [ep.semDataAgora]);
    await as.gestao.act(`/episodios/${ep.semDataAgora}/etapa`, { to: 'disponivel_edicao', aired_on: '' }, { from: `/episodios/${ep.semDataAgora}` });
    const all = await editOrder.list();
    assert.equal(all.at(-1).id, ep.semDataAgora, 'sem data: o último (empate entre os sem data, pelo número)');

    await add('semBruto', 33, 'gravado', null); // falta o vídeo bruto: não libera
    await as.gestao.act(`/episodios/${ep.semBruto}/etapa`, { to: 'disponivel_edicao', aired_on: day(2) }, { from: `/episodios/${ep.semBruto}` });
    const { rows: [row] } = await q('SELECT status, aired_on FROM episodes WHERE id = $1', [ep.semBruto]);
    assert.deepEqual(row, { status: 'gravado', aired_on: null });
  });
});
