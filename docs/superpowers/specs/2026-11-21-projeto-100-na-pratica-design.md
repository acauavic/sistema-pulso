# Projeto 100 na prática — desenho

Data: 2026-11-21 · **Aguardando a revisão do dono.** Continua a especificação do multiprojetos
(`2026-11-20-multiprojetos-design.md`, nove fases feitas até a v2.0.0). Como lá, este documento é o guarda-chuva: cada
parte abaixo ganha o seu plano, a sua branch e o seu lançamento, e só vai para produção com autorização.

## Por que

Com as nove fases, o Projeto 100 tem lugar no sistema. Mas ele trabalha de um jeito que o Pulso não trabalha:

- quem aprova pauta, roteiro e vídeo **não entra no sistema**: está no WhatsApp e só recebe link;
- grava **em lote**: uma sessão no estúdio, cerca de 10 vídeos de uma vez;
- é uma **parceria**: todo custo é guardado, e quando entra dinheiro a casa e o parceiro primeiro recuperam o que
  gastaram; o que sobra é lucro, dividido meio a meio;
- vai ter gente de fora com acesso (o financeiro do parceiro), e os quatro perfis fixos de hoje não separam isso.

## Decidido pelo dono (2026-11-21)

- **Acordo com o Dr. José Bento**: o custo do Projeto 100 é contabilizado desde o começo e volta primeiro; depois,
  lucro **50% casa / 50% parceiro**.
- **A equipe da casa conta como custo do projeto**: editor, produtora e gestão de projetos e qualidade de conteúdo,
  cada um com um valor mensal informado pelo dono.
- **O que o Dr. José Bento ou o Pedro gastarem do próprio bolso também volta para eles**, antes do lucro.
- **O lucro só é dividido quando a casa decide distribuir**; até lá fica acumulado.
- **Quem aprova só recebe link.** No vídeo, a pessoa pode comentar na minutagem, deixar só um recado geral, e aprovar.
- **Grava em lote**, muitas vezes ~10 vídeos numa sessão.
- **Funções sob medida**: criar funções e escolher o que cada uma acessa, por área do sistema e por projeto. O
  financeiro do parceiro entra no sistema, separado do resto.

## Parte 1 · Aprovação por link

### Como fica para quem usa

- Na **pauta/roteiro**, no **vídeo em revisão** e nas **capas aprovadas para teste**, o botão **Gerar link de
  aprovação** (secundário; o lime continua com a ação principal da tela). Ele cria o link, copia uma mensagem pronta
  ("Pauta do V.004 · Título · para aprovar até 25/11: <link>") e marca "Enviada" com data, hora e para quem.
- O link abre uma página pública no **endereço e com a marca do projeto** (fase 6 e 9), tema claro, coluna única,
  celular primeiro:
  - rótulo mono (V.004 · PAUTA), título em display, prazo em mono;
  - o conteúdo: texto da pauta/roteiro (ou o link do Google Docs), o vídeo (versão leve, com "Ver no original"), ou as
    capas;
  - na primeira resposta, a pessoa escreve o **nome** (fica guardado só no navegador dela);
  - **Aprovar** (o botão principal) e **Pedir ajustes** (secundário, abre o campo "O que precisa mudar").
- **No vídeo**: tocar na linha do tempo marca a minutagem e abre o campo do comentário (ponto ou trecho, como na
  revisão de hoje); também há o recado geral. A pessoa pode comentar e aprovar, ou comentar e pedir ajustes.
- **Cada link vale para uma versão.** Pauta mudou depois do envio, ou o editor subiu a v3: o link antigo mostra "Esta
  versão foi substituída" e não aceita resposta. Link vale 30 dias, pode ser revogado (link pequeno, com confirmação) e
  ninguém responde duas vezes ao mesmo link.
- A pauta passa a guardar **uma cópia por envio**; a página pública e a do painel mostram **o que mudou** desde o
  último pedido de ajuste (trechos novos marcados).

### O que a resposta faz

- **Pauta/roteiro**: Aprovar = estado `aprovada` (com "aprovada por <nome> pelo link"); Pedir ajustes = `ajustes` com o
  recado. É o mesmo que a gestão registra à mão hoje (o registro manual continua).
- **Vídeo**: a resposta executa a mesma passagem do botão interno: Aprovar leva a `em_finalizacao`; Pedir ajustes
  devolve a `em_edicao`. Os comentários entram na lista de ajustes do editor (`.fix-list`), com o nome da pessoa e a
  marca "pelo link".
