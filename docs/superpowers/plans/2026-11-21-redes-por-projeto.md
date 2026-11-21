# Redes por projeto — fase 8 (como ficou)

**Objetivo:** cada projeto publica nas contas dele, vê os números dele e responde comentários com o nome, o tom e os
links dele. **Versão:** 1.105.0. **Branch:** `redes-por-projeto` (a partir de `acesso-por-projeto`).
**Especificação:** `docs/superpowers/specs/2026-11-20-multiprojetos-design.md` (seção "Fases", item 8).

## O que foi feito

1. **Migração 102**: `social_account_status.project_id` e `social_snapshots.project_id` (nas chaves primárias),
   `projects.ai_context`, e o módulo `financeiro` ligado no Projeto 100 (a especificação já o listava).
2. **Contas por projeto**: `socialApi.profileFor(projectId)` lê `UPLOAD_POST_USER_<SLUG>`,
   `ZERNIO_PROFILE_ID_<SLUG>` e `OUTSTAND_ACCOUNTS_<SLUG>`; sem variável, as contas de sempre. A chave de API continua
   uma só por provedor e **nenhum segredo entra no banco**. Os três provedores passaram a ter um cache por perfil.
3. **Publicar**: `publishing` descobre o projeto pelo corte/vídeo e manda o perfil no `connected` e no envio.
4. **Vigia das contas**: estado por projeto, `check()` percorre os projetos com o módulo `redes`, e o aviso leva a sigla.
5. **Números**: uma leitura e uma foto por dia **por projeto** (`socialInsights`), insights e "o que publicamos" no
   recorte.
6. **Telas**: publicações, comentários, automações, ideias e insights seguem o seletor.
7. **IA por projeto**: `settings.getFor/setFor(chave, projeto)` (o projeto padrão mantém a chave de sempre), prompts com
   o nome público e o contexto do projeto, links (canal, comunidade, Spotify) e o link curto do direct por projeto,
   `sendTickAll`/`dmTickAll` rodando um projeto por vez.
8. **Trava de módulo**: `scope.requireModule` no `app.js` — tela de módulo que **nenhum** projeto da pessoa usa
   responde 404.
9. **Teste**: `test/redes-por-projeto.test.js` (6 casos).

## Fora desta fase (e por quê)

- **Números dos comentários** (Social > Comentários > Números) continuam somando os posts da casa: são dez consultas
  com CTE para medir uma automação que hoje só o Pulso usa. Está anotado no README.
- **Ligar as contas do Projeto 100** no provedor (e conferir um post de verdade) é passo do dono: hoje ele publica por
  fora. Enquanto não houver variável de conta para o projeto, o sistema usa as contas do Pulso — por isso o módulo
  `redes` continua desligado no Projeto 100, e o Social não aparece para ele.
