# Relatório de arquitetura — Pulso Gestão (outubro de 2026)

Revisão do sistema inteiro: como ele roda, o que trava ou duplica quando cresce, como a equipe fica sabendo das coisas, e o que
foi corrigido nesta rodada. No fim, o que fica como recomendação e por que **não** adotamos Redis agora.

## 1. Resumo

- O sistema era **um processo só** (painel + trabalho pesado + rotinas). Funcionava com uma réplica, mas tinha pontos que
  **duplicariam ações reais** (post agendado saindo duas vezes, automação respondendo duas vezes) assim que houvesse duas réplicas,
  e nenhum trabalho de fundo tentava de novo depois de uma falha passageira.
- Corrigido: **processos separados** (painel e worker, mesma imagem), **fila com novas tentativas e sinal de vida**, **duas pistas**
  na fila (o pesado não segura o leve), **rotinas com trava** (uma réplica por vez), **reservas atômicas** em publicação e automação,
  **limitador de tentativas no banco** (o painel pode ter várias réplicas), **e-mails pela fila**, **avisos em tempo real** (SSE),
  e a tela **Gestão > Sistema**.
- Novo: **post da produtora passa pela aprovação da gestão** e o **assistente de IA** flutuante (texto e voz, com histórico).
- Redis: **não precisa agora**. O Postgres já faz fila (SKIP LOCKED), trava (advisory lock) e barramento (LISTEN/NOTIFY) com uma
  peça a menos para operar. Os gatilhos para reconsiderar estão na seção 5.

## 2. Como estava

- `src/index.js` subia o Express **e** o processador da fila **e** quatro `setInterval` (publicar agendados, avisos de tarefas,
  automações, limpeza) no mesmo processo.
- Fila `jobs` no Postgres com `FOR UPDATE SKIP LOCKED`, conferida a cada 4 s. Um trabalho por vez. Falhou = erro final.
  Ao reiniciar, **todo** trabalho "rodando" voltava para a fila (com dois workers, um roubaria o trabalho do outro).
- Limitador de login e páginas públicas **em memória** (o `stack.yml` pedia "mantenha 1 réplica" por isso).
- E-mail de notificação enviado **dentro da requisição** (promessa solta: se o processo caísse, o e-mail sumia; sem nova tentativa).
- Contador de notificações por **consulta a cada 60 s**. Resultado de trabalho de fundo (corte lido, IA terminou, publicação falhou)
  só aparecia na página de notificações.
- Nenhuma tela mostrava se a fila estava parada, o que falhou ou se as rotinas estavam rodando.

## 3. Problemas encontrados e o que foi feito

### Alta (ação real duplicada ou perdida)

- **Post agendado podia sair duas vezes** com duas réplicas: as duas rodavam o `tick` e liam os mesmos agendados.
  → A rodada agora **reserva** de forma atômica (`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`) e só uma réplica roda a
  rotina por vez (trava consultiva do Postgres). Teste: duas rodadas simultâneas, um envio só.
- **Automação podia responder o mesmo comentário duas vezes**: o registro era gravado *depois* da resposta.
  → O item é **reservado antes** (`social_events` com status `pendente` e `ON CONFLICT DO NOTHING`); só quem reservou responde.
- **Rotinas rodavam em todas as réplicas** (avisos de tarefa repetidos, limpeza concorrente).
  → `src/services/scheduler.js`: cada rotina com `pg_try_advisory_lock`; última execução e erro ficam em `scheduler_runs`.
- **Trabalho perdido em falha passageira** (rede, 5xx, cota da IA): ia direto para "erro".
  → Novas tentativas com espera crescente (30 s, 2 min, 8 min…), cota da IA espera 15 min; erro de verdade (arquivo inválido)
  para na hora. `attempts`, `max_attempts`, `run_after` na tabela `jobs`.
- **E-mail de notificação perdido** se o processo caísse. → vai pela fila (`email_notificacao`, 5 tentativas).

### Média (escala e desempenho)

- **Trabalho pesado no processo do painel**: FFmpeg e IA disputando CPU e memória com as requisições.
  → `ROLE=web | worker | all`. Produção: serviço `pulso_gestao` (web, pode ter réplicas) + `pulso_worker` (fila e rotinas,
  limite de 2 GB). Ver `stack.yml.example`. Desenvolvimento continua com um processo só (`all`).
- **E-mail esperava atrás de um corte de 20 min** (um trabalho por vez). → **Duas pistas** por worker: pesada (`corte`,
  `finalizacao`) e leve (o resto), em paralelo.
- **Trabalho preso como "rodando"** depois de queda; ao reiniciar, todos voltavam (roubando de outro worker).
  → **Sinal de vida** a cada 15 s (`heartbeat_at`); a rotina `fila-travada` só devolve o que está sem sinal há 3 min.
- **Fila acordava a cada 4 s.** → `LISTEN/NOTIFY`: enfileirar acorda o worker na hora; a conferência periódica (5 s) fica de reserva.
- **Limitador em memória impedia réplicas.** → tabela `rate_hits` (vale para todas as réplicas); limpeza diária.
- **Encerramento**: o processo morria no meio do trabalho. → para de pegar trabalho novo, espera o atual (até 8 s) e sai;
  o que não terminou volta pela regra do sinal de vida.

### Média (lógica)

