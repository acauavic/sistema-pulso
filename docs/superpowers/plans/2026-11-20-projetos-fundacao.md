# Projetos: a fundação (fase 2) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o sistema passa a ter projetos: tudo o que existe vira do Pulso, o Projeto 100 nasce vazio, quem participa de
mais de um projeto ganha o seletor no menu, e as telas de trabalho (Convidados, Patrocinadores, Episódios, Conteúdo e
Tarefas) passam a mostrar e a criar no projeto escolhido. Para quem participa de um projeto só, nada muda.

**Architecture:** uma migração cria `projects` e `project_members` e põe `project_id` nas tabelas-raiz (padrão = Pulso,
para nenhum `INSERT` antigo quebrar). `services/projects.js` guarda a lista em memória (30 s, como `catalog.js`).
`services/scope.js` é o único lugar que decide o recorte: um middleware monta `req.scope` depois do login, e as listas
chamam `scope.where(req, where, params, 'g')`, que encaixa no padrão `where[]`/`params[]` que as rotas já usam. As
tabelas filhas (arquivos, capas, comentários, publicações) não ganham coluna: herdam pela raiz.

**Tech Stack:** Node 22, Express, EJS, `pg`, CSS puro (CSP `'self'`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-multiprojetos-design.md` (seções "Regra que organiza tudo", "Seletor de
projeto", "Quem vê o quê", "Dados", "Código" e a fase 2 em "Fases").

**Branch:** `projetos-fundacao`, a partir de `hs-identidade` (fase 1, ainda não publicada). Versão **1.96.0**.

## Global Constraints

- Projetos da migração, com `id` fixo: **1 = Pulso** (`slug pulso`, sigla `PULSO`, `video_label` Episódio / Episódios,
  `number_prefix` `EP.`, `default_format` `podcast`, `position` 1) e **2 = Projeto 100** (`slug projeto-100`, sigla
  `P100`, Vídeo / Vídeos, `V.`, `video`, `position` 2). Depois dos dois, `setval` na sequência.
- **Projeto padrão** = o ativo de menor `position` (hoje o Pulso): `projects.defaultId()`. É para onde vai o que entra
  sem pessoa logada (formulários do site, avisos das redes) até a fase 6 decidir pelo domínio.
- Módulos (`projects.modules`, JSONB de chaves verdadeiras): `convidados`, `patrocinio`, `producao`, `convites`,
  `portal`, `plateia`, `media_kit`, `redes`, `financeiro`, `tarefas`. Pulso: todas. Projeto 100 nesta fase: só
  `tarefas` (produção, pauta e cortes ligam na fase 3, junto com a numeração por projeto; antes disso um vídeo do
  Projeto 100 pegaria um número de episódio do Pulso).
- Membros: todo usuário existente entra no **Pulso** com `finance = true`; os superadmins entram também no **Projeto
  100**. Usuário novo entra no projeto padrão. `users.house` nasce `true` para todos e ainda não restringe nada.
- **Ninguém é restrito nesta fase.** O recorte por participação vale nas cinco telas de trabalho e nas páginas de
  detalhe delas; Início, Calendário, Busca, Notificações, Social, Plateia e Financeiro continuam mostrando tudo (ver
  "Fora desta fase"). Nenhum usuário de fora da casa é criado antes da fase 7.
- A sigla aparece em mono entre colchetes (`[ P100 ]`), neutra (`--muted`), só para quem participa de mais de um
  projeto e só em "Todos os projetos" ou num item de projeto diferente do escolhido. Nunca verde, nunca plum.
- Escolher o recorte não é ação: nada de verde no seletor. O ativo leva `check` na cor do texto.
- Sem `style=` inline, sem hex solto, ícones via `icon()`, textos em português do Brasil no tom da casa.
- Endereços não mudam (`/episodios/12` continua valendo). Nenhum número de episódio muda.
- Testes: `TEST_DATABASE_URL=postgresql://localhost/pulso_claude_test npm test -- --test-concurrency=1`.

## Jornada (regra de criação)

- **Quem trabalha nos dois projetos** (hoje, o dono): abre o painel, vê tudo junto com a sigla em cada cartão; quando
  quer cuidar de um projeto só, troca no topo do menu e continua na mesma tela, com o outro recorte. Ao criar, o item
  nasce no projeto escolhido; em "Todos os projetos" a janela pergunta o projeto antes de qualquer outro campo.
- **Quem trabalha num projeto só** (editor, produtora, hoje): não vê seletor, sigla nem campo de projeto.
- **Gestão**: em Gestão > Sistema > Projetos vê os dois projetos, ajusta nome e sigla e marca quem participa de cada um.

## Review Focus

- **Item apagado antes da migração**: a lixeira guarda a linha em JSON e restaura com `jsonb_populate_record`; sem
  `project_id` no JSON a restauração falha em `NOT NULL`. Esperado: volta no projeto padrão. (Teste na tarefa 6.)
- **`last_project_id` que deixou de valer** (a pessoa saiu do projeto, ou ele foi desativado): cai em "Todos os
  projetos" (ou no único projeto dela), sem erro e sem tela vazia. (Tarefa 3.)
- **Herança contra o seletor**: convidado do Pulso que vira Gravado com "Projeto 100" escolhido no menu cria o
  episódio **no Pulso**; corte enviado num episódio herda o projeto do episódio; "Atribuir ao episódio" em massa leva
  o corte para o projeto do episódio. (Tarefa 6.)
- **Voltar para a mesma tela ao trocar**: `POST /projeto` só redireciona para caminho local (começa com `/` e não com
  `//`); endereço de fora vira `/`. Filtros e `?view=` da tela continuam. (Tarefa 3.)
- **Pessoa sem nenhuma participação** (criada por script antigo): as listas vêm vazias com o estado vazio de sempre,
  nada quebra, e `npm run create-superadmin` passa a incluir o superadmin em todos os projetos ativos. (Tarefa 2.)

---

### Task 1: Migração e teste de migração

**Files:**
- Create: `src/db/migrations/093_projetos.sql`
- Modify: `src/db/migrate.js` (`migrate({ until } = {})`: para depois do arquivo cujo nome começa com `until`)
- Test: `test/projetos-migracao.test.js`

**Interfaces:**
- Produces: tabelas `projects` (colunas da seção "Dados" da especificação; `modules JSONB NOT NULL DEFAULT '{}'`,
  `active BOOLEAN NOT NULL DEFAULT true`, `slug` e `sigla` únicos), `project_members (project_id, user_id, finance
  BOOLEAN NOT NULL DEFAULT false, created_at, PRIMARY KEY (project_id, user_id))`, `users.house BOOLEAN NOT NULL
  DEFAULT true`, `users.last_project_id INT REFERENCES projects(id) ON DELETE SET NULL`.
- `project_id INT NOT NULL DEFAULT 1 REFERENCES projects(id)` + índice em: `guests`, `sponsors`, `episodes`,
  `episode_clips`, `content_requests`, `social_ideas`, `sponsor_plans`, `plateia_events`.
- `project_id INT REFERENCES projects(id)` (opcional) em: `tasks`, `task_routines`, `user_goals`, `audit_log`,
  `trash_items`; tudo o que existe recebe `1`. As tabelas `fin_*` ficam para a fase 5, junto com a divisão.

- [ ] **Step 1: teste que falha.** `resetDb` com `migrate({ until: '092' })`, insere por SQL um usuário gestão, um
  superadmin, um convidado, um patrocinador, um episódio (`number = 7`), um corte, um pedido, uma tarefa e um item na
  lixeira; roda `migrate()`; confere: `projects` tem ids 1 e 2 com os valores acima; todas as linhas inseridas têm
  `project_id = 1`; o episódio continua `number = 7`; as contagens de cada tabela são iguais às de antes; os dois
  usuários estão no Pulso com `finance`, só o superadmin está no Projeto 100; `nextval` de `projects` devolve 3.
- [ ] **Step 2:** rodar `node --test test/projetos-migracao.test.js`; esperado: falha (`migrate` ignora `until`, tabela
  `projects` não existe).
- [ ] **Step 3:** escrever `until` no `migrate.js` e a migração `093`.
- [ ] **Step 4:** rodar de novo; esperado: passa. Rodar também `npm run migrate` no banco de dev (`pulso`).
- [ ] **Step 5: commit** "Projetos: tabelas, participação e project_id nas raízes (tudo vira Pulso)".

### Task 2: `services/projects.js`

**Files:**
- Create: `src/services/projects.js`
- Modify: `src/routes/users.js:76` (usuário novo entra no projeto padrão), `src/scripts/createSuperadmin.js` (entra em
  todos os ativos), `src/app.js` (refresh junto do `catalog.refresh`)
- Test: `test/projetos.test.js`

**Interfaces:**
- Produces:
  - `refresh(force = false): Promise<void>` (cache de 30 s) · `all(): Project[]` (ativos, por `position`) ·
    `get(id): Project | null` · `defaultId(): number`
  - `membershipsOf(userId): Promise<{ project_id, finance }[]>`
  - `members(projectId): Promise<{ user_id, name, role, finance }[]>`
  - `setMembers(projectId, userIds: string[]): Promise<void>` (troca a lista; quem sai perde a linha; `finance` de quem
    fica não muda; quem entra nasce com `finance = false`)
  - `addMember(userId, projectId, { finance = false } = {})` · `setLast(userId, projectIdOrNull)`
  - `update(id, { name, sigla, video_label, video_label_plural, number_prefix })` (sigla em caixa alta, 2 a 6
    caracteres `A-Z0-9`, única; erro em português)
  - `has(project, module): boolean` · `label(project, plural = true): string`

- [ ] **Step 1: testes que falham**: `all()` devolve Pulso e Projeto 100 nessa ordem; `defaultId() === 1`; `setMembers`
  troca a lista e preserva `finance`; `update` recusa sigla repetida e sigla com minúscula vira maiúscula; usuário
  criado pela tela de Usuários aparece em `membershipsOf` com o Pulso; projeto desativado some de `all()`.
- [ ] **Step 2:** rodar; esperado: falha (módulo não existe).
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** rodar; esperado: passa.
- [ ] **Step 5: commit** "Projetos: serviço com cache, membros e projeto padrão".

### Task 3: `services/scope.js`, middleware e a troca de projeto

**Files:**
- Create: `src/services/scope.js`
- Modify: `src/app.js` (`app.use(scope.attach)` logo depois de `mw.requireAuth`, antes de `mw.navData`),
  `src/routes/misc.js` (`POST /projeto`)
- Test: `test/projetos-escopo.test.js`

**Interfaces:**
- Consumes: `projects.all/get/membershipsOf/setLast/has/label`.
- Produces:
  - `attach(req, res, next)`: `req.scope = { projects: Project[] (os da pessoa), ids: number[], current: Project | null,
    multi: boolean, house: boolean, financeIds: number[] }`. `current` = `last_project_id` se ainda vale; com um projeto
    só, é ele. Também põe em `res.locals`: `scope`, `projectTag(projectId): string` (a sigla quando `multi` e o item é de
    projeto diferente de `current`; senão `''`), `videoLabel` ("Episódios", "Vídeos" ou "Episódios e vídeos") e
    `hasModule(key)` (do `current`; em "Todos", de qualquer projeto da pessoa).
  - `where(req, where: string[], params: any[], alias: string, { orNull = false } = {}): void`: empurra
    `alias.project_id = ANY($n::int[])` com `[current.id]` ou `ids`; com `orNull`, aceita também `IS NULL` (tarefa geral).
  - `target(req, body = {}): number | null`: projeto de um item novo: `current`, senão `body.project_id` se estiver em
    `ids`, senão o único de `ids`; `null` quando falta escolher.
  - `assert(req, projectId): void`: lança erro com `status = 404` se `projectId` não está em `ids` (`null` passa).
  - `POST /projeto` com `project` (id ou vazio) e `voltar`: grava `last_project_id`, redireciona para `voltar` local.

- [ ] **Step 1: testes que falham**: pessoa só do Pulso → `multi` falso, `current` = Pulso, `projectTag` sempre `''`;
  superadmin → `multi`, `current` nulo, `projectTag(2) === 'P100'`; `POST /projeto` com `2` guarda e a página seguinte
  vem com `current` = Projeto 100; projeto de que a pessoa não participa → 400 e nada muda; `last_project_id` de
  projeto desativado → `current` nulo; `voltar=https://fora.example/x` e `voltar=//fora.example` → redireciona para `/`;
  `voltar=/convidados?view=lista` → volta para lá; `where` com e sem `orNull` gera o SQL esperado e a numeração dos
  parâmetros continua certa depois de outros filtros.
- [ ] **Step 2:** rodar; esperado: falha.
- [ ] **Step 3:** implementar. O erro 404 de `assert` é tratado no manipulador de erros do `app.js` (render de
  "Página não encontrada", como o 404 de hoje).
- [ ] **Step 4:** rodar; esperado: passa.
- [ ] **Step 5: commit** "Projetos: recorte num lugar só (scope) e troca de projeto".

### Task 4: Seletor no menu

**Files:**
- Create: `src/views/partials/project-switch.ejs`, `src/views/partials/project-tag.ejs`
- Modify: `src/views/partials/head.ejs` (seletor abaixo da marca; rótulo de Episódios com `videoLabel`; itens do menu
  e da barra de baixo escondidos por `hasModule`), `src/public/app.css` (`.project-switch`, `.project-tag`),
  `src/public/app.js` só se o `<details>` precisar fechar ao clicar fora (conferir se `row-menu` já faz isso)
- Test: `test/projetos-menu.test.js`

**Interfaces:**
- Consumes: `res.locals.scope`, `projectTag`, `videoLabel`, `hasModule`.
- Produces: `include('project-tag', { id })` → `<span class="project-tag mono">[ P100 ]</span>` ou nada.

**Desenho:** `details.project-switch` no topo do menu, entre a marca e a busca. O resumo é uma linha da altura dos
itens do menu (36 px; 44 px no toque): rótulo mono "PROJETO" em muted, o nome do recorte em `--text` e
`chevron-down`. Aberto: um formulário (`POST /projeto`, `_csrf`, `voltar` = `currentUrl`) com um botão por opção
("Todos os projetos", depois os projetos da pessoa, cada um com a sigla em mono à direita); o atual leva `check` e
`aria-current`. Menu recolhido (76 px): só a sigla em mono (`TODOS`, `PULSO`, `P100`), com o nome na dica. Celular: o
seletor é o primeiro bloco do Menu em tela cheia. Superfície `raised`, borda `line`, raio 6; sombra só no claro
(é menu). Módulos que o projeto escolhido não usa somem do menu: Convidados (`convidados`), Patrocinadores
(`patrocinio`), Episódios e Conteúdo (`producao`), Social (`redes`), Plateia (`plateia`), Financeiro (`financeiro`).

- [ ] **Step 1: testes que falham**: pessoa só do Pulso → o HTML do Início não tem `project-switch` nem `project-tag`
  e o menu é o de hoje; superadmin → tem o seletor com as três opções e "Todos os projetos" marcado, e o item
  "Episódios e vídeos"; com o Projeto 100 escolhido → o resumo diz "Projeto 100", o menu não tem Patrocinadores,
  Social nem Plateia; com o Pulso → o item é "Episódios".
- [ ] **Step 2:** rodar; esperado: falha.
- [ ] **Step 3:** implementar os partials, o trecho do `head.ejs` e o CSS.
- [ ] **Step 4:** rodar; esperado: passa. `test/identidade.test.js` continua passando (sem hex solto no `app.css`).
- [ ] **Step 5: commit** "Projetos: seletor no topo do menu e menu conforme os módulos do projeto".

### Task 5: As cinco telas seguem o seletor

**Files:**
- Modify: `src/routes/guests.js:117` (lista e quadro), `src/routes/sponsors.js:85`, `src/routes/episodes.js:118`,
  `src/routes/clips.js:46` e `src/services/contentBoard.js:58` (quadro, cortes, posts e pedidos: `build({ projectIds })`,
  `contentRequests.list({ projectIds })`, e os posts pelo `e.project_id` do episódio), `src/routes/tasks.js:58` e
  `src/services/tasks.js` (com `orNull`), `src/services/editOrder.js` só se a lista de Episódios depender dele para
  montar as colunas (a ordem em si continua única, fase 3)
- Modify (sigla): `src/views/guests/index.ejs`, `sponsors/index.ejs`, `episodes/index.ejs`, os cartões de
  `src/views/clips/` usados em `/conteudo`, `tasks/_card.ejs` (a sigla abre a linha mono do cartão e é a primeira
  célula mono da linha na tabela)
- Test: `test/projetos-listas.test.js`

**Interfaces:**
- Consumes: `scope.where`, `include('project-tag', { id: item.project_id })`.

- [ ] **Step 1: testes que falham**: com um item de cada tipo em cada projeto (nomes marcadores "AAA Pulso" e "BBB
  P100"): superadmin em "Todos" vê os dois em cada uma das cinco telas, cada um com a sua sigla; com o Pulso
  escolhido vê só "AAA Pulso" e nenhuma `project-tag`; com o Projeto 100, só "BBB P100"; pessoa só do Pulso nunca vê
  "BBB P100" nem sigla; tarefa geral (`project_id` nulo) aparece nos três recortes, sem sigla; a busca (`q`), o filtro
  de dono e os filtros combináveis continuam funcionando junto com o recorte (um caso por tela); os seletores de
  episódio dentro de Conteúdo listam só episódios do recorte.
- [ ] **Step 2:** rodar; esperado: falha.
- [ ] **Step 3:** aplicar `scope.where` em cada consulta de lista e as siglas nas views.
- [ ] **Step 4:** rodar; esperado: passa. Rodar `test/guests*.test.js`, `sponsors*`, `episodes*`, `conteudo*`,
  `tasks*` para garantir que nada de hoje mudou.
- [ ] **Step 5: commit** "Projetos: Convidados, Patrocinadores, Episódios, Conteúdo e Tarefas seguem o seletor".

### Task 6: Criar no projeto certo

**Files:**
- Create: `src/views/partials/project-field.ejs` (campo **Projeto** em `.seg-radio`, primeiro do formulário, só quando
  `scope.multi && !scope.current`; nos outros casos não renderiza nada. Em tarefa, a primeira opção é "Geral")
- Modify (todo `INSERT` numa raiz passa `project_id`): `src/routes/guests.js:195`, `src/routes/sponsors.js:128`,
  `src/routes/episodes.js:156` (e o patrocinador e o convidado criados junto), `src/services/production.js`
  (`createEpisode`: do convidado, senão o informado), `src/services/clips.js` (do episódio, senão o informado),
  `src/services/contentRequests.js` (idem), `src/services/social.js` (ideias: projeto padrão até a fase 8),
  `src/services/audience.js` (`plateia_events`: do convidado), `src/services/tasks.js:82` (do episódio, convidado ou
  patrocinador ligado; senão o informado; senão nulo), `src/routes/gestao.js` e `src/services/recurring.js` (rotinas:
  nulo), `src/services/goals.js` (nulo), `src/services/guestImport.js` (o `target` de quem importa),
  `src/services/assistant.js` (o `current` de quem pediu, senão o padrão), `src/services/siteLeads.js` (padrão),
  `src/services/audit.js` (o projeto do alvo quando a rota informa; senão nulo), `src/services/trash.js` (grava o
  projeto do item; na restauração, linha de tabela-raiz sem `project_id` recebe o padrão)
- Modify: `src/routes/contentBulk.js` ("Atribuir ao episódio": o corte assume o `project_id` do episódio)
- Modify (views): formulários de novo convidado, novo patrocinador, novo episódio, "Pedir conteúdo", `tasks/_new.ejs`
- Test: `test/projetos-criar.test.js`

**Interfaces:**
- Consumes: `scope.target(req, req.body)`; `projects.defaultId()`.
- Regra única: **vínculo vence o seletor**. Item ligado a outro (episódio do convidado, corte do episódio, tarefa do
  episódio) herda o projeto do outro; só item solto usa `target`. `target` nulo → o formulário volta com "Escolha o
  projeto." e os valores digitados.

- [ ] **Step 1: testes que falham**: com o Projeto 100 escolhido, novo convidado, patrocinador, pedido e tarefa nascem
  com `project_id = 2`; em "Todos", o formulário mostra o campo Projeto e sem ele responde 400 com "Escolha o
  projeto."; pessoa só do Pulso não vê o campo e cria no Pulso; os três casos de herança do Review Focus; restaurar
  um item cuja linha na lixeira não tem `project_id` devolve no Pulso; apagar e desfazer um convidado do Projeto 100
  devolve no Projeto 100; teste estático: todo `INSERT INTO (guests|sponsors|episodes|episode_clips|content_requests|
  social_ideas|plateia_events)` em `src/` cita `project_id` (lista de exceções vazia).
- [ ] **Step 2:** rodar; esperado: falha.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** rodar; esperado: passa.
- [ ] **Step 5: commit** "Projetos: cada item nasce no seu projeto (vínculo vence o seletor)".

### Task 7: Páginas de detalhe

**Files:**
- Modify: detalhe de convidado (`src/routes/guests.js:219`), patrocinador, episódio, corte, pedido e tarefa: depois de
  carregar o item, `scope.assert(req, item.project_id)`; as views de cabeçalho dessas páginas incluem a `project-tag`
  ao lado do título
- Test: `test/projetos-detalhe.test.js`

- [ ] **Step 1: testes que falham**: pessoa só do Pulso abrindo o convidado, o patrocinador, o episódio, o corte, o
  pedido e a tarefa do Projeto 100 recebe 404 com a página "Página não encontrada"; superadmin com o Pulso escolhido
  abre o item do Projeto 100 e vê `[ P100 ]` ao lado do título; com o Projeto 100 escolhido, sem sigla; tarefa geral
  abre para todos.
- [ ] **Step 2:** rodar; esperado: falha.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** rodar; esperado: passa.
- [ ] **Step 5: commit** "Projetos: página de detalhe respeita a participação e mostra a sigla".

### Task 8: Gestão > Sistema > Projetos

**Files:**
- Create: `src/routes/projects.js`, `src/views/gestao/projetos.ejs`
- Modify: `src/permissions.js` (`'projects.manage': ['superadmin', 'gestao']`), `src/views/partials/gestao-nav.ejs`
  (aba `projetos` no grupo Sistema, antes de Integrações), `src/app.js` (rota), `src/utils/auditLabels.js`
- Test: `test/projetos-gestao.test.js`

**Desenho:** uma linha `.cat-row` por projeto: nome em display, sigla e rótulo dos vídeos em mono (`P100 · VÍDEOS ·
V.001`), quantas pessoas participam em mono, chips neutros dos módulos ligados; à direita **Editar** (fantasma;
janela com Nome, Sigla, Como chama os vídeos no singular e no plural, Prefixo do número) e **Pessoas** (secundário;
janela com a busca de lista longa e uma caixa por pessoa ativa, perfil em mono). Sem botão verde na página: não há
ação principal aqui, e criar projeto novo fica fora desta fase. Embaixo, em muted: "Quem participa de um projeto só
não vê o seletor de projeto."

- [ ] **Step 1: testes que falham**: produtora recebe 403; gestão vê os dois projetos; salvar a janela Pessoas inclui
  a produtora no Projeto 100 e a próxima página dela mostra o seletor; tirar alguém do único projeto dela é recusado
  com "Toda pessoa participa de pelo menos um projeto."; editar a sigla muda a sigla nos cartões; as duas ações
  entram na auditoria em português.
- [ ] **Step 2:** rodar; esperado: falha.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** rodar; esperado: passa.
- [ ] **Step 5: commit** "Gestão > Projetos: nome, sigla e quem participa".

### Task 9: Lançamento 1.96.0

**Files:**
- Modify: `src/releases.js` (entrada no topo: "O sistema agora tem projetos"; itens: novo "Seletor de projeto no menu
  para quem trabalha em mais de um", novo "Gestão > Sistema > Projetos", ajuste "Para quem trabalha num projeto só,
  nada muda"), `package.json` (1.96.0), `docs/design-system.md` (componentes "Seletor de projeto" e "Sigla do
  projeto"; "Painel de gestão" ganha Projetos), `memory.md` (Estado Atual e Últimas Decisões; aproveitar para enxugar:
  está com 359 linhas), `README.md` (projetos, participação, projeto padrão), `CLAUDE.md` (regra: lista nova usa
  `scope.where`; `INSERT` em raiz leva `project_id`), a especificação (fase 3 passa a incluir Início, Calendário,
  Busca e Notificações seguindo o seletor)
- [ ] **Step 1:** escrever os documentos e a entrada de lançamento.
- [ ] **Step 2:** suíte completa; esperado: 0 falhas.
- [ ] **Step 3:** navegador (`hs-studio`, porta 3190), computador e celular, tema escuro e claro: trocar de projeto em
  Convidados e voltar na mesma tela; "Todos" com as siglas; criar um convidado em "Todos" (campo Projeto) e no Projeto
  100; menu recolhido com a sigla; Gestão > Projetos e a janela Pessoas; entrar como pessoa de um projeto só e
  conferir que nada mudou. Usuários e dados de teste só no banco local, apagados no fim.
- [ ] **Step 4: commit** "Projetos: a fundação (v1.96.0)". **Não publicar**: só com a autorização do dono.

## O que mudou na execução

- A variável das telas é `projectScope` (e não `scope`): a tela de Tarefas já usa `scope` para o filtro Minhas | Hoje | Todas.
- `invite_templates` não existe mais no banco; saiu da lista de raízes.
- As opções dos filtros combináveis (episódio, patrocinador) também seguem o recorte (`filterFields.js` recebe `projectIds`).
- Corte solto enviado em "Todos os projetos" nasce no projeto padrão (o envio é por JavaScript, sem formulário para perguntar);
  ao ser atribuído a um episódio, vai para o projeto dele.
- `audit_log.project_id` existe, mas a auditoria ainda não grava o projeto: fica para a fase 7, com o resto do isolamento.
- A lixeira guarda o projeto do item (`trash_items.project_id`).

## Fora desta fase

- **Início, Resumo do dia, Seu dia, Calendário, Busca e Notificações** seguindo o seletor: fase 3, quando o Projeto 100
  passa a ter vídeos e pautas para separar. Até lá mostram tudo, como hoje.
- **Financeiro por projeto** (`fin_*`, divisão, cotas): fase 5. **Social por projeto**: fase 8.
- **Numeração por projeto, formato do vídeo, Pré-produção e pautas**: fase 3 (liga os módulos do Projeto 100).
- **Equipe da casa, "Vê o financeiro" na tela, `HOUSE_PERMISSIONS` e o teste de isolamento**: fase 7.
- **Criar projeto novo pela tela e ligar módulos pela tela**: quando houver um terceiro projeto.
- **Pessoa e empresa da casa** (duplicata entre projetos, "Convidar também para"): fase 4.
