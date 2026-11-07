// Memória curta de uma requisição: o mesmo dado lido várias vezes na mesma página (ajustes do sistema, configuração das
// notificações) vai ao banco uma vez só. Vale só até a resposta sair; fora de uma requisição (rotinas, fila) não guarda nada.
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

// Fica depois dos leitores do corpo (express.json/urlencoded): eles chamam o próximo passo de dentro de eventos do socket.
const middleware = (req, res, next) => als.run(new Map(), next);

function memo(key, fn) {
  const store = als.getStore();
  if (!store) return fn();
  if (!store.has(key)) store.set(key, Promise.resolve().then(fn).catch((err) => { store.delete(key); throw err; }));
  return store.get(key);
}

// Depois de gravar: esquece o que foi lido com esse prefixo (a leitura seguinte da mesma requisição vê o valor novo).
function forget(prefix) {
  const store = als.getStore();
  if (!store) return;
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}

module.exports = { middleware, memo, forget };
