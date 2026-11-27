// Páginas públicas pequenas (404 e "convite aceito"), na marca do Pulso e sem dependências externas.
const tpl = require('./inviteTemplate');

const shell = (title, body, head = '') =>
  '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  `<title>${tpl.esc(title)}</title>${head}` +
  '<body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;text-align:center;color:#FAFAFA;background:#0A0A0A">' +
  '<p style="font-size:44px;font-weight:700;letter-spacing:-0.06em;margin:0 0 24px">pulso<span style="color:#C8FF42">.</span></p>' +
  `${body}</body></html>`;

const notFoundHtml = () => shell('Convite não encontrado',
  '<h1 style="font-size:22px">Convite não encontrado</h1><p style="color:#B5B5B5">Este link não é válido ou foi substituído por um mais recente. Fale com a equipe do podcast para receber um novo.</p>');

// Aviso simples na marca (link do patrocinador inexistente, página ainda não liberada…).
const messageHtml = (title, text) => shell(title,
  `<h1 style="font-size:22px">${tpl.esc(title)}</h1><p style="color:#B5B5B5;line-height:1.5">${tpl.esc(text)}</p>`);

// Página de confirmação que leva ao WhatsApp (meta refresh + link manual, sem JavaScript).
function acceptedHtml({ firstName, whatsappUrl, seconds = 3 }) {
  const url = tpl.esc(whatsappUrl);
  return shell('Convite aceito',
    `<h1 style="font-size:24px;margin:0 0 12px">Convite aceito</h1>
<p style="color:#B5B5B5;line-height:1.5;margin:0 0 24px">Obrigado${firstName ? `, ${tpl.esc(firstName)}` : ''}. Estamos te levando para o WhatsApp da produção para combinar a data da gravação.</p>
<p style="margin:0 0 8px"><a href="${url}" style="display:inline-block;background:#C8FF42;color:#0A0A0A;text-decoration:none;font-weight:700;border-radius:999px;padding:13px 26px">Abrir o WhatsApp agora</a></p>
<p style="color:#6B6B6B;font-size:13px;margin:16px 0 0">Redirecionando em ${seconds} segundos…</p>`,
    `<meta http-equiv="refresh" content="${seconds};url=${url}">`);
}

module.exports = { notFoundHtml, messageHtml, acceptedHtml };
