const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const h = require('./helpers');
const links = require('../src/services/studioLinks');

describe('link do estúdio: o material da gravação sobe direto para o episódio', () => {
  const q = async (sql, p) => (await h.db.query(sql, p)).rows;
  let app; const as = {}; const u = {}; let epId; let token;

  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    for (const [k, name, role] of [['gestao', 'Gil Gestão', 'gestao'], ['prod', 'Paula Produtora', 'produtora'], ['editor', 'Edu Editor', 'editor_video']]) {
      u[k] = await h.createUser({ name, email: `${k}@t.com`, role });
      as[k] = h.client(app.base); assert.equal((await as[k].login(`${k}@t.com`)).status, 302);
    }
    require('../src/services/googleCalendar').kickDelay.ms = 600_000;
  });
  after(async () => { await app.close(); await h.db.close(); });

  // cliente "do estúdio": sem login, sem CSRF
  async function pub(method, path, { json, raw, form } = {}) {
    const headers = { accept: 'application/json' }; let body;
    if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
    if (raw) { headers['content-type'] = 'application/octet-stream'; body = raw; }
    if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(`${app.base}${path}`, { method, headers, body, redirect: 'manual' });
    const text = await res.text(); let parsed = null; try { parsed = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json: parsed, text, headers: res.headers, location: res.headers.get('location') };
  }
  async function send(tok, path, data, { stop = false } = {}) {
    const base = `/estudio/${tok}/arquivos`;
    const init = await pub('POST', `${base}/iniciar`, { json: { kind: 'estudio', nome: path, caminho: path, tamanho: data.length, tipo: 'video/mp4' } });
    if (init.status !== 200) return { init };
    const { id, partSize, totalParts } = init.json;
    for (let n = 1; n <= totalParts; n += 1) {
      const r = await pub('PUT', `${base}/${id}/parte/${n}`, { raw: data.subarray((n - 1) * partSize, Math.min(data.length, n * partSize)) });
      assert.equal(r.status, 200, r.text);
    }
    if (stop) return { init, id };
    return { init, id, done: await pub('POST', `${base}/${id}/concluir`) };
  }

  it('marcar como gravado cria o episódio com o link; o painel mostra o cartão e o convidado mostra "Copiar link do estúdio"', async () => {
    const [g] = await q("INSERT INTO guests (name, instagram, profile, status, owner_id) VALUES ('Dra. Ana Lima', 'analima', 'medico', 'agendado', $1) RETURNING id", [u.prod.id]);
    await q("UPDATE guests SET status = 'gravado' WHERE id = $1", [g.id]);
    const ep = await require('../src/services/production').syncFromGuest(g.id, u.prod.id);
    epId = ep.id;
    const l = await links.current(epId);
    assert.ok(l && links.isOpen(l)); assert.match(l.token, links.TOKEN_RE);
    token = l.token;
    const page = (await as.prod.get(`/episodios/${epId}`)).text;
    assert.match(page, /Link do estúdio/); assert.match(page, new RegExp(`/estudio/${token}`)); assert.match(page, /Copiar link/);
    assert.doesNotMatch((await as.editor.get(`/episodios/${epId}`)).text, new RegExp(token), 'o editor de vídeo não vê o link');
    assert.match((await as.prod.get(`/convidados/${g.id}`)).text, /Copiar link do estúdio/);
    assert.equal((await links.create(epId, u.prod.id)).id, l.id, 'dois cliques não criam dois links');
  });

  it('a página pública abre sem login, sem indexar e só com o nome do episódio; link inventado mostra só "não está aberto"', async () => {
    const r = await pub('GET', `/estudio/${token}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /Material da gravação/); assert.match(r.text, /EP\.001 · DRA\. ANA LIMA/); assert.match(r.text, /Escolher pasta/); assert.match(r.text, /Terminei o envio/);
    assert.match(r.headers.get('x-robots-tag'), /noindex/); assert.equal(r.headers.get('referrer-policy'), 'same-origin'); assert.match(r.headers.get('content-security-policy'), /connect-src[^;]*backblazeb2/);
    const fake = await pub('GET', `/estudio/${crypto.randomBytes(32).toString('base64url')}`);
    assert.equal(fake.status, 404); assert.match(fake.text, /Este link não está mais aberto/);
    assert.equal((await pub('POST', `/estudio/${'x'.repeat(43)}/arquivos/iniciar`, { json: { nome: 'a.mp4', tamanho: 10 } })).status, 404);
  });

  it('envia pastas: caminho guardado, câmera vira rótulo, tipo pela extensão, nomes repetidos não se confundem', async () => {
    const a = crypto.randomBytes(64 * 1024 * 2 + 10); const b = crypto.randomBytes(64 * 1024 + 5); const w = crypto.randomBytes(2000);
    const r1 = await send(token, 'CAM_A/C0001.MP4', a); assert.equal(r1.done.status, 200, r1.done.text);
    const r2 = await send(token, 'CAM_B/C0001.MP4', b); assert.equal(r2.done.status, 200);
    const r3 = await send(token, 'AUDIO_MIX.WAV', w); assert.equal(r3.done.status, 200);
    const files = await q('SELECT kind, label, filename, source_path, status, uploaded_by, upload_link_id FROM episode_files WHERE episode_id = $1 ORDER BY id', [epId]);
    assert.deepEqual(files.map((f) => [f.kind, f.label, f.filename, f.source_path]), [
      ['bruto_video', 'CAM_A', 'C0001.MP4', 'CAM_A/C0001.MP4'], ['bruto_video', 'CAM_B', 'C0001.MP4', 'CAM_B/C0001.MP4'], ['bruto_audio', null, 'AUDIO_MIX.WAV', 'AUDIO_MIX.WAV']]);
    assert.ok(files.every((f) => f.status === 'pronto' && f.uploaded_by === null && f.upload_link_id));
    assert.equal((await pub('POST', `/estudio/${token}/arquivos/iniciar`, { json: { nome: 'CAM_A/C0001.MP4', caminho: 'CAM_A/C0001.MP4', tamanho: a.length } })).json.code, 'ja_enviado', 'o mesmo arquivo não sobe duas vezes');
    assert.equal((await pub('POST', `/estudio/${token}/arquivos/iniciar`, { json: { caminho: 'CAM_A/.DS_Store', tamanho: 10 } })).status, 400, 'arquivo de sistema não sobe');
    const notes = await q("SELECT title FROM notifications WHERE type = 'episodio'");
    assert.ok(notes.some((n) => /O estúdio começou a enviar o material do EP\.001/.test(n.title)), 'a equipe sabe que começou a chegar');
    assert.match((await as.prod.get(`/episodios/${epId}`)).text, /estúdio<\/span>/, 'o arquivo leva a marca do estúdio');
  });

  it('o link só mexe no que ele criou: arquivo do painel ou de outro link = não encontrado; limites de tamanho e de material', async () => {
    const [own] = await q("INSERT INTO episode_files (episode_id, kind, filename, content_type, size_bytes, part_size, storage_key, status) VALUES ($1, 'bruto_video', 'painel.mp4', 'video/mp4', 10, 65536, 'pp/x/painel.mp4', 'enviando') RETURNING id", [epId]);
    for (const path of [`/estudio/${token}/arquivos/${own.id}/partes`, `/estudio/${token}/arquivos/${own.id}/urls`]) assert.equal((await pub('GET', path)).status, 404, path);
    assert.equal((await pub('POST', `/estudio/${token}/arquivos/${own.id}/cancelar`)).status, 404);
    assert.equal((await q('SELECT 1 FROM episode_files WHERE id = $1', [own.id])).length, 1);
    await q('DELETE FROM episode_files WHERE id = $1', [own.id]);
    assert.equal((await pub('POST', `/estudio/${token}/arquivos/iniciar`, { json: { caminho: 'gigante.mov', tamanho: 201 * 1024 ** 3 } })).status, 400);
    const [l] = await q('SELECT id FROM episode_upload_links WHERE token = $1', [token]);
    const [big] = await q("INSERT INTO episode_files (episode_id, kind, filename, content_type, size_bytes, part_size, storage_key, status, upload_link_id) VALUES ($1, 'bruto_video', 'enorme.mov', 'video/mp4', $2, 65536, 'pp/x/enorme.mov', 'pronto', $3) RETURNING id", [epId, links.MAX_TOTAL_BYTES - 100, l.id]);
    assert.equal((await pub('POST', `/estudio/${token}/arquivos/iniciar`, { json: { caminho: 'muito.mov', tamanho: 200 } })).status, 413, '1 TB somados por link');
    await q('DELETE FROM episode_files WHERE id = $1', [big.id]);
    const [f] = await q('SELECT id FROM episode_files WHERE source_path = $1', ['CAM_A/C0001.MP4']);
    assert.equal((await pub('POST', `/estudio/${token}/arquivos/${f.id}/cancelar`)).status, 409, 'arquivo pronto não se cancela pelo link');
  });

  it('"Terminei" com arquivo pela metade pede confirmação; confirmado, fecha o link, cancela o que parou e avisa a equipe', async () => {
    const half = await send(token, 'CAM_C/C0001.MP4', crypto.randomBytes(64 * 1024 * 2), { stop: true });
    let r = await pub('POST', `/estudio/${token}/terminei`, { form: { mesmo_assim: '0' } });
    assert.equal(r.status, 409); assert.match(r.text, /ficou pela metade/); assert.match(r.text, /Terminar mesmo assim/);
    r = await pub('POST', `/estudio/${token}/terminei`, { form: { mesmo_assim: '1' } });
    assert.equal(r.status, 200); assert.match(r.text, /Recebido\. Obrigado\./); assert.match(r.text, /CAM_B\/C0001\.MP4/);
    assert.equal((await q('SELECT 1 FROM episode_files WHERE id = $1', [half.id])).length, 0, 'o envio pela metade foi cancelado');
    assert.equal(h.b2Multipart.size, 0);
    assert.equal((await pub('GET', `/estudio/${token}`)).status, 404, 'o link fechou');
    assert.equal((await pub('POST', `/estudio/${token}/arquivos/iniciar`, { json: { caminho: 'x.mp4', tamanho: 10 } })).status, 404);
    assert.ok((await q("SELECT title FROM notifications WHERE type = 'episodio'")).some((n) => /Material do EP\.001 recebido pelo link do estúdio/.test(n.title)));
    const page = (await as.prod.get(`/episodios/${epId}`)).text;
    assert.match(page, /Material recebido/); assert.match(page, /Pedir reenvio/);
    assert.match((await q('SELECT string_agg(message, \' | \') AS m FROM episode_events WHERE episode_id = $1', [epId]))[0].m, /O estúdio terminou o envio pelo link: 3 arquivos/);
  });

  it('pedir reenvio gera link novo; o material que chegou continua; fechar e o editor não mexe', async () => {
    assert.equal((await as.editor.act(`/episodios/${epId}/estudio/reenvio`, {}, { from: `/episodios/${epId}` })).status, 403);
    const r = await as.prod.act(`/episodios/${epId}/estudio/reenvio`, {}, { from: `/episodios/${epId}` });
    assert.equal(r.status, 302);
    const fresh = await links.current(epId);
    assert.notEqual(fresh.token, token); assert.ok(links.isOpen(fresh));
    assert.equal((await pub('GET', `/estudio/${fresh.token}`)).status, 200);
    assert.equal((await q("SELECT count(*)::int AS n FROM episode_files WHERE episode_id = $1 AND status = 'pronto'", [epId]))[0].n, 3, 'o que chegou continua');
    await as.prod.act(`/episodios/${epId}/estudio/fechar`, {}, { from: `/episodios/${epId}` });
    assert.equal((await pub('GET', `/estudio/${fresh.token}`)).status, 404);
    assert.match((await as.prod.get(`/episodios/${epId}`)).text, /Gerar link novo/);
  });

  it('link sem uso por 7 dias fecha sozinho', async () => {
    const l = await links.create(epId, u.prod.id);
    await q("UPDATE episode_upload_links SET created_at = now() - interval '8 days' WHERE id = $1", [l.id]);
    assert.equal(await links.byToken(l.token), null);
    assert.equal((await q('SELECT close_reason FROM episode_upload_links WHERE id = $1', [l.id]))[0].close_reason, 'expirado');
  });

  it('organizar: a equipe muda tipo e rótulo; o editor não', async () => {
    const [f] = await q("SELECT id FROM episode_files WHERE source_path = 'AUDIO_MIX.WAV'");
    assert.equal((await as.editor.act(`/episodios/${epId}/arquivos/${f.id}/organizar`, { kind: 'bastidor' }, { from: `/episodios/${epId}` })).status, 403);
    const r = await as.prod.act(`/episodios/${epId}/arquivos/${f.id}/organizar`, { kind: 'bruto_audio', rotulo: 'Áudio do host' }, { from: `/episodios/${epId}` });
    assert.equal(r.status, 302);
    assert.deepEqual(await q('SELECT kind, label FROM episode_files WHERE id = $1', [f.id]), [{ kind: 'bruto_audio', label: 'Áudio do host' }]);
    assert.match((await as.prod.get(`/episodios/${epId}`)).text, /data-fill-modal="modal-organizar"/);
  });

  it('WhatsApp do estúdio: sem número só "Copiar"; com número, "Mandar no WhatsApp" com a mensagem e o link', async () => {
    const l = await links.resend(epId, u.prod.id);
    assert.doesNotMatch((await as.prod.get(`/episodios/${epId}`)).text, /Mandar no WhatsApp/);
    await as.gestao.act('/gestao/whatsapp', { grupo: 'estudio', numero: '(11) 98888-7777', msg_link: 'Oi! Link de {nome}: {link}' }, { from: '/gestao/whatsapp' });
    const page = (await as.prod.get(`/episodios/${epId}`)).text;
    assert.match(page, /Mandar no WhatsApp/);
    assert.match(page, new RegExp(`wa\\.me/5511988887777\\?text=${encodeURIComponent('Oi! Link de Dra. Ana Lima: ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.ok(page.includes(encodeURIComponent(links.urlOf(l))));
  });
});
