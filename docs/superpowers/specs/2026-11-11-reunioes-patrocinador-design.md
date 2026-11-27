# Reuniões com patrocinador (Meet + convite do Google) — desenho

Data: 11/11/2026 · Versão alvo: 1.64.0 · Status: aprovado em conversa, aguardando revisão do documento

## Objetivo

Marcar reuniões com patrocinadores direto do cadastro: data, horário, formato (Google Meet ou presencial), convidados do
patrocinador e responsável da equipe. A reunião vai para o Google Agenda "Pulso Podcast", o Google cria o Meet e manda o convite.
Depois da reunião, o resumo fica guardado na própria reunião, no histórico do patrocinador.

**Sucesso**: marcar uma reunião em menos de 1 minuto, sem sair do cadastro; o patrocinador recebe o convite do Google com o link do
Meet; remarcar e cancelar avisam todo mundo; o que muda no Google Agenda (horário, Meet criado lá, respostas) aparece no sistema.

## O que o dono disse (fatos)

- As reuniões costumam ser pelo Google Meet, com o link criado na hora de marcar; tudo bem criar o Meet depois, pelo sistema ou
  pelo Calendar. Às vezes são presenciais.
- As reuniões saem da conta do Pulso (Google Workspace), dona do calendário "Pulso Podcast", que o sistema já usa.
- O resumo virá automaticamente por webhook de um sistema externo, **numa etapa posterior** (fora desta versão).

## Verificado em produção (11/11/2026)

- A integração atual é uma conta de serviço (client_id `101897371879862148282`) com escopo `calendar.events`, que escreve no
  calendário de grupo "Pulso Podcast".
