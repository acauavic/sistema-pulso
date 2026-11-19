# Avisos de tarefa, respostas não lidas e tarefa a partir da mensagem: plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** três melhorias pedidas pelo dono. (1) Os avisos de prazo e de bloqueio somem como pendentes quando a tarefa começa ou termina. (2) Um painel das respostas de thread não lidas, dentro da conversa. (3) "Criar tarefa" a partir de uma mensagem ou thread, com a IA preenchendo a janela de tarefa que já existe.

**Architecture:** Node 22 + Express + EJS + `pg`. Migração 089 cria `notifications.topic`, `chat_thread_reads` e `tasks.source_message_id`/`source_scope`. Os serviços seguem as fronteiras atuais (`notify.js`, `tasks.js`, `chat.js`, `taskVoice.js`). O cliente fica em `src/public/chat.js` e num script novo, `src/public/tarefa-msg.js`.

**Spec (decisões do dono, 19/11/2026):**
- Quando a tarefa vai para **Fazendo** ou **Feito**, os avisos dela ainda não lidos ficam como lidos, para todo mundo: vence hoje, falta pouco, atrasada e bloqueada. Os avisos de prazo dos dias seguintes **continuam como hoje** (o `dueTick` não muda). No sino, **só marcar como lida** (o check que já existe); não há dispensar nem apagar.
- Respostas não lidas: só nas **threads que eu sigo**, isto é, a mensagem original é minha, respondi nela ou fui marcado (no original ou numa resposta, inclusive com @todos). O painel fica **dentro de cada conversa**.
- Criar tarefa: quando a mensagem tem respostas, a janela **sempre pergunta** "Esta mensagem | A thread inteira". Depois de criada, a mensagem de origem mostra **uma linha pequena** "TAREFA · título", com link, para quem está na conversa.

## Global Constraints

- Design system e manual de marca: tokens do `app.css`, sem `style=` nem script inline (CSP `'self'`), ícones via `icon()`/`ic()`, sem emoji, dados em mono, um lime por área. O painel de threads e a linha "TAREFA" nunca usam lime.
- Tom: português do Brasil, direto.
- Testes com `node:test` em `pulso_avisos_test` (`.env.test.local`), nunca em `pulso_test`.
- Release 1.90.0 (minor) no topo de `src/releases.js` e `version` no `package.json`. Atualizar `memory.md` e o `README.md`, se ele descrever Mensagens/Tarefas.

## Review Focus

- Thread antiga, de antes da migração, não pode aparecer inteira como não lida: a migração semeia `chat_thread_reads` com a maior resposta de cada thread, para cada membro.
- Minha própria resposta nunca conta como não lida, e responder marca a thread como lida até a minha resposta.
- Resposta apagada não conta. Quem saiu do grupo não vê as threads dele.
- Criar tarefa com `source_message_id` de uma conversa da qual a pessoa não participa não grava o vínculo (a tarefa é criada sem ele).
- Voltar uma tarefa de Fazendo para A fazer não "desmarca" nada. O aviso de "concluiu", que nasce na mesma mudança, continua não lido.

---

### Task 1: Avisos de tarefa ficam lidos quando a tarefa anda

**Files:** migração `src/db/migrations/089_avisos_threads_tarefa_da_mensagem.sql` (feita aqui; as Tasks 2 e 3 acrescentam nela), `src/services/notify.js`, `src/services/tasks.js`, `src/public/collab.js`, teste `test/avisostarefa.test.js`.

**Interfaces:**
- `notify({ ..., topic })`: `topic` é o texto opcional gravado em `notifications.topic`. `tasks.js` passa `'prazo'` nos avisos late/due/soon do `dueTick` e `'bloqueada'` no aviso de bloqueio.
- `notify.clearTopics({ entity: { type, id }, topics: string[] }) -> Promise<number>`: marca `read_at = now()` nas não lidas daquela entidade e daqueles tópicos, para todos. Depois publica `realtime.publish(users, { type: 'notifications-read' })`, e o `collab.js` chama `refresh()` ao receber esse evento.
- `tasks.update`: quando `t.status !== task.status` e `t.status` está em `['fazendo', 'feito']`, chama `clearTopics({ entity: { type: 'task', id }, topics: ['prazo', 'bloqueada'] })` **antes** de criar os avisos novos.

- [ ] Teste: uma tarefa recebe "vence hoje" (`dueTick`) e "bloqueada". Ao ir para `fazendo` pelo `POST /tarefas/:id/status`, as duas ficam com `read_at` e o `unreadCount` do responsável cai para 0. Indo para `feito`, o "concluiu" do criador continua com `read_at IS NULL`. O aviso de outra tarefa não muda. Voltar para `a_fazer` não mexe em nada. No dia seguinte, o `dueTick` com outro `now` ainda gera o "atrasada" (dedupe novo).
- [ ] Rodar o teste e ver falhar. Implementar. Ver passar. Commit.

### Task 2: Respostas não lidas das threads que eu sigo

**Files:** a migração 089 (`chat_thread_reads (user_id uuid, parent_id bigint, last_read_id bigint, PK (user_id, parent_id))`, com a semente), `src/services/chat.js`, `src/routes/chat.js`, `src/views/messages/index.ejs`, `src/public/chat.js`, `src/public/app.css`, teste `test/threadsnaolidas.test.js`.

