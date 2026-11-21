// Pedidos que chegam pelos formulários do site (podcastpulso.com): "quero ser convidado" vira convidado em Prospecção e
// "quero patrocinar" vira patrocinador em Prospecção, os dois com origem "site" e a UTM da visita. A gestão recebe o aviso "site".
// Tudo o que vem da internet é tratado como texto: só string (ou número), cortado no tamanho do campo, validado campo a campo.
const db = require('../db/pool');
const audience = require('./audience');
const guestsSvc = require('./guests');
const sponsorsSvc = require('./sponsors');
const notify = require('./notify');
const rules = require('./guestRules');
const { publicUrl } = require('./siteData');
const { isEmail } = require('../utils/format');
const { createLimiter } = require('../auth/rateLimit');
const { PROFILE_BY_KEY } = require('../constants');

// Só texto: listas, objetos e nulos viram "" (um campo repetido no formulário não vira "a,b").
const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
// Campo de uma linha (nome, empresa, @) perde quebras de linha; os textos longos (tema, o que a marca quer) mantêm.
// Some também: \r, separadores de linha Unicode (U+2028/2029) e controles de direção do texto (U+202A–202E, U+2066–2069).
const text = (v, max, multiline = false) => str(v).replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '').replace(multiline ? /[ \t]+/g : /\s+/g, ' ').trim().slice(0, max);
const accepted = (v) => v === true || ['true', 'on', '1'].includes(str(v).toLowerCase());
const fail = (field, error) => ({ field, error });

// UTM: objeto `utm` ({ utm_source } ou { source }) ou os campos soltos utm_source…utm_content. Guarda { source, medium, … } sem vazios.
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'];
function utmOf(body) {
  const src = body.utm && typeof body.utm === 'object' && !Array.isArray(body.utm) ? body.utm : body;
  const raw = {};
  for (const k of UTM_KEYS) raw[`utm_${k}`] = str(src[`utm_${k}`] ?? src[k]) || null;
  for (const k of ['fbclid', 'gclid']) raw[k] = str(src[k] ?? body[k]) || null;
  const clean = audience.cleanUtm(raw);
  const out = {};
  for (const [k, v] of Object.entries(clean)) if (v) out[k.replace(/^utm_/, '')] = v;
  return Object.keys(out).length ? out : null;
}

function phoneOf(body) {
  const country = (text(body.country, 3) || 'BR').toUpperCase();
  if (!audience.COUNTRY_BY_CODE[country]) return { err: fail('country', 'Escolha o país do WhatsApp.') };
  const phone = audience.validatePhone(country, text(body.phone, 40));
  return phone.error ? { err: fail('phone', phone.error) } : { phone };
}

function validateGuest(body) {
  const name = text(body.name, 150);
  if (name.length < 2) return fail('name', 'Informe seu nome.');
  const instagram = rules.normalizeInstagram(text(body.instagram, 200));
  if (!instagram) return fail('instagram', 'Informe seu Instagram, por exemplo @maria.souza.');
  const { phone, err } = phoneOf(body);
  if (err) return err;
  const email = text(body.email, 254).toLowerCase();
  if (email && !isEmail(email)) return fail('email', 'Confira o e-mail.');
  const profile = text(body.profile, 40);
  if (!Object.hasOwn(PROFILE_BY_KEY, profile)) return fail('profile', 'Escolha o seu perfil.');
  if (!accepted(body.privacy)) return fail('privacy', 'Para enviar, aceite a política de privacidade.');
  return { values: { name, instagram, phone: phone.e164, email: email || null, profile, topic: text(body.topic, 1000, true) || null, utm: utmOf(body) } };
}

function validateSponsor(body) {
  const name = text(body.name, 150);
  if (name.length < 2) return fail('name', 'Informe seu nome.');
  const company = text(body.company, 150);
  if (company.length < 2) return fail('company', 'Informe o nome da empresa ou da marca.');
  const { phone, err } = phoneOf(body);
  if (err) return err;
  const email = text(body.email, 254).toLowerCase();
  if (!isEmail(email)) return fail('email', 'Informe um e-mail válido.');
  const rawSite = text(body.website, 300);
  const website = rawSite ? publicUrl(rawSite) : null;
  if (rawSite && !website) return fail('website', 'Confira o endereço do site.');
  if (!accepted(body.privacy)) return fail('privacy', 'Para enviar, aceite a política de privacidade.');
  return { values: { name, company, role: text(body.role, 150) || null, phone: phone.e164, email, website, goal: text(body.goal, 1000, true) || null, utm: utmOf(body) } };
}

