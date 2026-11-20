# Multiprojetos (Health Scale Studio) — desenho

Data: 2026-11-20 · Direção aprovada pelo dono na conversa. Este documento é o guarda-chuva: cada fase abaixo ganha o seu
plano de implementação, a sua branch e o seu lançamento, e só vai para produção com autorização.

## Por que

O sistema nasceu para um podcast só. Não existe "projeto" no banco (92 migrações, cerca de 110 tabelas), o nome "Pulso" está
em 33 pontos via `config.podcastName` e escrito à mão em vários prompts de IA, e o episódio só existe depois de gravado
(`production.createEpisode` cria já em `gravado`). Agora a casa (Health Scale) começa o **Projeto 100**, um canal de YouTube
com o Dr. José Bento, com a mesma equipe de edição e produção por enquanto. Precisamos de:

- mais de um projeto no mesmo sistema, sem telas diferentes para o editor e para a produtora;
- vídeo que não é episódio de podcast;
- convidados e patrocinadores que aparecem nos dois projetos, sem cadastro duplicado;
- dinheiro separado por projeto, com o que é compartilhado dividido de forma declarada;
- pessoas que só enxergam um projeto (a equipe do Dr. José Bento vê o Projeto 100, inclusive o financeiro dele, e nada do Pulso);
- pauta e roteiro acompanhados antes da gravação.

## Decidido pelo dono

- **Um sistema só.** Ninguém acessa dois sistemas para saber o que fazer.
- **O painel passa para a identidade da Health Scale** (nome Health Scale Studio, logotipo, verde, Archivo). O que é do
  Pulso continua com a marca do Pulso, dentro do projeto Pulso. A marca do Projeto 100 ainda está em definição.
- **Só a gerência é Health Scale Studio.** Tudo o que sai para fora (convite, portal, media kit, plateia) abre no
  domínio do projeto, com o favicon e a marca do projeto: links do Pulso no domínio do Pulso, links do Projeto 100 no
  domínio do Projeto 100.
- **Ícone do painel: o monograma "St".** O Sinal (as quatro barras) entra como elemento de apoio. As formas dos
  componentes continuam as de hoje.
- **Projeto novo: Projeto 100** (canal de YouTube com o Dr. José Bento).
- **Mesmo convidado e mesmo patrocinador nos dois projetos**, cada um com a sua história em cada projeto.
- **Financeiro por projeto**: patrocínio entra no projeto dele; custo compartilhado é dividido (ex.: banco de 20 h do
  estúdio, 10 h para cada).
- **Quem vê cada projeto é escolhido na gestão.** Quem é só do Projeto 100 vê só o que é do Projeto 100, inclusive no financeiro.
- **Pauta e roteiro entram no processo.** Quem aprova está em grupo de WhatsApp, fora do sistema; gestão e produtora
  registram o andamento.

## Regra que organiza tudo

**Cadastro é da casa. Trabalho e dinheiro são sempre de um projeto.**

- **Da casa (um só)**: pessoas (convidados), empresas (patrocinadores), equipe, mensagens, estoque, categorias, estúdio e
  o pacote de horas.
- **De um projeto (sempre)**: participação do convidado, contrato do patrocinador, vídeos e episódios, pautas, cortes,
  pedidos de conteúdo, publicações, contas das redes, comentários, metas, lançamentos do financeiro, plateia, convites.
- **Pode ser dos dois jeitos**: tarefa (de um projeto, ou "geral" quando não tem vínculo) e lançamento do financeiro
  (de um projeto, ou compartilhado com a divisão declarada).

## Como fica para quem usa

### Seletor de projeto (o mesmo sistema, as mesmas telas)

- No topo do menu, abaixo do nome do painel: **Todos os projetos | Pulso | Projeto 100**. A escolha fica guardada por
  pessoa (`users.last_project_id`; vazio = todos). Trocar recarrega a mesma tela com o outro recorte.
- **Quem participa de um projeto só não vê o seletor** nem campo de projeto em lugar nenhum: para essa pessoa o sistema
  é como hoje.
- Em "Todos os projetos", cada cartão e cada linha levam a **sigla do projeto em mono entre colchetes** (`[ PULSO ]`,
  `[ P100 ]`), neutra (nunca lime, nunca plum). Com um projeto escolhido, a sigla some.
