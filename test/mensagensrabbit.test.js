// Contra um RabbitMQ de verdade. Só roda com TEST_RABBITMQ_URL (use um broker de teste: as filas pulso.chat.* são esvaziadas).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const amqp = require('amqplib');

const URL_ = process.env.TEST_RABBITMQ_URL;
const wait = (cond, ms = 15000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => { if (cond()) resolve(); else if (Date.now() - t0 > ms) reject(new Error('demorou demais')); else setTimeout(tick, 50); };
  tick();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Mensagens com RabbitMQ de verdade', { skip: !URL_ && 'defina TEST_RABBITMQ_URL' }, () => {
  let bus; let raw; let ch;
  const started = [];
  const startBus = async (handlers) => { await bus.start({ url: URL_, ...handlers }); started.push(1); };
  const purge = async () => { for (const q of [bus.Q_TASKS, bus.Q_WAIT, bus.Q_DEAD]) await ch.purgeQueue(q); };

  before(async () => {
    process.env.NODE_ENV = 'test';
    bus = require('../src/services/chatBus');
    await bus.start({ url: URL_ }); // cria as filas
    await bus.stop();
    raw = await amqp.connect(URL_);
    ch = await raw.createChannel();
    await purge();
  });
  after(async () => { await bus.stop(); await raw.close(); });

  it('publica com confirmação e o evento chega a todas as cópias do painel', async () => {
    const seen = [];
    await startBus({ live: async (k, e) => seen.push([k, e.id]) });
    assert.equal(bus.isConnected(), true);
    // outra "cópia do painel"
    const other = await raw.createChannel();
    const q = await other.assertQueue('', { exclusive: true, autoDelete: true });
    await other.bindQueue(q.queue, bus.EXCHANGE, 'evento.#');
    const seen2 = [];
    await other.consume(q.queue, (m) => { seen2.push(JSON.parse(m.content).id); other.ack(m); });
    await bus.publish('evento.mensagem', { id: 101, users: [] });
    await wait(() => seen.length === 1 && seen2.length === 1);
    assert.deepEqual(seen[0], ['evento.mensagem', 101]);
    await other.close();
    await bus.stop();
  });

  it('tarefa que falha volta para a fila e é reentregue até dar certo', async () => {
    await purge();
    let tries = 0;
    await startBus({ tasks: async () => { tries += 1; if (tries < 3) throw new Error('falha passageira'); } });
    await bus.publish('tarefa.aviso', { id: 201 });
    await wait(() => tries === 3);
    await sleep(300);
    assert.equal(tries, 3, 'depois de confirmada, não vem de novo');
    assert.equal((await ch.checkQueue(bus.Q_TASKS)).messageCount, 0);
    await bus.stop();
  });

  it('o processo cair antes de confirmar: outro consumidor recebe a tarefa', async () => {
    await purge();
    await startBus({});
    await bus.publish('tarefa.resumo', { id: 301 });
    await bus.stop();
    // consumidor que pega e "morre" sem confirmar
    const dying = await amqp.connect(URL_);
    const dch = await dying.createChannel();
    let got = 0;
    await dch.consume(bus.Q_TASKS, () => { got += 1; });
    await wait(() => got === 1);
    await dying.close();
    const seen = [];
    await startBus({ tasks: async (k, e) => seen.push(e.id) });
    await wait(() => seen.length === 1);
    assert.deepEqual(seen, [301]);
    await bus.stop();
  });

  it('a mensagem sobrevive enquanto ninguém está consumindo', async () => {
    await purge();
    await startBus({});
    await bus.publish('tarefa.aviso', { id: 401 });
    await bus.stop();
    await wait(() => false, 1).catch(() => {});
    const seen = [];
    await startBus({ tasks: async (k, e) => seen.push(e.id) });
    await wait(() => seen.length === 1);
    assert.deepEqual(seen, [401]);
    await bus.stop();
  });

  it('tarefa que nunca dá certo para na fila de mortas, sem travar as outras', async () => {
    await purge();
    let bad = 0; const good = [];
    await startBus({ tasks: async (k, e) => { if (e.id === 501) { bad += 1; throw new Error('sempre falha'); } good.push(e.id); } });
    await bus.publish('tarefa.aviso', { id: 501 });
    await bus.publish('tarefa.aviso', { id: 502 });
    await wait(() => good.includes(502));
    await wait(() => bad >= 6, 30000);
    let dead = 0;
    await wait(() => { ch.checkQueue(bus.Q_DEAD).then((q) => { dead = q.messageCount; }); return dead === 1; }, 15000);
    assert.equal(dead, 1);
    assert.equal((await bus.status()).dead, 1, 'a contagem que aparece em Integrações');
    await bus.stop();
  });

  it('fila de espera: o aviso só sai depois do prazo e vira tarefa.aviso', async () => {
    await purge();
    const seen = [];
    await startBus({ tasks: async (k, e) => seen.push([k, e.id, Date.now()]) });
    const t0 = Date.now();
    await bus.publish('espera.aviso', { id: 601 });
    await sleep(3000);
    assert.equal(seen.length, 0, 'ainda esperando');
    await wait(() => seen.length === 1, 30000);
    assert.equal(seen[0][0], 'tarefa.aviso'); assert.equal(seen[0][1], 601);
    assert.ok(seen[0][2] - t0 >= bus.WAIT_MS - 500, 'respeitou os 20 s');
    await bus.stop();
  });

  it('senha errada não derruba nada e o erro não mostra a senha', async () => {
    const logs = []; const orig = console.error;
    console.error = (...a) => logs.push(a.join(' '));
    const bad = new URL(URL_); bad.password = 'senha-errada-secreta';
    await bus.start({ url: bad.toString() });
    console.error = orig;
    assert.equal(bus.isConnected(), false);
    assert.ok(logs.length > 0);
    assert.ok(!logs.join(' ').includes('senha-errada-secreta'));
    await assert.rejects(() => bus.publish('tarefa.aviso', { id: 1 }), /desconectado/);
    await bus.stop();
  });
});