- **Capas**: aprovar ou pedir ajuste por peça; a peça aprovada fica `aprovada`.
- Tudo vai para o histórico do item e gera aviso (tipo novo `aprovacao`) para quem gerou o link, o dono da pauta e o
  editor do vídeo.

### Dados e código

- `approval_links`: `id`, `token` (32 bytes aleatórios), `project_id`, `kind` (`pauta` | `video` | `capas`),
  `pauta_id` / `episode_id`, `version_ref` (cópia da pauta ou `episode_files.id` da versão do vídeo), `sent_to`,
  `created_by`, `created_at`, `expires_at`, `revoked_at`, `answered_at`, `answer` (`aprovado` | `ajustes`),
  `answer_name`, `answer_note`.
- `pauta_versions` (`pauta_id`, `n`, `body`, `body_html`, `link`, `created_by`, `created_at`): uma por envio, só quando
  o conteúdo mudou.
- `episode_comments` ganha `external_name` e `approval_link_id` (autor de fora, sem usuário).
- `services/approvals.js` (criar, carregar pela chave, responder, revogar) e `routes/approvalPublic.js`
  (`/aprovar/:token`, entra na lista `PUBLIC` do `hostContext`, `wrongHost` leva ao domínio certo). CSP `'self'`,
  `noindex`, limitador por IP, sem sessão do painel.

### Testes

- Link de outra versão não aceita resposta; link revogado ou vencido responde a página "não vale mais".
- Responder executa a passagem certa e não repete; segundo envio responde "já respondido".
- Comentário pelo link entra na lista do editor com o nome; nada do painel aparece na página pública.
- Isolamento: o link de um projeto aberto no domínio do outro vai para o domínio certo.

## Parte 2 · Sessão de gravação

### Como fica para quem usa

- **Nova sessão** (botão em Vídeos, e no calendário): projeto, data e hora, duração prevista, local. Escolher os
  vídeos em Pré-produção (lista com busca) e ordenar. A janela avisa (`.notice`, não bloqueia):
  - vídeo sem pauta/roteiro aprovado;
  - estúdio já ocupado naquele horário (outra sessão ou gravação de convidado agendada, de qualquer projeto).
- **Página da sessão no celular**: a fila dos vídeos, cada um com o roteiro aprovado em leitura grande, o campo de
  anotação ("take 3 é o bom") e **Gravado** (o lime da linha). Vídeo que não deu para gravar volta para a pré-produção
  ou passa para outra sessão.
- **Encerrar sessão**: a duração real (ex.: 2 h 10). Daí saem o custo de estúdio e o banco de horas.
- **Material**: **um link de estúdio por sessão**. O estúdio sobe tudo de uma vez; na sessão, a janela de triagem de
  sempre ganha a coluna "De qual vídeo" e a equipe distribui os arquivos.
- Calendário: a sessão é um evento (gravação, plum) com a contagem de vídeos.

### O custo de estúdio passa a ser da sessão

- Hoje cada vídeo gravado conta a duração dele (ou os 60 min padrão): 10 vídeos numa tarde de 2 h contariam 10 h.
- Com sessão: as horas usadas são as **da sessão**; cada vídeo leva **a parte dele em partes iguais** (minutos
  inteiros que somam a sessão), e o custo de estúdio de cada vídeo segue saindo por vídeo, para "custo por vídeo"
  continuar certo. Banco de horas: a sessão desconta da cota do projeto dela; sessão planejada é reserva.
- Vídeo gravado fora de sessão continua como hoje.

### Dados e código

- `recording_sessions`: `id`, `project_id`, `starts_at`, `planned_minutes`, `actual_minutes`, `place`, `notes`,
  `status` (`planejada` | `encerrada` | `cancelada`), `created_by`, `closed_at`.
- `episodes.session_id`, `episodes.session_position`, `episodes.session_note`.
- `episode_upload_links.session_id` (o link pode ser da sessão: `episode_id` passa a ser opcional, com um dos dois
  sempre preenchido); `episode_files` do envio da sessão ficam com `session_id` até serem distribuídos.
- `services/sessions.js`; `hourBank` e `finance.recomputeStudio` leem a parte da sessão; `production.onRecorded` não
  cria link do estúdio para vídeo de sessão.

### Testes

- 10 vídeos numa sessão de 130 min: o banco desconta 130 min e a soma do custo dos vídeos é o custo da sessão.
- Encerrar de novo com outra duração refaz tudo; tirar um vídeo da sessão redivide.
- Conflito de horário aparece com sessão do outro projeto e com convidado agendado do Pulso.

## Parte 3 · Acerto com o parceiro

### A regra

