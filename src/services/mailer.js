// E-mail transacional via SMTP da Brevo (smtp-relay.brevo.com:587, STARTTLS).
// Usuário = BREVO_USER (login SMTP), senha = BREVO_CHAVE_SMTP (chave SMTP), remetente = BREVO_EMAIL.
const nodemailer = require('nodemailer');
const config = require('../config');

let transport;

function getTransport() {
  if (!config.mailConfigured) throw new Error('SMTP da Brevo não configurado (BREVO_USER, BREVO_CHAVE_SMTP, BREVO_EMAIL).');
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.brevo.host,
      port: config.brevo.port,
      secure: config.brevo.port === 465,
      requireTLS: config.brevo.port !== 465,
      auth: { user: config.brevo.user, pass: config.brevo.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transport;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Duas molduras de e-mail, uma por público. Tabelas + estilos inline e fontes seguras (clientes de e-mail não carregam as da marca).
// 'pulso' (padrão: convidado, patrocinador, tudo o que sai para fora pelo projeto Pulso; docs/manual-de-marca.md): cabeçalho preto com
// o wordmark "pulso." e ponto lime, corpo em bone, botão preto com ponto lime.
// 'studio' (equipe: acesso, senha, avisos do painel; docs/design-system.md): cabeçalho escuro com a assinatura Health Scale + STUDIO.
const DISPLAY = "'Space Grotesk','Helvetica Neue',Arial,sans-serif";
const MONO = "'JetBrains Mono',Menlo,Consolas,monospace";
const STUDIO = 'Health Scale Studio';
function layoutStudio({ title, bodyHtml, button, footer }) {
  const sans = "Archivo,'Helvetica Neue',Arial,sans-serif";
  const btn = button
    ? `<p style="margin:28px 0"><a href="${esc(button.url)}" style="background:#101210;color:#F4F4F0;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;display:inline-block">${esc(button.label)}</a></p>
       <p style="font-size:12px;color:#5E6159;word-break:break-all">Se o botão não funcionar, copie este endereço no navegador:<br>${esc(button.url)}</p>`
    : '';
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F4F4F0;font-family:${sans}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:6px;overflow:hidden">
<tr><td style="background:#0E0F0D;color:#F4F4F0;padding:20px 28px;font-size:24px;line-height:1"><span style="font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-style:italic">Health</span><span style="font-family:${sans};font-weight:800;letter-spacing:-0.02em">Scale</span><span style="color:#54574F;padding:0 12px">|</span><span style="font-family:${MONO};font-size:11px;letter-spacing:.2em;color:#9EDD55">STUDIO</span></td></tr>
<tr><td style="padding:28px;color:#101210;font-size:15px;line-height:1.6">
<h1 style="font-family:${sans};font-size:24px;letter-spacing:-0.02em;line-height:1.15;margin:0 0 16px">${esc(title)}</h1>${bodyHtml}${btn}
</td></tr>
<tr><td style="padding:16px 28px;background:#F4F4F0;color:#5E6159;font-family:${MONO};font-size:11px;letter-spacing:.08em;text-transform:uppercase">${esc(footer || `Mensagem enviada pelo ${STUDIO}.`)}</td></tr>
</table></td></tr></table></body></html>`;
}
function layout({ title, bodyHtml, button, footer, brand = 'pulso' }) {
  if (brand === 'studio') return layoutStudio({ title, bodyHtml, button, footer });
  const btn = button
    ? `<p style="margin:28px 0"><a href="${esc(button.url)}" style="background:#0A0A0A;color:#FAFAFA;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;display:inline-block">${esc(button.label)} <span style="color:#C8FF42">&#9679;</span></a></p>
       <p style="font-size:12px;color:#6B6B6B;word-break:break-all">Se o botão não funcionar, copie este endereço no navegador:<br>${esc(button.url)}</p>`
    : '';
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F0EDE3;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:6px;overflow:hidden">
<tr><td style="background:#0A0A0A;color:#FAFAFA;padding:20px 28px;font-family:${DISPLAY};font-size:26px;font-weight:700;letter-spacing:-0.06em">pulso<span style="color:#C8FF42">.</span></td></tr>
<tr><td style="padding:28px;color:#0A0A0A;font-size:15px;line-height:1.6">
<h1 style="font-family:${DISPLAY};font-size:24px;letter-spacing:-0.04em;line-height:1.15;margin:0 0 16px">${esc(title)}</h1>${bodyHtml}${btn}
</td></tr>
<tr><td style="padding:16px 28px;background:#F4F2EC;color:#6B6B6B;font-family:${MONO};font-size:11px;letter-spacing:.08em;text-transform:uppercase">${esc(footer || `Mensagem enviada por ${require('./projects').publicName(null)}.`)}</td></tr>
</table></td></tr></table></body></html>`;
}

// Caixa de saída do modo MAIL_DRY_RUN (útil em dev e nos testes).
const outbox = [];

// fromName: os e-mails da equipe saem como "Health Scale Studio"; sem ele, vale o remetente do projeto (BREVO_FROM_NAME).
// Quem está de fora recebe no nome do projeto do item (nome público e, se a gestão cadastrou, o remetente dele).
// O que é da equipe sai como Health Scale Studio (fromName: STUDIO).
function sender(projectId = null) {
  const projects = require('./projects');
  const p = projects.get(projectId == null ? projects.defaultId() : projectId);
  const from = {};
  if (p && p.mail_from_name) from.fromName = p.mail_from_name;
  if (p && p.mail_from_address) from.fromAddress = p.mail_from_address;
  return { podcast: projects.publicName(projectId), from };
}

async function sendMail({ to, subject, html, text, replyTo, icalEvent, fromName, fromAddress }) {
  if (config.mailDryRun) {
    outbox.push({ to, subject, html, replyTo, icalEvent, fromName });
    console.log(`[mail:dry-run] para=${to} assunto="${subject}"`);
    return `dry-run-${outbox.length}`;
  }
  const info = await getTransport().sendMail({
    from: { name: fromName || config.brevo.fromName, address: fromAddress || config.brevo.from },
    to,
    replyTo,
    subject,
    html,
    icalEvent,
    text: text || html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  });
  return info.messageId;
}

// Checa credenciais/conexão sem enviar nada.
async function verifyMail() {
  if (config.mailDryRun) return true;
  await getTransport().verify();
  return true;
}

const paragraphs = (text) =>
  String(text || '').split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

async function sendUserInvite({ to, name, url, invitedBy }) {
  return sendMail({
    to,
    fromName: STUDIO,
    subject: `Seu acesso ao ${STUDIO}`,
    html: layout({
      brand: 'studio',
      title: `Olá, ${name}`,
      bodyHtml: `<p style="margin:0 0 14px">${esc(invitedBy)} criou um acesso para você no ${STUDIO}, o painel da equipe.</p>
                 <p style="margin:0 0 14px">Clique abaixo para definir sua senha. O link vale por 72 horas e só funciona uma vez.</p>`,
      button: { label: 'Definir minha senha', url },
    }),
  });
}

async function sendPasswordReset({ to, name, url }) {
  return sendMail({
    to,
    fromName: STUDIO,
    subject: `Redefinição de senha: ${STUDIO}`,
    html: layout({
      brand: 'studio',
      title: `Olá, ${name}`,
      bodyHtml: `<p style="margin:0 0 14px">Recebemos um pedido para redefinir sua senha. O link vale por 1 hora e só funciona uma vez.</p>
                 <p style="margin:0 0 14px">Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>`,
      button: { label: 'Criar nova senha', url },
    }),
  });
}

async function sendGuestInvite({ to, guestName, subject, message, url, replyTo, projectId = null }) {
  const p = sender(projectId);
  return sendMail({
    to,
    replyTo,
    subject,
    ...p.from,
    html: layout({
      title: `Olá, ${guestName}!`,
      bodyHtml: paragraphs(message),
      button: { label: 'Ver meu convite', url },
      footer: `Você recebeu este e-mail porque foi convidado(a) para o ${p.podcast}.`,
    }),
  });
}

async function sendRsvpNotice({ to, guestName, accepted, message, url }) {
  return sendMail({
    to,
    fromName: STUDIO,
    subject: `${guestName} ${accepted ? 'aceitou' : 'recusou'} o convite`,
    html: layout({
      brand: 'studio',
      title: `${guestName} ${accepted ? 'aceitou' : 'recusou'} o convite`,
      bodyHtml: message ? `<p style="margin:0 0 14px">Mensagem do convidado:</p><blockquote style="margin:0 0 14px;padding:8px 14px;border-left:3px solid #C9C9C1;color:#54574F">${esc(message)}</blockquote>` : '<p style="margin:0">Sem mensagem adicional.</p>',
      button: { label: 'Abrir no CRM', url },
    }),
  });
}

// Convite de calendário da gravação (REQUEST) ou cancelamento (CANCEL), com o .ics no corpo para o e-mail mostrar "Adicionar ao calendário".
async function sendCalendarInvite({ to, guestName, whenLabel, address, method, ics, update, projectId = null }) {
  const p = sender(projectId);
  const cancel = method === 'CANCEL';
  const first = String(guestName || '').split(/\s+/)[0] || 'tudo bem';
  const body = cancel
    ? `<p>Olá, ${esc(first)}. A gravação do dia <strong>${esc(whenLabel)}</strong> no ${esc(p.podcast)} foi cancelada. O evento sai do seu calendário. Se quiser combinar outra data, é só responder esta mensagem.</p>`
    : `<p>Olá, ${esc(first)}. ${update ? 'A data da sua gravação mudou.' : 'Sua gravação no ' + esc(p.podcast) + ' está marcada.'}</p>
<p style="font-family:${MONO};font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin:16px 0 4px">${esc(whenLabel)}</p>
${address ? `<p style="margin:0 0 16px">${esc(address)}</p>` : ''}
<p>O convite está neste e-mail: use "Sim" ou "Adicionar ao calendário" para guardar a data${update ? ' (ele atualiza o evento anterior)' : ''}. Qualquer dúvida, é só responder esta mensagem. Obrigado por sentar à mesa.</p>`;
  return sendMail({
    to, ...p.from, subject: cancel ? `Gravação cancelada: ${whenLabel}` : `${update ? 'Nova data' : 'Convite'}: gravação no ${p.podcast}, ${whenLabel}`,
    html: layout({ title: cancel ? 'Gravação cancelada' : (update ? 'A data da gravação mudou' : 'Sua gravação está marcada'), bodyHtml: body }),
    icalEvent: { method, content: ics, filename: 'convite-pulso.ics' },
  });
}

async function sendSponsorNotice({ to, title, text, url }) {
  return sendMail({
    to,
    fromName: STUDIO,
    subject: title,
    html: layout({ brand: 'studio', title, bodyHtml: `<p style="margin:0">${esc(text)}</p>`, button: { label: 'Abrir no CRM', url } }),
  });
}

// Portal do convidado: o link (kind 'link') ou os posts novos em collab (kind 'novos', com a lista).
async function sendGuestPortal({ to, guestName, url, kind, posts = [], projectId = null }) {
  const p = sender(projectId);
  const first = String(guestName || '').split(/\s+/)[0] || 'tudo bem';
  const link = (p) => (p.links.find((l) => l.platform === 'instagram') || p.links[0]).url;
  const body = kind === 'novos'
    ? `<p>Olá, ${esc(first)}. ${posts.length > 1 ? `Saíram ${posts.length} posts novos` : 'Saiu um post novo'} em collab com você:</p>
<ul style="padding-left:18px;margin:0 0 16px">${posts.map((p) => `<li style="margin:0 0 6px"><a href="${esc(link(p))}" style="color:#0A0A0A">${esc(p.title)}</a></li>`).join('')}</ul>
<p>Compartilhar nos stories e comentar ajuda o post a chegar mais longe. Está tudo no seu portal, junto com o cronograma da semana.</p>`
    : `<p>Olá, ${esc(first)}. Obrigado por sentar à mesa.</p>
<p>Preparamos o seu portal no ${esc(p.podcast)}: o cronograma da semana do episódio, os posts em collab com você, cortes exclusivos para você postar e as fotos da gravação. Ele vai se atualizando durante a semana.</p>`;
  return sendMail({
    to, ...p.from, subject: kind === 'novos' ? `${posts.length > 1 ? 'Posts novos' : 'Post novo'} em collab com você` : `Seu portal no ${p.podcast}`,
    html: layout({ title: kind === 'novos' ? 'Mais um post em collab' : 'Seu portal está pronto', bodyHtml: body, button: { label: 'Abrir meu portal', url },
      footer: `Você recebeu este e-mail porque participou do ${p.podcast}.` }),
  });
}

// Aviso de notificação do painel (quando a gestão liga o e-mail para aquele tipo).
async function sendNotification({ to, title, text, url }) {
  return sendMail({
    to,
    fromName: STUDIO,
    subject: title,
    html: layout({ brand: 'studio', title, bodyHtml: `<p style="margin:0">${esc(text || '')}</p>`, button: url ? { label: 'Abrir no painel', url } : null }),
  });
}

module.exports = { sendGuestPortal, sendCalendarInvite, sendNotification, sendSponsorNotice, outbox, sendMail, verifyMail, sendUserInvite, sendPasswordReset, sendGuestInvite, sendRsvpNotice };
