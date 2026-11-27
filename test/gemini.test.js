// A IA (Gemini): quando a chamada passa do tempo ou a rede cai, tenta de novo em vez de derrubar o trabalho inteiro.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const gemini = require('../src/services/gemini');

describe('gemini.generateJson', () => {
  const realFetch = global.fetch; const saved = { ...config.gemini, on: config.geminiConfigured };
  before(() => { config.gemini.key = 'gem'; config.geminiConfigured = true; });
  after(() => { global.fetch = realFetch; Object.assign(config.gemini, { key: saved.key }); config.geminiConfigured = saved.on; });

  it('tempo esgotado na primeira tentativa: tenta de novo e devolve a resposta', async () => {
    let n = 0;
    global.fetch = async () => {
      n += 1;
      if (n === 1) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
    };
    const { data } = await gemini.generateJson({ parts: [{ text: 'oi' }], attempts: 3, timeoutMs: 1000, retryDelayMs: 0 });
    assert.deepEqual(data, { ok: true }); assert.equal(n, 2);
  });

  it('sempre esgotando: desiste depois das tentativas, com a mensagem do tempo', async () => {
    let n = 0;
    global.fetch = async () => { n += 1; throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
    await assert.rejects(gemini.generateJson({ parts: [{ text: 'oi' }], attempts: 2, timeoutMs: 1000, retryDelayMs: 0 }), /timeout/);
    assert.equal(n, 2);
  });
});
