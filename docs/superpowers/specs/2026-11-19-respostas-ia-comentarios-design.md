# Respostas por IA nos comentários (Social > Comentários)

Data: 2026-11-19 · desenho aprovado em conversa com o dono (comentários sem resposta lidos, triados e publicados à mão no mesmo dia).

## Objetivo

Os comentários dos posts que o Pulso publica recebem resposta (texto ou emoji) da IA, aos poucos e no tom da marca, para aumentar o
engajamento. A equipe só entra quando a IA não deve responder sozinha. Sucesso: nenhum comentário relevante fica sem resposta mais de
um dia, nada sai que envergonhe a marca, e a conta não é bloqueada por parecer robô.

## Jornada

- **Gestão (dono), uma vez:** abre Social > Comentários, liga "Respostas por IA", escolhe *Aprovar antes* (padrão) ou *Automático*,
  e o ritmo (padrão 25 por hora, das 8h às 23h). Próximo passo: a lista "Para aprovar" começa a encher sozinha.
- **Gestão ou produtora, no dia a dia:** recebe o aviso "Comentários precisam de você" ou entra em Social > Comentários. Vê primeiro
  o que precisa dela (aba "Precisam de você"), depois as respostas propostas (aba "Para aprovar"): aprova todas de uma vez, edita uma
  ou manda não responder. Próximo passo: a aba "Na fila" mostra quando cada uma sai.
- **Na publicação:** a linha "Respostas por IA" mostra o estado daquele post (ligada/desligada) e quanto já foi respondido, com link
  para os comentários dele. Desligar ali tira o post da IA.

## Regras de quem responde o quê (prompt da IA)

- Comentário curto de apoio, só emoji ou elogio curto → **reagir** com um emoji (variando: 🙌 🔥 💚 ✨ 🫶 💯 👏).
- Opinião, relato ou pergunta sobre o tema → **responder**: curto (até ~220 caracteres), concreto sobre o assunto do corte,
  português do Brasil, sem "!!!", sem superlativo vazio, sem conselho médico/jurídico individual.
- **Opinião polêmica ou generalização** (machismo, "50% das mulheres mentem"…) → **responder com acidez leve, discordando** quando não for
  politicamente correto. Nunca ofender a pessoa.
- **Sempre que der, terminar com uma pergunta** que faça a pessoa comentar de novo.
- "Link da bio" no máximo quando a pessoa pergunta onde assistir.
- **Ignorar**: conversa com o convidado, marcação do convidado ou de amigos, comentário vazio, robô/spam, texto sem sentido, comentário
  do próprio perfil, do convidado do post ou de perfis da equipe (lista nas configurações), quem pediu o link pela palavra da automação.
- **Equipe** (gestão e produtora são avisadas): só o que é pesado — ameaça, ódio explícito, assédio, crise/risco à vida, pedido de
  orientação de saúde individual, assunto jurídico, reclamação séria contra o Pulso ou o convidado, ou quando a IA não tem segurança
  (confiança < 0,6).
- Resposta a outra pessoa (não ao Pulso) fica de fora. Resposta à resposta do Pulso entra (a conversa continua), no máximo 2 respostas
  da IA por pessoa no mesmo post.

## Dados

- `social_comments` (nova): um por comentário acompanhado. Rede, post (`post_ref` da Outstand, `platform_post_id`), `publication_id`,
  `comment_id` (único por rede), `parent_comment_id`, autor, texto, quando comentou, curtidas, contexto da conversa (jsonb), `status`
  (`nova`, `proposta`, `equipe`, `aprovada`, `enviada`, `simulada`, `ignorada`, `respondida`, `erro`, `apagada`), `action`
  (`responder`, `reagir`, `ignorar`, `equipe`), `reason`, `reply_text`, `ai_text` (o que a IA propôs), `confidence`, `decided_by`
  (pessoa; nulo = IA), `decided_at`, `sent_at`, `reply_id`, `error`, `attempts`.
- `episode_publications.ai_replies` (boolean, padrão true): a IA cuida deste post.
- `app_settings 'respostas_ia'`: `{ on, mode: 'aprovar'|'automatico', per_hour: 25, from: 8, to: 23, team_handles: [] }`, mais
  `respostas_ia_envio` (próximo envio permitido).

