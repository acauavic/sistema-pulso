# Site do Pulso Podcast (podcastpulso.com) — desenho

Data: 2026-11-18 · Status: rascunho para aprovação

## Por que

Hoje o podcastpulso.com é só uma página de links (Hostinger, LiteSpeed). O dono quer um site de verdade, que:

- convença **patrocinador** e **convidado** de que o Pulso é sério e grande (quem já sentou à mesa, marcas que apoiam,
  Healthscale como patrocinador oficial) e dê a cada um o seu formulário;
- deixe o **público** achar episódios, posts, agenda, plateia e a comunidade no WhatsApp;
- **se atualize sozinho** a partir do sistema (Pulso Gestão), sem ninguém editar o site quando sai episódio, entra
  convidado ou chega patrocinador.

Sucesso: o link da bio aponta para o site, a agenda e os convidados estão sempre certos, e os pedidos de convidado e
de patrocínio chegam no sistema, no lugar certo, sem retrabalho.

## Decidido pelo dono

- **Ordem das seções** (aprovada): topo → quem já sentou à mesa → episódios → Instagram → agenda → hosts → plateia →
  comunidade → sente à mesa (formulário de convidado) → seja parceiro (formulário de patrocínio) → rodapé.
- **Topo**: foto do cenário ao fundo, wordmark, tagline "As conversas que estão movimentando a saúde.", botões
  "Ouvir o último episódio" e "Quero ser convidado", **Healthscale como patrocinador oficial** e, logo abaixo, a faixa
  **Apoiadores** com a logo de **todas as marcas que já patrocinaram ou patrocinam** o Pulso.
- **Plateia sem preço**: a seção fala da experiência (networking, coffee break, perto do convidado, bastidores) e tem
  "Veja mais", que leva para `https://sistema.podcastpulso.com/plateia`, onde a pessoa se inscreve.
- **Hosts**: **Acauã Victor** e **Dra. Ane Karoline Ranzi**, com foto.
- **Comunidade no WhatsApp**: sorteios, vagas sem custo na plateia (por sorteio), o que rola nas gravações com plateia
  (networking, coffee break). Botão para entrar.
- **Redes sociais**: todas, no rodapé (e onde fizer sentido).
- **Política de privacidade** e **Termos de uso**, cada um com página própria.
- **Fotos no site inteiro**. Vão chegar 2 ou 3 de cada: podcast com mesa, cenário (para fundo), podcast com plateia,
  hosts, apoio geral. Até chegarem, o site usa as fotos que o sistema já tem (convidados) e marcações de lugar.
- **Site separado, não páginas do sistema**, no domínio **podcastpulso.com**, puxando os dados do sistema.

## Abordagens consideradas

- **A. Páginas públicas dentro do sistema** (como `/plateia`), servidas também em podcastpulso.com. Mais rápido e
  dados ao vivo, mas o site cai junto com o sistema e mistura o site da marca com o painel. **O dono preferiu não.**
- **B. Site separado que puxa os dados do sistema** (escolhida). Projeto próprio; o sistema ganha uma ligação pública
  de leitura (só campos públicos) e dois endereços para receber os formulários. Mais peças, mas o site é independente.
- **C. Site fixo editado à mão.** Descartado: agenda e convidados ficariam velhos, justo o que o dono quer evitar.

## Como fica (decisões do construtor, marcadas como tal)

### Arquitetura (minha decisão)

- **Projeto novo e separado**, pasta e repositório próprios (`site-pulso`), Node 22 (mesma linguagem do sistema).
- **Site gerado (estático)**: um script de build busca os dados no sistema, baixa e otimiza as imagens (WebP) e gera
  HTML + CSS. Roda **a cada 15 minutos** e também quando o sistema avisar (opcional, ver "Deixado ao construtor").
  Se o sistema estiver fora, o build falha e **o site continua no ar com a última versão boa** (nunca publica uma
  versão quebrada ou vazia). Isso é o que justifica ser separado.
