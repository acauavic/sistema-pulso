// WhatsApp para onde vão os botões dos convites (convidado -> produção) e do media kit (patrocinador -> comercial), com a mensagem pronta.
// Fica em Gestão > WhatsApp dos convites; o que estiver vazio usa o valor das variáveis de ambiente (PRODUCAO_WHATSAPP, PATROCINIO_WHATSAPP).
const config = require('../config');
const settingsSvc = require('./settings');

// {nome} = nome do convidado ou da empresa; {podcast} = nome do podcast.
const GROUPS = {
  producao: {
    label: 'Produção (convidados)', who: 'convidado', envKey: 'whatsappProducao', numberKey: 'whatsapp_producao',
    messages: {
      aceitar: { key: 'whatsapp_msg_aceitar', label: 'Ao aceitar o convite', hint: 'Abre depois que o convidado clica em "Aceitar o convite".', fallback: 'Olá! Sou {nome} e aceito o convite para o {podcast}. Podemos alinhar a data da gravação?' },
      producao: { key: 'whatsapp_msg_producao', label: 'Ao falar com a produção', hint: 'Abre quando o convidado clica em "Falar com a produção".', fallback: 'Olá! Sou {nome} e gostaria de falar com a produção do {podcast}.' },
      portal: { key: 'whatsapp_msg_portal', label: 'No portal do convidado', hint: 'Abre quando o convidado clica em "Falar com a produção" no portal (por exemplo, para combinar outra forma de collab).', fallback: 'Olá! Sou {nome}. Vi o meu portal do {podcast} e queria combinar com a produção a forma das collabs.' },
    },
  },
  patrocinio: {
    label: 'Comercial (patrocinadores)', who: 'patrocinador', envKey: 'whatsappPatrocinio', numberKey: 'whatsapp_patrocinio',
    messages: {
      quero: { key: 'whatsapp_msg_quero', label: 'Ao querer ser patrocinador', hint: 'Abre depois do clique em "Quero ser patrocinador" no media kit.', fallback: 'Oi, quero ser um patrocinador do {podcast}! Sou da {nome}.' },
      equipe: { key: 'whatsapp_msg_equipe', label: 'Ao falar com a equipe', hint: 'Abre quando o patrocinador clica em "Falar com a equipe".', fallback: 'Oi, quero saber mais sobre como funciona para ser parceiro do {podcast}. Sou da {nome}.' },
    },
  },
};

// Só dígitos, com o código do Brasil quando vier só DDD + número (10 ou 11 dígitos). Devolve '' se não parecer um telefone.
function normalizeNumber(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : '';
}

const pretty = (d) => (/^55\d{10,11}$/.test(d) ? `+55 (${d.slice(2, 4)}) ${d.slice(4, d.length - 4)}-${d.slice(-4)}` : (d ? `+${d}` : '—'));

// { producao: { number, numberFromEnv, messages: { aceitar: { text, custom } } }, patrocinio: {...} }
async function current() {
  const keys = Object.values(GROUPS).flatMap((g) => [g.numberKey, ...Object.values(g.messages).map((m) => m.key)]);
  const s = await settingsSvc.getMany(keys);
  const out = {};
  for (const [name, g] of Object.entries(GROUPS)) {
    const saved = normalizeNumber(s[g.numberKey]);
    out[name] = {
      number: saved || config[g.envKey], numberFromEnv: !saved,
      messages: Object.fromEntries(Object.entries(g.messages).map(([k, m]) => [k, { text: String(s[m.key] || '').trim() || m.fallback, custom: Boolean(String(s[m.key] || '').trim()) }])),
    };
  }
  return out;
}

const fill = (text, vars) => String(text).replace(/\{(nome|podcast)\}/g, (all, k) => vars[k]);

// Link wa.me com a mensagem pronta. group: 'producao' | 'patrocinio'; kind: chave da mensagem; name: quem clicou.
async function waUrl(group, kind, name) {
  const cur = (await current())[group];
  const text = fill(cur.messages[kind].text, { nome: name, podcast: config.podcastName });
  return `https://wa.me/${cur.number}?text=${encodeURIComponent(text)}`;
}

// body: { numero, msg_<tipo>: texto }. Número vazio volta ao padrão do servidor; mensagem vazia volta à mensagem padrão.
async function save(group, body) {
  const g = GROUPS[group]; if (!g) return { error: 'Grupo inválido.' };
  const raw = String(body.numero || '').trim();
  const number = raw ? normalizeNumber(raw) : '';
  if (raw && !number) return { error: 'Número inválido. Use o DDD e o número, por exemplo (11) 91234-5678, ou com o código do país.' };
  await settingsSvc.set(g.numberKey, number);
  for (const [k, m] of Object.entries(g.messages)) {
    const text = String(body[`msg_${k}`] || '').replace(/\r\n/g, '\n').trim().slice(0, 600);
    await settingsSvc.set(m.key, text === m.fallback ? '' : text);
  }
  return { ok: true };
}

module.exports = { GROUPS, current, waUrl, save, normalizeNumber, pretty };
