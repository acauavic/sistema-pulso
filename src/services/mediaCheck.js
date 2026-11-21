// Antes de mandar o link de um arquivo às redes, confere se o Backblaze entrega o arquivo INTEIRO. Em 27/10/2026 a segunda parte
// (16 a 32 MB) de um corte passou a responder 503: cada rede baixou só o começo e o Reel saiu pela metade, enquanto as outras falharam.
// Arquivo de até 400 MB (cortes, imagens): lê do começo ao fim contando os bytes. Maior (episódio): um byte no começo de cada parte
// (ler gigabytes faria o "Publicar agora" esperar minutos).
const b2 = require('./b2');

const FULL_LIMIT = 400 * 1024 ** 2;
const PROBE_STEP = 64 * 1024 ** 2; // episódio sem tamanho de parte registrado: confere a cada 64 MB
const mb = (n) => `${(Number(n) / 1024 ** 2).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1).replace('.', ',')} MB`;

// Erro com código (ver publishErrors): arquivo_indisponivel (passageiro), arquivo_sumiu e arquivo_incompleto (precisa reenviar).
const mediaError = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

// Causa real de um "fetch failed"/"terminated" do Node (ex.: "other side closed"), para o log e a tela.
function cause(err) {
  const c = err?.cause;
  const bits = [c?.code, c?.message].filter(Boolean);
  return bits.length ? `${err.message} (${bits.join(': ')})` : String(err?.message || err);
}

function fromStatus(status, key) {
  if (status === 404) return mediaError('arquivo_sumiu', `O arquivo não está no armazenamento (${key}).`);
  return mediaError('arquivo_indisponivel', `O armazenamento respondeu ${status} ao ler o arquivo.`, { status });
}

// Lê tudo e conta. expected: tamanho registrado no banco (o que o arquivo TEM de ter).
async function readAll(url, { expected = null, key = '' } = {}) {
  const t0 = Date.now(); let bytes = 0;
  const timeout = Math.max(60_000, Math.ceil((Number(expected) || 0) / (1024 ** 2)) * 2_000); // ~0,5 MB/s no pior caso aceitável
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(timeout) }); } catch (err) { throw mediaError('arquivo_indisponivel', `Não consegui ler o arquivo no armazenamento: ${cause(err)}.`); }
  if (!res.ok || !res.body) throw fromStatus(res.status, key);
  const declared = Number(res.headers.get('content-length')) || null;
  if (expected && declared && declared !== Number(expected)) { await res.body.cancel().catch(() => {}); throw mediaError('arquivo_incompleto', `O arquivo no armazenamento tem ${mb(declared)}, mas o envio registrou ${mb(expected)}.`); }
  const total = Number(expected) || declared;
  try {
    const reader = res.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; }
  } catch (err) {
    throw mediaError('arquivo_indisponivel', `O armazenamento parou de entregar o arquivo em ${mb(bytes)}${total ? ` de ${mb(total)}` : ''}: ${cause(err)}.`, { bytes, total });
  }
  if (total && bytes !== total) throw mediaError('arquivo_indisponivel', `O armazenamento entregou ${mb(bytes)} de ${mb(total)}.`, { bytes, total });
  return { bytes, ms: Date.now() - t0, mode: 'inteiro' };
}

// Um byte no começo de cada parte e o último: acha a parte que o armazenamento não entrega sem baixar gigabytes.
async function probe(url, { size, partSize = null }) {
  const t0 = Date.now(); const step = Number(partSize) || PROBE_STEP;
  const offsets = [];
  for (let o = 0; o < size; o += step) offsets.push(o);
  if (offsets.at(-1) !== size - 1) offsets.push(size - 1);
  let i = 0;
  const one = async (o) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${o}-${o}` }, signal: AbortSignal.timeout(20_000) });
        await res.arrayBuffer().catch(() => null);
        if (res.status === 206 || res.status === 200) return;
        if (attempt) throw fromStatus(res.status, '');
      } catch (err) {
        if (typeof err.code === 'string' && err.code.startsWith('arquivo_')) throw mediaError(err.code, `${err.message.replace(/\.$/, '')} (na altura de ${mb(o)} de ${mb(size)}).`);
        if (attempt) throw mediaError('arquivo_indisponivel', `Não consegui ler o arquivo na altura de ${mb(o)}: ${cause(err)}.`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, offsets.length) }, async () => { while (i < offsets.length) { const o = offsets[i]; i += 1; await one(o); } }));
  return { bytes: size, ms: Date.now() - t0, mode: 'partes', probes: offsets.length };
}

// Confere um objeto do Backblaze. size: tamanho registrado (cortes e episódios guardam); sem ele, pergunta ao armazenamento.
async function verify(key, { size = null, partSize = null } = {}) {
  let expected = Number(size) || null;
  if (!expected) {
    let head;
    try { head = await b2.headObject(key); } catch (err) { throw mediaError('arquivo_indisponivel', `Não consegui consultar o arquivo no armazenamento: ${cause(err)}.`); }
    if (!head) throw mediaError('arquivo_sumiu', `O arquivo não está no armazenamento (${key}).`);
    expected = head.size || null;
  }
  const url = await b2.presignGet(key, { expires: 3600 });
  if (!expected || expected <= FULL_LIMIT) return readAll(url, { expected, key });
  return probe(url, { size: expected, partSize });
}

module.exports = { verify, readAll, probe, cause, mediaError, mb, FULL_LIMIT };
