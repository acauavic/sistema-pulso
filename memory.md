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
- **Testes**: `npm test` (55 testes, banco `*_test`, YOURLS mockado, e-mail dry-run). Verificado em navegador
  real (Playwright). **NÃO validado**: login SMTP real da Brevo (o sandbox de dev bloqueia portas SMTP),
  criação real de link no YOURLS (só `db-stats`, leitura) e build Docker.
- **Deploy**: ainda não feito. Plano em `README.md` (VPS Docker Swarm + Traefik, DB `pulso`, 1 réplica porque o
  limitador de login é em memória).

## Últimas Decisões

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
