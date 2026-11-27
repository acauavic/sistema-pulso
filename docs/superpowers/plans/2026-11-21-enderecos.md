# Endereços: a gerência na casa, o que é público no projeto — fase 6

**Objetivo:** o painel passa a viver no domínio da casa (`studio.healthscale.com.br`) e cada projeto tem o seu
domínio público (`projects.public_host`), sem nenhum link já enviado do Pulso quebrar.

**Especificação:** `docs/superpowers/specs/2026-11-20-multiprojetos-design.md` (seção "Endereços").
**Branch:** `enderecos` (a partir de `dinheiro-por-projeto`). **Versão:** 1.103.0.

## Restrições que valem em tudo

- **Nenhum link antigo do Pulso muda**: `sistema.podcastpulso.com/convite/…`, portal, media kit, `/pos-gravacao`,
  links curtos. O `public_host` do Pulso é exatamente o endereço de hoje.
- Um lugar só gera link público: `publicUrl(projectId, caminho)`. Link para a equipe usa o endereço do painel.
- Domínio de projeto **não** serve tela do painel, e a sessão do painel não vale nele (cookie é do host).
- Sem `public_host` configurado (desenvolvimento, teste), tudo continua no mesmo endereço: nada de redirecionamento.
- Chaves do encurtador e do e-mail ficam em variáveis de ambiente, nunca no banco.

## Tarefas

1. **`services/publicUrl.js`**: `publicUrl(projectId, path)` (host do projeto, senão `config.publicBaseUrl`),
   `panelUrl(path)`, `hostOf(projectId)`, `projectByHost(host)`. Teste: link do Pulso igual ao de hoje; link do
   Projeto 100 no host dele; projeto sem host cai no padrão.
2. **`middleware/hostContext.js`** (antes das rotas públicas): decide `req.hostProject` pelo `Host`. No domínio do
   painel, nada muda. No domínio de um projeto, só caminho público passa (lista de prefixos); o resto redireciona
   (302) para o painel. `wrongHost(req, projectId)` devolve o endereço certo quando o link é de outro projeto.
3. **Geradores de link público** passam a usar `publicUrl`: `services/guests.js` (convite), `services/sponsors.js`
   (portal e media kit), `services/guestPortal.js`, `services/studioLinks.js`, `routes/plateia.js` (canônico e
   imagem de compartilhamento), `routes/gestao.js` (QR do pós-gravação), `services/siteImages.js`.
4. **Rotas públicas** conferem o host do item (`wrongHost`) e redirecionam: convite, portal do convidado, portal e
   media kit do patrocinador, plateia, link do estúdio, pós-gravação (projeto padrão).
5. **Favicon, título e imagem de compartilhamento por domínio**: `partials/public-head.ejs` lê a marca do projeto
   (`src/public/brand/<slug>/`); `/favicon.ico` e `/apple-touch-icon.png` respondem pelo projeto do domínio.
6. **Links curtos por projeto**: `config.yourls` passa a ser um mapa por projeto (`YOURLS_LINK_<SLUG>`,
   `YOURLS_KEY_<SLUG>`), com o Pulso nas variáveis de hoje; projeto sem encurtador usa o link inteiro.
7. **E-mails para fora**: remetente do projeto (`projects.mail_from_name/mail_from_address`); e-mail da equipe sai
   como Health Scale Studio.
8. **Teste `test/enderecos.test.js`**: no domínio de um projeto toda rota do painel redireciona e nenhuma responde
   tela interna; link público no domínio errado vai para o certo; todo link antigo do Pulso responde como antes;
   `/favicon.ico` muda com o domínio; a sessão do painel não vale no domínio de projeto.

## Depende do dono (antes de publicar)

- Apontar `studio.healthscale.com.br` e o subdomínio do Projeto 100 (adotado `links.projeto100.com`) para o servidor,
  com o Cloudflare na frente, e um bloco por domínio no Caddy.
- `APP_BASE_URL` passa a ser o domínio do painel; `projects.public_host` do Pulso fica com o endereço de hoje.
- Quem instalou o app no celular instala de novo (endereço novo = outro app para o navegador).
- "Não sou robô" (Cloudflare Turnstile) e os avisos das redes ganham os domínios novos.

## Como ficou (2026-11-21)

Feito como planejado, com três desvios:

- `middleware/hostContext.js` virou **`services/hostContext.js`** (exporta `middleware`, como `services/perf.js`):
  `require('./middleware')` já resolve para `middleware.js`, e uma pasta com o mesmo nome confundiria.
- `projects.public_host` fica **vazio no banco**; quem liga é a gestão, na tela de Projetos ("Fora do painel"), depois
  que o DNS aponta. A migração não escreve endereço nenhum — assim desenvolvimento e teste seguem num endereço só.
- Entrou uma coluna que não estava no plano: **`projects.public_name`** (migração 101). Sem ela, trocar
  `config.podcastName` pelo nome do projeto mudaria o texto de todo convite ("Pulso" em vez de "Podcast Pulso").
  `config.podcastName` deixou de existir; quem precisa do nome usa `projects.publicName(projectId)`.

Também entrou no escopo (estava em "Em aberto" da especificação): `partials/public-head.ejs` não foi criado — as sete
páginas públicas em EJS passaram a usar `res.locals.brandDir` direto (uma linha por ícone), e os dois modelos em HTML
(convite e media kit) ganharam a variável `{{brand_dir}}`. Um cabeçalho comum só valeria a pena se as páginas tivessem
o mesmo `<head>`, e elas não têm: cada uma é um documento com identidade própria.