// Teto de avisos: no máximo 30 avisos 'site' por hora (janela móvel). Passou disso, os cadastros continuam entrando, mas o sino
// recebe um resumo só (um por hora) em vez de um aviso por pedido.
const AVISOS_POR_HORA = 30;
const avisoLimiter = createLimiter({ name: 'site_aviso', max: AVISOS_POR_HORA, windowMs: 60 * 60_000 });
const todayBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// Aviso para a gestão; se falhar, o pedido já está salvo e não se perde.
async function warn(title, body, url, dedupe = null) {
  try {
    if (await avisoLimiter.blocked('todos')) {
      await notify.notify({
        type: 'site', broadcast: true, url: '/convidados', dedupe: `site-teto:${new Date().toISOString().slice(0, 13)}`,
        title: 'Muitos pedidos pelo site nesta hora',
        body: `Mais de ${AVISOS_POR_HORA} pedidos em uma hora. Os cadastros continuam entrando com origem site; os avisos voltam quando a hora passar.`,
      });
      return;
    }
    const sent = await notify.notify({ type: 'site', broadcast: true, title, body, url, dedupe });
    if (sent.length) await avisoLimiter.hit('todos');
  } catch (e) { console.error('site: aviso não enviado:', e.message); }
}

// Mesmo Instagram (com ou sem @, maiúscula ou não) não cria outro convidado: registra o pedido no histórico de quem já existe.
// O trinco por Instagram evita dois cadastros quando o mesmo pedido chega duas vezes ao mesmo tempo.
async function createGuest(v) {
  const client = await db.getPool().connect();
  let id; let existing = false;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('site-convidado:' || $1))", [v.instagram]);
    const { rows: [found] } = await client.query(
      "SELECT id, status FROM guests WHERE lower(regexp_replace(coalesce(instagram, ''), '^@+', '')) = $1 ORDER BY id LIMIT 1", [v.instagram]);
    if (found) { id = found.id; existing = found.status; } else {
      ({ rows: [{ id }] } = await client.query(
        // formulário do site: entra no projeto padrão (o site é do Pulso; a fase dos endereços decide pelo domínio)
        `INSERT INTO guests (name, instagram, phone, email, profile, invite_reason, status, origin, utm, project_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'prospect', 'site', $7::jsonb, $8) RETURNING id`,
        [v.name, v.instagram, v.phone, v.email, v.profile, v.topic, v.utm ? JSON.stringify(v.utm) : null, require('./projects').defaultId()]));
    }
    if (!found) await require('./people').sync(id, { client });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
  const details = [v.name, `WhatsApp ${v.phone}`, v.email, PROFILE_BY_KEY[v.profile].label, v.topic && `Tema: ${v.topic}`].filter(Boolean).join(' · ');
  if (existing === 'gravado') {
    // já gravou (e talvez já está no ar): o pedido repetido não polui o histórico
  } else if (existing) {
    await guestsSvc.addEvent(id, null, 'site', `Pediu de novo pelo site: ${details}`);
    // quem foi perdido ou cancelado e pede de novo é um pedido de verdade: a gestão fica sabendo (um aviso por convidado por dia)
    if (['perdido', 'cancelado'].includes(existing)) {
      await warn(`Pediu de novo pelo site: ${v.name} (@${v.instagram})`, 'Estava como perdido ou cancelado no CRM.', `/convidados/${id}`, `site-convidado:${id}:${todayBR()}`);
    }
  } else {
    await guestsSvc.addEvent(id, null, 'site', `Pediu para ser convidado pelo site${v.utm?.source ? ` (veio de ${v.utm.source})` : ''}`);
    await warn(`Novo pedido de convidado pelo site: ${v.name} (@${v.instagram})`, [PROFILE_BY_KEY[v.profile].label, v.topic].filter(Boolean).join(' · ') || null, `/convidados/${id}`);
  }
  return { id, existing: Boolean(existing) };
}

async function createSponsor(v) {
  const notes = [v.role && `Cargo: ${v.role}`, v.goal && `O que a marca quer: ${v.goal}`].filter(Boolean).join('\n') || null;
  const { rows: [{ id }] } = await db.query(
    `INSERT INTO sponsors (company, contact_name, contact_email, contact_phone, website, notes, stage, origin, utm, project_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'prospect', 'site', $7::jsonb, $8) RETURNING id`,
    [v.company, v.name, v.email, v.phone, v.website, notes, v.utm ? JSON.stringify(v.utm) : null, require('./projects').defaultId()]);
  await sponsorsSvc.addEvent(id, null, 'site', `Pediu para patrocinar pelo site: ${v.name}${v.role ? ` (${v.role})` : ''}${v.utm?.source ? ` · veio de ${v.utm.source}` : ''}`);
  await warn(`Nova marca quer patrocinar: ${v.company}`, [v.name, v.role, v.goal].filter(Boolean).join(' · ') || null, `/patrocinadores/${id}`);
  return { id };
}

module.exports = { validateGuest, validateSponsor, createGuest, createSponsor, utmOf };