- **Corrida ao criar episódio** (dois cliques ou duas réplicas): número repetido ou convidado com dois episódios virava erro 500.
  → número calculado no próprio `INSERT`; conflito de convidado devolve o episódio existente; conflito de número tenta o próximo.
- **Post feito pela produtora saía direto** (na verdade, a produtora nem podia publicar). → fluxo de **aprovação**:
  produtora monta e envia; o post fica **Em revisão** (já reserva o corte/imagem), a gestão recebe aviso, **aprova** (agendado,
  se o horário pedido ainda está no futuro; senão sai na hora) ou **devolve com nota**; quem pediu ajusta e reenvia. Contador no
  menu "Social" para a gestão. Vale para o Social e para a página do corte.
- **Erros da IA em linguagem técnica.** → `gemini.friendlyError` (cota, tempo esgotado, não configurada).

### Avisos e retorno para a equipe

- **Avisos em tempo real**: `GET /eventos` (Server-Sent Events). Qualquer processo publica com `pg_notify`; cada réplica web escuta e
  entrega para as abas abertas. Notificação nova aparece na hora como **aviso flutuante** (clicável) e atualiza o contador; se a
  conexão cair, o navegador reconecta e o contador ainda é conferido a cada 2 min.
- **Gestão > Sistema**: processos vivos (sinal de vida), fila (na fila, rodando, com erro, feitos em 24 h), o que está rodando
  agora, rotinas (última execução, erro) e trabalhos que **falharam de vez**, com botão **Tentar de novo**. Alerta quando nenhum
  processo está rodando a fila.

## 4. Assistente de IA

- Botão flutuante em todas as páginas do painel; painel com **histórico de conversas** (por pessoa, dá para abrir e apagar),
  sugestões de pergunta e **gravação de voz** (até 2 min; o navegador grava, o servidor transcreve com Groq Whisper).
- Responde com dados do painel por **ferramentas que respeitam o perfil** de quem pergunta: busca, tarefas, agenda de gravações,
  episódios (o que falta para o próximo passo), convidado, patrocinador (formulário, entregas, reservas) e resumo das redes.
  Ferramenta que o perfil não acessa nem é oferecida ao modelo, e um pedido dela é recusado.
- Só **uma ação** muda dados: **criar tarefa**, e só quando a pessoa pede. Não publica, não move etapa, não apaga.
- Links das respostas são só internos (`/caminho`); o texto é escapado antes de virar HTML.
- Limite: 40 perguntas a cada 10 min por pessoa. Sem cota da IA, responde com o aviso e guarda o erro no histórico.

## 5. Redis: por que não agora e quando reconsiderar

O Postgres já cobre os três usos típicos do Redis neste sistema:

- **Fila**: `SKIP LOCKED` + `LISTEN/NOTIFY` + novas tentativas. Volume esperado: dezenas de trabalhos por dia, cada um de segundos
  a minutos. Sobra capacidade.
- **Travas**: `pg_try_advisory_lock` (rotinas uma por vez).
- **Barramento de avisos**: `LISTEN/NOTIFY` entre réplicas (limite de 8 KB por mensagem: os avisos são pequenos).

Trazer Redis agora seria mais um serviço para monitorar, fazer backup e manter atualizado, sem ganho real. Reconsiderar quando:

- a fila passar de **milhares de trabalhos por hora** ou precisar de prioridades, filas atrasadas em massa e painéis prontos
  (BullMQ);
- o painel tiver **muitas réplicas** (10+) com muitas abas abertas (cada réplica segura uma conexão `LISTEN`);
- as páginas públicas (convite, media kit) receberem **tráfego alto** e o limitador no banco pesar;
- surgir necessidade de **cache** de leituras caras (insights das redes, por exemplo).

## 6. Recomendações que ficaram para depois

- **Webhook do Upload-Post** para o andamento das publicações (hoje a rotina consulta o status a cada 30 s). Precisa de URL pública
  e segredo. Os comentários e directs continuam por consulta (o Upload-Post não manda webhook disso).
- **Envio direto ao Backblaze** do material bruto do episódio (URL pré-assinada + CORS no bucket), como já é feito com os cortes:
  tira gigabytes de dentro do processo web.
- **Logs estruturados** (pino) e **rastreamento de erros** (Sentry ou similar) no web e no worker.
- **Testes de ponta a ponta no navegador** (Playwright) rodando no CI.
- **Cota da IA**: o plano gratuito do Gemini acaba rápido (ideias, finalização e assistente disputam a mesma cota). Ativar faturamento
  ou separar chaves por uso.
- **Matriz de permissões** continua provisória (`src/permissions.js`): revisar com o dono, principalmente `social.request`
  (produtora pede) e `social.publish` (gestão publica e aprova).

## 7. Implantação

1. Gerar a imagem (`Dockerfile` inalterado; FFmpeg já incluso).
2. As migrations rodam sozinhas ao subir (017: aprovação, fila, rotinas, limitador e assistente).
3. Usar o novo `stack.yml.example`: serviço `pulso_gestao` com `ROLE=web` (pode ter 2+ réplicas) e `pulso_worker` com `ROLE=worker`.
   Uma máquina só? Um serviço com `ROLE=all` (padrão) continua funcionando.
4. Conferir **Gestão > Sistema**: deve aparecer pelo menos um processo **Vivo** e as rotinas rodando.