## Fluxo

1. **Entrada:** o aviso `comment.received` da Outstand (já existe) passa a também registrar o comentário em `social_comments`.
   E uma varredura a cada hora lê `GET /v1/posts/{ref}/replies?network=…&include_replies=true` dos posts dos últimos 14 dias com a IA
   ligada (pega o que o aviso perdeu e os Reels de teste). "Buscar agora" (gestão) varre os últimos 60 dias. Comentário que já tem
   resposta do Pulso vira `respondida`.
2. **Triagem:** um trabalho por post (`comentarios_ia`) manda à IA (Gemini, JSON) o contexto do post (título, legenda, convidado e @,
   Reel de teste) e os comentários novos com a conversa em volta. Volta ação, motivo, texto e confiança.
3. **Decisão:** modo *Aprovar antes*: responder/reagir viram `proposta`. Modo *Automático*: viram `aprovada`. Equipe vira `equipe` e
   avisa gestão e produtora (tipo de notificação novo "Comentários"). Em *Aprovar antes*, um aviso por dia "Respostas da IA esperando
   aprovação".
4. **Envio:** rotina a cada minuto: dentro do horário, abaixo do limite por hora e depois do intervalo aleatório (90–210 s), manda a
   próxima `aprovada` (a mais antiga, evitando o mesmo post duas vezes seguidas) por `POST /v1/posts/{ref}/replies` com
   `platform_post_id`. Sem `OUTSTAND_LIVE`, fica `simulada`. Erro vira `erro` com a frase em português e "Tentar de novo".
5. **Desfazer:** "apagar resposta" (com confirmação) chama `DELETE /v1/posts/{ref}/replies/{replyId}?platform_post_id=…`.

## Telas

- **Social > Comentários** (aba nova, contador em mono das que precisam de alguém):
  - cartão de configuração no topo: estado em uma linha legível ("LIGADA · aprovar antes · até 25 por hora, das 8h às 23h"),
    interruptor `.switch` e "Editar" (janela) para a gestão; estado vazio que ensina quando desligada.
  - `.seg` Precisam de você | Para aprovar | Na fila | Enviadas | Ignoradas, com contagem; filtro de post (lista com busca).
  - linha por comentário: miniatura 9:16 do post, título e convidado em mono, @ e hora em mono, o comentário, e a resposta da IA num
    bloco com filete (chip Responder/Reagir neutro, motivo em muted). Ações: Aprovar (secundário), Editar (janela com "Sugerir outra"),
    "não responder" (link pequeno). Em "Para aprovar", o lime é **Aprovar todas (N)**, com confirmação.
  - "Na fila": a previsão "sai por volta de 14:32" em mono e a frase do ritmo; "tirar da fila". "Enviadas": texto, hora, "Ver no
    Instagram" e "apagar resposta" (link vermelho pequeno).
- **Publicação**: linha "Respostas por IA" com `.switch` (gestão) e contagens em mono, link "ver comentários".
- **Permissões**: `social.comments` (superadmin, gestão, produtora) vê e age nos comentários; `social.automate` (gestão) liga, configura
  e muda o post.

## Também nesta entrega

- Corrigir `outstand.replyToComment`: sem `platform_post_id` a Outstand recusa, o que quebra a "resposta pública" da automação por
  palavra.
- Erros da Outstand em frase para a tela (`friendly`).

## Fora desta entrega

- Comentários de posts que não saíram pela Outstand, TikTok, YouTube, curtir e ocultar: dependem de conectar as redes na Zernio.

## Testes

- Triagem com Gemini simulado: polêmico vira resposta com pergunta, conversa com convidado é ignorada, pesado vai para a equipe e avisa
  gestão e produtora.
- Varredura: comentário já respondido pelo Pulso vira `respondida`; resposta a terceiro fica de fora; não duplica.
- Envio: respeita horário, limite por hora, intervalo, não repete post em sequência, manda `platform_post_id`, simula sem live.
- Permissões: produtora aprova e responde; produtora não muda configuração; editor não vê.
- Telas renderizam vazias e cheias; aprovar todas, editar, apagar resposta.
