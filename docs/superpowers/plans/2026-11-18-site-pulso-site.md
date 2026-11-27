# Site do Pulso — o site podcastpulso.com — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um site gerado (HTML + CSS estáticos) em podcastpulso.com, montado a cada 15 minutos com os dados do Pulso
Gestão, com as seções aprovadas, os dois formulários, `/links`, política de privacidade e termos de uso.

**Architecture:** Projeto novo `site-pulso` (pasta irmã do sistema: `/Volumes/PortableSSD/Sistema pulso/site-pulso`,
repositório `acauavic/site-pulso`). `src/build.js` busca `GET /api/site/v1/dados`, copia e otimiza as imagens (WebP,
`sharp`), monta as páginas com EJS numa pasta temporária e só troca a pasta publicada se tudo deu certo. Um container
roda o build agora e a cada 15 minutos; o Caddy da VPS serve a pasta. Formulários postam direto no sistema
(`/api/site/v1/convidado|patrocinador`); com JavaScript, sem recarregar; sem JavaScript, o sistema devolve `303` para
`/obrigado/` ou `/ops/`.

**Tech Stack:** Node 22, `ejs`, `sharp`, `node:test`. Sem framework e sem CDN.

**Spec:** `docs/superpowers/specs/2026-11-18-site-podcastpulso-design.md` (no repositório do sistema; copie para
`docs/` do site no Task 1). Depende do plano 1, `docs/superpowers/plans/2026-11-18-site-pulso-sistema.md`: o
contrato de `GET /api/site/v1/dados` (Task 5 de lá) e dos formulários (Task 6 de lá) é usado aqui com os mesmos nomes.

## Global Constraints

- Marca: `docs/manual-de-marca.md` e `docs/design-system.md` do sistema. Preto domina, **lime só na ação (um por área)**, dados em mono (JetBrains Mono, caixa alta, tracking largo), plum no que é externo, Instrument Serif itálico só para a voz, Space Grotesk nos títulos, Inter no texto. Sem emoji; ícones Lucide (copie as que usar de `src/utils/icons.js` do sistema). Tema escuro, celular primeiro.
- Fontes e ícones dentro do projeto (copie os `woff2` de `src/public/fonts/` do sistema). Nada de Google Fonts, CDN ou rastreamento. **Episódios tocam no site** (pedido do dono): player do YouTube (`https://www.youtube-nocookie.com/embed/<youtube_id>`) e do Spotify (`https://open.spotify.com/embed/<spotify_kind>/<spotify_id>`, 152 px de altura), que **só nasce quando a pessoa toca** na capa com o botão de play (antes disso nenhum conteúdo de terceiros carrega); sem JS, o botão é um link para o YouTube/Spotify. Sem pixel nem analytics, sem aviso de cookies.
- Textos fixos exatos: tagline **"As conversas que estão movimentando a saúde."**; botões do topo **"Ouvir o último episódio"** e **"Quero ser convidado"**; plateia termina em **"Veja mais"** → `https://sistema.podcastpulso.com/plateia`. **Nenhum preço** de plateia em lugar nenhum. Hosts: **Acauã Victor** e **Dra. Ane Karoline Ranzi**.
- Ordem da página inicial: topo (oficial + Apoiadores) → quem já sentou à mesa → episódios → Instagram → agenda (Vai ao ar | Próximas gravações) → hosts → plateia → comunidade no WhatsApp → sente à mesa → seja parceiro → rodapé (redes, Política de privacidade, Termos de uso).
- Tom: português do Brasil, direto, sem "!!!", sem urgência falsa, sem superlativo vazio.
- Variáveis: `SITE_API_URL` (padrão `https://sistema.podcastpulso.com`), `SITE_OUT` (padrão `./dist`), `SITE_BASE_URL` (padrão `https://podcastpulso.com`), `BUILD_EVERY_MIN` (padrão `15`).

## Review Focus

