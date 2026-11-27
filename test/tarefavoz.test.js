const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');

describe('tarefa por voz: a fala vira um rascunho de tarefa organizado', () => {
  const as = {}; const u = {}; let app; let epId; let guestId; let sponsorId;
  const realFetch = global.fetch;
  const geminiBodies = []; let script = [];
  const AUDIO = Buffer.alloc(2000, 1);
  const post = async (c, body = AUDIO, type = 'audio/webm') => {
    const res = await fetch(`${app.base}/tarefas/voz`, { method: 'POST', headers: { cookie: c.cookie(), accept: 'application/json', 'x-csrf-token': await c.csrf('/tarefas'), 'content-type': type }, body });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const answer = (o) => script.push({ text: JSON.stringify({ titulo: 'Confirmar a pauta', descricao: '', tipo: 'geral', ...o }) });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  before(async () => {
    config.gemini.key = 'test-gemini'; config.geminiConfigured = true;
    global.fetch = async (url, opts = {}) => {
      if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
        geminiBodies.push(JSON.parse(opts.body));
        const next = script.shift() || { text: '{}' };
        return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: next.text }] } }] });
      }
      return realFetch(url, opts);
    };
    await h.resetDb(); app = await h.startServer();
    for (const [k, role, name] of [['prod', 'produtora', 'Paula Produtora'], ['editor', 'editor_video', 'Edu Editor']]) { u[k] = await h.createUser({ name, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    epId = (await h.db.query("INSERT INTO episodes (number, title, status) VALUES (12, 'Médico que vira empresário', 'gravado') RETURNING id")).rows[0].id;
    guestId = (await h.db.query("INSERT INTO guests (name, status) VALUES ('Dra. Ana Souza', 'prospect') RETURNING id")).rows[0].id;
    sponsorId = (await h.db.query("INSERT INTO sponsors (company, stage) VALUES ('Clínica Alfa', 'prospect') RETURNING id")).rows[0].id;
  });
  after(async () => { global.fetch = realFetch; await app.close(); await h.db.close(); });

  it('a fala organizada chega como rascunho: título, detalhes, responsável, prazo, tipo e vínculos; nada é criado', async () => {
    const before = (await h.db.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n;
    answer({ titulo: 'Confirmar a pauta com a Dra. Ana.', descricao: '- Mandar o roteiro\n- Pedir foto', responsavel_id: String(u.editor.id), vence_em: plus(3), tipo: 'bastidores', episodio_id: epId, convidado_id: guestId, patrocinador_id: sponsorId });
    const r = await post(as.prod);
    assert.equal(r.status, 200); assert.equal(r.json.ok, true);
    assert.equal(r.json.transcript, 'texto transcrito de teste');
    assert.deepEqual(r.json.draft, { title: 'Confirmar a pauta com a Dra. Ana', description: '- Mandar o roteiro\n- Pedir foto', assignee_id: String(u.editor.id), due_on: plus(3), due_time: null, kind: 'bastidores', episode_id: epId, guest_id: guestId, sponsor_id: sponsorId });
    assert.deepEqual(r.json.warnings, []);
    assert.equal((await h.db.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n, before, 'só o rascunho: a tarefa é criada no clique em Criar tarefa');
    const sent = geminiBodies.at(-1);
    const prompt = sent.contents[0].parts[0].text; const system = sent.systemInstruction.parts[0].text;
    assert.match(prompt, new RegExp(`${u.editor.id} \\| Edu Editor`)); assert.match(prompt, /Dra\. Ana Souza/); assert.match(prompt, /Clínica Alfa/); assert.match(prompt, /Médico que vira empresário/);
    assert.match(prompt, /texto transcrito de teste/); assert.match(system, new RegExp(today)); assert.match(system, /Paula Produtora/); assert.match(system, /imperativo/);
    assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  });

  it('o que o modelo inventa é descartado: pessoa fora da equipe, data passada, tipo e vínculos que não existem', async () => {
    answer({ responsavel_id: '00000000-0000-4000-8000-000000000000', responsavel_citado: 'Fulana', vence_em: plus(-2), tipo: 'qualquer', episodio_id: 9999, convidado_id: 9999, patrocinador_id: 9999 });
    const r = await post(as.prod);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.draft, { title: 'Confirmar a pauta', description: '', assignee_id: null, due_on: null, due_time: null, kind: 'geral', episode_id: null, guest_id: null, sponsor_id: null });
    assert.match(r.json.warnings[0], /Não achei "Fulana" na equipe/);
    answer({ vence_em: 'sexta' });
    assert.equal((await post(as.prod)).json.draft.due_on, null, 'data que não é AAAA-MM-DD não passa');
  });

  it('fala sem tarefa não vira rascunho; erros de áudio e de serviço têm mensagem clara', async () => {
    answer({ titulo: '  ' });
    let r = await post(as.prod); assert.equal(r.status, 422); assert.match(r.json.error, /Não encontrei uma tarefa/); assert.equal(r.json.transcript, 'texto transcrito de teste');
    assert.equal((await post(as.prod, AUDIO, 'text/plain')).status, 400);
    assert.equal((await post(as.prod, Buffer.alloc(10, 1))).status, 400);
    h.setGroqFail(true); r = await post(as.prod); assert.equal(r.status, 502); assert.match(r.json.error, /entender o áudio/); h.setGroqFail(false);
    script.push({ text: 'isto não é json' }, { text: 'nem isto' }); r = await post(as.prod); // o Gemini tenta duas vezes
     assert.equal(r.status, 502); assert.match(r.json.error, /organizar a tarefa/);
    const noAuth = await fetch(`${app.base}/tarefas/voz`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: AUDIO, redirect: 'manual' });
    assert.ok([302, 401, 403].includes(noAuth.status));
  });

  it('hora dita: "hoje às 14h" vira data de hoje + 14:00; só a hora vale hoje (ou amanhã se já passou); hora de ontem ou inválida cai', async () => {
    const taskVoice = require('../src/services/taskVoice');
    const now = new Date(`${today}T09:00:00-03:00`);
    const run = async (o) => { answer(o); return (await taskVoice.organize({ text: 'x', user: u.prod, now })).draft; };
    let d = await run({ vence_em: today, vence_hora: '14:00' }); assert.equal(d.due_on, today); assert.equal(d.due_time, '14:00');
    d = await run({ vence_hora: '14:30' }); assert.equal(d.due_on, today); assert.equal(d.due_time, '14:30');
    d = await run({ vence_hora: '08:00' }); assert.equal(d.due_on, plus(1), 'as 8h de hoje já passaram (são 9h)'); assert.equal(d.due_time, '08:00');
    d = await run({ vence_em: today, vence_hora: '08:00' }); assert.equal(d.due_on, today); assert.equal(d.due_time, null, 'hora que já passou hoje não vale');
    d = await run({ vence_em: plus(2), vence_hora: '25:00' }); assert.equal(d.due_time, null); assert.equal(d.due_on, plus(2));
    d = await run({ vence_hora: '14:00', vence_em: plus(-3) }); assert.equal(d.due_on, today, 'data passada cai e a hora dita vale hoje'); assert.equal(d.due_time, '14:00');
    const sent = geminiBodies.at(-1);
    assert.match(sent.systemInstruction.parts[0].text, /agora são 09:00 em Brasília/); assert.match(sent.systemInstruction.parts[0].text, /vence_hora/);
  });

  it('a janela Nova tarefa e o cabeçalho ganham o botão de voz; sem Groq/Gemini configurados, nada aparece e a rota recusa', async () => {
    const html = (await as.prod.get('/tarefas')).text;
    assert.match(html, /data-voice data-url="\/tarefas\/voz"/); assert.match(html, /data-voice-open/); assert.match(html, /Falar a tarefa/); assert.match(html, /static\/tarefa-voz\.js/);
    assert.equal((await as.prod.get('/static/tarefa-voz.js')).status, 200);
    config.geminiConfigured = false;
    try {
      const off = (await as.prod.get('/tarefas')).text;
      assert.doesNotMatch(off, /data-voice/);
      assert.equal((await post(as.prod)).status, 503);
    } finally { config.geminiConfigured = true; }
  });
});
