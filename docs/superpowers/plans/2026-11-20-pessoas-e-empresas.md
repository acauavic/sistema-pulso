# Pessoas e empresas (fase 4) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a mesma pessoa e a mesma empresa deixam de ser digitadas duas vezes. O convidado que já sentou à mesa do
Pulso entra no Projeto 100 em um clique, com os dados dele; o patrocinador que fecha os dois projetos tem dois
contratos e um cadastro só. Corrigir um telefone num lugar corrige em todos.

**Architecture:** entram duas tabelas de **cadastro da casa** — `people` e `companies` — e as linhas de hoje (`guests`,
`sponsors`) passam a ser **participação** e **contrato**, cada uma de um projeto, apontando para a pessoa ou a empresa
(`person_id`, `company_id`). As colunas de identidade continuam em `guests`/`sponsors` como **cópia espelhada**, para as
158 consultas que leem `guests.name` não mudarem: um ponto único (`services/people.js` / `services/companies.js`) grava
a pessoa e todas as participações dela na mesma transação. Toda rota que escreve identidade chama esse ponto.

**Tech Stack:** Node 22, Express, EJS, `pg`, CSS puro (CSP `'self'`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-multiprojetos-design.md` (seções "Convidados: pessoa e participação",
"Patrocinadores: empresa e contrato" e a fase 4 em "Fases").

**Branches e versões:** `pessoas-e-empresas` (parte A, **v1.100.0**) e `empresas-e-contratos` (parte B, **v1.101.0**), a
partir de `telas-por-projeto`. Nada é publicado sem a autorização do dono.

## Global Constraints

- **O espelho é lei.** Depois de qualquer escrita em coluna de identidade, a pessoa e todas as participações dela têm o
  mesmo valor. Colunas espelhadas: `name`, `email`, `phone`, `instagram`, `company`, `job_title`, `bio`, `gender`,
  `is_plural`, `photo_key`, `reach` (pessoa) · `company`, `website`, `kind`, `contact_name`, `contact_email`,
  `contact_phone` (empresa). Tudo o que é funil (`status`, `topic`, convite, portal, plateia, contrato) **não** é
  espelhado: é da participação.
- **Nenhum número, link ou token muda.** A migração não apaga nem renumera nada; cada linha de hoje ganha uma pessoa (ou
  empresa) com o mesmo id da linha, para o espelho ser conferível a olho.
- **Recorte**: nada de pessoa ou empresa aparece fora do recorte. "Em outros projetos" mostra só projetos de que **quem
  está olhando** participa (`req.scope.ids`); participação de outro projeto responde 404 como hoje (`scope.assert`).
- Português do Brasil, tokens do `app.css`, sem `style=` nem `<script>` inline, ícones por `icon()`, sem emoji.
- Ritual de lançamento: entrada no topo de `src/releases.js`, `version` do `package.json` igual, `memory.md`,
  `README.md` e `docs/design-system.md` quando a tela muda.
- Testes: `TEST_DATABASE_URL` num banco que termina em `_test` (`pulso_claude_test`), `--test-concurrency=1`. Mac de
  8 GB: nada pesado em paralelo.

## Jornada

- **Produtora, prospecção do Projeto 100.** Ela lembra que o Dr. Márcio já gravou no Pulso. Abre o cadastro dele,
  vê "Em outros projetos" com o Pulso e a etapa, toca **Convidar também para o Projeto 100** e cai na participação nova,
  em Prospecção, com nome, @, telefone e foto já lá. Próximo passo: registrar a abordagem.
- **Quem corrige um dado.** Troca o telefone do convidado no Pulso; o telefone do mesmo convidado no Projeto 100 muda
  junto, sem ninguém lembrar de fazer isso.
- **Quem cadastra sem saber.** Digita "Marcio Martins" no Projeto 100 sem usar o botão. O aviso de duplicata aparece
  como hoje, mas a ação é **É a mesma pessoa** (une os cadastros e mantém as duas participações), porque são projetos
  diferentes; dentro do mesmo projeto continua sendo **Juntar os dois cadastros** (um vai para a lixeira).

## Review Focus

1. **Esvaziar um campo** (tirar o e-mail numa participação) tem de esvaziar nas outras: espelho é cópia, não "preenche
   o que falta". Teste na tarefa 2.
2. **Participação sem pessoa** (criada por rota que não passou pelo espelho, ou restaurada da lixeira): `sync` cria a
   pessoa na hora, sem erro. Teste na tarefa 2.
3. **Convidar também** quando a pessoa já tem participação naquele projeto, quando quem está olhando não participa dele,
   ou quando o projeto não usa Convidados: o botão não aparece e o POST responde erro/404. Teste na tarefa 4.
4. **A mesma pessoa em dois projetos não é duplicata** (hoje seria "mesmo Instagram" = duplicata certa) e não some do
   aviso de duplicata de verdade. Teste na tarefa 5.
5. **Lixeira**: participação na lixeira não aparece em "Em outros projetos"; restaurar devolve a ligação com a pessoa.
   Teste na tarefa 4.

---

# Parte A — pessoas e convidados (v1.100.0)

### Tarefa 1: a tabela da pessoa e a migração

**Files:**
- Create: `src/db/migrations/098_pessoas.sql`
- Test: `test/pessoas-migracao.test.js`

**Interfaces:**
- Produz: tabela `people` (colunas espelhadas + `created_at`, `updated_at`) e `guests.person_id INTEGER NOT NULL
  REFERENCES people(id)`, com índice `guests_person_idx`.

- [ ] **Step 1: escrever o teste que falha** — `test/pessoas-migracao.test.js`: depois de `h.resetDb()` com dois
  convidados inseridos, `SELECT count(*) FROM people` = número de convidados; todo convidado tem `person_id`; para cada
  convidado, as colunas espelhadas são iguais às da pessoa; `person_id = id` nos cadastros migrados.
- [ ] **Step 2: rodar e ver falhar** (`relation "people" does not exist`).
- [ ] **Step 3: escrever a migração** — cria `people`, copia `INSERT INTO people (id, …) SELECT g.id, … FROM guests g`,
  `UPDATE guests SET person_id = id`, `setval` na sequência, `ALTER COLUMN person_id SET NOT NULL`, índice.
- [ ] **Step 4: rodar o teste e ver passar.**
- [ ] **Step 5: commit.**

### Tarefa 2: `services/people.js` (o espelho)

**Files:**
- Create: `src/services/people.js`
- Test: `test/pessoas-espelho.test.js`

**Interfaces:**
- Produz: `COLUMNS` (as colunas espelhadas), `sync(guestId, { client } = {})` → `{ personId }` (lê a identidade da
  participação, cria a pessoa se faltar, copia para a pessoa e para as irmãs), `save(personId, fields, { client })`
  (grava a pessoa e todas as participações), `get(personId)`, `participations(personId, { pids, exceptGuestId })` →
  `[{ guest_id, project_id, project_name, sigla, status, stage_label, updated_at }]`, `link(keepPersonId, dropPersonId,
  { client })` (as participações do que sai passam para o que fica).

- [ ] **Step 1: escrever os testes que falham** — espelho dos dois lados (editar a participação muda a pessoa e a irmã;
  `save` muda as duas participações), campo esvaziado esvazia nas duas, participação com `person_id` apagada à mão
  ganha pessoa nova no `sync`, `participations` devolve só projetos do recorte e não devolve a própria participação.
- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: escrever o serviço** — uma transação por chamada (ou a transação recebida em `client`); `sync` usa
  `INSERT … ON CONFLICT (id)` quando a pessoa não existe; nunca lança por falta de pessoa.
- [ ] **Step 4: rodar e ver passar.**
- [ ] **Step 5: commit.**

### Tarefa 3: todo mundo que escreve identidade passa pelo espelho

**Files:**
- Modify: `src/routes/guests.js` (criar `:211`, editar `:320`, confirmar agendamento `:405`), `src/services/guestImport.js:53`,
  `src/services/siteLeads.js:109`, `src/services/assistant.js:277`, `src/routes/episodes.js:220`,
  `src/routes/plateiaAdmin.js:337`, `src/services/guestPhotos.js`, `src/services/guestBulk.js:97`
- Test: `test/pessoas-escritores.test.js`

- [ ] **Step 1: escrever o teste que falha** — um caso por caminho (formulário, edição, confirmar agendamento, importação
  CSV, lead do site, assistente, convidado criado pelo episódio, foto, edição em massa): depois da ação, a pessoa existe
  e bate com a participação.
- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: chamar `people.sync(guestId)` depois de cada escrita** (uma linha por lugar); no formulário de edição,
  `people.save` com os valores de identidade e o resto da participação como hoje.
- [ ] **Step 4: rodar o teste e a suíte de convidados (`test/guests*.test.js`, `test/convidado*.test.js`).**
- [ ] **Step 5: commit.**

### Tarefa 4: "Em outros projetos" e "Convidar também"

**Files:**
- Create: `src/views/partials/other-projects.ejs`
- Modify: `src/views/guests/show.ejs` (aba Resumo, abaixo de Sobre), `src/routes/guests.js` (detalhe + rota nova),
  `src/public/app.css`, `src/utils/auditLabels.js`
- Test: `test/pessoas-outros-projetos.test.js`

**Interfaces:**
- Consome: `people.participations`, `projects.has(project, 'convidados')`, `scope.idsOf`.
- Produz: `POST /convidados/:id/tambem` (campo `project_id`) → cria a participação em `prospect` no outro projeto com a
  identidade da pessoa, evento no histórico, auditoria `convidado.tambem_em_projeto`, redireciona para ela.

- [ ] **Step 1: escrever os testes que falham** — a página mostra o bloco com o projeto e a etapa da outra participação;
  não mostra nada para quem só tem um projeto; o POST cria a participação (mesma pessoa, etapa Prospecção, dados
  copiados); POST para projeto de que a pessoa logada não participa = 404; projeto sem o módulo Convidados = erro;
  pessoa que já tem participação lá = erro e o botão não aparece; participação na lixeira não aparece no bloco.
- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: escrever a parcial, a rota e o estilo** — bloco só com `projectScope.multi`; uma linha por participação
  (nome do projeto, chip da etapa, "abrir"); botão secundário por projeto que falta; nada de lime (o lime da tela
  continua no próximo passo).
- [ ] **Step 4: rodar e ver passar.**
- [ ] **Step 5: commit.**

### Tarefa 5: duplicatas por pessoa

**Files:**
- Modify: `src/services/duplicates.js`, `src/views/duplicates/*.ejs` (ou onde a comparação é montada),
  `src/views/partials/duplicate-alert.ejs`, `src/services/people.js`
- Test: `test/pessoas-duplicatas.test.js`

**Interfaces:**
- Produz: `duplicates.findFor('guest', …)` e `pairs('guest')` passam a comparar **pessoas** (um candidato por pessoa,
  com as participações dentro); `people.join(keepGuestId, dropGuestId, choices, user)` une as pessoas mantendo as duas
  participações quando elas são de projetos diferentes, e chama o `merge` de hoje quando são do mesmo projeto.

- [ ] **Step 1: escrever os testes que falham** — duas participações da mesma pessoa não aparecem como duplicata; duas
  pessoas parecidas em projetos diferentes aparecem e a ação é "É a mesma pessoa" (as duas participações continuam, a
  identidade fica a escolhida, nada vai para a lixeira); no mesmo projeto, continua o "Juntar os dois cadastros" de hoje
  (um vai para a lixeira); o par dispensado continua dispensado.
- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: implementar** — comparação sobre `people` com as participações agregadas; na página de comparação, o
  botão e a frase mudam com o caso (mesmo projeto / projetos diferentes).
- [ ] **Step 4: rodar e ver passar, mais `test/duplicatas*.test.js`.**
- [ ] **Step 5: commit.**

### Tarefa 6: documentação e lançamento 1.100.0

**Files:**
- Modify: `src/releases.js`, `package.json`, `memory.md`, `README.md`, `docs/design-system.md`,
  `src/services/assistantKnowledge.js`, `src/services/assistantGuide.js`

- [ ] **Step 1: entrada 1.100.0 no topo de `src/releases.js`** e `version` igual no `package.json`.
- [ ] **Step 2: design system** — o bloco "Em outros projetos" e a mudança da duplicata entre projetos.
- [ ] **Step 3: `README.md` e `memory.md`** ("Estado Atual" e "Últimas Decisões", mais recente no topo).
- [ ] **Step 4: suíte completa** (`npm test`), tudo verde.
- [ ] **Step 5: commit.**

---

# Parte B — empresas e contratos (v1.101.0)

### Tarefa 7: a tabela da empresa, a migração e o espelho

**Files:**
- Create: `src/db/migrations/099_empresas.sql`, `src/services/companies.js`
- Test: `test/empresas-migracao.test.js`, `test/empresas-espelho.test.js`

**Interfaces:**
- Produz: `companies` (nome, site, tipo, contato: nome, e-mail, telefone), `sponsors.company_id NOT NULL`, e
  `companies.sync/save/get/participations/link` com a mesma assinatura de `people`.

- [ ] **Step 1: testes que falham** (migração: uma empresa por contrato, colunas iguais; espelho: os dois lados, campo
  esvaziado, contrato sem empresa).
- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: migração e serviço** (mesmo desenho da parte A; `company_id = id` nos contratos migrados).
- [ ] **Step 4: rodar e ver passar.**
- [ ] **Step 5: commit.**

### Tarefa 8: patrocinador — escritores, "Em outros projetos" e "Abrir negociação também"

**Files:**
- Modify: `src/routes/sponsors.js` (`:141`, `:222`), `src/routes/sponsorPublic.js` (`:110`, `:122`),
  `src/services/siteLeads.js:137`, `src/routes/episodes.js:212`, `src/views/sponsors/show.ejs`,
  `src/utils/auditLabels.js`
- Test: `test/empresas-outros-projetos.test.js`

**Interfaces:**
- Produz: `POST /patrocinadores/:id/tambem` → contrato novo em Prospecção no outro projeto, com os dados da empresa.

- [ ] **Step 1: testes que falham** (cada escritor espelha; o bloco aparece com a outra negociação; o POST cria o
  contrato; projeto sem o módulo Patrocínio ou fora do recorte = erro/404; contrato que já existe lá = erro).
- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: implementar** (a parcial `other-projects.ejs` da parte A, com os rótulos do patrocinador).
- [ ] **Step 4: rodar e ver passar, mais `test/patrocinad*.test.js`.**
- [ ] **Step 5: commit.**

### Tarefa 9: material da marca — "Trazer do outro projeto"

**Files:**
- Modify: `src/services/sponsorMaterial.js`, `src/views/sponsors/_material.ejs`, `src/routes/sponsors.js`
- Test: `test/empresas-material.test.js`

**Interfaces:**
- Produz: `sponsorMaterial.copyFrom(fromSponsorId, toSponsorId, fileIds, { user })` — copia as linhas de
  `sponsor_files` apontando para a mesma chave no armazenamento (nada sobe de novo, nada é apagado se um dos dois sair).

- [ ] **Step 1: testes que falham** (copia os escolhidos, mantém a chave, não copia de contrato fora do recorte, não
  duplica o que já veio antes).
- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: implementar** — botão secundário no cabeçalho da aba Material, janela com a busca da lista longa
  (`data-list-filter`) e as caixas de marcar; só aparece quando a empresa tem contrato em outro projeto com arquivos.
- [ ] **Step 4: rodar e ver passar.**
- [ ] **Step 5: commit.**

### Tarefa 10: duplicatas de empresa, documentação e lançamento 1.101.0

**Files:**
- Modify: `src/services/duplicates.js`, `src/releases.js`, `package.json`, `memory.md`, `README.md`,
  `docs/design-system.md`
- Test: `test/empresas-duplicatas.test.js`

- [ ] **Step 1: teste que falha** — a mesma empresa com contrato nos dois projetos não é duplicata; empresas parecidas
  em projetos diferentes viram "É a mesma empresa" (os dois contratos ficam).
- [ ] **Step 2: rodar e ver falhar.**
- [ ] **Step 3: implementar** (o mesmo caminho da tarefa 5, com `companies`).
- [ ] **Step 4: entrada 1.101.0, `package.json`, design system, README e `memory.md`; suíte completa verde.**
- [ ] **Step 5: commit.**

## O que esta fase não faz

- Perfil diferente por projeto para a mesma pessoa (fase 7 decide onde o perfil vale).
- Dinheiro por projeto (fase 5): `fin_entries` continua como está, mesmo no contrato novo.
- Página de "pessoas da casa" (uma lista de `people` fora dos convidados): ninguém pediu; a pessoa aparece sempre pela
  participação.
- Marca do Projeto 100 nas páginas públicas (fase 9), ainda que o manual já esteja em
  `docs/manual-de-marca-projeto-100.md`.