- Sistema fora, lento (mais de 20 s) ou JSON fora do contrato na hora do build: a pasta publicada não muda, o build sai com código ≠ 0 e registra o motivo — teste no Task 2.
- Sistema fora na hora de enviar o formulário: a pessoa vê "Não conseguimos enviar agora" com o botão do WhatsApp da produção e **não perde o que digitou** — teste no Task 6.
- Seção sem dados (agenda vazia, sem posts, sem apoiadores, sem oficial): a seção some ou mostra o estado vazio da marca, nunca um título solto — teste no Task 3.
- Imagem que não baixa (link vencido, 404): o build segue e o item usa a moldura sem foto (iniciais) — teste no Task 2.
- Data: `'2026-12-20'` aparece como `20 DEZ` (sem voltar um dia) e item da agenda que já passou some no build mesmo que a API ainda o traga — teste no Task 3.

---

### Task 1: Projeto, conteúdo fixo e base visual

**Files:**
- Create: `package.json` (`"type": "commonjs"`, scripts `build`, `test`, `check-launch`, `dev` = build com `test/fixtures/dados.json` + servidor estático local na porta 4100; `SITE_API_URL` apontando para o sistema local usa os dados de dev), `.gitignore` (`dist*`, `node_modules`), `README.md`, `docs/` (cópia da spec e deste plano)
- Create: `content/site.json`, `content/fotos/README.md` (nomes esperados: `cenario-1.jpg…`, `mesa-1.jpg…`, `plateia-1.jpg…`, `hosts-acaua.jpg`, `hosts-ane.jpg`, `apoio-1.jpg…`)
- Create: `public/site.css`, `public/fonts/*`, `src/icons.js`
- Create: `test/fixtures/dados.json` (exemplo completo do contrato, com 1 item vazio de cada tipo para os testes)
- Test: `test/content.test.js`

**Interfaces:**
- Produces: `content/site.json` com as chaves `redes: [{ rede: 'youtube'|'spotify'|'instagram'|'threads'|'x'|'facebook', url }]`, `comunidade: { url|null }`, `producao_whatsapp: '5511999788953'`, `hosts: [{ nome, cargo, bio, foto }]`, `healthscale_fallback: { company: 'Healthscale', logo: 'content/fotos/healthscale.png' }`, `legal: { razao_social|null, cnpj|null, email|null }`. Já preenchidos com o que o dono passou (seção "Dados que o dono já passou" da spec): as seis redes, `comunidade.url = 'https://link.podcastpulso.com/omunidade'`, `legal.razao_social = 'Acauã Media Serviços e Produtos Digitais Ltda'`, `legal.email = 'contato@podcastpulso.com'`; `legal.cnpj = '28.541.634/0001-70'` (o `check-launch` recusa CNPJ que não tenha 14 dígitos). Ícones das redes: símbolos das marcas (exceção ao Lucide, como `utils/brandIcons.js` do sistema).
- Produces: `src/icons.js` → `icon(name: string, size = 16): string` (SVG Lucide, traço 2).
- Produces: `site.css` com os tokens do tema escuro do sistema (`--bg #0A0A0A`, `--surface #121212`, `--raised #1A1A1A`, `--line #262626`, `--line-strong #333333`, `--text #FAFAFA`, `--text-2 #B5B5B5`, `--muted #8A8A8A`, `--action #C8FF42`, `--external #2D1B4E`) e as classes base (botão pílula primário/secundário, chip mono, rótulo mono, título display, frase serifa).
- Produces: `npm run check-launch` → lista o que falta para lançar (fotos esperadas ausentes, `comunidade.url`, redes, `legal.*`) e sai ≠ 0 se faltar algo.

