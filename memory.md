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
- **Convidado x episódio**: convidado = pessoa, funil prospect → convite_enviado → em_agendamento → agendado → **gravado (fim)**
  (+ recusou/cancelado; **não existe mais publicado no convidado**, links são do episódio). Agendado = **agenda** (media kit
  `kitAgendaHtml`, reservas `sponsor_bookings`, portal). **Episódio nasce gravado** (`production.createEpisode`, chamado por
  `syncFromGuest` quando o convidado vira gravado, ou por "Registrar episódio gravado" com origem convidado/novo convidado/só hosts +
  patrocinador). Etapas do episódio: gravado → … → publicado (sem planejado/agendado). `episodes.recorded_on` = data da gravação.
  Convidado pode ter `sponsor_id` + `sponsor_relation` (representante|indicado): vira reserva automática do patrocinador.
- **Arquitetura de processos** (ver `docs/relatorio-arquitetura-2026-10.md`): `ROLE=web|worker|all`. Fila `jobs` (SKIP LOCKED,
  LISTEN/NOTIFY `pulso_jobs`, pistas pesada/leve, `attempts/max_attempts/run_after`, heartbeat + `recoverStuck`). Rotinas em
  `services/scheduler.js` com advisory lock (`scheduler_runs`, `worker_heartbeats`). Tempo real: `services/realtime.js` (SSE
  `/eventos` + `pg_notify('pulso_events')`), toasts em `collab.js`. Limitador `rate_hits` (async, com nome). E-mail de notificação
  = job `email_notificacao`. Gestão > Sistema (`/gestao/sistema`). **Sem Redis** (decisão consciente).
- **Financeiro** (migração 019, `services/finance.js`, `routes/finance.js`, `views/finance/`): `fin_entries` (saída/entrada, `previsto|pago|cancelado`, `auto_key` único = idempotência,
  `cancel_reason` sistema|usuario: o sistema só reativa o que ele cancelou), `fin_settings` (hora R$300, sinal R$150, duração padrão 60 min, episódios/mês, caixa inicial),
  `fin_rules` (gatilho gravacao_agendada|episodio_gravado|episodio_publicado + âncora/offset), `fin_recurring` (mensais, 3 meses à frente), `fin_stock_items/moves`.
  Ganchos: `production.syncFromGuest` → `syncGuest` (Agendado = sinal do estúdio; desistir cancela), `createEpisode` → `onEpisodeCreated` (move contas do convidado,
  saldo do estúdio, regras, consumo de estoque), `move()` → `onEpisodeStage` (publicado), edição do episódio → `onEpisodeDates`; `POST /episodios/:id/duracao` refaz estúdio
  (saldo pago → hora extra). Patrocínio: `planSponsorPayment` (parcelas a receber); primeiro recebimento seta `sponsors.paid_at` (`afterPaid`). Rotina `financeiro` (1 h) notifica (tipo novo `financeiro`).
  Permissões `finance.*` (gestão) e `stock.*` (inclui produtora, sem valores/compra). Aba Financeiro no episódio, card Pagamento no patrocinador, faixa no painel, busca global.
- **Assistente de IA**: `services/assistant.js` (Gemini `chat` com function calling; ferramentas filtradas por `can()`; só
  `criar_tarefa` escreve), `routes/assistant.js` (texto, áudio via Groq, histórico), `public/assistant.js` (painel flutuante,
  localStorage guarda conversa aberta). Tabelas `assistant_conversations/messages`.
- **Social** (`/social`): publicações (ver/editar; agendado edita local, publicado edita via Upload-Post só em YouTube/FB/LinkedIn/X),
  novo post só com conteúdo sem uso (USED = publicado/parcial/agendado/enviando), ideias Gemini com memória (`social_ideas` +
  fingerprint/Jaccard), insights (`social_snapshots`, 1 leitura/h), automações (`social_rules`/`social_events`, tick 5 min, nascem
  pausadas, `active_since`, uma resposta por item). `episode_publications.media` (video|imagem|carrossel|story) + `cover_ids`.
