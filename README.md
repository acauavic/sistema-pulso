# 🎙️ Pulso Gestão — gestão do podcast

Painel web para a equipe do **Podcast Pulso**: usuários com perfis de acesso, um mini-CRM de
**convidados** (quadro estilo Kanban) e geração do **link do convite** (página personalizada +
link curto no YOURLS + envio por e-mail via Brevo).

> Sistema próprio (não tem relação com o agente da clínica): `package.json`, banco e container
> próprios. Pode compartilhar o servidor Postgres da VPS, mas usa um banco separado.

## Índice

- [O que tem](#o-que-tem)
- [Perfis e permissões](#perfis-e-permissões)
- [Como o convite funciona](#como-o-convite-funciona)
- [Rodando localmente](#rodando-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Testes](#testes)
- [Deploy (Docker Swarm + Traefik)](#deploy-docker-swarm--traefik)
- [Convite fixo e rastreio de cliques](#convite-fixo-e-rastreio-de-cliques)
- [Importação por CSV](#importação-por-csv)
- [Central de patrocinadores](#central-de-patrocinadores)
- [Produção de episódios](#produção-de-episódios)
- [Pulso Podcast com Plateia](#pulso-podcast-com-plateia)
- [Financeiro: contas, custos automáticos e estoque](#financeiro-contas-custos-automáticos-e-estoque)
- [Social: publicações, novo post, ideias, insights e automações](#social-publicações-novo-post-ideias-insights-e-automações)
- [Colaboração: tarefas, comentários, notificações e busca](#colaboração-tarefas-comentários-notificações-e-busca)
- [Arquitetura: processos, fila, rotinas e avisos](#arquitetura-processos-fila-rotinas-e-avisos)
- [Assistente de IA](#assistente-de-ia)
- [Segurança](#segurança)
- [Identidade visual](#identidade-visual)
- [Estrutura do código](#estrutura-do-código)

## O que tem

- **Login** com e-mail/senha, sessão em cookie `HttpOnly`, "esqueci minha senha" por e-mail.
- **Usuários (CRUD completo)**: criar (a pessoa recebe e-mail para definir a própria senha), editar
  nome/e-mail/perfil, desativar/reativar (derruba as sessões na hora), reenviar acesso, excluir
  (só superadmin), busca e filtros. Travas: ninguém muda o próprio perfil, desativa ou exclui a si
  mesmo; sempre sobra um superadmin ativo; só superadmin mexe em superadmin.
- **Convidados (CRM)**: quadro com arrastar-e-soltar entre etapas (Prospecção → Convite enviado →
  Em agendamento → Agendado → Gravado → Publicado, mais Perdido/Cancelado), visão em lista, filtros por
  responsável, linha do tempo com anotações e histórico automático. [Cadastro e regras](#etapas-do-convidado-e-regras-para-avançar).
- **Importação por CSV**: planilha com nome, Instagram e perfil (+ opcionais), com prévia de erros e duplicados.
- **Central de patrocinadores**: CRM em quadro (Prospecção → Em negociação → Ganho → Ativo, mais Inativo/Perdido), media kit, formulário de cadastro com voz e portal do patrocinador, tudo por **magic link reutilizável** (sem criar conta). [Detalhes](#central-de-patrocinadores).
- **Episódios (linha de produção)**: do convidado agendado até a publicação — material bruto no Backblaze, edição, revisão com comentários na minutagem, análise por IA, capas e posts com editor visual, cortes verticais e publicação nas redes. [Detalhes](#produção-de-episódios).
- **Convite fixo**: gera link exclusivo + link curto no YOURLS, prévia, envio por e-mail (Brevo). Os botões do
  convite levam ao WhatsApp da produção **passando por um redirecionador próprio que conta os cliques**.
- **Calendário**: tudo que tem data (tarefas, gravações, lembretes, publicações, contas, parcerias) com filtros e visualizações salvas. [Detalhes](#calendário).
- **Auditoria** das ações sensíveis e tela de **Integrações** (status + testes seguros).

## Perfis e permissões

Quatro perfis: **Superadmin**, **Gestão**, **Produtora**, **Editor de Vídeo**.

⚠️ **A matriz abaixo é PROVISÓRIA** (rascunho até definirmos os poderes de cada perfil).
Para mudar, edite só `src/permissions.js` — todas as telas e rotas consultam esse arquivo.

- **Superadmin**: tudo, inclusive excluir usuários e gerenciar outros superadmins.
- **Gestão**: usuários (exceto superadmin, sem excluir), convidados (inclusive excluir), auditoria, integrações e o **Financeiro**.
- **Produtora**: convidados (criar/editar, importar CSV, gerar e enviar convite) e o **Estoque** (sem valores).
- **Editor de Vídeo**: somente leitura em convidados.

## Etapas do convidado e regras para avançar

**Convidado é a pessoa; episódio é o produto.** O funil do convidado vai de Prospecção até **Gravado** (o fim dele). Antes da
gravação existe só a **agenda**: convidados em Agendado, com a data confirmada, aparecem no **media kit** ("Quem já está na agenda",
agrupado por mês) e podem ser **reservados por patrocinadores** (aparecem no portal deles). Quando a conversa é gravada, **nasce o
episódio** (com as tarefas das rotinas e a data da gravação) e as reservas viram vínculo do episódio. O que se publica é o episódio.

Convidado de episódio patrocinado: pode ser **alguém do patrocinador** ou **alguém indicado por ele** (campo "Ligado a um
patrocinador" no cadastro; a gravação já fica reservada para o patrocinador). Episódio só com os hosts é registrado direto pelo
patrocinador (ver Episódios).

Cadastro inicial (mínimo): **nome, Instagram e perfil** (médico, influencer, empresário ou profissional da saúde).
Opcionais na criação: WhatsApp, e-mail e motivo do convite. O resto se completa depois.

- **Em agendamento** exige **e-mail e/ou WhatsApp**.
- **Agendado** exige **data e hora da gravação** + confirmação de agenda no **Estúdio**, com os **hosts** e com o **convidado**.
- **Em agendamento** e **Agendado** exigem a **foto do convidado** (ela vai para a agenda da plateia e para os patrocinadores). Se só falta a foto, abre a janela "Foto do convidado" (`?abrir=foto&para=<etapa>`); depois do envio a mudança de etapa termina sozinha. No formulário, o resto é salvo e a etapa espera a foto; cadastro novo direto nessas etapas entra em Convite enviado até a foto. Exceções: quem aceita pelo convite público e a importação por CSV (a foto vem depois). Precisa do Backblaze configurado.
- **Foto do convidado, moldura única 4:3**: ao enviar (ou trocar) a foto, abre o **recorte** (`src/public/cropper.js`): arraste, aproxime (mouse, toque, teclado) e veja a prévia nos três tamanhos em que ela aparece. O que sobe é um **JPEG 1200×900** já enquadrado, então a mesma imagem serve a todos os lugares: página da plateia, **agenda do media kit** (no lugar do círculo "Foto"), **calendário e lista de convidados do portal do patrocinador** e o painel (`.guest-photo`). Aceita originais de até 40 MB (o recorte reduz); avisa quando a foto é pequena para a moldura. Foto com a moldura em `src/services/guestPhotos.js` (`FRAME`). O original não é guardado: para reenquadrar, envie de novo.
  - Media kit e portal recebem a foto por **endereço assinado e com validade de 24 h** (`GET /agenda/foto/:id?e=…&s=…`, HMAC com o segredo de sessão), porque o kit roda isolado e sem cookie; o servidor só assina o endereço de quem ele mesmo decidiu mostrar naquela página. Sem foto, o kit mantém o espaço "Foto" e o portal mostra as iniciais.
- **Edição em massa** (Convidados > Lista, só `guests.write`): marque os convidados e use "Editar em massa" para mudar **etapa, responsável, perfil, gênero e patrocinador** (campo em branco = não alterar; patrocinador pede ainda "indicados" ou "pessoas do patrocinador"). Código em `src/services/guestBulk.js`. Cada convidado passa pelas regras de uma edição individual: quem não tem o que a etapa exige (foto, contato, motivo da perda) **não muda de etapa** e aparece no resultado; o resto da mudança vale. **Agendado e Gravado não vão em massa** (pedem a agenda e criam episódio). Perdido pede o motivo para todos. Máximo de 200 por vez; cada convidado ganha uma linha no histórico e a ação vai para a auditoria; quem ganha convidados recebe um aviso só.
- **Zerar aceite** (aba Convite do convidado): apaga o contador de cliques em "Aceitar", a resposta e o recado, e devolve o convidado para **Prospecção** (o link do convite continua o mesmo). Vale para Convite enviado, Em agendamento, Perdido e Cancelado; quem já está Agendado ou Gravado não passa (cancele a gravação antes). Fica no histórico e na auditoria (`convidado.aceite_zerado`).
- **Perdido** exige o **motivo da perda**: Recusado, Sem agenda próxima, Nunca respondeu, Parou de responder, Conflito de interesse ou Outros (com descrição). O banco não aceita Perdido sem motivo, e sair de Perdido apaga o motivo antigo. O cartão do quadro mostra o motivo.
- Prospecção, Convite enviado, Gravado e Cancelado não exigem nada. (Os links do YouTube e do Spotify são do episódio.)

As regras valem no formulário, no seletor "Mover de etapa" e ao arrastar no quadro. Regras em `src/services/guestRules.js`.

**A página do convidado guia o próximo passo.** No topo ficam o passo a passo do funil e um cartão **Próximo passo**
que mostra só o que importa na etapa atual, com um botão principal:

- **Prospecção**: gerar o link do convite → enviar por e-mail (janela com assunto e mensagem) ou copiar para o WhatsApp.
- **Convite enviado**: quando foi enviado e aberto; **Aceitou o convite** (se não houver contato, uma janela pede e-mail ou WhatsApp), reenviar e **Marcar como perdido** (janela com o motivo).
- **Em agendamento**: **Definir data da gravação** abre uma janela com a data e a confirmação com **estúdio, hosts e convidado**.
  Com as três, vai para Agendado (e o episódio nasce); sem elas, a data fica salva como proposta e o cartão mostra quem falta.
- **Agendado**: a data em destaque com a contagem ("em 5 dias"), link do episódio, **Marcar como gravado**, **Remarcar**
  (nova data pede nova confirmação; sem as três, volta para Em agendamento e a linha do tempo registra a remarcação) e cancelar.
- **Gravado** (fim do convidado): a etapa do episódio e o link para ele; quando o episódio vai ao ar, os links. **Perdido** (com o motivo) e **Cancelado**: retomar contato.

O resto fica em abas (**Resumo** com dados preenchidos, comentários e tarefas; **Convite** com link, cliques e prévia; **Histórico**).
Mudar a etapa à mão e excluir ficam em "Outras ações". Os botões passam por `POST /convidados/:id/avancar`, que salva só os
campos da janela e move a etapa se as regras deixarem. Arrastar para uma etapa que exige dados abre a página do convidado já
com a janela certa (`?abrir=contato|agenda|publicacao`).

No **formulário**, os campos aparecem conforme a etapa (data da gravação a partir de Em agendamento; links em Publicado) e
"Sobre o convidado" e a etapa ficam recolhidos. **Ao preencher ou mudar a data da gravação, abre a janela de confirmação**
(estúdio, hosts, convidado); confirmando as três, a etapa passa para Agendado ao salvar.

## Convite fixo e rastreio de cliques

1. Cadastre o convidado e use **Gerar link do convite**: cria um token secreto e imprevisível e a página
   `…/convite/<token>`, e encurta no YOURLS com o nome curto do convidado
   (`link.podcastpulso.com/maria`; se ocupado, `mariasouza`, depois `maria-x7k2`).
   Se o YOURLS estiver fora, o link completo continua valendo.
2. Envie pelo **e-mail** (botão no próprio card) ou copie o link curto e mande pelo WhatsApp.
3. A página do convite é **sempre a mesma** (`src/templates/convite-pulso.html`); o sistema só injeta nome, gênero e dupla.
   Ao abrir, registra "convidado abriu o convite" (ignora robôs de pré-visualização do WhatsApp/Facebook).
4. Botões **Aceitar o convite** e **Confirmar presença** apontam para `/convite/<token>/aceitar`: o sistema conta o clique,
   muda o convidado para **Em agendamento**, avisa o responsável por e-mail e mostra a página
   "Convite aceito, te levando para o WhatsApp…", que redireciona em 3 s para o WhatsApp da produção com mensagem pronta.
5. **Falar com a produção** aponta para `/convite/<token>/producao`: conta o clique e redireciona direto.
6. Quem não puder participar usa o formulário "Não vai poder participar?" (recado opcional): etapa **Perdido** com motivo **Recusado** (o convidado não escolhe motivo; o recado fica como descrição) e aviso ao responsável.
7. **Gerar novo link** invalida o anterior (o token antigo passa a dar 404).

**Por que o rastreio é interno e não o YOURLS:** o YOURLS só conta cliques que passam por ele e não sabe quem clicou;
aqui cada clique já fica ligado ao convidado (tabela `invite_clicks` + linha do tempo + contagem no detalhe) e o botão
de aceitar não depende de um serviço externo. O YOURLS segue só encurtando o link do convite.
Robôs de pré-visualização (WhatsApp, Facebook, Slack…) seguem o redirecionamento sem contar clique nem mudar etapa.
O número da produção vem de `PRODUCAO_WHATSAPP`.

## Importação por CSV

**Convidados → Importar CSV** (baixe o modelo na própria tela). Colunas: `nome`, `instagram`, `perfil` (obrigatórias) e
`whatsapp`, `email`, `motivo do convite`, `genero`, `status` e `data da gravação` (opcionais; gênero padrão masculino). Aceita `;` `,` ou tab, aspas e UTF-8
com/sem BOM, até 500 linhas. O perfil aceita variações (médica, influenciador, empresária, profissional de saúde…).
**Status** (ou `etapa`): Prospecção (padrão), Convite enviado, Em agendamento (pede e-mail ou WhatsApp), Agendado, Gravado, Publicado, Perdido (pede a coluna `motivo da perda`; texto livre vira Outros; status "Recusou" já entra como Perdido/Recusado) ou Cancelado.
**Data da gravação**: `25/11/2026 14:30` no horário de Brasília (a hora pode vir numa coluna `hora`). **Agendado** exige data e hora futuras
e entra com estúdio, hosts e convidado confirmados (aparece na agenda e avisa a equipe). **Gravado** e **Publicado** trazem o histórico: pedem a data da gravação (só o dia basta, não pode ser futura) e criam o episódio já na etapa (Gravado ou Publicado), **sem tarefas, custos automáticos nem avisos**. Opcionais: `episódio` (número; sem ele, continua a numeração na ordem das datas de gravação; número já usado vira duplicado), `youtube`, `spotify` e `publicado em`.
Primeiro mostra uma **prévia** (pronto / erro / duplicado — Instagram ou e-mail já cadastrado ou repetido no arquivo);
ao confirmar, só as linhas prontas viram convidados, com você como responsável. Colunas extras: `observações` (vai para as observações do convidado) e `título do episódio` (histórico).
Pelo terminal (mesmas regras, prévia sem `--gravar`): `node src/scripts/importGuests.js arquivo.csv email@quem.importa [--gravar]` (no servidor: `docker compose exec -T web node src/scripts/importGuests.js - email --gravar < arquivo.csv`).

## Central de patrocinadores

**Menu Patrocinadores** (quadro e lista).

- **Cadastro**: empresa, site, tipo (marca pessoal ou negócio), cota (Ouro ou Diamond), valor (R$), responsável **na empresa** (nome, WhatsApp, e-mail), quem cuida na nossa equipe, pagamento, vigência.
- **Regras de etapa** (`src/services/sponsors.js`, valem no formulário, no seletor e ao arrastar): **Ganho** exige cota, valor, nome do responsável e e-mail e/ou WhatsApp; **Ativo** exige cota, valor e a data do pagamento. Se faltar algo, a página do patrocinador abre a janela que pede só esses dados (`?abrir=ganho|ativo`).
- **Página guiada**: passo a passo (Prospecção → Em negociação → Ganho → Ativo) e cartão **Próximo passo** por etapa: gerar links e copiar o media kit; **Fechou** (janela com cota, valor e responsável); em Ganho, o andamento do formulário, o link do formulário e **Pagamento confirmado** (janela com data do pagamento e vigência); em Ativo, a vigência, o portal e as entregas. Abas: Resumo, Briefing, Entregas (só depois de Ganho), Links e Histórico. Os botões usam `POST /patrocinadores/:id/avancar`.
- **Magic link reutilizável**: **Gerar links** cria um token por patrocinador. Abrir `/patrocinador/<token>` (media kit), `/patrocinador/<token>/cadastro` ou `/patrocinador/<token>/portal` cria uma **sessão** (cookie `pulso_sp`, HttpOnly, 30 dias) e redireciona para uma URL limpa (`/patrocinador/kit|cadastro|portal`), sem o token. O link vale quantas vezes for aberto, em qualquer aparelho, até a equipe **gerar novos links** (isso derruba todos os acessos abertos). Ações do patrocinador usam token CSRF da sessão. Robôs de pré-visualização não ganham sessão.
- **Media kit** (`src/templates/media-kit.html`, o deck do Pulso): "Quero ser patrocinador" conta o clique, leva de Prospecção para Em negociação, avisa a equipe e abre o WhatsApp comercial (`PATROCINIO_WHATSAPP`); "Falar com a equipe" conta e redireciona.
- **Formulário de cadastro em etapas** (a partir de Ganho): **uma pergunta por vez**, com uma barra de etapas no topo (respondida = preto, **pendente = listrado âmbar**, por responder = branco) e um resumo no fim. Cinco perguntas (logo, página, oferta, apresentação, destaques) têm **"Responder depois"**: viram **pendência**, guardada no link; quatro aceitam **"não se aplica"** (página, oferta, restrições, slogan), que conta como respondida. Cada resposta é salva na hora (`/patrocinador/resposta`); ao voltar pelo mesmo link o formulário abre na primeira pergunta ainda em aberto. A equipe vê o andamento (8 segmentos), as pendências e um selo "N pendências" no quadro, e é avisada (uma vez por situação) quando ele fecha o formulário. O formulário só conta como **respondido** quando as 8 perguntas estão respondidas. Sem JavaScript, a página inteira continua enviável. Conteúdo das perguntas: logo em PNG (avisa se não tiver transparência), página de divulgação e brinde, oferta/ação especial, apresentação da empresa, pontos de destaque, restrições, slogan e objetivo. As 4 perguntas de texto corrido têm **resposta por voz**: o navegador grava, o servidor guarda o áudio e transcreve com **Whisper large-v3 (Groq)**, e a pessoa revisa/edita o texto antes de enviar. O patrocinador pode voltar e editar; a equipe também edita em **Editar briefing**. O áudio e a transcrição original ficam no cadastro.
- **Gravações e episódios**: em Entregas, o patrocinador **reserva gravações marcadas** da agenda (inserção ou exclusivo) e marca os **episódios gravados**. Na gravação, a reserva vira vínculo do episódio. **Convidados do patrocínio** (da empresa ou indicados) ficam no Resumo, com o botão **Indicar convidado**; "Registrar episódio gravado só com os hosts" abre o cadastro de episódio já com o patrocinador.
- **Patrocínio ativo**: confira os episódios, cadastre **entregáveis** (episódio exclusivo, inserções, cortes exclusivos, cortes com participação, moldura, QR Code, presença nas plataformas; cada um com quantidade, status, link e observação) e envie **moldura** e **QR Code** (vão para o portal). O **portal** (`/patrocinador/portal`, só em Ativo/Inativo) reproduz o portal original: entregas, episódio exclusivo, calendário (gravações reservadas como "Gravação marcada" + episódios), bios dos convidados, moldura e QR Code. Não tem JavaScript.
- **Planos de patrocínio** (Gestão > Planos de patrocínio, `src/services/plans.js`): só **Ouro e Diamond**. A gestão edita **nome, valor, textos e entregáveis** (e, no Diamond, as opções "escolha 1 de N" e se inclui tudo do Ouro). Isso gera, direto do banco, os slides **Ouro**, **Diamond** e o **comparativo** do media kit, o nome da cota e as **entregas do portal** (com descrição) e os entregáveis de cada patrocinador. Ao mudar o plano, todo patrocinador da cota acompanha (entregável novo chega na hora; retirar tira de todos). Na página do patrocinador (aba Entregas) cada entregável do plano pode ser **personalizado só para ele** (nome, descrição, quantidade; "voltar ao padrão do plano" desfaz), dá para **criar entregáveis só dele** e **reaplicar o plano**. Trocar a cota troca os entregáveis do plano e mantém os personalizados. Na mesma tela há a regra **"Episódio exclusivo não recebe inserção"** (ligada por padrão, `app_settings.block_insertion_in_exclusive`): episódio que é entrega de um patrocinador não aceita inserção de outro, nem pelo episódio nem pela página do patrocinador.
- **Arquivos** ficam num bucket **privado** do Backblaze B2 (API S3, assinatura SigV4 própria em `src/services/b2.js`); nada é público, tudo passa pelo servidor. A chave pode ter **restrição de prefixo** (o sistema usa o prefixo da própria chave, ex.: `pp/patrocinadores/<id>/…`).
- **Ainda não feito**: etapa de **aprovação da moldura e do QR Code pelo patrocinador** e integração por WhatsApp (o modelo de dados comporta, é o próximo passo).

## Produção de episódios

**Menu Episódios**: quadro por etapa e lista. A tela do episódio é organizada em **abas por etapa** — *Resumo* (dados, observações, patrocinadores, tarefas em janela), *Material* (bruto e vídeo editado: depois de enviados viram lista com "Baixar" e o envio fica recolhido), *Revisão* (**só enquanto o episódio está em revisão**; depois os comentários vão para o histórico e o editor vê só os "ajustes pedidos"), *Finalização* (IA, thumbnail, YouTube) e *Histórico*. O episódio **nasce gravado**: quando o convidado vai para **Gravado**, ou pelo botão **Registrar episódio gravado** (quem sentou à mesa: convidado do CRM, convidado novo cadastrado ali, ou **só os hosts** — aí o patrocinador é obrigatório e pode ser cadastrado ali também). Funil: Gravado → Disponível para edição → Em edição → Em revisão → Em finalização → Pronto para publicar → Publicado. Cada passo tem trava (ver o botão "Próximo passo" no episódio).

- **Papéis** (matriz provisória em `src/permissions.js`): produtora sobe o material bruto; editor de vídeo assume a edição, envia o vídeo editado e mexe em capas; gestão revisa, aprova, finaliza, publica. Superadmin faz tudo.
- **Material bruto e vídeo editado** (Backblaze B2 privado): envio em **partes de 16 MB** pelo servidor (sem CORS), com retomada de parte e verificação; download e player por **link assinado**. O editor vê patrocinadores do episódio (moldura, QR Code, restrições) e as observações da gestão.
- **Checklists padronizados**: modelos editáveis; itens obrigatórios travam "enviar para revisão" e "finalizar". Editor e gestão marcam.
- **Tarefas automáticas** (cortes, bastidores, extra) e **revisão com player**: comentários presos ao segundo do vídeo, resolvidos um a um; "pedir ajustes" volta para edição (contador de revisões).
- **Análise por IA** (ao aprovar para **Em finalização**, em segundo plano — fila no Postgres, roda no processo `worker`): FFmpeg extrai áudio e quadros → **Groq Whisper large-v3** transcreve com tempos → **Gemini** (`GEMINI_MODEL`, padrão `gemini-3.8-flash`) lê os quadros (rostos, legenda queimada, nitidez) e escreve 3 títulos, 3 textos de thumbnail, descrições do YouTube e Spotify, capítulos, tags, frases fortes e momentos para cortes, no tom da marca. **Tudo é validado contra os limites das plataformas** (`src/services/platformLimits.js`: YouTube título 100 / descrição 5000 bytes / tags 500 / thumbnail 1280×720 ≤ 2 MB; Instagram e TikTok 2200; Spotify) e a equipe edita antes de salvar. A IA só preenche o que está vazio.
- **Capas e posts** (`src/public/design/engine.js`, o mesmo motor no servidor com `@napi-rs/canvas` e no navegador): 3 thumbnails, posts de frase, **tela dividida** e **carrossel** (preto → plum → bone). Regras: **nenhum texto sobre rosto**, nem sobre legenda queimada (a legenda é evitada, cortada fora ou **escondida por uma faixa escura**), dentro das zonas seguras de cada formato (Reels/TikTok: topo 300 px e base 300 px; grade do Instagram em 3:4), quebra de linha editorial (sem palavra pendurada nem linha órfã), contraste conferido e wordmark `pulso.` com o ponto lime. Cada capa tem uma **conferência** (problemas e avisos) e um **editor visual** simples: arrastar e redimensionar texto, fonte, cor, trocar o quadro de fundo **ou enviar uma imagem sua** (a IA tenta achar os rostos; sem isso o editor avisa que não foi conferida), zonas desenhadas por cima (zona segura, rostos, legendas, recorte do feed), desfazer e salvar. A thumbnail **aprovada** é exigida para finalizar.
- **Conteúdo** (menu próprio, fora do card do episódio): **cortes**, **posts de frase, tela dividida e carrosséis**. O episódio só mostra um resumo e o link. O **editor sobe vários cortes de uma vez** (envio em partes, direto para o Backblaze); o sistema **lê cada vídeo** (formato, duração, fala com Groq, quadros e rostos com Gemini), dá o nome interno **Corte N** e sugere **título, legenda com hashtags e 3 capas**. Depois o corte é **atribuído a um episódio** (todo episódio já nasce gravado); ao atribuir, as capas são refeitas com o convidado e o número do episódio. Corte horizontal é aceito, com aviso (Reels/TikTok/Shorts pedem vertical). Os momentos que a IA achou no episódio aparecem só como **dica** do que cortar; nada é cortado sozinho. Sem a leitura de rostos da IA, o corte fica pronto e as capas esperam ("Ler de novo").
- **Vídeo do episódio é horizontal**: o vídeo editado só é aceito se for **horizontal (largura > altura)**. O navegador confere antes de subir gigabytes; o servidor confere de novo com `ffprobe` e recusa vertical, quadrado ou arquivo ilegível (explicando que cortes verticais vão em Conteúdo). Desligue só em teste: `VIDEO_FORMAT_CHECK=false`.
- **Publicação nas redes** (Upload-Post, `src/services/uploadPost.js` e `publishing.js`): **o episódio inteiro vai só para o YouTube** (título, descrição, tags e thumbnail aprovada; o link volta para o episódio); **cortes (publicados na página do corte, depois de atribuídos a um episódio) vão por padrão para TikTok, YouTube Shorts e Instagram Reels** (Reels com capa; Shorts sem thumbnail, que o YouTube não aceita). Só quem tem conta conectada no perfil do Upload-Post aparece liberado. Confere os limites antes de enviar, pede confirmação, aceita **agendamento** (nosso: o link do vídeo é gerado na hora de enviar), acompanha o andamento, permite tentar de novo e cancelar agendados. **Só a gestão publica.**
- ⚠️ **Modo de teste por padrão**: sem `UPLOAD_POST_LIVE=true` o painel monta e confere o pedido e marca como "simulado" — **nada é enviado às redes**. Ligue só depois de conectar as contas no Upload-Post e decidir publicar de verdade.
- **Serviços externos** (chaves no `.env`): `BB_*`/`BUCKET_NAME`, `GROQ_APIKEY`, `GEMINI_KEY`, `UPLOAD_POST_KEY` (+ `UPLOAD_POST_USER`, `UPLOAD_POST_LIVE`). Sem chave, a parte correspondente fica desativada e a tela avisa. **Gemini no plano gratuito tem limite diário baixo** (vimos 20 chamadas/dia): uma análise de episódio usa ~4 chamadas, cada corte 2 (textos e capas) — para uso real ative o faturamento.
- **FFmpeg** precisa estar instalado (o `Dockerfile` já instala). Os testes cortam vídeo de verdade.

## Financeiro: contas, custos automáticos e estoque

Menu **Financeiro** (gestão e superadmin; a produtora vê só o **Estoque**). Código em `src/services/finance.js`, `src/routes/finance.js`, `src/views/finance/`, migração `019_financeiro.sql`.

- **Resumo**: caixa hoje, a pagar em 7 dias, atrasado, resultado do mês, o que pede atenção, estoque para repor, projeção dos próximos 4 meses (entra, sai, caixa previsto) e custo por episódio. O caixa parte de um saldo inicial (Custos automáticos > Estúdio e caixa).
- **Contas** (`fin_entries`): tudo que se paga (**A pagar**) e se recebe (**A receber**), com **Histórico** por mês, busca, categoria e **exportação em planilha** (CSV com `;` para o contador). Novo lançamento pode ser parcelado (mensal). "Pagar/Receber" aceita outro valor e data (o lançamento guarda o que foi pago de verdade) e dá para desfazer.
- **Estúdio automático**: o convidado ir para **Agendado** lança o **sinal** (padrão R$ 150, vence na hora). Ao **gravar o episódio** as contas migram para o episódio e nasce o **saldo** = duração × hora (R$ 300/h) − sinal. Registrar a **duração real** no episódio (aba Financeiro) refaz o saldo; se o saldo já foi pago, a diferença vira **hora extra**. Valores em Custos automáticos > Estúdio e caixa.
- **Custos automáticos por episódio** (`fin_rules`): edição, Uber dos hosts, etc. Cada regra tem o gatilho (gravação agendada, episódio gravado, episódio publicado), o valor e o vencimento (dia do gatilho, da gravação ou da veiculação ± dias). Mudar a data da gravação move os vencimentos ainda em aberto.
- **Custos mensais** (`fin_recurring`): salário da produtora, assinaturas… lançados todo mês com 3 meses de antecedência (rotina horária + ao abrir o resumo), sem duplicar.
- **Patrocínio**: na página do patrocinador, **Pagamento** → "Combinar pagamento" (à vista ou N parcelas mensais) lança as parcelas em **A receber**; o **primeiro recebimento confirma o pagamento** do patrocinador (exigido para ficar Ativo). "Refazer parcelas" só mexe no que falta receber.
- **Estoque** (`fin_stock_items`, `fin_stock_moves`): canecas, caixas de presente, cartões… cada item tem **quanto sai por episódio**, prazo de reposição e custo médio. Cada **episódio gravado desconta sozinho** (uma vez só) e o sistema mostra **para quantos episódios dá, quando acaba e até quando comprar** (considerando episódios/mês e o prazo de reposição); itens sem uso fixo avisam por saldo mínimo. **Registrar compra** (quem mexe no financeiro) coloca no estoque, atualiza o custo médio e cria a conta a pagar (à vista, parcelada ou já paga). "Acertar ou dar baixa" cobre contagem, perda e brinde avulso.
- **Avisos**: a rotina `financeiro` (1 h) notifica a gestão (tipo "Financeiro", configurável em Gestão > Notificações) sobre contas vencendo em 3 dias/atrasadas, recebimentos atrasados e estoque a repor, no máximo uma vez por dia/mês. O painel inicial mostra uma faixa-resumo; a busca global acha contas e itens de estoque.
- Apagar convidado, episódio ou patrocinador cancela o que era automático e ainda não foi pago (e devolve ao estoque o que o episódio gastou).
- Permissões: `finance.read`/`finance.write` (superadmin, gestão), `stock.read`/`stock.write` (também produtora; sem ver valores nem comprar).

## Pulso Podcast com Plateia

Página **pública** `/plateia` (sem login, indexável) para o público pedir para assistir às gravações. Código: `src/routes/plateia.js` (público), `src/routes/plateiaAdmin.js` (interno), `src/services/audience.js`, `src/views/plateia/`, `src/public/plateia.{css,js}`, migração `021_plateia.sql`.

- **Compartilhamento e SEO**: título, descrição, Open Graph e Twitter Card definidos em `routes/plateia.js`; imagem `src/public/og-plateia.jpg` (1200×630, foto da mesa do estúdio).
- **Condições e aceite**: a página mostra o aviso "Condições da plateia" (episódio condicionado à conformidade e à disponibilidade do convidado; pode ser cancelado ou ter a plateia externa vetada sem aviso prévio; o valor será devolvido) e o pedido só segue com o checkbox "Li e aceito" marcado. O servidor recusa sem `terms: true`; guarda `terms_accepted_at` e `terms_version` no pedido (`TERMS_VERSION` em `services/audience.js`; mudou o texto, aumente a versão).
- **Card da gravação**: foto, nome, @ do Instagram (link), tema, data, horário e local. O valor fica só no topo da página e na janela de inscrição.
- **Agenda automática**: sai dos convidados em **Agendado**, com data futura e "Aberto para plateia" marcado (padrão). No card do convidado (quando Agendado/Em agendamento) há a caixa "Aberto para plateia" para tirá-lo e o seletor de vagas (Disponível, Lotado, Inscrições encerradas). A foto do convidado é enviada no mesmo card (PNG/JPEG/WebP, até 5 MB; só é pública enquanto ele está na agenda). Tema = campo "Temas" do convidado.
- **Plateia escolhida, não aberta**: a copy deixa claro que pedir participação **não garante a vaga**; a produção seleciona a plateia de cada gravação por afinidade com o convidado e o tema (vagas limitadas, tom de exclusividade sem urgência falsa). Situações do pedido: Novo pedido, Em avaliação, Selecionado, Não selecionado, Desistiu.
- **Fluxo**: escolher o episódio → nome completo + WhatsApp (país, validação por país; BR com DDD) → revisão (convidado, data, horário, R$ se selecionado, duração + aviso de que **não confirma a vaga**) → "Continuar pelo WhatsApp" abre `wa.me/<produtora>` com a mensagem pronta. O pedido vira um **lead** já na etapa de revisão e **avisa a equipe** (notificação "Plateia"); quem não abrir o WhatsApp aparece como "não abriu o WhatsApp"; a mesma pessoa no mesmo episódio não duplica nem avisa de novo. Nada é cobrado nem confirmado pela página. O fundo do topo é o vídeo do media kit.
- **Confirmar e cobrar**: no painel, o botão **Confirmar participação** pede o valor combinado (padrão R$ 197), o prazo e se já recebeu; a pessoa vira *Selecionada* e o valor entra em **Contas a receber** do Financeiro (categoria Plateia, `auto_key plateia-lead-<id>`). A produtora marca "Recebi o pagamento" (ou desfaz) ali mesmo; mudar para Não selecionado/Desistiu cancela a conta ainda não recebida (o que já foi recebido fica). Selecionar só é possível por essa janela. Migração 023.
- **Medição**: UTMs, `fbclid`/`gclid` e origem ficam guardados no navegador (primeiro toque até aparecer uma campanha nova) e vão com cada evento e inscrição. Eventos: visita, clique na agenda, clique em "Quero participar" (com o episódio), formulário aberto, inscrição e abertura do WhatsApp (`plateia_events`, robôs ignorados). **Meta Pixel** e **GA4** só carregam se a gestão informar os IDs (a CSP da página libera esses domínios só nesse caso).
- **Painel** (menu Plateia; produtora e gestão veem, só a gestão ajusta): Inscrições (WhatsApp direto, situação Novo/Em atendimento/Confirmado/Desistiu, exportação CSV), Agenda (o que está público agora), Resultados (funil, por episódio, por origem/UTM em 7/30/90 dias) e Ajustes (página no ar, preço R$ 197, duração, local, WhatsApp da produtora, IDs de rastreamento, imagens do topo e do estúdio).
- Segurança: POSTs públicos com limite por IP, isca anti-robô, telefone e texto validados no servidor, CSP sem script inline, imagens validadas pelos primeiros bytes.

## Social: publicações, novo post, ideias, insights e automações

**Menu Social** (`src/routes/social.js`, `src/services/social.js`). Tudo passa pelo Upload-Post e, **sem `UPLOAD_POST_LIVE=true`,
nada sai para as redes** (posts, edições, respostas e directs ficam como "simulado"; leituras — números, comentários, directs — são reais).

- **Publicações**: tudo o que foi publicado, agendado, testado ou deu erro (vídeo, post, carrossel, story), com filtros. No detalhe: onde saiu, links, tentar de novo, cancelar agendamento e **editar**. Agendado: muda texto e horário aqui. Publicado: a edição vai para as redes que deixam (**YouTube, Facebook, LinkedIn, X**); **Instagram, TikTok e Threads não permitem editar pela API** e a tela avisa.
- **Novo post**: mostra **só o que ainda não foi usado** (publicação simulada ou com erro não "gasta" o conteúdo): cortes prontos, posts de imagem, carrosséis (slides na ordem) e stories (imagens verticais). Escolhe as redes conectadas, legenda e horário. Imagens vão por `/upload_photos` (story = `media_type=STORIES`, só Instagram).
- **Ideias**: escolha um, vários ou todos os episódios com transcrição e o que quer (cortes, stories, carrosséis). O Gemini lê a conversa (com as marcas de tempo) e sugere título, gancho, trecho com início/fim e frase, slides e legenda. **Memória**: o pedido leva tudo o que já foi sugerido, cortado ou publicado do episódio e a resposta é filtrada (título igual ou parecido não entra). Ideia **aprovada vira tarefa** (corte vai para o editor do episódio); "Já fizemos" e "Descartar" saem da lista e continuam na memória. Vários episódios vão para a fila e avisam por notificação.
- **Insights**: seguidores, visualizações, alcance, curtidas, comentários e compartilhamentos de cada rede conectada (lidos no máximo uma vez por hora e guardados como a foto do dia, para comparar com 7 dias atrás) + o que a equipe publicou nos últimos 30 dias.
- **Automações** (estilo ManyChat): gatilho **comentário** (num post ou nos 10 mais recentes; Instagram, Facebook ou YouTube) ou **direct** (Instagram), **palavras-chave** (sem caixa/acento; vazio = todos) e ação: **direct para quem comentou** (até 3 botões com link), **resposta pública** ou os dois. Nasce **pausada**; ativar pede confirmação e só responde o que chegar **depois** de ativar, **uma vez por comentário/mensagem** (tabela `social_events`). Roda a cada 5 minutos (ou "Rodar agora") e mostra a atividade (enviado, simulado, sem palavra-chave, erro). Limites da Meta: direct para comentário só até 7 dias; responder direct só até 24 h depois da mensagem da pessoa.
- **Aprovação**: a **produtora monta o post e envia para revisão** (o post fica "Em revisão" e já reserva o conteúdo); a gestão recebe
  aviso (e vê o contador no menu Social), **aprova** (agenda, se o horário pedido ainda está no futuro, ou publica na hora) ou **devolve
  com nota**; quem pediu ajusta e reenvia, ou retira o pedido. Vale também para publicar um corte pela página dele.
- **Permissões**: ver = superadmin, gestão e produtora; pedir post (`social.request`) e tocar ideias = os mesmos; publicar direto,
  aprovar, editar posts e automatizar (`social.publish`, `social.automate`) = gestão e superadmin.

## Colaboração: tarefas, comentários, notificações e busca

- **Tarefas** (menu Tarefas): *Minhas tarefas*, *Hoje* (minhas que vencem hoje ou estão atrasadas) e *Todas*, em **lista** (agrupada em atrasadas, hoje, próximas, sem prazo, feitas), **quadro** (Kanban: a fazer, fazendo, feito, **bloqueada** — bloquear sempre pede o **motivo**) e **calendário** (pelo dia de vencimento). Uma tarefa pode ser solta ou ligada a um episódio, convidado ou patrocinador; cada uma tem página própria com comentários. Quem criou, o responsável e a gestão mexem; quem criou (ou a gestão) apaga.
- **Rotinas de tarefas** (Gestão > Rotinas): tarefas que nascem sozinhas em momentos da produção (episódio criado ou cada etapa), com **vencimento padrão** contado do gatilho, da gravação ou da veiculação, e responsável por regra (o editor, o responsável pelo convidado, uma pessoa fixa ou ninguém). O vencimento de cada tarefa continua editável. As três tarefas que já nasciam com o episódio viraram rotinas (cortes 7 dias após a gravação, bastidores 3, conteúdo extra 10).
- **Comentários** em convidados, patrocinadores, episódios, cortes e tarefas. **@Nome** menciona e avisa a pessoa; o responsável pelo item e quem já comentou também são avisados.
- **Responsável na bolinha** (como no ClickUp): clique no avatar para trocar o responsável do convidado, do patrocinador, o editor do episódio ou o responsável da tarefa, nos quadros, listas e páginas. A pessoa escolhida é avisada.
- **Notificações** (sino no menu, com contador que se atualiza sozinho): **tarefas** (atribuída a você, bloqueada, concluída, vence hoje, atrasada), **comentários**, **agendamentos concluídos** (convidado agendado) e **rotinas do sistema** (análise por IA pronta ou com erro, corte lido, publicação, patrocinador respondeu o formulário). Cada pessoa silencia o que não quer; a gestão define, por tipo, se vai para o painel, se vai por e-mail e quais perfis recebem os avisos gerais. Ninguém é avisado da própria ação.
- **Painel de gestão** (menu Gestão): usuários, **logs** (auditoria), notificações, rotinas de tarefas, busca global e integrações, com abas em comum.
- **Busca global** (**Ctrl/⌘ + K** ou **/**): busca convidados, patrocinadores, episódios (inclusive "ep 12"), tarefas, cortes, comentários e pessoas, e executa atalhos (criar convidado, nova tarefa, enviar cortes, ir para…, alternar tema). Ela **acompanha a evolução do sistema**: registra as buscas e, em Gestão > Busca global, sugere o que incluir — buscas que não acharam nada, **páginas novas sem atalho** (lidas do próprio Express), **tabelas novas que ainda não entram na busca** e itens abertos com frequência. A gestão cria atalhos com um clique; novos tipos de dados entram com um provedor em `src/services/search.js`.

## Rodando localmente

Requisitos: Node 22+, um Postgres e **FFmpeg** (`brew install ffmpeg`) para a parte de episódios.

```bash
cp .env.example .env          # preencha PODCAST_DATABASE_URL e, se quiser, Brevo/YOURLS
npm install
npm run migrate               # cria as tabelas (também roda sozinho ao subir)
npm run create-superadmin -- voce@dominio.com "Seu Nome"   # imprime o link p/ definir a senha
npm run dev                   # http://localhost:3100
```

Dicas de dev:

- ⚠️ Variáveis já exportadas no seu terminal **têm prioridade sobre o `.env`**. Se o shell tiver `YOURLS_LINK`/`YOURLS_KEY` reais,
  o `npm run dev` cria links de verdade no YOURLS mesmo com o `.env` vazio: rode `YOURLS_LINK= YOURLS_KEY= npm run dev`.
- `MAIL_DRY_RUN=true` não envia e-mail; só registra no console.
- Para não criar links no YOURLS de verdade enquanto testa, deixe `YOURLS_LINK`/`YOURLS_KEY` vazios
  (o sistema usa o link completo). Em **Integrações** há um teste de conexão que **não grava nada**.
- Para criar o superadmin sem e-mail: `SUPERADMIN_PASSWORD='uma-senha-forte' npm run create-superadmin -- email "Nome"`.

## Variáveis de ambiente

Veja `.env.example` (comentado). Resumo:

- **Obrigatórias em produção**: `PODCAST_DATABASE_URL`, `APP_BASE_URL`, `SESSION_SECRET`.
- **Brevo (SMTP)**: `BREVO_SERVER`, `BREVO_PORT`, `BREVO_USER` (login SMTP), `BREVO_CHAVE_SMTP` (chave SMTP,
  não a chave de API), `BREVO_EMAIL` (remetente validado), `BREVO_FROM_NAME` (opcional).
- **YOURLS**: `YOURLS_LINK` (host), `YOURLS_KEY` (signature da página *Tools* do YOURLS).
- **Patrocinadores**: `BB_KEY_ID`, `BB_APPLICATION_KEY`, `BUCKET_NAME` (Backblaze B2; `BB_ENDPOINT` e `BB_PREFIX` são descobertos pela chave, só informe para forçar), `GROQ_APIKEY` (transcrição de voz; `GROQ_WHISPER_MODEL` opcional) e `PATROCINIO_WHATSAPP`.
- **Episódios**: `GEMINI_KEY` (`GEMINI_MODEL` opcional), `UPLOAD_POST_KEY`, `UPLOAD_POST_USER` (padrão `default`), `UPLOAD_POST_LIVE` (**padrão `false`: só simula**), `ROLE` (`web`, `worker` ou `all`, padrão `all`; ver Arquitetura), `VIDEO_FORMAT_CHECK` (padrão `true`; `false` só em teste), `UPLOAD_PART_BYTES` (só em teste).
- **Opcionais**: `PUBLIC_BASE_URL` (domínio dos convites), `PRODUCAO_WHATSAPP` (destino dos botões do convite), `PODCAST_NAME`, `AUTO_MIGRATE`, `PORT`.

## Testes

```bash
createdb pulso_test            # o banco TEM que terminar em _test (a suíte recria o schema)
TEST_DATABASE_URL=postgresql://usuario:senha@localhost:5432/pulso_test npm test
```

Cobre autenticação, CSRF, roles, CRUD de usuários, fluxo completo do convite (YOURLS **simulado**,
e-mail em dry-run — nada externo é chamado), página pública, rastreio de cliques, regras de etapa, importação CSV, o convite do Pulso a central de patrocinadores e a **produção de episódios** (Backblaze, Groq, Gemini e Upload-Post **simulados**; a suíte bloqueia qualquer chamada real a eles; os cortes e a análise rodam FFmpeg de verdade).

## Deploy numa VPS única (Docker Compose + Caddy)

`deploy/instalar.sh` instala o Docker, baixa o código, gera `SESSION_SECRET` e a senha do Postgres, pergunta o domínio e o e-mail do superadmin e sobe Postgres + painel (web) + fila/rotinas (worker) + Caddy com HTTPS automático (`deploy/docker-compose.yml`). **O domínio precisa apontar (DNS tipo A) para o IP do servidor antes**; sem domínio, basta apertar Enter e o script usa `<ip-com-tracos>.sslip.io`, que já tem HTTPS. Sem HTTPS o login não funciona em produção (cookie Secure). O script também cria 2 GB de swap em VPS pequena e agenda backup diário do banco em `/opt/pulso-backups` (14 dias). Segredos e integrações ficam em `deploy/.env` no servidor (nunca no git). Atualizar: `cd /opt/pulso && git pull && cd deploy && docker compose up -d --build`.

## Deploy (Docker Swarm + Traefik)

Padrão da VPS (Docker Swarm + Traefik). Em linhas gerais:

1. Crie o banco: `CREATE DATABASE pulso;` no Postgres compartilhado (e um usuário próprio, se preferir).
2. Build da imagem: `docker build -t pulso-gestao:1 .` (incremente a tag a cada build).
3. Copie `stack.yml.example` → `stack.yml`, preencha os segredos e rode `docker stack deploy -c stack.yml --resolve-image never pulso`.
4. Aponte o DNS de `gestao.podcastpulso.com` (e, se usar, `kit.podcastpulso.com`) para a VPS.
5. Crie o 1º superadmin dentro do container: `docker exec -it <container> node src/scripts/createSuperadmin.js voce@dominio.com "Seu Nome"`.
6. Em **Integrações**, clique em *Testar conexão* (YOURLS) e *Enviar e-mail de teste* (Brevo).

Dois serviços com a mesma imagem: **`pulso_gestao`** (`ROLE=web`, pode ter várias réplicas) e **`pulso_worker`** (`ROLE=worker`: fila e
rotinas). Numa máquina só, um serviço com `ROLE=all` (padrão) também funciona. Depois do deploy, confira **Gestão > Sistema**.
Na Brevo, o remetente (`BREVO_EMAIL`) e o domínio precisam estar validados (SPF/DKIM) para não cair em spam.

## Lembretes da gravação e aviso de aceite

- **Aceite do convite**: quando o convidado aceita (ou recusa) pelo link, vira notificação no painel (tipo "Respostas ao convite"): vai para quem cuida do convidado e para os perfis escolhidos em Gestão > Notificações (padrão: gestão, produtora e superadmin). O e-mail ao responsável continua.
- **Lembretes** (`src/services/reminders.js`, tabela `guest_reminders`, migração `026`): com o convidado em **Agendado**, o sistema monta a agenda e, na hora de cada lembrete, avisa a produtora (tipo "Lembretes da gravação"; push também, se ligado). A mensagem fica pronta no card "Lembretes da gravação" da página do convidado, com **Enviar pelo WhatsApp** (um link para o `wa.me` que abre a conversa já com o texto, e o sistema marca como enviado em segundo plano; a produtora ainda aperta enviar no WhatsApp), **Reenviar pelo WhatsApp** depois de enviado (conta "2×" e atualiza quem e quando) e "Já enviei" para quem mandou por outro canal.
  - **3 dias antes** (lembrar a data) · **1 dia antes** (confirmar que está tudo certo) · **no dia, de manhã** (com o endereço) · **3 horas antes** (saber se está tudo certo).
  - Gravação cedo (antes de manhã + 3 h): sem lembretes no dia; o de 1 dia antes leva o endereço. Lembrete do dia e o de 3 horas a menos de 1h30 um do outro: fica só o de 3 horas, com o endereço.
  - Remarcar refaz o ciclo; sair de Agendado cancela o que não foi enviado. Uma rotina (5 min) dispara os avisos, uma vez cada.
  - **Onde a produtora trabalha**: **Notificações > Lembretes da gravação** (aba ao lado de "Avisos", com o número dos que esperam). A fila mostra "Na hora de mandar" (mensagem pronta, botão do WhatsApp e "Já enviei"), "Próximos" (o próximo de cada convidado agendado) e "Enviados nos últimos 7 dias". A mesma mensagem aparece no card da página do convidado. A rotina não avisa lembrete vencido: se a hora do próximo já passou, o anterior perde a vez.
  - **Gestão > Lembretes da gravação**: endereço do estúdio, horário da manhã (padrão 09:00) e os quatro textos, com `{primeiro_nome}`, `{nome}`, `{dia}`, `{data}`, `{hora}` e `{endereco}`.

## Menu lateral e quadros

- **Menu recolhível** (computador): o botão no topo do menu leva a só ícones (76 px, com o nome na dica e "p." no lugar do logo); a escolha fica guardada neste navegador e vale em todas as telas (`theme.js` aplica antes de pintar). No celular o menu continua sendo a barra de cima. Em tela baixa só a lista de itens rola; usuário, tema e "Sair" ficam sempre à vista.
- **Quadros (Kanban)** de Episódios, Convidados, Patrocinadores e Tarefas ocupam a altura da tela: a **barra de rolagem horizontal fica no pé da tela** (grossa e sempre visível) e **cada coluna rola para baixo sozinha** quando tem cartões demais, como no ClickUp. No celular, o quadro rola normalmente com a página.

## Google Agenda

Cada convidado em **Agendado** com data vira um evento no Google Agenda do Pulso Podcast (`src/services/googleCalendar.js`): título "Gravação Pulso: Nome", duração `GOOGLE_EVENT_MINUTES` (120), local = endereço dos lembretes, descrição com tema, Instagram, responsável, quem já confirmou a agenda e o link do painel. A rotina `google-agenda` roda a cada 2 minutos e deixa o calendário igual ao CRM: atualiza o que mudou, remove quando o convidado sai de Agendado (ou é apagado) e mantém o evento depois de Gravado/Publicado. O id do evento é fixo (`pulsog<id>`), então nada duplica. Usa **conta de serviço** (sem tela de login): ative a Google Calendar API, crie a conta e a chave JSON, compartilhe a agenda com o e-mail da conta (permissão "Fazer alterações em eventos") e preencha no `deploy/.env` `GOOGLE_CALENDAR_ID` e `GOOGLE_SERVICE_ACCOUNT_B64` (ou `_JSON`). Status, teste e "Sincronizar agora" ficam em **Gestão > Integrações**. Sem as variáveis, a integração fica desligada.

## Versões e Novidades

O sistema tem número de versão (semver) em `package.json`, e o histórico em `src/releases.js` (a primeira entrada é a versão no ar; o teste confere que as duas batem). A página **Novidades** (`/novidades`, menu: clique em `v1.1.0` no rodapé) lista as versões. Toda pessoa vê, uma vez por versão nova, o aviso "Sistema atualizado" com o título do lançamento e um X para dispensar (`users.release_seen`). Para lançar: acrescente a entrada no topo de `src/releases.js`, suba o `version` do `package.json` e publique.

## Calendário

Menu **Calendário** (`/calendario`): tudo que tem data e prazo num lugar só (`src/services/calendar.js`, `src/routes/calendar.js`, `src/views/calendar/`).

- **O que aparece** (cada tipo só para quem tem a permissão do assunto): **Gravações** (convidados em Agendado, Em agendamento "a confirmar" e já gravados; mais gravações só com os hosts), **Lembretes da gravação** (os 4 de cada agendado, com enviado/atrasado), **Cobranças da plateia** (o pagamento combinado com quem foi selecionado, no vencimento; visível para quem vê a plateia), **Tarefas** (pelo vencimento), **Publicação de episódios** (`aired_on`), **Posts nas redes** (agendados), **A receber** e **A pagar** (contas do Financeiro, com valor; só `finance.read`) e **Início e fim de parcerias** (patrocínio ganho ou ativo). Horários e dias em Brasília. Cada evento abre a página do item; o que está feito fica apagado e o que passou do prazo, em vermelho.
- **Modos**: **Mês** (segunda a domingo; dia cheio vira "+N mais" e leva para a semana), **Semana** e **Lista** (30 dias, só os dias com evento). No celular a grade vira uma coluna só com os dias que têm evento.
- **Filtros**: um botão **Filtros** (com o número do que está filtrado e um resumo ao lado) abre um painel com os **tipos** (chips para marcar, "Marcar/Desmarcar todos"), o **responsável** (todos, só os meus ou uma pessoa) e **ocultar concluídos**; **Aplicar** fecha o painel. Fecha também ao clicar fora ou com Esc.
- **Quem responde pelo quê** (`ROLE_DUTIES` em `calendar.js`): "só os meus" (ou a escolha de uma pessoa) traz o que está no nome dela **e o que é do perfil dela**, mesmo sem responsável cadastrado. **Gestão e Superadmin**: todas as gravações, contas a pagar e contas a receber. **Produtora**: todos os lembretes da gravação e as cobranças da plateia (as suas gravações são as dos convidados dela). Editor de vídeo: só o que está no nome dele. O painel avisa o que o perfil inclui. A conta da plateia aparece uma vez só: como cobrança (se o tipo estiver marcado) ou como "a receber".
- **Visualizações**: combinações salvas de modo, tipos, responsável e concluídos. Da casa: **Tudo**, **Meu trabalho** (semana, só os meus e os do meu perfil, sem concluídos), **Produção** e **Dinheiro** (só para quem vê o financeiro). Qualquer pessoa salva as suas ("Salvar esta visualização" aparece quando os filtros não batem com nenhuma); **Gestão e Superadmin** (`calendar.share`) também compartilham com a equipe e apagam as dos outros. A visualização da equipe abre para cada perfil já limitada ao que ele enxerga.
- O **assistente de IA** consulta o calendário (`calendario`): "o que tenho esta semana?".

## Alertas no navegador (Web Push)

Em **Notificações > Alertas neste aparelho**, cada pessoa liga os alertas no navegador ou celular que está usando. Toda notificação
nova (as mesmas do sino, respeitando o que a pessoa silenciou) também vai para os aparelhos dela pela fila (`push_notificacao`),
**mesmo com o painel fechado**. Com o painel aberto e em primeiro plano, vale só o aviso flutuante (sem alerta duplicado).
Sem push no aparelho, mas com alertas permitidos, a aba aberta em segundo plano também mostra o alerta do sistema.

- Código: `src/services/push.js`, `src/public/push.js`, service worker `src/public/sw.js` (servido em `/sw.js`), manifesto `/manifest.webmanifest`, migração `024_push.sql`.
- Chaves: `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (o `deploy/instalar.sh` gera; ou `npx web-push generate-vapid-keys`). Sem elas, o bloco avisa que não está configurado. Trocar as chaves desliga os aparelhos já inscritos.
- **iPhone/iPad**: só funciona com o painel adicionado à Tela de Início (Compartilhar > Adicionar à Tela de Início) e aberto por lá (iOS 16.4+).
- Aparelho que o serviço de push diz não existir mais (404/410) é removido sozinho.

## Arquitetura: processos, fila, rotinas e avisos

Detalhes e decisões em [`docs/relatorio-arquitetura-2026-10.md`](docs/relatorio-arquitetura-2026-10.md).

- **Processos** (`ROLE`): `web` atende o painel; `worker` roda a fila e as rotinas; `all` faz os dois (desenvolvimento).
- **Fila** (`src/services/jobs.js`, tabela `jobs`): Postgres com `SKIP LOCKED`; acorda na hora com `LISTEN/NOTIFY`; **duas pistas**
  por worker (pesada: corte e finalização; leve: e-mails e ideias); falha passageira tenta de novo (30 s, 2 min, 8 min; cota da IA,
  15 min); sinal de vida a cada 15 s e devolução do que ficou preso.
- **Rotinas** (`src/services/scheduler.js`): publicar agendados (30 s), fila travada (1 min), tarefas vencendo (15 min), automações
  (5 min), limpeza (6 h). Cada uma roda em **uma réplica por vez** (trava consultiva do Postgres); a última execução fica em `scheduler_runs`.
- **Avisos em tempo real** (`src/services/realtime.js`): `GET /eventos` (SSE) + `pg_notify`. Notificação nova vira aviso flutuante na hora.
- **Limitador de tentativas** no banco (`rate_hits`): vale para todas as réplicas.
- **Gestão > Sistema**: processos vivos, fila, rotinas e trabalhos que falharam, com "Tentar de novo".
- **Sem Redis**: o Postgres faz fila, trava e barramento; ver o relatório para quando reconsiderar.

## Assistente de IA

Botão flutuante em todas as páginas (`src/services/assistant.js`, `src/routes/assistant.js`, `src/public/assistant.js`).
Conversa por **texto ou voz** (grava até 2 min; Groq Whisper transcreve), com **histórico por pessoa** (abrir, continuar, apagar).
Consulta o painel por ferramentas que **respeitam o perfil** (busca, tarefas, agenda, episódios, convidado, patrocinador, redes) e
responde com links internos.
- **Números**: a ferramenta `numeros` conta o que o perfil pode ver (convidados por etapa e por motivo de perda, sem responsável, sem foto; patrocinadores, episódios, tarefas, redes, plateia e financeiro). O que o perfil não vê vem em `sem_acesso_para_o_seu_perfil` e o assistente diz quem vê. `lista_convidados` mostra quem está em cada etapa.
- **Cadastro**: `criar_convidado` (só `guests.write`) cadastra em Prospecção, com a pessoa como responsável, validando Instagram, perfil e duplicidade; pergunta o que faltar (nome, Instagram e perfil). Também cria **tarefa** quando pedido. Não publica, não muda etapa, não edita e não apaga.
- **Instrução por perfil**: o prompt leva o que o perfil da pessoa pode fazer, o que não pode e quem pode (`src/services/assistantGuide.js`, derivado de `src/permissions.js`). Permissão nova sem descrição ali derruba os testes. Usa o Gemini
(`GEMINI_KEY`); limite de 40 perguntas a cada 10 min por pessoa.

## Segurança

- Senhas com **scrypt**; tokens de sessão e de e-mail guardados só como **hash SHA-256**; links de e-mail
  de uso único (72 h para definir senha, 1 h para redefinir).
- Cookie `HttpOnly` + `SameSite=Lax` (+ `Secure` em produção), **CSRF** em toda ação autenticada, checagem de `Origin`.
- Limite de tentativas de login (só falhas contam) e resposta idêntica no "esqueci a senha" (não revela se o e-mail existe).
- CSP restritiva no painel (sem script inline). A **página pública do convite roda em `sandbox`**
  (origem opaca, sem cookies, sem `fetch`): o convite do Pulso usa JavaScript, mas esse script não consegue
  tocar no painel nem em dados da sessão, mesmo que um nome de convidado tente injetar código (os valores são sempre escapados).
- Papéis checados no servidor em cada rota; ações sensíveis vão para a **Auditoria**.

## Identidade visual

Favicon = **o Ponto** (ponto lime sobre preto): `src/public/favicon.svg`, `favicon.ico` e `apple-touch-icon.png` (também servidos na raiz).

O painel segue o **Design System de interface** e o **Manual de Marca** do Pulso:

- `docs/design-system.md` — tokens (escuro/claro), status, tipografia, componentes e checklist de UI.
- `docs/manual-de-marca.md` — logo, cores, tipografia, tom de voz e aplicações.
- `docs/referencias/` — os HTMLs originais do designer (abrem só no ambiente de origem; os `.md` são a versão de trabalho).

Fontes (Space Grotesk, Inter, JetBrains Mono, Instrument Serif) e ícones Lucide ficam **dentro do repositório**
(`src/public/fonts/`, `src/utils/icons.js`): o painel não carrega nada de CDN. Tema escuro por padrão; há botão "Tema" na barra lateral.

## Estrutura do código

```
.
├── src/
│   ├── index.js · app.js · config.js · middleware.js · permissions.js · constants.js
│   ├── db/            pool, migrate (advisory lock), migrations/*.sql
│   ├── auth/          password (scrypt), sessions, tokens (e-mail), rateLimit
│   ├── services/      mailer (Brevo), yourls, guests, guestRules (regras de etapa), csvImport, inviteTemplate, publicPages, audit,
│   │                  sponsors (regras, briefing, arquivos), sponsorSessions (magic link), b2 (Backblaze S3), groq (Whisper), gemini,
│   │                  production (etapas, arquivos), finalization/finalizationJob (IA), jobs (fila), media (FFmpeg), platformLimits,
│   │                  designs/covers/coverStore/specSanitizer (capas e posts), clips (cortes), uploadPost/publishing (redes),
│   │                  notify (notificações), comments, responsible (bolinha), tasks (tarefas e rotinas), search (busca global),
│   │                  social (conteúdo sem uso, ideias com memória, automações, insights)
│   ├── routes/        auth, users, guests, guestImport, sponsors, episodes, covers, clips, collab (comentários/notificações/busca/responsável), tasks, gestao, social, public (convite + rastreio), sponsorPublic (kit/formulário/portal), misc (início/auditoria/integrações)
│   ├── views/         EJS (painel)
│   ├── public/        app.css (tokens), app.js, theme.js, producao.js, social.js, editor.js, design/engine.js (motor das capas), fonts/, convite/ (fotos do modelo Pulso)
│   ├── utils/         format (datas em Brasília), icons (Lucide), wrap, …
│   ├── templates/     convite-pulso.html (o convite fixo), media-kit.html (o deck do patrocinador)
│   └── scripts/       createSuperadmin.js
├── docs/              design-system.md, manual-de-marca.md, referencias/ (HTML do designer)
├── CLAUDE.md · AGENTS.md · memory.md   instruções e memória pra IA
└── test/              node:test (unitários + fluxos ponta a ponta)
```

## Pendências conhecidas

- Matriz de permissões por perfil (provisória — ver acima).
- Envio de convite só por e-mail (WhatsApp é manual: copiar o link curto).
- Métricas de cliques só no detalhe de cada convidado/patrocinador (sem painel agregado ainda).
- Aprovação de moldura e QR Code pelo patrocinador (e WhatsApp) — planejado.
- Publicação real nas redes **nunca foi disparada** (só simulada e testada com mocks); o TikTok ainda não está conectado ao perfil do Upload-Post. Métricas pós-publicação, Spotify (sem API pública de upload) e carrossel/foto no Instagram ainda não.
