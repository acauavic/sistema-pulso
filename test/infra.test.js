const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const jobs = require('../src/services/jobs');
const scheduler = require('../src/services/scheduler');
const realtime = require('../src/services/realtime');
const notifySvc = require('../src/services/notify');
const up = require('../src/services/uploadPost');
const publishing = require('../src/services/publishing');
const { createLimiter } = require('../src/auth/rateLimit');

describe('infraestrutura: fila, rotinas, tempo real e limitador', () => {
  let app; let gestao; let as;
  before(async () => {
    await h.resetDb();
    app = await h.startServer();
    gestao = await h.createUser({ name: 'Gil Gestão', email: 'g@t.com', role: 'gestao' });
    as = h.client(app.base); await as.login('g@t.com');
  });
  after(async () => { realtime.stop(); await app.close(); await h.db.close(); });
  const job = (id) => h.db.query('SELECT * FROM jobs WHERE id=$1', [id]).then((r) => r.rows[0]);

  describe('fila', () => {
    it('falha passageira volta para a fila com espera; depois conclui', async () => {
      let n = 0;
      jobs.register('teste_rede', async () => { n += 1; if (n === 1) throw new Error('fetch failed'); return { ok: true }; });
      const j = await jobs.enqueue('teste_rede', { refId: 1 });
      let r = await jobs.runNext();
      assert.equal(r.status, 'queued');
      assert.equal(r.attempts, 1);
      assert.ok(new Date(r.run_after) > new Date(Date.now() + 20_000), 'espera ~30 s antes de tentar de novo');
      assert.match(r.message, /nova tentativa/);
      assert.equal(await jobs.runNext(), null, 'não pega antes da hora');
      await h.db.query('UPDATE jobs SET run_after = now() WHERE id=$1', [j.id]);
      r = await jobs.runNext();
      assert.equal(r.status, 'done');
      assert.equal(r.attempts, 2);
    });

    it('falha de verdade para na hora e avisa; cota da IA espera 15 min; esgotou as tentativas, para', async () => {
      let warned = 0;
      jobs.register('teste_ruim', async () => { throw new Error('o arquivo não é um vídeo'); }, { onError: () => { warned += 1; } });
      const bad = await jobs.enqueue('teste_ruim', { refId: 2 });
      assert.equal((await jobs.runNext()).status, 'error');
      assert.equal(warned, 1);
      assert.equal(jobs.retryDelay(new Error('Gemini recusou (429): quota'), 1), 15 * 60_000);
      assert.equal(jobs.retryDelay(Object.assign(new Error('timeout'), { retryable: false }), 1), null);
      jobs.register('teste_sempre', async () => { throw new Error('ECONNRESET'); });
      const s = await jobs.enqueue('teste_sempre', { refId: 3, maxAttempts: 2 });
      await jobs.runNext();
      await h.db.query('UPDATE jobs SET run_after = now() WHERE id=$1', [s.id]);
      assert.equal((await jobs.runNext()).status, 'error', 'segunda tentativa era a última');
      // Gestão > Sistema mostra e manda de novo
      const page = (await as.get('/gestao/sistema')).text;
      assert.match(page, /Falharam de vez/);
      assert.match(page, /o arquivo não é um vídeo/);
      assert.match(page, /Nenhum processo rodando a fila/, 'avisa quando não há worker vivo');
      await as.act(`/gestao/sistema/trabalhos/${bad.id}/repetir`, {}, { from: '/gestao/sistema' });
      assert.equal((await job(bad.id)).status, 'queued');
    });

    it('pistas: a leve (e-mails) não espera a pesada (FFmpeg/IA)', async () => {
      await h.db.query("UPDATE jobs SET status = 'done' WHERE status IN ('queued','running')"); // sobras dos testes anteriores
      jobs.register('corte', async () => ({ ok: true }));
      jobs.register('email_teste', async () => ({ ok: true }));
      const heavy = await jobs.enqueue('corte', { refId: 900 });
      const light = await jobs.enqueue('email_teste', { refId: 901 });
      assert.equal((await jobs.runNext({ lane: 'leve' })).id, light.id, 'a pista leve pula o corte');
      assert.equal(await jobs.runNext({ lane: 'leve' }), null);
      assert.equal((await jobs.runNext({ lane: 'pesada' })).id, heavy.id);
    });

    it('trabalho "rodando" sem sinal de vida volta para a fila (o processo caiu)', async () => {
      const { rows: [j] } = await h.db.query("INSERT INTO jobs (kind, status, attempts, max_attempts, heartbeat_at, started_at) VALUES ('teste_rede', 'running', 1, 3, now() - interval '10 minutes', now() - interval '10 minutes') RETURNING id");
      const { rows: [fresh] } = await h.db.query("INSERT INTO jobs (kind, status, attempts, heartbeat_at, started_at) VALUES ('teste_rede', 'running', 1, now(), now()) RETURNING id");
      const rec = await jobs.recoverStuck();
      assert.deepEqual(rec.map((x) => x.id), [j.id]);
      assert.equal((await job(j.id)).status, 'queued');
      assert.equal((await job(fresh.id)).status, 'running', 'quem dá sinal de vida não é mexido');
      await h.db.query("UPDATE jobs SET status = 'done' WHERE status IN ('running','queued')");
    });
  });

  describe('rotinas com trava', () => {
    it('só uma réplica roda a mesma rotina por vez; a execução e o erro ficam registrados', async () => {
      const other = await h.db.getPool().connect();
      await other.query("SELECT pg_advisory_lock(hashtext('pulso:teste'))");
      let ran = 0;
      assert.equal(await scheduler.runOnce('teste', async () => { ran += 1; }), false, 'outra réplica está com a trava');
      await other.query("SELECT pg_advisory_unlock(hashtext('pulso:teste'))");
      other.release();
      assert.equal(await scheduler.runOnce('teste', async () => { ran += 1; }), true);
      assert.equal(ran, 1);
      await scheduler.runOnce('teste', async () => { throw new Error('quebrou'); });
      const { rows: [r] } = await h.db.query("SELECT * FROM scheduler_runs WHERE name = 'teste'");
      assert.equal(r.ok, false); assert.equal(r.error, 'quebrou'); assert.equal(r.runs, 2);
    });

    it('agendado vencido sai uma vez só, mesmo com duas rodadas ao mesmo tempo', async () => {
      const { rows: [g] } = await h.db.query("INSERT INTO episodes (number, title, status) VALUES (1, 'Ep', 'gravado') RETURNING id");
      h.b2Store.set('pp/x.jpg', { body: Buffer.from('j'), contentType: 'image/jpeg' });
      const { rows: [c] } = await h.db.query("INSERT INTO episode_covers (episode_id, kind, spec, storage_key, mime, width, height, size_bytes) VALUES ($1, 'post_quote', '{}', 'pp/x.jpg', 'image/jpeg', 1080, 1350, 1) RETURNING id", [g.id]);
      const { rows: [p] } = await h.db.query(
        "INSERT INTO episode_publications (episode_id, platforms, title, status, scheduled_at, media, cover_ids) VALUES ($1, '{instagram}', 'Post', 'agendado', now() - interval '1 minute', 'imagem', $2) RETURNING id", [g.id, [c.id]]);
      const real = up.sendPhotos; let sends = 0;
      up.sendPhotos = async (f) => { sends += 1; await new Promise((r) => setTimeout(r, 30)); return real(f); };
      try { await Promise.all([publishing.tick(), publishing.tick()]); } finally { up.sendPhotos = real; }
      assert.equal(sends, 1);
      assert.equal((await h.db.query('SELECT status FROM episode_publications WHERE id=$1', [p.id])).rows[0].status, 'simulado');
    });
  });

  describe('limitador compartilhado', () => {
    it('duas "réplicas" (instâncias) com o mesmo nome somam as tentativas', async () => {
      const a = createLimiter({ name: 'login_teste', max: 2, windowMs: 60_000 });
      const b = createLimiter({ name: 'login_teste', max: 2, windowMs: 60_000 });
      await a.hit('ip'); await b.hit('ip');
      assert.equal(await a.blocked('ip'), true);
    });
  });

  describe('avisos em tempo real', () => {
    it('a notificação chega na aba aberta (SSE) na hora, via LISTEN/NOTIFY', async () => {
      await realtime.listen();
      const ctrl = new AbortController();
      const res = await fetch(`${app.base}/eventos`, { headers: { cookie: as.cookie(), accept: 'text/event-stream' }, signal: ctrl.signal });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /event-stream/);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const got = (async () => { while (!/event: notification/.test(buf)) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } return buf; })();
      await new Promise((r) => setTimeout(r, 100));
      const author = await h.createUser({ name: 'Ana', email: 'a@t.com', role: 'produtora' });
      await notifySvc.notify({ type: 'tarefa', users: [gestao.id], actorId: author.id, title: 'Tarefa nova para você', url: '/tarefas/1' });
      const text = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('não chegou')), 3000))]);
      assert.match(text, /Tarefa nova para você/);
      assert.match(text, /\/notificacoes\/\d+\/abrir/);
      ctrl.abort();
      await new Promise((r) => setTimeout(r, 50));
    });
  });
});