- **Imagens copiadas no build**: as fotos dos convidados e as logos no sistema saem por links assinados que expiram
  (`guestPhotos.signedUrl`, `b2.presignGet`); o site não pode depender deles. O build guarda a cópia otimizada.
- **Hospedagem**: na mesma VPS do sistema, em container próprio; o Caddy ganha o bloco `podcastpulso.com` e
  `www.podcastpulso.com` servindo os arquivos gerados. No lançamento, o registro A do domínio sai da Hostinger para a
  VPS. **Os registros de e-mail (MX da Hostinger) não podem mudar.** A página de links atual deixa de existir.
- **JavaScript mínimo**: o site funciona sem script; script só para o envio dos formulários sem recarregar, o
  carrossel/galeria e a troca de abas. Nada de CDN: fontes e ícones Lucide ficam no próprio projeto.

### O que o sistema passa a oferecer (minha decisão)

Uma ligação pública de leitura, só com dados que já são públicos ou feitos para o público:

- `GET /api/site/v1/dados` (um JSON só, com cache curto), contendo:
  - **mesa**: os convidados da Galeria do media kit (`kitGallery.items()`, a mesma escolha que a equipe já faz para o
    kit e o convite): nome, credencial/cargo, @ do Instagram, alcance, link da foto (assinado, para o build baixar).
  - **episodios**: episódios publicados com `youtube_url` e/ou `spotify_url`: número, título, convidado, data de
    veiculação (`aired_on`), links. Os mais recentes primeiro.
  - **posts**: publicações do Instagram já no ar (`episode_publications` com `post_url`), com a capa, o gancho e o link.
    Limitação: só aparece o que foi publicado pelo sistema.
  - **agenda** (decidido pelo dono: estreias **e** gravações), em dois blocos:
    - **Vai ao ar**: episódios ainda não publicados com data de estreia (`aired_on`) de hoje em diante, mais os
      convidados agendados que já têm **estreia prevista** (ver abaixo); data, convidado, foto, tema.
    - **Próximas gravações**: convidados agendados ainda sem episódio, pela data da gravação (como `kitAgendaHtml`
      do media kit), com a marca "com plateia" quando for o caso.
    - Só nome, foto, tema e datas (nada de WhatsApp, e-mail ou responsável).
  - **Estreia prevista no convidado** (pedido do dono): o convidado agendado ganha o campo opcional "Estreia
    prevista", preenchível antes de virar episódio. Quando o episódio nasce (`production.createEpisode`), a data vai
    para `episodes.aired_on`; depois disso vale a do episódio.
  - **patrocinador_oficial** e **apoiadores** (decidido pelo dono: automático): toda marca em ganho, ativo ou inativo
    **com logo** no sistema entra sozinha. Cada patrocinador ganha a opção **"Esconder do site"** para a marca que não
    quiser aparecer. O oficial é marcado por um campo novo, **"Patrocinador oficial no site"** (só um por vez); ele sai
    em destaque no topo e não se repete na faixa.
  - **plateia**: se há gravações com plateia abertas (só "tem / não tem" e quantas), para o "Veja mais" fazer sentido.
- `POST /api/site/v1/convidado` e `POST /api/site/v1/patrocinador`: recebem os formulários (CORS só para
  podcastpulso.com, limite por IP, campo-isca contra robô). Convidados e patrocinadores **ainda não têm** colunas de
  UTM nem de origem (só a plateia tem): uma migração cria `origin` e as colunas UTM nas duas tabelas.
  - Convidado vira **prospect** no CRM de convidados com a origem "site" e avisa a gestão.
  - Patrocinador vira **Prospecção** em Patrocinadores com a origem "site" e avisa a gestão.
  - Se o sistema estiver fora no momento do envio, o formulário diz isso e oferece o WhatsApp da produção.

### Formulários (minha decisão; curtos de propósito)

