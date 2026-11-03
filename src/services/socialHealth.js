// Vigia das contas de redes sociais. De tempos em tempos (e no botão "Verificar agora") pergunta a cada provedor configurado quais
// contas estão conectadas e se o acesso ainda vale, guarda o estado de cada (provedor, rede) em social_account_status e avisa a gestão
// quando uma conta que já funcionou deixa de funcionar:
//   ok      — conectada e com acesso válido
//   reauth  — o provedor diz que precisa reconectar (token vencido ou revogado)
//   sumiu   — já esteve conectada e não aparece mais (desconectada ou desativada no provedor)
// Conta que nunca apareceu não é "desconectada": é só "sem conta" (o painel mostra, mas não avisa).
// Só avisa o que importa: a conta que atende a rede agora (rota da rede) e o Upload-Post, exceto no X (insights, comentários, directs e
// automações dependem dele). Provedor que não responde não conclui nada: não vira alarme falso de "desconectada".
const db = require('../db/pool');
const socialApi = require('./socialApi');
const up = require('./uploadPost');

const REMIND_MS = 24 * 3600_000; // lembra de novo depois de 1 dia, até MAX_NOTICES avisos por queda
const MAX_NOTICES = 3;
const DASHBOARD = { uploadpost: 'https://www.upload-post.com', zernio: 'https://zernio.com', outstand: 'https://www.outstand.so/app' };
const STATUS_LABEL = { ok: 'Conectada', reauth: 'Reconectar', sumiu: 'Desconectada' };
const netLabel = (n) => up.PLATFORMS[n]?.label || n;

// A conta deste (provedor, rede) é a que publica agora? O Upload-Post conta nas redes de insights, comentários e automações, mas não no X
// (o X sai pela Zernio ou pela Outstand): conta de X no Upload-Post não gera alerta.
const inUse = (provider, network, map) => map[network] === provider || (provider === 'uploadpost' && network !== 'x');

async function apply(provider, platforms) {
  const { rows: known } = await db.query('SELECT * FROM social_account_status WHERE provider = $1', [provider]);
  const byNet = new Map(known.map((r) => [r.network, r]));
  const recovered = [];
  for (const [net, acc] of Object.entries(platforms)) {
    const status = acc.reauth ? 'reauth' : 'ok';
    const prev = byNet.get(net);
    if (!prev) {
      await db.query(
        'INSERT INTO social_account_status (provider, network, handle, account_id, status, last_ok_at) VALUES ($1,$2,$3,$4,$5, CASE WHEN $5 = \'ok\' THEN now() END)',
        [provider, net, acc.handle || null, acc.accountId || null, status]);
    } else if (prev.status !== status) {
      await db.query(
        `UPDATE social_account_status SET status = $3, since = now(), handle = $4, account_id = $5, notified_at = NULL, notices = 0, last_checked_at = now(),
                last_ok_at = CASE WHEN $3 = 'ok' THEN now() ELSE last_ok_at END WHERE provider = $1 AND network = $2`,
        [provider, net, status, acc.handle || null, acc.accountId || null]);
      if (status === 'ok' && prev.notices > 0) recovered.push({ ...prev, handle: acc.handle || prev.handle });
    } else {
      await db.query(
        `UPDATE social_account_status SET handle = $3, account_id = $4, last_checked_at = now(), last_ok_at = CASE WHEN status = 'ok' THEN now() ELSE last_ok_at END
          WHERE provider = $1 AND network = $2`, [provider, net, acc.handle || null, acc.accountId || null]);
    }
  }
  for (const [net, prev] of byNet) {
    if (net in platforms) continue;
    if (prev.status !== 'sumiu') await db.query("UPDATE social_account_status SET status = 'sumiu', since = now(), notified_at = NULL, notices = 0, last_checked_at = now() WHERE provider = $1 AND network = $2", [provider, net]);
    else await db.query('UPDATE social_account_status SET last_checked_at = now() WHERE provider = $1 AND network = $2', [provider, net]);
  }
  return recovered;
}

const notifyTeam = (args) => require('./notify').notify({ type: 'integracao', broadcast: true, url: '/integracoes#redes', ...args }).catch((err) => console.error('[contas das redes] aviso:', err.message));

// Avisa as quedas que ainda não foram avisadas (ou que merecem um lembrete) e as que voltaram.
async function remind(recovered = []) {
  const map = await socialApi.routeMap();
  for (const r of recovered) {
    if (!inUse(r.provider, r.network, map)) continue;
    await notifyTeam({ title: `${netLabel(r.network)}${r.handle ? ` (@${String(r.handle).replace(/^@/, '')})` : ''} reconectado`, body: `A conta voltou a funcionar ${socialApi.get(r.provider).at}.`, dedupe: `conta-ok-${r.provider}-${r.network}-${Date.now()}` });
  }
  const { rows } = await db.query(
    `SELECT * FROM social_account_status WHERE status <> 'ok' AND notices < $1 AND (notified_at IS NULL OR notified_at < now() - ($2 || ' milliseconds')::interval)`, [MAX_NOTICES, String(REMIND_MS)]);
  let sent = 0;
  for (const r of rows) {
    if (!inUse(r.provider, r.network, map)) continue;
    const via = socialApi.get(r.provider);
    const who = `${netLabel(r.network)}${r.handle ? ` (@${String(r.handle).replace(/^@/, '')})` : ''}`;
    const again = r.notices > 0;
    await notifyTeam({
      title: r.status === 'reauth' ? `Reconectar ${who} ${via.at}` : `${who} desconectado ${via.at}`,
      body: `${r.status === 'reauth' ? 'O acesso venceu ou foi revogado' : 'A conta não aparece mais conectada'}. Enquanto isso, as publicações em ${netLabel(r.network)}${r.provider === 'uploadpost' ? ' e os insights, comentários e automações' : ''} falham. Reconecte no painel ${via.of} e use "Verificar agora" em Integrações.${again ? ' (lembrete)' : ''}`,
      dedupe: `conta-${r.provider}-${r.network}-${new Date(r.since).getTime()}-${r.notices}`,
    });
    await db.query('UPDATE social_account_status SET notified_at = now(), notices = notices + 1 WHERE provider = $1 AND network = $2', [r.provider, r.network]);
    sent += 1;
  }
  return sent;
}