- **CRM de convidados**: quadro Kanban (drag-and-drop) + lista; linha do tempo por convidado. Cadastro mínimo: nome, Instagram
  (normalizado, sem @), perfil (`medico|influencer|empresario|profissional_saude`); opcionais: WhatsApp (`phone`), e-mail,
  motivo (`invite_reason`); depois: posicionamento, temas (`topic`), bio, data (`proposed_at`), confirmações de agenda
  (`scheduled_studio|hosts|guest`), links `youtube_url`/`spotify_url`. Regras de entrada por etapa em
  `src/services/guestRules.js` (**única fonte**: formulário, `/status` e arrastar usam a mesma; falha = 422 + `editUrl`).
  Formulário mostra campos por etapa (`data-stages`, `app.js`); a data da gravação abre a janela de confirmação (`[data-agenda]`).
  **Páginas guiadas** (convidado e patrocinador): stepper + cartão "Próximo passo" por etapa + janelas que pedem só o que falta
  (`POST /convidados/:id/avancar`, `POST /patrocinadores/:id/avancar`; 422 do quadro aponta para `?abrir=<janela>`). Importação CSV em `services/csvImport.js` + `routes/guestImport.js` (colunas opcionais `status` e `data da gravação`/`hora`; etapas permitidas em `IMPORT_STATUSES`).
- **Convite**: token secreto → página pública `/convite/:token` (**modelo fixo** `src/templates/convite-pulso.html`; não há
  mais tela/tabela de modelos) → link curto no YOURLS (keyword = nome curto) → envio por e-mail Brevo. Botões do WhatsApp
  passam pelo **redirecionador interno**: `GET /convite/:token/aceitar` (conta clique em `invite_clicks`, move
  prospect/convite_enviado/recusou → em_agendamento, avisa o responsável, mostra "Convite aceito" e faz meta-refresh 3 s p/ `wa.me`)
  e `/producao` (conta e redireciona). Robôs de preview (BOT_RE) só são redirecionados. O formulário na página ficou só com a
  recusa (`POST /convite/:token/responder`). Destino: `PRODUCAO_WHATSAPP`. Página pública roda em **CSP sandbox**.
- **Integrações**: Brevo SMTP (`BREVO_SERVER/PORT/USER/CHAVE_SMTP/EMAIL`, porta 587 STARTTLS) e YOURLS
  (`YOURLS_LINK` = host `link.podcastpulso.com`, `YOURLS_KEY` = signature; API via POST). Em dev as credenciais
  vinham do ambiente da sessão, não de `.env`.
- **Interface (design system)**: todo o painel segue `docs/design-system.md` + `docs/manual-de-marca.md` (originais em
  `docs/referencias/`). Tema escuro padrão + claro opcional (botão "Tema", `localStorage`), barra lateral com ícones Lucide
  (`src/utils/icons.js`), fontes Space Grotesk/Inter/JetBrains Mono/Instrument Serif **hospedadas** em `src/public/fonts/`
  (CSP `'self'`), tokens como variáveis em `src/public/app.css`. Etapa do convidado → chip de status do DS (mapa no doc).
  E-mails do sistema (`mailer.js`) e a página 404 do convite também na marca. **`CLAUDE.md` importa os dois docs**: é a regra de ouro do projeto.
- **Testes**: `npm test` (banco `*_test`, YOURLS mockado, e-mail dry-run; contagem atual na seção de produção). Verificado em navegador
  real (Playwright). **NÃO validado**: login SMTP real da Brevo (o sandbox de dev bloqueia portas SMTP),
  criação real de link no YOURLS (só `db-stats`, leitura) e build Docker.
- **Deploy**: ainda não feito. Plano em `README.md` (VPS Docker Swarm + Traefik, DB `pulso`, 1 réplica porque o
  limitador de login é em memória).

## Produção de episódios (pedido de 2026-10-08) — feito