- [ ] **Step 1: Write the failing test** — `it('check-launch aponta o que falta')`: com um conteúdo de teste em que `legal.cnpj = null`, a saída contém `legal.cnpj`; `it('icon devolve svg com stroke-width 2')`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** os arquivos acima. Hosts: `cargo` "Host · Pulso Podcast" nos dois; `bio` curta proposta por você no tom da marca (o dono revisa).
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `git init && git add -A && git commit -m "Site do Pulso: projeto, conteúdo fixo e base visual"`

### Task 2: Build seguro (buscar, copiar imagens, trocar a pasta só no sucesso)

**Files:**
- Create: `src/fetchData.js`, `src/images.js`, `src/build.js`, `scripts/loop.js`
- Test: `test/build.test.js` (sobe um servidor HTTP local que responde o fixture, um erro ou demora)

**Interfaces:**
- Produces: `fetchData(apiBase: string, { timeoutMs = 20000 } = {}): Promise<SiteData>` — erro se status ≠ 200, `version !== 1` ou faltar alguma chave de primeiro nível do contrato.
- Produces: `localizeImages(data: SiteData, outDir: string): Promise<SiteData>` — baixa `photo`/`logo`/`cover` e a miniatura `https://i.ytimg.com/vi/<youtube_id>/hqdefault.jpg`, grava `img/<sha1-da-url-sem-query>-<w>.webp` em 640 e 1200 (logos: 400, fundo preservado), troca a URL por `{ src, srcset, width, height }`; falha num item = `null` naquele item, sem derrubar o build. Copia também `content/fotos/*` otimizadas.
- Produces: `build({ apiBase, outDir, content, now = new Date() }): Promise<{ ok: true, pages: string[] }>` — monta em `${outDir}.tmp`, valida (o `index.html` existe e contém a tagline), depois `rename(outDir → outDir.old)`, `rename(tmp → outDir)`, apaga `.old`. Em erro, apaga só o `.tmp`, mantém `outDir` e lança.
- Produces: `scripts/loop.js` — roda `build` agora e a cada `BUILD_EVERY_MIN`; erro registra `[site] build falhou: <motivo>` e espera o próximo ciclo.

- [ ] **Step 1: Write the failing tests** — `it('sistema fora: a pasta publicada não muda e o build falha')` (cria `dist/index.html` "antigo", servidor responde 500 → conteúdo de `dist/index.html` igual ao antigo, `build` rejeita); `it('JSON sem version 1 é recusado')`; `it('demora acima do limite é recusada')` (timeout 200 ms no teste); `it('imagem que dá 404 vira null e o build termina')`; `it('build bom troca a pasta e não deixa .tmp nem .old')`.
- [ ] **Step 2: Run** `npm test -- test/build.test.js` → FAIL.
- [ ] **Step 3: Implement** os módulos (a renderização chama `render(view, dir)` do Task 3; até lá, um `index.html` mínimo com a tagline).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Site: build que só publica quando dá certo"`

### Task 3: Modelo de tela e as seções com dados (topo, apoiadores, mesa, episódios, Instagram, agenda)

**Files:**
- Create: `src/view.js`, `src/render.js`, `templates/layout.ejs`, `templates/index.ejs`, `templates/partials/{topo,apoiadores,mesa,episodios,posts,agenda,rodape}.ejs`, `public/gallery.js` (destaque da mesa que troca a cada 5 s, parado com movimento reduzido; a página funciona sem ele)
- Test: `test/view.test.js`, `test/render.test.js`

