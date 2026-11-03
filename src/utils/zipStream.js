// ZIP sem compressão (fotos e vídeos já vêm comprimidos), escrito direto na resposta, um arquivo de cada vez: nada fica todo em memória.
// Dois jeitos de pôr um arquivo:
// - add(nome, buffer): arquivo pequeno que já está na memória (fotos do portal do convidado);
// - addStream(nome, tamanho, pedaços): arquivo que vem do Backblaze aos pedaços (vídeos de GBs). O CRC é calculado no caminho e vai
//   num "data descriptor" depois dos dados; acima de 4 GB (arquivo ou posição) entra o formato ZIP64.
// Como o tamanho de cada arquivo é conhecido antes, zipLength() diz o tamanho exato do ZIP (Content-Length: o navegador mostra o
// andamento e o tempo que falta).
// Uso: const zip = zipStream(res); await zip.addStream('a.mp4', 123, body); …; await zip.end().
const zlib = require('zlib');

const MAX32 = 0xFFFFFFFF;
const MAX16 = 0xFFFF;

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// Nomes repetidos ganham -2, -3… (antes da extensão). Lista já sem repetição volta igual.
function uniqueNames(names) {
  const used = new Set();
  return names.map((name) => { let n = name; let i = 2; while (used.has(n)) { n = name.replace(/(\.[^.]*)?$/, `-${i}$1`); i += 1; } used.add(n); return n; });
}

const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