- **Funil**: agendado → gravado → disponivel_edicao → em_edicao → em_revisao → em_finalizacao → pronto_publicar → publicado (`services/production.js`: `TRANSITIONS` com travas, `EFFECTS`). O episódio nasce do convidado em **Agendado**. Papéis: produtora sobe bruto, editor_video edita e mexe em capas/cortes, gestao revisa/aprova/publica. Rotas em `routes/episodes.js`, `covers.js`, `clips.js` (nessa ordem em `app.js`: específicas antes das genéricas).
- **Arquivos**: Backblaze B2 privado, upload em partes (16 MB, `UPLOAD_PART_BYTES` só em teste), tudo por link assinado. Tabelas: `episode_files`, `episode_frames` (`clip_id` NULL = quadros do episódio, senão do corte), `episode_covers` (`clip_id` idem), `episode_clips`, `episode_publications`, `jobs`, `episode_transcripts`, `episode_metadata`, checklists, comentários (migrations 006–009).
- **IA** (`finalization.js`, job `finalizacao`, fila em Postgres com `FOR UPDATE SKIP LOCKED`, `WORKER=false` desliga): FFmpeg → Groq Whisper → Gemini (`gemini-3.8-flash`, `thinkingLevel:'low'` para imagens; **plano gratuito = ~20 chamadas/dia, vira 429**). Boxes do Gemini vêm em 0–1000: `normalizeBoxes` na entrada **e de novo em `coverStore.loadFrames`** (análises antigas no banco estavam sem normalizar e quebravam todas as capas).
- **Capas** (`public/design/engine.js` = mesmo motor no servidor `@napi-rs/canvas` e no editor `public/editor.js`): construtores em `services/designs.js` geram várias composições e ficam com a de menor penalidade no `lint` (texto fora de rosto, fora de legenda queimada, dentro da zona segura, contraste, sem palavra pendurada). Legenda queimada: evita, corta fora ou **esconde com faixa escura** (scrim `patch`, `uncoveredBlocks`); foto vertical em painel largo = `contain` + **insets** (texto não invade a foto); rótulos pequenos (`placeMeta`, `optional`) somem se não há lugar livre. `specSanitizer.js` valida o que o editor envia.
- **UX reorganizada (2026-10-08, pedido do dono)**: tela do episódio em **abas por etapa** (`routes/episodes.js` calcula `tabs`/`defaultTab`; JS em `producao.js`; ids de seção continuam e o hash abre a aba certa); revisão só em `em_revisao`; material/vídeo editado recolhem depois de enviados; tarefas em `<dialog>`; histórico é aba. **Conteúdo** é área própria (`/conteudo`, `routes/clips.js`, views `content/`): cortes e posts/carrosséis saem do card do episódio. Vídeo editado do episódio **só horizontal** (`production.checkEditedVideo`, `config.checkVideoFormat`, pré-checagem no navegador).
- **Cortes (fluxo novo, substitui o de cortar do episódio)** (`services/clips.js`, job `corte`): o **editor sobe vários vídeos** (`POST /cortes/iniciar` + partes, tabela `clip_upload_parts`); o job lê (probe por URL assinada, Groq, quadros+Gemini, textos, 3 capas) e nomeia "Corte N"; `assign()` liga a um episódio **já gravado** (`ELIGIBLE_STATUSES`) e refaz as capas. `episode_clips/frames/covers.episode_id` são **nuláveis** (corte sem episódio); chaves no bucket em `cortes/<id>/…`. Capas respondem em `/capas/:cid/*` (genérico) e `/episodios/:id/capas/:cid/*`; quadros em `/quadros/:fid`. Fluxo ANTIGO (cortar do vídeo do episódio com FFmpeg, momentos viram cortes) foi removido; momentos da IA ficam só como dica.
- **Publicação** (`uploadPost.js`, `publishing.js`): **`UPLOAD_POST_LIVE` padrão false = só simula** (nunca publicou nada de verdade). Episódio só YouTube (e só em `pronto_publicar`/`publicado`, com thumbnail aprovada); cortes: tiktok/youtube(Shorts, sem thumbnail)/instagram(Reels, com capa). Agendamento é **nosso** (`tick` a cada 30 s em `index.js`), porque links assinados duram no máx. 7 dias. Perfil `default` do Upload-Post (lido, só leitura): Instagram `acauavic` e YouTube `@healthscalebr` conectados; **TikTok não**.
- **Testes**: `npm test` = 218+ (inclui FFmpeg real). `test/helpers.js` simula B2, Groq e Upload-Post e bloqueia rede real; Gemini é simulado dentro de cada arquivo de teste.
- **Dados de teste a limpar** (a pedido do dono, só no fim): episódio 5 "Conversa com Jonata Rocha" (banco de dev `pulso`), `pp/episodios/5/...` no bucket, cortes 1 e 3 (o 3 é o C0404.MP4 que o dono enviou de verdade; não apagar sem perguntar), convidado "Jonata Rocha". Excluir o episódio pela interface limpa o bucket (`purgeEpisodeFiles`).
- **Material do usuário**: `/Users/acauasantos/Desktop/corte-exemplo.mp4` (9:16, legendas queimadas no meio, rostos na metade de cima) — usar sempre cópia. Referência visual do dono: frase em itálico branco abaixo do rosto, aspas só de abertura.
- **Legenda queimada no vídeo (decisão do dono, 2026-10-08)**: não é prioridade; o tratamento automático (faixa `patch`) fica como está e a saída é manual: o editor troca o quadro de fundo ou **envia imagem própria** (`POST /episodios/:id/capas/imagem[?corte=id]`, vira linha em `episode_frames` com `analysis.custom`; fica fora da geração automática e da exclusão na reanálise; IA lê rosto em até 2 tentativas, senão `unchecked`).
- **Formulário do patrocinador em etapas (2026-10-08)**: `sponsors.js` tem `BRIEF_QUESTIONS` (8 perguntas; `skippable` e `na`), `briefState` (respondida | nao_se_aplica | pendente | aberta, derivado do conteúdo + colunas `skipped`/`na` de `sponsor_briefs`, migration 012), `applyAnswer`, `reconcileBrief` (tira pendência/NA do que passou a ter resposta e marca `brief_completed_at` só quando as 8 estão respondidas). Rotas públicas `POST /patrocinador/resposta` e `/concluir` (JSON, CSRF no cabeçalho, limite próprio de 150/10 min); o `POST /cadastro` antigo segue para quem está sem JS (vazios puláveis viram pendência). `closeBrief` registra evento e avisa o responsável uma vez por situação. Visual: `.steps` (patrocinador.css) e `.fp-steps` (painel).
- **Fora do escopo/pendente**: publicar de verdade (precisa o dono conectar TikTok e ligar `UPLOAD_POST_LIVE`), Spotify (sem API de upload), carrossel/foto no Instagram via API, aprovação de moldura/QR pelo patrocinador, WhatsApp.

