# memory.md

> Arquivo de memória pra IA (não é doc pra humano — isso é o README.md). Mantenha enxuto,
> só bullets e negrito, sem tabelas. Ao concluir uma feature ou mudar arquitetura, atualize
> "Estado Atual" e adicione uma linha em "Últimas Decisões" (mais recente no topo).

## Estado Atual

- **Projeto**: Pulso Gestão — painel de gestão do **Podcast Pulso** (usuários, perfis, CRM de convidados e
  convites). Node 22 + Express + EJS + `pg` + `nodemailer`. Banco PRÓPRIO (`PODCAST_DATABASE_URL`),
  imagem `pulso-gestao:N`, porta 3100. Repo: `github.com/acauavic/sistema-pulso`.
- **Usuários/roles**: superadmin, gestao, produtora, editor_video. Matriz em `src/permissions.js`
  (**PROVISÓRIA** — o dono vai descrever os poderes de cada perfil; é o único arquivo a editar). CRUD completo,
  convite por e-mail p/ definir senha (scrypt, tokens guardados como hash SHA-256, uso único), sessão em
  cookie, CSRF, auditoria. Travas: ninguém muda/desativa/exclui a si mesmo; sobra sempre 1 superadmin ativo;
  só superadmin mexe em superadmin; só superadmin exclui usuário.
- **CRM de convidados**: quadro Kanban (drag-and-drop) + lista; etapas prospect → convite_enviado →
  confirmado → gravado → publicado (+ recusou/cancelado); linha do tempo por convidado; campos gênero (`m|f`) e dupla.
- **Convite**: token secreto → página pública `/convite/:token` (modelo HTML guardado no banco) → link curto
  no YOURLS (keyword = nome curto, igual aos links manuais) → envio por e-mail Brevo. O convidado aceita/recusa
  na página e a etapa muda sozinha (responsável é avisado por e-mail). Modelo padrão = convite real do Pulso
  (antes em `kit.podcastpulso.com/convite/?nome=&s=`), agora com dados vindos do servidor (`{{guest_json}}`).
  Página pública roda em **CSP sandbox** (scripts do modelo permitidos mas isolados do painel).
- **Integrações**: Brevo SMTP (`BREVO_SERVER/PORT/USER/CHAVE_SMTP/EMAIL`, porta 587 STARTTLS) e YOURLS
  (`YOURLS_LINK` = host `link.podcastpulso.com`, `YOURLS_KEY` = signature; API via POST). Em dev as credenciais
  vinham do ambiente da sessão, não de `.env`.
- **Interface (design system)**: todo o painel segue `docs/design-system.md` + `docs/manual-de-marca.md` (originais em
  `docs/referencias/`). Tema escuro padrão + claro opcional (botão "Tema", `localStorage`), barra lateral com ícones Lucide
  (`src/utils/icons.js`), fontes Space Grotesk/Inter/JetBrains Mono/Instrument Serif **hospedadas** em `src/public/fonts/`
  (CSP `'self'`), tokens como variáveis em `src/public/app.css`. Etapa do convidado → chip de status do DS (mapa no doc).
  E-mails do sistema (`mailer.js`) e a página 404 do convite também na marca. **`CLAUDE.md` importa os dois docs**: é a regra de ouro do projeto.
- **Testes**: `npm test` (55 testes, banco `*_test`, YOURLS mockado, e-mail dry-run). Verificado em navegador
  real (Playwright). **NÃO validado**: login SMTP real da Brevo (o sandbox de dev bloqueia portas SMTP),
  criação real de link no YOURLS (só `db-stats`, leitura) e build Docker.
- **Deploy**: ainda não feito. Plano em `README.md` (VPS Docker Swarm + Traefik, DB `pulso`, 1 réplica porque o
  limitador de login é em memória).

## Últimas Decisões

- **Identidade visual aplicada (2026-10-08)**: usuário enviou o Design System de interface e o Manual de Marca (HTML do designer). Painel
  refeito: sidebar em vez de topbar, wordmark `pulso.`, linha de pulso no login/estados vazios, saudação com serifa, KPIs em Space Grotesk,
  datas/contagens em mono, sem emoji. Fontes e ícones **dentro do repo** (CSP não muda; sem CDN). Criado `CLAUDE.md` (regras + imports dos docs).
  Mapeamento etapa→status: prospect=PAUTA, convite_enviado=AGENDADO (plum), confirmado=GRAVADO, gravado=EM EDIÇÃO, publicado=PUBLICADO (único lime), recusou/cancelado=CANCELADO.
  O convite público do convidado (`convite-pulso.html`) **não foi alterado** (tem identidade própria, sandbox). Módulos do DS ainda não construídos:
  Episódios, Gravações, Cortes, Métricas, Patrocinadores, Financeiro; portais do patrocinador e do convidado.
- **Projeto movido para `sistema-pulso` (2026-10-08)**. Nasceu por engano em `podcast/` dentro de
  `acauavic/agente_bruno` (repo do agente da clínica); o usuário pediu pra mover. Histórico git não foi
  preservado (repo novo começa do zero, 1 commit).
- **Criação do sistema (2026-10-08)**: (1) permissões em arquivo único e provisórias; (2) o convite do Pulso usa JS
  (a intro animada trava o scroll sem JS) → página pública em **CSP `sandbox allow-scripts allow-forms` sem
  `allow-same-origin`**, o que obriga aceitar `Origin: null` só em `POST /convite/:token/responder`;
  (3) fotos do convite (9 JPEG em base64, ~950 KB) extraídas p/ `src/public/convite/`; (4) o limitador de login
  conta só **falhas**; (5) `nodemailer@10` (a v6 tem CVEs altas no `npm audit`). Achado nos links existentes do
  YOURLS: padrão `link.podcastpulso.com/<nome-curto>` → `kit.podcastpulso.com/convite/?nome=..&s=m`.
  Pendências: matriz de roles; deploy na VPS (criar DB `pulso`, build, stack, DNS, 1º superadmin); testar Brevo
  de verdade (remetente/domínio validado) e criação real de link no YOURLS.