- Conta corrente desde o começo do projeto (`partnerships.start_on`), só com o que foi **pago** ou **recebido**:
  - **custos**: tudo o que é do projeto, mais a parte dele nos compartilhados (estúdio), mais a equipe da casa;
    separados por **quem pagou**: a casa, ou o parceiro (Dr. José Bento ou Pedro, do próprio bolso);
  - **receitas**: patrocínio, YouTube/AdSense e outras, separadas por **quem recebeu** (a conta da casa ou a do
    parceiro, porque o dinheiro do canal pode cair do lado dele).
- **Custo volta primeiro.** Enquanto a receita total não passar do custo total, toda receita é devolução de custo,
  repartida entre casa e parceiro **na proporção do que cada um gastou**. Passou: o excedente é **lucro a distribuir**.
- **Lucro só quando a casa decide.** O lucro fica acumulado até alguém fazer um acerto e escolher quanto distribuir;
  cada lado leva 50%.
- **Um acerto = uma transferência.** O sistema soma o que cada lado tem direito (devolução do custo + parte do lucro
  distribuído) e desconta o que cada lado já tem na mão (o que recebeu). O resultado é **uma** frase:
  "A casa paga R$ X ao Dr. José Bento" ou "O Dr. José Bento repassa R$ X à casa". Registrar o acerto gera essa conta
  (a pagar ou a receber), na categoria **Acerto da parceria**, que não é custo nem receita.

### A equipe da casa no custo

- Três custos mensais no Projeto 100 (categoria Equipe, pagos pela casa): editor, produtora e gestão de projetos e
  qualidade de conteúdo, com os valores informados pelo dono. Ficam **no banco, não no repositório**: entram pela tela
  (Financeiro > Mensais), no banco de desenvolvimento agora e no de produção só com autorização.
- Usa o mensal que já existe (`fin_recurring`), com dono Projeto 100. **Adotado**: o valor inteiro vai para o Projeto
  100, como dito; se depois for só uma parte, o mesmo mensal aceita "Compartilhado" com a divisão.

### Fechamento do mês