## Colaboração (2026-10-08)

- **Tarefas**: tabela `episode_tasks` virou **`tasks`** (migration 013): `episode_id` nulável + `guest_id`/`sponsor_id`, status **a_fazer | fazendo | feito | bloqueada** (bloqueada exige `block_reason`, CHECK no banco), `created_by`, `completed_at`, `routine_id`. Serviço `services/tasks.js` (parse/create/update com avisos, `applyRoutines(trigger, episodeId)`, `dueTick()` diário com dedupe). Rotas `/tarefas` (escopo minhas|hoje|todas; visão lista|quadro|calendario) e as do episódio delegam ao serviço. "Hoje" = minhas não feitas com vencimento ≤ hoje (Brasília).
- **Rotinas** (`task_routines`): gatilho `episodio_criado` ou `etapa:<etapa>`; âncora gatilho|gravação|veiculação + offset; responsável ninguém|editor|responsável do convidado|usuário. `production.createTasks` = rotinas de `episodio_criado`; `move()` aplica `etapa:<to>`. Tarefa "do editor" sem ninguém vai para quem vira editor (bolinha ou "assumir edição"), sem roubar de quem já tem.
- **Notificações** (`services/notify.js`): `notify({type, users, broadcast, title, body, url, actorId, entity, dedupe})`; tipos tarefa|comentario|agendamento|rotina; respeita `notification_settings` (in_app, email, roles para broadcast) e `notification_mutes`; nunca avisa o ator. Ganchos: comentários, responsável, tarefas, agendamento (em `syncFromGuest` ao criar o episódio), job finalização (sucesso e `onError` em `jobs.register`), corte lido/erro, publicação, formulário do patrocinador. `navData` (middleware) põe contador e lista da equipe em toda página.
- **Comentários** (`comments`, `services/comments.js`): entity guest|sponsor|episode|clip|task; menção = `@Nome completo` ou `@PrimeiroNome` se único; destaque em `fmt.commentHtml`. As "anotações" da linha do tempo saíram da tela (rota `/nota` mantida).
- **Bolinha**: `partials/dot.ejs` (`inLink` para cards que já são link) + `POST /responsavel` (`services/responsible.js`, permissão por tipo). JS em `public/collab.js`.
- **Busca global** (`services/search.js`): `ACTIONS` + `PROVIDERS` (cada um declara `tables`); `/busca` JSON; `search_log` e `/busca/escolha`; `suggestions(app)` = buscas sem resultado (≥2), páginas GET sem atalho (`pagesOf` lê o router do Express), tabelas sem provedor (fora `TECHNICAL`), itens muito abertos; `search_shortcuts` e `search_dismissed`. **Ao criar módulo novo: adicionar ação/provedor ou a sugestão aparece sozinha.**
- **Gestão**: `/gestao` + `partials/gestao-nav.ejs` nas telas de usuários, logs, notificações, rotinas, busca e integrações. Permissões novas em `permissions.js`: tasks.read/write/manage, comments.write, notifications.manage, routines.manage, search.manage.
- **Pegadinha**: rotas públicas do patrocinador com fetch precisam estar na lista de `Origin: null` em `originCheck` (já incluí `resposta|concluir`).