- Sozinha ela **não** cria Meet ("Invalid conference type value") e **não** convida pessoas ("Service accounts cannot invite
  attendees without Domain-Wide Delegation of Authority").
- Solução: **delegação em todo o domínio** no Admin do Workspace para esse client_id com o escopo
  `https://www.googleapis.com/auth/calendar.events`, e o sistema agindo em nome da conta do Pulso (`sub` no JWT). Pendente: o
  administrador autorizar e informar o e-mail da conta (variável `GOOGLE_IMPERSONATE`).

## Experiência (jornada)

Quem cuida do patrocinador abre o cadastro, marca a reunião numa janela curta e segue o dia; depois da reunião, o resumo aparece ali.

- **Aba "Reuniões"** no cadastro do patrocinador (contador de próximas no rótulo da aba).
  - Vazia: estado vazio (linha de pulso plana) explicando para que serve, com **Marcar reunião** (o lime da aba).
  - **Próxima reunião** em cartão no topo: data e hora em mono; chip do formato (Meet | Presencial, neutro); **Entrar no Meet**
    (secundário, abre em nova aba) ou o endereço; convidados com a resposta de cada um em chip (confirmou = neutro, recusou =
    vermelho, sem resposta = apagado); responsável; **Remarcar** (secundário); "cancelar reunião" (link vermelho pequeno, com
    confirmação). Meet sem link: **Criar link do Meet** (secundário). Com mais de uma futura, as outras em linhas resumidas abaixo.
  - **Anteriores**: lista de linhas (data em mono, assunto em display, formato, chip "Resumo recebido" neutro ou "Aguardando
    resumo" âmbar). O resumo abre dentro da linha (`<details>`), lido em `.rich-content`; "Colar resumo" / "Editar resumo" abre
    janela com o `rich-editor` (até a integração existir).
  - Falha no Google: `.notice` com filete vermelho no cartão, motivo em português e **Tentar de novo** (secundário).
- **Aba Resumo**: uma linha "Próxima reunião: 14/11, 15:00 · Meet" que leva à aba Reuniões (só quando há reunião futura).
- **Janela "Marcar reunião"** (folha no celular): data e hora; duração em `.seg` (30 | 45 | 60 | 90, padrão 45); formato em `.seg`
  (Meet | Presencial; presencial mostra "Endereço"); convidados do patrocinador (o `contact_email` preenchido, "+ outro e-mail");
  responsável (select, padrão o `owner_id` do patrocinador) e "Mais alguém da equipe" (chips de checkbox); assunto (padrão
  "Reunião · {empresa}"); pauta curta opcional (vai na descrição do convite). Botão: "Marcar e enviar convite" (`data-busy`).
  Remarcar usa a mesma janela preenchida ("Salvar e avisar os convidados").
- **Calendário do painel**: novo tipo "Reuniões com patrocinador" (ícone `handshake` ou `video`, cor neutra), com responsável.
- **Linha do tempo do patrocinador**: marcada, remarcada, cancelada, Meet criado, resumo registrado.
- **Gestão > Integrações**: linha "Reuniões com Meet" com estado (ativo | aguardando autorização | não configurado), o passo a passo
  curto da autorização e **Testar** (cria e apaga um evento de teste daqui a um ano, `sendUpdates=none`).

## Dados

Migração `070_reunioes_patrocinador.sql`, tabela `sponsor_meetings`:

- `id` serial · `sponsor_id` → sponsors (cascade) · `title` · `agenda` (texto curto)
- `starts_at` timestamptz · `minutes` int (15–240) · `mode` (`meet` | `presencial`) · `location` · `meet_url`
- `attendees` jsonb `[{ email, name?, response: needsAction|accepted|declined|tentative }]` (só externos)
- `owner_id` → users (responsável) · `team_ids` uuid[] (outros da equipe)
- `status` (`marcada` | `cancelada`) · `google_event_id` · `google_state` (`pendente` | `ok` | `erro`) · `google_error` · `synced_at`
- `summary` (HTML do editor rico) · `summary_source` (`manual` | `webhook`) · `summary_at` · `summary_by`
- `created_by`, `created_at`, `updated_at`
- Índices: `(sponsor_id, starts_at DESC)`, `(starts_at) WHERE status = 'marcada'`.

Na lixeira, a reunião vai junto com o patrocinador (cascade, já coberto pelo `trash.capture`).

## Componentes

- **`config.google.subject`** (`GOOGLE_IMPERSONATE`): e-mail da conta do Pulso. Sem ele, reuniões ficam só no sistema com o aviso
  "aguardando autorização".
- **`services/googleCalendar.js`**: `accessToken({ subject })` com cache por subject; `api()` aceita query (`conferenceDataVersion`,
  `sendUpdates`) e o token do organizador. As gravações continuam com o token atual (sem `sub`), sem mudança de comportamento. O
  espelho do painel (`sync`) pula o tipo `reuniao`.
- **`services/sponsorMeetings.js`** (novo):
  - `create(sponsorId, input, user)`: valida, grava (`google_state = pendente`), envia ao Google
    (`POST events?conferenceDataVersion=1&sendUpdates=all`, `attendees` = externos + equipe, `conferenceData.createRequest`
    hangoutsMeet se Meet, `extendedProperties.private.pulsoMeeting = id`, `location` se presencial), guarda id, link e estado;
    registra na linha do tempo.
  - `update` (remarcar/editar: `PATCH ... sendUpdates=all`), `cancel` (`PATCH status=cancelled, sendUpdates=all`; guarda
    `cancelada`), `addMeet` (`PATCH conferenceData.createRequest`), `retry` (reenvia o que está `pendente`/`erro`).
  - `syncFromGoogle()`: reuniões `marcada` de ontem até +60 dias com `google_event_id`: lê o evento e atualiza horário, duração,
    `meet_url` (`hangoutLink`), respostas e cancelamento feito no Google; marca na linha do tempo o que mudou.
  - `saveSummary(id, html, { source, user })`: guarda o resumo (o webhook futuro chama esta mesma função).
  - `check()`: o teste de Integrações.
  - Erros do Google viram frase em português (sem delegação, calendário sem permissão, conta inexistente, fora do ar).
- **Rotina `reunioes`** no `scheduler` (a cada 15 min, uma réplica): `syncFromGoogle()` + `retry()` dos pendentes.
- **Rotas** em `routes/sponsors.js` (ou `routes/sponsorMeetings.js`): marcar, remarcar, cancelar, criar Meet, tentar de novo,
  resumo. `sponsors.write` para alterar; `sponsors.read` para ver.
- **`services/calendar.js`**: tipo `reuniao` (perm `sponsors.read`, `hasOwner: true`), item leva para `/patrocinadores/:id#reunioes`.
- **Views**: aba nova em `sponsors/show.ejs` (partial `sponsors/_meetings.ejs`), janela de marcar/remarcar, janela de resumo;
  linha em `integrations.ejs`. Estilo só com tokens/classes existentes em `app.css`; JS em `src/public/` (sem inline).

## Fora desta versão

- Receber o resumo por webhook (a função `saveSummary` já fica pronta para isso).
- Lembretes enviados pelo sistema (o Google já lembra os convidados).
- Contar a reunião na cadência de abordagens.

## Testes (Google simulado por `fetch`)

- Token com `sub` = `GOOGLE_IMPERSONATE` só nas chamadas de reunião; gravações sem `sub`.
- Marcar: pedido com convidados (externos + equipe), `conferenceData` (Meet), `sendUpdates=all`, `extendedProperties`; presencial
  sem Meet e com `location`; guarda id, link e `ok`; linha do tempo.
- Remarcar e cancelar: `PATCH` com `sendUpdates=all`; estados no sistema.
- Falha (sem delegação / fora do ar): reunião guardada, `erro` com frase, "Tentar de novo" envia de novo; sem `GOOGLE_IMPERSONATE`,
  fica `pendente` com o aviso.
- Volta do Google: horário mudado, `hangoutLink` criado no Calendar, respostas, cancelado lá.
- Tela: aba Reuniões (vazia, próxima, anteriores, resumo), janela; Calendário do painel com o tipo novo; espelho não duplica.
- Permissões: só `sponsors.write` altera.
- Release 1.64.0 (`releases.js` + `package.json`), README, `memory.md`, `assistantKnowledge`.