**Interfaces:**
- Consumes: `SiteData` localizado (Task 2), `content/site.json` (Task 1), `icon()`.
- Produces: `toView(data, content, now: Date): View` — `View` tem uma chave por seção com `{ show: boolean, ... }`. Regras: `agenda.vai_ao_ar` e `agenda.gravacoes` sem itens anteriores a hoje em Brasília; `date` vira `{ label: '20 DEZ', long: '20 de dezembro' }` sem passar por `new Date('YYYY-MM-DD')` em UTC; `patrocinador_oficial` nulo usa `content.healthscale_fallback`; `apoiadores` vazio → `show: false`; `mesa` até 12, `episodios` até 6 (o primeiro é o "último episódio" do botão do topo), `posts` até 8.
- Produces: `render(view, outDir): Promise<string[]>` (EJS → arquivos; devolve os caminhos).
- Desenho (dentro da marca): topo com `cenario-1` ao fundo em escurecimento, wordmark `pulso.`, tagline em serifa itálica, os dois botões (lime = "Ouvir o último episódio"; "Quero ser convidado" secundário, leva a `#sente-a-mesa`), "PATROCINADOR OFICIAL" em mono + logo; faixa "APOIADORES" com logos em tons neutros. Mesa: destaque + grade, foto 4:3, nome em display, credencial em Inter, alcance em mono. Episódios: o mais recente em destaque com o player do YouTube (capa 16:9 + play redondo → iframe no toque) e, embaixo, o do Spotify quando houver; os demais em cartões (miniatura, `EP.012` em mono, título, convidado) que trocam o destaque ao tocar; abas `.seg` "Assistir | Ouvir" quando o episódio tem os dois. `public/players.js` monta o iframe no toque; sem JS, link para fora. Instagram: grade de capas que abrem o post, com "Ver no Instagram" (link do perfil). Agenda: duas colunas (uma embaixo da outra no celular), data mono, foto, nome, @, chip "com plateia".

