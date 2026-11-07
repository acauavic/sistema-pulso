// Desempenho: quanto cada requisição demorou (e quanto disso foi banco), as lentas guardadas para a Gestão > Desempenho,
// e a velocidade real medida no navegador de quem usa o painel (LCP, INP, CLS, FCP, TTFB).
//
// OpenTelemetry: com OTEL_EXPORTER_OTLP_ENDPOINT (ex.: https://otlp-gateway…/otlp ou http://jaeger:4318), cada requisição lenta
// (ou uma amostra de todas, OTEL_SAMPLE=0.1) vira um trace no formato OTLP/HTTP JSON, com um span por consulta ao banco. Sem a
// variável, nada sai do servidor. Cabeçalhos extras (chave da ferramenta): OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer x".
const crypto = require('crypto');
const os = require('os');
const db = require('../db/pool');

const SLOW_MS = Number(process.env.SLOW_REQUEST_MS || 1000);
const OTLP = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').replace(/\/+$/, '');
const SAMPLE = Math.min(1, Math.max(0, Number(process.env.OTEL_SAMPLE || 0)));
const MAX_SPANS = 200;

const now = () => process.hrtime.bigint();
const msSince = (t) => Number(now() - t) / 1e6;

// Começa a medir (fica antes das rotas). As consultas somam em req.perf pelo gancho do pool (requestCache liga os dois).
function middleware(req, res, next) {
  const perf = { start: now(), startWall: Date.now(), dbMs: 0, dbCount: 0, spans: [] };
  req.perf = perf;
  // Server-Timing: o tempo aparece no painel de rede do navegador (F12), sem ferramenta extra.
  const writeHead = res.writeHead;
  res.writeHead = function patched(...args) {
    try { if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${msSince(perf.start).toFixed(1)}, db;dur=${perf.dbMs.toFixed(1)};desc="${perf.dbCount} consultas"`); } catch { /* cabeçalho já saiu */ }
    return writeHead.apply(this, args);
  };
  res.on('finish', () => finish(req, res).catch((err) => console.error('desempenho:', err.message)));
  next();
}

const routeOf = (req) => (req.route ? `${req.baseUrl || ''}${Array.isArray(req.route.path) ? req.route.path[0] : req.route.path}` : req.path.replace(/\/\d+(?=\/|$)/g, '/:id'));

async function finish(req, res) {
  const perf = req.perf;
  if (!perf || /event-stream/.test(String(res.getHeader('content-type') || ''))) return; // conexão de tempo real fica aberta de propósito
  const ms = msSince(perf.start);
  const route = routeOf(req);
  if (ms >= SLOW_MS) {
    await db.query('INSERT INTO slow_requests (method, route, path, status, ms, db_ms, db_count, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.method, route.slice(0, 200), req.path.slice(0, 300), res.statusCode, Math.round(ms), Math.round(perf.dbMs), perf.dbCount, req.user?.id || null]);
  }
  if (OTLP && (ms >= SLOW_MS || Math.random() < SAMPLE)) queueTrace(req, res, route, ms);
}

// ---------------------------------------------------------------- OpenTelemetry (OTLP/HTTP JSON, sem dependências)
const pending = [];
let timer = null;
const hex = (n) => crypto.randomBytes(n).toString('hex');
const nano = (wallMs) => String(BigInt(Math.round(wallMs * 1e6)));
const attr = (key, v) => ({ key, value: typeof v === 'number' ? { intValue: String(Math.round(v)) } : { stringValue: String(v) } });

function queueTrace(req, res, route, ms) {
  const traceId = hex(16); const root = hex(8); const p = req.perf;
  const spans = [{
    traceId, spanId: root, name: `${req.method} ${route}`, kind: 2, // SERVER
    startTimeUnixNano: nano(p.startWall), endTimeUnixNano: nano(p.startWall + ms),
    attributes: [attr('http.request.method', req.method), attr('http.route', route), attr('url.path', req.path), attr('http.response.status_code', res.statusCode), attr('db.query.count', p.dbCount)],
    status: { code: res.statusCode >= 500 ? 2 : 1 },
  }];
  for (const s of p.spans) {
    spans.push({
      traceId, spanId: hex(8), parentSpanId: root, name: s.text.split(' ').slice(0, 3).join(' '), kind: 3, // CLIENT
      startTimeUnixNano: nano(s.startedAt), endTimeUnixNano: nano(s.startedAt + s.ms),
      attributes: [attr('db.system', 'postgresql'), attr('db.query.text', s.text)],
    });
  }
  pending.push(...spans);
  if (!timer) timer = setTimeout(flush, 5000).unref();
}

async function flush() {
  timer = null;
  const batch = pending.splice(0, pending.length);
  if (!batch.length || !OTLP) return;
  const headers = { 'content-type': 'application/json' };
  for (const pair of String(process.env.OTEL_EXPORTER_OTLP_HEADERS || '').split(',')) { const i = pair.indexOf('='); if (i > 0) headers[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim()); }
  const body = {
    resourceSpans: [{
      resource: { attributes: [attr('service.name', process.env.OTEL_SERVICE_NAME || 'pulso-gestao'), attr('service.version', require('../../package.json').version), attr('host.name', os.hostname())] },
      scopeSpans: [{ scope: { name: 'pulso-gestao/perf' }, spans: batch }],
    }],
  };
  try {
    const r = await fetch(`${OTLP}/v1/traces`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) console.error('OpenTelemetry: o coletor recusou', r.status);
  } catch (err) { console.error('OpenTelemetry:', err.message); }
}

// ---------------------------------------------------------------- velocidade real (navegador)
const METRICS = new Set(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']);
// Página agrupada: números e códigos viram :id (/convidados/12 → /convidados/:id).
const pageOf = (p) => String(p || '/').split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:token').slice(0, 120) || '/';

async function saveVitals(user, body) {
  const page = pageOf(body.page);
  const device = body.device === 'celular' ? 'celular' : 'computador';
  const rows = (Array.isArray(body.metrics) ? body.metrics : []).slice(0, 10)
    .filter((m) => METRICS.has(m.name) && Number.isFinite(Number(m.value)) && Number(m.value) >= 0 && Number(m.value) < (m.name === 'CLS' ? 50 : 600_000));
  if (!rows.length) return 0;
  await db.query(
    `INSERT INTO web_vitals (page, metric, value, device, user_id)
     SELECT $1, m->>'name', (m->>'value')::float, $2, $3 FROM jsonb_array_elements($4::jsonb) m`,
    [page, device, user?.id || null, JSON.stringify(rows.map((m) => ({ name: m.name, value: Number(m.value) })))]);
  return rows.length;
}

// Limites do Google para "bom" e "ruim" (o p75 de cada página é comparado com eles).
const LIMITS = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] };
const grade = (metric, v) => (v == null ? null : v <= LIMITS[metric][0] ? 'bom' : v <= LIMITS[metric][1] ? 'melhorar' : 'ruim');

// Tudo que a página de desempenho mostra (últimos `days` dias).
async function report(days = 7) {
  const since = `now() - interval '${Number(days)} days'`;
  const [{ rows: vitals }, { rows: slow }, { rows: recent }, statements] = await Promise.all([
    db.query(`SELECT page, metric, count(*)::int AS n, percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
                FROM web_vitals WHERE at > ${since} GROUP BY page, metric`),
    db.query(`SELECT method, route, count(*)::int AS n, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ms))::int AS p50, max(ms)::int AS max,
                     round(avg(db_ms))::int AS db_ms, round(avg(db_count))::int AS db_count
                FROM slow_requests WHERE at > ${since} GROUP BY method, route ORDER BY count(*) DESC, max(ms) DESC LIMIT 20`),
    db.query(`SELECT s.at, s.method, s.path, s.status, s.ms, s.db_ms, s.db_count, u.name AS user_name FROM slow_requests s LEFT JOIN users u ON u.id = s.user_id
                WHERE s.at > ${since} ORDER BY s.at DESC LIMIT 15`),
    slowStatements(),
  ]);
  const pages = new Map();
  for (const r of vitals) {
    if (!pages.has(r.page)) pages.set(r.page, { page: r.page, n: 0, m: {} });
    const p = pages.get(r.page);
    p.m[r.metric] = { p75: r.p75, grade: grade(r.metric, r.p75) };
    if (r.metric === 'TTFB' || r.metric === 'LCP') p.n = Math.max(p.n, r.n);
  }
  return { days, pages: [...pages.values()].sort((a, b) => b.n - a.n).slice(0, 15), slow, recent, statements, slowMs: SLOW_MS, otlp: Boolean(OTLP) };
}

// Consultas mais demoradas no total (pg_stat_statements). null se a extensão não estiver ligada.
async function slowStatements() {
  try {
    const { rows } = await db.query(
      `SELECT calls::int, round(mean_exec_time::numeric, 1)::float AS mean_ms, round(total_exec_time::numeric)::float AS total_ms, rows::bigint AS rows,
              left(regexp_replace(query, '\\s+', ' ', 'g'), 220) AS query
         FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND query NOT ILIKE '%pg_stat_statements%' AND query !~* '^(BEGIN|COMMIT|ROLLBACK|SET|SHOW|LISTEN|SELECT pg_notify|SELECT pg_(try_)?advisory)'
        ORDER BY total_exec_time DESC LIMIT 15`);
    return rows;
  } catch { return null; }
}

const purge = () => Promise.all([
  db.query("DELETE FROM slow_requests WHERE at < now() - interval '30 days'"),
  db.query("DELETE FROM web_vitals WHERE at < now() - interval '60 days'"),
]);

module.exports = { middleware, saveVitals, report, grade, LIMITS, purge, pageOf, flush, SLOW_MS };