- **Sente à mesa (convidado)**: nome*, Instagram*, WhatsApp*, e-mail, perfil* (médico, influenciador, empresário,
  profissional de saúde — o campo perfil que já existe no CRM, `PROFILES`/`normalizeProfile`), "Sobre o que você quer conversar?", aceite da política*.
- **Seja parceiro (patrocinador)**: nome*, empresa*, cargo, WhatsApp*, e-mail*, site da empresa, "O que a sua marca
  quer com o Pulso?", aceite da política*.
- Depois de enviar: frase de agradecimento no tom da marca e o que acontece agora ("a produção fala com você pelo
  WhatsApp").

### Conteúdo e páginas

- `/` — a página única com todas as seções acima.
- `/politica-de-privacidade` e `/termos-de-uso` — eu redijo com base no que o site realmente coleta (formulários,
  sem rastreamento), na LGPD; **recomendo revisão de um advogado** antes de lançar.
- `/links` (minha decisão) — versão curta da página de links atual, para quem só quer um botão (útil na bio).
- 404 na marca.

### Design

- Segue `docs/manual-de-marca.md` e o design system: preto domina, lime só na ação (um por área), dados em mono,
  plum no que é externo, serifa itálica só para a voz (frases de convidados, tagline). Sem emoji, ícones Lucide.
- **Tema escuro** (o mesmo das páginas públicas da plateia), celular primeiro.
- Fotos grandes do estúdio no fundo do topo e entre seções; fotos de convidado na moldura 4:3 do sistema.
- SEO: título e descrição por página, imagem de compartilhamento (OG), `sitemap.xml`, dados estruturados de podcast.

## Metas, não-metas e anti-metas

- **Metas**: site no ar em podcastpulso.com; dados sempre atualizados; formulários caindo no sistema; rápido no celular.
- **Não-metas**: editor de textos (os textos ficam no projeto), blog, venda de ingresso, login, preço da plateia,
  Pixel/Analytics (fácil de pôr depois; sem rastreamento não há aviso de cookies).
- **Anti-metas** (seria fracasso mesmo funcionando): agenda ou convidados desatualizados; mostrar dado privado de
  convidado ou patrocinador; site lento ou genérico, com cara de modelo; texto fora do tom (urgência falsa, superlativo).

## Restrições

- Marca e design system são lei (`CLAUDE.md`). Português do Brasil.
- A ligação pública do sistema expõe **só** campos públicos; nada de token, telefone, e-mail ou valor.
- Não mexer no MX do domínio. O sistema continua em `sistema.podcastpulso.com`.
- Releases do sistema: as mudanças nele (API, "patrocinador oficial", "esconder do site", "estreia prevista",
  origem "site") seguem a regra de versão
  (`src/releases.js` + `package.json`) e atualizam `memory.md`.

## Lançamento (minha decisão)

- O site ganha um repositório novo no GitHub do dono (`acauavic/site-pulso`), clonado na VPS como o sistema.
- Publicar as mudanças do sistema reinicia o painel e derruba envios de vídeo em andamento: cada publicação do sistema
  é combinada com o dono antes (nada de publicar enquanto alguém sobe vídeo).
- A troca do registro A no painel da Hostinger é feita pelo dono (sem mexer no MX), depois do site testado na VPS.

## Ainda com o dono (antes de lançar, não antes de começar)

- Fotos (mesa, cenário, plateia, hosts, apoio) e logo da Healthscale em boa qualidade.
- Lista das redes com os links; link da comunidade no WhatsApp; texto curto de cada host (ou eu proponho).
- Razão social/CNPJ e e-mail de contato para a política de privacidade.

## Deixado ao construtor

- Estrutura interna do projeto do site, ferramenta de build, desenho exato de cada seção dentro da marca.
- Aviso do sistema para refazer o site na hora (webhook) além do build a cada 15 min.
- Quantos episódios, posts e convidados aparecem em cada seção.