- [ ] **Step 1: Write the failing tests** (`view.test.js`):
  - `it("'2026-12-20' vira 20 DEZ")`
  - `it('item da agenda que já passou some')` (`now = 2026-12-21T02:00:00Z`, que ainda é dia 20 em Brasília: o item do dia 20 fica; o do dia 19 sai)
  - `it('sem apoiadores a faixa não aparece')`, `it('sem oficial usa a Healthscale do conteúdo fixo')`, `it('agenda vazia mostra o estado vazio')` (`agenda.show === true`, `agenda.empty === true`)
  - `render.test.js`: `it('a página tem as seções na ordem aprovada')` (ids `topo, mesa, episodios, instagram, agenda, hosts, plateia, comunidade, sente-a-mesa, seja-parceiro` aparecem nessa ordem no HTML); `it('nenhum preço aparece')` (`/R\$\s?\d/` não casa); `it('sem script obrigatório: os links funcionam sem JS')` (o botão do último episódio é `<a href>`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `toView`, `render` e os templates.
- [ ] **Step 4: Run** → PASS. `npm run dev` e percorrer no navegador, desktop e celular (375 px).
- [ ] **Step 5: Commit** `git add -A && git commit -m "Site: topo, apoiadores, mesa, episódios, Instagram e agenda"`

### Task 4: Hosts, plateia e comunidade

**Files:**
- Create: `templates/partials/{hosts,plateia,comunidade}.ejs`
- Modify: `templates/index.ejs`, `src/view.js`, `public/site.css`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `content.hosts`, `content.comunidade`, `data.plateia.abertas`, fotos `hosts-*`, `plateia-*`, `mesa-*`.
- Produces: Hosts = duas colunas (foto, nome em display, "Host · Pulso Podcast" em mono, bio). Plateia = foto(s) de plateia, rótulo mono "PODCAST COM PLATEIA", título, os quatro itens (networking qualificado, conversa com o convidado e fotos nos bastidores, coffee break, ver de perto a produção de um podcast), quando `abertas > 0` a linha mono "N GRAVAÇÕES COM VAGAS", e o botão **"Veja mais"** (lime desta área) para `https://sistema.podcastpulso.com/plateia`. Comunidade = bloco **plum** (é para o público de fora), rótulo mono lime, o que rola (sorteios de vagas sem custo na plateia, avisos das gravações, bastidores, networking e coffee break nas gravações com plateia) e "Entrar na comunidade" (`comunidade.url`; sem URL, o bloco mostra "Em breve" e nenhum botão).

- [ ] **Step 1: Write the failing tests** — `it('Veja mais leva para a página da plateia')`; `it('sem link da comunidade não há botão quebrado')`; `it('os dois hosts aparecem com os nomes certos')`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS; percorrer no navegador (desktop e celular).
- [ ] **Step 5: Commit** `git add -A && git commit -m "Site: hosts, plateia e comunidade"`

### Task 5: Páginas de apoio, SEO e `/links`

**Files:**
- Create: `templates/{links,politica-de-privacidade,termos-de-uso,obrigado,ops,404}.ejs`, geração de `sitemap.xml`, `robots.txt`, `og.jpg` (1200×630 a partir de `cenario-1` + wordmark, feito no build com `sharp`), favicon (o Ponto)
- Modify: `src/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Produces: rotas como pastas (`/links/index.html`, `/politica-de-privacidade/index.html`, …). `obrigado` e `ops` leem `?tipo=` e `?erro=` com um script mínimo; sem script, texto genérico certo para os dois tipos. Política de privacidade: o que cada formulário coleta, para quê (responder o pedido), base legal (consentimento, LGPD), quem guarda (o sistema do Pulso), por quanto tempo, como pedir para apagar (`legal.email`), sem cookies de rastreamento, e os players do YouTube e do Spotify (só carregam quando a pessoa toca; a partir daí valem as regras deles); `razao_social`/`cnpj`/`email` ausentes aparecem como "[a preencher]" e o `check-launch` acusa. Termos de uso: uso do conteúdo, envio de pedidos não garante participação, marcas e imagens. `/links`: wordmark, botões das redes, último episódio, comunidade, plateia, "Quero ser convidado" e "Seja parceiro".
- `<head>` de toda página: título e descrição próprios, `canonical` com `SITE_BASE_URL`, Open Graph, `theme-color #0A0A0A`; na inicial, JSON-LD `PodcastSeries` (nome Pulso Podcast, url, imagem, autores Acauã Victor e Dra. Ane Karoline Ranzi).

- [ ] **Step 1: Write the failing tests** — `it('sitemap lista as páginas públicas e não lista obrigado nem ops')`; `it('obrigado e ops têm noindex')`; `it('política mostra [a preencher] enquanto faltar o CNPJ')`; `it('toda página tem title, description e canonical')`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS; percorrer `/links`, a política e os termos no celular.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Site: /links, política, termos, obrigado e SEO"`

### Task 6: Formulários "Sente à mesa" e "Seja parceiro"

**Files:**
- Create: `templates/partials/{sente-a-mesa,seja-parceiro}.ejs`, `public/forms.js`, `src/formClient.js` (lógica pura usada por `forms.js` e pelos testes; o build copia a versão de navegador)
- Test: `test/forms.test.js`

**Interfaces:**
- Consumes: contrato do Task 6 do plano 1 (campos `name, instagram, country, phone, email, profile, topic, privacy, url_extra` / `name, company, role, country, phone, email, website, goal, privacy, url_extra`, respostas `{ ok, field, error }`, 429).
- Produces: `<form method="post" action="${SITE_API_URL}/api/site/v1/convidado">` (e `/patrocinador`) que funciona sem JS. Com JS: `submitLead(kind, form, fetchImpl): Promise<{ state: 'ok'|'field'|'offline'|'limit', field?, message }>`; `ok` troca o formulário pela mensagem de agradecimento ("Recebemos o seu pedido. A produção fala com você pelo WhatsApp."), `field` marca o campo e foca nele, `offline`/erro de rede mostra "Não conseguimos enviar agora." + botão "Falar com a produção" (`https://wa.me/${producao_whatsapp}`) **sem limpar os campos**, `limit` mostra a frase do 429. O botão mostra "Enviando…" e trava até a resposta. UTM: na primeira visita, guarda `utm_*` da URL em `sessionStorage` e manda junto.
- Campos: convidado — Nome*, Instagram*, WhatsApp* (código do país + número), E-mail, "Você é…"* (`.seg`/chips: Médico(a), Influencer, Empresário(a), Profissional da saúde), "Sobre o que você quer conversar?", aceite* com link para a política. Patrocinador — Nome*, Empresa*, Cargo, WhatsApp*, E-mail*, Site da empresa, "O que a sua marca quer com o Pulso?", aceite*. Legenda "* obrigatório" no topo; placeholders começam com "ex.:". Campo-isca `url_extra` escondido por CSS, fora da ordem do teclado.
- "Seja parceiro" mostra antes do formulário o oficial e os apoiadores em pequeno ("Marcas que já estão nessas conversas").

- [ ] **Step 1: Write the failing tests** — `it('resposta ok vira estado ok')`; `it('400 com field marca o campo')`; `it('falha de rede vira offline e não limpa os campos')` (os valores do formulário falso continuam); `it('429 vira limit')`; `it('UTM da primeira visita vai no envio')`; `render.test.js`: `it('os formulários funcionam sem JS: action aponta para o sistema e method post')`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** → PASS. Com o sistema local (`npm run dev` do sistema, porta 3100, `SITE_ORIGIN=http://localhost:4100`) enviar os dois formulários de verdade, com e sem JS, e conferir o convidado e o patrocinador criados no painel.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Site: formulários de convidado e de patrocínio"`

### Task 7: Publicação na VPS

**Files:**
- Create: `Dockerfile` (`node:22-slim`, `npm ci --omit=dev`, `CMD ["node","scripts/loop.js"]`), `deploy/docker-compose.yml` (serviço `builder`, `restart: unless-stopped`, volume `/opt/site-pulso/dist:/app/dist`, variáveis do Global Constraints), `deploy/README.md` (como publicar e como trocar o DNS)
- Modify (no repositório do **sistema**): `deploy/Caddyfile` (bloco `{$SITE_DOMINIO}, www.{$SITE_DOMINIO}` com `root * /srv/site`, `file_server`, `try_files {path} {path}/index.html`, `handle_errors` → `/404.html`, `encode zstd gzip`, cache longo em `/img/*` e `/fonts/*`, e o cabeçalho `Content-Security-Policy: default-src 'self'; img-src 'self' data:; frame-src https://www.youtube-nocookie.com https://open.spotify.com; connect-src https://sistema.podcastpulso.com; form-action https://sistema.podcastpulso.com; frame-ancestors 'none'; base-uri 'self'`; `www` redireciona para o domínio sem www), `deploy/docker-compose.yml` (no `caddy`: volume `/opt/site-pulso/dist:/srv/site:ro` e `SITE_DOMINIO=podcastpulso.com`), `.env.example`/`README.md`; no `.env` de produção, `SITE_ORIGIN`.

- [ ] **Step 1:** Criar o repositório `acauavic/site-pulso` (privado) e dar push.
- [ ] **Step 2:** Na VPS: `git clone` em `/opt/site-pulso`, `docker compose up -d --build` em `deploy/`, conferir `ls /opt/site-pulso/dist/index.html` e o log `docker compose logs builder`.
- [ ] **Step 3:** Publicar a mudança do Caddy do sistema **combinando a hora com o dono**; testar antes do DNS com `curl -s --resolve podcastpulso.com:443:<IP da VPS> https://podcastpulso.com/ -k | grep "movimentando a saúde"` (o certificado só sai depois do DNS; antes, testar em `http` com `--resolve ...:80`).
- [ ] **Step 4:** Entregar ao dono o passo da Hostinger: trocar só os registros **A** de `podcastpulso.com` e `www` para o IP da VPS, **sem mexer nos MX**. Depois da troca, conferir HTTPS, `/links`, os dois formulários em produção e `npm run check-launch`.
- [ ] **Step 5: Commit** (nos dois repositórios) `git commit -am "Site: publicação na VPS"`