- Os endereços não mudam (`/episodios/12` continua valendo). Abrir um item de outro projeto que a pessoa pode ver
  funciona, e a página mostra a sigla ao lado do título.
- **Criar algo** usa o projeto escolhido. Em "Todos os projetos", a janela de criação abre com o campo **Projeto**
  (controle segmentado) em primeiro lugar.
- O item do menu "Episódios" usa o nome que o projeto dá aos seus vídeos ("Episódios" no Pulso, "Vídeos" no Projeto 100);
  em "Todos os projetos" vira "Episódios e vídeos".
- Editor e produtora: Início, Ordem de edição, Seu ritmo, Seu dia, quadros e Tarefas continuam uma tela só, juntando os
  projetos da pessoa. A ordem de edição é única (data de veiculação), com a sigla em cada linha.

### Vídeo que não é episódio

- O episódio vira o caso "podcast" de uma coisa mais geral, o **vídeo**. `episodes.format`: `podcast` | `video`
  (padrão vem do projeto). As etapas de produção são as mesmas; o formato só esconde o que não se aplica:
  - `video`: convidado é opcional; sem Spotify, sem capa do Spotify, sem vídeos do convidado e sem portal quando não há
    convidado.
  - `podcast`: tudo como hoje.
- **Numeração por projeto**: `EP.012` no Pulso, `V.003` no Projeto 100 (`UNIQUE (project_id, number)` no lugar do
  `UNIQUE (number)` de hoje). O prefixo é do projeto.
- Vídeo sem funil de convidado precisa existir antes da gravação. Entra uma etapa nova no começo de `EPISODE_STAGES`:
  **Pré-produção** (`pre_producao`, chip PAUTA): pauta, roteiro e data de gravação. "Novo vídeo" cria nessa etapa;
  "Marcar como gravado" leva para `gravado` e daí em diante é o fluxo de hoje.
- Episódio de podcast com convidado continua nascendo em `gravado` a partir do convidado (nada muda no Pulso).

### Pauta e roteiro

- Objeto próprio, `pautas`: um documento por vídeo ou por participação de convidado, com `kind` **pauta** (temas e
  perguntas) ou **roteiro** (texto do vídeo). Um vídeo pode ter os dois.
- Conteúdo: texto no próprio sistema (editor rico que já existe) **ou** um link (Google Docs). Dono (quem escreve) e prazo.
- Estados e chips: **A fazer** (PAUTA, cinza) → **Em elaboração** (neutro, cores de GRAVADO) → **Enviada para
  aprovação** (AGENDADO, plum: está com gente de fora) → **Ajustes pedidos** (âmbar, com o recado em filete âmbar) →
  **Aprovada** (neutro, `.b-green`). Nada de lime em estado.
- Quem aprova está no WhatsApp. O sistema não manda nada sozinho: o botão **Copiar para o WhatsApp** copia o texto (ou
  o link) com o título e o prazo, e marca "Enviada" com data, hora e para quem ("Grupo Projeto 100"). A resposta é
  registrada por gestão ou produtora: **Aprovada** (quem aprovou, em texto) ou **Pediram ajustes** (o que pediram).
  Tudo fica no histórico da pauta.
- Onde aparece:
  - aba **Pauta** no vídeo (em Pré-produção ela é o próximo passo) e no cadastro do convidado a partir de "Em agendamento";
    quando o convidado vira episódio, a pauta acompanha;
  - **quadro de Pautas** (uma coluna por estado; cartão com tipo em mono, título do vídeo, dono e prazo) como visualização
    dentro de Episódios/Vídeos, para ver de uma vez em que pé está cada uma;
  - Início da produtora ("Seu dia"): pautas atrasadas e as que voltaram com ajustes.
- Vídeo em Pré-produção sem pauta aprovada pode ser marcado como gravado; a página avisa (`.notice`), não bloqueia.
- Permissões: `pautas.read` para todos (o editor lê o roteiro), `pautas.write` para superadmin, gestão e produtora.

### Convidados: pessoa e participação

- **Pessoa** (`people`): nome, e-mail, telefone, Instagram, empresa, cargo, bio, gênero/plural, foto, alcance. Uma só.
- **Participação**: a linha atual de `guests` (funil, tema, convite, datas, portal, plateia, episódio), agora com
  `person_id` e `project_id`. Uma pessoa tem no máximo uma participação aberta por projeto.
