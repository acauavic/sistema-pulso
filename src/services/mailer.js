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

// Moldura de e-mail na marca Pulso (docs/manual-de-marca.md): cabeçalho preto com wordmark "pulso." e ponto lime,
// corpo em bone, botão preto com ponto lime. Tabelas + estilos inline e fontes seguras (clientes de e-mail não carregam as da marca).
const DISPLAY = "'Space Grotesk','Helvetica Neue',Arial,sans-serif";
const MONO = "'JetBrains Mono',Menlo,Consolas,monospace";
function layout({ title, bodyHtml, button, footer }) {
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
<tr><td style="padding:16px 28px;background:#F4F2EC;color:#6B6B6B;font-family:${MONO};font-size:11px;letter-spacing:.08em;text-transform:uppercase">${esc(footer || `Mensagem enviada por ${config.podcastName}.`)}</td></tr>
</table></td></tr></table></body></html>`;
}

// Caixa de saída do modo MAIL_DRY_RUN (útil em dev e nos testes).
const outbox = [];

async function sendMail({ to, subject, html, text, replyTo }) {
  if (config.mailDryRun) {
    outbox.push({ to, subject, html, replyTo });
    console.log(`[mail:dry-run] para=${to} assunto="${subject}"`);
    return `dry-run-${outbox.length}`;
  }
  const info = await getTransport().sendMail({
    from: { name: config.brevo.fromName, address: config.brevo.from },
    to,
    replyTo,
    subject,
    html,
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
    subject: `Seu acesso à gestão do ${config.podcastName}`,
    html: layout({
      title: `Olá, ${name}!`,
      bodyHtml: `<p style="margin:0 0 14px">${esc(invitedBy)} criou um acesso para você na plataforma de gestão do ${esc(config.podcastName)}.</p>
                 <p style="margin:0 0 14px">Clique abaixo para definir sua senha. O link vale por 72 horas e só funciona uma vez.</p>`,
      button: { label: 'Definir minha senha', url },
    }),
  });
}

async function sendPasswordReset({ to, name, url }) {
  return sendMail({
    to,
    subject: `Redefinição de senha — ${config.podcastName}`,
    html: layout({
      title: `Olá, ${name}`,
      bodyHtml: `<p style="margin:0 0 14px">Recebemos um pedido para redefinir sua senha. O link vale por 1 hora e só funciona uma vez.</p>
                 <p style="margin:0 0 14px">Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>`,
      button: { label: 'Criar nova senha', url },
    }),
  });
}

async function sendGuestInvite({ to, guestName, subject, message, url, replyTo }) {
  return sendMail({
    to,
    replyTo,
    subject,
    html: layout({
      title: `Olá, ${guestName}!`,
      bodyHtml: paragraphs(message),
      button: { label: 'Ver meu convite', url },
      footer: `Você recebeu este e-mail porque foi convidado(a) para o ${config.podcastName}.`,
    }),
  });
}

async function sendRsvpNotice({ to, guestName, accepted, message, url }) {
  return sendMail({
    to,
    subject: `${guestName} ${accepted ? 'aceitou' : 'recusou'} o convite`,
    html: layout({
      title: `${guestName} ${accepted ? 'aceitou' : 'recusou'} o convite`,
      bodyHtml: message ? `<p style="margin:0 0 14px">Mensagem do convidado:</p><blockquote style="margin:0 0 14px;padding:8px 14px;border-left:3px solid #2D1B4E;color:#4A4A4A">${esc(message)}</blockquote>` : '<p style="margin:0">Sem mensagem adicional.</p>',
      button: { label: 'Abrir no CRM', url },
    }),
  });
}

module.exports = { outbox, sendMail, verifyMail, sendUserInvite, sendPasswordReset, sendGuestInvite, sendRsvpNotice };
