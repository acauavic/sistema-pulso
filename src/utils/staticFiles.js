// Arquivos de /static: comprimidos em Brotli (ou gzip, para quem não aceita Brotli) uma vez só, guardados em memória, e com
// cache longo no navegador quando o endereço leva a versão (?v=hash do conteúdo, muda a cada deploy).
// O Caddy comprime o resto (páginas) em zstd/gzip; resposta que já sai comprimida daqui ele deixa como está.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');

const COMPRESSIBLE = new Set(['.css', '.js', '.svg', '.html', '.json', '.webmanifest', '.txt', '.ico', '.map']);
const YEAR = 31536000;

// Cache do navegador: versionado = 1 ano e imutável; fontes e imagens sem versão = 30 dias; o resto (sem versão) = 1 hora.
function cacheControl(req, ext) {
  if (req.query.v) return `public, max-age=${YEAR}, immutable`;
  if (['.woff2', '.woff', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.gif'].includes(ext)) return 'public, max-age=2592000';
  return 'public, max-age=3600';
}

function staticFiles(dir) {
  const memory = new Map(); // caminho -> { mtimeMs, type, etag, br, gzip, raw }
  const plain = express.static(dir, { maxAge: 0, setHeaders: (res, file) => res.setHeader('Cache-Control', res.req ? cacheControl(res.req, path.extname(file).toLowerCase()) : 'public, max-age=3600') });

  function load(file, stat) {
    const hit = memory.get(file);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit;
    const raw = fs.readFileSync(file);
    const entry = {
      mtimeMs: stat.mtimeMs,
      etag: `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`,
      raw,
      br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }),
      gzip: zlib.gzipSync(raw, { level: 9 }),
    };
    memory.set(file, entry);
    return entry;
  }

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    const file = path.join(dir, rel);
    if (!file.startsWith(dir + path.sep)) return res.status(403).end();
    const ext = path.extname(file).toLowerCase();
    const accepts = String(req.get('accept-encoding') || '');
    const enc = /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null;
    if (!COMPRESSIBLE.has(ext) || !enc) return plain(req, res, next);
    let stat;
    try { stat = fs.statSync(file); } catch { return next(); }
    if (!stat.isFile() || path.basename(file).startsWith('.')) return next();
    const entry = load(file, stat);
    const body = entry[enc];
    res.set({ 'Cache-Control': cacheControl(req, ext), 'Content-Encoding': enc, 'Vary': 'Accept-Encoding', 'ETag': entry.etag, 'Last-Modified': new Date(stat.mtimeMs).toUTCString() });
    res.type(ext);
    if (req.fresh) return res.status(304).end();
    res.set('Content-Length', String(body.length));
    return req.method === 'HEAD' ? res.end() : res.end(body);
  };
}

module.exports = { staticFiles, cacheControl };
