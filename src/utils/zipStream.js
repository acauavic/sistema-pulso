// ZIP sem compressão (fotos e vídeos já vêm comprimidos), escrito direto na resposta, um arquivo de cada vez: nada fica todo em memória.
// Uso: const zip = zipStream(res); await zip.add('foto.jpg', buffer); …; zip.end(). Limite do formato simples: 4 GB e 65 mil arquivos.
const zlib = require('zlib');

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function zipStream(out) {
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

  async function add(name, data, when = new Date()) {
    const fname = Buffer.from(unique(name), 'utf8');
    const crc = zlib.crc32(data) >>> 0;
    const { time, date } = dosTime(when);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(0, 8);
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(fname.length, 26); head.writeUInt16LE(0, 28);
    entries.push({ fname, crc, size: data.length, time, date, offset });
    await write(Buffer.concat([head, fname]));
    await write(data);
  }

  async function end() {
    const start = offset;
    for (const e of entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
      c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14); c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.size, 20); c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.fname.length, 28); c.writeUInt32LE(e.offset, 42);
      await write(Buffer.concat([c, e.fname]));
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(offset - start, 12); eocd.writeUInt32LE(start, 16);
    await write(eocd);
    out.end();
  }

  return { add, end };
}

module.exports = { zipStream };