**Interfaces:**
- `chat.unreadThreads(conversationId, userId) -> [{ id, author, preview, unread, last_reply_at, last_reply_author }]`: só threads seguidas, com resposta de outra pessoa, não apagada e com `id > coalesce(tr.last_read_id, 0)`. Ordem: a resposta mais recente primeiro.
- `chat.markThreadRead(parentId, user, upto) -> { ok }`: grava `GREATEST`. O `send` com `parentId` também grava até a própria resposta.
- Rotas: `GET /mensagens/conversas/:id/threads-nao-lidas` e `POST /mensagens/threads/:mid/lida` (`{ ate }`, só para quem é membro).
- UI: `<details class="chat-unread-threads" data-chat-unread-threads hidden>` entre o cabeçalho e a rolagem. O resumo diz "N respostas não lidas em M threads" (a contagem em mono). Aberto, mostra uma linha por thread: o trecho do original, "Fulana respondeu" e a hora em mono, com a contagem em `nav-count`. Tocar abre `openThread(id)`. Some quando não há nada. É recarregado ao abrir a conversa, ao chegar `evento.mensagem` com resposta e ao fechar a thread. Abrir a thread chama `markThreadRead` com a maior resposta. O endereço `/mensagens/:id?thread=:mid` abre a thread (é o link de volta da Task 3).

- [ ] Teste: A escreve no grupo e B responde, então A tem 1 não lida. A abre a thread (lida) e fica com 0. C, que não segue, tem 0. C marcado com @ numa resposta passa a seguir. Resposta apagada não conta. Responder zera. Thread de antes da semente não aparece. Quem não é membro recebe 404.
- [ ] Ver falhar, implementar, ver passar. Commit.

### Task 3: Criar tarefa a partir da mensagem

**Files:** a migração 089 (`tasks.source_message_id bigint REFERENCES chat_messages ON DELETE SET NULL`, `tasks.source_scope text`), `src/services/taskVoice.js`, `src/services/chat.js`, `src/routes/chat.js`, `src/routes/tasks.js`, `src/services/tasks.js` (`create` aceita `source`), `src/views/messages/index.ejs` (inclui `tasks/_new.ejs` com `linkOptions`), `src/views/tasks/_new.ejs` (campos ocultos + barra "Da mensagem"), `src/views/tasks/show.ejs` (linha de origem), `src/public/tarefa-msg.js`, `src/public/chat.js` (botão na pílula e linha "TAREFA"), teste `test/tarefadamensagem.test.js`.

**Interfaces:**
- `taskVoice.organize({ text, user, now, origin = 'voz' | 'mensagem' })`: com `'mensagem'`, a primeira linha do system diz que é uma conversa escrita da equipe (autor e hora em cada linha). O resto das regras é o mesmo.
- `chat.taskSource(messageId, userId, scope) -> { text, conversationId, rootId } | { error, status }`: confere se a pessoa vê a mensagem. `scope 'thread'` só vale na mensagem original com respostas e junta original + respostas, sem as apagadas, no formato "Nome (dd/mm HH:MM): texto".
- `POST /mensagens/mensagens/:mid/tarefa` `{ alcance }` → `{ ok, draft, warnings, has_thread }`, com limite de uso (o mesmo da voz) e 503 sem Gemini.
- `POST /tarefas` aceita `source_message_id` + `source_scope`. Grava só se `chat.canSeeMessage` deixar e, depois, chama `chat.noteTask(messageId)`, que sobe a rev da mensagem e emite `evento.mensagem` para a linha aparecer ao vivo.
- `views()` do chat ganha `tasks: [{ id, title }]` (tarefas com aquela origem). O cliente desenha `<a class="msg-task mono small" href="/tarefas/:id">TAREFA · título</a>`.
- Página da tarefa: "Veio de uma mensagem de Fulana em Grupo · abrir" (`/mensagens/:conv?thread=:root`). Quem não participa vê só "Veio de uma mensagem do chat".
- Redirect depois de criar a partir do chat: `voltar` = `/mensagens/:conv` (com `?thread=` quando aberto da thread), flash "Tarefa criada".

- [ ] Teste: com o Gemini simulado, o rascunho da mensagem solta chega com `has_thread: false` e o texto do autor no prompt. Com `alcance=thread`, o prompt tem as respostas. `alcance=thread` numa resposta dá 400. Quem não é membro recebe 404. Criar com `source_message_id` grava o vínculo e a mensagem passa a trazer `tasks`. Origem de conversa alheia é ignorada. A página da tarefa mostra a linha de origem.
- [ ] Ver falhar, implementar, ver passar. Commit.

### Task 4: Fechamento

- [ ] Suíte inteira em `pulso_avisos_test`.
- [ ] Percorrer no navegador, no computador e no celular: o sino depois de mudar o status, o painel de threads e "Criar tarefa" (com o Gemini simulado ou, se houver chave no `.env`, o de verdade em dev).
- [ ] Release 1.90.0, `memory.md`, README, design system (padrões novos: `.chat-unread-threads`, `.msg-task`). Commit.
