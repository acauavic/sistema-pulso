const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');

let app;
let admin; let gestao; let produtora; let editor; let editor2;
const as = {};

const bytes = (n, seed = 7) => Buffer.alloc(n, seed);
const rnd = (n) => crypto.randomBytes(n);

describe('produção de episódios', () => {
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    admin = await h.createUser({ name: 'Ana Admin', email: 'admin@t.com', role: 'superadmin' });
    gestao = await h.createUser({ name: 'Gil Gestão', email: 'gestao@t.com', role: 'gestao' });
    produtora = await h.createUser({ name: 'Paula Produtora', email: 'prod@t.com', role: 'produtora' });
    editor = await h.createUser({ name: 'Edu Editor', email: 'edit@t.com', role: 'editor_video' });
    editor2 = await h.createUser({ name: 'Eva Editora', email: 'eva@t.com', role: 'editor_video' });
    for (const [k, email] of [['admin', 'admin@t.com'], ['gestao', 'gestao@t.com'], ['prod', 'prod@t.com'], ['editor', 'edit@t.com'], ['editor2', 'eva@t.com']]) {
      as[k] = h.client(app.base);
      assert.equal((await as[k].login(email)).status, 302, `login ${k}`);
    }
  });
  after(async () => { await app.close(); await h.db.close(); });

  // ---------------------------------------------------------------- utilidades
  const ep = (id) => h.db.query('SELECT * FROM episodes WHERE id=$1', [id]).then((r) => r.rows[0]);
  const guestFields = (o = {}) => ({
    name: 'Dr. Marcos Lima', instagram: '@marcoslima', profile: 'medico', email: 'marcos@exemplo.com', owner_id: produtora.id, ...o,
  });
  const scheduled = { status: 'agendado', proposed_at: '2026-11-20T15:00', scheduled_studio: '1', scheduled_hosts: '1', scheduled_guest: '1' };

  async function api(client, method, path, { json, raw, type, csrf = true } = {}) {
    const token = csrf ? await client.csrf('/episodios') : null;
    const headers = { cookie: client.cookie(), accept: 'application/json', ...(token ? { 'x-csrf-token': token } : {}) };
    let body;
    if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); } else if (raw) { headers['content-type'] = type || 'application/octet-stream'; body = raw; }
    const res = await fetch(`${app.base}${path}`, { method, headers, body, redirect: 'manual' });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* não é JSON */ }
    return { status: res.status, json: parsed, text, location: res.headers.get('location'), headers: res.headers };
  }

  // Envia um arquivo pelo mesmo caminho do navegador: iniciar -> partes -> concluir.
  async function upload(client, epId, { kind = 'bruto_video', name = 'camera1.mp4', data, label = 'Câmera 1', type = 'video/mp4', stopAfterParts = false } = {}) {
    const init = await api(client, 'POST', `/episodios/${epId}/arquivos/iniciar`, { json: { kind, rotulo: label, nome: name, tamanho: data.length, tipo: type } });
    if (init.status !== 200) return { init };
    const { id, partSize, totalParts } = init.json;
    for (let n = 1; n <= totalParts; n += 1) {
      const slice = data.subarray((n - 1) * partSize, Math.min(data.length, n * partSize));
      const part = await api(client, 'PUT', `/episodios/${epId}/arquivos/${id}/parte/${n}`, { raw: slice });
      assert.equal(part.status, 200, `parte ${n}: ${part.text}`);
    }
    if (stopAfterParts) return { init: init.json, id };
    const done = await api(client, 'POST', `/episodios/${epId}/arquivos/${id}/concluir`);
    return { init: init.json, id, done };
  }

  async function api2(client, epId, to) {
    const token = await client.csrf('/episodios');
    const res = await fetch(`${app.base}/episodios/${epId}/etapa`, {
      method: 'POST', headers: { cookie: client.cookie(), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': token }, body: new URLSearchParams({ to }),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  const move = (client, epId, to) => api2(client, epId, to);

  const tickAll = async (client, epId, gate) => {
    const { rows } = await h.db.query('SELECT id FROM episode_checklist_items WHERE episode_id=$1 AND gate=$2 AND NOT done', [epId, gate]);
    for (const r of rows) {
      const token = await client.csrf('/episodios');
      const res = await fetch(`${app.base}/episodios/${epId}/checklist/${r.id}/marcar`, {
        method: 'POST', headers: { cookie: client.cookie(), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': token }, body: new URLSearchParams({ done: '1' }),
      });
      assert.equal(res.status, 200);
    }
    return rows.length;
  };

  let epId; let guestId;

  // ---------------------------------------------------------------- convidado -> episódio
  describe('o episódio nasce do convidado', () => {
    it('antes da gravação não existe episódio (nem em Agendado: aí é agenda)', async () => {
      const r = await as.prod.act('/convidados', guestFields({ name: 'Cedo Demais' }), { from: '/convidados/novo' });
      assert.equal(r.status, 302);
      const id = r.location.split('/').pop();
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episodes WHERE guest_id=$1', [id])).rows[0].n, 0);
      await as.prod.act(`/convidados/${id}`, guestFields({ name: 'Cedo Demais', status: 'em_agendamento' }), { from: `/convidados/${id}/editar` });
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episodes')).rows[0].n, 0, 'Em agendamento ainda não é episódio');
      const s2 = await as.prod.act('/convidados', guestFields(scheduled), { from: '/convidados/novo' });
      assert.equal(s2.status, 302, s2.text.slice(0, 300));
      guestId = s2.location.split('/').pop();
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episodes')).rows[0].n, 0, 'Agendado é agenda, não episódio');
      const { rows: notes } = await h.db.query("SELECT title FROM notifications WHERE type='agendamento' AND title LIKE '%Marcos Lima%'");
      assert.ok(notes.length >= 1, 'agendamento concluído avisa a equipe');
    });

    it('Gravado faz o episódio nascer: número, título, data da gravação, 3 tarefas e histórico', async () => {
      const csrf = await as.prod.csrf('/convidados');
      const r = await as.prod.post(`/convidados/${guestId}/status`, { status: 'gravado' }, { headers: { accept: 'application/json', 'x-csrf-token': csrf } });
      assert.equal(r.status, 200);
      const { rows } = await h.db.query('SELECT * FROM episodes WHERE guest_id=$1', [guestId]);
      assert.equal(rows.length, 1);
      epId = rows[0].id;
      assert.equal(rows[0].status, 'gravado');
      assert.equal(rows[0].number, 1);
      assert.equal(rows[0].title, 'Conversa com Dr. Marcos Lima');
      assert.ok(rows[0].recorded_on, 'data da gravação');
      assert.equal(rows[0].aired_on, null, 'veiculação é outra data');
      const { rows: tasks } = await h.db.query('SELECT kind, status FROM tasks WHERE episode_id=$1 ORDER BY id', [epId]);
      assert.deepEqual(tasks.map((t) => t.kind), ['cortes', 'bastidores', 'extra']);
      assert.ok(tasks.every((t) => t.status === 'a_fazer'));
      assert.equal((await h.db.query("SELECT count(*)::int n FROM episode_events WHERE episode_id=$1 AND type='criado'", [epId])).rows[0].n, 1);
    });

    it('é idempotente: salvar o convidado de novo não duplica o episódio', async () => {
      await as.prod.act(`/convidados/${guestId}`, guestFields({ ...scheduled, status: 'gravado', notes: 'ajuste' }), { from: `/convidados/${guestId}/editar` });
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episodes WHERE guest_id=$1', [guestId])).rows[0].n, 1);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM tasks WHERE episode_id=$1', [epId])).rows[0].n, 3);
    });

    it('o quadro e a lista mostram o episódio; "só os meus" filtra pelo editor', async () => {
      const board = (await as.editor.get('/episodios')).text;
      for (const key of ['gravado', 'disponivel_edicao', 'em_edicao', 'em_revisao', 'em_finalizacao', 'pronto_publicar', 'publicado']) assert.match(board, new RegExp(`data-status="${key}"`), key);
      for (const key of ['planejado', 'agendado']) assert.doesNotMatch(board, new RegExp(`data-status="${key}"`), `${key} não é etapa do episódio`);
      assert.match(board, /Conversa com Dr\. Marcos Lima/);
      assert.match(board, /EP\.001/);
      assert.match((await as.editor.get('/episodios?view=lista')).text, /Conversa com Dr\. Marcos Lima/);
      assert.doesNotMatch((await as.editor.get('/episodios?editor=eu')).text, /Conversa com Dr\. Marcos Lima/, 'ainda não é do Edu');
      const page = await as.editor.get(`/episodios/${epId}`);
      assert.equal(page.status, 200);
      assert.match(page.text, /EP\.001/);
      assert.match(page.text, /Próximo passo/);
    });
  });

  // ---------------------------------------------------------------- material bruto
  describe('envio de arquivos grandes em partes (Backblaze)', () => {
    it('envia em várias partes, remonta no bucket com os mesmos bytes e registra tudo', async () => {
      const data = rnd(64 * 1024 * 3 + 1234); // 4 partes de 64 KB
      const { init, id, done } = await upload(as.prod, epId, { data });
      assert.equal(init.totalParts, 4);
      assert.equal(init.partSize, 64 * 1024);
      assert.equal(done.status, 200);
      const { rows: [f] } = await h.db.query('SELECT * FROM episode_files WHERE id=$1', [id]);
      assert.equal(f.status, 'pronto');
      assert.equal(f.kind, 'bruto_video');
      assert.equal(f.label, 'Câmera 1');
      assert.equal(Number(f.size_bytes), data.length);
      assert.equal(f.upload_id, null);
      assert.match(f.storage_key, new RegExp(`^pp/episodios/${epId}/bruto_video-[0-9a-f]{16}\\.mp4$`));
      assert.ok(h.b2Store.get(f.storage_key).body.equals(data), 'bytes idênticos');
      assert.equal(h.b2Store.get(f.storage_key).contentType, 'video/mp4');
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_file_parts WHERE file_id=$1', [id])).rows[0].n, 0, 'partes temporárias limpas');
      assert.equal(h.b2Multipart.size, 0, 'nenhum envio pendente no bucket');
      assert.ok(h.b2Calls.some((c) => c.query?.uploadId && c.method === 'PUT'));
      assert.match((await as.prod.get(`/episodios/${epId}`)).text, /camera1\.mp4/);
    });

    it('aceita as quatro câmeras, áudio, bastidores e fotografias', async () => {
      for (const [kind, name, label, type] of [
        ['bruto_video', 'camera2.mov', 'Câmera 2', 'video/quicktime'], ['bruto_video', 'camera3.mp4', 'Câmera 3', 'video/mp4'], ['bruto_video', 'camera4.mxf', 'Câmera 4', ''],
        ['bruto_audio', 'mesa.wav', 'Áudio da mesa', 'audio/wav'], ['bastidor', 'bastidor.mp4', '', 'video/mp4'], ['bastidor', 'foto-bastidor.jpg', '', 'image/jpeg'],
        ['foto', 'retrato.jpg', 'Retrato', 'image/jpeg'], ['outro', 'roteiro.pdf', '', 'application/pdf'],
      ]) {
        const r = await upload(as.prod, epId, { kind, name, label, data: rnd(70_000), type });
        assert.equal(r.done?.status, 200, `${kind} ${name}: ${JSON.stringify(r.init)}`);
      }
      const { rows } = await h.db.query("SELECT kind, count(*)::int n FROM episode_files WHERE episode_id=$1 AND status='pronto' GROUP BY kind ORDER BY kind", [epId]);
      assert.deepEqual(rows, [{ kind: 'bastidor', n: 2 }, { kind: 'bruto_audio', n: 1 }, { kind: 'bruto_video', n: 4 }, { kind: 'foto', n: 1 }, { kind: 'outro', n: 1 }]);
    });

    it('valida tipo, formato, tamanho, permissão e CSRF', async () => {
      const init = (client, body, opts) => api(client, 'POST', `/episodios/${epId}/arquivos/iniciar`, { json: body, ...opts });
      assert.equal((await init(as.prod, { kind: 'inventado', nome: 'a.mp4', tamanho: 10 })).status, 400);
      const ext = await init(as.prod, { kind: 'bruto_video', nome: 'planilha.xlsx', tamanho: 10 });
      assert.equal(ext.status, 400);
      assert.match(ext.json.error, /Formato não aceito/);
      assert.equal((await init(as.prod, { kind: 'bruto_video', nome: 'a.mp4', tamanho: 0 })).status, 400);
      assert.equal((await init(as.prod, { kind: 'bruto_video', nome: 'a.mp4', tamanho: 300 * 1024 ** 3 })).status, 400, 'passa do limite de 200 GB');
      assert.equal((await init(as.prod, { kind: 'editado', nome: 'final.mp4', tamanho: 10 })).status, 403, 'produtora não sobe o vídeo editado');
      assert.equal((await init(as.prod, { kind: 'bruto_video', nome: 'a.mp4', tamanho: 10 }, { csrf: false })).status, 403, 'sem CSRF');
      const anon = await fetch(`${app.base}/episodios/${epId}/arquivos/iniciar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', redirect: 'manual' });
      assert.equal(anon.status, 401);
      assert.equal((await api(as.editor, 'POST', '/episodios/99999999/arquivos/iniciar', { json: { kind: 'foto', nome: 'a.jpg', tamanho: 5 } })).status, 404);
    });

    it('recusa parte com tamanho errado e fecha só com todas as partes; dá para retomar', async () => {
      const data = rnd(64 * 1024 * 2 + 10); // 3 partes
      const init = await api(as.prod, 'POST', `/episodios/${epId}/arquivos/iniciar`, { json: { kind: 'bruto_audio', nome: 'retomar.wav', tamanho: data.length, tipo: 'audio/wav' } });
      const { id } = init.json;
      const wrong = await api(as.prod, 'PUT', `/episodios/${epId}/arquivos/${id}/parte/1`, { raw: bytes(1000) });
      assert.equal(wrong.status, 400);
      assert.match(wrong.json.error, /deveria ter 65536 bytes/);
      assert.equal((await api(as.prod, 'PUT', `/episodios/${epId}/arquivos/${id}/parte/9`, { raw: bytes(10) })).status, 400, 'parte fora do intervalo');
      assert.equal((await api(as.prod, 'PUT', `/episodios/${epId}/arquivos/${id}/parte/1`, { raw: data.subarray(0, 65536) })).status, 200);
      const early = await api(as.prod, 'POST', `/episodios/${epId}/arquivos/${id}/concluir`);
      assert.equal(early.status, 409);
      assert.match(early.json.error, /Faltam partes: recebi 1 de 3/);
      const listed = await api(as.prod, 'GET', `/episodios/${epId}/arquivos/${id}/partes`);
      assert.deepEqual(listed.json.parts, [1], 'o navegador sabe o que já foi');
      assert.equal((await api(as.prod, 'PUT', `/episodios/${epId}/arquivos/${id}/parte/2`, { raw: data.subarray(65536, 131072) })).status, 200);
      assert.equal((await api(as.prod, 'PUT', `/episodios/${epId}/arquivos/${id}/parte/3`, { raw: data.subarray(131072) })).status, 200);
      assert.equal((await api(as.prod, 'PUT', `/episodios/${epId}/arquivos/${id}/parte/3`, { raw: data.subarray(131072) })).status, 200, 'reenviar a mesma parte é seguro');
      assert.equal((await api(as.prod, 'POST', `/episodios/${epId}/arquivos/${id}/concluir`)).status, 200);
      assert.equal((await api(as.prod, 'POST', `/episodios/${epId}/arquivos/${id}/concluir`)).status, 200, 'concluir duas vezes é seguro');
      const { rows: [f] } = await h.db.query('SELECT storage_key FROM episode_files WHERE id=$1', [id]);
      assert.ok(h.b2Store.get(f.storage_key).body.equals(data));
      assert.equal((await api(as.prod, 'PUT', `/episodios/${epId}/arquivos/${id}/parte/1`, { raw: data.subarray(0, 65536) })).status, 404, 'envio concluído não aceita mais partes');
    });

    it('cancelar um envio no meio apaga o registro e aborta no bucket', async () => {
      const init = await api(as.prod, 'POST', `/episodios/${epId}/arquivos/iniciar`, { json: { kind: 'foto', nome: 'cancelar.jpg', tamanho: 200_000, tipo: 'image/jpeg' } });
      const { id } = init.json;
      await api(as.prod, 'PUT', `/episodios/${epId}/arquivos/${id}/parte/1`, { raw: bytes(65536) });
      assert.equal(h.b2Multipart.size, 1);
      assert.equal((await api(as.prod, 'POST', `/episodios/${epId}/arquivos/${id}/cancelar`)).status, 200);
      assert.equal(h.b2Multipart.size, 0);
      assert.equal((await h.db.query('SELECT 1 FROM episode_files WHERE id=$1', [id])).rowCount, 0);
      const done = await upload(as.prod, epId, { kind: 'foto', name: 'pronta.jpg', data: rnd(10), type: 'image/jpeg' });
      assert.equal((await api(as.prod, 'POST', `/episodios/${epId}/arquivos/${done.id}/cancelar`)).status, 409, 'não cancela o que já foi enviado');
    });

    it('baixar e reproduzir usam links assinados temporários (nada de arquivo passando pelo servidor)', async () => {
      const { rows: [f] } = await h.db.query("SELECT id, storage_key FROM episode_files WHERE episode_id=$1 AND label='Câmera 1'", [epId]);
      const dl = await as.editor.get(`/episodios/${epId}/arquivos/${f.id}/baixar`);
      assert.equal(dl.status, 302);
      const url = new URL(dl.location);
      assert.equal(url.host, 's3.test-region.backblazeb2.com');
      assert.equal(url.pathname, `/test-bucket/${f.storage_key}`);
      assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
      assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
      assert.match(url.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
      assert.match(url.searchParams.get('response-content-disposition'), /^attachment; filename\*=UTF-8''camera1\.mp4$/);
      assert.equal(dl.headers.get('cache-control'), 'no-store');
      const view = await as.editor.get(`/episodios/${epId}/arquivos/${f.id}/ver`);
      assert.equal(view.status, 302);
      const vurl = new URL(view.location);
      assert.equal(vurl.searchParams.get('response-content-disposition'), null, 'reproduz, não baixa');
      assert.equal(vurl.searchParams.get('X-Amz-Expires'), String(6 * 3600));
      assert.equal((await anonGet(`/episodios/${epId}/arquivos/${f.id}/baixar`)).status, 302, 'anônimo vai para o login');
      assert.match((await anonGet(`/episodios/${epId}/arquivos/${f.id}/baixar`)).location, /\/login/);
      assert.equal((await as.editor.get(`/episodios/${epId}/arquivos/99999/baixar`)).status, 404);
      assert.equal((await as.editor.get(`/episodios/${epId + 100}/arquivos/${f.id}/baixar`)).status, 404, 'arquivo de outro episódio não vaza');
    });

    it('remover apaga do bucket; editor de vídeo pode subir material bruto', async () => {
      const r = await upload(as.editor, epId, { kind: 'foto', name: 'extra.png', data: rnd(500), type: 'image/png', label: '' });
      assert.equal(r.done.status, 200);
      const { rows: [f] } = await h.db.query('SELECT storage_key FROM episode_files WHERE id=$1', [r.id]);
      assert.ok(h.b2Store.has(f.storage_key));
      assert.equal((await as.editor.act(`/episodios/${epId}/arquivos/${r.id}/excluir`, {}, { from: `/episodios/${epId}` })).status, 302);
      assert.equal(h.b2Store.has(f.storage_key), false);
    });
  });
  const anonGet = (path) => fetch(`${app.base}${path}`, { redirect: 'manual' }).then(async (r) => ({ status: r.status, location: r.headers.get('location') }));

  // ---------------------------------------------------------------- etapas, papéis e travas
  describe('etapas, papéis e travas', () => {
    it('só quem tem permissão faz cada passo (editor não libera para edição)', async () => {
      const denied = await move(as.editor, epId, 'disponivel_edicao');
      assert.equal(denied.status, 422);
      assert.match(denied.json.error, /perfil não pode/);
      assert.equal((await ep(epId)).status, 'gravado');
    });

    it('não dá para pular etapas', async () => {
      const skip = await move(as.gestao, epId, 'publicado');
      assert.equal(skip.status, 422);
      assert.match(skip.json.error, /não é permitida/);
      assert.equal((await move(as.gestao, epId, 'inventada')).status, 422);
    });

    it('liberar para edição exige vídeo bruto enviado; ao liberar, os checklists padrão são aplicados', async () => {
      await h.db.query("UPDATE episode_files SET status='enviando' WHERE episode_id=$1 AND kind='bruto_video'", [epId]); // simula nada concluído
      const blocked = await move(as.prod, epId, 'disponivel_edicao');
      assert.equal(blocked.status, 422);
      assert.match(blocked.json.error, /ao menos um vídeo bruto enviado/);
      await h.db.query("UPDATE episode_files SET status='pronto' WHERE episode_id=$1 AND kind='bruto_video'", [epId]);
      const ok = await move(as.prod, epId, 'disponivel_edicao');
      assert.equal(ok.status, 200);
      assert.equal((await ep(epId)).status, 'disponivel_edicao');
      const { rows } = await h.db.query('SELECT gate, count(*)::int n, bool_and(required) req FROM episode_checklist_items WHERE episode_id=$1 GROUP BY gate ORDER BY gate', [epId]);
      assert.deepEqual(rows, [{ gate: 'finalizado', n: 6, req: true }, { gate: 'revisao', n: 7, req: true }]);
    });

    it('o editor assume a edição e vira o editor do episódio; a produtora não assume', async () => {
      assert.equal((await move(as.prod, epId, 'em_edicao')).status, 422);
      assert.equal((await move(as.editor, epId, 'em_edicao')).status, 200);
      const e = await ep(epId);
      assert.equal(e.status, 'em_edicao');
      assert.equal(e.editor_id, editor.id);
      assert.match((await as.editor.get('/episodios?editor=eu')).text, /Conversa com Dr\. Marcos Lima/);
    });

    it('enviar para revisão exige o vídeo editado e os itens obrigatórios do checklist', async () => {
      const blocked = await move(as.editor, epId, 'em_revisao');
      assert.equal(blocked.status, 422);
      assert.match(blocked.json.error, /o vídeo editado enviado/);
      assert.match(blocked.json.error, /checklist antes da revisão: Áudio equalizado/);
      assert.match(blocked.json.error, /e mais 4/, 'resume quando são muitos');
    });

    it('o vídeo editado é do editor (v1, v2…); a produtora é barrada', async () => {
      const v1 = await upload(as.editor, epId, { kind: 'editado', name: 'episodio-v1.mp4', data: rnd(64 * 1024 + 500), label: '' });
      assert.equal(v1.done.status, 200);
      assert.equal((await h.db.query('SELECT version FROM episode_files WHERE id=$1', [v1.id])).rows[0].version, 1);
      const denied = await api(as.prod, 'POST', `/episodios/${epId}/arquivos/iniciar`, { json: { kind: 'editado', nome: 'x.mp4', tamanho: 10, tipo: 'video/mp4' } });
      assert.equal(denied.status, 403);
      const txt = await api(as.editor, 'POST', `/episodios/${epId}/arquivos/iniciar`, { json: { kind: 'editado', nome: 'x.txt', tamanho: 10 } });
      assert.equal(txt.status, 400, 'vídeo editado precisa ser vídeo');
    });

    it('marcar os itens obrigatórios libera o envio para revisão (marcação fica registrada)', async () => {
      const still = await move(as.editor, epId, 'em_revisao');
      assert.equal(still.status, 422);
      assert.doesNotMatch(still.json.error, /vídeo editado/);
      const n = await tickAll(as.editor, epId, 'revisao');
      assert.equal(n, 7);
      const { rows: [it] } = await h.db.query("SELECT done, done_by, done_at FROM episode_checklist_items WHERE episode_id=$1 AND gate='revisao' LIMIT 1", [epId]);
      assert.equal(it.done, true);
      assert.equal(it.done_by, editor.id);
      assert.ok(it.done_at);
      const sent = await move(as.editor, epId, 'em_revisao');
      assert.equal(sent.status, 200);
      const e = await ep(epId);
      assert.equal(e.status, 'em_revisao');
      assert.equal(e.review_round, 1);
    });

    it('na revisão, o editor não aprova; a gestão não pede ajuste sem comentar', async () => {
      assert.equal((await move(as.editor, epId, 'em_finalizacao')).status, 422);
      const noComment = await move(as.gestao, epId, 'em_edicao');
      assert.equal(noComment.status, 422);
      assert.match(noComment.json.error, /comentário em aberto/);
    });

    it('comentários na minutagem: no ponto, geral, validação e quem pode apagar', async () => {
      const { rows: [v1] } = await h.db.query("SELECT id FROM episode_files WHERE episode_id=$1 AND kind='editado' ORDER BY version DESC LIMIT 1", [epId]);
      const at = await form(as.gestao, `/episodios/${epId}/comentarios`, { body: 'Cortar o silêncio aqui', at_ms: '83500', file_id: String(v1.id) });
      assert.equal(at.status, 200);
      const general = await form(as.gestao, `/episodios/${epId}/comentarios`, { body: 'Ritmo bom no geral', at_ms: '' });
      assert.equal(general.status, 200);
      assert.equal((await form(as.gestao, `/episodios/${epId}/comentarios`, { body: '' })).status, 400);
      assert.equal((await form(as.gestao, `/episodios/${epId}/comentarios`, { body: 'x', at_ms: '-5' })).status, 400);
      assert.equal((await form(as.gestao, `/episodios/${epId}/comentarios`, { body: 'x', at_ms: 'abc' })).status, 400);
      assert.equal((await form(as.gestao, `/episodios/${epId}/comentarios`, { body: 'x', at_ms: '999999999999' })).status, 400);
      const { rows } = await h.db.query('SELECT at_ms, file_id, resolved, author_id FROM episode_comments WHERE episode_id=$1 ORDER BY id', [epId]);
      assert.deepEqual(rows.map((r) => r.at_ms), [83500, null]);
      assert.equal(rows[0].file_id, v1.id);
      assert.equal(rows[0].author_id, gestao.id);
      const page = (await as.editor.get(`/episodios/${epId}`)).text;
      assert.match(page, /1:23/, 'minutagem formatada');
      assert.match(page, /Cortar o silêncio aqui/);
      assert.match(page, /<video controls/);
      assert.match(page, new RegExp(`src="/episodios/${epId}/arquivos/${v1.id}/ver#t=0\\.1"`));
      assert.equal((await form(as.prod, `/episodios/${epId}/comentarios`, { body: 'oi' })).status, 200, 'produtora pode comentar (manage)');
      const outsider = await h.db.query("SELECT id FROM episode_comments WHERE body='oi'");
      assert.equal((await as.editor.act(`/episodios/${epId}/comentarios/${outsider.rows[0].id}/excluir`, {}, { from: `/episodios/${epId}` })).status, 403, 'editor não apaga comentário alheio');
      assert.equal((await as.gestao.act(`/episodios/${epId}/comentarios/${outsider.rows[0].id}/excluir`, {}, { from: `/episodios/${epId}` })).status, 302, 'gestão apaga');
    });

    it('pedir ajustes devolve ao editor; o editor resolve, sobe a v2 e reenvia (checklist continua marcado)', async () => {
      assert.equal((await move(as.gestao, epId, 'em_edicao')).status, 200);
      assert.equal((await ep(epId)).status, 'em_edicao');
      const { rows: [c] } = await h.db.query("SELECT id FROM episode_comments WHERE at_ms=83500");
      const solve = await form(as.editor, `/episodios/${epId}/comentarios/${c.id}/resolver`, { resolved: '1' });
      assert.equal(solve.status, 200);
      assert.equal((await h.db.query('SELECT resolved, resolved_by FROM episode_comments WHERE id=$1', [c.id])).rows[0].resolved, true);
      const v2 = await upload(as.editor, epId, { kind: 'editado', name: 'episodio-v2.mp4', data: rnd(70_000), label: '' });
      assert.equal((await h.db.query('SELECT version FROM episode_files WHERE id=$1', [v2.id])).rows[0].version, 2);
      assert.equal((await move(as.editor, epId, 'em_revisao')).status, 200, 'o checklist já estava completo');
      assert.equal((await ep(epId)).review_round, 2);
      const page = (await as.gestao.get(`/episodios/${epId}`)).text;
      assert.match(page, new RegExp(`/arquivos/${v2.id}/ver`), 'a revisão mostra sempre a versão mais nova');
    });

    it('aprovar leva à finalização; marcar pronto exige o checklist de finalização', async () => {
      assert.equal((await move(as.gestao, epId, 'em_finalizacao')).status, 200);
      const blocked = await move(as.gestao, epId, 'pronto_publicar');
      assert.equal(blocked.status, 422);
      assert.match(blocked.json.error, /checklist antes de finalizar: Todos os comentários/);
      assert.equal(await tickAll(as.gestao, epId, 'finalizado'), 6);
      const noText = await move(as.gestao, epId, 'pronto_publicar');
      assert.equal(noText.status, 422, 'faltam os textos de publicação');
      assert.match(noText.json.error, /título do YouTube válido · descrição do YouTube válida · título do Spotify válido · descrição do Spotify válida · texto da thumbnail/);
      await as.gestao.act(`/episodios/${epId}/metadados`, {
        yt_title: 'Governança e sucessão com Marcos Lima', yt_description: 'Marcos Lima fala de governança.\n\nNeste episódio:\n- Sucessão', yt_tags: 'governança, sucessão',
        sp_title: 'Governança e sucessão', sp_description: 'Uma conversa sobre governança.', thumb_text: 'Sem ego, sem vaidade',
      }, { from: `/episodios/${epId}` });
      assert.equal((await move(as.gestao, epId, 'pronto_publicar')).status, 200);
      assert.equal((await ep(epId)).status, 'pronto_publicar');
    });

    it('publicar exige os links do YouTube e do Spotify (domínios corretos); o convidado continua em Gravado', async () => {
      const blocked = await move(as.gestao, epId, 'publicado');
      assert.equal(blocked.status, 422);
      assert.match(blocked.json.error, /link do vídeo no YouTube · link do episódio no Spotify/);
      const bad = await as.gestao.act(`/episodios/${epId}/links`, { youtube_url: 'https://vimeo.com/1', spotify_url: 'https://open.spotify.com/episode/x' }, { from: `/episodios/${epId}` });
      assert.equal(bad.status, 302);
      assert.equal((await ep(epId)).youtube_url, null);
      assert.equal((await as.editor.act(`/episodios/${epId}/links`, { youtube_url: 'https://youtu.be/abc', spotify_url: 'https://open.spotify.com/episode/x' }, { from: `/episodios/${epId}` })).status, 403, 'só a gestão publica');
      await as.gestao.act(`/episodios/${epId}/links`, { youtube_url: 'youtu.be/abc123', spotify_url: 'https://open.spotify.com/episode/xyz' }, { from: `/episodios/${epId}` });
      assert.equal((await move(as.gestao, epId, 'publicado')).status, 200);
      const e = await ep(epId);
      assert.equal(e.status, 'publicado');
      assert.ok(e.published_at);
      const { rows: [g] } = await h.db.query('SELECT status FROM guests WHERE id=$1', [guestId]);
      assert.equal(g.status, 'gravado', 'o que se publica é o episódio; o convidado termina em Gravado');
      assert.equal(e.youtube_url, 'https://youtu.be/abc123');
      assert.match((await as.gestao.get(`/convidados/${guestId}`)).text, /No ar/);
      assert.deepEqual((await api(as.gestao, 'GET', `/episodios/${epId}`)).status, 200);
      const { rows: ev } = await h.db.query("SELECT message FROM episode_events WHERE episode_id=$1 AND type='etapa' ORDER BY id", [epId]);
      assert.equal(ev.length, 8, 'cada passo ficou no histórico (liberado, assumido, revisão, ajustes, revisão, aprovado, pronto, publicado)');
      assert.match(ev.at(-1).message, /Pronto para publicar → Publicado/);
    });
  });
  const form = async (client, path, data) => {
    const token = await client.csrf('/episodios');
    const res = await fetch(`${app.base}${path}`, {
      method: 'POST', headers: { cookie: client.cookie(), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'x-csrf-token': token }, body: new URLSearchParams(data), redirect: 'manual',
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  // ---------------------------------------------------------------- checklists padronizados
  describe('checklists padronizados', () => {
    it('editor e gestão mantêm os modelos; a produtora não', async () => {
      assert.equal((await as.editor.get('/episodios/checklists')).status, 200);
      assert.equal((await as.gestao.get('/episodios/checklists')).status, 200);
      assert.equal((await as.prod.get('/episodios/checklists')).status, 403);
      assert.equal((await as.prod.act('/episodios/checklists', { name: 'x', items: 'a' }, { from: '/episodios' })).status, 403);
      const page = (await as.editor.get('/episodios/checklists')).text;
      assert.match(page, /Edição — antes da revisão/);
      assert.match(page, /Áudio equalizado e normalizado/);
    });

    it('criar e editar modelos: itens por linha, porta e obrigatoriedade; episódios já aplicados não mudam', async () => {
      const before = (await h.db.query('SELECT count(*)::int n FROM episode_checklist_items WHERE episode_id=$1', [epId])).rows[0].n;
      await as.editor.act('/episodios/checklists', { name: 'Cortes — antes de liberar', gate: 'finalizado', required: '1', items: 'Legendas conferidas\nMúsica sem direito autoral\n\n  Capa aprovada  ' }, { from: '/episodios/checklists' });
      const { rows: [t] } = await h.db.query("SELECT * FROM checklist_templates WHERE name='Cortes — antes de liberar'");
      assert.equal(t.gate, 'finalizado');
      assert.equal(t.required, true);
      assert.deepEqual((await h.db.query('SELECT text FROM checklist_template_items WHERE template_id=$1 ORDER BY position', [t.id])).rows.map((r) => r.text), ['Legendas conferidas', 'Música sem direito autoral', 'Capa aprovada']);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_checklist_items WHERE episode_id=$1', [epId])).rows[0].n, before, 'cópia antiga intacta');

      await as.gestao.act(`/episodios/checklists/${t.id}`, { name: 'Cortes — antes de liberar', gate: 'livre', items: 'Só um item', active: '1' }, { from: '/episodios/checklists' });
      const { rows: [t2] } = await h.db.query('SELECT gate, required FROM checklist_templates WHERE id=$1', [t.id]);
      assert.deepEqual(t2, { gate: 'livre', required: false });
      assert.equal((await as.editor.act('/episodios/checklists', { name: '', items: '' }, { from: '/episodios/checklists' })).status, 302);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM checklist_templates')).rows[0].n, 3, 'inválido não cria');
    });

    it('um episódio novo recebe os modelos ATIVOS; modelo desativado, não; itens "livres" e não obrigatórios não travam', async () => {
      await h.db.query("UPDATE checklist_templates SET active=false WHERE name LIKE 'Finalização%'");
      const r = await as.prod.act('/convidados', guestFields({ name: 'Segunda Convidada', instagram: '@segunda', email: 'segunda@exemplo.com', ...scheduled, status: 'gravado' }), { from: '/convidados/novo' });
      const { rows: [e2] } = await h.db.query('SELECT id FROM episodes WHERE guest_id=$1', [r.location.split('/').pop()]);
      assert.equal(e2.id !== epId, true);
      await h.db.query("UPDATE episodes SET status='gravado' WHERE id=$1", [e2.id]);
      await upload(as.prod, e2.id, { data: rnd(1000), name: 'c1.mp4' });
      assert.equal((await move(as.prod, e2.id, 'disponivel_edicao')).status, 200);
      const { rows } = await h.db.query('SELECT group_name, gate, required, count(*)::int n FROM episode_checklist_items WHERE episode_id=$1 GROUP BY group_name, gate, required ORDER BY group_name', [e2.id]);
      assert.deepEqual(rows.map((x) => [x.group_name, x.gate, x.n]), [['Cortes — antes de liberar', 'livre', 1], ['Edição — antes da revisão', 'revisao', 7]]);
      await move(as.editor, e2.id, 'em_edicao');
      const v = await upload(as.editor, e2.id, { kind: 'editado', name: 'v1.mp4', data: rnd(500), label: '' });
      assert.equal(v.done.status, 200);
      await tickAll(as.editor, e2.id, 'revisao');
      assert.equal((await move(as.editor, e2.id, 'em_revisao')).status, 200, 'item livre em aberto não trava');
      await h.db.query("UPDATE checklist_templates SET active=true WHERE name LIKE 'Finalização%'");
    });

    it('itens avulsos do episódio: adicionar (obrigatório ou não), marcar e remover só os avulsos', async () => {
      const e = (await h.db.query("SELECT id FROM episodes WHERE status='em_revisao' LIMIT 1")).rows[0].id;
      await as.editor.act(`/episodios/${e}/checklist`, { text: 'Conferir o nome do patrocinador', gate: 'revisao', required: '1' }, { from: `/episodios/${e}` });
      const { rows: [it] } = await h.db.query("SELECT * FROM episode_checklist_items WHERE episode_id=$1 AND text LIKE 'Conferir o nome%'", [e]);
      assert.equal(it.template_id, null);
      assert.equal(it.required, true);
      assert.equal(it.done, false);
      assert.equal((await as.editor.act(`/episodios/${e}/checklist/${it.id}/excluir`, {}, { from: `/episodios/${e}` })).status, 302);
      assert.equal((await h.db.query('SELECT 1 FROM episode_checklist_items WHERE id=$1', [it.id])).rowCount, 0);
      const { rows: [tpl] } = await h.db.query('SELECT id FROM episode_checklist_items WHERE episode_id=$1 AND template_id IS NOT NULL LIMIT 1', [e]);
      await as.editor.act(`/episodios/${e}/checklist/${tpl.id}/excluir`, {}, { from: `/episodios/${e}` });
      assert.equal((await h.db.query('SELECT 1 FROM episode_checklist_items WHERE id=$1', [tpl.id])).rowCount, 1, 'item de modelo não some');
      assert.equal((await as.gestao.get(`/episodios/${e}`)).status, 200);
    });

    it('excluir um modelo não apaga o que já foi aplicado aos episódios', async () => {
      const { rows: [t] } = await h.db.query("SELECT id FROM checklist_templates WHERE name LIKE 'Cortes%'");
      const before = (await h.db.query('SELECT count(*)::int n FROM episode_checklist_items WHERE template_id=$1', [t.id])).rows[0].n;
      assert.ok(before >= 1);
      assert.equal((await as.editor.act(`/episodios/checklists/${t.id}/excluir`, {}, { from: '/episodios/checklists' })).status, 302);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_checklist_items WHERE text=$1', ['Só um item'])).rows[0].n, before, 'itens ficam, só perdem o vínculo com o modelo');
    });
  });

  // ---------------------------------------------------------------- tarefas, observações e patrocinadores
  describe('tarefas, observações e material dos patrocinadores', () => {
    let e;
    before(async () => { e = (await h.db.query("SELECT id FROM episodes ORDER BY id LIMIT 1")).rows[0].id; });

    it('observações para o editor e definição do editor: só quem gerencia a produção', async () => {
      await as.prod.act(`/episodios/${e}/observacoes`, { editor_notes: 'Evitar o trecho sobre política. Começar pela história do hospital.' }, { from: `/episodios/${e}` });
      assert.match((await as.editor.get(`/episodios/${e}`)).text, /Evitar o trecho sobre política/);
      assert.equal((await as.editor.act(`/episodios/${e}/observacoes`, { editor_notes: 'hack' }, { from: `/episodios/${e}` })).status, 403);
      await as.prod.act(`/episodios/${e}/editor`, { editor_id: editor2.id }, { from: `/episodios/${e}` });
      assert.equal((await ep(e)).editor_id, editor2.id);
      assert.equal((await as.prod.act(`/episodios/${e}/editor`, { editor_id: produtora.id }, { from: `/episodios/${e}` })).status, 302);
      assert.equal((await ep(e)).editor_id, editor2.id, 'quem não é editor/gestão não entra como editor');
    });

    it('tarefas: andamento por quem produz, responsável e prazo só pela gestão da produção; apagar só gerência', async () => {
      const { rows: [t] } = await h.db.query("SELECT id, assignee_id, due_on FROM tasks WHERE episode_id=$1 AND kind='cortes'", [e]);
      assert.ok(t.assignee_id, 'a rotina "do editor" passou para o primeiro editor definido (trocas depois não roubam a tarefa)');
      assert.ok(t.due_on, 'a rotina já define o vencimento');
      await as.editor.act(`/episodios/${e}/tarefas/${t.id}`, { status: 'fazendo', kind: 'cortes', notes: 'Começando', assignee_id: editor.id, due_on: '2026-12-31' }, { from: `/episodios/${e}` });
      let row = (await h.db.query('SELECT status, notes, assignee_id, due_on FROM tasks WHERE id=$1', [t.id])).rows[0];
      assert.equal(row.status, 'fazendo');
      assert.equal(row.notes, 'Começando');
      assert.equal(row.assignee_id, t.assignee_id, 'editor não reatribui');
      assert.equal(String(row.due_on), String(t.due_on), 'nem muda o prazo');
      await as.prod.act(`/episodios/${e}/tarefas/${t.id}`, { status: 'fazendo', kind: 'cortes', assignee_id: editor.id, due_on: '2026-12-31' }, { from: `/episodios/${e}` });
      row = (await h.db.query('SELECT assignee_id, due_on FROM tasks WHERE id=$1', [t.id])).rows[0];
      assert.equal(row.assignee_id, editor.id);
      assert.match(String(row.due_on), /2026/);
      await as.prod.act(`/episodios/${e}/tarefas`, { kind: 'extra', title: 'Reação do convidado ao ver o corte' }, { from: `/episodios/${e}` });
      assert.equal((await h.db.query('SELECT count(*)::int n FROM tasks WHERE episode_id=$1', [e])).rows[0].n, 4);
      assert.equal((await as.editor.act(`/episodios/${e}/tarefas`, { title: 'x tarefa' }, { from: `/episodios/${e}` })).status, 403);
      const { rows: [extra] } = await h.db.query("SELECT id FROM tasks WHERE title LIKE 'Reação%'");
      assert.equal((await as.editor.act(`/episodios/${e}/tarefas/${extra.id}/excluir`, {}, { from: `/episodios/${e}` })).status, 403);
      assert.equal((await as.prod.act(`/episodios/${e}/tarefas/${extra.id}/excluir`, {}, { from: `/episodios/${e}` })).status, 302);
      assert.match((await as.prod.get('/episodios')).text, /1\/3|0\/3|0\/4/);
    });

    it('o editor vê os patrocinadores do episódio com moldura, QR Code, oferta e o que não pode ser dito', async () => {
      const { rows: [s] } = await h.db.query(
        "INSERT INTO sponsors (company, kind, tier, stage, public_token) VALUES ('America Licenciamentos','negocio','diamond','ativo','tok-prod-test-0001-xxxxxxxx') RETURNING id");
      await h.db.query("INSERT INTO sponsor_briefs (sponsor_id, restrictions, slogan, offer) VALUES ($1,'Não prometer retorno financeiro','Sua marca, em todo lugar','Diagnóstico gratuito')", [s.id]);
      await h.db.query("INSERT INTO sponsor_files (sponsor_id, kind, storage_key, filename, content_type) VALUES ($1,'moldura','pp/patrocinadores/1/moldura-x.png','moldura.png','image/png'), ($1,'qrcode','pp/patrocinadores/1/qr-x.png','qr.png','image/png')", [s.id]);
      await h.db.query("INSERT INTO sponsor_deliverables (sponsor_id, kind, link_url) VALUES ($1,'qr_code','https://america.com.br/pulso')", [s.id]);
      await h.db.query("INSERT INTO sponsor_episodes (sponsor_id, episode_id, role) VALUES ($1,$2,'exclusivo')", [s.id, e]);
      const page = (await as.editor.get(`/episodios/${e}`)).text;
      assert.match(page, /America Licenciamentos/);
      assert.match(page, /Episódio exclusivo/);
      assert.match(page, new RegExp(`/patrocinadores/${s.id}/arquivos/\\d+\\?baixar=1">[\\s\\S]*?Moldura`));
      assert.match(page, /QR Code<\/a> → https:\/\/america\.com\.br\/pulso/);
      assert.match(page, /Não comunicar:<\/span> Não prometer retorno financeiro/);
      assert.match(page, /Sua marca, em todo lugar/);
      assert.match(page, /Diagnóstico gratuito/);
      assert.match((await as.prod.get('/episodios')).text, /EP\.001/);
    });

    it('a página do patrocinador ativo mostra a produção em andamento como "Em produção"', async () => {
      const { rows: [s] } = await h.db.query("SELECT id, public_token FROM sponsors WHERE company='America Licenciamentos'");
      await h.db.query("UPDATE episodes SET status='em_edicao' WHERE id=$1", [e]);
      const c = h.client(app.base);
      await c.get(`/patrocinador/${s.public_token}/portal`);
      const portal = await c.get('/patrocinador/portal');
      assert.equal(portal.status, 200);
      assert.match(portal.text, /Em produção/);
    });
  });

  // ---------------------------------------------------------------- cadastro avulso e exclusão
  describe('cadastro avulso, edição e exclusão do episódio', () => {
    it('novo episódio = gravação feita: convidado do CRM, convidado novo ou só os hosts (com patrocinador)', async () => {
      const page = (await as.prod.get('/episodios/novo')).text;
      assert.match(page, /Quem sentou à mesa/);
      const post = (body) => as.prod.act('/episodios', body, { from: '/episodios/novo' });
      assert.match((await post({ title: 'Sem origem' })).text, /Escolha quem sentou à mesa/);
      assert.match((await post({ origem: 'hosts', title: 'Só hosts sem patrocínio' })).text, /precisa de um patrocinador/);
      assert.match((await post({ origem: 'novo_convidado', guest_name: 'A', guest_instagram: '@a', guest_profile: 'medico' })).text, /nome do convidado/);

      // convidado novo + patrocinador novo, já ligado como indicado
      let r = await post({ origem: 'novo_convidado', guest_name: 'Dra. Nova', guest_instagram: '@dra.nova', guest_profile: 'medico', relacao: 'indicado', patrocinador: 'novo', sponsor_company: 'Clínica Nova', sponsor_kind: 'negocio', papel: 'exclusivo', number: '20', recorded_on: '2026-10-01' });
      assert.equal(r.status, 302, r.text.slice(0, 300));
      let id = r.location.split('/').pop().split('#')[0];
      let e = await ep(id);
      assert.equal(e.status, 'gravado');
      assert.equal(e.number, 20);
      assert.equal(e.title, 'Conversa com Dra. Nova');
      const { rows: [g] } = await h.db.query('SELECT * FROM guests WHERE id=$1', [e.guest_id]);
      assert.equal(g.status, 'gravado');
      assert.equal(g.sponsor_relation, 'indicado');
      const { rows: [sp] } = await h.db.query('SELECT * FROM sponsors WHERE id=$1', [g.sponsor_id]);
      assert.equal(sp.company, 'Clínica Nova');
      assert.equal(sp.stage, 'negociacao');
      assert.deepEqual((await h.db.query('SELECT role FROM sponsor_episodes WHERE episode_id=$1', [id])).rows, [{ role: 'exclusivo' }]);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM tasks WHERE episode_id=$1', [id])).rows[0].n, 3);
      assert.match((await post({ origem: 'hosts', patrocinador: String(sp.id), number: '20' })).text, /Já existe o episódio 020/);

      // só os hosts, patrocinador existente
      r = await post({ origem: 'hosts', patrocinador: String(sp.id), papel: 'insercao' });
      id = r.location.split('/').pop().split('#')[0];
      e = await ep(id);
      assert.equal(e.guest_id, null);
      assert.equal(e.title, 'Episódio Clínica Nova');
      assert.match((await as.prod.get(`/episodios/${id}`)).text, /Só os hosts · Clínica Nova/);

      // convidado do CRM: vai para Gravado; convidado que já tem episódio é recusado
      const { rows: [crm] } = await h.db.query("INSERT INTO guests (name, instagram, profile, status) VALUES ('Rui CRM', 'rui.crm', 'empresario', 'em_agendamento') RETURNING id");
      r = await post({ origem: 'convidado', guest_id: String(crm.id) });
      assert.equal(r.status, 302);
      assert.equal((await h.db.query('SELECT status FROM guests WHERE id=$1', [crm.id])).rows[0].status, 'gravado');
      assert.match((await post({ origem: 'convidado', guest_id: String(crm.id) })).text, /já tem um episódio/);
      assert.equal((await as.editor.get('/episodios/novo')).status, 403);
    });

    it('editar o episódio muda só os dados básicos (a etapa anda pelos botões)', async () => {
      const { rows: [e0] } = await h.db.query("SELECT id FROM episodes WHERE title = 'Episódio Clínica Nova'");
      await as.prod.act(`/episodios/${e0.id}`, { number: '21', title: 'Especial Clínica Nova', status: 'publicado', recorded_on: '2026-10-02' }, { from: `/episodios/${e0.id}/editar` });
      const e = await ep(e0.id);
      assert.equal(e.title, 'Especial Clínica Nova');
      assert.equal(e.status, 'gravado', 'o formulário não pula etapas');
      assert.equal((await as.editor.get(`/episodios/${e0.id}/editar`)).status, 403);
    });

    it('excluir o episódio apaga os arquivos do bucket (só gestão)', async () => {
      const { rows: [sp0] } = await h.db.query("SELECT id FROM sponsors WHERE company = 'Clínica Nova'");
      const r = await as.prod.act('/episodios', { origem: 'hosts', patrocinador: String(sp0.id), title: 'Para excluir' }, { from: '/episodios/novo' });
      const id = r.location.split('/').pop().split('#')[0];
      const up = await upload(as.prod, id, { data: rnd(900), name: 'apagar.mp4' });
      const { rows: [f] } = await h.db.query('SELECT storage_key FROM episode_files WHERE id=$1', [up.id]);
      const pending = await api(as.prod, 'POST', `/episodios/${id}/arquivos/iniciar`, { json: { kind: 'foto', nome: 'meio.jpg', tamanho: 200_000, tipo: 'image/jpeg' } });
      await api(as.prod, 'PUT', `/episodios/${id}/arquivos/${pending.json.id}/parte/1`, { raw: bytes(65536) });
      assert.equal(h.b2Multipart.size, 1);
      assert.equal((await as.prod.act(`/episodios/${id}/excluir`, {}, { from: '/episodios' })).status, 403);
      assert.equal((await as.gestao.act(`/episodios/${id}/excluir`, {}, { from: '/episodios' })).status, 302);
      assert.equal(h.b2Store.has(f.storage_key), false, 'arquivo pronto saiu do bucket');
      assert.equal(h.b2Multipart.size, 0, 'envio pela metade foi abortado');
      assert.equal((await ep(id)), undefined);
      assert.equal((await h.db.query('SELECT count(*)::int n FROM episode_files WHERE episode_id=$1', [id])).rows[0].n, 0);
    });

    it('IDs malformados ou inexistentes viram 404', async () => {
      for (const p of ['/episodios/abc', '/episodios/99999999', '/episodios/abc/editar']) assert.equal((await as.admin.get(p)).status, 404, p);
      assert.equal((await api(as.admin, 'POST', '/episodios/999999/arquivos/1/concluir')).status, 404);
    });
  });
  // ---------------------------------------------------------------- jornada: a tela acompanha a etapa
  describe('a tela do episódio acompanha a etapa (abas, material recolhido, tarefas em janela)', () => {
    const mk = async (status, extra = {}) => (await h.db.query('INSERT INTO episodes (title, status, editor_id) VALUES ($1,$2,$3) RETURNING id', [`Ep ${status} ${Math.random().toString(36).slice(2, 6)}`, status, extra.editor || null])).rows[0].id;
    const tabsOf = (html) => [...html.matchAll(/data-tab-btn="(\w+)"/g)].map((m) => m[1]).filter((t) => !['financeiro', 'yt', 'sp', 'ch', 'th'].includes(t)); // financeiro tem permissão própria (finance.test.js); yt/sp/ch/th são as abas da janela de textos
    const page = async (client, id) => (await client.get(`/episodios/${id}`)).text;

    it('cada etapa mostra só as abas que fazem sentido (revisão só em revisão)', async () => {
      const expected = {
        gravado: ['resumo', 'material', 'historico'],
        disponivel_edicao: ['resumo', 'material', 'historico'],
        em_edicao: ['resumo', 'material', 'historico'],
        em_revisao: ['resumo', 'material', 'revisao', 'historico'],
        em_finalizacao: ['resumo', 'material', 'finalizacao', 'historico'],
        pronto_publicar: ['resumo', 'material', 'finalizacao', 'historico'],
        publicado: ['resumo', 'material', 'finalizacao', 'historico'],
      };
      const defaults = { agendado: 'resumo', gravado: 'material', em_edicao: 'material', em_revisao: 'revisao', em_finalizacao: 'finalizacao', publicado: 'finalizacao' };
      for (const [status, tabs] of Object.entries(expected)) {
        const html = await page(as.gestao, await mk(status));
        assert.deepEqual(tabsOf(html), tabs, status);
        if (defaults[status]) assert.match(html, new RegExp(`data-tabs data-default="${defaults[status]}"`), `aba inicial em ${status}`);
      }
    });

    it('o player de revisão só existe enquanto o episódio está em revisão; antes, o editor vê só os ajustes pedidos; depois, tudo vai para o histórico', async () => {
      const id = await mk('em_revisao');
      const key = `pp/episodios/${id}/editado-x.mp4`;
      h.b2Store.set(key, { body: bytes(10), contentType: 'video/mp4' });
      await h.db.query("INSERT INTO episode_files (episode_id, kind, filename, content_type, size_bytes, storage_key, status, version) VALUES ($1,'editado','v1.mp4','video/mp4',10,$2,'pronto',1)", [id, key]);
      await h.db.query("INSERT INTO episode_comments (episode_id, file_id, author_id, at_ms, body) SELECT $1, f.id, $2, 5000, 'Cortar o silêncio aqui' FROM episode_files f WHERE f.episode_id=$1", [id, gestao.id]);
      assert.match(await page(as.gestao, id), /data-review/, 'em revisão: player e comentários');
      for (const status of ['em_edicao', 'em_finalizacao', 'publicado']) {
        await h.db.query('UPDATE episodes SET status=$2 WHERE id=$1', [id, status]);
        const html = await page(as.gestao, id);
        assert.doesNotMatch(html, /data-review/, `${status}: sem player de revisão`);
        assert.match(html, /Comentários da revisão \(1\)[\s\S]*Cortar o silêncio aqui/, `${status}: comentário arquivado no histórico`);
      }
      await h.db.query("UPDATE episodes SET status='em_edicao' WHERE id=$1", [id]);
      assert.match(await page(as.editor, id), /Ajustes pedidos na revisão \(1\)/, 'o editor vê o que precisa ajustar');
    });

    it('material bruto enviado vira lista com "Baixar" e o envio fica recolhido; sem arquivos, o envio aparece aberto', async () => {
      const id = await mk('disponivel_edicao');
      const empty = await page(as.prod, id);
      assert.match(empty, /Enviar arquivos/);
      assert.doesNotMatch(empty, /<summary>Enviar mais material<\/summary>/);
      for (const [name, kind] of [['cam1.mp4', 'bruto_video'], ['cam2.mp4', 'bruto_video'], ['mesa.wav', 'bruto_audio']]) {
        const key = `pp/episodios/${id}/${name}`; h.b2Store.set(key, { body: bytes(10), contentType: 'application/octet-stream' });
        await h.db.query("INSERT INTO episode_files (episode_id, kind, label, filename, content_type, size_bytes, storage_key, status) VALUES ($1,$2,$3,$4,'application/octet-stream',10,$5,'pronto')", [id, kind, name, name, key]);
      }
      const full = await page(as.editor, id);
      assert.match(full, /3 arquivos/);
      assert.match(full, /2 vídeo bruto · 1 áudio bruto/);
      assert.equal((full.match(/>\s*(?:<svg[^>]*>.*?<\/svg>)?\s*Baixar\s*</gs) || []).length >= 3, true, 'um botão de baixar por arquivo');
      assert.match(full, /<summary>Enviar mais material<\/summary>/, 'o editor também pode complementar, mas recolhido');
      assert.equal((full.match(/data-uploader/g) || []).length, 2, 'só o envio recolhido (bruto) e o do vídeo editado: nada de formulário aberto');
      const prod = await page(as.prod, id);
      assert.match(prod, /<details class="top-gap"><summary>Enviar mais material<\/summary>/, 'quem sobe bruto vê o envio recolhido');
    });

    it('o vídeo editado também vira "Baixar" + "Enviar nova versão" recolhido, com as versões antigas esmaecidas', async () => {
      const id = await mk('em_edicao');
      assert.match(await page(as.editor, id), /Enviar vídeo editado/);
      for (const v of [1, 2]) {
        const key = `pp/episodios/${id}/ed${v}.mp4`; h.b2Store.set(key, { body: bytes(10), contentType: 'video/mp4' });
        await h.db.query("INSERT INTO episode_files (episode_id, kind, filename, content_type, size_bytes, storage_key, status, version) VALUES ($1,'editado',$2,'video/mp4',10,$3,'pronto',$4)", [id, `ed${v}.mp4`, key, v]);
      }
      const html = await page(as.editor, id);
      assert.match(html, /<summary>Enviar nova versão<\/summary>/);
      assert.match(html, /<li class="older">[\s\S]*v1/);
      assert.match(html, /horizontal/, 'avisa que o vídeo do episódio é horizontal');
    });

    it('tarefas: "Nova tarefa" abre uma janela (só quem gerencia); o editor muda o andamento e vê "detalhes"', async () => {
      const id = await mk('gravado');
      await h.db.query("INSERT INTO tasks (episode_id, kind, title) VALUES ($1,'cortes','Produzir os cortes')", [id]);
      const asGestao = await page(as.gestao, id);
      assert.match(asGestao, /data-modal-open="modal-task-new"/);
      assert.match(asGestao, /<dialog class="modal" id="modal-task-new"/);
      assert.match(asGestao, /data-modal-open="modal-task-edit"/);
      assert.doesNotMatch(asGestao, /<input type="text" name="title" placeholder="Nova tarefa/, 'o formulário solto da página antiga saiu');
      const asEditor = await page(as.editor, id);
      assert.doesNotMatch(asEditor, /Nova tarefa/);
      assert.match(asEditor, /data-modal-open="modal-task-edit"/);
      const created = await as.gestao.act(`/episodios/${id}/tarefas`, { kind: 'extra', title: 'Reação do convidado' }, { from: `/episodios/${id}` });
      assert.equal(created.status, 302);
      assert.match(await page(as.gestao, id), /Reação do convidado/);
    });

    it('o histórico tem aba própria com a linha do tempo, e o episódio aponta para Conteúdo em vez de guardar cortes e posts', async () => {
      const id = await mk('em_finalizacao');
      const html = await page(as.gestao, id);
      assert.match(html, /data-pane-id="historico"[\s\S]*Linha do tempo/);
      assert.match(html, new RegExp(`href="/conteudo\\?episodio=${id}"`));
      assert.doesNotMatch(html, /Capas verticais|Tela dividida|Carrossel/);
    });
  });
});