- **Fechar mês** (Financeiro > Parceria): o extrato do mês fica gravado como estava (custos por quem pagou, receitas
  por quem recebeu, devolvido, lucro acumulado) e os lançamentos do projeto pagos naquele mês **não mudam mais**
  (editar, pagar, cancelar, apagar e lançar com data no mês fechado respondem com a frase "O mês está fechado: lance
  no mês atual como ajuste").
- Reabrir é ação rara (menu da linha, com confirmação e motivo), só para quem gerencia o financeiro.

### Telas

- **Financeiro > Parceria** (só em projeto com acordo; aba nova no Financeiro): quatro números (custo a recuperar da
  casa, do parceiro, receita no período, lucro a distribuir) em mono e display, nada de lime nos números; o caminho do
  dinheiro do mês; a projeção em muted ("Com o que está previsto, o custo volta em 03/2027"); a lista dos meses com
  chip fechado/aberto; **Fazer acerto** é o lime (janela: quanto distribuir do lucro, padrão tudo; a frase da
  transferência; confirmar); **Fechar mês** secundário; **Gerar link do extrato** fantasma.
- No lançamento do Projeto 100: "Quem pagou" / "Quem recebeu" (`.seg`: Casa | Dr. José Bento | Pedro), só em projeto
  com acordo. Gasto do parceiro **não mexe no caixa da casa** (não entra no caixa nem no fluxo), só no resultado do
  projeto e no acerto.
- **Extrato por link** (`/extrato/:token`, marca do projeto, só leitura): o mesmo extrato, para o Dr. José Bento ver
  sem entrar.

### Dados e código

- `partnerships` (`project_id` PK, `partner_name`, `partner_people TEXT[]`, `house_pct` 50, `start_on`, `active`).
- `fin_entries.account` (`casa` | `parceiro`, padrão `casa`) e `fin_entries.account_person` (quem do parceiro).
- Categorias novas: receita **YouTube / AdSense**; **Acerto da parceria** (fora de custo e receita).
- `partnership_settlements` (data, lucro distribuído, transferência, conta gerada, quem fez) e
  `partnership_closings` (`project_id`, `month`, o extrato gravado em JSON, quem fechou, reaberto por/motivo).
- `services/partnership.js`: `ledger(projectId, { until })` (a conta corrente), `settlementPreview`, `settle`,
  `close(month)`, `assertOpen(entry)` (chamado em toda escrita do financeiro). Usa `finOwner.share` para a parte do
  projeto nos compartilhados.
- `cashNow`/`overview` deixam de fora `account = 'parceiro'`.

### Testes

- Custo 10.000 (casa 8.000, parceiro 2.000), receita 6.000: casa recupera 4.800, parceiro 1.200, lucro 0.
- Receita 14.000: custos voltam inteiros, lucro a distribuir 4.000; distribuir tudo dá 2.000 a cada lado; a
  transferência considera quem recebeu cada receita.
- Acerto não conta como custo nem receita; distribuir duas vezes não paga duas vezes.
- Mês fechado recusa edição, pagamento, cancelamento e lançamento com data dentro dele.
- O extrato por link não mostra nada além do projeto dele.

## Parte 4 · Funções sob medida

### Como fica para quem usa

- **Gestão > Equipe > Funções**: lista das funções (nome, quantas pessoas, chip "padrão"). Criar ou editar abre uma
  janela com uma linha por **área** e o nível em `.seg`: **Não vê | Vê | Edita | Gerencia**.
  Áreas: Convidados, Patrocinadores, Pautas, Vídeos e produção (com três subníveis: subir material, editar o vídeo,
  revisar e aprovar), Conteúdo e capas, Redes, Financeiro, Estoque, Plateia, Tarefas, Calendário, Mensagens, Sistema.
- As quatro de hoje viram as quatro primeiras funções, **com exatamente os mesmos poderes**. Superadmin fica travada.
- Exemplo pronto: **Financeiro** (Financeiro: Gerencia; Vídeos e Convidados: Vê; o resto: Não vê).
- Na janela do usuário, **cada projeto tem a sua função** (a mesma pessoa: Editor no Pulso, Gestão no Projeto 100). O
  interruptor "Vê o financeiro" sai: vira a área Financeiro da função.
- **Acesso até** (opcional): a data em que o acesso desliga sozinho (freelancer).
- "Equipe da casa" continua como está (alcança o que é geral).

### Dados e código

- `roles` (`id`, `key`, `name`, `levels JSONB` {área: nível}, `builtin`, `locked`); `AREAS` em `permissions.js` diz
  quais permissões cada nível de cada área dá (as permissões de hoje continuam sendo a unidade).
- `users.role_id` (a função padrão), `project_members.role_id` (a do projeto; vazio = a padrão), `users.access_until`.
- `can(pessoa, permissão)` = alguma função da pessoa dá a permissão (menu e rotas); `scope.idsFor(req, permissão)` =
  em quais projetos ela tem aquela permissão (listas, carregamentos, financeiro: substitui `financeIdsOf`).
- Os 36 pontos que citam um perfil pelo nome (ex.: a lista de editores) passam a perguntar pela permissão
  (`team.withPerm(permissão, projectId)`).
- Migração: quem tem `finance = false` num projeto com perfil que vê o financeiro recebe uma cópia da função sem a área
  Financeiro, para ninguém ganhar ou perder acesso na troca.

### Testes

- Para cada perfil de hoje, a função criada dá **exatamente** as mesmas permissões (permissão por permissão).
- Pessoa com função Financeiro no Projeto 100 vê o financeiro dele e nada de Convidados do Pulso; o teste de
  isolamento roda também com funções por projeto.
- Acesso vencido não entra; quem perdeu a área deixa de ver a tela na hora (sessão relida).
- Nenhum ponto do código compara o perfil pelo nome (varredura no `src/`).

## Ordem e versões

1. **Aprovação por link** (v2.1.0): muda o dia a dia desde o primeiro vídeo; não depende de nada.
2. **Sessão de gravação** (v2.2.0): antes da primeira sessão real, para o custo já nascer certo.
3. **Acerto da parceria** (v2.3.0): depende do custo certo (sessão e equipe).
4. **Funções sob medida** (v2.4.0): a maior; entra antes de alguém de fora ganhar login.

## Fora do escopo

- Aprovação com login (quem aprova só recebe link).
- Importar a receita do YouTube sozinha (a receita entra à mão; a leitura do YouTube Analytics fica para depois).
- Nota fiscal, contabilidade por competência, pagamento automático do acerto.
- Perfil por pessoa fora das funções (as permissões avulsas por pessoa não existem: tudo passa por função).

## Em aberto (do dono)

- **Desde quando** os custos da equipe contam no Projeto 100 (mês de início do acordo, `partnerships.start_on`).
- **Devolução proporcional**: adotado repartir a devolução do custo na proporção do que cada lado gastou (não "a casa
  primeiro" nem por ordem de data).
- **Nomes de quem paga do lado do parceiro**: adotados Dr. José Bento e Pedro (lista editável no acordo).