## Últimas Decisões

- **Favicon e SEO da plateia (2026-10-13)**: favicon = o Ponto (`src/public/favicon.svg|.ico`, `apple-touch-icon.png`; `/favicon.ico` e `/apple-touch-icon.png` servidos na raiz, o que cobre convite e media kit sem `<link>`). `/plateia`: title/description/OG/Twitter na rota, imagem estática `og-plateia.jpg` (1200×630, renderizada com Chrome headless a partir de HTML com as fontes do repo + `kit/img-06.jpg`). **Notificações**: só no app (SSE `/eventos` → toast + contador); **não há** Notification API nem Web Push/service worker.

- **CSV de convidados com etapa e data (2026-10-13)**: colunas opcionais `status` (aliases etapa/situação/fase; aceita rótulo ou chave, `normalizeStatus`) e `data da gravação` (+ `hora` opcional; `parseRecordingAt`, Brasília -03:00, `dd/mm/aaaa hh:mm`, `aaaa-mm-dd`, `14h30`). Entra em Prospecção, Convite enviado, Em agendamento (pede e-mail/WhatsApp), **Agendado** (pede data/hora futura e entra com as três confirmações = true: a planilha afirma que está fechado), Recusou, Cancelado. **Gravado não entra** (faria nascer episódio). Depois do COMMIT roda `production.syncFromGuest` por convidado, igual ao cadastro manual (Agendado avisa a equipe e gera custos do estúdio). Histórico registra etapa e data.

- **Plateia: confirmar com valor** (migração 023): `POST /plateia/painel/leads/:id/confirmar` (audience.read) grava `amount_cents`, cria `fin_entries` (entrada, categoria `plateia`, source `plateia`, `auto_key plateia-lead-<id>`) e liga em `plateia_leads.entry_id`; `/recebido` marca/desfaz o recebimento; sair de Selecionado cancela a conta não recebida. Selecionar por `/leads/:id` com status confirmado é recusado.

- **Plateia = curadoria** (migração 022): pedir participação nunca confirma vaga; copy da página fala de plateia selecionada por afinidade com o convidado/tema; status do lead `novo|em_atendimento(Em avaliação)|confirmado(Selecionado)|nao_selecionado|desistiu`; novo pedido notifica (tipo `plateia`, produtora+gestão) uma vez; topo usa o vídeo do media kit (CSP `media-src https://s3.acauamedia.com`). Lição de layout: gutter de página pública não pode ser fixo em 20px (usar `--gutter: clamp(24px, 6vw, 96px)`).

- **Pulso Podcast com Plateia** (migração 021): `/plateia` pública (router montado antes da sessão), agenda gerada de `guests` (agendado + futuro + `audience_enabled`, `audience_status`, `photo_key`), leads em `plateia_leads` (E.164, UTMs, `ref` opaco; criado na revisão, não no clique do WhatsApp), eventos em `plateia_events`. Ajustes em `app_settings` (`plateia_*`: preço 19700, WhatsApp, local, duração, pixel/GA4, imagens). Permissões `audience.read` (gestão, produtora) e `audience.manage` (gestão). CSP da página só libera Facebook/Google se os IDs existirem. Telefone validado por país em `audience.validatePhone` (JS espelha a regra, servidor decide).

- **Revisão de segurança (2026-10)**: JSON em atributo `data-fill='…'` agora escapa também `'` (antes um apóstrofo em nome/observação quebrava o atributo: injeção de atributo e janela sem preencher); texto de confirmação dos botões "avançar" escapa `& < "`; `/notificacoes/:id/abrir` só aceita caminho interno (`//` barrado); HSTS em produção. Padrão: todo `json()` de view que vai em atributo precisa escapar `& " ' <`.

