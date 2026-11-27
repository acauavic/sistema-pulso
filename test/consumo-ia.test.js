const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const gemini = require('../src/services/gemini');
const usage = require('../src/services/aiUsage');
const R = require('../src/services/commentReplies');

// Raciocínio baixo em toda chamada, registro do consumo de cada uma (com a função) e comentários em lotes de 40.
describe('consumo da IA: raciocínio baixo, registro por chamada e a tela da gestão', () => {
  const as = {}; let app;
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const realFetch = global.fetch;
  const sent = []; let reply = null;
  const USAGE = { promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 500, totalTokenCount: 2000 };

  before(async () => {
    await h.resetDb(); app = await h.startServer();
    for (const [k, role] of [['gestao', 'gestao'], ['prod', 'produtora']]) { await h.createUser({ name: k, email: `${k}@t.com`, role }); as[k] = h.client(app.base); await as[k].login(`${k}@t.com`); }
    Object.assign(h.config.gemini, { key: 'gem' }); h.config.geminiConfigured = true;
    global.fetch = async (url, opts = {}) => {
      if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, opts);
      const body = JSON.parse(opts.body); sent.push(body);
      if (reply) return reply(body);
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: USAGE });
    };
  });
  after(async () => { global.fetch = realFetch; h.config.geminiConfigured = false; await app.close(); await h.db.close(); });

  it('toda chamada vai com raciocínio baixo e vira uma linha com a função e os tokens', async () => {
    sent.length = 0; await q('DELETE FROM ai_usage');
    await gemini.generateJson({ feature: 'corte_textos', parts: [{ text: 'oi' }], schema: null });
    assert.deepEqual(sent[0].generationConfig.thinkingConfig, { thinkingLevel: 'low' }, 'sem isso o modelo pensa no máximo (cobrado como saída)');
    await gemini.chat({ feature: 'assistente', contents: [{ role: 'user', parts: [{ text: 'oi' }] }] });
    assert.deepEqual(sent[1].generationConfig.thinkingConfig, { thinkingLevel: 'low' });
    await gemini.generateJson({ parts: [{ text: 'oi' }], schema: null, thinking: 'high' });
    assert.equal(sent[2].generationConfig.thinkingConfig.thinkingLevel, 'high', 'quem precisa pede mais');
    const rows = await q('SELECT * FROM ai_usage ORDER BY id');
    assert.equal(rows.length, 3);
    assert.equal(rows[0].feature, 'corte_textos'); assert.equal(rows[0].input_tokens, 1200); assert.equal(rows[0].output_tokens, 300); assert.equal(rows[0].thinking_tokens, 500);
    assert.equal(rows[0].ok, true); assert.equal(rows[0].model, h.config.gemini.model);
    assert.equal(rows[1].feature, 'assistente'); assert.equal(rows[2].feature, 'outros', 'sem função, conta em Outros');
    // 1200 de entrada a US$ 0,50/mi + (300 + 500) de saída a US$ 3/mi
    assert.ok(Math.abs(usage.cost(rows[0]) - (1200 * 0.5 + 800 * 3) / 1e6) < 1e-12);
  });

  it('chamada recusada também entra (sem tokens) e a tela diz que os créditos acabaram', async () => {
    await q('DELETE FROM ai_usage');
    reply = () => Response.json({ error: { message: 'Your prepayment credits are depleted.' } }, { status: 402 });
    await assert.rejects(gemini.generateJson({ feature: 'comentarios', parts: [{ text: 'oi' }], schema: null }), /402/);
    reply = null;
    const [row] = await q('SELECT * FROM ai_usage');
    assert.equal(row.ok, false); assert.equal(row.status, 402); assert.equal(row.input_tokens, 0); assert.match(row.error, /credits are depleted/);
    const r = await usage.report(7);
    assert.match(r.stopped.text, /créditos do Gemini acabaram/);
    assert.equal(r.total.failed, 1);
  });

  it('Gestão > Sistema > Consumo da IA mostra por função, por dia e o custo estimado; só para quem cuida das integrações', async () => {
    await q('DELETE FROM ai_usage');
    await gemini.generateJson({ feature: 'comentarios', parts: [{ text: 'oi' }], schema: null });
    await gemini.generateJson({ feature: 'comentarios', parts: [{ text: 'oi' }], schema: null });
    await gemini.generateJson({ feature: 'quadros', parts: [{ text: 'oi' }], schema: null });
    const res = await as.gestao.get('/gestao/consumo-ia?dias=30');
    assert.equal(res.status, 200);
    assert.match(res.text, /Consumo da IA/); assert.match(res.text, /Respostas a comentários/); assert.match(res.text, /Leitura dos quadros do vídeo/);
    assert.match(res.text, /Custo estimado/); assert.match(res.text, /US\$ 0,01/, 'três chamadas de 2 mil tokens');
    assert.match(res.text, /67%/, 'comentários são dois terços do custo');
    assert.match(res.text, /href="\/gestao\/consumo-ia"/, 'aba no grupo Sistema');
    assert.doesNotMatch(res.text, /créditos do Gemini acabaram/);
    assert.equal((await as.prod.get('/gestao/consumo-ia')).status, 403);
    await q('DELETE FROM ai_usage');
    const empty = await as.gestao.get('/gestao/consumo-ia');
    assert.match(empty.text, /Nenhuma chamada à IA neste período/);
  });

  it('comentários vão à IA em lotes de 40', async () => {
    sent.length = 0; await q('DELETE FROM ai_usage');
    const [ep] = await q("INSERT INTO episodes (number, title, status) VALUES (9, 'Dor', 'publicado') RETURNING id");
    const [pub] = await q(`INSERT INTO episode_publications (episode_id, platforms, title, status, results) VALUES ($1, '{instagram}', 'A dor', 'publicado',
      '[{"platform":"instagram","provider":"outstand","ref":"op9","post_id":"99","ok":true}]') RETURNING id`, [ep.id]);
    for (let i = 1; i <= 45; i += 1) {
      await q("INSERT INTO social_comments (network, post_ref, platform_post_id, publication_id, comment_id, author_username, text, commented_at) VALUES ('instagram','op9','99',$1,$2,$3,$4, now())",
        [pub.id, `c${i}`, `pessoa${i}`, `Comentário com conteúdo número ${i}`]);
    }
    reply = (body) => {
      const text = body.contents[0].parts.map((p) => p.text || '').join('\n');
      const list = JSON.parse(text.slice(text.indexOf('Comentários (JSON):') + 'Comentários (JSON):'.length));
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ itens: list.map((k) => ({ id: k.id, acao: 'ignorar', motivo: 'teste', confianca: 0.9 })) }) }] } }], usageMetadata: USAGE });
    };
    try { await R.classifyPublication(pub.id); } finally { reply = null; }
    const sizes = sent.map((b) => { const t = b.contents[0].parts[0].text; return JSON.parse(t.slice(t.indexOf('Comentários (JSON):') + 19)).length; });
    assert.deepEqual(sizes, [40, 5]);
    const rows = await q("SELECT feature FROM ai_usage");
    assert.deepEqual(rows.map((r) => r.feature), ['comentarios', 'comentarios']);
  });
});
