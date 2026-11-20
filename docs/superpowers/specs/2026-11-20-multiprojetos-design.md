# Multiprojetos (Health Scale Manager) — desenho

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
- **Nome do painel: Health Scale Manager** ("manager" como submarca da Health Scale). "Pulso" passa a ser o nome de um projeto.
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

### Nome e marca do painel

- `config.appName = 'Health Scale Manager'` substitui "Pulso Gestão" (título das páginas, login, manifesto do app,
  e-mails internos de acesso e senha, assistente, agenda do Google, Novidades).
- No menu: "Health Scale" em Space Grotesk e **MANAGER** em mono caixa alta, muted. Recolhido: "hs". O Ponto lime é do
  Pulso e sai do nome do painel; os tokens da interface (escuro, lime como ação) continuam.
- O manual de marca do Pulso passa a valer para o **projeto Pulso** (convite, portal, media kit, plateia, e-mails ao
  convidado e ao patrocinador). `docs/design-system.md` e `docs/manual-de-marca.md` registram a mudança, e a decisão
  vai para o `memory.md`.
- `config.podcastName` deixa de ser usado: o nome vem do projeto do item.

## Dados (resumo)

- **Novas**: `projects` (`slug`, `name`, `sigla`, `video_label`, `video_label_plural`, `number_prefix`,
  `default_format`, `modules JSONB`, `active`, `position`), `project_members`, `people`, `companies`, `pautas`,
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

1. **Fundação.** `projects`, `project_members`, `project_id` nas raízes (tudo vira Pulso), `services/scope.js`, seletor,
   sigla nos cartões, Gestão > Projetos, nome Health Scale Manager, Projeto 100 criado. Ninguém restrito ainda.
2. **Vídeo e pauta.** Formato do vídeo, numeração por projeto, etapa Pré-produção, pautas e roteiros com o quadro.
   A partir daqui o Projeto 100 trabalha no sistema (vídeos, pauta, edição, cortes, pedidos, tarefas).
3. **Pessoas e empresas.** `people`, `companies`, "Em outros projetos", "Convidar também", contrato por projeto,
   duplicatas por pessoa.
4. **Dinheiro por projeto.** Dono do lançamento, compartilhado com divisão, cotas do banco de horas, resultado por
   projeto e consolidado.
5. **Acesso por projeto.** Equipe da casa, membros, "Vê o financeiro", isolamento em todas as superfícies, teste de
   isolamento. Só depois entra a equipe do Dr. José Bento.
6. **Redes por projeto.** Contas e provedores por projeto (`social_account_status` e os perfis da Zernio/Outstand),
   publicar, agenda da semana, comentários, automações, insights e contexto da IA (nome, tom, links) por projeto.
7. **Marca por projeto nas páginas públicas.** Convite, portal, media kit e capas com a identidade do Projeto 100
   (precisa do guia visual dele).

A ordem 6 e 7 pode subir se o Projeto 100 precisar publicar pelo sistema antes; até lá ele publica por fora.

## Testes

- **Isolamento** (`test/project-isolation.test.js`, trava da fase 5): dois projetos com um item de cada tipo e um texto
  marcador em cada; uma pessoa só do projeto B percorre todas as rotas GET registradas e nenhum marcador do projeto A
  pode aparecer; ids do projeto A respondem 404 em GET e POST; busca, notificações, assistente, downloads e arquivos por
  chave entram na lista. Rota nova entra no teste sozinha (ele lê a tabela de rotas do Express).
- Migração: banco com dados de hoje → tudo no Pulso, contagens iguais antes e depois, números de episódio intactos.
- Espelho: editar a pessoa atualiza todas as participações; editar pela participação atualiza a pessoa.
- Financeiro: lançamento com dono ou com divisão que soma o valor (nunca os dois); herança pelo vínculo; soma dos
  projetos = consolidado; cota, uso e saldo do banco por projeto; quem é de um projeto vê só a parte dele.
- Numeração: dois projetos com `number = 1` convivem; corrida de criação continua resolvida por projeto.
- Quem tem um projeto só: nenhuma tela mostra seletor, sigla ou campo de projeto.

## Riscos

- **Vazamento entre projetos** é o risco maior, porque há centenas de consultas. Mitigação: um ponto único de recorte,
  filhas herdando pela raiz, o teste de isolamento como trava, e usuários restritos só na fase 5.
- **Pessoa e funil na mesma linha** (`guests`, 158 consultas em 58 arquivos): a cópia espelhada evita reescrever tudo
  de uma vez; o custo é manter o espelho coberto por teste.
- **Nome "Pulso" escrito à mão** em prompts de IA e textos: some por fase, junto com a área que ele toca; a busca por
  "Pulso" no `src/` é o critério de pronto da fase 6.
- **Tamanho**: é o maior trabalho já feito no sistema. Por isso as fases são independentes e nenhuma muda o dia a dia do
  Pulso além do seletor.

## Fora do escopo

- Marca, domínio e painel diferentes por projeto (o painel é um só, da casa).
- Aprovação da pauta por gente de fora dentro do sistema (link público com botão de aprovar).
- Perfis diferentes por projeto para a mesma pessoa (o perfil é um; os projetos dizem onde ele vale).
- Faturamento entre projetos ou contabilidade por competência.

## Em aberto (do dono)

- **Marca da Health Scale**: logotipo e cores, se houver. Até chegarem, o nome vai só em tipografia, como descrito.
- **Endereço**: continua `sistema.podcastpulso.com` ou muda? (Trocar exige domínio novo e redirecionamento; fica fora
  das fases até decidir.)
- **Custo do banco de horas**: adotado pela **cota** (10/10, ajustável quando um projeto usa horas do outro). A
  alternativa é cobrar pelo uso real.
- **Sigla e prefixo do Projeto 100**: adotados `P100` e `V.` até segunda ordem.