- **Finalização do episódio em 4 passos** (`views/episodes/_finalizacao.ejs`): Textos → Thumbnail → Checklist → Publicação, cada um com resumo e selo; só o passo da vez leva o botão lime (`next`). Textos (YouTube/Spotify/capítulos/thumbnail) ficam numa janela com abas locais (`data-tabs data-local`, `_textos.ejs`; `data-modal-open` + `data-tab` abre numa aba); publicar e links também em janela; ideias da IA recolhidas. `_ia.ejs` foi dividido em `_ia_status`, `_textos`, `_ideias`. As abas da janela não pertencem às abas da página (app.js filtra por `closest('[data-tabs]')`).

- **Exclusivo x inserção**: `app_settings` (migração 020, `services/settings.js`) guarda ajustes gerais; `block_insertion_in_exclusive` (padrão ligado, liga/desliga em Gestão > Planos de patrocínio) barra inserção de outro patrocinador em episódio/gravação com exclusivo (`settings.conflict`, validado em `/episodios/:id/patrocinadores` e `/patrocinadores/:id/episodios`). Card de comentários do patrocinador fica sob Tarefas.

- **Financeiro** (2026-10): o dinheiro vira módulo próprio. Custo automático nasce do evento (agendar = sinal; gravar = saldo do estúdio + regras + consumo de estoque), nunca de alguém lembrar;
  tudo idempotente por `auto_key`. Estúdio: saldo = duração×hora − sinal, hora extra se o saldo já foi pago. Estoque prevê reposição por consumo/episódio × episódios/mês − prazo de reposição.
  Compra de estoque gera conta a pagar (parcelável). Patrocínio parcelado por `fin_entries` (entrada) e confirma `paid_at`. Entregue sem integração bancária/NF (lançamento manual de pagamento).

- **Busca global corrigida (2026-10-10)**: a busca dos dados usava `ILIKE` puro ("joao" não achava "João", "joao lima" com duas palavras falhava). Agora `match()` em `services/search.js`: sem acento (`translate`), sem caixa e por palavras (todas, em qualquer ordem), em mais campos (telefone, empresa, site…); novos provedores: publicações, ideias e automações do Social. Palavra-chave de ação só casa no começo da palavra ("dra" não casa mais "padrão"). Provedor novo = declare `tables` e use `find()`/`match()`.
- **Revisão de UX / "copo na cozinha" (2026-10-10)**: regra escrita em `docs/design-system.md` ("Experiência e jornada") e `CLAUDE.md`: descrever a jornada antes e **percorrer no navegador** depois. Aplicada em: Planos (abas Ouro/Diamond, resumo legível, editar em janela), patrocinador > Entregas (lista + status rápido + janela; `status_only` na rota), Gravações e episódios e Arquivos (resumo + janela), publicação no Social (texto em janela), corte (textos, trocar de episódio e publicar em janelas), episódio (observações em janela), usuários (menu "Mais"), busca da gestão (novo atalho em janela, 4 sugestões + "ver mais"). Mecanismo reaproveitável: `data-fill-modal` + `form[data-fill-form]` em `app.js` (um formulário serve a todos os itens da lista; `data-fill-remove`, `data-mode`, `data-hide-section`, `data-if`). `.row.spread` agora existe no CSS. **Teste de isolamento**: a suíte chamava o Gemini real quando havia `GEMINI_KEY` no `.env` (covers falhou quando a cota voltou); `helpers.js` agora zera a chave e bloqueia `generativelanguage.googleapis.com`. CSS/JS mudam a versão do hash só ao reiniciar o servidor (tocar `src/index.js` no dev).
- **Planos de patrocínio (2026-10-10)**: tabelas `sponsor_plans` (ouro|diamond, `includes`) e `plan_items` (section entrega|escolha); `sponsor_deliverables` ganhou `plan_item_id`/`title`/`description` e `kind` nulo. Valor nulo no entregável = herda do plano (comparar com o do plano ao salvar; título/descrição/qtd iguais viram NULL). `plans.applyToSponsor` roda ao mudar a cota (criar, editar, /avancar) e `resyncPlan` ao mudar o plano. Nome do plano vive em `C.SPONSOR_TIERS` (mutado por `plans.middleware`, TTL 30 s por réplica). Media kit: slots `slide_ouro_html`, `slide_diamond_html`, `compare_html` (RAW). Página do patrocinador: etapa vira botão no topo + modal de confirmação, excluir ao lado de Editar (igual ao convidado). Testes: `plans.test.js`.
- **Aprovação, arquitetura e assistente (2026-10-08)**: (1) Produtora não publica: `publishing.create({review:true})` -> status
  `revisao` (reserva o conteúdo: está em `social.USED`); `approve` atômico (agendado se horário futuro, senão dispatch), `reject`
  com nota, `resubmit`. Permissão `social.request`. (2) Revisão de arquitetura: riscos de duplicidade com 2 réplicas corrigidos
  (tick com reserva SKIP LOCKED, automação reserva `pendente` antes de responder, rotinas com advisory lock); fila com novas
  tentativas e sinal de vida; startup NÃO devolve mais todos os "running" (roubaria de outro worker); duas pistas para o e-mail não
  esperar FFmpeg; `createEpisode` à prova de corrida. (3) Redis descartado por ora (Postgres basta; gatilhos no relatório).
  (4) Assistente: ferramentas só leitura + criar tarefa; links internos apenas; 40 perguntas/10 min. Gemini do dev está sem cota
  (o caminho de erro aparece na tela). (5) Testes: 307 passando (novos: `infra.test.js`, `assistant.test.js`).