// big: a partir de que tamanho/posição usa ZIP64 (só os testes mudam, para conferir o formato sem gerar 4 GB).
function zipStream(out, { big = MAX32 } = {}) {
  const entries = []; let offset = 0;
  // quem baixa pode fechar a aba no meio: aí para de escrever (add/end lançam 'cancelado')
  let closed = false; let waiting = null;
  out.on('close', () => { closed = true; if (waiting) waiting(); });
  async function write(buf) {
    if (closed) throw new Error('cancelado');
    offset += buf.length;
    if (!out.write(buf)) await new Promise((resolve) => { waiting = resolve; out.once('drain', resolve); });
    waiting = null;
    if (closed) throw new Error('cancelado');
  }
  const used = new Set();
  const unique = (name) => { let n = name; let i = 2; while (used.has(n)) { n = name.replace(/(\.[^.]*)?$/, `-${i}$1`); i += 1; } used.add(n); return n; };

  function localHeader({ fname, flags, crc, size, time, date, z64 }) {
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(z64 ? 45 : 20, 4); head.writeUInt16LE(flags, 6); head.writeUInt16LE(0, 8);
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(z64 ? MAX32 : size, 18); head.writeUInt32LE(z64 ? MAX32 : size, 22); head.writeUInt16LE(fname.length, 26);
    // ZIP64 no cabeçalho local: os dois tamanhos vão no data descriptor (aqui, zero)
    const extra = z64 ? Buffer.concat([Buffer.from([0x01, 0x00, 16, 0x00]), u64(0), u64(0)]) : Buffer.alloc(0);
    head.writeUInt16LE(extra.length, 28);
    return Buffer.concat([head, fname, extra]);
  }

  async function add(name, data, when = new Date()) {
    const fname = Buffer.from(unique(name), 'utf8');
    const crc = zlib.crc32(data) >>> 0;
    const { time, date } = dosTime(when);
    const e = { fname, crc, size: data.length, time, date, offset, flags: 0x0800 };
    entries.push(e);
    await write(localHeader({ ...e, z64: false }));
    await write(data);
  }

  // chunks: qualquer iterável assíncrono de pedaços (o body do fetch). Se chegar mais ou menos que size, o ZIP sairia
  // quebrado: lança erro (quem chama derruba a conexão, e o navegador mostra o download como falho).
  async function addStream(name, size, chunks, when = new Date()) {
    const fname = Buffer.from(unique(name), 'utf8');
    const { time, date } = dosTime(when);
    const z64 = size >= big;
    const e = { fname, crc: 0, size, time, date, offset, flags: 0x0808 };
    entries.push(e);
    await write(localHeader({ ...e, crc: 0, size: 0, z64 }));
    let crc = 0; let got = 0;
    for await (const chunk of chunks) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      got += buf.length;
      if (got > size) throw new Error(`${name}: veio maior que o esperado`);
      crc = zlib.crc32(buf, crc);
      await write(buf);
    }
    if (got !== size) throw new Error(`${name}: veio ${got} de ${size} bytes`);
    e.crc = crc >>> 0;
    const desc = z64 ? Buffer.alloc(24) : Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(e.crc, 4);
    if (z64) { desc.writeBigUInt64LE(BigInt(size), 8); desc.writeBigUInt64LE(BigInt(size), 16); } else { desc.writeUInt32LE(size, 8); desc.writeUInt32LE(size, 12); }
    await write(desc);
  }

  async function end() {
    const start = offset;
    for (const e of entries) {
      const bigSize = e.size >= big; const bigOff = e.offset >= big;
      const extra = bigSize || bigOff ? Buffer.concat([
        Buffer.from([0x01, 0x00, (bigSize ? 16 : 0) + (bigOff ? 8 : 0), 0x00]),
        ...(bigSize ? [u64(e.size), u64(e.size)] : []), ...(bigOff ? [u64(e.offset)] : []),
      ]) : Buffer.alloc(0);
      const v = extra.length ? 45 : 20;
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(v, 4); c.writeUInt16LE(v, 6); c.writeUInt16LE(e.flags, 8); c.writeUInt16LE(0, 10);
      c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14); c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(bigSize ? MAX32 : e.size, 20); c.writeUInt32LE(bigSize ? MAX32 : e.size, 24);
      c.writeUInt16LE(e.fname.length, 28); c.writeUInt16LE(extra.length, 30); c.writeUInt32LE(bigOff ? MAX32 : e.offset, 42);
      await write(Buffer.concat([c, e.fname, extra]));
    }
    const cdSize = offset - start;
    const z64 = entries.length >= MAX16 || cdSize >= big || start >= big;
    if (z64) {
      const at = offset;
      const rec = Buffer.alloc(56);
      rec.writeUInt32LE(0x06064b50, 0); rec.writeBigUInt64LE(44n, 4); rec.writeUInt16LE(45, 12); rec.writeUInt16LE(45, 14);
      rec.writeBigUInt64LE(BigInt(entries.length), 24); rec.writeBigUInt64LE(BigInt(entries.length), 32);
      rec.writeBigUInt64LE(BigInt(cdSize), 40); rec.writeBigUInt64LE(BigInt(start), 48);
      const loc = Buffer.alloc(20);
      loc.writeUInt32LE(0x07064b50, 0); loc.writeBigUInt64LE(BigInt(at), 8); loc.writeUInt32LE(1, 16);
      await write(Buffer.concat([rec, loc]));
    }
    const eocd = Buffer.alloc(22);
    const n = z64 && entries.length >= MAX16 ? MAX16 : entries.length;
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(n, 8); eocd.writeUInt16LE(n, 10);
    eocd.writeUInt32LE(z64 && cdSize >= big ? MAX32 : cdSize, 12); eocd.writeUInt32LE(z64 && start >= big ? MAX32 : start, 16);
    await write(eocd);
    out.end();
  }

  return { add, addStream, end };
}

// Tamanho exato do ZIP feito só com addStream, na mesma ordem, com nomes já sem repetição (uniqueNames).
function zipLength(files, { big = MAX32 } = {}) {
  let offset = 0; let cd = 0;
  for (const f of files) {
    const nameLen = Buffer.byteLength(f.name, 'utf8');
    const z64 = f.size >= big;
    const bigOff = offset >= big;
    cd += 46 + nameLen + (z64 || bigOff ? 4 + (z64 ? 16 : 0) + (bigOff ? 8 : 0) : 0);
    offset += 30 + nameLen + (z64 ? 20 : 0) + f.size + (z64 ? 24 : 16);
  }
  const z64end = files.length >= MAX16 || cd >= big || offset >= big;
  return offset + cd + (z64end ? 76 : 0) + 22;
}

module.exports = { zipStream, zipLength, uniqueNames };
