# Reuniões com patrocinador — plano de implementação

> Execução: nativa (nesta sessão), a pedido do dono ("Implemente, publique e teste"). Passos em checkbox.

**Goal:** marcar reuniões com patrocinador (Meet ou presencial) pelo cadastro, com convite e Meet criados pelo Google em nome da
conta do Pulso, volta das mudanças do Google a cada 15 min e lugar para o resumo.

**Architecture:** tabela `sponsor_meetings` + `services/sponsorMeetings.js` (regras e Google) sobre `services/googleCalendar.js`
(token com `sub` = `GOOGLE_IMPERSONATE` só para reuniões). Rotas no `routes/sponsors.js`, aba "Reuniões" em `sponsors/show.ejs`
(partial `sponsors/_meetings.ejs`), tipo `reuniao` no Calendário do painel (fora do espelho do Google), rotina `reunioes`.

**Tech Stack:** Node 22, Express, EJS, pg, Google Calendar API v3 (JWT de conta de serviço com delegação).

**Spec:** `docs/superpowers/specs/2026-11-11-reunioes-patrocinador-design.md`

## Global Constraints

- Design system e manual de marca: um lime por área ("Marcar reunião" na aba vazia; "Marcar e enviar convite" na janela), datas em
  mono, sem emoji, ícones Lucide via `icon()`, sem `style=`/`<script>` inline, só tokens do `app.css`.
- Textos em pt-BR, tom da marca. Duração: 30 | 45 | 60 | 90 (padrão 45); faixa aceita 15–240.
- Convite e Meet: `sendUpdates=all`, `conferenceDataVersion=1`, `conferenceSolutionKey.type = 'hangoutsMeet'`.
- Gravações continuam com o token atual (sem `sub`).
- Release 1.64.0 em `src/releases.js` + `package.json`; `memory.md`, `README.md`, `assistantKnowledge`, `.env.example`.

## Review Focus

- Sem `GOOGLE_IMPERSONATE` ou sem delegação: reunião guardada, estado `pendente`/`erro` com frase clara; nada quebra a página.
- Convidados com e-mail inválido ou repetido: descartados/deduplicados antes do Google; pelo menos um convidado externo exigido.
- Data no passado ao marcar: recusada com mensagem (remarcar para o passado também).
- Evento apagado ou cancelado direto no Google (404/410/`cancelled`): a reunião vira `cancelada`, sem erro em loop.
- Fuso: horário digitado é de Brasília (`fmt.parseInputDateTime`), mostrado em Brasília.

---

### Task 1: Google em nome da conta do Pulso

**Files:** Modify `src/config.js`, `src/services/googleCalendar.js`, `.env.example`. Test: `test/reunioes.test.js`.

- [ ] `config.google.subject = env.GOOGLE_IMPERSONATE || ''`; `config.googleMeetConfigured = googleConfigured && Boolean(subject)`.
- [ ] `accessToken({ subject = null } = {})`: JWT com `sub` quando houver; cache por subject.
- [ ] `api(method, path, body, { query, organizer = false } = {})`: monta a query; `organizer` usa `accessToken({ subject })`.
- [ ] Espelho (`settings`, `saveSettings`, `sync`, view de Integrações) ignora tipos com `noMirror: true`.
- [ ] Teste: JWT da reunião leva `sub`; o da gravação não.

### Task 2: Tabela e serviço de reuniões

**Files:** Create `src/db/migrations/070_reunioes_patrocinador.sql`, `src/services/sponsorMeetings.js`. Test: `test/reunioes.test.js`.

**Produces:** `create(sponsorId, input, user)`, `update(id, input, user)`, `cancel(id, user)`, `addMeet(id, user)`, `retry(id)`,
`syncFromGoogle()`, `tick()`, `saveSummary(id, html, { source, user })`, `listFor(sponsorId)`, `check()`, `parseInput(body, sponsor)`,
`googleReason(err)`. `input = { title, agenda, startsAt: Date, minutes, mode, location, emails: [], ownerId, teamIds: [] }`.
Devolvem `{ error }` ou `{ meeting }`.

- [ ] Testes (Google simulado): marcar com Meet (corpo e query), presencial com `location`, falha 403 de delegação → `erro` com
  frase, sem subject → `pendente`, retry envia de novo, remarcar/cancelar `PATCH`, criar Meet depois, volta do Google (horário,
  `hangoutLink`, respostas, `cancelled`, 404), resumo, validação (passado, sem e-mail válido, duração fora da faixa).
- [ ] Implementar; linha do tempo em `sponsor_events` (`type = 'reuniao'`).

### Task 3: Calendário do painel e rotina

**Files:** Modify `src/services/calendar.js`, `src/index.js`, `src/views/calendar/index.ejs`. Test: `test/reunioes.test.js`.

- [ ] Tipo `{ key: 'reuniao', label: 'Reuniões com patrocinador', icon: 'handshake', perm: 'sponsors.read', hasOwner: true, noMirror: true }`
  e fonte `reuniao` (marcadas no período; `time` em Brasília; url `/patrocinadores/:id#reunioes`; dono = `owner_id`).
- [ ] `scheduler.every('reunioes', 15 * 60_000, () => sponsorMeetings.tick(), { delayMs: 100_000 })`.
- [ ] Teste: aparece em `cal.events`; o espelho não envia.

### Task 4: Tela

**Files:** Modify `src/routes/sponsors.js`, `src/views/sponsors/show.ejs`, `src/views/integrations.ejs`, `src/routes/misc.js`,
`src/utils/icons.js` (`handshake`, `video`), `src/public/app.css` (só se faltar classe). Create `src/views/sponsors/_meetings.ejs`.

- [ ] Rotas: `POST /patrocinadores/:id/reunioes` (marcar), `/reunioes/:mid` (remarcar), `/reunioes/:mid/cancelar`,
  `/reunioes/:mid/meet`, `/reunioes/:mid/tentar`, `/reunioes/:mid/resumo`; `POST /integracoes/google/reunioes/testar`.
- [ ] Aba "Reuniões" + linha na aba Resumo + janelas (marcar/remarcar com `data-fill-modal`, resumo com `rich-editor`).
- [ ] Testes de tela e permissão.

### Task 5: Lançamento

- [ ] Release 1.64.0, docs; suíte completa; commit; deploy; `check()` em produção (cria, remarca, lê e apaga um evento de teste
  com Meet e convidado fictício, `sendUpdates=none`).