- As colunas de identidade continuam em `guests` como **cópia espelhada**: `services/people.js` grava na pessoa e em
  todas as participações dela na mesma transação. Assim as 158 consultas que leem `guests.name` etc. seguem funcionando
  e migram para a pessoa aos poucos.
- No cadastro do convidado: bloco **"Em outros projetos"** (projeto, etapa em chip, link) e o botão secundário
  **Convidar também para o Projeto 100**, que cria a participação em Prospecção com os dados da pessoa, sem digitar de novo.
  Quem não participa do outro projeto não vê esse bloco nem o botão.
- Nos quadros, um cartão por participação. Duplicatas passam a comparar **pessoas**; a mesma pessoa em dois projetos não
  é duplicata.

### Patrocinadores: empresa e contrato

- **Empresa** (`companies`): nome, site, contatos, tipo. Uma só.
- **Contrato**: a linha atual de `sponsors` (etapa, plano, valor, vigência, entregáveis, episódios, reuniões, portal,
  material), com `company_id` e `project_id`. Quem patrocina os dois projetos tem dois contratos, mesmo negociando junto.
  Mesma cópia espelhada das colunas da empresa.
- No patrocinador: "Em outros projetos" e **Abrir negociação também no Projeto 100**.
- Material da marca (logos, moldura, QR Code) fica no contrato, como hoje; a aba Material ganha **Trazer do outro
  projeto**, que copia os arquivos escolhidos (sem subir de novo).
- Planos de patrocínio (`sponsor_plans`) e media kit são por projeto.

### Dinheiro

- Todo lançamento tem dono: `fin_entries.project_id`, ou é **compartilhado**, com linhas em `fin_entry_splits`
  (`entry_id`, `project_id`, `amount_cents`) que somam o valor. Nunca os dois, nunca nenhum.
- Lançamento ligado a vídeo, convidado ou contrato herda o projeto sozinho (receita de patrocínio cai no projeto do
  contrato, sem escolha manual). Lançamento avulso: campo **De quem é** (Pulso | Projeto 100 | Compartilhado); em
  "Compartilhado" aparecem os valores por projeto, começando meio a meio.
- Recorrentes e regras de custo automático (`fin_recurring`, `fin_rules`) guardam o projeto ou a divisão padrão e a
  repassam ao que geram.