// Verifica os provedores configurados (todos, ou só os de `only`). Devolve { problems, errors, notices }.
async function check({ only = null, notify = true } = {}) {
  const errors = []; const recovered = [];
  for (const p of socialApi.list().filter((x) => x.configured() && (!only || only.includes(x.id)))) {
    const res = await p.connected({ force: true });
    if (!res.ok) { errors.push({ provider: p.id, label: p.label, error: res.error }); continue; } // sem resposta: não conclui nada
    recovered.push(...await apply(p.id, res.platforms));
  }
  const notices = notify ? await remind(recovered) : 0;
  resetCache();
  return { problems: await problems(), errors, notices };
}

// Quedas que importam agora (para o aviso nas telas e para o painel de Integrações).
async function problems() {
  const map = await socialApi.routeMap();
  const { rows } = await db.query("SELECT * FROM social_account_status WHERE status <> 'ok' ORDER BY since");
  return rows.filter((r) => inUse(r.provider, r.network, map)).map((r) => ({
    ...r, networkLabel: netLabel(r.network), providerLabel: socialApi.get(r.provider).label, at: socialApi.get(r.provider).at, of: socialApi.get(r.provider).of, dashboard: DASHBOARD[r.provider], statusLabel: STATUS_LABEL[r.status],
    text: `${netLabel(r.network)}${r.handle ? ` (@${String(r.handle).replace(/^@/, '')})` : ''} ${r.status === 'reauth' ? `precisa ser reconectado ${socialApi.get(r.provider).at}` : `está desconectado ${socialApi.get(r.provider).at}`}`,
  }));
}

// Igual a problems(), guardado por 30 s: as telas consultam a cada página aberta.
let cached = { at: 0, value: [] };
async function problemsCached() {
  if (Date.now() - cached.at < 30_000) return cached.value;
  cached = { at: Date.now(), value: await problems().catch(() => []) };
  return cached.value;
}
const resetCache = () => { cached = { at: 0, value: [] }; };

// A tabela do painel: uma linha por (provedor, rede) conhecida, mais as redes que têm rota mas nenhuma conta ainda ("sem conta").
async function overview() {
  const map = await socialApi.routeMap();
  const { rows } = await db.query('SELECT * FROM social_account_status');
  const out = rows.map((r) => ({ provider: r.provider, providerLabel: socialApi.get(r.provider).label, network: r.network, networkLabel: netLabel(r.network), handle: r.handle, status: r.status, statusLabel: STATUS_LABEL[r.status], since: r.since, checkedAt: r.last_checked_at, inUse: inUse(r.provider, r.network, map), dashboard: DASHBOARD[r.provider] }));
  // "Sem conta" só para o que o Pulso publica de verdade (as redes padrão) ou o que a gestão mandou por uma rota; o resto não polui a lista
  const wanted = new Set([...up.DEFAULTS.episode, ...up.DEFAULTS.clip, ...Object.keys(await socialApi.routes())]);
  for (const [net, id] of Object.entries(map)) {
    if (!wanted.has(net) || !up.PLATFORMS[net] || out.some((o) => o.provider === id && o.network === net)) continue;
    out.push({ provider: id, providerLabel: socialApi.get(id).label, network: net, networkLabel: netLabel(net), handle: null, status: 'sem', statusLabel: 'Sem conta', since: null, checkedAt: null, inUse: true, dashboard: DASHBOARD[id] });
  }
  const order = Object.keys(up.PLATFORMS);
  return out.sort((a, b) => (Number(b.inUse) - Number(a.inUse)) || (order.indexOf(a.network) - order.indexOf(b.network)) || a.provider.localeCompare(b.provider));
}

// Redes (dentre `networks`) cujo acesso já se sabe vencido neste provedor: o envio nem tenta e explica.
async function reauthOf(provider, networks) {
  const { rows } = await db.query("SELECT network FROM social_account_status WHERE provider = $1 AND status = 'reauth' AND network = ANY($2)", [provider, networks]);
  return rows.map((r) => r.network);
}

// Rotina do worker (a cada 15 min): só roda se houver provedor configurado.
async function tick() {
  if (!socialApi.list().some((p) => p.configured())) return;
  await check();
}

module.exports = { STATUS_LABEL, DASHBOARD, check, problems, problemsCached, resetCache, overview, reauthOf, remind, tick };