- **Convidado até Gravado + Social (2026-10-08)**: (1) Pedido do dono: "o que se publica é o episódio"; episódio começa em gravado;
  agendado ainda é convidado. Migration 014 converteu episódios planejado/agendado sem material em reservas (apagou o episódio e as
  tarefas de rotina; tarefas manuais foram para o convidado) e guest publicado → gravado; 015 adicionou `recorded_on` e trocou
  rotinas `etapa:gravado` por `episodio_criado`. **Atenção**: o servidor em `--watch` aplicou a 014 no meio da edição; por isso a
  015 existe separada. (2) Episódio patrocinado: à mesa pode estar alguém do patrocinador, alguém indicado por ele ou só os hosts
  (episódio sem convidado, exige patrocinador). (3) Media kit: agenda gerada do CRM (só `agendado`), nomes fixos removidos do HTML.
  (4) Upload-Post: leituras reais sempre que há chave; escritas (posts, edição, comments/reply/create, dms/send, upload_photos) só com
  `UPLOAD_POST_LIVE`. Automação usa nosso motor (polling de comments/media/dms) em vez dos monitores AutoDM deles, para manter log e
  regras no nosso banco. (5) Insights leem números reais do Instagram no dev (só leitura). (6) Testes: 289 passando.
- **Jornada guiada (2026-10-08)**: (1) Pedido do dono: mostrar só o que importa na etapa e guiar. Convidado/patrocinador ganharam stepper,
  cartão "Próximo passo" (um botão lime) e abas; seletor de etapa e excluir foram para "Outras ações". (2) `/avancar` salva **só os campos
  presentes** no corpo (whitelist) e move se `missingFor` deixar; se não, salva o que veio e reabre a janela (`?abrir=`). (3) Agenda: data +
  três confirmações juntas (`agenda=1`, checkbox ausente = falso). **Remarcar sem reconfirmar volta para em_agendamento** e grava evento
  `agenda`; o episódio já criado não muda (só segue o convidado para frente). (4) Abas e janelas (`data-tabs`, `data-modal-open`) saíram
  do `producao.js` para o `app.js` (global); o `producao.js` só preenche a janela de edição de tarefa. (5) Episódio: card de
  patrocinadores some quando não há vínculo. (6) Testes: 272 passando.