- **Banco de horas**: o pacote continua um só (`fin_hour_packs`). Cada compra é dividida em cotas
  (`fin_hour_quotas`: `pack_id`, `project_id`, `hours`, somando as horas do pacote); a despesa da compra é compartilhada
  na mesma proporção. Reserva e uso descontam da cota do projeto da gravação. O cartão mostra o total e uma linha por
  projeto ("Pulso · 6,5 de 10 h"). Projeto que passa da cota fica com saldo negativo e gera aviso ("Projeto 100 passou
  1,5 h da cota"); **Ajustar divisão** move horas (e o custo) entre os projetos. O pacote atual entra inteiro no Pulso
  e o dono ajusta para 10/10 pela tela (dinheiro não se mexe por migração).
- **Telas**: o Financeiro segue o seletor. Um projeto: só o que é dele mais a parte dele nos compartilhados (marcada
  "compartilhado · parte deste projeto"). Todos: consolidado, com a sigla em cada linha e "compartilhado · 50/50".
  Resultado por projeto = receitas − custos próprios − parte nos compartilhados.
- Estoque continua da casa; a compra de estoque gera lançamento com "De quem é".

### Quem vê o quê

Três perguntas separadas:

- **O que a pessoa faz**: o perfil de hoje (superadmin, gestão, produtora, editor de vídeo). Não muda.
- **Onde ela faz**: `project_members` (`project_id`, `user_id`, `finance`). Todo mundo tem linhas explícitas; quem está
  no sistema hoje entra no Pulso. Ao criar um projeto, a gestão marca quem trabalha nele.
- **Ela é da equipe da casa?** `users.house` (hoje, todos sim). Só a equipe da casa alcança o que é geral: usuários,
  integrações, categorias, rotinas, estoque, tarefas sem projeto, auditoria e lixeira completas, e a criação de projetos.
  Quem não é da casa perde essas permissões mesmo com perfil de gestão.

Financeiro: precisa do perfil com `finance.read` **e** do interruptor **Vê o financeiro** ligado naquele projeto
(`project_members.finance`). Um gestor do Projeto 100 é: perfil Gestão, fora da equipe da casa, membro só do Projeto 100,
com o financeiro ligado. Ele vê o financeiro do Projeto 100 e a parte do Projeto 100 nos custos compartilhados; nunca o
total do compartilhado nem nada do Pulso.

Tela: em Gestão > Equipe > Usuários, a janela do usuário ganha "Equipe da casa" (interruptor) e "Projetos" (uma linha por
projeto: participa, vê o financeiro). Em Gestão > Sistema > **Projetos**, cada projeto mostra os membros.

O que a pessoa de um projeto só **não** pode ver, em nenhum caminho: listas, quadros, páginas de detalhe, busca global,
notificações, calendário, resumo do dia e metas, assistente de IA, auditoria, lixeira, downloads e ZIPs, arquivos
servidos por chave, e a lista de pessoas do chat (ela só encontra quem divide um projeto com ela).
Página de detalhe de outro projeto responde 404.

**Trava de segurança**: nenhum usuário restrito é criado em produção antes de o teste de isolamento passar (ver Testes).
Até lá, todos continuam vendo tudo, como hoje.

### Identidade do painel: Health Scale

O painel deixa a identidade do Pulso e passa a usar a da casa. Fonte: `docs/referencias/Health_Scale_Studio_Logo.dc.html`
(estudo do designer) e `docs/referencias/health-scale/health-scale-logo.png`.

- **Nome**: `config.appName = 'Health Scale Studio'` substitui "Pulso Gestão" (título das páginas, login, manifesto do
  app, e-mails internos de acesso e senha, assistente, agenda do Google, Novidades). `config.podcastName` deixa de ser
  usado: o nome vem do projeto do item.
- **"Studio" não é "estúdio"**: no sistema, "estúdio" continua sendo o lugar da gravação (link do estúdio, banco de
  horas do estúdio). O nome do painel aparece sempre como "Health Scale Studio" ou "Studio" com maiúscula, nunca traduzido.
- **Assinatura** (login, relatórios, e-mails internos): logotipo Health Scale ("Health" em Instrument Serif itálico,
  "Scale" em Archivo 800) + filete vertical + **STUDIO** em JetBrains Mono 500, caixa alta, tracking .2em, na cor de
  ação. No claro: logotipo em preto e o nome em verde escuro.
- **Menu**: ícone de 40 px + duas linhas em mono ("HEALTH SCALE" 11 px muted; "STUDIO" 17 px). Recolhido: só o ícone.
  Item ativo: fundo `line` e um quadrado de 6 px na cor de ação.
- **Ícone** (favicon do painel, app instalado, menu, login): o **monograma "St"** do estudo (1a): "S" em Instrument
  Serif itálico, `#F4F4F0`, e "t" em Archivo 800 na cor de ação, sobre quadrado `#0E0F0D`. No SVG do favicon as letras
  viram contorno (o navegador não carrega fonte dentro do ícone).
- **Sinal** (1b, quatro barras que crescem do verde escuro ao claro) é o símbolo de apoio do painel, no lugar da linha
  de pulso, que é do Pulso:
  - **estado vazio** e página **Sem conexão**: as quatro barras baixas, em muted (`partials/pulse-line.ejs` dá lugar a
    `partials/signal.ejs` no painel; as páginas do Pulso continuam com a linha de pulso);
  - **login**: o Sinal grande e apagado no fundo, no lugar do campo de pontos do Pulso;
  - **"ao vivo"** do Resumo do dia e andamento de ação demorada (`data-busy`): as barras subindo em sequência a 1,2 s,
    paradas com movimento reduzido, no lugar do ponto lime que pulsa;
  - abertura do app instalado.
  Fora disso o Sinal não aparece: não vira decoração de cartão nem marcador de lista.
- **Cores do escuro** (do estudo): fundo `#0E0F0D`, superfície `#16180F`, borda `#262A22`, texto `#F4F4F0`, texto de
  apoio `#A8ABA1`, muted `#8A8D83`, **ação `#9EDD55`** (hover `#C8E86A`), texto sobre a ação `#0E0F0D`. `raised` e
  `line-strong` não estão no estudo: derivados da mesma família e conferidos por contraste (4,5:1 para texto) no navegador.
  O `#6E7168` do estudo não passa no contraste para texto e fica só para rótulo decorativo do próprio estudo.
- **Cores do claro**: fundo `#F4F4F0`, texto `#101210`, texto de apoio `#54574F`, borda `#C9C9C1`, verde `#2E6B22`
  para o nome e os links; botão principal preto.
- **Tipografia**: **Archivo** (400 a 800) assume títulos e texto, no lugar de Space Grotesk e Inter. JetBrains Mono
  continua nos dados; Instrument Serif itálico continua para "voz" e agora também assina o logotipo. Archivo fica
  hospedada no repositório (`src/public/fonts/`, woff2 latin, licença OFL), porque a CSP só aceita `'self'`.
- **O que continua**: as regras de uso (uma ação por área, dados em mono, sem emoji, ícones Lucide), só que a cor de
  ação passa a ser o verde. Âmbar, vermelho e a cor do "externo" (hoje plum) são funcionais e ficam como estão até
  existir um guia de interface da Health Scale. As formas dos componentes continuam as de hoje (botão em pílula, raios
  2/6/10): os cantos retos do estudo eram sugestão, não direção.
- **O que não muda**: tudo o que é do Pulso continua com a marca do Pulso: convite, portal do convidado, pós-gravação,
  media kit, portal do patrocinador, plateia, capas e e-mails ao convidado e ao patrocinador. Essas páginas têm CSS
  próprio (`portal.css`, `plateia.css`, `patrocinador.css`, `convite-pulso.html`, `media-kit.html`) e não dependem dos
  tokens do painel; a migração confere isso com um teste visual de cada uma, antes e depois.
- **Projeto 100**: a marca ainda está em estudo (azul e rosa, laço infinito). As páginas públicas dele esperam a
  definição (fase 9).
- **Documentos**: `docs/design-system.md` passa a descrever a interface Health Scale; `docs/manual-de-marca.md` vira o
  manual do **projeto Pulso**; a decisão vai para o `memory.md` e para o `CLAUDE.md`.
- **Tamanho do trabalho**: as cores do painel já são variáveis (`:root` do `app.css`, 27 cores escritas à mão no
  arquivo todo), o nome "pulso." aparece em 10 views e há 6 ícones do app. É uma troca de tokens, fontes, ícones e
  textos, não um redesenho de telas.

### Endereços: a gerência na casa, o que é público no projeto

Hoje tudo abre em `sistema.podcastpulso.com` (painel e links públicos) e os links curtos em `link.podcastpulso.com`.

- **Painel**: um endereço da casa (domínio da Health Scale, a definir). Login, sessão, app instalado e avisos vivem só
  nele.
- **Cada projeto tem o seu endereço público** (`projects.public_host`). O do Pulso é o de hoje,
  `sistema.podcastpulso.com`: **nenhum link já enviado muda ou quebra** (convites, portais, media kits, QR Code do cartão
  de agradecimento, links curtos). O Projeto 100 ganha o dele quando tiver domínio.
- **Como funciona**: todos os endereços chegam no mesmo sistema (um bloco por domínio no Caddy). Um passo novo logo na
  entrada (`middleware/hostContext.js`) olha o domínio e decide:
  - **domínio do painel**: tudo do painel. Um link público aberto ali é levado para o domínio do projeto dono do link;
  - **domínio de projeto**: só as páginas públicas (convite, portal do convidado, pós-gravação, media kit, portal do
    patrocinador, plateia, link do estúdio, formulários do site) e os avisos que as redes mandam para o sistema.
    Qualquer tela do painel aberta ali leva ao domínio do painel. Link de um projeto aberto no domínio de outro é
    levado ao domínio certo.
- **Favicon, título e imagem de compartilhamento por domínio**: `/favicon.ico`, o ícone do celular e a imagem que
  aparece no WhatsApp saem do projeto dono do domínio (`src/public/brand/<projeto>/`); no painel, o monograma "St".
  As páginas públicas passam a usar um cabeçalho comum (`partials/public-head.ejs`) que lê a marca do projeto.
- **Gerar link**: um lugar só, `publicUrl(projeto, caminho)`, no lugar de `config.publicBaseUrl` e dos usos públicos de
  `config.appBaseUrl`. Link para a equipe (aviso, e-mail interno) usa o endereço do painel.
- **Links curtos**: cada projeto com o seu encurtador (`link.podcastpulso.com` é do Pulso). Projeto sem encurtador usa
  o link inteiro. As chaves continuam em variáveis de ambiente, uma por projeto, nunca no banco.
- **E-mails para fora**: remetente do projeto (nome e endereço no domínio dele, autenticado no Brevo). E-mails da
  equipe saem como Health Scale Studio.
- **O que a troca do endereço do painel custa**: quem instalou o app no celular instala de novo e liga os alertas de
  novo (o navegador trata o endereço novo como outro app). O endereço antigo leva o login para o novo. O "Não sou
  robô" (Cloudflare) e os avisos das redes ganham os domínios novos na configuração.
- **Antes dessa fase** (já na fase 1): o favicon se separa por tipo de página, para o ícone novo do painel não aparecer
  no convite do Pulso. Páginas públicas ficam com o ícone do Pulso; o painel, com o "St".

## Dados (resumo)

- **Novas**: `projects` (`slug`, `name`, `sigla`, `video_label`, `video_label_plural`, `number_prefix`,
  `default_format`, `modules JSONB`, `public_host`, `short_link_host`, `mail_from_name`, `mail_from_address`, `active`,
  `position`), `project_members`, `people`, `companies`, `pautas`,
  `pauta_events`, `fin_entry_splits`, `fin_hour_quotas`.
- **`project_id NOT NULL`** nas raízes: `guests`, `sponsors`, `episodes`, `episode_clips`, `content_requests`,
  `social_ideas`, `sponsor_plans`, `invite_templates`, `plateia_events`, `pautas`. **Opcional** em `tasks`,
  `task_routines`, `user_goals`, `fin_entries`, `fin_recurring`, `fin_rules`, `audit_log`, `trash_items`.
- **Filhas herdam pela raiz** (arquivos, capas, comentários, publicações, cortes de um episódio): sem coluna nova.
- **Migração**: cria o projeto Pulso e preenche tudo o que existe com ele; cria uma pessoa por convidado e uma empresa
  por patrocinador; cria o Projeto 100 vazio. Nenhum dado some, nenhum número de episódio muda.
- `projects.modules` liga o que cada projeto usa (convites, portal, plateia, media kit, patrocínio, redes). O Projeto 100
  começa com produção, pauta, cortes, tarefas e financeiro; o resto liga quando precisar.

## Código (resumo)

- `services/projects.js`: lista, membros, projeto atual da pessoa.
- `services/scope.js`: o único lugar que decide o recorte. `req.scope = { ids, current, house, financeIds }`;
  `scope.filter(req, 't')` devolve o trecho SQL e os parâmetros para listas; `scope.assert(req, projectId)` nas páginas de
  detalhe (404). Consulta nova de lista sem `scope.filter` é erro de revisão.
- `permissions.js`: `can(user, permission)` passa a receber a pessoa; as permissões da casa ficam numa lista
  (`HOUSE_PERMISSIONS`) e exigem `user.house`.
- `services/people.js`, `services/companies.js`: gravação espelhada. `services/pautas.js`. `services/hourBank.js` e
  `services/finance.js` ganham projeto e divisão.

## Fases

Cada fase é um lançamento que funciona sozinho.

1. **Identidade Health Scale Studio.** Nome, logotipo, monograma, Sinal, cores e Archivo no painel; favicon separado
   entre painel e páginas públicas; design system reescrito; páginas do Pulso intactas. Não depende das outras fases.
2. **Fundação.** `projects`, `project_members`, `project_id` nas raízes (tudo vira Pulso), `services/scope.js`, seletor,
   sigla nos cartões, Gestão > Projetos, Projeto 100 criado. Ninguém restrito ainda.
3. **Vídeo e pauta.** Formato do vídeo, numeração por projeto, etapa Pré-produção, pautas e roteiros com o quadro.
   A partir daqui o Projeto 100 trabalha no sistema (vídeos, pauta, edição, cortes, pedidos, tarefas).
4. **Pessoas e empresas.** `people`, `companies`, "Em outros projetos", "Convidar também", contrato por projeto,
   duplicatas por pessoa.
5. **Dinheiro por projeto.** Dono do lançamento, compartilhado com divisão, cotas do banco de horas, resultado por
   projeto e consolidado.
6. **Endereços.** Painel no domínio da casa; links públicos, favicon, links curtos e remetente por projeto. Depende só
   da fase 2 e de o dono ter os domínios; pode subir na fila.
7. **Acesso por projeto.** Equipe da casa, membros, "Vê o financeiro", isolamento em todas as superfícies, teste de
   isolamento. Só depois entra a equipe do Dr. José Bento.
8. **Redes por projeto.** Contas e provedores por projeto (`social_account_status` e os perfis da Zernio/Outstand),
   publicar, agenda da semana, comentários, automações, insights e contexto da IA (nome, tom, links) por projeto.
9. **Marca do Projeto 100 nas páginas públicas.** Convite, portal, media kit e capas com a identidade dele (espera a
   marca ficar pronta).

As fases 8 e 9 podem subir se o Projeto 100 precisar publicar pelo sistema antes; até lá ele publica por fora.

## Testes

- **Isolamento** (`test/project-isolation.test.js`, trava da fase 7): dois projetos com um item de cada tipo e um texto
  marcador em cada; uma pessoa só do projeto B percorre todas as rotas GET registradas e nenhum marcador do projeto A
  pode aparecer; ids do projeto A respondem 404 em GET e POST; busca, notificações, assistente, downloads e arquivos por
  chave entram na lista. Rota nova entra no teste sozinha (ele lê a tabela de rotas do Express).
- Migração: banco com dados de hoje → tudo no Pulso, contagens iguais antes e depois, números de episódio intactos.
- Espelho: editar a pessoa atualiza todas as participações; editar pela participação atualiza a pessoa.
- Financeiro: lançamento com dono ou com divisão que soma o valor (nunca os dois); herança pelo vínculo; soma dos
  projetos = consolidado; cota, uso e saldo do banco por projeto; quem é de um projeto vê só a parte dele.
- Numeração: dois projetos com `number = 1` convivem; corrida de criação continua resolvida por projeto.
- Quem tem um projeto só: nenhuma tela mostra seletor, sigla ou campo de projeto.
- Endereços: no domínio de um projeto, toda rota do painel leva ao domínio do painel e nenhuma responde com tela
  interna; link público aberto no domínio errado é levado ao certo; todo link antigo do Pulso
  (`sistema.podcastpulso.com/convite/…`, portal, media kit, `/pos-gravacao`) responde como antes; `/favicon.ico` e a
  imagem de compartilhamento mudam com o domínio; a sessão do painel não vale em domínio de projeto.
- Identidade: nenhuma cor escrita à mão fora dos tokens no `app.css`; contraste dos tokens novos (texto 4,5:1) conferido;
  convite, portal, pós-gravação, media kit, portal do patrocinador e plateia iguais antes e depois (captura de tela de
  cada uma, no computador e no celular); nenhum "Pulso Gestão" sobrando no painel.

## Riscos

- **Vazamento entre projetos** é o risco maior, porque há centenas de consultas. Mitigação: um ponto único de recorte,
  filhas herdando pela raiz, o teste de isolamento como trava, e usuários restritos só na fase 7.
- **Pessoa e funil na mesma linha** (`guests`, 158 consultas em 58 arquivos): a cópia espelhada evita reescrever tudo
  de uma vez; o custo é manter o espelho coberto por teste.
- **Nome "Pulso" escrito à mão** em prompts de IA e textos: some por fase, junto com a área que ele toca; a busca por
  "Pulso" no `src/` é o critério de pronto da fase 8.
- **Tamanho**: é o maior trabalho já feito no sistema. Por isso as fases são independentes e nenhuma muda o dia a dia do
  Pulso além do seletor.

## Fora do escopo

- Painel diferente por projeto (o painel é um só, da casa; só o que é público muda de domínio e de marca).
- Páginas públicas do Pulso em `podcastpulso.com/convite/…` (sem o "sistema."): possível depois, com o endereço de hoje
  continuando a valer.
- Aprovação da pauta por gente de fora dentro do sistema (link público com botão de aprovar).
- Perfis diferentes por projeto para a mesma pessoa (o perfil é um; os projetos dizem onde ele vale).
- Faturamento entre projetos ou contabilidade por competência.

## Em aberto (do dono)

- **Domínio do painel**: qual endereço da Health Scale o painel usa (ex.: `studio.` + o domínio da casa)? Até decidir,
  o painel continua em `sistema.podcastpulso.com`, já com a identidade nova.
- **Domínio do Projeto 100**: qual será, quando houver.
- **Custo do banco de horas**: adotado pela **cota** (10/10, ajustável quando um projeto usa horas do outro). A
  alternativa é cobrar pelo uso real.
- **Sigla e prefixo do Projeto 100**: adotados `P100` e `V.` até segunda ordem.
