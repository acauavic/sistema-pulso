# 🎙️ Pulso Gestão — gestão do podcast

Painel web para a equipe do **Podcast Pulso**: usuários com perfis de acesso, um mini-CRM de
**convidados** (quadro estilo Kanban) e geração do **link do convite** (página personalizada +
link curto no YOURLS + envio por e-mail via Brevo).

> Sistema próprio (não tem relação com o agente da clínica): `package.json`, banco e container
> próprios. Pode compartilhar o servidor Postgres da VPS, mas usa um banco separado.

## Índice

- [O que tem](#o-que-tem)
- [Perfis e permissões](#perfis-e-permissões)
- [Como o convite funciona](#como-o-convite-funciona)
- [Rodando localmente](#rodando-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Testes](#testes)
- [Deploy (Docker Swarm + Traefik)](#deploy-docker-swarm--traefik)
- [Modelos de convite (HTML)](#modelos-de-convite-html)
- [Segurança](#segurança)
- [Identidade visual](#identidade-visual)
- [Estrutura do código](#estrutura-do-código)

## O que tem

- **Login** com e-mail/senha, sessão em cookie `HttpOnly`, "esqueci minha senha" por e-mail.
- **Usuários (CRUD completo)**: criar (a pessoa recebe e-mail para definir a própria senha), editar
  nome/e-mail/perfil, desativar/reativar (derruba as sessões na hora), reenviar acesso, excluir
  (só superadmin), busca e filtros. Travas: ninguém muda o próprio perfil, desativa ou exclui a si
  mesmo; sempre sobra um superadmin ativo; só superadmin mexe em superadmin.
- **Convidados (CRM)**: quadro com arrastar-e-soltar entre etapas (Prospecção → Convite enviado →
  Confirmado → Gravado → Publicado, mais Recusou/Cancelado), visão em lista, filtros por
  responsável, linha do tempo com anotações e histórico automático.
- **Convite**: gera link exclusivo + link curto no YOURLS, prévia, envio por e-mail (Brevo) e
  resposta do convidado direto na página (aceito/recusado atualiza a etapa e avisa o responsável).
- **Modelos de convite**: editor do HTML (com variáveis) e prévia; o seu convite do Pulso já vem como padrão.
- **Auditoria** das ações sensíveis e tela de **Integrações** (status + testes seguros).

## Perfis e permissões

Quatro perfis: **Superadmin**, **Gestão**, **Produtora**, **Editor de Vídeo**.

⚠️ **A matriz abaixo é PROVISÓRIA** (rascunho até definirmos os poderes de cada perfil).
Para mudar, edite só `src/permissions.js` — todas as telas e rotas consultam esse arquivo.

- **Superadmin**: tudo, inclusive excluir usuários e gerenciar outros superadmins.
- **Gestão**: usuários (exceto superadmin, sem excluir), convidados (inclusive excluir), modelos, auditoria e integrações.
- **Produtora**: convidados (criar/editar, gerar e enviar convite) e ver modelos.
- **Editor de Vídeo**: somente leitura em convidados.

## Como o convite funciona

1. Cadastre o convidado (nome, gênero, dupla?, tema, data sugerida, responsável).
2. **Gerar link do convite**: cria um token secreto e imprevisível e a página
   `…/convite/<token>`, e encurta no YOURLS com o nome curto do convidado
   (`link.podcastpulso.com/maria`; se ocupado, `mariasouza`, depois `maria-x7k2`).
   Se o YOURLS estiver fora, o link completo continua valendo.
3. Envie pelo **e-mail** (botão no próprio card) ou copie o link curto e mande pelo WhatsApp.
4. A página do convite mostra o modelo escolhido com os dados do convidado. Ao abrir, o sistema
   registra "convidado abriu o convite" (ignora robôs de pré-visualização do WhatsApp/Facebook).
5. O convidado pode **aceitar/recusar** na própria página (com recado opcional): a etapa muda para
   *Confirmado*/*Recusou* e o responsável recebe um e-mail. O botão de WhatsApp do modelo continua existindo.
6. **Gerar novo link** invalida o anterior (o token antigo passa a dar 404).

## Rodando localmente

Requisitos: Node 22+ e um Postgres.

```bash
cp .env.example .env          # preencha PODCAST_DATABASE_URL e, se quiser, Brevo/YOURLS
npm install
npm run migrate               # cria as tabelas (também roda sozinho ao subir)
npm run create-superadmin -- voce@dominio.com "Seu Nome"   # imprime o link p/ definir a senha
npm run dev                   # http://localhost:3100
```

Dicas de dev:

- `MAIL_DRY_RUN=true` não envia e-mail; só registra no console.
- Para não criar links no YOURLS de verdade enquanto testa, deixe `YOURLS_LINK`/`YOURLS_KEY` vazios
  (o sistema usa o link completo). Em **Integrações** há um teste de conexão que **não grava nada**.
- Para criar o superadmin sem e-mail: `SUPERADMIN_PASSWORD='uma-senha-forte' npm run create-superadmin -- email "Nome"`.

## Variáveis de ambiente

Veja `.env.example` (comentado). Resumo:

- **Obrigatórias em produção**: `PODCAST_DATABASE_URL`, `APP_BASE_URL`, `SESSION_SECRET`.
- **Brevo (SMTP)**: `BREVO_SERVER`, `BREVO_PORT`, `BREVO_USER` (login SMTP), `BREVO_CHAVE_SMTP` (chave SMTP,
  não a chave de API), `BREVO_EMAIL` (remetente validado), `BREVO_FROM_NAME` (opcional).
- **YOURLS**: `YOURLS_LINK` (host), `YOURLS_KEY` (signature da página *Tools* do YOURLS).
- **Opcionais**: `PUBLIC_BASE_URL` (domínio dos convites), `PODCAST_NAME`, `AUTO_MIGRATE`, `PORT`.

## Testes

```bash
createdb pulso_test            # o banco TEM que terminar em _test (a suíte recria o schema)
TEST_DATABASE_URL=postgresql://usuario:senha@localhost:5432/pulso_test npm test
```

Cobre autenticação, CSRF, roles, CRUD de usuários, fluxo completo do convite (YOURLS **simulado**,
e-mail em dry-run — nada externo é chamado), página pública, RSVP, modelos e o convite do Pulso.

## Deploy (Docker Swarm + Traefik)

Padrão da VPS (Docker Swarm + Traefik). Em linhas gerais:

1. Crie o banco: `CREATE DATABASE pulso;` no Postgres compartilhado (e um usuário próprio, se preferir).
2. Build da imagem: `docker build -t pulso-gestao:1 .` (incremente a tag a cada build).
3. Copie `stack.yml.example` → `stack.yml`, preencha os segredos e rode `docker stack deploy -c stack.yml --resolve-image never pulso`.
4. Aponte o DNS de `gestao.podcastpulso.com` (e, se usar, `kit.podcastpulso.com`) para a VPS.
5. Crie o 1º superadmin dentro do container: `docker exec -it <container> node src/scripts/createSuperadmin.js voce@dominio.com "Seu Nome"`.
6. Em **Integrações**, clique em *Testar conexão* (YOURLS) e *Enviar e-mail de teste* (Brevo).

Mantenha **1 réplica** (o limitador de tentativas de login fica em memória).
Na Brevo, o remetente (`BREVO_EMAIL`) e o domínio precisam estar validados (SPF/DKIM) para não cair em spam.

## Modelos de convite (HTML)

Em **Modelos** você cola o HTML do convite e usa variáveis `{{assim}}`. Valores são sempre escapados.

- `{{nome}}`, `{{primeiro_nome}}`, `{{empresa}}`, `{{cargo}}`, `{{tema}}`, `{{data_gravacao}}`, `{{responsavel}}`, `{{podcast}}`, `{{link_convite}}`
- `{{genero}}` (`m`/`f`) e `{{plural}}` (`1` quando for dupla)
- `{{guest_json}}` — `{nome, plural, sexo}` em JSON seguro para usar dentro de `<script>`
- `{{bloco_resposta}}` — botões "Aceito / Não consigo participar" prontos (sem ele o convidado não responde pela página)

O modelo padrão (`src/templates/convite-pulso.html`) é o convite do Pulso que antes era personalizado
por URL (`?nome=…&s=f`): agora o servidor injeta os dados, as fotos foram extraídas do HTML para
`src/public/convite/` (o arquivo caiu de ~1 MB para ~42 KB) e foi acrescentado o bloco de resposta
na seção final. Para usar outro HTML, crie um novo modelo e marque como padrão.

Imagens, fontes e CSS externos do modelo precisam ser `https://`. Limite de 200 KB por modelo.

## Segurança

- Senhas com **scrypt**; tokens de sessão e de e-mail guardados só como **hash SHA-256**; links de e-mail
  de uso único (72 h para definir senha, 1 h para redefinir).
- Cookie `HttpOnly` + `SameSite=Lax` (+ `Secure` em produção), **CSRF** em toda ação autenticada, checagem de `Origin`.
- Limite de tentativas de login (só falhas contam) e resposta idêntica no "esqueci a senha" (não revela se o e-mail existe).
- CSP restritiva no painel (sem script inline). A **página pública do convite roda em `sandbox`**
  (origem opaca, sem cookies, sem `fetch`): o convite do Pulso usa JavaScript, mas esse script não consegue
  tocar no painel nem em dados da sessão, mesmo que alguém coloque código malicioso num modelo.
- Papéis checados no servidor em cada rota; ações sensíveis vão para a **Auditoria**.

## Identidade visual

O painel segue o **Design System de interface** e o **Manual de Marca** do Pulso:

- `docs/design-system.md` — tokens (escuro/claro), status, tipografia, componentes e checklist de UI.
- `docs/manual-de-marca.md` — logo, cores, tipografia, tom de voz e aplicações.
- `docs/referencias/` — os HTMLs originais do designer (abrem só no ambiente de origem; os `.md` são a versão de trabalho).

Fontes (Space Grotesk, Inter, JetBrains Mono, Instrument Serif) e ícones Lucide ficam **dentro do repositório**
(`src/public/fonts/`, `src/utils/icons.js`): o painel não carrega nada de CDN. Tema escuro por padrão; há botão "Tema" na barra lateral.

## Estrutura do código

```
.
├── src/
│   ├── index.js · app.js · config.js · middleware.js · permissions.js · constants.js
│   ├── db/            pool, migrate (advisory lock), seed, migrations/*.sql
│   ├── auth/          password (scrypt), sessions, tokens (e-mail), rateLimit
│   ├── services/      mailer (Brevo), yourls, guests, inviteTemplate, audit
│   ├── routes/        auth, users, guests, templates, public (convite), misc (início/auditoria/integrações)
│   ├── views/         EJS (painel)
│   ├── public/        app.css (tokens), app.js, theme.js, fonts/, convite/ (fotos do modelo Pulso)
│   ├── utils/         format (datas em Brasília), icons (Lucide), wrap, …
│   ├── templates/     convite-pulso.html (padrão) e convite-simples.html (exemplo)
│   └── scripts/       createSuperadmin.js
├── docs/              design-system.md, manual-de-marca.md, referencias/ (HTML do designer)
├── CLAUDE.md · AGENTS.md · memory.md   instruções e memória pra IA
└── test/              node:test (unitários + fluxos ponta a ponta)
```

## Pendências conhecidas

- Matriz de permissões por perfil (provisória — ver acima).
- Envio de convite só por e-mail (WhatsApp é manual: copiar o link curto).
- Sem importação em massa de convidados e sem upload de imagens dentro da tela de modelos (use links `https://`).