- **Produção de episódios (2026-10-08)**: (1) Capas e cortes **nunca inventam**: sem leitura de rosto da IA não geram capa; falha do Gemini não derruba o corte. (2) Legenda queimada nos quadros (comum em cortes) é tratada: preferir cortar fora/evitar; senão faixa escura `patch` (lint considera coberta só se ≥90% da legenda e força ≥0,85). (3) Publicação em modo teste por padrão, agendamento próprio, só gestão publica. (4) Permissão de capas/cortes = review|edit (a produtora **não** edita capas; antes a rota usava `production.manage` e deixava passar). (5) `loadFrames(episodeId,{clipId})`: `undefined` todos, `null` só do episódio, número só do corte; capas/quadros do episódio e dos cortes não se misturam. (6) Estilos: `style=` inline removidos (CSP); larguras de barra via `data-w` + JS. (7) Gemini free tier acaba (429) — o aviso na tela é em português; sugerir faturamento ao dono.
- **Central de patrocinadores (2026-10-08)**: (1) CRM próprio (`sponsors`, etapas prospect→negociacao→ganho→ativo, +inativo/perdido; regras em `services/sponsors.js`: ganho exige cota/valor/responsável+contato, ativo exige pagamento). "Responsável" = pessoa **na empresa**; `owner_id` = nossa equipe. (2) **Sem contas**: **magic link reutilizável** — token por patrocinador (`public_token`) abre kit/cadastro/portal, cria sessão cookie `pulso_sp` (hash em `sponsor_sessions`, 30 dias) e redireciona para URL limpa; regenerar links revoga sessões; CSRF por sessão; `Origin: null` aceito só nas rotas `/patrocinador/(cadastro|logo|audio)` (a página manda `Referrer-Policy: no-referrer`, e o navegador então envia `Origin: null` no POST — isso quebrou o envio no teste real e os testes automáticos não pegavam; por isso há teste com `origin: null`). (3) Arquivos no **Backblaze B2 privado** via S3 com SigV4 próprio (testado contra o vetor oficial da AWS); a chave de produção tem **restrição de prefixo `pp`**, então toda chave de objeto começa com o prefixo descoberto em `b2_authorize_account`. Nada é público: o servidor faz proxy (`sendFile`). (4) Voz: `MediaRecorder` → `POST /patrocinador/audio` (corpo cru) → B2 + Groq `whisper-large-v3` pt → texto editável; o áudio e a transcrição original ficam em `sponsor_files`. Se a Groq falhar, o áudio fica guardado e o usuário digita. (5) Portal e media kit replicam o HTML original do usuário (kit = arquivo fixo com imagens extraídas; portal = EJS por dados), sem JS no portal, fontes locais, sem emoji. (6) Episódios: cadastro **mínimo** (`episodes`), ligado a patrocinadores por `sponsor_episodes` (inserção/exclusivo). (7) **Não feito**: aprovação de moldura/QR pelo patrocinador e WhatsApp (modelo comporta). (8) Suíte **bloqueia** chamadas reais a backblazeb2.com e groq.com (mock em `test/helpers.js`); teste real foi feito à mão e os objetos de teste foram apagados do bucket.
- **CRM novo + convite fixo + CSV (2026-10-08)**: (1) "confirmado" virou **em_agendamento** e entrou **agendado** (migration 003 renomeia
  os dados); regras de avanço literais ao pedido, **não cumulativas** (gravado não exige nada; publicado só exige links). O aceite do
  convidado pelo botão **ignora** a regra de contato (ação dele, não da equipe). (2) Rastreio de cliques **interno**, não YOURLS: o YOURLS
  não sabe quem clicou e deixaria o "aceitar" dependente de serviço externo; YOURLS só encurta o link do convite. (3) Removidos
  modelos de convite (tabela `invite_templates`, `template_id`, rotas/views/permissões `templates.*`, seed). (4) Mantida só a **recusa**
  no formulário do convite (decisão minha; o usuário não respondeu). (5) GET `/aceitar` muda estado: aceitável porque link só existe
  na página do convidado, e robôs conhecidos são ignorados por User-Agent (scanner de e-mail desconhecido poderia disparar). (6) Chips:
  em_agendamento=âmbar, agendado=plum, gravado=neutro (ver `docs/design-system.md`). (7) `migrate.js` ignora arquivos que começam com `.`
  (o disco exFAT cria `._*` e quebrava as migrations). **Cuidado dev**: variáveis do shell vencem o `.env`; com `YOURLS_*` reais no ambiente o
  `npm run dev` cria links de verdade (aconteceu 1 vez: `link.podcastpulso.com/mariasouza`) — rodar com `YOURLS_LINK= YOURLS_KEY=`.
- **Cache de /static (2026-10-08)**: depois do redesign, o navegador do usuário mostrou HTML novo com `app.css` antigo (cache de 1h do
  `express.static`). Agora `head.ejs`/`foot.ejs` pedem `/static/*.css|js?v=<hash do conteúdo>` (`ASSET_VERSION` em `middleware.js`). Toda
  referência nova a arquivo de `/static` que muda com frequência deve levar `?v=<%= assetV %>`.
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
