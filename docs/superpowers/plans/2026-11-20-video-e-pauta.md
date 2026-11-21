# Vídeo e pauta (fase 3) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o Projeto 100 passa a trabalhar dentro do sistema: vídeo que não é episódio de podcast, numeração por
projeto, uma etapa de Pré-produção antes da gravação, e pauta e roteiro acompanhados até a aprovação (que acontece no
WhatsApp). Depois, as telas que ainda juntam tudo (Início, Resumo do dia, Seu dia, Calendário, Busca e Notificações)
passam a seguir o projeto escolhido.

**Architecture:** o episódio vira o caso "podcast" de uma coisa mais geral, o **vídeo** (`episodes.format`). A
numeração passa a ser por projeto (`UNIQUE (project_id, number)`) e o rótulo do número vem do projeto
(`projects.number_prefix`), por um helper único (`fmt.epNo`). A etapa **Pré-produção** entra no começo de
`EPISODE_STAGES`; só o vídeo criado à mão nasce nela (o episódio que vem do convidado continua nascendo em Gravado).
Pauta e roteiro são um objeto próprio (`pautas` + `pauta_events`), com o texto no editor rico que já existe ou um link,
e o botão **Copiar para o WhatsApp** no lugar de qualquer envio automático.

**Tech Stack:** Node 22, Express, EJS, `pg`, CSS puro (CSP `'self'`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-multiprojetos-design.md` (seções "Vídeo que não é episódio", "Pauta e
roteiro" e a fase 3 em "Fases").

**Branches e versões:** `video-e-pauta` (parte A, **v1.98.0**) e `telas-por-projeto` (parte B, **v1.99.0**), a partir
de `quadro-tarefas`. Nada é publicado sem a autorização do dono.

## Global Constraints

- **Formato**: `episodes.format` é `podcast` ou `video`; o padrão vem do projeto (`projects.default_format`). O formato
  só **esconde** o que não se aplica, nunca muda o fluxo das etapas.
- **Numeração por projeto**: `UNIQUE (project_id, number)` no lugar de `UNIQUE (number)`. Nenhum número muda.
- **Prefixo do número**: `EP.` no Pulso, `V.` no Projeto 100, sempre em mono, três dígitos (`V.003`).
- **Pré-produção** (`pre_producao`): primeira etapa, chip PAUTA (cinza). Vídeo sem pauta aprovada **pode** ser marcado
  como gravado; a página avisa (`.notice`), não bloqueia.
- **Estados da pauta**: A fazer (PAUTA) → Em elaboração (GRAVADO, neutro) → Enviada para aprovação (AGENDADO, plum:
  está com gente de fora) → Ajustes pedidos (âmbar, com o recado em filete âmbar) → Aprovada (`.b-green`, neutro).
  **Nada de verde em estado.**
- **O sistema não manda nada sozinho**: "Copiar para o WhatsApp" copia o texto e marca "Enviada" com data, hora e para
  quem. A resposta é registrada por gestão ou produtora.
- **Permissões**: `pautas.read` para todos (o editor lê o roteiro), `pautas.write` para superadmin, gestão e produtora.
- Toda consulta de lista nova passa por `scope.where`; todo `INSERT` em raiz leva `project_id` (regra da fase 2).
- Sem `style=` inline, sem hex solto, ícones via `icon()`, textos em português do Brasil, no tom da marca.
- Testes: `TEST_DATABASE_URL=postgresql://localhost/pulso_claude_test npm test -- --test-concurrency=1`.

## Jornada (regra de criação)

- **Produtora do Projeto 100**, segunda de manhã: abre Vídeos, cria "Vídeo 004" (nasce em Pré-produção), escreve a
  pauta, manda para aprovação copiando para o grupo do WhatsApp, e registra a resposta quando ela vem. Com a pauta
  aprovada e o vídeo gravado, marca como gravado e o fluxo de hoje continua igual.
- **Editor**: abre o vídeo e lê o roteiro aprovado na aba Pauta. Não escreve nada ali.
- **Gestão**: no quadro de Pautas vê, de uma vez, o que está parado em cada estado.

## Review Focus

- **Dois projetos numerando ao mesmo tempo**: dois vídeos criados no mesmo segundo em projetos diferentes não podem
  colidir, e dois no mesmo projeto não podem repetir número (a corrida de hoje é resolvida por tentativa; continua
  valendo por projeto). (Tarefa 2.)
- **Episódio antigo sem formato**: tudo o que existe vira `podcast`; nenhuma tela do Pulso muda de comportamento.
  (Tarefa 1.)
- **Vídeo sem convidado**: portal, plateia, convite, media kit, capa do Spotify e vídeos do convidado não podem
  aparecer nem quebrar quando `guest_id` é nulo. (Tarefa 4.)
- **Pauta de convidado que vira episódio**: a pauta escrita no cadastro do convidado tem de continuar visível quando o
  convidado vira episódio, sem duplicar. (Tarefa 5.)
- **Texto colado no WhatsApp**: a pauta pode ter HTML (editor rico) e o que vai para o WhatsApp é texto puro, com os
  títulos e as listas legíveis; link em vez de texto também tem de funcionar. (Tarefa 5.)

---

## Parte A — Vídeo e pauta (v1.98.0, branch `video-e-pauta`)

### Task 1: Migração

**Files:**
- Create: `src/db/migrations/095_video_e_pauta.sql`
- Test: `test/video-pauta-migracao.test.js`

**Interfaces:**
- Produces: `episodes.format TEXT NOT NULL DEFAULT 'podcast' CHECK (format IN ('podcast','video'))`;
  `episodes_number_key` vira `UNIQUE (project_id, number)`; `episodes.status` aceita `pre_producao`.
- `pautas` (`id`, `project_id NOT NULL`, `episode_id`, `guest_id`, `kind` pauta|roteiro, `title`, `body`, `body_html`,
  `link`, `owner_id`, `due_on`, `state` a_fazer|elaboracao|aprovacao|ajustes|aprovada, `sent_at`, `sent_to`,
  `approved_by`, `review_note`, `created_by`, `created_at`, `updated_at`;
  `CHECK (episode_id IS NOT NULL OR guest_id IS NOT NULL)`, `UNIQUE (episode_id, kind)`, `UNIQUE (guest_id, kind)`).
- `pauta_events` (`id`, `pauta_id`, `user_id`, `type`, `message`, `created_at`).

- [ ] **Step 1: teste que falha.** Banco em `094`, com um episódio `number = 7` no Pulso; roda a migração; confere:
  todo episódio ficou `format = 'podcast'`; o número 7 continua; dois projetos aceitam `number = 1`; o mesmo projeto
  recusa dois `number = 1`; `pre_producao` é aceito em `status`; `pautas` recusa linha sem episódio e sem convidado.
- [ ] **Step 2:** rodar; esperado: falha (coluna `format` não existe).
- [ ] **Step 3:** escrever a migração.
- [ ] **Step 4:** rodar; esperado: passa. `npm run migrate` no banco de dev.
- [ ] **Step 5: commit** "Vídeo e pauta: formato, numeração por projeto e as tabelas da pauta".

### Task 2: Numeração e prefixo por projeto

**Files:**
- Modify: `src/services/production.js` (`createEpisode`: `max(number)` dentro do projeto), `src/routes/episodes.js`
  (`/episodios/novo`: próximo número do projeto), `src/services/guestImport.js` (numeração do histórico por projeto)
- Modify: `src/utils/format.js` (`epNo(number, prefix = 'EP.')` e `epLabel(number, title, prefix)`)
- Modify (passam a usar o prefixo do projeto): `src/views/episodes/index.ejs`, `episodes/show.ejs`,
  `src/views/content/index.ejs`, `content/_clip_card.ejs`, `content/clip.ejs`, `content/request.ejs`,
  `src/views/tasks/_card.ejs`, `tasks/index.ejs`, `tasks/show.ejs`, `src/views/dashboard-editor.ejs`,
  `src/services/editOrder.js`, `src/services/calendar.js`, `src/services/search.js`, `src/services/contentBoard.js`
  (as consultas dessas telas passam a trazer `p.number_prefix`)
- Test: `test/video-numeracao.test.js`

**Interfaces:**
- Consumes: `projects.get(id).number_prefix`.
- Produces: `fmt.epNo(7, 'V.') === 'V.007'`; `fmt.epNo(null) === ''`.

**Fora desta tarefa** (ficam com `EP.` até a fase do módulo): Financeiro (fase 5), Social (fase 8), media kit, portal
do convidado e as peças de capa do Pulso (identidade do Pulso).

- [ ] **Step 1: testes que falham**: `fmt.epNo`; um vídeo criado no Projeto 100 recebe `number = 1` enquanto o Pulso
  está no 30; a lista e o quadro de Episódios mostram `V.001` para o do Projeto 100 e `EP.030` para o do Pulso;
  Conteúdo, Tarefas e a busca global mostram o prefixo certo; dois vídeos criados em paralelo no mesmo projeto
  recebem números diferentes.
- [ ] **Step 2:** rodar; esperado: falha.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** rodar; esperado: passa, e `test/episodios*.test.js` e `test/clips.test.js` continuam passando.
- [ ] **Step 5: commit** "Vídeo e pauta: numeração e prefixo por projeto".

### Task 3: Etapa Pré-produção e "Novo vídeo"

**Files:**
- Modify: `src/constants.js` (`pre_producao` no começo de `EPISODE_STAGES`), `src/public/app.css` (chip
  `.b-st-pre_producao` com as cores de PAUTA), `src/routes/episodes.js` (criar em Pré-produção; `POST
  /episodios/:id/gravado`), `src/views/episodes/new.ejs` (formulário curto quando o projeto é de vídeo),
  `src/views/episodes/index.ejs` (coluna nova), `src/views/episodes/show.ejs` (próximo passo da etapa)
- Modify: `src/services/production.js` (`createEpisode({ stage })`; as rotinas de tarefa e o custo automático só
  rodam quando o vídeo chega em Gravado)
- Test: `test/video-pre-producao.test.js`

**Desenho:** no projeto cujo padrão é vídeo, o botão da página de Vídeos é **Novo vídeo** e abre uma janela curta
(título, data prevista da gravação, responsável). O vídeo nasce em Pré-produção, e a página mostra como próximo passo
"Escrever a pauta" e o botão **Marcar como gravado** (secundário), que leva para Gravado e só então dispara as rotinas
de tarefa e os custos. No Pulso nada muda: o botão continua "Registrar episódio gravado".

- [ ] **Step 1: testes que falham**: o vídeo do Projeto 100 nasce em `pre_producao` e não cria tarefas nem lançamento;
  "Marcar como gravado" leva para `gravado`, cria as tarefas da rotina e o custo; o episódio do Pulso que vem do
  convidado continua nascendo em `gravado`; a coluna Pré-produção aparece no quadro; a etapa tem chip PAUTA.
- [ ] **Step 2:** rodar; esperado: falha. **Step 3:** implementar. **Step 4:** rodar; esperado: passa.
- [ ] **Step 5: commit** "Vídeo e pauta: etapa Pré-produção e Novo vídeo".

### Task 4: O formato esconde o que não se aplica

**Files:**
- Modify: `src/views/episodes/show.ejs` e `_finalizacao.ejs`, `_textos.ejs`, `_capas.ejs` (Spotify, capa do Spotify e
  vídeos do convidado só em `podcast`; portal e plateia só com convidado), `src/routes/episodes.js` e
  `src/routes/covers.js` (recusar as ações escondidas), `src/services/guestVideos.js` (não gerar sem convidado)
- Test: `test/video-formato.test.js`

- [ ] **Step 1: testes que falham**: num vídeo (`format = 'video'`, sem convidado) a página não tem Spotify, capa do
  Spotify, vídeos do convidado, portal nem plateia, e as rotas delas respondem 404/409; num episódio de podcast tudo
  continua como hoje; a finalização do vídeo funciona sem o Spotify.
- [ ] **Step 2:** rodar; esperado: falha. **Step 3:** implementar. **Step 4:** rodar; esperado: passa.
- [ ] **Step 5: commit** "Vídeo e pauta: o formato esconde o que não se aplica".

### Task 5: Pauta e roteiro (serviço e abas)

**Files:**
- Create: `src/services/pautas.js`, `src/routes/pautas.js`, `src/views/partials/pauta.ejs`
- Modify: `src/permissions.js` (`pautas.read`, `pautas.write`), `src/app.js`, `src/views/episodes/show.ejs` (aba
  Pauta), `src/views/guests/show.ejs` (aba Pauta a partir de "Em agendamento"), `src/utils/auditLabels.js`
- Test: `test/pautas.test.js`

**Interfaces:**
- Produces: `pautas.forEpisode(id)`, `forGuest(id)`, `upsert({ episodeId|guestId, kind, values, user })`,
  `send(id, { to, user })` (marca "Enviada" e registra), `answer(id, { approved, note, by, user })`,
  `whatsappText(pauta)` (texto puro: título, prazo e o corpo sem HTML, ou o link), `moveToEpisode(guestId, episodeId)`.
- `STATES` com rótulo e chip de cada estado.

**Desenho:** a aba mostra **um cartão por documento** (Pauta e Roteiro): estado em chip, dono e prazo em mono, o texto
legível (`.rich-content`) ou o link, e as ações do momento — **Escrever/Editar** (janela com o editor rico ou o campo
de link), **Copiar para o WhatsApp** (o lime do passo, enquanto o estado é Em elaboração), e, depois de enviada,
**Aprovada** / **Pediram ajustes** (secundários, a janela do ajuste pede o recado). O histórico fica num `<details>`.

- [ ] **Step 1: testes que falham**: criar, editar e os cinco estados na ordem; "Copiar para o WhatsApp" marca
  Enviada com data e para quem; "Pediram ajustes" guarda o recado e mostra o filete âmbar; o editor lê mas não
  escreve (403); `whatsappText` devolve texto puro legível (sem tags) e o link quando é link; a pauta do convidado
  acompanha quando ele vira episódio (sem duplicar); tudo entra na auditoria em português.
- [ ] **Step 2:** rodar; esperado: falha. **Step 3:** implementar. **Step 4:** rodar; esperado: passa.
- [ ] **Step 5: commit** "Pauta e roteiro: documento, estados e o caminho do WhatsApp".

### Task 6: Quadro de Pautas e o Início da produtora

**Files:**
- Modify: `src/routes/episodes.js` (visualização `?vista=pautas` em Vídeos), `src/views/episodes/index.ejs`,
  `src/views/partials/my-day.ejs` (faixa "Pautas que travaram")
- Test: `test/pautas-quadro.test.js`

**Desenho:** o quadro tem uma coluna por estado; o cartão traz o tipo em mono, o título do vídeo, o dono e o prazo
(com a cor do prazo). No "Seu dia" da produtora, uma linha curta com as pautas atrasadas e as que voltaram com
ajustes, com link para o vídeo.

- [ ] **Step 1: testes que falham**: o quadro mostra cada pauta na coluna do estado e segue o seletor de projeto; o
  Seu dia lista a pauta atrasada e a com ajustes pedidos, e some quando não há nenhuma.
- [ ] **Step 2:** rodar; esperado: falha. **Step 3:** implementar. **Step 4:** rodar; esperado: passa.
- [ ] **Step 5: commit** "Pautas: quadro por estado e aviso no Seu dia".

### Task 7: Projeto 100 trabalhando e lançamento 1.98.0

**Files:**
- Create: `src/db/migrations/096_projeto_100_producao.sql` (liga `producao`, `convidados` e `pauta` nos módulos do
  Projeto 100)
- Modify: `src/releases.js` (1.98.0), `package.json`, `docs/design-system.md` (Pauta, Pré-produção, prefixo),
  `README.md`, `memory.md`, a especificação (o que a fase 3 deixou para a 4)
- [ ] **Step 1:** migração dos módulos e documentos.
- [ ] **Step 2:** suíte completa; esperado: 0 falhas.
- [ ] **Step 3:** navegador (computador e celular, escuro e claro): criar um vídeo no Projeto 100, escrever a pauta,
  copiar para o WhatsApp, registrar a aprovação, marcar como gravado; conferir que o Pulso não mudou.
- [ ] **Step 4: commit** "Vídeo e pauta (v1.98.0)". **Não publicar.**

## Parte B — As telas que faltam seguem o projeto (v1.99.0, branch `telas-por-projeto`)

### Task 8: Início, Resumo do dia e Seu dia

**Files:** `src/routes/misc.js`, `src/services/daySummary.js`, `src/services/myDay.js`, `src/services/editOrder.js`,
`src/services/goals.js` · Test: `test/projetos-inicio.test.js`

- [ ] Cada consulta recebe o recorte (`scope.idsOf`); o Início do editor, a ordem de edição, o Resumo do dia e o Seu
  dia mostram só o projeto escolhido, com a sigla quando é "Todos os projetos". Teste com um item de cada tipo nos
  dois projetos. **Commit.**

### Task 9: Calendário, Busca e Notificações

**Files:** `src/services/calendar.js`, `src/services/search.js`, `src/services/notify.js`, `src/routes/collab.js` ·
Test: `test/projetos-calendario-busca.test.js`

- [ ] O calendário, a busca global (Ctrl+K) e as notificações seguem o recorte; aviso de item de outro projeto não
  chega para quem não participa dele. **Commit.**

### Task 10: Lançamento 1.99.0

- [ ] `src/releases.js`, `package.json`, `memory.md`, `docs/design-system.md`; suíte completa; navegador. **Commit.**
  **Não publicar.**

## Fora desta fase

- Pessoa e empresa da casa, "Convidar também para", duplicata entre projetos: fase 4.
- Financeiro por projeto (inclusive o prefixo do número nas telas de dinheiro): fase 5.
- Endereços e marca pública do Projeto 100: fases 6 e 9.
- Social por projeto (contas, publicar, comentários, insights): fase 8.
- Aprovação da pauta por quem está fora do sistema (link público com botão de aprovar): fora do escopo do desenho.
